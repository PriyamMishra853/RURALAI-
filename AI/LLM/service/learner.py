"""
Learning from verified clinic cases (Roadmap v3, Phase 5 / F3).

The model learns from every completed visit it is allowed to learn from -- and
it never changes itself in production. Those are the two halves of this file.

    learn   A case a doctor diagnosed, whose patient consented to training use,
            and whose label a doctor confirmed, becomes a training example. The
            diagnosis model is a Bernoulli Naive Bayes, which updates
            incrementally (partial_fit): a candidate is the live model plus the
            new examples, rebuilt in seconds, with no retraining from scratch.

    decide  The candidate is scored on a frozen benchmark -- a sample of the
            held-out split the live model was trained against, never trained on
            -- beside the live model. It replaces the live model only when a
            person promotes it, and only if it is not worse.

State lives in the database, not in this process. A model is always "the
shipped base plus this list of examples", so it is rebuilt exactly on every
start, a redeploy loses nothing, and rolling back is choosing an earlier list.
"""
from __future__ import annotations

import copy
import json
import os
import re
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

import numpy as np
from rapidfuzz import fuzz, process as fuzz_process

# One clinic case among ~196,000 training rows would move nothing. Each verified
# case counts as this many rows: enough that local cases matter, far too few to
# swamp the corpus -- and the frozen benchmark catches it if that judgement is
# wrong.
EXAMPLE_WEIGHT = float(os.environ.get('LEARN_EXAMPLE_WEIGHT', '10'))

# A doctor's free-text diagnosis must name a class the model has. Anything less
# certain than this is not guessed at; it is reported back as unmatched and
# waits for a person to map it.
LABEL_MATCH_THRESHOLD = 92.0


def normalise(text: str) -> str:
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9 ]+', ' ', str(text or '').lower())).strip()


def map_diagnosis(diagnosis: str, classes: List[str]) -> Tuple[Optional[str], float]:
    """The model class a diagnosis names, or None. Never a near guess."""
    wanted = normalise(diagnosis)
    if not wanted:
        return None, 0.0
    by_norm = {normalise(c): c for c in classes}
    if wanted in by_norm:
        return by_norm[wanted], 100.0
    best = fuzz_process.extractOne(wanted, list(by_norm.keys()), scorer=fuzz.token_set_ratio)
    if best and best[1] >= LABEL_MATCH_THRESHOLD:
        return by_norm[best[0]], float(best[1])
    return None, float(best[1]) if best else 0.0


def prepare(examples: List[dict], match_symptoms: Callable, symptom_index: Dict[str, int],
            classes: List[str]) -> Tuple[List[Tuple[List[str], str]], List[dict]]:
    """Turn examples into (symptoms, label) pairs, and say what happened to each."""
    usable, outcomes = [], []
    for ex in examples:
        matched, _ = match_symptoms(ex.get('symptoms_text') or '')
        names = list(dict.fromkeys(
            [m['symptom'] for m in matched] + [s for s in ex.get('symptoms', []) if s in symptom_index]
        ))
        label, score = map_diagnosis(ex.get('diagnosis') or '', classes)
        if not names:
            outcomes.append({'id': ex.get('id'), 'outcome': 'no_symptoms_matched'})
        elif not label:
            outcomes.append({'id': ex.get('id'), 'outcome': 'unmatched_diagnosis', 'best_score': round(score, 1)})
        else:
            usable.append((names, label))
            outcomes.append({'id': ex.get('id'), 'outcome': 'learned', 'label': label, 'symptoms': names})
    return usable, outcomes


def build(base, usable: List[Tuple[List[str], str]], vectorise: Callable):
    """The base model plus these examples. The base is never modified."""
    model = copy.deepcopy(base)
    if usable:
        X = np.vstack([vectorise(names)[0] for names, _ in usable])
        y = np.array([label for _, label in usable])
        model.partial_fit(X, y, sample_weight=np.full(len(y), EXAMPLE_WEIGHT))
    return model


def load_benchmark(path: Path) -> Optional[dict]:
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except FileNotFoundError:
        return None


def evaluate(model, benchmark: Optional[dict], n_symptoms: int) -> Optional[dict]:
    """Top-1/3/5 on the frozen benchmark. The same rows, every time."""
    if not benchmark or not benchmark.get('cases'):
        return None
    cases = benchmark['cases']
    X = np.zeros((len(cases), n_symptoms), dtype=np.float32)
    for row, (_, present) in enumerate(cases):
        X[row, present] = 1.0
    truth = np.array([label for label, _ in cases])
    proba = model.predict_proba(X)
    order = np.argsort(proba, axis=1)[:, ::-1]
    classes = model.classes_
    hits = lambda k: float(np.mean([truth[i] in classes[order[i, :k]] for i in range(len(cases))]))  # noqa: E731
    return {'n': len(cases), 'top1': round(hits(1), 4), 'top3': round(hits(3), 4), 'top5': round(hits(5), 4)}
