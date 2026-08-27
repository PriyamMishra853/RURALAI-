import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
import pandas as pd
from pathlib import Path

RAW = Path(__file__).resolve().parents[1] / 'data' / 'raw'

print('=' * 70)
print('1. DISEASE-SYMPTOM (pipeline 1 training set)')
print('=' * 70)
p = RAW / 'symptoms' / 'Final_Augmented_dataset_Diseases_and_Symptoms.csv'
df = pd.read_csv(p, nrows=5)
full_rows = sum(1 for _ in open(p, encoding='utf-8', errors='replace')) - 1
print(f'rows: {full_rows:,} | columns: {df.shape[1]}')
print(f'label column: {df.columns[0]!r}')
print(f'first 8 symptom columns: {list(df.columns[1:9])}')
print(f'value range in symptom cols: {sorted(set(df.iloc[:, 1:20].values.ravel()))[:6]}')

print()
print('=' * 70)
print('2. PRECAUTIONS')
print('=' * 70)
pre = pd.read_csv(RAW / 'precautions' / 'Disease precaution.csv')
print(f'rows: {len(pre)} | columns: {list(pre.columns)}')
print(pre.head(3).to_string(index=False, max_colwidth=28))

print()
print('=' * 70)
print('3. MEDICINES (pipeline 2)')
print('=' * 70)
med = pd.read_csv(RAW / 'medicines' / 'A_Z_medicines_dataset_of_India.csv', nrows=5)
med_rows = sum(1 for _ in open(RAW / 'medicines' / 'A_Z_medicines_dataset_of_India.csv', encoding='utf-8', errors='replace')) - 1
print(f'rows: {med_rows:,} | columns: {list(med.columns)}')
print(med.head(3).to_string(index=False, max_colwidth=26))
