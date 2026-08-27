import { supabaseAdmin } from '../config/supabase.js';
import { logAuditEvent } from '../middleware/audit.middleware.js';
import { withAge } from '../services/patientFields.js';
import { istDateString } from '../services/schedulingService.js';
import { notify, EVENTS } from '../services/notificationService.js';

/**
 * The doctor's caseload.
 *
 * Spec §3.8, as clarified: a doctor reviews the cases assigned to them,
 * day-wise, across every risk tier — ordered worst first so an emergency is
 * never below a routine case. v1 returned a global queue with no assignment
 * filter, which meant every doctor saw every patient in the country.
 */

// Worst first. Postgres would sort the enum in declaration order (low ->
// emergency), which is the wrong direction, so ordering is done here.
const RISK_ORDER = { emergency: 0, high: 1, moderate: 2, low: 3 };

const QUEUE_FIELDS = `
  id, visit_code, status, risk_level, chief_complaint, symptom_duration,
  medical_history, known_allergies, current_medications,
  visit_date, created_at, assigned_at,
  patients ( aadhaar_number, full_name, gender, date_of_birth, village_line1, village_line2, address_district, phone ),
  ai_assessments ( risk_level, patient_summary, first_aid_steps, protocol_matches, warnings, missing_information, recommended_next_action, generated_by, created_at ),
  assistant:assistant_id ( id, full_name, email )
`;

/**
 * GET /api/doctor/queue?date=YYYY-MM-DD
 * Defaults to today in IST, matching the generated `visit_date` column.
 */
export const getDoctorQueue = async (req, res) => {
  const { date, includeCompleted } = req.query;

  const today = istDateString();
  const targetDate = date || today;

  // A doctor's open queue is today's work. Past days are viewable as history
  // (read-only, see getDoctorCaseDetails) but never presented as actionable —
  // an untouched case from last week is a governance problem for an
  // administrator, not something to quietly action now as if it were fresh.
  const isPast = targetDate < today;

  let q = supabaseAdmin
    .from('visits')
    .select(QUEUE_FIELDS)
    .eq('assigned_doctor_id', req.user.id)   // the caseload rule
    .eq('visit_date', targetDate);

  if (includeCompleted !== 'true') {
    // `referred` is a closed outcome too — the doctor acted on it. Leaving it
    // in the open queue meant a case the doctor had just escalated still
    // showed as work waiting to be done.
    q = q.not('status', 'in', '("completed","cancelled","referred")');
  }

  const { data, error } = await q.limit(500);
  if (error) {
    console.error('doctor queue failed:', error.message);
    return res.status(500).json({ error: 'Could not load your case queue.' });
  }

  const cases = (data || []).sort((a, b) => {
    const r = (RISK_ORDER[a.risk_level] ?? 9) - (RISK_ORDER[b.risk_level] ?? 9);
    return r !== 0 ? r : new Date(a.created_at) - new Date(b.created_at);
  });

  const counts = { emergency: 0, high: 0, moderate: 0, low: 0 };
  for (const c of cases) if (c.risk_level in counts) counts[c.risk_level] += 1;

  // Age is derived from date_of_birth per request, never stored.
  const withPatientAge = cases.map((c) => ({ ...c, patients: withAge(c.patients) }));

  return res.json({
    date: targetDate,
    is_past: isPast,
    // Drives the read-only banner and disables the Review action client-side;
    // the server enforces it again in recordDoctorReview's own date check.
    read_only: isPast,
    total: cases.length,
    counts,
    cases: withPatientAge
  });
};

/**
 * GET /api/doctor/queue/dates — days that still have work, for the day picker.
 *
 * Must use exactly the same filter as getDoctorQueue. When this counted
 * completed visits and the queue hid them, the picker advertised "Aug 26: 1"
 * and then showed an empty list for that day.
 */
export const getQueueDates = async (req, res) => {
  const { data } = await supabaseAdmin
    .from('visits')
    .select('visit_date, risk_level')
    .eq('assigned_doctor_id', req.user.id)
    .not('status', 'in', '("completed","cancelled","referred")')
    // Only today onwards: the picker must not advertise a past day as work
    // waiting to be done.
    .gte('visit_date', istDateString())
    .order('visit_date', { ascending: false })
    .limit(2000);

  const byDate = new Map();
  for (const v of data || []) {
    if (!byDate.has(v.visit_date)) byDate.set(v.visit_date, { date: v.visit_date, total: 0, urgent: 0 });
    const row = byDate.get(v.visit_date);
    row.total += 1;
    if (v.risk_level === 'emergency' || v.risk_level === 'high') row.urgent += 1;
  }

  return res.json({ dates: [...byDate.values()] });
};

