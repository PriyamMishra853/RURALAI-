import { supabaseAdmin } from '../config/supabase.js';
import { logAuditEvent } from '../middleware/audit.middleware.js';
import { AADHAAR_RE, digitsOnly, withAge } from '../services/patientFields.js';

/**
 * Clinical visits.
 *
 * Two things changed from v1 beyond the schema:
 *   - the in-memory MEMORY_VISITS cache is gone. It grew without bound, held
 *     patient data in process memory, and was merged into responses in a way
 *     that bypassed the query filters.
 *   - every read and write is constrained to the caller's district.
 */

const RISK_TIERS = ['low', 'moderate', 'high', 'emergency'];
const DURATION_UNITS = ['days', 'months', 'years'];

/**
 * Render a duration into the phrase the AI prompt expects.
 * The orchestrator reads `symptom_duration` as free text; the split
 * value/unit is kept so it can be reasoned about rather than parsed back.
 */
const formatDuration = (value, unit) => {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1 || !DURATION_UNITS.includes(unit)) return null;
  const singular = { days: 'day', months: 'month', years: 'year' }[unit];
  return `${n} ${n === 1 ? singular : unit}`;
};

let visitSeq = Date.now() % 100000;
const generateVisitCode = () => `VIS-${new Date().getFullYear()}-${String(++visitSeq).padStart(6, '0')}`;

/**
 * Range-check vitals before they reach the risk engine.
 *
 * A transposed digit produces a physiologically impossible value, and the
 * triage rules would treat it as a genuine red flag. Rejecting it here is the
 * difference between "re-enter the pulse" and a false emergency referral.
 */
