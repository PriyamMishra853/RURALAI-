import { supabaseAdmin } from '../config/supabase.js';
import { logAuditEvent } from '../middleware/audit.middleware.js';
import {
  AADHAAR_RE, digitsOnly, validateRegistration, withAge
} from '../services/patientFields.js';

/**
 * Patient records.
 *
 * The Aadhaar number is the identifier — there is no separate patient_code.
 * Registration asks for six things and derives everything else:
 *
 *   1. Aadhaar (12 digits)      4. Date of birth  -> age is computed, not asked
 *   2. Full name                5. Address: village x2, district, state, PIN
 *   3. Gender                   6. Phone (10 digits)
 *
 * Every read is scoped to the caller's own clinic district.
 */

const PATIENT_FIELDS = `
  aadhaar_number, full_name, gender, date_of_birth,
  village_line1, village_line2, address_district, address_state_id, pin_code,
  phone, abha_number, registration_mode, created_at,
  states:address_state_id ( name, code )
`;

/** POST /api/patients — register. */
export const createPatient = async (req, res) => {
  const { valid, errors, value } = validateRegistration(req.body);
  if (!valid) {
    return res.status(400).json({ error: 'Some fields need attention.', fields: errors });
  }

  // Tenancy comes from the caller's profile, never the request body.
  const { districtId, stateId } = req.user;
  if (!districtId || !stateId) {
    return res.status(403).json({ error: 'Your account has no district assigned. Contact an administrator.' });
  }

  // The address state must be a real state.
  const { data: state } = await supabaseAdmin
    .from('states').select('id').eq('id', value.address_state_id).maybeSingle();
  if (!state) {
    return res.status(400).json({ error: 'Some fields need attention.', fields: { address_state_id: 'Select a state from the list.' } });
  }

  const { data: existing } = await supabaseAdmin
    .from('patients')
    .select('aadhaar_number, clinic_district_id')
    .eq('aadhaar_number', value.aadhaar_number)
    .maybeSingle();

  if (existing) {
    // Same message either way — this must not become a way to probe whether an
    // Aadhaar is registered in some other district.
    return res.status(409).json({
      error: 'A patient is already registered with this Aadhaar number.',
      fields: { aadhaar_number: 'Already registered.' },
      registered_here: existing.clinic_district_id === districtId
    });
  }

  const { data, error } = await supabaseAdmin
    .from('patients')
    .insert([{
      ...value,
      abha_number: req.body.abha_number || null,     // only ever from ABHA OCR
      registration_mode: ['standard', 'abha_ocr', 'emergency_bypass'].includes(req.body.registration_mode)
        ? req.body.registration_mode : 'standard',
      clinic_district_id: districtId,
      clinic_state_id: stateId,
      registered_by: req.user.id,
      is_demo: false
    }])
    .select(PATIENT_FIELDS)
    .single();

  if (error) {
    console.error('patients insert failed:', error.message);
    return res.status(500).json({ error: 'The patient record could not be saved.' });
  }

  await logAuditEvent({
    actorId: req.user.id,
    actorRole: req.user.role,
    action: 'PATIENT_REGISTERED',
    entityType: 'PATIENTS',
    entityId: value.aadhaar_number,             // logger masks to ****NNNN
    metadata: { district: value.address_district, registration_mode: 'standard' },
    ip: req.ip
  });

  return res.status(201).json(withAge(data));
};

/** GET /api/patients — directory for the caller's district. */
export const getPatients = async (req, res) => {
  const { query, page = 0, pageSize = 50 } = req.query;

  let q = supabaseAdmin
    .from('patients')
    .select(PATIENT_FIELDS, { count: 'exact' })
    .eq('clinic_district_id', req.user.districtId)
    .order('created_at', { ascending: false });

  if (query) {
    const term = String(query).trim();
    // A 12-digit search term is an Aadhaar; match it exactly rather than as a
    // substring, so partial digits cannot be used to walk the keyspace.
    if (AADHAAR_RE.test(digitsOnly(term))) {
      q = q.eq('aadhaar_number', digitsOnly(term));
    } else {
      q = q.or(`full_name.ilike.%${term}%,phone.ilike.%${term}%,village_line1.ilike.%${term}%`);
    }
  }

  const from = Number(page) * Number(pageSize);
  const { data, error, count } = await q.range(from, from + Number(pageSize) - 1);

  if (error) {
    console.error('patients query failed:', error.message);
    return res.status(500).json({ error: 'Could not load the patient directory.' });
  }

  return res.json({
    total: count ?? 0,
    page: Number(page),
    pageSize: Number(pageSize),
    patients: withAge(data || [])
  });
};

