"""
AI inference service.

A small FastAPI app that owns the trained models and the datasets, so Python
never runs inside the Express process. The Node backend calls it over HTTP on
localhost (or a private network in deployment).

Endpoints:
  GET  /health                  liveness + what is loaded
  POST /diagnose                symptoms -> candidate diseases (pipeline 1)
  POST /medicine-availability   molecule -> real Indian products (pipeline 2)
  GET  /precautions/{disease}   dataset-sourced precautions

The LLM re-ranking step deliberately does NOT live here. It runs in Node, where
the Groq key pool already handles rate limits across four keys — duplicating
that here would mean two independent things believing they own the quota.
"""
import json
import re
from pathlib import Path
from typing import List, Optional

import numpy as np
import joblib
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from rapidfuzz import process as fuzz_process, fuzz

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / 'data' / 'models'

app = FastAPI(title='RuralAI inference', version='1.0.0')

# ---------------------------------------------------------------- model load

STATE = {'ready': False, 'error': None}

try:
    NB = joblib.load(MODELS / 'symptom_nb.joblib')
    VOCAB = json.loads((MODELS / 'symptom_vocabulary.json').read_text(encoding='utf-8'))
    META = json.loads((MODELS / 'symptom_model_meta.json').read_text(encoding='utf-8'))
    SYMPTOMS: List[str] = VOCAB['symptoms']
    SYMPTOM_INDEX = {s: i for i, s in enumerate(SYMPTOMS)}
    STATE['ready'] = True
except Exception as exc:  # noqa: BLE001 - startup diagnostics
    NB, VOCAB, META, SYMPTOMS, SYMPTOM_INDEX = None, None, None, [], {}
    STATE['error'] = f'{type(exc).__name__}: {exc}'

# ------------------------------------------------------- clinical alias layer
#
# The training vocabulary is US clinical English. The people typing into this
# system write Indian English and Hindi transliteration. Those two registers
# share no tokens for the most common complaint in rural paediatrics -- "loose
# motion" versus "diarrhea" -- and the matcher's shared-token gate (correctly)
# refuses to bridge that on string similarity alone. So the bridge is an
# explicit, reviewed table instead of a looser threshold.
#
# Targets are validated against the vocabulary on load. An alias pointing at a
# term that does not exist is a silent no-op, which is the worst kind of bug in
# a clinical matcher, so it is reported in /health rather than ignored.
ALIASES: dict = {}
ALIAS_ERRORS: List[str] = []

try:
    _alias_doc = json.loads((ROOT / 'data' / 'clinical_aliases.json').read_text(encoding='utf-8'))
    for _alias, _target in _alias_doc.get('aliases', {}).items():
        if _target in SYMPTOM_INDEX:
            ALIASES[_alias.lower()] = _target
        else:
            ALIAS_ERRORS.append(f'{_alias!r} -> {_target!r} (not in vocabulary)')
except Exception as exc:  # noqa: BLE001
    ALIAS_ERRORS.append(f'{type(exc).__name__}: {exc}')

# Longest first: "loose motion" must win over "motion" inside the same fragment.
ALIAS_BY_LENGTH = sorted(ALIASES, key=lambda a: (-len(a.split()), a))

try:
    MEDICINES = json.loads((MODELS / 'medicine_index.json').read_text(encoding='utf-8'))
except Exception:
    MEDICINES = {}

try:
    PRECAUTIONS = json.loads((MODELS / 'precautions.json').read_text(encoding='utf-8'))
except Exception:
    PRECAUTIONS = {}


# ------------------------------------------------------------------ schemas

class DiagnoseRequest(BaseModel):
    text: str = Field('', description='Free-text symptoms as the assistant recorded them')
    symptoms: List[str] = Field(default_factory=list, description='Already-canonical symptom names')
    top_k: int = Field(5, ge=1, le=10)
    # Below this the candidate list is not worth showing as a ranked answer.
    min_confidence: float = Field(0.02, ge=0.0, le=1.0)
    # Demographics, used ONLY to remove impossible candidates (see gate_candidate).
    age_years: Optional[float] = Field(None, ge=0, le=130)
    sex: Optional[str] = Field(None, description="'male' | 'female' | anything else is ignored")


