"""
Pipeline 2 — disease to medication.

IMPORTANT DESIGN NOTE, because the plan's original framing does not survive
contact with the data.

The Kaggle dataset (`A_Z_medicines_dataset_of_India.csv`, 253,973 rows) maps
BRAND -> COMPOSITION. It has no disease, indication, or condition column at
all. There is therefore nothing in it from which "which drug treats this
disease" could be learned, and that is the right outcome: a drug-choice model
trained on an uncurated retail catalogue would be both unsafe and unlawful to
put in front of a patient.

So pipeline 2 is split along the line that safety already draws:

  disease -> molecule    stays with backend/src/data/formulary.js, a
                         clinician-signed rule set the LLM never touches.
  molecule -> product    comes from this index: real Indian brands, pack
                         sizes and prices for a molecule the formulary already
                         selected.

The output is an availability and cost lookup, not a recommender. It answers
"the formulary chose paracetamol 500mg — what can this patient actually buy,
and for how much", which is a real question at a village sub-centre and one
the formulary alone cannot answer.
"""
import sys, io, json, re, time
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'data' / 'raw' / 'medicines' / 'A_Z_medicines_dataset_of_India.csv'
PRECAUTIONS = ROOT / 'data' / 'raw' / 'precautions' / 'Disease precaution.csv'
OUT = ROOT / 'data' / 'models'
OUT.mkdir(parents=True, exist_ok=True)

# Molecules the signed formulary can currently emit. The index is built only
# for these: shipping 250k products the formulary can never select would be a
# large file that answers no question the system is allowed to ask.
FORMULARY_MOLECULES = [
    'paracetamol', 'acetaminophen',
    'oral rehydration', 'ors',
    'zinc',
    'sodium chloride',
    'povidone',
]

COMP_RE = re.compile(r'^\s*([A-Za-z][A-Za-z\s\-\'()]*?)\s*\(([^)]+)\)\s*$')


def parse_composition(value):
    """'Amoxycillin  (500mg)' -> ('amoxycillin', '500mg')."""
    if not isinstance(value, str):
        return None, None
    m = COMP_RE.match(value)
    if not m:
        return value.strip().lower() or None, None
    return m.group(1).strip().lower(), m.group(2).strip()


def main() -> None:
    print('Loading medicine catalogue...')
    t0 = time.time()
    df = pd.read_csv(RAW)
    print(f'  {len(df):,} products in {time.time() - t0:.1f}s')

    # Discontinued products are noise in an availability index — the whole
    # point is what a patient can actually get today.
    before = len(df)
    df = df[df['Is_discontinued'].astype(str).str.lower().isin(['false', '0', 'nan'])]
    df = df[df['type'].astype(str).str.lower() == 'allopathy']
    print(f'  {len(df):,} in-market allopathy products ({before - len(df):,} filtered out)')

    parsed = df['short_composition1'].apply(parse_composition)
    df = df.assign(
        molecule=[p[0] for p in parsed],
        strength=[p[1] for p in parsed]
    )
    df = df[df['molecule'].notna()]

    print(f'\nDistinct molecules in catalogue: {df["molecule"].nunique():,}')

    index = {}
    for key in FORMULARY_MOLECULES:
        hits = df[df['molecule'].str.contains(key, na=False, regex=False)]
        if hits.empty:
            print(f'  {key:<20} no products found')
            continue

        # Cheapest first: at a sub-centre, price is the deciding factor between
        # two products of the same molecule and strength.
        by_strength = {}
        for strength, grp in hits.groupby('strength', dropna=True):
            grp = grp.sort_values('price(₹)')
            by_strength[str(strength)] = {
                'product_count': int(len(grp)),
                'price_min': round(float(grp['price(₹)'].min()), 2),
                'price_median': round(float(grp['price(₹)'].median()), 2),
                'examples': [
                    {
                        'name': r['name'],
                        'price_inr': round(float(r['price(₹)']), 2),
                        'pack': r['pack_size_label'],
                        'manufacturer': r['manufacturer_name']
                    }
                    for _, r in grp.head(3).iterrows()
                ]
            }

        index[key] = {
            'molecule': key,
            'total_products': int(len(hits)),
            'strengths': dict(sorted(by_strength.items(), key=lambda kv: -kv[1]['product_count'])[:6])
        }
        print(f'  {key:<20} {len(hits):>6,} products across {len(by_strength)} strengths')

    (OUT / 'medicine_index.json').write_text(json.dumps(index, indent=2, ensure_ascii=False), encoding='utf-8')

    # ---- Precautions, keyed by disease ----
    pre = pd.read_csv(PRECAUTIONS)
    precautions = {}
    for _, row in pre.iterrows():
        disease = str(row['Disease']).strip().lower()
        items = [str(row[c]).strip() for c in ('Precaution_1', 'Precaution_2', 'Precaution_3', 'Precaution_4')
                 if isinstance(row.get(c), str) and str(row[c]).strip().lower() != 'nan']
        if items:
            precautions[disease] = items
    (OUT / 'precautions.json').write_text(json.dumps(precautions, indent=2), encoding='utf-8')

    print(f'\nPrecautions: {len(precautions)} diseases')
    print(f'\nWritten to {OUT}:')
    for f in ('medicine_index.json', 'precautions.json'):
        p = OUT / f
        print(f'  {f:<24} {p.stat().st_size/1024:.1f} KB')

    print('\nNOTE: this index says what is AVAILABLE for a molecule, never which')
    print('molecule to give. That decision stays in the signed formulary.')


if __name__ == '__main__':
    main()
