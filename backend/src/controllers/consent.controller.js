import { supabaseAdmin } from '../config/supabase.js';
import { logAuditEvent } from '../middleware/audit.middleware.js';
import { AADHAAR_RE, digitsOnly } from '../services/patientFields.js';
import {
  buildConsent, planWithdrawal, consentState, WORDING, WORDING_VERSION
} from '../services/consentRules.js';

/**
 * Patient consent (Roadmap v3, Phase 3).
 *
 * The Aadhaar number is the patient key and never travels in a URL, so these
 * are POSTs with the number in the body, exactly like patient lookup.
 *
 * Everything here is district-scoped: consent is recorded by the clinic the
 * patient attends, and cannot be recorded — or read — from another district.
 */

export const CONSENT_FIELDS = `
  id, patient_id, purpose, status, method, language, wording_version,
  granted_at, expires_at, withdrawn_at, withdrawn_reason, note, created_at
`;

const patientInDistrict = async (aadhaarRaw, districtId) => {
  const aadhaar = digitsOnly(aadhaarRaw);
  if (!AADHAAR_RE.test(aadhaar)) return { error: { status: 400, message: 'A 12-digit Aadhaar number is required.' } };
  const { data } = await supabaseAdmin
    .from('patients').select('aadhaar_number, full_name')
    .eq('aadhaar_number', aadhaar).eq('clinic_district_id', districtId).maybeSingle();
  if (!data) return { error: { status: 404, message: 'No such patient in your district.' } };
  return { patient: data };
};

export const consentsFor = async (patientId) => {
  const { data, error } = await supabaseAdmin
    .from('patient_consents').select(CONSENT_FIELDS)
    .eq('patient_id', patientId)
    .order('granted_at', { ascending: false })
    .limit(50);
  return { consents: data || [], error };
};

/** POST /api/patients/consents — what this patient has agreed to. */
export const getConsents = async (req, res) => {
  const { patient, error } = await patientInDistrict(req.body?.aadhaar_number, req.user.districtId);
  if (error) return res.status(error.status).json({ error: error.message });

  const { consents, error: readError } = await consentsFor(patient.aadhaar_number);
  if (readError) {
    console.error('consent read failed:', readError.message);
    return res.status(500).json({ error: 'Consent could not be read.' });
  }

  return res.json({
    state: consentState(consents),
    history: consents,
    // The wording that must be read out, so the screen and the record cannot
    // drift apart: what is stored says which version was used.
    wording: WORDING,
    wording_version: WORDING_VERSION
  });
};

/** POST /api/patients/consents/grant — { aadhaar_number, purpose, method, language, note? } */
export const grantConsent = async (req, res) => {
  const { patient, error } = await patientInDistrict(req.body?.aadhaar_number, req.user.districtId);
  if (error) return res.status(error.status).json({ error: error.message });

  const built = buildConsent({
    patientId: patient.aadhaar_number,
    districtId: req.user.districtId,
    purpose: req.body?.purpose,
    method: req.body?.method,
    language: req.body?.language,
    note: req.body?.note,
    recordedBy: req.user.id
  });
  if (!built.ok) return res.status(built.status).json({ error: built.error });

  // Asking again replaces the standing answer: the old one is withdrawn so the
  // history still shows it existed, and the unique index stays satisfied.
  const { error: supersedeError } = await supabaseAdmin
    .from('patient_consents')
    .update({
      status: 'withdrawn',
      withdrawn_at: new Date().toISOString(),
      withdrawn_reason: 'replaced by a new consent',
      withdrawn_by: req.user.id,
      updated_at: new Date().toISOString()
    })
    .eq('patient_id', patient.aadhaar_number)
    .eq('purpose', built.value.purpose)
    .eq('status', 'granted');
  if (supersedeError) {
    console.error('consent supersede failed:', supersedeError.message);
    return res.status(500).json({ error: 'The consent could not be recorded.' });
  }

  const { data, error: insertError } = await supabaseAdmin
    .from('patient_consents').insert([built.value]).select(CONSENT_FIELDS).single();
  if (insertError) {
    console.error('consent insert failed:', insertError.message);
    return res.status(500).json({ error: 'The consent could not be recorded.' });
  }

  await logAuditEvent({
    actorId: req.user.id, actorRole: req.user.role,
    action: 'PATIENT_CONSENT_GRANTED', entityType: 'PATIENTS', entityId: patient.aadhaar_number,
    metadata: { purpose: data.purpose, method: data.method, language: data.language, wording_version: data.wording_version },
    ip: req.ip
  });

  const { consents } = await consentsFor(patient.aadhaar_number);
  return res.status(201).json({ consent: data, state: consentState(consents) });
};

/** POST /api/patients/consents/withdraw — { aadhaar_number, purpose, reason? } */
export const withdrawConsent = async (req, res) => {
  const { patient, error } = await patientInDistrict(req.body?.aadhaar_number, req.user.districtId);
  if (error) return res.status(error.status).json({ error: error.message });

  const { data: standing } = await supabaseAdmin
    .from('patient_consents').select(CONSENT_FIELDS)
    .eq('patient_id', patient.aadhaar_number)
    .eq('purpose', req.body?.purpose)
    .eq('status', 'granted')
    .maybeSingle();

  const plan = planWithdrawal({ consent: standing, reason: req.body?.reason, withdrawnBy: req.user.id });
  if (!plan.ok) return res.status(plan.status).json({ error: plan.error });

  const { data, error: updateError } = await supabaseAdmin
    .from('patient_consents')
    .update({ ...plan.patch, updated_at: new Date().toISOString() })
    .eq('id', standing.id)
    .eq('status', 'granted')
    .select(CONSENT_FIELDS)
    .maybeSingle();
  if (updateError) {
    console.error('consent withdrawal failed:', updateError.message);
    return res.status(500).json({ error: 'The withdrawal could not be saved.' });
  }
  if (!data) return res.status(409).json({ error: 'That consent changed while you were withdrawing it. Reload and try again.' });

  await logAuditEvent({
    actorId: req.user.id, actorRole: req.user.role,
    action: 'PATIENT_CONSENT_WITHDRAWN', entityType: 'PATIENTS', entityId: patient.aadhaar_number,
    metadata: { purpose: data.purpose, reason: data.withdrawn_reason }, ip: req.ip
  });

  const { consents } = await consentsFor(patient.aadhaar_number);
  return res.json({ consent: data, state: consentState(consents) });
};
