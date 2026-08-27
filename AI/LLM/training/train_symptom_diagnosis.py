"""
Pipeline 1 — symptoms to candidate diseases.

Trains on the augmented disease-symptom dataset: 246,945 rows, 377 binary
symptom flags, 773 disease labels.

Model choice: Bernoulli Naive Bayes.

  Why not KNN, which the original plan named. KNN over 246k x 377 keeps the
  entire training matrix in memory (~93M values) and scans it on every single
  prediction. Bernoulli NB is the textbook fit for binary presence/absence
  features, trains in seconds, predicts in microseconds, and — the part that
  matters clinically — returns calibrated per-class probabilities, so
  "we do not have a confident match" is expressible. KNN gives a distance that
  is hard to reason about at this dimensionality.

  A centroid/Jaccard similarity model is also fitted and compared, because a
  single number from one model is not evidence that the model is any good.

Rare classes are dropped before training. 773 labels includes diseases with a
single example; a class you have seen once cannot be learned and cannot be
evaluated, and leaving it in inflates the apparent label coverage while
producing predictions nobody should trust.
"""
import sys, io, json, time
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import numpy as np
import pandas as pd
from scipy import sparse
from sklearn.model_selection import train_test_split
from sklearn.naive_bayes import BernoulliNB
from sklearn.metrics import accuracy_score, top_k_accuracy_score
import joblib

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'data' / 'raw' / 'symptoms' / 'Final_Augmented_dataset_Diseases_and_Symptoms.csv'
OUT = ROOT / 'data' / 'models'
OUT.mkdir(parents=True, exist_ok=True)

# A label needs enough examples to be learned AND to be evaluated on a held-out
# split. Below this the model is guessing and the accuracy figure is noise.
MIN_SAMPLES_PER_DISEASE = 30
TEST_SIZE = 0.2
SEED = 42


