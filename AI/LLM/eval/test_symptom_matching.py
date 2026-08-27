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

from app import match_symptoms  # noqa: E402


def matched_names(text):
    return {m['symptom'] for m in match_symptoms(text)}


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
    assert match_symptoms('zzzzz qqqq wwww') == []


def test_empty_input_matches_nothing():
    assert match_symptoms('') == []
    assert match_symptoms('   ') == []
