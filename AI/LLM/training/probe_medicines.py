import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
import pandas as pd
from pathlib import Path
RAW = Path(__file__).resolve().parents[1] / 'data' / 'raw'

med = pd.read_csv(RAW / 'medicines' / 'A_Z_medicines_dataset_of_India.csv')
print('columns:', list(med.columns))
print('\nIs there ANY disease / indication / use column?')
hits = [c for c in med.columns if any(k in c.lower() for k in ('disease','indication','use','condition','treat'))]
print('  ->', hits or 'NONE — this maps brand -> composition, not disease -> drug')

dz = pd.read_csv(RAW / 'symptoms' / 'Final_Augmented_dataset_Diseases_and_Symptoms.csv', usecols=['diseases'])
print(f'\nunique diseases in training set: {dz["diseases"].nunique()}')
print('most common:', dz['diseases'].value_counts().head(5).to_dict())
print('rarest count:', dz['diseases'].value_counts().min())