class MedicineRequest(BaseModel):
    molecule: str
    strength: Optional[str] = None


# ------------------------------------------------------------------ helpers

# Assistants write "high fever since 3 days, loose motion" — split on the
# punctuation and conjunctions people actually use, not just commas.
SPLIT_RE = re.compile(r'[,;./\n]| and | with | plus ', re.IGNORECASE)

# Words that carry no clinical meaning but dominate token overlap.
STOPWORDS = {
    'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'from', 'since',
    'both', 'all', 'over', 'and', 'with', 'my', 'his', 'her', 'is', 'has',
    'have', 'had', 'been', 'very', 'severe', 'mild', 'day', 'days', 'week',
    'weeks', 'month', 'months', 'year', 'years', 'ago', 'patient', 'complains',
}


# Specific anatomical sites. A vocabulary term naming one of these is about
# THAT site — so if the assistant never mentioned it, the term is very likely
# the wrong complaint. This is what separates "skin rash" from "itchy scalp",
# "itchy ear(s)" and "itchy eyelid" for a patient with a rash on the forearms:
# all four share one token with the input, but three of them name a body part
# the patient did not.
#
# `skin` is deliberately absent: it is the generic integument, not a site.
BODY_SITES = {
    'scalp', 'ear', 'ears', 'eye', 'eyes', 'eyelid', 'nose', 'nasal', 'throat',
    'tongue', 'tooth', 'teeth', 'gum', 'gums', 'jaw', 'neck', 'shoulder',
    'arm', 'arms', 'forearm', 'forearms', 'elbow', 'wrist', 'hand', 'hands',
    'finger', 'fingers', 'chest', 'breast', 'back', 'abdomen', 'abdominal',
    'stomach', 'hip', 'groin', 'leg', 'legs', 'knee', 'ankle', 'foot', 'feet',
    'toe', 'toes', 'vaginal', 'vagina', 'penis', 'rectal', 'anus', 'head',
    'face', 'lip', 'lips', 'ankles', 'shoulders', 'scrotum', 'testicular',
    # Added after "stomach pain" matched "rib pain": the site list was the only
    # thing standing between a bare symptom word and an arbitrary anatomical
    # term, and every site missing from it was a hole. These are the remaining
    # sites named by the 377-term vocabulary.
    'rib', 'ribs', 'flank', 'side', 'pelvic', 'pelvis', 'suprapubic',
    'buttock', 'thigh', 'calf', 'spine', 'sinus', 'sinuses', 'bladder',
    'kidney', 'kidneys', 'prostate', 'testicle', 'testicles', 'testes',
    'nipple', 'navel', 'belly', 'tonsil', 'tonsils', 'lymph', 'gland',
    'glands', 'muscle', 'joint', 'joints', 'bone', 'bones', 'nail', 'nails',
    'hair', 'vulva', 'vulvar', 'uterine', 'menstrual', 'sputum', 'urine',
    'stool', 'stools', 'mouth', 'facial', 'penile', 'heart', 'pupils', 'nodes',
}

# Words that name a COMPLAINT but not WHICH complaint. On their own they carry
# no anatomy and no mechanism, so a bare one of these must never be allowed to
# select a specific multi-word term: "pain" picked "rib pain", then "mouth
# pain", purely on which site word happened to be missing from BODY_SITES.
# Enumerating sites forever is a losing game; this is the general rule that
# makes the site list a refinement rather than the only defence.
GENERIC_SYMPTOM_WORDS = {
    'pain', 'painful', 'ache', 'aches', 'aching', 'swelling', 'swollen',
    'weakness', 'weak', 'stiffness', 'tightness', 'tight', 'cramps', 'cramp',
    'spasms', 'lump', 'mass', 'itching', 'itchy', 'itchiness', 'redness',
    'red', 'discharge', 'bleeding', 'rash', 'burning', 'burns', 'sore',
    'soreness', 'problem', 'problems', 'symptoms', 'disorder', 'irritation',
    'infection', 'infected', 'lesion', 'lesions', 'growth',
}


