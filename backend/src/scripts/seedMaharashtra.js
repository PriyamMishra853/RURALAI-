#!/usr/bin/env node
/**
 * Maharashtra demo seed — additive, and scoped to Maharashtra alone.
 *
 * The problem statement this platform is presented against comes from the
 * Government of Maharashtra, and the only seeded state was Uttar Pradesh. The
 * architecture never cared which state it served — every clinical row is scoped
 * by district_id — but a demonstration can only show a state that has data.
 *
 * ── Why this is not a change to seedV2 ─────────────────────────────────────
 *
 * seedV2 deletes EVERY demo staff profile, patient, visit and Auth user, then
 * rebuilds them with emails generated from a counter. Adding Maharashtra there
 * would mean adding it by first destroying Uttar Pradesh — including the demo
 * logins somebody is about to present with. This script reads, deletes and
 * renumbers nothing outside Maharashtra, and it checks that claim: Uttar
 * Pradesh row counts are taken before and after, and a difference is reported.
 *
 * ── Collision-proof by construction ────────────────────────────────────────
 *
 *   Aadhaar        08…            UP demo patients are 00…. Both non-issuable:
 *                                 a real Aadhaar never begins with 0 or 1.
 *   Emails         x.y.mhdoc12@   UP accounts are x.y.doc12@
 *   Registration   MMC/000001     Maharashtra Medical Council; UP is UPMC/…
 *   Visit codes    VIS-MH-000001
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *
 *   npm run seed:maharashtra -- --dry-run
 *       Build everything in memory and check it against the database
 *       constraints. Touches nothing.
 *
 *   npm run seed:maharashtra -- --confirm
 *       Add Maharashtra. Declines if it is already there.
 *
 *   npm run seed:maharashtra -- --confirm --replace
 *       Rebuild Maharashtra's demo data only.
 *
 * A full `npm run seed -- --confirm` removes every demo row, Maharashtra's
 * included. Run this afterwards to put Maharashtra back.
 */
import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeClient, bulkInsert } from './lib/db.js';
import { supabaseAdmin } from '../config/supabase.js';
import {
  SPECIALIZATIONS, QUALIFICATIONS, CHIEF_COMPLAINTS, SYMPTOM_DURATIONS
} from '../data/indianNames.js';
import {
  MH_STATE_CODE, MH_DISTRICTS, MH_SHOWCASE_DISTRICTS,
  MH_MALE_FIRST_NAMES, MH_FEMALE_FIRST_NAMES, MH_SURNAMES,
  MH_VILLAGE_SUFFIXES, MH_LANDMARKS, MH_LANGUAGES
} from '../data/maharashtra.js';

// Same density as Uttar Pradesh, so the two states compare like for like.
const DOCTORS_PER_DISTRICT = 5;
const ASSISTANTS_PER_DISTRICT = 1;
const PATIENTS_PER_DOCTOR = 5;

const DEMO_PASSWORD = process.env.DEMO_ACCOUNT_PASSWORD || 'Demo@Clinic2026';
const EMAIL_DOMAIN = 'vvc-demo.example.com';
const MH_EMAIL = /\.mh(doc|asst|dadmin|sadmin)\d+@vvc-demo\.example\.com$/i;

const argv = new Set(process.argv.slice(2));
const DRY_RUN = argv.has('--dry-run');
const CONFIRMED = argv.has('--confirm') || process.env.SEED_CONFIRM === 'yes';
const REPLACE = argv.has('--replace');

// ---------------------------------------------------------------------------
// Deterministic, and seeded differently from UP so the two states do not
// generate the same sequence of people.
// ---------------------------------------------------------------------------
let rngState = 0x4d482026;
const rnd = () => {
  rngState ^= rngState << 13; rngState ^= rngState >>> 17; rngState ^= rngState << 5;
  return ((rngState >>> 0) % 1_000_000) / 1_000_000;
};
const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];
const intBetween = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

