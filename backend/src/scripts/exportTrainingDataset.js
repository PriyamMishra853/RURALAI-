/**
 * Export verified cases as a training dataset (Roadmap v3, Phase 5 / doc 12 P0).
 *
 *   npm run dataset:export -- --purpose "extraction eval" --approved-by "IEC/2026/14" --out ../datasets
 *
 * Deliberately a script and not an endpoint. A route that returns every
 * patient's record in one response is a liability whatever guards sit in front
 * of it, and this is an operation someone should have to decide to run.
 *
 * It refuses to run without a stated purpose and a recorded approval, and
 * refuses to write anywhere git would pick up — the same rule as the database
 * backup, for the same reason.
 *
 * Reads only. Nothing in the database changes.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { supabaseAdmin } from '../config/supabase.js';
import { ageFromDob } from '../services/patientFields.js';
import { isActive } from '../services/consentRules.js';
import { buildManifest, datasheet, deidentifyCase, excludeReason, EXCLUSIONS } from '../services/datasetRules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
};
const flag = (name) => process.argv.includes(name);

const refuseIfCommittable = (dir) => {
  const inside = !path.relative(REPO_ROOT, dir).startsWith('..');
  if (!inside) return;
  const check = spawnSync('git', ['check-ignore', '-q', dir], { cwd: REPO_ROOT });
  if (check.status !== 0) {
    console.error(
      `\nRefusing to write a dataset to ${dir}.\n`
      + 'That path is inside the repository and is not gitignored, so patient-derived\n'
      + 'data could be committed. Choose a directory outside the repository.\n'
    );
    process.exit(1);
  }
};

const first = (v) => (Array.isArray(v) ? v[0] : v) || null;
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

const main = async () => {
  const purpose = arg('--purpose');
  const approvedBy = arg('--approved-by');
  if (!purpose || !approvedBy) {
    console.error(
      '\nA dataset of patient records needs a stated purpose and a recorded approval.\n\n'
      + '  npm run dataset:export -- --purpose "<why>" --approved-by "<ethics ref or name>" --out <dir>\n\n'
      + 'Both are written into the manifest. Ethics committee approval is a hard gate\n'
      + 'for Phase 5 (Roadmap v3); this flag records it, it does not grant it.\n'
    );
    process.exit(1);
  }

  const windowDays = Math.min(3650, Math.max(1, Number(arg('--days', '365'))));
  const districtScope = arg('--district');
  const includeDemo = flag('--include-demo');
  const outDir = path.resolve(arg('--out', path.join(REPO_ROOT, '..', 'ruralai-datasets')));
  refuseIfCommittable(outDir);

  const datasetId = `ds-${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(3).toString('hex')}`;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  // Supabase caps a read at 1000 rows. A dataset silently truncated at a
  // thousand cases would be a quiet lie about what it contains, so this pages.
  const PAGE = 1000;
  const readPage = (from) => {
    let q = supabaseAdmin
    .from('visits')
    .select(`
      id, created_at, district_id, patient_id, is_demo, chief_complaint, symptom_duration_value, symptom_duration_unit,
      medical_history, known_allergies, current_medications, is_pregnant, intake_provenance,
      patients ( patient_uid, date_of_birth, gender ),
      visit_vitals ( temperature_f, blood_pressure_systolic, blood_pressure_diastolic, pulse_bpm,
                     spo2_percent, respiratory_rate, blood_glucose_mgdl, weight_kg, height_cm ),
      doctor_reviews ( clinical_notes, decision, created_at ),
      districts ( name, states ( name ) )
    `)
    .is('deleted_at', null)
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .range(from, from + PAGE - 1);
    if (districtScope) q = q.eq('district_id', districtScope);
    return q;
  };

  const visits = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await readPage(from);
    if (error) {
      console.error('The visits could not be read:', error.message);
      process.exit(2);
    }
    visits.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }

  // Training consent, per patient, read once.
  const { data: consents, error: consentError } = await supabaseAdmin
    .from('patient_consents')
    .select('patient_id, purpose, status, expires_at')
    .eq('purpose', 'training');
  if (consentError) {
    console.error('Consent could not be read, so nothing is exported:', consentError.message);
    process.exit(2);
  }
  const consented = new Set((consents || []).filter((c) => isActive(c)).map((c) => c.patient_id));

  const cases = [];
  const excluded = Object.fromEntries(EXCLUSIONS.map((r) => [r, 0]));
  const patients = new Set();

  for (const visit of visits) {
    const patient = first(visit.patients);
    const review = first(visit.doctor_reviews);
    const reason = excludeReason({
      hasConsent: consented.has(visit.patient_id) || consented.has(patient?.aadhaar_number),
      review,
      isDemo: visit.is_demo,
      includeDemo
    });
    if (reason) { excluded[reason] += 1; continue; }

    const district = first(visit.districts);
    cases.push(deidentifyCase({
      visit: { ...visit, district_name: district?.name, state_name: first(district?.states)?.name },
      patient: { ...patient, age_years: ageFromDob(patient?.date_of_birth) },
      vitals: first(visit.visit_vitals) || {},
      provenance: visit.intake_provenance,
      review,
      datasetId
    }));
    patients.add(patient.patient_uid);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const casesPath = path.join(outDir, `${datasetId}.cases.jsonl`);
  fs.writeFileSync(casesPath, cases.map((c) => JSON.stringify(c)).join('\n') + (cases.length ? '\n' : ''));

  const gitSha = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' });
  const manifest = buildManifest({
    datasetId,
    generatedAt: new Date().toISOString(),
    windowDays,
    includeDemo,
    districtScope,
    purpose,
    approvedBy,
    counts: { cases: cases.length, patients: patients.size, considered: visits.length, excluded },
    files: [{ name: path.basename(casesPath), sha256: sha256(fs.readFileSync(casesPath, 'utf8')), cases: cases.length }],
    codeVersion: gitSha.status === 0 ? gitSha.stdout.trim() : null
  });

  fs.writeFileSync(path.join(outDir, `${datasetId}.manifest.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, `${datasetId}.datasheet.md`), datasheet(manifest));

  console.log(`\n${datasetId}`);
  console.log(`  considered : ${visits.length} visits in the last ${windowDays} days`);
  console.log(`  exported   : ${cases.length} cases from ${patients.size} patients`);
  for (const [reason, n] of Object.entries(excluded)) if (n) console.log(`  excluded   : ${n} — ${reason}`);
  console.log(`  written to : ${outDir}`);
  if (!cases.length) {
    console.log('\nNothing was exported. Every case needs an active training consent and a');
    console.log('doctor review with a diagnosis; the counts above say which was missing.');
  }
  process.exit(0);
};

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
