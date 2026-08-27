import { supabaseAdmin } from '../config/supabase.js';
import { logAuditEvent } from '../middleware/audit.middleware.js';
import { AADHAAR_RE, digitsOnly, withAge } from '../services/patientFields.js';
import { notify, EVENTS } from '../services/notificationService.js';
import { ROLES } from '../config/roles.js';

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
 * The rule engine and the database do not share a vocabulary.
 *
 * The engine tiers a case as LOW / MEDIUM / HIGH; the `risk_level` enum is
 * low / moderate / high / emergency. "medium" is not a value it accepts, and
 * /ai/assess returns the engine's spelling to the browser — so a screen that
 * echoed the assessment's risk back on handoff was rejected with a 400 for
 * every MEDIUM case, which is the most common tier there is. The handoff
 * looked broken because, for most patients, it was.
 *
 * Translating here means callers can pass either vocabulary and get the same
 * answer, and an unrecognised tier resolves to null rather than being written
 * through to a constraint violation.
 */
const RISK_ALIASES = {
  LOW: 'low',
  MILD: 'low',
  MEDIUM: 'moderate',
  MODERATE: 'moderate',
  HIGH: 'high',
  SEVERE: 'high',
  CRITICAL: 'emergency',
  EMERGENCY: 'emergency'
};

export const normaliseRiskTier = (value) => {
  if (value === null || value === undefined) return null;
  const key = String(value).trim().toUpperCase();
  if (!key) return null;
  return RISK_ALIASES[key] || (RISK_TIERS.includes(key.toLowerCase()) ? key.toLowerCase() : null);
};

/** Supabase returns an embedded relation as an array, or null when empty. */
const related = (value) => (Array.isArray(value) ? value : value ? [value] : []);

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
    // Accepts the engine's vocabulary as well as the enum's, so a caller
    // echoing an assessment back is not rejected for spelling.
    const tier = normaliseRiskTier(risk_level);
    if (!tier) {
      return res.status(400).json({ error: `risk_level must be one of: ${RISK_TIERS.join(', ')}` });
    }
    patch.risk_level = tier;
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

/**
 * POST /api/visits/:id/handoff  { doctor_id }  — send the case to a doctor.
 *
 * The handoff used to be a PATCH that set assigned_doctor_id and trusted
 * whatever risk tier the browser echoed back. Three things were wrong with
 * that, and all three are why the button appeared broken:
 *
 *   1. The tier came from the client, in the engine's vocabulary, and was
 *      rejected. The visit already carries a correct tier, written by
 *      /ai/assess — so it is read here rather than accepted from the caller.
 *   2. Nothing told the doctor. The case appeared only on the next refresh.
 *   3. An empty visit could be handed over, giving the doctor a case with
 *      nothing in it and no indication that anything was missing.
 *
 * What actually travels is unchanged — the doctor's case view reads the
 * vitals, symptoms, documents and images off the visit. This endpoint returns
 * a manifest of what that will be, because "sent" with no statement of what
 * was sent is what let empty cases through unnoticed.
 */