let aadhaarCounter = 0;
const nextAadhaar = () => `08${String(++aadhaarCounter).padStart(10, '0')}`;

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
let emailCounter = 0;
const makeEmail = (first, last, tag) =>
  `${slug(first)}.${slug(last)}.mh${tag}${++emailCounter}@${EMAIL_DOMAIN}`;

const personName = (gender) => ({
  first: gender === 'female' ? pick(MH_FEMALE_FIRST_NAMES) : pick(MH_MALE_FIRST_NAMES),
  last: pick(MH_SURNAMES)
});

const mobile = () => `${pick(['6', '7', '8', '9'])}${intBetween(100000000, 999999999)}`.slice(0, 10);

// ---------------------------------------------------------------------------
// Supabase Auth
// ---------------------------------------------------------------------------
const createAuthUsers = async (accounts, concurrency = 10) => {
  const ids = new Map();
  const failures = [];
  const queue = [...accounts];
  let done = 0;

  const worker = async () => {
    while (queue.length) {
      const acc = queue.shift();
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email: acc.email,
        password: DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: acc.full_name, seeded: true, state: MH_STATE_CODE }
      });
      if (error) failures.push(`${acc.email}: ${error.message}`);
      else ids.set(acc.email, data.user.id);
      done += 1;
      if (done % 25 === 0 || done === accounts.length) {
        process.stdout.write(`\r   auth users: ${done}/${accounts.length} (${failures.length} failed)`);
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
  process.stdout.write('\n');
  return { ids, failures };
};