def content_tokens(text: str) -> set:
    return {t for t in re.findall(r'[a-z]+', text.lower()) if t not in STOPWORDS and len(t) > 2}


def score_candidate(fragment: str, term: str) -> float:
    """
    Combined string + token-overlap score.

    Pure fuzzy string distance is not safe here. rapidfuzz's default WRatio
    leans on partial_ratio, which scores a short input very highly against any
    longer term that merely CONTAINS it — so "body ache" matched "foreign body
    sensation in eye" at 90, and "itchy rash" matched "itchy ear(s)". Both are
    clinically wrong, and both produced a confident, wrong candidate list.

    Jaccard overlap of content words is added as a second, independent signal.
    A term that shares one incidental word with the input but carries several
    unrelated ones is penalised, which is exactly the failure above.
    """
    a, b = content_tokens(fragment), content_tokens(term)
    if not a or not b:
        return 0.0

    shared = a & b
    # No shared content word means no match, however well the characters line
    # up. This is what stops "body ache" reaching "foreign body sensation in eye".
    if not shared:
        return 0.0

    # Sharing a BODY PART is not sharing a COMPLAINT.
    #
    # "stomach pain" matched "stomach bloating": the only shared word was the
    # anatomy, and the actual symptom — pain versus bloating — was invented
    # wholesale. The wrong-site penalty below could not catch it, because that
    # fires when the TERM names a site the input lacks; here both name the same
    # site and disagree about everything else.
    #
    # So at least one shared token must be a symptom word. "sharp chest pain"
    # still matches itself on 'sharp'/'pain'; "leg pain" on 'pain'.
    if not (shared - BODY_SITES):
        return 0.0

    # A bare generic complaint word cannot choose a specific term for the
    # patient. "pain" must not become "rib pain" or "mouth pain" — the site is
    # the whole clinical content of those terms and the assistant never wrote
    # it. Longer windows are unaffected: "itchy rash" still reaches "skin rash".
    if len(a) == 1 and len(b) > 1 and a <= GENERIC_SYMPTOM_WORDS:
        return 0.0

    # Containment, not Jaccard: what fraction of the VOCABULARY TERM'S meaning
    # is present in the input. Jaccard punished long inputs — "itchy rash
    # spreading on both forearms" scored 0.2 against "skin rash" purely because
    # the assistant wrote a full sentence, and the match was lost.
    containment = len(shared) / len(b)

    # A term whose words are mostly absent from the input is not what the
    # assistant described, regardless of string similarity.
    if containment < 0.5:
        return 0.0

    fuzzy = fuzz.token_set_ratio(fragment, term)
    score = 0.4 * fuzzy + 0.6 * (containment * 100)

    # Penalise a term that names a body site the assistant never mentioned.
    # Without this, "itchy rash spreading on both forearms" matched "itchy
    # scalp" just as well as "skin rash" — same single shared token, same
    # containment — and the winner came down to iteration order.
    wrong_site = {t for t in b if t in BODY_SITES} - a
    if wrong_site:
        score *= 0.55

    return score