export const handOffVisit = async (req, res) => {
  const { doctor_id } = req.body || {};
  if (!doctor_id) return res.status(400).json({ error: 'doctor_id is required.' });

  const { data: visit } = await supabaseAdmin
    .from('visits')
    .select(`
      id, visit_code, district_id, status, risk_level, chief_complaint, assistant_id,
      patients ( full_name ),
      ai_assessments ( id, risk_level, created_at ),
      visit_vitals ( id ),
      visit_symptoms ( id ),
      patient_documents ( id, verified_at ),
      patient_images ( id )
    `)
    .eq('id', req.params.id)
    .eq('district_id', req.user.districtId)
    .maybeSingle();

  if (!visit) return res.status(404).json({ error: 'No such visit available to you.' });

  const { data: doctor } = await supabaseAdmin
    .from('staff_profiles')
    .select('id, full_name, email')
    .eq('id', doctor_id).eq('role', 'doctor').eq('status', 'active')
    .eq('district_id', visit.district_id)
    .maybeSingle();

  if (!doctor) return res.status(404).json({ error: 'That doctor is not available in this district.' });

  const assessments = related(visit.ai_assessments);
  const vitals = related(visit.visit_vitals);
  const symptoms = related(visit.visit_symptoms);
  const documents = related(visit.patient_documents);
  const images = related(visit.patient_images);

  const missing = [];
  if (!assessments.length) missing.push('an AI assessment');
  if (!vitals.length) missing.push('recorded vitals');
  if (!symptoms.length && !visit.chief_complaint) missing.push('a chief complaint or symptoms');

  // Refuse only a case with nothing in it at all. An incomplete case still
  // gets through, with `missing` reported back — a clinician escalating an
  // urgent patient must not be blocked because the vitals are not typed in
  // yet, and they are better served by being told what is thin than by being
  // stopped.
  if (!assessments.length && !vitals.length && !symptoms.length && !visit.chief_complaint) {
    return res.status(422).json({
      error: 'There is nothing for the doctor to review yet. Record the visit before sending it.',
      missing
    });
  }

  const latest = assessments
    .slice()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] || null;

  // The visit's own tier first — /ai/assess already stored the correct enum
  // value, including the emergency promotion for an immediate referral.
  const tier = normaliseRiskTier(visit.risk_level)
    || normaliseRiskTier(latest?.risk_level)
    || 'moderate';

  const { data: updated, error } = await supabaseAdmin
    .from('visits')
    .update({
      assigned_doctor_id: doctor.id,
      assigned_at: new Date().toISOString(),
      status: 'awaiting_doctor',
      risk_level: tier
    })
    .eq('id', visit.id)
    .select()
    .single();

  if (error) {
    console.error('case handoff failed:', error.message);
    return res.status(500).json({ error: 'The case could not be sent to the doctor.' });
  }

  const manifest = {
    ai_assessment: Boolean(latest),
    vitals: vitals.length,
    symptoms: symptoms.length,
    documents: documents.length,
    verified_documents: documents.filter((d) => d.verified_at).length,
    images: images.length
  };

  // Persisted first, then pushed — a doctor who was offline still finds the
  // case waiting. The doctor's queue refreshes on any notification, so this is
  // also what makes the case appear without a manual reload.
  await notify({
    recipients: [{ id: doctor.id, role: ROLES.DOCTOR }],
    event: EVENTS.CASE_ASSIGNED,
    payload: {
      visit_id: visit.id,
      visit_code: visit.visit_code,
      patient_name: visit.patients?.full_name || null,
      risk_level: tier,
      chief_complaint: visit.chief_complaint || null,
      // Who verified the case, carried with the notification so the doctor can
      // see it without opening anything.
      assistant_name: req.user.name,
      assistant_email: req.user.email,
      contents: manifest,
      case_url: `/doctor/cases/${visit.id}`
    }
  });

  await logAuditEvent({
    actorId: req.user.id, actorRole: req.user.role,
    action: 'CASE_HANDOFF', entityType: 'VISITS', entityId: visit.id,
    metadata: { doctor_id: doctor.id, risk_level: tier, contents: manifest, missing },
    ip: req.ip
  });

  return res.json({
    visit_id: updated.id,
    visit_code: updated.visit_code,
    status: updated.status,
    risk_level: updated.risk_level,
    doctor: { id: doctor.id, full_name: doctor.full_name },
    verified_by: { id: req.user.id, name: req.user.name, email: req.user.email },
    sent: manifest,
    missing
  });
};

/**
 * GET /api/visits/:id/review — the doctor's decision, for the assistant.
 *
 * §3.6 asks for the doctor's review to reach the assistant's portal. The
 * assistant is standing with the patient; the decision has to travel back to
 * them, not sit in the doctor's portal waiting to be asked for.
 *
 * HIGH-risk visits are excluded deliberately. Those were referred to a
 * hospital, the case is closed on this platform, and there is no doctor review
 * to return — saying so plainly is better than an empty object that looks like
 * a review is still pending.
 */
export const getVisitReview = async (req, res) => {
  let q = supabaseAdmin
    .from('visits')
    .select(`
      id, visit_code, status, risk_level, chief_complaint,
      patients ( full_name ),
      doctor:assigned_doctor_id ( full_name ),
      doctor_reviews ( id, decision, clinical_notes, agreed_with_ai, created_at ),
      prescriptions ( id, prescription_code, items, advice, signed_at )
    `)
    .eq('id', req.params.id);

  q = req.user.role === 'DOCTOR'
    ? q.eq('assigned_doctor_id', req.user.id)
    : q.eq('district_id', req.user.districtId);

  const { data, error } = await q.maybeSingle();
  if (error) return res.status(500).json({ error: 'Could not load the review.' });
  if (!data) return res.status(404).json({ error: 'No such visit available to you.' });

  const reviews = Array.isArray(data.doctor_reviews) ? data.doctor_reviews : [];
  const latest = reviews.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] || null;

  if (data.risk_level === 'emergency' || data.status === 'referred') {
    return res.json({
      visit_id: data.id,
      visit_code: data.visit_code,
      closed: true,
      reason: 'This case was referred to hospital and is closed on this platform. '
        + 'It will be reviewed offline by the receiving facility.',
      review: null,
      prescription: null
    });
  }

  return res.json({
    visit_id: data.id,
    visit_code: data.visit_code,
    status: data.status,
    patient_name: data.patients?.full_name,
    doctor_name: data.doctor?.full_name,
    closed: false,
    pending: !latest,
    review: latest,
    prescription: (data.prescriptions || [])[0] || null
  });
};
