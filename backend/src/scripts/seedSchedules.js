/**
 * Seed doctor working hours, and give the demo doctor a real caseload.
 *
 * Two things:
 *   1. A `doctor_schedules` row for every active doctor, every weekday. Nothing
 *      in the scheduling engine is hardcoded, so without these rows every date
 *      correctly reports "no doctors available" — which looks like a bug and
 *      is actually the engine working.
 *   2. Five patients with today's visits assigned to the demo doctor, so the
 *      review queue is populated the moment you sign in.
 *
 * Re-runnable: schedules upsert, and the demo doctor's today-visits are
 * rebuilt rather than duplicated.
 */

import 'dotenv/config';
import crypto from 'crypto';
import { makeClient, bulkInsert } from './lib/db.js';
import {
  MALE_FIRST_NAMES, FEMALE_FIRST_NAMES, SURNAMES,
  CHIEF_COMPLAINTS, SYMPTOM_DURATIONS
} from '../data/indianNames.js';
import { VILLAGE_SUFFIXES } from '../data/regions.js';

const DEMO_DOCTOR_EMAIL = process.env.DEMO_DOCTOR_EMAIL || 'aarav.khanna.doc1@vvc-demo.example.com';
const PATIENTS_FOR_DEMO_DOCTOR = 5;

/**
 * Working hours written for every doctor.
 *
 * A real sub-centre runs roughly 09:00-17:00, and that is what a production
 * deployment should seed. The demo default is deliberately wide, because the
 * scheduling engine is honest: outside these hours it correctly reports "no
 * doctors available" and Instant Consultation returns 404 — which looks like a
 * broken feature to someone demoing at 6am.
 *
 * Override for a realistic roster:
 *   SCHEDULE_START=09:00 SCHEDULE_END=17:00 npm run seed:schedules
 */
const WEEKDAY_HOURS = {
  // 24/7 by default. Some tele-clinics genuinely run round the clock, and it
  // means a demo works at any hour instead of showing an empty schedule.
  start: `${process.env.SCHEDULE_START || '00:00'}:00`,
  end: `${process.env.SCHEDULE_END || '23:45'}:00`
};

/** Seed Sunday as a working day too unless a real roster is being written. */
const SUNDAY_OFF = process.env.SCHEDULE_SUNDAY_OFF === 'true';

let rng = 0x5eed1234;
const rnd = () => {
  rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5;
  return ((rng >>> 0) % 1_000_000) / 1_000_000;
};
const pick = (a) => a[Math.floor(rnd() * a.length) % a.length];
const intBetween = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

// Demo Aadhaar always starts 0 — UIDAI allocates from 2-9, so these can never
// collide with a real person's number. Deliberate; do not "fix".
const aadhaarFor = (n) => '0' + String(900000 + n).padStart(11, '0');

