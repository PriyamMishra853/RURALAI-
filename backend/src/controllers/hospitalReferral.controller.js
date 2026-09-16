import { supabaseAdmin } from '../config/supabase.js';
import { logAuditEvent } from '../middleware/audit.middleware.js';
import { notify } from '../services/notificationService.js';
import { withAge } from '../services/patientFields.js';
import {
  buildReferral, planUpdate, publicView, sortForFollowUp, isOverdue, OPEN_STATUSES
} from '../services/hospitalReferralRules.js';
import {
  REFERRAL_FIELDS, insertReferral, fetchInDistrict, findByToken, rotateAckToken, applyGuardedUpdate
} from '../services/hospitalReferralService.js';

/**
 * Closed-loop hospital referral: HTTP (Roadmap v3, Phase 1).
 *
 * Staff routes are district-scoped: a referral is followed up by the clinic it
 * came from. Public routes are reached by a token printed on the referral slip
 * and see a deliberately small view — see publicView().
 */

const first = (v) => (Array.isArray(v) ? v[0] : v) || null;
const withoutJoins = ({ visits, ...rest }) => rest;

const INVALID_LINK = 'This referral link is not valid, or it has expired. Ask the referring clinic for a new one.';

/**
 * POST /api/referral-tracking   (clinic assistant)
 *   { visit_id, hospital_name, hospital_district? }
 *
 * The emergency path: the assistant confirms the patient is being sent. A
 * routine referral is a doctor's decision and is tracked when they record it.
 */