export const validateVitalsRanges = (vitals) => {
  const errors = [];
  if (!vitals) return { isValid: true, errors: [], cleanVitals: {} };

  const num = (...candidates) => {
    for (const v of candidates) {
      if (v !== undefined && v !== null && v !== '') {
        const parsed = Number(v);
        if (!Number.isNaN(parsed)) return parsed;
      }
    }
    return null;
  };

  const check = (value, lo, hi, label, unit) => {
    if (value !== null && (value < lo || value > hi)) {
      errors.push(`${label} ${value}${unit} is outside the plausible range (${lo}-${hi}${unit}).`);
    }
    return value;
  };

  const temperature = check(num(vitals.temperature, vitals.temperature_f), 95, 107, 'Temperature', '°F');
  const systolic    = check(num(vitals.systolic_bp, vitals.blood_pressure_systolic), 50, 300, 'Systolic BP', ' mmHg');
  const diastolic   = check(num(vitals.diastolic_bp, vitals.blood_pressure_diastolic), 20, 200, 'Diastolic BP', ' mmHg');
  const pulse       = check(num(vitals.pulse_bpm, vitals.pulse), 20, 250, 'Pulse', ' bpm');
  const spo2        = check(num(vitals.spo2_percent, vitals.spo2, vitals.oxygen_saturation), 50, 100, 'SpO2', '%');
  const respiratory = check(num(vitals.respiratory_rate), 5, 80, 'Respiratory rate', '/min');
  const glucose     = check(num(vitals.blood_glucose_mgdl), 20, 800, 'Blood glucose', ' mg/dL');

  if (systolic !== null && diastolic !== null && diastolic >= systolic) {
    errors.push(`Diastolic BP (${diastolic}) must be lower than systolic (${systolic}). Check the reading.`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    cleanVitals: {
      temperature_f: temperature,
      blood_pressure_systolic: systolic,
      blood_pressure_diastolic: diastolic,
      pulse_bpm: pulse,
      spo2_percent: spo2,
      respiratory_rate: respiratory,
      blood_glucose_mgdl: glucose
    }
  };
};

/** POST /api/visits — open a visit for a patient in the caller's district. */
export const createVisit = async (req, res) => {
  const {
    aadhaar_number, chief_complaint,
    symptom_duration_value, symptom_duration_unit, symptom_duration,
    medical_history, known_allergies,
    current_medications, vitals, symptoms, assigned_doctor_id
  } = req.body || {};

  // The patient is identified by Aadhaar, in the body rather than the URL.
  const aadhaar = digitsOnly(aadhaar_number);
  if (!AADHAAR_RE.test(aadhaar)) {
    return res.status(400).json({ error: 'A 12-digit Aadhaar number is required to open a visit.' });
  }

  const { data: patient } = await supabaseAdmin
    .from('patients')
    .select('aadhaar_number, full_name')
    .eq('aadhaar_number', aadhaar)
    .eq('clinic_district_id', req.user.districtId)
    .maybeSingle();

  if (!patient) return res.status(404).json({ error: 'No such patient in your district.' });

  const { isValid, errors, cleanVitals } = validateVitalsRanges(vitals);
  if (!isValid) return res.status(400).json({ error: 'Vitals failed validation.', details: errors });

  // A named doctor must be an active doctor in this district.
  let doctorId = null;
  if (assigned_doctor_id) {
    const { data: doc } = await supabaseAdmin
      .from('staff_profiles').select('id')
      .eq('id', assigned_doctor_id).eq('role', 'doctor').eq('status', 'active')
      .eq('district_id', req.user.districtId).maybeSingle();
    if (!doc) return res.status(404).json({ error: 'That doctor is not available in your district.' });
    doctorId = doc.id;
  }

  const { data: visit, error } = await supabaseAdmin
    .from('visits')
    .insert([{
      visit_code: generateVisitCode(),
      patient_id: patient.aadhaar_number,
      assistant_id: req.user.id,
      assigned_doctor_id: doctorId,
      assigned_at: doctorId ? new Date().toISOString() : null,
      district_id: req.user.districtId,
      chief_complaint: chief_complaint || null,
      symptom_duration: formatDuration(symptom_duration_value, symptom_duration_unit)
        || symptom_duration || null,
      symptom_duration_value: Number.parseInt(symptom_duration_value, 10) || null,
      symptom_duration_unit: DURATION_UNITS.includes(symptom_duration_unit) ? symptom_duration_unit : null,
      medical_history: medical_history || null,
      known_allergies: known_allergies || null,
      current_medications: current_medications || null,
      status: 'in_progress',
      is_demo: false
    }])
    .select()
    .single();

  if (error) {
    console.error('visit insert failed:', error.message);
    return res.status(500).json({ error: 'The visit could not be created.' });
  }

  if (Object.values(cleanVitals).some((v) => v !== null)) {
    await supabaseAdmin.from('visit_vitals').insert([{ ...cleanVitals, visit_id: visit.id, recorded_by: req.user.id }]);
  }
  if (Array.isArray(symptoms) && symptoms.length) {
    await supabaseAdmin.from('visit_symptoms').insert(
      symptoms.filter(Boolean).map((s) => ({
        visit_id: visit.id,
        description: typeof s === 'string' ? s : s.description,
        source: typeof s === 'object' && s.source ? s.source : 'typed'
      }))
    );
  }

  await logAuditEvent({
    actorId: req.user.id, actorRole: req.user.role,
    action: 'VISIT_CREATED', entityType: 'VISITS', entityId: visit.id,
    metadata: { visit_code: visit.visit_code }, ip: req.ip
  });

  return res.status(201).json(visit);
};

/** GET /api/visits/:id — district-scoped for assistants, assignment-scoped for doctors. */
export const getVisitById = async (req, res) => {
  let q = supabaseAdmin
    .from('visits')
    .select(`
      *,
      patients ( aadhaar_number, full_name, gender, date_of_birth, village_line1, village_line2, address_district, phone ),
      visit_vitals ( * ),
      visit_symptoms ( description, source, created_at ),
      ai_assessments ( * )
    `)
    .eq('id', req.params.id);

  q = req.user.role === 'DOCTOR'
    ? q.eq('assigned_doctor_id', req.user.id)
    : q.eq('district_id', req.user.districtId);

  const { data, error } = await q.maybeSingle();
  if (error) return res.status(500).json({ error: 'Could not load the visit.' });
  if (!data) return res.status(404).json({ error: 'No such visit available to you.' });
  return res.json({ ...data, patients: withAge(data.patients) });
};

/** PATCH /api/visits/:id — status, risk tier, or doctor assignment. */
export const updateVisit = async (req, res) => {
  const {
    status, risk_level, assigned_doctor_id, chief_complaint,
    symptom_duration_value, symptom_duration_unit,
    medical_history, known_allergies, current_medications
  } = req.body || {};

  let q = supabaseAdmin.from('visits').select('id, district_id').eq('id', req.params.id);
  q = req.user.role === 'DOCTOR'
    ? q.eq('assigned_doctor_id', req.user.id)
    : q.eq('district_id', req.user.districtId);

  const { data: existing } = await q.maybeSingle();
  if (!existing) return res.status(404).json({ error: 'No such visit available to you.' });

  const patch = {};
  if (chief_complaint !== undefined) patch.chief_complaint = chief_complaint;
  if (medical_history !== undefined) patch.medical_history = medical_history;
  if (known_allergies !== undefined) patch.known_allergies = known_allergies;
  if (current_medications !== undefined) patch.current_medications = current_medications;
  if (symptom_duration_value !== undefined || symptom_duration_unit !== undefined) {
    const text = formatDuration(symptom_duration_value, symptom_duration_unit);
    if (!text) return res.status(400).json({ error: 'Provide a positive number and a unit of days, months or years.' });
    patch.symptom_duration = text;
    patch.symptom_duration_value = Number.parseInt(symptom_duration_value, 10);
    patch.symptom_duration_unit = symptom_duration_unit;
  }
  if (status !== undefined) patch.status = status;
  if (risk_level !== undefined) {
    if (!RISK_TIERS.includes(risk_level)) {
      return res.status(400).json({ error: `risk_level must be one of: ${RISK_TIERS.join(', ')}` });
    }
    patch.risk_level = risk_level;
  }
  if (assigned_doctor_id !== undefined) {
    const { data: doc } = await supabaseAdmin
      .from('staff_profiles').select('id')
      .eq('id', assigned_doctor_id).eq('role', 'doctor').eq('status', 'active')
      .eq('district_id', existing.district_id).maybeSingle();
    if (!doc) return res.status(404).json({ error: 'That doctor is not available in this district.' });
    patch.assigned_doctor_id = assigned_doctor_id;
    patch.assigned_at = new Date().toISOString();
  }

  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update.' });

  const { data, error } = await supabaseAdmin
    .from('visits').update(patch).eq('id', req.params.id).select().single();

  if (error) return res.status(500).json({ error: 'The visit could not be updated.' });

  await logAuditEvent({
    actorId: req.user.id, actorRole: req.user.role,
    action: 'VISIT_UPDATED', entityType: 'VISITS', entityId: req.params.id,
    metadata: patch, ip: req.ip
  });

  return res.json(data);
};