const main = async () => {
  const client = makeClient();
  await client.connect();

  try {
    // ---- 1. Working hours for every active doctor ----
    const { rows: doctors } = await client.query(
      `SELECT id, full_name, district_id, state_id FROM staff_profiles
       WHERE role = 'doctor' AND status = 'active'`
    );
    console.log(`Doctors found: ${doctors.length}`);

    const scheduleRows = [];
    for (const d of doctors) {
      for (let day = 0; day <= 6; day += 1) {
        const off = day === 0 && SUNDAY_OFF;
        scheduleRows.push([
          d.id, day,
          off ? '00:00:00' : WEEKDAY_HOURS.start,
          off ? '00:00:01' : WEEKDAY_HOURS.end,
          off
        ]);
      }
    }

    await client.query('DELETE FROM doctor_schedules');
    await bulkInsert(
      client, 'doctor_schedules',
      ['doctor_id', 'day_of_week', 'start_time', 'end_time', 'is_off'],
      scheduleRows
    );
    console.log(`Schedules written: ${scheduleRows.length} (${WEEKDAY_HOURS.start.slice(0, 5)}-${WEEKDAY_HOURS.end.slice(0, 5)}${SUNDAY_OFF ? ', Sunday off' : ', all 7 days'})`);

    // ---- 2. A real caseload for the demo doctor ----
    const { rows: [demo] } = await client.query(
      `SELECT s.id, s.full_name, s.district_id, s.state_id, d.name AS district_name
         FROM staff_profiles s
         JOIN districts d ON d.id = s.district_id
        WHERE s.email = $1`, [DEMO_DOCTOR_EMAIL]
    );
    if (!demo) {
      console.warn(`Demo doctor ${DEMO_DOCTOR_EMAIL} not found — skipping caseload.`);
      return;
    }

    const { rows: [assistant] } = await client.query(
      `SELECT id FROM staff_profiles
        WHERE role = 'clinic_assistant' AND district_id = $1 LIMIT 1`, [demo.district_id]
    );

    // Clear only the demo doctor's own demo visits for today, so re-running
    // does not stack five more cases on top of the last five.
    await client.query(
      `DELETE FROM visits
        WHERE assigned_doctor_id = $1 AND is_demo
          AND visit_date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date`,
      [demo.id]
    );

    const patientRows = [];
    const visitRows = [];
    const vitalRows = [];
    const symptomRows = [];
    const assessmentRows = [];

    // One case per risk tier plus a second moderate, so the queue demonstrates
    // the worst-first ordering rather than five identical rows.
    const tiers = ['emergency', 'high', 'moderate', 'moderate', 'low'];

    for (let i = 0; i < PATIENTS_FOR_DEMO_DOCTOR; i += 1) {
      const gender = rnd() < 0.5 ? 'female' : 'male';
      const first = gender === 'female' ? pick(FEMALE_FIRST_NAMES) : pick(MALE_FIRST_NAMES);
      const last = pick(SURNAMES);
      const aadhaar = aadhaarFor(i);
      const age = intBetween(3, 82);
      const dob = new Date(Date.UTC(new Date().getUTCFullYear() - age, intBetween(0, 11), intBetween(1, 28)))
        .toISOString().slice(0, 10);

      patientRows.push([
        aadhaar, `${first} ${last}`, gender, dob,
        `${demo.district_name} ${pick(VILLAGE_SUFFIXES)}`, null,
        demo.district_name, demo.state_id,
        String(intBetween(201000, 285999)),
        `${pick(['6', '7', '8', '9'])}${intBetween(100000000, 999999999)}`.slice(0, 10),
        'standard', demo.district_id, demo.state_id, assistant?.id || null, true
      ]);

      const visitId = crypto.randomUUID();
      const tier = tiers[i];
      // Spread across today's clinic hours so the queue looks like a real day.
      const created = new Date();
      created.setHours(9 + i * 2, intBetween(0, 55), 0, 0);

      visitRows.push([
        visitId, `VIS-DEMO-${Date.now().toString().slice(-6)}-${i}`, aadhaar,
        assistant?.id || null, demo.id, created.toISOString(), demo.district_id,
        pick(CHIEF_COMPLAINTS), pick(SYMPTOM_DURATIONS),
        'awaiting_doctor', tier, created.toISOString(), true
      ]);

      // Vitals consistent with the tier — an emergency row with textbook
      // observations would make the triage display look arbitrary.
      const vitals = {
        emergency: [104.2, 84, 54, 132, 86, 32],
        high:      [102.8, 96, 62, 118, 91, 26],
        moderate:  [100.4, 128, 84, 96, 96, 20],
        low:       [98.4, 118, 78, 76, 98, 16]
      }[tier];

      vitalRows.push([visitId, ...vitals, assistant?.id || null]);
      symptomRows.push([visitId, pick(CHIEF_COMPLAINTS), 'speech']);

      assessmentRows.push([
        visitId, tier,
        `${first} ${last}, ${age}-year-old ${gender}, presents with the recorded complaint. Vitals and history captured by the clinic assistant. Prepared for doctor review.`,
        JSON.stringify(['Step 1: Keep the patient comfortable and monitor vitals.', 'Step 2: Encourage oral fluids unless contraindicated.']),
        JSON.stringify([]),
        JSON.stringify(tier === 'emergency' || tier === 'high'
          ? ['Vitals outside the safe range — urgent doctor review required.'] : []),
        JSON.stringify([]),
        tier === 'emergency' ? 'EMERGENCY_HOSPITAL_REFERRAL'
          : tier === 'high' ? 'URGENT_DOCTOR_REVIEW' : 'DOCTOR_REVIEW',
        true, 'seed:demo-caseload'
      ]);
    }

    for (const row of patientRows) {
      await client.query(
        `INSERT INTO patients (aadhaar_number, full_name, gender, date_of_birth,
           village_line1, village_line2, address_district, address_state_id, pin_code,
           phone, registration_mode, clinic_district_id, clinic_state_id, registered_by, is_demo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (aadhaar_number) DO UPDATE
           SET full_name = EXCLUDED.full_name, clinic_district_id = EXCLUDED.clinic_district_id`,
        row
      );
    }

    await bulkInsert(client, 'visits',
      ['id', 'visit_code', 'patient_id', 'assistant_id', 'assigned_doctor_id', 'assigned_at',
       'district_id', 'chief_complaint', 'symptom_duration', 'status', 'risk_level', 'created_at', 'is_demo'],
      visitRows);

    await bulkInsert(client, 'visit_vitals',
      ['visit_id', 'temperature_f', 'blood_pressure_systolic', 'blood_pressure_diastolic',
       'pulse_bpm', 'spo2_percent', 'respiratory_rate', 'recorded_by'],
      vitalRows);

    await bulkInsert(client, 'visit_symptoms', ['visit_id', 'description', 'source'], symptomRows);

    await bulkInsert(client, 'ai_assessments',
      ['visit_id', 'risk_level', 'patient_summary', 'first_aid_steps', 'protocol_matches',
       'warnings', 'missing_information', 'recommended_next_action', 'requires_doctor', 'generated_by'],
      assessmentRows);

    console.log(`
================================================================
DEMO CASELOAD READY
================================================================
  Doctor            ${demo.full_name} (${demo.district_name})
  Patients          ${patientRows.length}
  Visits today      ${visitRows.length}  (emergency, high, moderate x2, low)
  AI assessments    ${assessmentRows.length}
  Schedules         all ${doctors.length} doctors, ${WEEKDAY_HOURS.start.slice(0, 5)}-${WEEKDAY_HOURS.end.slice(0, 5)}
================================================================
`);
  } finally {
    await client.end();
  }
};

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