/** Every Auth user, collected before anything is deleted so paging cannot skip rows. */
const listAuthUsers = async () => {
  const users = [];
  for (let page = 1; page <= 60; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Could not list Auth users: ${error.message}`);
    if (!data?.users?.length) break;
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return users;
};

const deleteAuthUsers = async (ids) => {
  let removed = 0;
  for (const id of ids) {
    const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
    if (!error) removed += 1;
  }
  return removed;
};

const maharashtraAuthIds = async () =>
  (await listAuthUsers()).filter((u) => MH_EMAIL.test(u.email || '')).map((u) => u.id);

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------
const build = (stateId, districts) => {
  const staff = [];
  const doctorMeta = [];
  let regCounter = 0;

  for (const district of districts) {
    for (let i = 0; i < DOCTORS_PER_DISTRICT; i += 1) {
      const { first, last } = personName(rnd() < 0.4 ? 'female' : 'male');
      const spec = pick(SPECIALIZATIONS);
      const id = crypto.randomUUID();
      staff.push({
        id, full_name: `Dr. ${first} ${last}`, email: makeEmail(first, last, 'doc'),
        role: 'doctor', state_id: stateId, district_id: district.id, district: district.name,
        phone: mobile(), preferred_language: pick(MH_LANGUAGES)
      });
      doctorMeta.push([
        id, `MMC/${String(++regCounter).padStart(6, '0')}`,
        spec, pick(QUALIFICATIONS[spec]), intBetween(2, 30)
      ]);
    }
    for (let i = 0; i < ASSISTANTS_PER_DISTRICT; i += 1) {
      const { first, last } = personName(rnd() < 0.6 ? 'female' : 'male');
      staff.push({
        id: crypto.randomUUID(), full_name: `${first} ${last}`, email: makeEmail(first, last, 'asst'),
        role: 'clinic_assistant', state_id: stateId, district_id: district.id, district: district.name,
        phone: mobile(), preferred_language: pick(MH_LANGUAGES)
      });
    }
  }

  for (const name of MH_SHOWCASE_DISTRICTS) {
    const district = districts.find((d) => d.name === name);
    if (!district) continue;
    const { first, last } = personName(rnd() < 0.5 ? 'female' : 'male');
    staff.push({
      id: crypto.randomUUID(), full_name: `${first} ${last}`, email: makeEmail(first, last, 'dadmin'),
      role: 'district_admin', state_id: stateId, district_id: district.id, district: district.name,
      phone: mobile(), preferred_language: 'Marathi'
    });
  }
  {
    const { first, last } = personName('female');
    staff.push({
      id: crypto.randomUUID(), full_name: `${first} ${last}`, email: makeEmail(first, last, 'sadmin'),
      role: 'state_admin', state_id: stateId, district_id: null, district: null,
      phone: mobile(), preferred_language: 'Marathi'
    });
  }

  const doctors = staff.filter((s) => s.role === 'doctor');

  // All hours, every day — the same window seedV2 writes, and for the same
  // reason: a demonstration does not stop at five o'clock, and a missing
  // schedule row makes a correct scheduler report every doctor as off.
  const scheduleRows = [];
  for (const d of doctors) {
    for (let day = 0; day <= 6; day += 1) scheduleRows.push([d.id, day, '00:00:00', '23:45:00', false]);
  }

  const assistantBy = new Map(
    staff.filter((s) => s.role === 'clinic_assistant').map((a) => [a.district_id, a.id])
  );
  const RISK_TIERS = ['low', 'low', 'low', 'moderate', 'moderate', 'high', 'emergency'];
  const patientRows = [];
  const visitRows = [];
  const symptomRows = [];
  const vitalRows = [];
  let visitSeq = 0;
  const now = Date.now();
  const istNow = new Date(now + 5.5 * 3600 * 1000);

  for (const doc of doctors) {
    const district = districts.find((d) => d.id === doc.district_id);
    const assistantId = assistantBy.get(doc.district_id) || null;

    for (let i = 0; i < PATIENTS_PER_DOCTOR; i += 1) {
      const gender = rnd() < 0.5 ? 'female' : 'male';
      const { first, last } = personName(gender);
      const aadhaar = nextAadhaar();
      const age = intBetween(1, 88);
      // Date of birth, not age: age is derived at read time.
      const dob = new Date(Date.UTC(
        new Date(now).getUTCFullYear() - age, intBetween(0, 11), intBetween(1, 28)
      )).toISOString().slice(0, 10);

      patientRows.push([
        aadhaar, `${first} ${last}`, gender, dob,
        `${district.name} ${pick(MH_VILLAGE_SUFFIXES)}`,
        rnd() < 0.5 ? `Near ${pick(MH_LANDMARKS)}` : null,
        district.name, stateId,
        String(Math.min(district.pin + intBetween(0, 20), 445999)),
        mobile(), 'standard',
        district.id, stateId, assistantId, true
      ]);

      // Spread across the last 7 days including today, in IST clinic hours —
      // but never in the future, which a queue sorted by arrival would show
      // as a patient who has not come in yet.
      let created = new Date(Date.UTC(
        istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() - intBetween(0, 6),
        intBetween(8, 17) - 5, intBetween(0, 59)
      ));
      if (created.getTime() > now) created = new Date(now - intBetween(5, 90) * 60 * 1000);

      const risk = pick(RISK_TIERS);
      // One complaint per visit, used for both the visit and its symptom row,
      // so the case does not contradict itself.
      const complaint = pick(CHIEF_COMPLAINTS);
      const visitId = crypto.randomUUID();

      visitRows.push([
        visitId, `VIS-MH-${String(++visitSeq).padStart(6, '0')}`, aadhaar,
        assistantId, doc.id, created.toISOString(), doc.district_id,
        complaint, pick(SYMPTOM_DURATIONS),
        risk === 'low' ? 'completed' : 'awaiting_doctor', risk,
        created.toISOString(), true
      ]);
      symptomRows.push([visitId, complaint, 'speech']);
      vitalRows.push([
        visitId, (96 + rnd() * 8).toFixed(1),
        intBetween(95, 165), intBetween(60, 105), intBetween(58, 130),
        intBetween(88, 100), intBetween(12, 30), assistantId
      ]);
    }
  }

  return { staff, doctorMeta, scheduleRows, patientRows, visitRows, symptomRows, vitalRows };
};

/**
 * The database constraints, checked before anything reaches the database.
 *
 * A failed bulk insert halfway through a production seed leaves Auth users
 * with no profiles behind them. Catching a bad PIN or a duplicate code here
 * costs nothing.
 */
const validate = (b) => {
  const problems = [];
  const duplicates = (values, label) => {
    const seen = new Set();
    for (const v of values) {
      if (seen.has(v)) { problems.push(`duplicate ${label}: ${v}`); return; }
      seen.add(v);
    }
  };
  duplicates(b.staff.map((s) => s.email), 'email');
  duplicates(b.patientRows.map((p) => p[0]), 'Aadhaar');
  duplicates(b.visitRows.map((v) => v[1]), 'visit code');
  duplicates(b.doctorMeta.map((d) => d[1]), 'registration number');

  for (const s of b.staff) {
    if (!MH_EMAIL.test(s.email)) problems.push(`email outside the Maharashtra pattern: ${s.email}`);
    const needsDistrict = ['doctor', 'clinic_assistant', 'district_admin'].includes(s.role);
    if (needsDistrict !== Boolean(s.district_id)) problems.push(`role/scope mismatch: ${s.email}`);
  }
  for (const p of b.patientRows) {
    if (!/^08[0-9]{10}$/.test(p[0])) problems.push(`Aadhaar outside the 08 range: ${p[0]}`);
    if (String(p[1]).trim().length < 2) problems.push(`name too short: ${p[1]}`);
    if (!/^4[0-9]{5}$/.test(p[8])) problems.push(`PIN outside Maharashtra: ${p[8]}`);
    if (!/^[6-9][0-9]{9}$/.test(p[9])) problems.push(`mobile: ${p[9]}`);
  }
  for (const v of b.visitRows) {
    if (v[1].length > 30) problems.push(`visit code longer than 30: ${v[1]}`);
  }
  return problems;
};

const counts = (b) => ({
  doctors: b.staff.filter((s) => s.role === 'doctor').length,
  assistants: b.staff.filter((s) => s.role === 'clinic_assistant').length,
  districtAdmins: b.staff.filter((s) => s.role === 'district_admin').length,
  stateAdmins: b.staff.filter((s) => s.role === 'state_admin').length,
  patients: b.patientRows.length,
  visits: b.visitRows.length,
  schedules: b.scheduleRows.length
});

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

/** Maharashtra's demo rows and nothing else, in foreign-key order. */
const clearMaharashtra = async (client, stateId) => {
  const mhStaff = 'SELECT id FROM staff_profiles WHERE is_demo AND state_id = $1';
  await client.query('BEGIN');
  try {
    // consultations.doctor_id is ON DELETE RESTRICT — cleared first, by staff,
    // because a consultation booked through the API hangs off a visit that is
    // not flagged as demo and cannot be reached by cascade.
    await client.query(
      `DELETE FROM consultations WHERE doctor_id IN (${mhStaff}) OR assistant_id IN (${mhStaff})`, [stateId]);
    await client.query(`DELETE FROM doctor_reviews WHERE doctor_id IN (${mhStaff})`, [stateId]);
    await client.query(`DELETE FROM prescriptions WHERE doctor_id IN (${mhStaff})`, [stateId]);
    await client.query(`DELETE FROM audit_logs WHERE actor_id IN (${mhStaff})`, [stateId]);
    await client.query(
      'DELETE FROM visits WHERE is_demo AND district_id IN (SELECT id FROM districts WHERE state_id = $1)', [stateId]);
    await client.query('DELETE FROM patients WHERE is_demo AND clinic_state_id = $1', [stateId]);
    await client.query(
      `DELETE FROM staff_profiles WHERE is_demo AND state_id = $1 AND role <> 'super_admin'`, [stateId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
  const removed = await deleteAuthUsers(await maharashtraAuthIds());
  console.log(`   cleared Maharashtra demo rows and ${removed} Auth users`);
};

const upCounts = async (client) => (await client.query(`
  SELECT
    (SELECT count(*)::int FROM staff_profiles s JOIN states st ON st.id = s.state_id
      WHERE s.is_demo AND st.code = 'UP') AS staff,
    (SELECT count(*)::int FROM patients p JOIN states st ON st.id = p.clinic_state_id
      WHERE p.is_demo AND st.code = 'UP') AS patients,
    (SELECT count(*)::int FROM visits v JOIN districts d ON d.id = v.district_id
      JOIN states st ON st.id = d.state_id WHERE v.is_demo AND st.code = 'UP') AS visits`)).rows[0];

const maharashtraCounts = async (client, stateId) => (await client.query(`
  SELECT
    (SELECT count(*)::int FROM districts WHERE state_id = $1) AS districts,
    (SELECT count(*)::int FROM staff_profiles WHERE is_demo AND state_id = $1 AND role = 'doctor') AS doctors,
    (SELECT count(*)::int FROM staff_profiles WHERE is_demo AND state_id = $1 AND role = 'clinic_assistant') AS assistants,
    (SELECT count(*)::int FROM staff_profiles WHERE is_demo AND state_id = $1 AND role IN ('district_admin','state_admin')) AS admins,
    (SELECT count(*)::int FROM patients WHERE is_demo AND clinic_state_id = $1) AS patients,
    (SELECT count(*)::int FROM visits v JOIN districts d ON d.id = v.district_id
      WHERE v.is_demo AND d.state_id = $1) AS visits,
    (SELECT count(*)::int FROM doctor_schedules sc JOIN staff_profiles p ON p.id = sc.doctor_id
      WHERE p.state_id = $1) AS schedules`, [stateId])).rows[0];

const writeCredentials = (b, authIds) => {
  const usable = (s) => s && authIds.has(s.email);
  const pairs = [];
  for (const name of MH_SHOWCASE_DISTRICTS) {
    const assistant = b.staff.find((s) => s.role === 'clinic_assistant' && s.district === name && usable(s));
    const doctor = b.staff.find((s) => s.role === 'doctor' && s.district === name && usable(s));
    if (assistant && doctor) pairs.push({ name, assistant, doctor });
  }
  const admins = b.staff.filter((s) => ['district_admin', 'state_admin'].includes(s.role) && usable(s));

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const credPath = path.resolve(__dirname, '../../../database/v2/DEMO_CREDENTIALS_MH.md');
  fs.writeFileSync(credPath, `# Maharashtra demo credentials

Generated by \`npm run seed:maharashtra\`. Gitignored — it lists working
sign-ins for the seeded Maharashtra demo accounts.

Shared password for every account below: \`${DEMO_PASSWORD}\`

## Assistant and doctor pairs

Case handoff and consultations are district-scoped, so a demonstration needs an
assistant and a doctor from the **same** district. Each row below works together.

| District | Clinic Assistant | Doctor |
| :--- | :--- | :--- |
${pairs.map((p) => `| ${p.name} | \`${p.assistant.email}\` | \`${p.doctor.email}\` |`).join('\n')}