def match_symptoms(text: str, threshold: float = 62.0):
    """
    Map free text onto the model's 377-symptom vocabulary.

    STRICTLY ONE symptom per fragment — the single best match.

    Taking the top two was tried and is actively dangerous: "vomiting" also
    pulled in "vomiting blood", and "no urine" pulled "pus in urine". Both are
    red flags the patient never reported, and together they pushed a
    dehydration case to a confident 70% "hyperemesis gravidarum". Inventing a
    symptom is far worse than missing one — a missed match is recoverable by
    re-wording, a fabricated red flag corrupts the whole assessment.

    Every match carries its score so the caller can show what was understood.
    A silent mismatch is far worse than a visible low-confidence one.
    """
    if not text.strip():
        return [], []

    fragments = [f.strip().lower() for f in SPLIT_RE.split(text) if len(f.strip()) > 2]
    matched, seen, unmatched = [], set(), []

    for frag in fragments:
        # ---- Alias pass, before any fuzzy scoring ----
        #
        # An exact phrase the reviewed table knows is not a guess, so it does
        # not go through a threshold. Checked longest-first so "loose motion"
        # inside "loose motion 5 times" wins over the bare word "motion".
        frag_words = set(re.findall(r'[a-z]+', frag))
        alias_hit = None
        for alias in ALIAS_BY_LENGTH:
            # Whole-word containment: "gas" must not fire inside "gastritis".
            if alias in frag and set(alias.split()) <= frag_words:
                alias_hit = alias
                break

        if alias_hit:
            term = ALIASES[alias_hit]
            if term not in seen:
                seen.add(term)
                matched.append({
                    'input': alias_hit,
                    'symptom': term,
                    'score': 100.0,
                    'via': 'alias',
                })
            continue

        # Score against sub-spans, not just the whole fragment.
        #
        # An assistant writes a sentence — "itchy rash spreading on both
        # forearms" — but the vocabulary term is two words, "skin rash". Scored
        # whole-against-whole the extra words dilute every metric and the match
        # is lost. Sliding a 1-4 word window over the fragment lets "itchy rash"
        # be compared to "skin rash" on its own terms.
        words = frag.split()
        windows = {frag}
        for size in (1, 2, 3, 4):
            for i in range(len(words) - size + 1):
                windows.add(' '.join(words[i:i + size]))

        # Deterministic order. `windows` is a set, and iterating a set of
        # strings follows Python's per-process randomised hash — so with ties
        # present the winner changed between runs. "itchy rash spreading on
        # both forearms" produced 'skin rash' on one run and 'itchy ear(s)' on
        # the next, from identical input. Non-determinism in a clinical
        # matcher is not a rough edge; it means the record cannot be reproduced.
        ordered_windows = sorted(windows, key=lambda w: (-len(w.split()), w))

        # Ties are common: 'rash' scores 70.0 against 'skin rash' and 'itchy'
        # scores 70.0 against 'itchy scalp', 'itchy eyelid' and 'itchy ear(s)'.
        # The tie is broken by scoring each candidate against the WHOLE
        # fragment, so a term whose other words also appear in what the
        # assistant wrote wins over one that merely shares a single token.
        best = None   # (window_score, whole_score, term_for_stability)
        best_term, best_window = None, frag

        for window in ordered_windows:
            for term in SYMPTOMS:
                sc = score_candidate(window, term)
                if sc < threshold:
                    continue
                key = (sc, score_candidate(frag, term), term)
                if best is None or key > best:
                    best, best_term, best_window = key, term, window

        best_score = best[0] if best else 0.0

        if best_term and best_score >= threshold:
            if best_term not in seen:
                seen.add(best_term)
                matched.append({
                    'input': best_window,
                    'symptom': best_term,
                    'score': round(best_score, 1),
                    'via': 'fuzzy',
                })
        else:
            # Reported, not swallowed. A complaint the system did not
            # understand is information the assistant needs: it is the
            # difference between "we found nothing" and "we did not read the
            # thing you were most worried about". The UI asks them to rephrase.
            unmatched.append(frag)

    return matched, unmatched


# --------------------------------------------------------- demographic gates
#
# The classifier was trained on symptom vectors alone. It has never been shown
# an age or a sex, so nothing stops it ranking "ovarian cyst" and "breast
# infection (mastitis)" for a five-year-old boy with diarrhoea -- which is
# exactly what it did before this gate existed.
#
# This is not a confidence adjustment. These are candidates that are
# ANATOMICALLY OR DEVELOPMENTALLY IMPOSSIBLE for the patient, and a doctor
# reading a candidate list that contains one immediately (and rightly) stops
# trusting the rest of it. Removing them is a correctness fix, not a cosmetic
# one.
#
# Gates only ever REMOVE candidates. Nothing here can promote a disease or
# change a rank, so a wrong gate costs a candidate, never adds a false one.
FEMALE_ONLY = re.compile(
    r'ovar|uter|vagin|vulv|cervic|endometri|menstru|menopaus|pregnan|'
    r'eclampsia|ectopic|mastitis|postpartum|abortion|obstetric|'
    r'pelvic inflammatory|gravidarum|oophor|fibroid|pcos|vaginismus|vulvodynia',
    re.I,
)