/**
 * GET /api/doctor/cases/:id — one case, only if it is assigned to the caller.
 *
 * Ownership is checked in the query itself rather than after the fetch, so a
 * doctor cannot read another doctor's case by guessing a visit id.
 *
 * `patient_images` carries the wound photographs and the vision model's
 * reading of them. They were being captured, analysed and stored all along,
 * but this query never asked for them — so the one part of a case that cannot
 * be reconstructed from text was the part that never reached the doctor.
 *
 * Note: the select below is a PostgREST query string, not JavaScript. It
 * cannot carry `//` comments.
 */
export const getDoctorCaseDetails = async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('visits')
    .select(`
      ${QUEUE_FIELDS},
      visit_vitals ( temperature_f, blood_pressure_systolic, blood_pressure_diastolic,
                     pulse_bpm, spo2_percent, respiratory_rate, blood_glucose_mgdl, recorded_at ),
      visit_symptoms ( description, source, created_at ),
      patient_documents ( id, document_type, ocr_text, extracted_data, verified_at, created_at ),
      patient_images ( id, image_url, storage_path, observation, severity_impression, engine, created_at ),
      doctor_reviews ( id, decision, clinical_notes, agreed_with_ai, created_at ),
      prescriptions ( id, prescription_code, items, advice, signed_at )
    `)
    .eq('id', req.params.id)
    .eq('assigned_doctor_id', req.user.id)
    .maybeSingle();

  if (error) return res.status(500).json({ error: 'Could not load the case.' });
  if (!data) return res.status(404).json({ error: 'That case is not assigned to you.' });

  await logAuditEvent({
    actorId: req.user.id, actorRole: req.user.role,
    action: 'CASE_OPENED', entityType: 'VISITS', entityId: req.params.id, ip: req.ip
  });

  return res.json({ ...data, patients: withAge(data.patients) });
};

/**
 * POST /api/doctor/cases/:id/review — the doctor's decision.
 *
 * Accepts the diagnosis, notes and prescription the case view actually
 * collects, not just a decision code. The earlier version validated a
 * `decision` field the frontend never sent, so every review failed with
 * "decision must be one of: ..." no matter what the doctor chose.
 */