## Administrators

| Role | Scope | Email |
| :--- | :--- | :--- |
${admins.map((a) => `| ${a.role === 'state_admin' ? 'State Admin' : 'District Admin'} | ${a.district || 'Maharashtra'} | \`${a.email}\` |`).join('\n')}
`);
  return { credPath, pairs };
};

// ---------------------------------------------------------------------------

const main = async () => {
  if (DRY_RUN) {
    const districts = MH_DISTRICTS.map((d) => ({ id: crypto.randomUUID(), name: d.name, pin: d.pin }));
    const built = build(crypto.randomUUID(), districts);
    const problems = validate(built);
    const c = counts(built);
    console.log(`
Maharashtra seed — DRY RUN (nothing written)

  Districts           ${districts.length}
  Doctors             ${c.doctors}   (${DOCTORS_PER_DISTRICT} per district)
  Clinic assistants   ${c.assistants}
  District admins     ${c.districtAdmins}   (${MH_SHOWCASE_DISTRICTS.join(', ')})
  State admins        ${c.stateAdmins}
  Patients            ${c.patients}   (${PATIENTS_PER_DOCTOR} per doctor)
  Visits              ${c.visits}
  Schedule rows       ${c.schedules}

  Sample doctor       ${built.staff.find((s) => s.role === 'doctor').email}
  Sample patient      ${built.patientRows[0][1]} · Aadhaar ${built.patientRows[0][0]} · PIN ${built.patientRows[0][8]}
  Sample visit        ${built.visitRows[0][1]}

  Constraint check    ${problems.length ? `${problems.length} PROBLEM(S)` : 'all rows pass'}