MALE_ONLY = re.compile(
    r'prostat|testic|penis|penile|epididym|scrot|erectile|balanitis|'
    r'varicocele|phimosis|hydrocele',
    re.I,
)

# Conditions that do not occur in young children. Deliberately conservative --
# only entries where paediatric occurrence is negligible, not merely uncommon.
# Congenital and perinatal presentations are why this is gated at 12 rather
# than at 18.
ADULT_ONLY = re.compile(
    r'prostat|menopaus|erectile|infertility|trichomonas|gonorrhea|gonorrhoea|'
    r'chlamydia|syphilis|pelvic inflammatory|endometri|ovarian|uterine fibroid|'
    r'alcohol|smoking|copd|emphysema|atheroscler|osteoporosis|'
    r'benign prostatic|varicocele|premature ejaculation|mastitis',
    re.I,
)
ADULT_ONLY_BELOW_YEARS = 12

# Conditions of ageing that should not head the list for a young adult.
ELDERLY_SKEW = re.compile(r'dementia|alzheimer|parkinson', re.I)
ELDERLY_SKEW_BELOW_YEARS = 40


def gate_candidate(disease: str, age_years: Optional[float], sex: Optional[str]):
    """
    Return a rejection reason, or None if the candidate is plausible.

    Kept as a pure function so the eval suite can assert on it directly.
    """
    s = (sex or '').strip().lower()
    is_female = s.startswith('f')
    is_male = s.startswith('m')

    if is_male and FEMALE_ONLY.search(disease):
        return 'female-specific condition; patient is recorded male'
    if is_female and MALE_ONLY.search(disease):
        return 'male-specific condition; patient is recorded female'

    if age_years is not None:
        if age_years < ADULT_ONLY_BELOW_YEARS and ADULT_ONLY.search(disease):
            return f'not plausible at age {age_years:g}'
        if age_years < ELDERLY_SKEW_BELOW_YEARS and ELDERLY_SKEW.search(disease):
            return f'condition of later life; patient is {age_years:g}'

    return None


def vectorise(symptom_names):
    vec = np.zeros((1, len(SYMPTOMS)), dtype=np.float32)
    for name in symptom_names:
        idx = SYMPTOM_INDEX.get(name)
        if idx is not None:
            vec[0, idx] = 1.0
    return vec


# ----------------------------------------------------------------- endpoints

@app.get('/health')
def health():
    return {
        'status': 'ok' if STATE['ready'] else 'degraded',
        'error': STATE['error'],
        'models': {
            'symptom_diagnosis': bool(NB),
            'medicine_index': len(MEDICINES),
            'precautions': len(PRECAUTIONS),
            'clinical_aliases': len(ALIASES),
        },
        # Surfaced, not logged and forgotten: an alias pointing at a term that
        # does not exist is a silently dead mapping.
        'alias_errors': ALIAS_ERRORS,
        'meta': META,
    }


