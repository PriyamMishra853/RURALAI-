"""
Load Kaggle credentials from backend/.env into the environment.

The key lives in the gitignored backend/.env alongside every other secret,
rather than in ~/.kaggle/kaggle.json, so there is exactly one place to rotate
credentials and one file to keep out of git.
"""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
ENV_PATH = ROOT / 'backend' / '.env'


def load_env() -> None:
    if not ENV_PATH.exists():
        raise SystemExit(f'Expected credentials at {ENV_PATH}')
    for line in ENV_PATH.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        os.environ.setdefault(key.strip(), value.strip())

    if not os.environ.get('KAGGLE_KEY'):
        raise SystemExit('KAGGLE_KEY is not set in backend/.env')
