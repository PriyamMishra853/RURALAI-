/**
 * V2 demo seed.
 *
 * Builds, per the agreed scope:
 *   - 36 states/UTs, and all 75 districts of Uttar Pradesh
 *   - 5 doctors per UP district              → 375 doctors
 *   - 1 clinic assistant per UP district     →  75 assistants
 *   - 5 patients per doctor                  → 1,875 patients
 *   - 1 visit per patient, spread across recent days, risk-tiered
 *   - a district admin for a handful of districts, and one state admin
 *
 * Every row carries is_demo = true. The super_admin account is NOT created
 * here — it is provisioned separately by `npm run seed:root` from credentials
 * that only the operator holds, per spec §3.8.
 *
 * Re-runnable: it clears demo rows and their Auth users before inserting.
 */

import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeClient, bulkInsert } from './lib/db.js';
import { supabaseAdmin } from '../config/supabase.js';
import { STATES, UP_DISTRICTS, VILLAGE_SUFFIXES } from '../data/regions.js';
import {
  MALE_FIRST_NAMES, FEMALE_FIRST_NAMES, SURNAMES,
  SPECIALIZATIONS, QUALIFICATIONS, LANGUAGES,
  CHIEF_COMPLAINTS, SYMPTOM_DURATIONS
} from '../data/indianNames.js';

const DOCTORS_PER_DISTRICT  = 5;
const PATIENTS_PER_DOCTOR   = 5;
const ASSISTANTS_PER_DISTRICT = 1;

// One shared password across demo accounts so the demo is usable. Overridable,
// and never compiled into the frontend bundle — the seed writes it to a
// gitignored credentials file instead.
const DEMO_PASSWORD = process.env.DEMO_ACCOUNT_PASSWORD || 'Demo@Clinic2026';

// Reserved so demo addresses can never reach a real inbox (RFC 2606).
const EMAIL_DOMAIN = 'vvc-demo.example.com';

// ---------------------------------------------------------------------------
// Deterministic RNG — same seed, same dataset, so a demo is reproducible.
// ---------------------------------------------------------------------------
let rngState = 0x2f6e2b1;
const rnd = () => {
  rngState ^= rngState << 13; rngState ^= rngState >>> 17; rngState ^= rngState << 5;
  return ((rngState >>> 0) % 1_000_000) / 1_000_000;
};
const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];
const intBetween = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

// ---------------------------------------------------------------------------
// Synthetic Aadhaar.
//
// Real Aadhaar numbers never begin with 0 or 1 — UIDAI allocates from 2-9. Every
// number generated here starts with 0, so it satisfies the 12-digit column
// constraint while being structurally incapable of colliding with a real
// person's Aadhaar. That property is the whole reason for the leading zero;
// do not "fix" it to look more realistic.
// ---------------------------------------------------------------------------
let aadhaarCounter = 0;
const nextAadhaar = () => '0' + String(++aadhaarCounter).padStart(11, '0');

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

let emailCounter = 0;
const makeEmail = (first, last, tag) =>
  `${slug(first)}.${slug(last)}.${tag}${++emailCounter}@${EMAIL_DOMAIN}`;

const personName = (gender) => {
  const first = gender === 'female' ? pick(FEMALE_FIRST_NAMES) : pick(MALE_FIRST_NAMES);
  return { first, last: pick(SURNAMES), full: `${first} ${pick(SURNAMES)}` };
};

// ---------------------------------------------------------------------------
// Supabase Auth provisioning, bounded concurrency.
// ---------------------------------------------------------------------------
const createAuthUsers = async (accounts, concurrency = 10) => {
  const results = new Map();
  let done = 0, failed = 0;
  const queue = [...accounts];

  const worker = async () => {
    while (queue.length) {
      const acc = queue.shift();
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email: acc.email,
        password: DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: acc.full_name, seeded: true }
      });
      if (error) {
        failed += 1;
        if (failed <= 3) console.warn(`\n   auth create failed (${acc.email}): ${error.message}`);
      } else {
        results.set(acc.email, data.user.id);
      }
      done += 1;
      if (done % 25 === 0 || done === accounts.length) {
        process.stdout.write(`\r   auth users: ${done}/${accounts.length} (${failed} failed)`);
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
  process.stdout.write('\n');
  return results;
};

