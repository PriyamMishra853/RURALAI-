#!/usr/bin/env node
/**
 * Merge a real facility source into one state's facility file:
 * up_district_hospitals.json, mh_district_hospitals.json, selected with --dataset.
 *
 * The referral ranking is only as good as this data, and the one thing that
 * would make it dangerous is invented data — a fabricated `blood_bank` sends a
 * haemorrhaging patient to a hospital that cannot transfuse. So this script
 * exists instead of hand-editing, and it enforces the rules the dataset
 * documents:
 *
 *   Every field written carries the source it came from and the date it was
 *   retrieved. A field with no provenance is not written at all.
 *
 *   Absent means null, never a default. A record that does not mention
 *   capabilities leaves capabilities null — it does NOT get an empty array,
 *   because an empty array is a positive claim that the facility has none of
 *   them.
 *
 *   Nothing is overwritten silently. Re-running with a better source reports
 *   every field it changes and what it changed it from.
 *
 * Usage:
 *   node src/scripts/ingestFacilities.js \
 *        --in ./pmjay-up.json \
 *        --source "PM-JAY Hospital Finder, hospitals.pmjay.gov.in" \
 *        --retrieved 2026-09-07 \
 *        [--dataset mh_district_hospitals.json]   (default: up_district_hospitals.json)
 *        [--dry-run]
 *
 * Input is a JSON array. Each entry needs `district` and `name` to match or
 * create a facility; every other key is optional and written only if present:
 *
 *   { "district": "Sultanpur", "name": "Ashirwad Hospital",
 *     "lat": 26.26, "lon": 82.07,
 *     "ownership": "private", "facility_type": "private_multispeciality",
 *     "capabilities": ["obstetric", "blood_bank"],
 *     "pmjay_empanelled": true, "nabh_accredited": false,
 *     "bed_count": 60, "phone": "+915362 200100", "emergency_24x7": true }
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../../AI/LLM/data');

const OWNERSHIP = ['government', 'private', 'trust'];
const FACILITY_TYPES = [
  'district_hospital', 'medical_college', 'chc', 'phc',
  'private_multispeciality', 'private_singlespeciality'
];
const CAPABILITIES = ['trauma', 'obstetric', 'paediatric', 'cardiac', 'icu', 'blood_bank'];

/** Fields this script is allowed to write, with the check each must pass. */
const FIELDS = {
  lat:              (v) => Number.isFinite(v) && v >= 6 && v <= 37.5,
  lon:              (v) => Number.isFinite(v) && v >= 68 && v <= 97.5,
  ownership:        (v) => OWNERSHIP.includes(v),
  facility_type:    (v) => FACILITY_TYPES.includes(v),
  capabilities:     (v) => Array.isArray(v) && v.length > 0 && v.every((c) => CAPABILITIES.includes(c)),
  nabh_accredited:  (v) => typeof v === 'boolean',
  pmjay_empanelled: (v) => typeof v === 'boolean',
  bed_count:        (v) => Number.isInteger(v) && v > 0 && v < 5000,
  phone:            (v) => typeof v === 'string' && /\d{6,}/.test(v.replace(/\D/g, '')),
  emergency_24x7:   (v) => typeof v === 'boolean'
};

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : fallback;
};

const main = () => {
  // One file per state. Uttar Pradesh stays the default, so every existing
  // invocation keeps doing exactly what it did.
  const dataset = arg('dataset', 'up_district_hospitals.json');
  if (!/^[a-z]{2,3}_district_hospitals\.json$/.test(dataset)) {
    console.error(`--dataset must name a state file such as mh_district_hospitals.json, got "${dataset}".`);
    process.exit(1);
  }
  const DATA_PATH = path.join(DATA_DIR, dataset);
  const inPath = arg('in');
  const source = arg('source');
  const retrieved = arg('retrieved');
  const dryRun = process.argv.includes('--dry-run');

  if (!inPath || !source || !retrieved) {
    console.error('Need --in <file> --source "<citation>" --retrieved <YYYY-MM-DD>.');
    console.error('A source and a retrieval date are not optional: a field without provenance is not written.');
    process.exit(1);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(retrieved)) {
    console.error(`--retrieved must be YYYY-MM-DD, got "${retrieved}".`);
    process.exit(1);
  }

  const incoming = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  if (!Array.isArray(incoming)) {
    console.error('Input must be a JSON array of facility records.');
    process.exit(1);
  }

  const db = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const key = (d, n) => `${String(d).trim().toLowerCase()}::${String(n).trim().toLowerCase()}`;
  const index = new Map(db.hospitals.map((h) => [key(h.district, h.name), h]));

  const provenance = { source, retrieved };
  let created = 0, updated = 0, changed = 0, rejected = 0;

  for (const rec of incoming) {
    if (!rec?.district || !rec?.name) {
      console.warn('  skipped: a record has no district or name');
      rejected += 1;
      continue;
    }

    let target = index.get(key(rec.district, rec.name));
    if (!target) {
      target = {
        district: String(rec.district).trim(),
        name: String(rec.name).trim(),
        lat: null, lon: null,
        ownership: null, facility_type: null, capabilities: null,
        nabh_accredited: null, pmjay_empanelled: null,
        bed_count: null, phone: null, emergency_24x7: null,
        sources: {}
      };
      db.hospitals.push(target);
      index.set(key(rec.district, rec.name), target);
      created += 1;
    }

    let touched = false;
    for (const [field, valid] of Object.entries(FIELDS)) {
      if (!(field in rec) || rec[field] == null) continue;   // absent stays null
      if (!valid(rec[field])) {
        console.warn(`  rejected ${target.name} · ${field} = ${JSON.stringify(rec[field])} (failed validation)`);
        rejected += 1;
        continue;
      }
      const before = target[field];
      const after = rec[field];
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        if (before != null) {
          console.log(`  changed ${target.name} · ${field}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
          changed += 1;
        }
        target[field] = after;
      }
      target.sources = target.sources || {};
      target.sources[field] = provenance;
      touched = true;
    }
    if (touched) updated += 1;
  }

  // A facility with no coordinates cannot be routed to and would silently sort
  // last forever. Better to say so now than to have it never appear.
  const uncoordinated = db.hospitals.filter((h) => !Number.isFinite(h.lat) || !Number.isFinite(h.lon));
  if (uncoordinated.length) {
    console.warn(`\n  ${uncoordinated.length} facilities have no coordinates and cannot be ranked:`);
    for (const h of uncoordinated.slice(0, 10)) console.warn(`    ${h.district} · ${h.name}`);
  }

  db._meta.count = db.hospitals.length;
  db._meta.coverage =
    `${db.hospitals.length} facilities. `
    + `${db.hospitals.filter((h) => h.pmjay_empanelled === true).length} confirmed PM-JAY empanelled, `
    + `${db.hospitals.filter((h) => Array.isArray(h.capabilities)).length} with sourced capabilities. `
    + 'Everything else is null and the ranking treats it as unverified, never as absent.';

  console.log(`\n  created ${created}, updated ${updated}, overwrote ${changed}, rejected ${rejected}`);
  console.log(`  total facilities: ${db.hospitals.length}`);

  if (dryRun) {
    console.log('\n  --dry-run: nothing written.');
    return;
  }
  fs.writeFileSync(DATA_PATH, `${JSON.stringify(db, null, 2)}\n`, 'utf8');
  console.log(`  written to ${DATA_PATH}`);
};

main();