def main() -> None:
    print('Loading dataset...')
    t0 = time.time()
    df = pd.read_csv(RAW)
    print(f'  {df.shape[0]:,} rows x {df.shape[1]} columns in {time.time() - t0:.1f}s')

    label_col = df.columns[0]
    symptom_cols = list(df.columns[1:])

    counts = df[label_col].value_counts()
    keep = counts[counts >= MIN_SAMPLES_PER_DISEASE].index
    dropped = counts[counts < MIN_SAMPLES_PER_DISEASE]

    print(f'\nLabel filtering (>= {MIN_SAMPLES_PER_DISEASE} examples):')
    print(f'  kept    {len(keep)} diseases  ({df[label_col].isin(keep).sum():,} rows)')
    print(f'  dropped {len(dropped)} diseases ({dropped.sum():,} rows) — too few examples to learn or evaluate')

    df = df[df[label_col].isin(keep)]

    # Sparse, not dense. The symptom matrix is ~97% zeros, and scikit-learn's
    # Bernoulli NB internally computes Y.T @ X — on a dense int array that
    # promotes to int64 and asks for 564 MB, which is where this fell over.
    # CSR keeps it to a few tens of MB and is faster besides.
    dense = df[symptom_cols].to_numpy(dtype=np.int8)
    X = sparse.csr_matrix(dense, dtype=np.float32)
    density = X.nnz / (X.shape[0] * X.shape[1])
    print(f'  matrix density: {density:.1%} non-zero ({X.nnz:,} set flags)')
    del dense
    y = df[label_col].to_numpy()

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=TEST_SIZE, random_state=SEED, stratify=y
    )
    print(f'\nSplit: {X_train.shape[0]:,} train / {X_test.shape[0]:,} test')

    # ---- Bernoulli NB ----
    print('\nTraining Bernoulli Naive Bayes...')
    t0 = time.time()
    nb = BernoulliNB(alpha=1.0)
    # Minibatch, not a single fit(). scikit-learn's fit() builds a dense
    # one-hot label matrix internally — 582 classes x 196k rows promoted to
    # int64 is 870 MB, which this machine cannot allocate. partial_fit
    # accumulates the same per-class feature counts a chunk at a time, so peak
    # memory is set by the chunk size rather than the corpus size. The fitted
    # model is mathematically identical.
    all_classes = np.unique(y_train)
    CHUNK = 15_000
    n_chunks = (X_train.shape[0] + CHUNK - 1) // CHUNK
    for ci in range(n_chunks):
        lo, hi = ci * CHUNK, min((ci + 1) * CHUNK, X_train.shape[0])
        nb.partial_fit(X_train[lo:hi], y_train[lo:hi], classes=all_classes)
        if (ci + 1) % 4 == 0 or ci == n_chunks - 1:
            print(f'  chunk {ci + 1}/{n_chunks}')
    print(f'  trained in {time.time() - t0:.1f}s')

    classes = nb.classes_
    proba = np.vstack([
        nb.predict_proba(X_test[i:i + 10_000]) for i in range(0, X_test.shape[0], 10_000)
    ])
    top1 = accuracy_score(y_test, classes[proba.argmax(axis=1)])
    top3 = top_k_accuracy_score(y_test, proba, k=3, labels=classes)
    top5 = top_k_accuracy_score(y_test, proba, k=5, labels=classes)

    print('\nHeld-out accuracy (Bernoulli NB):')
    print(f'  top-1  {top1:.3f}')
    print(f'  top-3  {top3:.3f}')
    print(f'  top-5  {top5:.3f}')

    # ---- Centroid baseline ----
    # The orchestrator only ever uses the top-5 candidate list, so top-5 is the
    # number that actually matters; a baseline keeps the NB figure honest.
    print('\nBaseline — per-disease symptom centroid, cosine similarity:')
    labels = np.unique(y_train)
    # .mean on a sparse slice returns np.matrix; ravel it back to 1-D.
    centroids = np.vstack([np.asarray(X_train[y_train == c].mean(axis=0)).ravel() for c in labels])
    cn = centroids / (np.linalg.norm(centroids, axis=1, keepdims=True) + 1e-9)
    sims_parts = []
    for i in range(0, X_test.shape[0], 10_000):
        blk = np.asarray(X_test[i:i + 10_000].todense(), dtype=np.float32)
        blk /= (np.linalg.norm(blk, axis=1, keepdims=True) + 1e-9)
        sims_parts.append(blk @ cn.T)
    sims = np.vstack(sims_parts)
    base_top1 = accuracy_score(y_test, labels[sims.argmax(axis=1)])
    base_top5 = top_k_accuracy_score(y_test, sims, k=5, labels=labels)
    print(f'  top-1  {base_top1:.3f}')
    print(f'  top-5  {base_top5:.3f}')

    winner = 'bernoulli_nb' if top5 >= base_top5 else 'centroid'
    print(f'\nSelected: {winner}')

    # ---- Export ----
    joblib.dump(nb, OUT / 'symptom_nb.joblib')
    np.save(OUT / 'centroids.npy', centroids)

    meta = {
        'model': 'bernoulli_nb',
        'trained_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'rows_total': int(counts.sum()),
        'rows_used': int(X.shape[0]),
        'diseases_total': int(len(counts)),
        'diseases_kept': int(len(keep)),
        'min_samples_per_disease': MIN_SAMPLES_PER_DISEASE,
        'symptom_count': len(symptom_cols),
        'metrics': {
            'bernoulli_nb': {'top1': round(float(top1), 4), 'top3': round(float(top3), 4), 'top5': round(float(top5), 4)},
            'centroid_baseline': {'top1': round(float(base_top1), 4), 'top5': round(float(base_top5), 4)}
        },
        'selected': winner
    }
    (OUT / 'symptom_model_meta.json').write_text(json.dumps(meta, indent=2), encoding='utf-8')

    # The vocabulary is what the fuzzy matcher maps free text onto, so it ships
    # with the model rather than being re-derived at runtime.
    (OUT / 'symptom_vocabulary.json').write_text(
        json.dumps({'symptoms': symptom_cols, 'diseases': sorted(keep.tolist())}, indent=0),
        encoding='utf-8'
    )

    print(f'\nWritten to {OUT}:')
    for f in sorted(OUT.iterdir()):
        print(f'  {f.name:<28} {f.stat().st_size/1e6:.2f} MB')


if __name__ == '__main__':
    main()
