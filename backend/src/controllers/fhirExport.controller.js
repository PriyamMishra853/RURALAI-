import { supabaseAdmin } from '../config/supabase.js';
import { logAuditEvent } from '../middleware/audit.middleware.js';
import { ROLES } from '../config/roles.js';
import { buildVisitBundle, bundleProblems } from '../services/fhirBundle.js';
import { isEnabled, FEATURES } from '../config/features.js';
import { consentsFor } from './consent.controller.js';
import { refusalForSharing } from '../services/consentRules.js';

/**
 * GET /api/visits/:id/fhir — the visit as a FHIR R4 document.
 *
 * Scoped exactly as the case is: an assistant may export a visit in their
 * district, a doctor one assigned to them. An export is a disclosure, so it is
 * audited like one — who exported which visit, and how much of it left.
 */

const first = (v) => (Array.isArray(v) ? v[0] : v) || null;

/** The review stores "Diagnosis: …" as the first line of its notes. */
const diagnosisFrom = (review) => {
  const line = String(review?.clinical_notes || '').split('\n').find((l) => l.startsWith('Diagnosis:'));
  return line ? line.slice('Diagnosis:'.length).trim() : null;
};

export const exportVisitAsFhir = async (req, res) => {
  let query = supabaseAdmin
    .from('visits')
    .select(`
      id, visit_code, status, created_at, district_id, chief_complaint, symptom_duration,
      medical_history, known_allergies, current_medications, is_pregnant, intake_started_at,
      intake_provenance, assistant_id, assigned_doctor_id,
      patients ( patient_uid, aadhaar_number, full_name, gender, date_of_birth, village_line1, village_line2, address_district, pin_code ),
      visit_vitals ( temperature_f, blood_pressure_systolic, blood_pressure_diastolic, pulse_bpm,
                     spo2_percent, respiratory_rate, blood_glucose_mgdl, weight_kg, height_cm, recorded_at ),
      doctor_reviews ( clinical_notes, decision, created_at ),
      prescriptions ( items, signed_at )
    `)
    .eq('id', req.params.id)
    .is('deleted_at', null);

  query = req.user.role === ROLES.DOCTOR
    ? query.eq('assigned_doctor_id', req.user.id)
    : query.eq('district_id', req.user.districtId);

  const { data: visit, error } = await query.maybeSingle();
  if (error) {
    console.error('fhir export read failed:', error.message);
    return res.status(500).json({ error: 'The visit could not be read.' });
  }
  if (!visit) return res.status(404).json({ error: 'No such visit in your scope.' });

  const patient = first(visit.patients);
  if (!patient?.patient_uid) {
    // Migration 20 gives every patient one. Without it the export would have to
    // fall back to the Aadhaar number, and it will not.
    return res.status(409).json({ error: 'This patient has no internal identifier yet, so the record cannot be exported.' });
  }

  /*
   * The gate (Roadmap v3, Phase 3). This is the one route that sends a whole
   * record out of the clinic, so it is the one that has to ask whether the
   * patient agreed to that. Treatment consent does not cover it: being treated
   * here is not agreeing to be sent elsewhere.
   */
  if (isEnabled(FEATURES.PATIENT_CONSENT)) {
    const { consents } = await consentsFor(patient.aadhaar_number);
    const refusal = refusalForSharing(consents);
    if (refusal) {
      await logAuditEvent({
        actorId: req.user.id, actorRole: req.user.role,
        action: 'VISIT_EXPORT_REFUSED_NO_CONSENT', entityType: 'VISITS', entityId: visit.id,
        metadata: { reason: refusal }, ip: req.ip
      });
      return res.status(403).json({ error: refusal, needs: 'share_with_facility' });
    }
  }

  const [{ data: district }, { data: staff }] = await Promise.all([
    supabaseAdmin.from('districts').select('name').eq('id', visit.district_id).maybeSingle(),
    supabaseAdmin.from('staff_profiles').select('id, full_name')
      .in('id', [visit.assigned_doctor_id, visit.assistant_id].filter(Boolean))
  ]);

  const byId = Object.fromEntries((staff || []).map((s) => [s.id, s]));
  const review = first(visit.doctor_reviews);

  let referral = null;
  const { data: referralRow } = await supabaseAdmin
    .from('hospital_referrals')
    .select('hospital_name, referral_code, status, urgency, created_at')
    .eq('visit_id', visit.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (referralRow) referral = referralRow;

  const bundle = buildVisitBundle({
    patient,
    visit,
    vitals: first(visit.visit_vitals) || {},
    provenance: visit.intake_provenance || null,
    district,
    diagnosis: diagnosisFrom(review),
    review,
    prescription: first(visit.prescriptions),
    referral,
    doctor: byId[visit.assigned_doctor_id] || null,
    assistant: byId[visit.assistant_id] || null
  });

  // Never hand over a document we know is malformed: a receiving system would
  // reject it anyway, and an Aadhaar number leaking through would be worse.
  const problems = bundleProblems(bundle, { aadhaar: patient.aadhaar_number });
  if (problems.length) {
    console.error('fhir bundle rejected by its own check:', problems.join('; '));
    return res.status(500).json({ error: 'The record could not be exported in a valid form.' });
  }

  await logAuditEvent({
    actorId: req.user.id, actorRole: req.user.role,
    action: 'VISIT_EXPORTED_FHIR', entityType: 'VISITS', entityId: visit.id,
    metadata: { resources: bundle.entry.length, format: 'fhir-r4-document' }, ip: req.ip
  });

  res.type('application/fhir+json');
  return res.json(bundle);
};
