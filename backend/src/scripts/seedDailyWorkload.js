/**
 * Deterministic daily workload — Phase 2.2/2.3 and Phase 3's seed requirement.
 *
 * Every doctor gets exactly five cases for a given date, spanning the whole
 * severity ladder, and the same date always produces the same five. Before
 * this, today's 263 visits were spread across 201 doctors, so a typical doctor
 * had one or two cases and the severity mix was whatever the original seed
 * happened to leave — a queue that demonstrated nothing in particular and
 * looked different on every reseed.
 *
 * Determinism matters for more than tidiness. A demonstration that reshuffles
 * itself between rehearsal and presentation cannot be rehearsed, and a queue
 * whose ordering changes on refresh makes the worst-first rule impossible to
 * show.
 *
 *   node src/scripts/seedDailyWorkload.js              # today, IST
 *   node src/scripts/seedDailyWorkload.js 2026-09-02   # a specific date
 *
 * Re-runnable: it removes that date's demo visits for the doctors it is about
 * to fill, then writes exactly five each. Real (non-demo) visits are never
 * touched — the delete is filtered on is_demo, so a genuine case handed over
 * by an assistant survives a reseed.
 *
 * Patients are reused rather than created. Each district already has 25 demo
 * patients and five doctors; five each divides exactly, which is the shape the
 * brief describes. Creating fresh patients daily would add 1,875 rows a day to
 * a table that is meant to represent a fixed population.
 */

import 'dotenv/config';
import crypto from 'crypto';
import { makeClient, bulkInsert } from './lib/db.js';

const PER_DOCTOR = 5;

/**
 * The severity ladder, worst first.
 *
 * Five cases across four tiers, so one repeats: moderate, because it is the
 * commonest presentation in practice and the queue should not imply that
 * emergencies are as frequent as routine cases.
 */
const LADDER = ['emergency', 'high', 'moderate', 'moderate', 'low'];

const COMPLAINTS = {
  emergency: 'Severe breathlessness, unable to speak full sentences',
  high: 'High fever with persistent vomiting for two days',
  moderate: 'Fever and headache for three days',
  low: 'Mild cough and sore throat since yesterday'
};

/** Vitals consistent with the tier — a textbook emergency reads as arbitrary. */
const VITALS = {
  //        tempF  sys  dia  pulse spo2  rr
  emergency: [104.2, 84, 54, 132, 86, 32],
  high: [102.8, 96, 62, 118, 91, 26],
  moderate: [100.4, 128, 84, 96, 96, 20],
  low: [98.4, 118, 78, 76, 98, 16]
};

const NEXT_ACTION = {
  emergency: 'EMERGENCY_HOSPITAL_REFERRAL',
  high: 'URGENT_DOCTOR_REVIEW',
  moderate: 'DOCTOR_REVIEW',
  low: 'PROTOCOL_CARE_DOCTOR_OPTIONAL'
};

/** Today in IST, which is what the visit_date column is generated from. */
const istDate = () =>
  new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);

/**
 * A stable ordering derived from the date and a key.
 *
 * Sorting by a hash of (date + id) gives an arrangement that looks arbitrary,
 * never moves for a given date, and differs between dates — so two days do not
 * present the identical queue.
 */
const shuffleFor = (date, items, keyOf) =>
  [...items].sort((a, b) => {
    const ha = crypto.createHash('sha256').update(`${date}:${keyOf(a)}`).digest('hex');
    const hb = crypto.createHash('sha256').update(`${date}:${keyOf(b)}`).digest('hex');
    return ha < hb ? -1 : ha > hb ? 1 : 0;
  });