export const recordDoctorReview = async (req, res) => {
  const {
    decision, diagnosis, clinical_notes, agreed_with_ai,
    prescriptions = [], referral_hospital, follow_up_days
  } = req.body || {};

  const ALLOWED = ['treat_locally', 'prescribe', 'refer_hospital', 'follow_up', 'no_action_needed'];
  if (!ALLOWED.includes(decision)) {
    return res.status(400).json({ error: `decision must be one of: ${ALLOWED.join(', ')}` });
  }
  if (!diagnosis || !String(diagnosis).trim()) {
    return res.status(400).json({ error: 'A diagnosis is required to close a case.' });
  }
  if (decision === 'refer_hospital' && !String(referral_hospital || '').trim()) {
    return res.status(400).json({ error: 'Name the hospital you are referring the patient to.' });
  }

  const meds = Array.isArray(prescriptions)
    ? prescriptions.filter((m) => m && String(m.name || '').trim())
    : [];
  if (decision === 'prescribe' && !meds.length) {
    return res.status(400).json({ error: 'Add at least one medicine, or choose a different decision.' });
  }

  const { data: visit } = await supabaseAdmin
    .from('visits')
    .select('id, visit_date, status, visit_code, assistant_id, patients ( full_name )')
    .eq('id', req.params.id)
    .eq('assigned_doctor_id', req.user.id)
    .maybeSingle();
  if (!visit) return res.status(404).json({ error: 'That case is not assigned to you.' });

  // Re-checked here and not only in the UI: a tab left open overnight would
  // otherwise still be able to close yesterday's case as if it were today's.
  if (visit.visit_date && visit.visit_date < istDateString()) {
    return res.status(409).json({
      error: 'This case is from a previous day and is read-only. Ask an administrator to reassign it if it still needs review.'
    });
  }
  if (visit.status === 'completed' || visit.status === 'referred') {
    return res.status(409).json({ error: 'This case has already been reviewed.' });
  }

  const { data, error } = await supabaseAdmin
    .from('doctor_reviews')
    .insert([{
      visit_id: req.params.id,
      doctor_id: req.user.id,
      decision,
      // The diagnosis is the clinically important half of the note, so it is
      // stored with the notes rather than discarded as the old version did.
      clinical_notes: [
        `Diagnosis: ${String(diagnosis).trim()}`,
        clinical_notes ? `Notes: ${String(clinical_notes).trim()}` : null,
        decision === 'refer_hospital' ? `Referred to: ${referral_hospital}` : null,
        decision === 'follow_up' && follow_up_days ? `Follow up in ${follow_up_days} day(s)` : null
      ].filter(Boolean).join(String.fromCharCode(10)),
      agreed_with_ai: typeof agreed_with_ai === 'boolean' ? agreed_with_ai : null
    }])
    .select()
    .single();

  if (error) {
    console.error('doctor_reviews insert failed:', error.message);
    return res.status(500).json({ error: 'The review could not be saved.' });
  }

  // A signed prescription is a separate clinical record, not a note.
  let prescriptionId = null;
  if (meds.length) {
    const { data: rx, error: rxErr } = await supabaseAdmin
      .from('prescriptions')
      .insert([{
        visit_id: req.params.id,
        doctor_id: req.user.id,
        prescription_code: `RX-${new Date().getFullYear()}-${Date.now().toString().slice(-8)}`,
        items: meds.map((m) => ({
          name: String(m.name).trim(),
          strength: m.strength || '',
          frequency: m.frequency || '',
          duration: m.duration || '',
          instructions: m.instructions || ''
        })),
        advice: clinical_notes || null
      }])
      .select('id, prescription_code')
      .single();

    if (rxErr) console.warn('prescription insert failed:', rxErr.message);
    else prescriptionId = rx.id;
  }

  const nextStatus = decision === 'refer_hospital' ? 'referred' : 'completed';
  await supabaseAdmin.from('visits').update({ status: nextStatus }).eq('id', req.params.id);

  await logAuditEvent({
    actorId: req.user.id, actorRole: req.user.role,
    action: 'DOCTOR_REVIEW_RECORDED', entityType: 'VISITS',
    entityId: req.params.id,
    metadata: { decision, agreed_with_ai, medicines: meds.length }, ip: req.ip
  });

  /*
   * Close the loop back to the assistant — spec §3.6.
   *
   * The assistant is standing with the patient waiting to know what to do.
   * Before this, the doctor's decision lived only in the doctor's portal and
   * the assistant had no way to learn it without asking.
   *
   * HIGH-risk cases are excluded on purpose: those were referred, the case is
   * already closed on this platform, and a doctor review does not exist for
   * them to send.
   */
  if (visit.assistant_id) {
    await notify({
      consultationId: null,
      recipients: [{ id: visit.assistant_id, role: 'CLINIC_ASSISTANT' }],
      event: EVENTS.REVIEW_COMPLETED,
      payload: {
        visit_id: req.params.id,
        visit_code: visit.visit_code,
        patient_name: visit.patients?.full_name,
        doctor_name: req.user.name,
        decision,
        diagnosis: String(diagnosis).trim(),
        medicines: meds.length,
        prescription_id: prescriptionId,
        status: nextStatus
      }
    });
  }

  return res.status(201).json({ review: data, prescription_id: prescriptionId, visit_status: nextStatus });
};

/**
 * GET /api/doctor/directory — doctors in the caller's district.
 *
 * A roster, not clinical data, so assistants may read it to choose a doctor.
 * Still district-scoped: there is no reason for an assistant in Ballia to
 * enumerate the doctors of Agra.
 */
export const listDoctors = async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('staff_profiles')
    .select('id, full_name, preferred_language, doctor_profiles ( specialization, qualification, years_of_experience, is_available_for_consultation )')
    .eq('role', 'doctor')
    .eq('status', 'active')
    .eq('district_id', req.user.districtId)
    .order('full_name');

  if (error) return res.status(500).json({ error: 'Could not load the doctor directory.' });

  return res.json({
    doctors: (data || []).map((d) => ({
      id: d.id,
      name: d.full_name,
      specialization: d.doctor_profiles?.specialization || 'General Medicine',
      qualification: d.doctor_profiles?.qualification || '',
      years_of_experience: d.doctor_profiles?.years_of_experience ?? null,
      languages: d.preferred_language,
      available: d.doctor_profiles?.is_available_for_consultation ?? true
    }))
  });
};
