"""
Download the training datasets from Kaggle.

Datasets are NOT committed — AI/LLM/data/raw/ is gitignored. Re-run this on a
fresh clone to rebuild them.
"""
import sys, io, zipfile
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

from _env import load_env
load_env()

from kaggle.api.kaggle_api_extended import KaggleApi

RAW = Path(__file__).resolve().parents[1] / 'data' / 'raw'
RAW.mkdir(parents=True, exist_ok=True)

DATASETS = [
    # Pipeline 1: symptoms -> disease. ~250 diseases as binary symptom vectors.
    ('dhivyeshrk/diseases-and-symptoms-dataset', 'symptoms'),
    # Precautions per disease, used for the LOW-tier precaution list.
    ('choongqianzheng/disease-and-symptoms-dataset', 'precautions'),
    # Pipeline 2: disease -> medication. Indian formulary context.
    ('shudhanshusingh/az-medicine-dataset-of-india', 'medicines'),
]

api = KaggleApi()
api.authenticate()
print('Kaggle authenticated.\n')

for ref, folder in DATASETS:
    target = RAW / folder
    target.mkdir(parents=True, exist_ok=True)
    if any(target.iterdir()):
        print(f'{folder:<12} already present, skipping')
        continue
    print(f'{folder:<12} downloading {ref} ...')
    try:
        api.dataset_download_files(ref, path=str(target), unzip=True, quiet=True)
        files = sorted(p.name for p in target.rglob('*') if p.is_file())
        total = sum(p.stat().st_size for p in target.rglob('*') if p.is_file())
        print(f'{folder:<12} {len(files)} file(s), {total/1e6:.1f} MB')
        for f in files[:6]:
            print(f'               - {f}')
    except Exception as e:
        print(f'{folder:<12} FAILED: {e}')