${problems.slice(0, 10).map((p) => `    - ${p}`).join('\n')}`);
    if (problems.length) process.exit(1);
    return;
  }

  const client = makeClient();
  await client.connect();
  let createdAuthIds = [];

  try {
    const { rows: [mh] } = await client.query('SELECT id FROM states WHERE code = $1', [MH_STATE_CODE]);
    if (!mh) throw new Error(`No '${MH_STATE_CODE}' row in states. The base schema must be applied first.`);

    const upBefore = await upCounts(client);
    const { rows: [{ n: existing }] } = await client.query(
      'SELECT count(*)::int AS n FROM staff_profiles WHERE is_demo AND state_id = $1', [mh.id]);

    if (existing && !REPLACE) {
      console.log(`
Maharashtra already has ${existing} demo staff accounts. Nothing was changed.

To rebuild Maharashtra's demo data (and only Maharashtra's):
  npm run seed:maharashtra -- --confirm --replace
`);
      return;
    }

    console.log('1. Preparing');
    if (existing) {
      await clearMaharashtra(client, mh.id);
    } else {
      // No Maharashtra staff, so any Maharashtra-pattern Auth user is an orphan
      // from an earlier run that failed partway. Emails are deterministic, so
      // an orphan would collide with the account about to be created.
      const orphans = await maharashtraAuthIds();
      if (orphans.length) {
        const removed = await deleteAuthUsers(orphans);
        console.log(`   removed ${removed} orphaned Maharashtra Auth users from an earlier run`);
      }
    }

    // Districts are reference data, not demo data: added if absent, never deleted.
    for (const d of MH_DISTRICTS) {
      await client.query(
        'INSERT INTO districts (state_id, name) VALUES ($1, $2) ON CONFLICT (state_id, name) DO NOTHING',
        [mh.id, d.name]);
    }
    const { rows: districtRows } = await client.query(
      'SELECT id, name FROM districts WHERE state_id = $1', [mh.id]);
    const idByName = new Map(districtRows.map((r) => [r.name, r.id]));
    const districts = MH_DISTRICTS.map((d) => ({ id: idByName.get(d.name), name: d.name, pin: d.pin }));
    const unmatched = districts.filter((d) => !d.id).map((d) => d.name);
    if (unmatched.length) throw new Error(`Districts missing after insert: ${unmatched.join(', ')}`);
    console.log(`   ${districts.length} Maharashtra districts`);

    const built = build(mh.id, districts);
    const problems = validate(built);
    if (problems.length) {
      throw new Error(`Generated data fails constraint checks:\n  ${problems.slice(0, 10).join('\n  ')}`);
    }

    console.log('2. Creating Supabase Auth users');
    const { ids: authIds, failures } = await createAuthUsers(built.staff);
    createdAuthIds = [...authIds.values()];
    if (failures.length) {
      console.warn(`   ${failures.length} Auth user(s) could not be created:`);
      for (const f of failures.slice(0, 5)) console.warn(`     ${f}`);
    }

    console.log('3. Writing rows');
    await client.query('BEGIN');
    await bulkInsert(client, 'staff_profiles',
      ['id', 'auth_user_id', 'full_name', 'email', 'phone', 'role',
       'state_id', 'district_id', 'preferred_language', 'is_demo'],
      built.staff.map((s) => [
        s.id, authIds.get(s.email) || null, s.full_name, s.email, s.phone,
        s.role, s.state_id, s.district_id, s.preferred_language, true
      ]));
    await bulkInsert(client, 'doctor_profiles',
      ['staff_id', 'registration_number', 'specialization', 'qualification', 'years_of_experience'],
      built.doctorMeta);
    await bulkInsert(client, 'doctor_schedules',
      ['doctor_id', 'day_of_week', 'start_time', 'end_time', 'is_off'],
      built.scheduleRows);
    await bulkInsert(client, 'patients',
      ['aadhaar_number', 'full_name', 'gender', 'date_of_birth',
       'village_line1', 'village_line2', 'address_district', 'address_state_id', 'pin_code',
       'phone', 'registration_mode', 'clinic_district_id', 'clinic_state_id', 'registered_by', 'is_demo'],
      built.patientRows);
    await bulkInsert(client, 'visits',
      ['id', 'visit_code', 'patient_id', 'assistant_id', 'assigned_doctor_id', 'assigned_at',
       'district_id', 'chief_complaint', 'symptom_duration', 'status', 'risk_level', 'created_at', 'is_demo'],
      built.visitRows);
    await bulkInsert(client, 'visit_symptoms', ['visit_id', 'description', 'source'], built.symptomRows);
    await bulkInsert(client, 'visit_vitals',
      ['visit_id', 'temperature_f', 'blood_pressure_systolic', 'blood_pressure_diastolic',
       'pulse_bpm', 'spo2_percent', 'respiratory_rate', 'recorded_by'],
      built.vitalRows);
    await client.query('COMMIT');
    createdAuthIds = []; // committed: nothing to undo from here on

    // Counted from the database, not from memory — the report states what is
    // actually there.
    const mhAfter = await maharashtraCounts(client, mh.id);
    const upAfter = await upCounts(client);
    const upChanged = ['staff', 'patients', 'visits'].filter((k) => upBefore[k] !== upAfter[k]);
    const { credPath, pairs } = writeCredentials(built, authIds);

    console.log(`