/**
 * POST /api/patients/lookup  { aadhaar_number }
 *
 * A POST because the identifier travels in the body: URLs reach access logs,
 * proxy logs and browser history. This is the fast path an assistant uses for
 * a returning patient — and the urgent path, where the answer decides whether
 * to register or go straight to a visit.
 */
export const lookupByAadhaar = async (req, res) => {
  const aadhaar = digitsOnly(req.body?.aadhaar_number);
  if (!AADHAAR_RE.test(aadhaar)) {
    return res.status(400).json({ error: 'Aadhaar must be exactly 12 digits.' });
  }

  const { data } = await supabaseAdmin
    .from('patients')
    .select(PATIENT_FIELDS)
    .eq('aadhaar_number', aadhaar)
    .eq('clinic_district_id', req.user.districtId)
    .maybeSingle();

  await logAuditEvent({
    actorId: req.user.id,
    actorRole: req.user.role,
    action: data ? 'PATIENT_LOOKUP_HIT' : 'PATIENT_LOOKUP_MISS',
    entityType: 'PATIENTS',
    entityId: aadhaar,
    ip: req.ip
  });

  if (!data) {
    return res.status(404).json({ error: 'No patient is registered with that Aadhaar number at this clinic.' });
  }
  return res.json(withAge(data));
};

/** POST /api/patients/detail  { aadhaar_number } — full record, body-keyed. */
export const getPatientDetail = async (req, res) => {
  const aadhaar = digitsOnly(req.body?.aadhaar_number);
  if (!AADHAAR_RE.test(aadhaar)) {
    return res.status(400).json({ error: 'Aadhaar must be exactly 12 digits.' });
  }

  const { data, error } = await supabaseAdmin
    .from('patients')
    .select(PATIENT_FIELDS)
    .eq('aadhaar_number', aadhaar)
    .eq('clinic_district_id', req.user.districtId)
    .maybeSingle();

  if (error) return res.status(500).json({ error: 'Could not load the patient record.' });
  if (!data) return res.status(404).json({ error: 'No such patient at this clinic.' });

  const { data: visits } = await supabaseAdmin
    .from('visits')
    .select('id, visit_code, chief_complaint, symptom_duration, status, risk_level, visit_date, created_at')
    .eq('patient_id', aadhaar)
    // A withdrawn entry was opened on the wrong patient. Leaving it in this
    // history is precisely the harm withdrawing it was meant to undo.
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(100);

  return res.json({ ...withAge(data), visits: visits || [] });
};

/** PATCH /api/patients — correct a record. Aadhaar itself is immutable. */
export const updatePatient = async (req, res) => {
  const aadhaar = digitsOnly(req.body?.aadhaar_number);
  if (!AADHAAR_RE.test(aadhaar)) {
    return res.status(400).json({ error: 'Aadhaar must be exactly 12 digits.' });
  }

  const { data: existing } = await supabaseAdmin
    .from('patients').select('aadhaar_number')
    .eq('aadhaar_number', aadhaar)
    .eq('clinic_district_id', req.user.districtId)
    .maybeSingle();
  if (!existing) return res.status(404).json({ error: 'No such patient at this clinic.' });

  // Re-validate the whole payload: a partial update that skipped validation is
  // how a bad phone number or PIN gets in after registration.
  const { valid, errors, value } = validateRegistration({ ...req.body, aadhaar_number: aadhaar });
  if (!valid) return res.status(400).json({ error: 'Some fields need attention.', fields: errors });

  // The primary key never changes — a wrong Aadhaar means a new record, not an
  // edited one, or the visit history follows the wrong person.
  const { aadhaar_number: _immutable, ...patch } = value;

  const { data, error } = await supabaseAdmin
    .from('patients').update(patch).eq('aadhaar_number', aadhaar).select(PATIENT_FIELDS).single();

  if (error) return res.status(500).json({ error: 'The patient record could not be updated.' });

  await logAuditEvent({
    actorId: req.user.id, actorRole: req.user.role,
    action: 'PATIENT_UPDATED', entityType: 'PATIENTS', entityId: aadhaar,
    metadata: { fields: Object.keys(patch) }, ip: req.ip
  });

  return res.json(withAge(data));
};