@app.post('/diagnose')
def diagnose(req: DiagnoseRequest):
    """
    Pipeline 1. Returns a RANKED CANDIDATE LIST, never a diagnosis.

    The caller (Node) passes these candidates to the LLM for re-ranking against
    vitals and history. The model may re-order and reject; it may not introduce
    a disease that is not in this list. That bound is what keeps the final
    output traceable to the training data.
    """
    if not STATE['ready']:
        raise HTTPException(503, f'Diagnosis model unavailable: {STATE["error"]}')

    matched, unmatched = match_symptoms(req.text) if req.text else ([], [])
    names = [m['symptom'] for m in matched] + [s for s in req.symptoms if s in SYMPTOM_INDEX]
    names = list(dict.fromkeys(names))

    if not names:
        # An empty vector would make the model return its prior — the most
        # common disease in the training set — for a patient it knows nothing
        # about. Refusing is the only safe answer.
        return {
            'ok': False,
            'reason': 'No recorded symptom could be matched to the clinical vocabulary.',
            'matched_symptoms': matched,
            'unmatched_fragments': unmatched,
            'candidates': [],
        }

    proba = NB.predict_proba(vectorise(names))[0]
    # Rank the whole space, then gate, then take top_k — otherwise gating a
    # candidate out of the top 5 shortens the list instead of promoting the
    # next plausible disease into it.
    order = np.argsort(proba)[::-1]

    candidates, excluded = [], []
    for i in order:
        conf = float(proba[i])
        if conf < req.min_confidence:
            break
        disease = str(NB.classes_[i])
        reason = gate_candidate(disease, req.age_years, req.sex)
        if reason:
            excluded.append({'disease': disease, 'confidence': round(conf, 4), 'reason': reason})
            continue
        candidates.append({'disease': disease, 'confidence': round(conf, 4)})
        if len(candidates) >= req.top_k:
            break

    # Honest confidence reporting.
    #
    # A flat posterior — top candidate at 5% over 582 classes — is the model
    # saying it does not know, and printing it as a ranked list invites the
    # reader to treat 5% as a finding. `confident` lets the caller render "no
    # confident match" instead of five near-tied guesses.
    top = candidates[0]['confidence'] if candidates else 0.0
    confident = top >= 0.15
    single_symptom = len(names) == 1

    return {
        'ok': bool(candidates),
        'confident': confident,
        'confidence_note': (
            None if confident else
            'The model did not find a confident match. The candidates below are weak and '
            'near-tied; treat them as a prompt to record more detail, not as a shortlist.'
        ),
        'matched_symptoms': matched,
        'unmatched_fragments': unmatched,
        'excluded_candidates': excluded,
        'sparse_input': single_symptom,
        'symptoms_used': names,
        'candidates': candidates,
        'model': META.get('selected'),
        'model_top5_accuracy': META.get('metrics', {}).get('bernoulli_nb', {}).get('top5'),
        # Stated on every response so the caller cannot present this as a
        # diagnosis by omission.
        'disclaimer': 'Ranked candidates from a statistical model. Not a diagnosis. '
                      'A registered practitioner makes every clinical decision.',
    }


@app.post('/medicine-availability')
def medicine_availability(req: MedicineRequest):
    """
    Pipeline 2. What a patient can actually buy for a molecule the SIGNED
    FORMULARY already chose — never which molecule to give.
    """
    key = req.molecule.strip().lower()
    entry = MEDICINES.get(key) or next(
        (v for k, v in MEDICINES.items() if key in k or k in key), None
    )
    if not entry:
        return {'ok': False, 'molecule': req.molecule, 'reason': 'No in-market products indexed for this molecule.'}

    strengths = entry['strengths']
    if req.strength:
        strengths = {k: v for k, v in strengths.items() if req.strength.lower() in k.lower()} or strengths

    return {
        'ok': True,
        'molecule': entry['molecule'],
        'total_products': entry['total_products'],
        'strengths': strengths,
        'source': 'A_Z_medicines_dataset_of_India (in-market allopathy only)',
        'disclaimer': 'Availability and price only. The choice of medicine comes '
                      'from the practitioner-signed formulary, not from this index.',
    }


@app.get('/precautions/{disease}')
def precautions(disease: str):
    key = disease.strip().lower()
    items = PRECAUTIONS.get(key)
    if not items:
        hit = fuzz_process.extractOne(key, list(PRECAUTIONS.keys()), score_cutoff=80)
        if hit:
            items = PRECAUTIONS[hit[0]]
            key = hit[0]
    if not items:
        return {'ok': False, 'disease': disease, 'precautions': []}
    return {'ok': True, 'disease': key, 'precautions': items}