================================================================
MAHARASHTRA SEED COMPLETE
================================================================
  Districts           ${mhAfter.districts}
  Doctors             ${mhAfter.doctors}
  Clinic assistants   ${mhAfter.assistants}
  Administrators      ${mhAfter.admins}
  Patients            ${mhAfter.patients}
  Visits              ${mhAfter.visits}
  Schedule rows       ${mhAfter.schedules}
  Auth users created  ${authIds.size}${failures.length ? `  (${failures.length} failed)` : ''}

  Uttar Pradesh       ${upChanged.length
    ? `CHANGED (${upChanged.join(', ')}) — this should not happen; investigate`
    : `untouched — ${upAfter.staff} staff, ${upAfter.patients} patients, ${upAfter.visits} visits`}

  Assistant + doctor pairs (same district):
${pairs.map((p) => `    ${p.name.padEnd(26)} ${p.assistant.email}\n    ${''.padEnd(26)} ${p.doctor.email}`).join('\n')}

  Password and admin logins: ${path.relative(process.cwd(), credPath)}
================================================================
`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (createdAuthIds.length) {
      console.error(`\nRemoving the ${createdAuthIds.length} Auth users this failed run created…`);
      await deleteAuthUsers(createdAuthIds);
    }
    throw err;
  } finally {
    await client.end();
  }
};

if (!DRY_RUN && !CONFIRMED) {
  console.warn(`
Maharashtra seed: nothing done.

This writes about 220 Auth users and 3,000 rows to the database at:
  ${process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : '(no DATABASE_URL)'}

  Preview, writing nothing:   npm run seed:maharashtra -- --dry-run
  Add Maharashtra:            npm run seed:maharashtra -- --confirm
`);
  // Exit 0, like seedV2's refusal: declining must never break whatever called it.
  process.exit(0);
}

main().catch((err) => {
  console.error(`\nMaharashtra seed failed: ${err.message}`);
  process.exit(1);
});
