"""
Freeze a benchmark from the held-out split the live model was trained against.

Roadmap v3, Phase 5: a retrained model may replace the live one only after
beating it on a benchmark that does not move. The raw dataset is 214 MB and is
not deployed, so the benchmark has to travel with the code: this writes a
stratified sample of the ORIGINAL test split -- same filtering, same seed, same
stratification as train_symptom_diagnosis.py -- as symptom indices, small
enough to commit.

Because it is drawn from the test split, none of these rows were seen in
training. Because it is frozen, a candidate that learned from clinic cases is
measured against exactly the yardstick the live model was, and a candidate that
got worse cannot hide it.

    python training/build_frozen_benchmark.py
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'data' / 'raw' / 'symptoms' / 'Final_Augmented_dataset_Diseases_and_Symptoms.csv'
OUT = ROOT / 'data' / 'models' / 'frozen_benchmark.json'

# Must match train_symptom_diagnosis.py exactly, or the "held-out" rows were
# seen in training and the benchmark flatters every model it scores.
MIN_SAMPLES_PER_DISEASE = 30
TEST_SIZE = 0.2
SEED = 42

PER_DISEASE = 5


def main() -> int:
    if not RAW.exists():
        print(f'Raw dataset not found at {RAW}. Run training/download.py first.')
        return 1

    df = pd.read_csv(RAW)
    label_col = df.columns[0]
    symptom_cols = list(df.columns[1:])

    counts = df[label_col].value_counts()
    keep = counts[counts >= MIN_SAMPLES_PER_DISEASE].index
    df = df[df[label_col].isin(keep)]

    X = df[symptom_cols].to_numpy(dtype=np.int8)
    y = df[label_col].to_numpy()
    _, X_test, _, y_test = train_test_split(X, y, test_size=TEST_SIZE, random_state=SEED, stratify=y)

    vocabulary = json.loads((ROOT / 'data' / 'models' / 'symptom_vocabulary.json').read_text(encoding='utf-8'))
    if vocabulary['symptoms'] != symptom_cols:
        print('The vocabulary does not match the dataset columns; the benchmark would be misaligned.')
        return 1

    rng = np.random.default_rng(SEED)
    cases = []
    for disease in sorted(np.unique(y_test)):
        rows = np.flatnonzero(y_test == disease)
        take = rng.choice(rows, size=min(PER_DISEASE, rows.size), replace=False)
        for r in take:
            present = np.flatnonzero(X_test[r]).tolist()
            if present:
                cases.append([str(disease), present])

    OUT.write_text(json.dumps({
        'about': 'Stratified sample of the held-out test split used to train symptom_nb.joblib '
                 '(seed 42, test size 0.2, >= 30 examples per disease). Never trained on. '
                 'Symptom entries are indices into symptom_vocabulary.json.',
        'seed': SEED,
        'per_disease': PER_DISEASE,
        'diseases': int(len(np.unique(y_test))),
        'cases': cases
    }, separators=(',', ':')), encoding='utf-8')

    print(f'{len(cases)} cases across {len(np.unique(y_test))} diseases -> {OUT} '
          f'({OUT.stat().st_size / 1024:.0f} KB)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