export const createReferral = async (req, res) => {
  const { visit_id: visitId, hospital_name: hospitalName, hospital_district: hospitalDistrict } = req.body || {};
  if (!visitId) return res.status(400).json({ error: 'Choose the visit being referred.' });

  const { data: visit, error } = await supabaseAdmin
    .from('visits')
    .select('id, district_id, patient_id, risk_level, status')
    .eq('id', visitId)
    .eq('district_id', req.user.districtId)
    .maybeSingle();

  if (error) return res.status(500).json({ error: 'Could not load the visit.' });
  if (!visit) return res.status(404).json({ error: 'That visit is not in your district.' });

  if (!['high', 'emergency'].includes(String(visit.risk_level || '').toLowerCase())) {
    return res.status(409).json({
      error: "A routine referral is the doctor's decision. It is tracked automatically when the doctor records it."
    });
  }

  const built = buildReferral({
    visit, hospitalName, hospitalDistrict, origin: 'emergency', referredBy: req.user.id
  });
  if (!built.ok) return res.status(built.status).json({ error: built.error });

  const { data, error: insertError } = await insertReferral(built.value);
  if (insertError) {
    if (insertError.code === '23505') {
      return res.status(409).json({ error: 'This patient already has a referral being followed up.' });
    }
    console.error('emergency referral insert failed:', insertError.message);
    return res.status(500).json({ error: 'The referral could not be saved.' });
  }

  await logAuditEvent({
    actorId: req.user.id, actorRole: req.user.role, action: 'HOSPITAL_REFERRAL_CREATED',
    entityType: 'VISITS', entityId: visit.id,
    metadata: { referral_id: data.id, referral_code: data.referral_code, origin: 'emergency' },
    ip: req.ip
  });

  // The token leaves the server exactly once, here, to be printed or shared.
  return res.status(201).json({ referral: data, ack_path: `/r/${built.token}` });
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/referral-tracking?scope=open|all
 * GET /api/referral-tracking?visit_id=<uuid>
 *
 * The follow-up worklist: overdue first, then whatever needs an answer soonest.
 *
 * With visit_id it is one case's referral history instead, for the case view:
 * every status, newest first. A referral that ended as "did not reach" is still
 * the answer the assistant looking at that case needs, so scope does not apply.
 * District scoping does — a visit id from another district finds nothing.
 */
export const listReferrals = async (req, res) => {
  const { visit_id: visitId } = req.query;
  // Checked here because Postgres would refuse a malformed uuid with a 500.
  if (visitId !== undefined && !(typeof visitId === 'string' && UUID_RE.test(visitId))) {
    return res.status(400).json({ error: 'visit_id is not a valid visit id.' });
  }
  const all = Boolean(visitId) || req.query.scope === 'all';

  let query = supabaseAdmin
    .from('hospital_referrals')
    .select(`${REFERRAL_FIELDS}, visits ( visit_code, risk_level, patients ( full_name, gender, date_of_birth ) )`)
    .eq('district_id', req.user.districtId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (visitId) query = query.eq('visit_id', visitId);
  if (!all) query = query.in('status', OPEN_STATUSES);

  const { data, error } = await query;
  if (error) {
    console.error('referral worklist failed:', error.message);
    return res.status(500).json({ error: 'Could not load referrals.' });
  }

  const now = new Date();
  const rows = (data || []).map((row) => {
    const visit = first(row.visits);
    return {
      ...withoutJoins(row),
      overdue: isOverdue(row, now),
      visit_code: visit?.visit_code || null,
      risk_level: visit?.risk_level || null,
      patient: visit ? withAge(first(visit.patients)) : null
    };
  });
  // A case's history reads in the order it happened; only the worklist is triaged.
  const referrals = visitId ? rows : sortForFollowUp(rows, now);

  return res.json({
    referrals,
    counts: {
      overdue: referrals.filter((r) => r.overdue).length,
      open: referrals.filter((r) => OPEN_STATUSES.includes(r.status)).length
    }
  });
};

/**
 * POST /api/referral-tracking/:id/:action
 *   reached · not_reached { reason } · outcome { outcome } · lost   — each with optional { notes }
 */
export const actOnReferral = async (req, res) => {
  const { data: referral, error } = await fetchInDistrict(req.params.id, req.user.districtId);
  if (error) return res.status(500).json({ error: 'Could not load the referral.' });

  const plan = planUpdate({ referral, action: req.params.action, actor: 'staff', body: req.body });
  if (!plan.ok) return res.status(plan.status).json({ error: plan.error });
  if (plan.unchanged) return res.json({ referral: withoutJoins(referral), unchanged: true });

  const { data, error: updateError } = await applyGuardedUpdate(referral, {
    ...plan.patch, last_updated_by: req.user.id
  });
  if (updateError) {
    console.error('referral update failed:', updateError.message);
    return res.status(500).json({ error: 'The update could not be saved.' });
  }
  if (!data) {
    return res.status(409).json({ error: 'This referral changed while you were updating it. Reload and try again.' });
  }

  await logAuditEvent({
    actorId: req.user.id, actorRole: req.user.role,
    action: `HOSPITAL_REFERRAL_${req.params.action.toUpperCase()}`,
    entityType: 'VISITS', entityId: referral.visit_id,
    metadata: {
      referral_id: referral.id, from: referral.status, to: data.status,
      outcome: data.outcome, reason: data.not_reached_reason
    },
    ip: req.ip
  });

  return res.json({ referral: data });
};

/** POST /api/referral-tracking/:id/ack-link — a fresh hospital link; the old one stops working. */
export const rotateAckLink = async (req, res) => {
  const { data: referral, error } = await fetchInDistrict(req.params.id, req.user.districtId);
  if (error) return res.status(500).json({ error: 'Could not load the referral.' });
  if (!referral) return res.status(404).json({ error: 'No such referral.' });
  if (referral.status === 'closed') {
    return res.status(409).json({ error: 'This referral is closed; the hospital has nothing left to record.' });
  }

  const rotated = await rotateAckToken(referral.id);
  if (rotated.error) return res.status(500).json({ error: 'A new link could not be issued.' });

  await logAuditEvent({
    actorId: req.user.id, actorRole: req.user.role, action: 'HOSPITAL_REFERRAL_LINK_ISSUED',
    entityType: 'VISITS', entityId: referral.visit_id, metadata: { referral_id: referral.id }, ip: req.ip
  });

  return res.json({
    referral_code: referral.referral_code,
    ack_path: `/r/${rotated.token}`,
    expires_at: rotated.expiresAt
  });
};

/* ── Public: the hospital desk, no account ───────────────────────────────── */

const publicDetails = async (referral) => {
  const [{ data: patient }, { data: district }] = await Promise.all([
    referral.patient_id
      ? supabaseAdmin.from('patients').select('full_name, gender, date_of_birth')
        .eq('aadhaar_number', referral.patient_id).maybeSingle()
      : Promise.resolve({ data: null }),
    referral.district_id
      ? supabaseAdmin.from('districts').select('name').eq('id', referral.district_id).maybeSingle()
      : Promise.resolve({ data: null })
  ]);
  return publicView({ referral, patient: patient ? withAge(patient) : null, districtName: district?.name });
};

/** GET /api/public/referrals/:token */
export const getPublicReferral = async (req, res) => {
  const referral = await findByToken(req.params.token);
  if (!referral) return res.status(404).json({ error: INVALID_LINK });
  return res.json({ referral: await publicDetails(referral) });
};

/**
 * POST /api/public/referrals/:token/:action   — reached · outcome { outcome }
 *
 * The one clinical write reachable without signing in, so it is the narrowest
 * one: forward-only, no notes, no corrections, audited with no staff actor.
 */
export const actOnPublicReferral = async (req, res) => {
  const referral = await findByToken(req.params.token);
  if (!referral) return res.status(404).json({ error: INVALID_LINK });

  const plan = planUpdate({ referral, action: req.params.action, actor: 'hospital', body: req.body });
  if (!plan.ok) return res.status(plan.status).json({ error: plan.error });
  if (plan.unchanged) return res.json({ referral: await publicDetails(referral), unchanged: true });

  const { data, error } = await applyGuardedUpdate(referral, plan.patch);
  if (error) {
    console.error('public referral update failed:', error.message);
    return res.status(500).json({ error: 'That could not be saved. Try again in a moment.' });
  }
  if (!data) return res.status(409).json({ error: 'Someone updated this referral a moment ago. Reload the page.' });

  await logAuditEvent({
    actorId: null, actorRole: null,
    action: `HOSPITAL_REFERRAL_${req.params.action.toUpperCase()}`,
    entityType: 'VISITS', entityId: referral.visit_id,
    metadata: { referral_id: referral.id, via: 'hospital_link', from: referral.status, to: data.status, outcome: data.outcome },
    ip: req.ip
  });

  // Tell whoever is waiting to find out. Identifiers only; the name is on the case.
  const recipients = new Map();
  if (referral.referred_by) {
    recipients.set(referral.referred_by, {
      id: referral.referred_by,
      role: referral.origin === 'emergency' ? 'CLINIC_ASSISTANT' : 'DOCTOR'
    });
  }
  const assistantId = first(referral.visits)?.assistant_id;
  if (assistantId) recipients.set(assistantId, { id: assistantId, role: 'CLINIC_ASSISTANT' });

  if (plan.event && recipients.size) {
    await notify({
      consultationId: null,
      recipients: [...recipients.values()],
      event: plan.event,
      payload: {
        referral_id: referral.id,
        visit_id: referral.visit_id,
        patient_id: referral.patient_id,
        referral_code: referral.referral_code,
        hospital_name: referral.hospital_name,
        status: data.status,
        outcome: data.outcome || null
      }
    });
  }

  return res.json({ referral: await publicDetails({ ...referral, ...data }) });
};
