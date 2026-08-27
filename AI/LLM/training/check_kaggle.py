"""Confirm the Kaggle credentials work before anything tries to download."""
from _env import load_env
load_env()

from kaggle.api.kaggle_api_extended import KaggleApi

api = KaggleApi()
api.authenticate()
print('Kaggle authentication: OK')

for query in ['diseases and symptoms', 'medicine']:
    print(f'\n--- search: {query} ---')
    for ds in api.dataset_list(search=query, max_size=200_000_000)[:6]:
        print(f'  {ds.ref:<60} {ds.title[:44]}')