const deleteDemoAuthUsers = async () => {
  let removed = 0;
  for (let page = 1; page <= 60; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data?.users?.length) break;
    const demo = data.users.filter(
      (u) => u.email?.endsWith(`@${EMAIL_DOMAIN}`) || u.user_metadata?.seeded === true
    );
    for (const u of demo) {
      await supabaseAdmin.auth.admin.deleteUser(u.id);
      removed += 1;
      if (removed % 25 === 0) process.stdout.write(`\r   removed auth users: ${removed}`);
    }
    if (data.users.length < 1000) break;
  }
  if (removed) process.stdout.write(`\r   removed auth users: ${removed}\n`);
  return removed;
};

// ---------------------------------------------------------------------------

const main = async () => {
  const client = makeClient();
  await client.connect();
  console.log('Connected.\n');

  try {

    console.log('1. Clearing previous demo data');
await client.query('BEGIN');

// ---------------------------------------------------------------
// Delete dependent demo records first.
// staff_profiles is referenced by several clinical/admin tables.
// ---------------------------------------------------------------

// Doctor reviews reference staff_profiles.doctor_id
await client.query(`
  DELETE FROM doctor_reviews
  WHERE doctor_id IN (
    SELECT id FROM staff_profiles WHERE is_demo
  )
`);

// Prescriptions reference staff_profiles.doctor_id
await client.query(`
  DELETE FROM prescriptions
  WHERE doctor_id IN (
    SELECT id FROM staff_profiles WHERE is_demo
  )
`);

// Audit records reference staff_profiles.actor_id
await client.query(`
  DELETE FROM audit_logs
  WHERE actor_id IN (
    SELECT id FROM staff_profiles WHERE is_demo
  )
`);

// Visits reference doctors/assistants and patients.
// Delete visits before deleting patients/staff.
await client.query(`
  DELETE FROM visits
  WHERE is_demo
`);

// Delete demo patients.
await client.query(`
  DELETE FROM patients
  WHERE is_demo
`);

// Now staff can safely be removed.
await client.query(`
  DELETE FROM staff_profiles
  WHERE is_demo
    AND role <> 'super_admin'
`);

await client.query('COMMIT');

await deleteDemoAuthUsers();

console.log('   database rows cleared\n');

    // -- regions ------------------------------------------------------------
    console.log('2. Regions');
    // States are reference data, not demo data — insert only if absent.
    for (const s of STATES) {
      await client.query(
        `INSERT INTO states (name, code, region_type) VALUES ($1,$2,$3)
         ON CONFLICT (code) DO NOTHING`,
        [s.name, s.code, s.region_type]
      );
    }
    const { rows: [upState] } = await client.query("SELECT id FROM states WHERE code = 'UP'");
    for (const d of UP_DISTRICTS) {
      await client.query(
        `INSERT INTO districts (state_id, name) VALUES ($1,$2)
         ON CONFLICT (state_id, name) DO NOTHING`,
        [upState.id, d]
      );
    }
    const { rows: districts } = await client.query(
      'SELECT id, name FROM districts WHERE state_id = $1 ORDER BY name', [upState.id]
    );
    console.log(`   ${STATES.length} states/UTs, ${districts.length} UP districts\n`);

    // -- build staff --------------------------------------------------------
    console.log('3. Generating staff');
    const staff = [];      // { id, email, full_name, role, district_id, ... }
    const doctorMeta = []; // doctor_profiles rows

    let regCounter = 0;
    for (const district of districts) {
      for (let i = 0; i < DOCTORS_PER_DISTRICT; i += 1) {
        const gender = rnd() < 0.4 ? 'female' : 'male';
        const { first, last } = personName(gender);
        const spec = pick(SPECIALIZATIONS);
        const id = crypto.randomUUID();
        staff.push({
          id,
          full_name: `Dr. ${first} ${last}`,
          email: makeEmail(first, last, 'doc'),
          role: 'doctor',
          state_id: upState.id,
          district_id: district.id,
          phone: `9${intBetween(100000000, 999999999)}`,
          preferred_language: pick(LANGUAGES)
        });
        doctorMeta.push([
          id,
          `UPMC/${String(++regCounter).padStart(6, '0')}`,
          spec,
          pick(QUALIFICATIONS[spec]),
          intBetween(2, 30)
        ]);
      }

      for (let i = 0; i < ASSISTANTS_PER_DISTRICT; i += 1) {
        const gender = rnd() < 0.6 ? 'female' : 'male';
        const { first, last } = personName(gender);
        staff.push({
          id: crypto.randomUUID(),
          full_name: `${first} ${last}`,
          email: makeEmail(first, last, 'asst'),
          role: 'clinic_assistant',
          state_id: upState.id,
          district_id: district.id,
          phone: `9${intBetween(100000000, 999999999)}`,
          preferred_language: pick(LANGUAGES)
        });
      }
    }

    // A district admin for the first eight districts, plus one state admin —
    // enough to demonstrate that admin scope actually constrains the roster.
    for (const district of districts.slice(0, 8)) {
      const { first, last } = personName(rnd() < 0.5 ? 'female' : 'male');
      staff.push({
        id: crypto.randomUUID(),
        full_name: `${first} ${last}`,
        email: makeEmail(first, last, 'dadmin'),
        role: 'district_admin',
        state_id: upState.id,
        district_id: district.id,
        phone: `9${intBetween(100000000, 999999999)}`,
        preferred_language: 'Hindi'
      });
    }
    {
      const { first, last } = personName('male');
      staff.push({
        id: crypto.randomUUID(),
        full_name: `${first} ${last}`,
        email: makeEmail(first, last, 'sadmin'),
        role: 'state_admin',
        state_id: upState.id,
        district_id: null,
        phone: `9${intBetween(100000000, 999999999)}`,
        preferred_language: 'Hindi'
      });
    }
    console.log(`   ${staff.length} staff accounts to provision\n`);

    // -- auth ---------------------------------------------------------------
    console.log('4. Creating Supabase Auth users');
    const authIds = await createAuthUsers(staff);
    console.log('');

    // -- staff rows ---------------------------------------------------------
    console.log('5. Writing staff profiles');
    await bulkInsert(
      client, 'staff_profiles',
      ['id', 'auth_user_id', 'full_name', 'email', 'phone', 'role',
       'state_id', 'district_id', 'preferred_language', 'is_demo'],
      staff.map((s) => [
        s.id, authIds.get(s.email) || null, s.full_name, s.email, s.phone,
        s.role, s.state_id, s.district_id, s.preferred_language, true
      ])
    );
    await bulkInsert(
      client, 'doctor_profiles',
      ['staff_id', 'registration_number', 'specialization', 'qualification', 'years_of_experience'],
      doctorMeta
    );
    console.log('');

    // -- patients + visits --------------------------------------------------
    console.log('6. Generating patients and visits');
    const doctors    = staff.filter((s) => s.role === 'doctor');
    const assistantBy = new Map();
    for (const a of staff.filter((s) => s.role === 'clinic_assistant')) {
      assistantBy.set(a.district_id, a.id);
    }

    const RISK_TIERS = ['low', 'low', 'low', 'moderate', 'moderate', 'high', 'emergency'];
    const patientRows = [];
    const visitRows   = [];
    const symptomRows = [];
    const vitalRows   = [];

    let visitSeq = 0;
    for (const doc of doctors) {
      for (let i = 0; i < PATIENTS_PER_DOCTOR; i += 1) {
        const gender = rnd() < 0.5 ? 'female' : 'male';
        const { first, last } = personName(gender);
        const aadhaar = nextAadhaar();
        const districtName = districts.find((d) => d.id === doc.district_id).name;
        const age = intBetween(1, 88);

        // Date of birth, not age: age is derived at read time.
        const dob = new Date(
          Date.UTC(new Date().getUTCFullYear() - age, intBetween(0, 11), intBetween(1, 28))
        ).toISOString().slice(0, 10);

        patientRows.push([
          aadhaar,
          `${first} ${last}`,
          gender,
          dob,
          `${districtName} ${pick(VILLAGE_SUFFIXES)}`,
          rnd() < 0.5 ? `Near ${pick(['the primary school', 'the panchayat bhawan', 'the bus stop', 'the tube well'])}` : null,
          districtName,
          upState.id,
          // UP PIN codes run 20xxxx-28xxxx.
          String(intBetween(201000, 285999)),
          `${pick(['6', '7', '8', '9'])}${intBetween(100000000, 999999999)}`.slice(0, 10),
          'standard',
          doc.district_id,
          upState.id,
          assistantBy.get(doc.district_id) || null,
          true
        ]);

        // Visits spread over the last 7 days INCLUDING today, so the day-wise
        // queue is not empty the moment the seed is a day old. Anchored to IST
        // clinic hours because visit_date is generated in that timezone.
        const visitId = crypto.randomUUID();
        const istNow = new Date(Date.now() + 5.5 * 3600 * 1000);
        const created = new Date(Date.UTC(
          istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() - intBetween(0, 6),
          intBetween(8, 17) - 5, intBetween(0, 59)
        ));
        const risk = pick(RISK_TIERS);

        visitRows.push([
          visitId,
          `VIS-${String(++visitSeq).padStart(6, '0')}`,
          aadhaar,
          assistantBy.get(doc.district_id) || null,
          doc.id,
          created.toISOString(),
          doc.district_id,
          pick(CHIEF_COMPLAINTS),
          pick(SYMPTOM_DURATIONS),
          risk === 'low' ? 'completed' : 'awaiting_doctor',
          risk,
          created.toISOString(),
          true
        ]);

        symptomRows.push([visitId, pick(CHIEF_COMPLAINTS), 'speech']);
        vitalRows.push([
          visitId,
          (96 + rnd() * 8).toFixed(1),
          intBetween(95, 165),
          intBetween(60, 105),
          intBetween(58, 130),
          intBetween(88, 100),
          intBetween(12, 30),
          assistantBy.get(doc.district_id) || null
        ]);
      }
    }

    await bulkInsert(
      client, 'patients',
      ['aadhaar_number', 'full_name', 'gender', 'date_of_birth',
       'village_line1', 'village_line2', 'address_district', 'address_state_id', 'pin_code',
       'phone', 'registration_mode',
       'clinic_district_id', 'clinic_state_id', 'registered_by', 'is_demo'],
      patientRows
    );

    await bulkInsert(
      client, 'visits',
      ['id', 'visit_code', 'patient_id', 'assistant_id', 'assigned_doctor_id', 'assigned_at',
       'district_id', 'chief_complaint', 'symptom_duration', 'status', 'risk_level',
       'created_at', 'is_demo'],
      visitRows
    );

    await bulkInsert(client, 'visit_symptoms', ['visit_id', 'description', 'source'], symptomRows);
    await bulkInsert(
      client, 'visit_vitals',
      ['visit_id', 'temperature_f', 'blood_pressure_systolic', 'blood_pressure_diastolic',
       'pulse_bpm', 'spo2_percent', 'respiratory_rate', 'recorded_by'],
      vitalRows
    );

    // -- credentials file ---------------------------------------------------
    const sampleDoctor    = staff.find((s) => s.role === 'doctor');
    const sampleAssistant = staff.find((s) => s.role === 'clinic_assistant');
    const sampleDistAdmin = staff.find((s) => s.role === 'district_admin');
    const sampleStateAdmin = staff.find((s) => s.role === 'state_admin');

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const credPath = path.resolve(__dirname, '../../../database/v2/DEMO_CREDENTIALS.md');
    fs.writeFileSync(credPath, `# Demo credentials

Generated by \`npm run seed\`. This file is gitignored — it lists working
sign-ins for the seeded demo accounts.

Shared password for every demo account below: \`${DEMO_PASSWORD}\`

| Role | Email |
| :--- | :--- |
| Clinic Assistant | \`${sampleAssistant.email}\` |
| Doctor | \`${sampleDoctor.email}\` |
| District Admin | \`${sampleDistAdmin.email}\` |
| State Admin | \`${sampleStateAdmin.email}\` |

The **super admin** is not seeded. Create it with:

\`\`\`bash
ROOT_ADMIN_EMAIL=you@example.com ROOT_ADMIN_PASSWORD='<strong password>' npm run seed:root
\`\`\`

Totals: ${staff.filter(s=>s.role==='doctor').length} doctors ·
${staff.filter(s=>s.role==='clinic_assistant').length} assistants ·
${patientRows.length} patients · ${visitRows.length} visits ·
${districts.length} UP districts · ${STATES.length} states/UTs
`);

    console.log(`
================================================================
SEED COMPLETE
================================================================
  States / UTs        ${STATES.length}
  UP districts        ${districts.length}
  Doctors             ${doctors.length}   (${DOCTORS_PER_DISTRICT} per district)
  Clinic assistants   ${staff.filter((s) => s.role === 'clinic_assistant').length}
  District admins     ${staff.filter((s) => s.role === 'district_admin').length}
  State admins        ${staff.filter((s) => s.role === 'state_admin').length}
  Patients            ${patientRows.length}   (${PATIENTS_PER_DOCTOR} per doctor)
  Visits              ${visitRows.length}
  Auth users created  ${authIds.size}

  Credentials written to database/v2/DEMO_CREDENTIALS.md
  Super admin is NOT seeded — run: npm run seed:root
================================================================
`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
};

main().catch((err) => {
  console.error('\nSeed failed:', err.message);
  process.exit(1);
});
