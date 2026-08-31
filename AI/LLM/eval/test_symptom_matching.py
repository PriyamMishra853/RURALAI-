"""
Regression tests for symptom matching.

Every case here is a failure that actually happened during development. The
matcher went through three iterations, and each one fixed one problem while
introducing another:

  v1  fuzzy WRatio          "body ache"  -> "foreign body sensation in eye"
                            "itchy rash" -> "itchy ear(s)"  -> ear diagnoses
  v2  + Jaccard, top-2      stopped the false matches, but INVENTED symptoms:
                            "vomiting" also emitted "vomiting blood", and
                            "no urine" emitted "pus in urine" — red flags the
                            patient never reported, which pushed a dehydration
                            case to 70% "hyperemesis gravidarum"
  v3  containment, top-1    correct, but long sentences diluted the score and
                            "itchy rash spreading on both forearms" matched
                            nothing at all
  v4  + sub-span windows    current

The NEGATIVE cases matter more than the positive ones. A missed match is
recoverable — the assistant re-words it. A fabricated symptom silently corrupts
the whole assessment, and nobody downstream can tell it was invented.

Run:  ../.venv/Scripts/python.exe -m pytest eval/ -v
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'service'))

from app import gate_candidate, match_symptoms  # noqa: E402


def matched_names(text):
    matched, _unmatched = match_symptoms(text)
    return {m['symptom'] for m in matched}


def unmatched_fragments(text):
    _matched, unmatched = match_symptoms(text)
    return unmatched


# --------------------------------------------------------------- positive

def test_body_ache_maps_to_ache_all_over():
    assert 'ache all over' in matched_names('body ache')


def test_itchy_rash_maps_to_skin_rash():
    # The sentence is long on purpose: this is the dilution case that v3 missed.
    assert 'skin rash' in matched_names('itchy rash spreading on both forearms')


def test_cardiac_cluster_is_recognised():
    names = matched_names('sharp chest pain, shortness of breath, sweating')
    assert {'sharp chest pain', 'shortness of breath', 'sweating'} <= names


def test_febrile_cluster_is_recognised():
    names = matched_names('high fever with chills, body ache and headache since 3 days')
    assert {'fever', 'chills', 'headache'} <= names


# --------------------------------------------------------------- negative
# These are the ones that keep the system honest.

def test_body_ache_never_matches_eye_symptom():
    """v1 matched this on the shared word 'body'. It is not an eye complaint."""
    assert 'foreign body sensation in eye' not in matched_names('body ache')


def test_itchy_rash_never_matches_ear_symptom():
    """v1 matched on 'itchy' alone and produced ear diagnoses for a skin case."""
    assert 'itchy ear(s)' not in matched_names('itchy rash spreading on both forearms')


def test_vomiting_does_not_invent_haematemesis():
    """
    v2 emitted 'vomiting blood' alongside 'vomiting'. Vomiting blood is a red
    flag requiring immediate escalation. Inventing it is a patient-safety bug,
    not a ranking inaccuracy.
    """
    names = matched_names('loose motion and vomiting, weakness')
    assert 'vomiting' in names
    assert 'vomiting blood' not in names


def test_no_urine_does_not_invent_pyuria():
    """v2 emitted 'pus in urine' from 'no urine' — a different condition."""
    assert 'pus in urine' not in matched_names('no urine since morning')


def test_gibberish_matches_nothing():
    """
    An unmatched input must yield an EMPTY list, so the caller refuses rather
    than feeding an all-zero vector to the classifier — which would return the
    training-set prior as if it were a finding.
    """
    assert matched_names('zzzzz qqqq wwww') == set()


def test_empty_input_matches_nothing():
    assert match_symptoms('') == ([], [])
    assert match_symptoms('   ') == ([], [])


# ------------------------------------------------- clinical alias layer
# The vocabulary is US clinical English; the assistants type Indian English
# and Hindi transliteration. These are the terms that were being dropped
# silently before the alias table existed.

def test_loose_motion_is_diarrhoea():
    """
    The single highest-impact miss. 'loose motion' is THE phrase used for
    diarrhoea across rural India, shares no token with 'diarrhea', and so
    could never match on string similarity. A dehydrated child was being
    scored on 'vomiting' alone.
    """
    assert 'diarrhea' in matched_names('loose motion 5 times since morning')


def test_british_spelling_matches():
    """'diarrhoea' and 'diarrhea' are one letter apart but the token gate
    compares whole words, so the variant never matched."""
    assert 'diarrhea' in matched_names('diarrhoea since yesterday')


def test_hindi_transliteration_matches():
    assert 'fever' in matched_names('bukhar')
    assert 'cough' in matched_names('khaansi')
    assert 'dizziness' in matched_names('chakkar aana')


def test_breathlessness_matches():
    assert 'shortness of breath' in matched_names('breathlessness on walking')


def test_paediatric_dehydration_cluster_is_now_complete():
    """The case that exposed the gap: before the alias layer this returned
    only {vomiting, mouth dryness} and the model ranked ovarian cyst."""
    names = matched_names('loose motion 5 times, vomiting, dry mouth')
    assert {'diarrhea', 'vomiting', 'mouth dryness'} <= names


def test_alias_does_not_fire_on_substring():
    """'gas' is an alias for flatulence. It must not fire inside 'gastritis'."""
    assert 'flatulence' not in matched_names('gastritis diagnosed last year')


def test_alias_prefers_longest_phrase():
    """'loose motion' must win over the bare word 'motion'."""
    matched, _ = match_symptoms('loose motion since morning')
    hit = next(m for m in matched if m['symptom'] == 'diarrhea')
    assert hit['input'] == 'loose motion'


# ------------------------------------------------- unrecognised reporting

def test_ambiguous_complaint_is_reported_not_guessed():
    """
    'stomach pain' has no neutral vocabulary term — only upper/lower/burning/
    sharp. Picking one fabricates a qualifier, so it must surface as
    unrecognised for the assistant to clarify.
    """
    assert 'stomach pain' in unmatched_fragments('stomach pain')
    assert 'upper abdominal pain' not in matched_names('stomach pain')


def test_qualified_abdominal_pain_does_match():
    assert 'upper abdominal pain' in matched_names('upper stomach pain since 2 days')


# ------------------------------------------------- demographic gating
# The classifier never saw an age or a sex, so nothing stopped it ranking
# ovarian cyst for a five-year-old boy. These candidates are not unlikely;
# they are impossible, and one of them in a list discredits all of it.

def test_female_condition_rejected_for_male():
    assert gate_candidate('ovarian cyst', 30, 'male')
    assert gate_candidate('breast infection (mastitis)', 30, 'male')


def test_male_condition_rejected_for_female():
    assert gate_candidate('prostate cancer', 60, 'female')
    assert gate_candidate('testicular torsion', 20, 'female')


def test_adult_condition_rejected_for_child():
    assert gate_candidate('trichomonas infection', 5, 'female')
    assert gate_candidate('ovarian cyst', 5, 'female')
    assert gate_candidate('benign prostatic hyperplasia (bph)', 5, 'male')


def test_plausible_candidate_passes():
    assert gate_candidate('ovarian cyst', 30, 'female') is None
    assert gate_candidate('infectious gastroenteritis', 5, 'female') is None
    assert gate_candidate('flu', 30, 'male') is None


def test_gate_is_inert_without_demographics():
    """Unknown age and sex must never remove a candidate — absence of data is
    not grounds to narrow the list."""
    assert gate_candidate('ovarian cyst', None, None) is None
    assert gate_candidate('prostate cancer', None, None) is None