const main = async () => {
  const date = process.argv[2] || istDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(`Not a date: ${date}. Use YYYY-MM-DD.`);
    process.exit(1);
  }

  const client = makeClient();
  await client.connect();

  try {
    const { rows: doctors } = await client.query(
      `SELECT id, district_id FROM staff_profiles
        WHERE role = 'doctor' AND status = 'active' AND district_id IS NOT NULL`
    );
    const { rows: assistants } = await client.query(
      `SELECT DISTINCT ON (district_id) id, district_id FROM staff_profiles
        WHERE role = 'clinic_assistant' AND status = 'active' AND district_id IS NOT NULL
        ORDER BY district_id, id`
    );
    const { rows: patients } = await client.query(
      `SELECT aadhaar_number, clinic_district_id FROM patients WHERE is_demo`
    );

    const assistantFor = new Map(assistants.map((a) => [a.district_id, a.id]));

    const byDistrict = new Map();
    for (const d of doctors) {
      if (!byDistrict.has(d.district_id)) byDistrict.set(d.district_id, { doctors: [], patients: [] });
      byDistrict.get(d.district_id).doctors.push(d);
    }
    for (const p of patients) {
      const bucket = byDistrict.get(p.clinic_district_id);
      if (bucket) bucket.patients.push(p);
    }

    const visitRows = [];
    const vitalRows = [];
    const assessmentRows = [];
    const filledDoctors = [];
    const shortDistricts = [];

    for (const [districtId, { doctors: docs, patients: pool }] of byDistrict) {
      const orderedDocs = shuffleFor(date, docs, (d) => d.id);
      const orderedPool = shuffleFor(date, pool, (p) => p.aadhaar_number);
      const assistantId = assistantFor.get(districtId) || null;

      let cursor = 0;
      for (const doctor of orderedDocs) {
        const slice = orderedPool.slice(cursor, cursor + PER_DOCTOR);
        cursor += PER_DOCTOR;

        // A district with fewer demo patients than its doctors need is
        // reported rather than quietly given a short queue.
        if (slice.length < PER_DOCTOR) {
          shortDistricts.push({ districtId, doctorId: doctor.id, got: slice.length });
          if (!slice.length) continue;
        }

        filledDoctors.push(doctor.id);

        slice.forEach((patient, i) => {
          const tier = LADDER[i % LADDER.length];
          const visitId = crypto.randomUUID();

          // Spread across clinic hours so the queue reads like a real day
          // rather than five cases logged in the same second.
          const at = new Date(`${date}T00:00:00Z`);
          at.setUTCHours(9 + i * 2, (i * 17) % 60, 0, 0);
          const createdAt = new Date(at.getTime() - 5.5 * 3600000).toISOString();

          visitRows.push([
            visitId,
            `VIS-D${date.replace(/-/g, '')}-${visitId.slice(0, 6)}`,
            patient.aadhaar_number,
            assistantId,
            doctor.id,
            createdAt,
            districtId,
            COMPLAINTS[tier],
            '3 days',
            'awaiting_doctor',
            tier,
            createdAt,
            true
          ]);

          vitalRows.push([visitId, ...VITALS[tier], assistantId]);

          assessmentRows.push([
            visitId,
            tier,
            `Patient presents with ${COMPLAINTS[tier].toLowerCase()}. Vitals and history recorded by the clinic assistant. Prepared for doctor review.`,
            JSON.stringify([
              'Step 1: Keep the patient comfortable and monitor vitals every 15 minutes.',
              'Step 2: Encourage oral fluids unless contraindicated.'
            ]),
            JSON.stringify([]),
            JSON.stringify(
              tier === 'emergency' || tier === 'high'
                ? ['Vitals outside the safe range — urgent doctor review required.']
                : []
            ),
            JSON.stringify([]),
            NEXT_ACTION[tier],
            true,
            'seed:daily-workload'
          ]);
        });
      }
    }

    /*
     * Clear this date's demo visits.
     *
     * `is_demo` is the guard that matters: a real case an assistant handed over
     * today is not demo data and must survive a reseed. The doctor list is
     * deliberately NOT part of this any more — matching 375 ids with
     * `assigned_doctor_id = ANY($2::uuid[])` made Postgres abandon the
     * visit_date index and the statement timed out on the server, so the
     * workload could not be rebuilt at all. Every doctor being refilled is in
     * that list regardless, which makes the extra clause a much more expensive
     * way to express the same set.
     */
    console.log(`Clearing demo visits for ${date} …`);
    await client.query(
      `DELETE FROM visits WHERE is_demo AND visit_date = $1::date`,
      [date]
    );

    await bulkInsert(client, 'visits',
      ['id', 'visit_code', 'patient_id', 'assistant_id', 'assigned_doctor_id', 'assigned_at',
        'district_id', 'chief_complaint', 'symptom_duration', 'status', 'risk_level', 'created_at', 'is_demo'],
      visitRows);

    await bulkInsert(client, 'visit_vitals',
      ['visit_id', 'temperature_f', 'blood_pressure_systolic', 'blood_pressure_diastolic',
        'pulse_bpm', 'spo2_percent', 'respiratory_rate', 'recorded_by'],
      vitalRows);

    await bulkInsert(client, 'ai_assessments',
      ['visit_id', 'risk_level', 'patient_summary', 'first_aid_steps', 'protocol_matches',
        'warnings', 'missing_information', 'recommended_next_action', 'requires_doctor', 'generated_by'],
      assessmentRows);

    const { rows: [check] } = await client.query(
      `SELECT COUNT(*)::int AS visits,
              COUNT(DISTINCT assigned_doctor_id)::int AS doctors
         FROM visits WHERE visit_date = $1::date AND is_demo AND deleted_at IS NULL`,
      [date]
    );

    console.log(`
================================================================
DAILY WORKLOAD SEEDED — ${date}
================================================================
  Doctors filled    ${filledDoctors.length}
  Visits written    ${visitRows.length}  (${PER_DOCTOR} per doctor)
  Severity ladder   ${LADDER.join(', ')}
  AI assessments    ${assessmentRows.length}

  In the database for this date: ${check.visits} demo visits
                                 across ${check.doctors} doctors
${shortDistricts.length ? `
  WARNING: ${shortDistricts.length} doctor(s) had too few demo patients in
  their district to fill a queue. Run the main seed first.` : ''}
================================================================
`);
  } finally {
    await client.end();
  }
};

main().catch((err) => {
  console.error('Daily workload seed failed:', err.message);
  process.exit(1);
});
