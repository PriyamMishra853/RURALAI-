import { supabaseAdmin } from '../config/supabase.js';
import { logAuditEvent } from '../middleware/audit.middleware.js';
import { istDateString } from '../services/schedulingService.js';
import { notify } from '../services/notificationService.js';
import { withAge } from '../services/patientFields.js';
import {
  validateNewReferral, planTransition, effectiveStatus,
  REFERRAL_EVENTS, OPEN_STATUSES, CLOSED_VISIT_STATUSES
} from '../services/caseReferralRules.js';

/**
 * Doctor-to-doctor referral (Roadmap v3, Phase 1, F1).
 *
 * This file fetches and writes; caseReferralRules.js decides. Nothing about
 * who may refer, who may answer, or who is accountable afterwards is decided
 * here — so it cannot drift between endpoints, and it is tested without a
 * database.
 *
 * Every route here sits behind the doctor_referral feature flag (see
 * doctor.routes.js), so with the flag off these endpoints do not exist.
 *
 * ── Races ──────────────────────────────────────────────────────────────────
 *
 * Supabase's REST interface has no multi-statement transaction, so each write
 * is guarded instead. A referral is updated only while it is still in the
 * state the decision was made from; a transfer moves the case only while it is
 * still assigned to the referring doctor; and the database's partial unique
 * index refuses a second open referral outright. Two doctors answering at once
 * get one success and one "this changed, reload" — never a half-applied state.
 */

const REFERRAL_FIELDS = `
  id, visit_id, district_id, from_doctor_id, to_doctor_id, referral_type, urgency,
  clinical_question, status, depth, response_notes, decline_reason,
  accountable_doctor_id, expires_at, created_at, responded_at, completed_at
`;

const first = (v) => (Array.isArray(v) ? v[0] : v) || null;

const withEffectiveStatus = (r, now = new Date()) => ({ ...r, status: effectiveStatus(r, now) });

/**
 * POST /api/doctor/cases/:id/referrals
 *   { to_doctor_id, referral_type, urgency?, clinical_question }
 */
export const createCaseReferral = async (req, res) => {
  const targetId = req.body?.to_doctor_id;
  if (!targetId) return res.status(400).json({ error: 'Choose the doctor to refer this case to.' });

  const [{ data: visit, error: visitErr }, { data: target }, { data: prior, error: priorErr }] = await Promise.all([
    supabaseAdmin
      .from('visits')
      .select('id, visit_code, assigned_doctor_id, district_id, visit_date, status, assistant_id, patient_id, patients ( full_name )')
      .eq('id', req.params.id)
      .maybeSingle(),
    supabaseAdmin
      .from('staff_profiles')
      .select('id, full_name, role, status, district_id')
      .eq('id', targetId)
      .maybeSingle(),
    supabaseAdmin
      .from('case_referrals')
      .select('id, to_doctor_id, status, expires_at')
      .eq('visit_id', req.params.id)
  ]);

  if (visitErr || priorErr) {
    console.error('case referral lookup failed:', (visitErr || priorErr).message);
    return res.status(500).json({ error: 'Could not load the case.' });
  }

  const decision = validateNewReferral({
    visit,
    caller: { id: req.user.id },
    target,
    priorReferrals: prior || [],
    body: req.body,
    today: istDateString()
  });
  if (!decision.ok) return res.status(decision.status).json({ error: decision.error });

  // A request past its expiry still reads 'requested' in the table until
  // something writes otherwise, and the one-open-referral index counts it. Close
  // those out first so an expired request cannot block a new one.
  const now = new Date();
  const stale = (prior || []).filter((r) => r.status === 'requested' && effectiveStatus(r, now) === 'expired');
  if (stale.length) {
    await supabaseAdmin
      .from('case_referrals')
      .update({ status: 'expired', completed_at: now.toISOString() })
      .in('id', stale.map((r) => r.id))
      .eq('status', 'requested');
  }

  const { data: row, error } = await supabaseAdmin
    .from('case_referrals')
    .insert([decision.value])
    .select(REFERRAL_FIELDS)
    .single();

  if (error) {
    // 23505: the partial unique index — another open referral was created
    // between our check and this insert.
    if (error.code === '23505') {
      return res.status(409).json({ error: 'This case already has an open referral.' });
    }
    console.error('case referral insert failed:', error.message);
    return res.status(500).json({ error: 'The referral could not be saved.' });
  }

  await logAuditEvent({
    actorId: req.user.id,
    actorRole: req.user.role,
    action: 'CASE_REFERRAL_REQUESTED',
    entityType: 'VISITS',
    entityId: visit.id,
    metadata: {
      referral_id: row.id, to_doctor_id: target.id,
      referral_type: row.referral_type, urgency: row.urgency, depth: row.depth
    },
    ip: req.ip
  });

  // Identifiers and names only. The clinical question is read on the case,
  // under the case's own access rule, not copied into a notification row.
  await notify({
    consultationId: null,
    recipients: [{ id: target.id, role: 'DOCTOR' }],
    event: REFERRAL_EVENTS.requested,
    payload: {
      referral_id: row.id,
      visit_id: visit.id,
      visit_code: visit.visit_code,
      patient_name: first(visit.patients)?.full_name || null,
      from_doctor_name: req.user.name || null,
      referral_type: row.referral_type,
      urgency: row.urgency
    }
  });

  return res.status(201).json({ referral: row });
};

/**
 * GET /api/doctor/referrals?direction=incoming|outgoing&status=open|all
 *
 * Incoming is the "referred to me" queue; outgoing is what the doctor has sent
 * and is waiting on. Open by default.
 */
export const listCaseReferrals = async (req, res) => {
  const direction = req.query.direction === 'outgoing' ? 'outgoing' : 'incoming';
  const all = req.query.status === 'all';

  let q = supabaseAdmin
    .from('case_referrals')
    .select(`
      ${REFERRAL_FIELDS},
      visits ( id, visit_code, risk_level, chief_complaint, visit_date,
               patients ( full_name, gender, date_of_birth ) ),
      from_doctor:from_doctor_id ( id, full_name ),
      to_doctor:to_doctor_id ( id, full_name )
    `)
    .eq(direction === 'outgoing' ? 'from_doctor_id' : 'to_doctor_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(100);

  if (!all) q = q.in('status', OPEN_STATUSES);

  const { data, error } = await q;
  if (error) {
    console.error('case referral list failed:', error.message);
    return res.status(500).json({ error: 'Could not load referrals.' });
  }

  const now = new Date();
  const referrals = (data || [])
    .map((r) => withEffectiveStatus(r, now))
    // An expired request is not open, even though the row has not caught up.
    .filter((r) => all || OPEN_STATUSES.includes(r.status))
    .map((r) => {
      const visit = first(r.visits);
      return {
        ...r,
        visits: visit ? { ...visit, patients: withAge(first(visit.patients)) } : null,
        from_doctor: first(r.from_doctor),
        to_doctor: first(r.to_doctor)
      };
    });

  return res.json({ direction, referrals });
};

/**
 * POST /api/doctor/referrals/:id/:action
 *   accept · decline { reason } · complete { response_notes } · return { reason } · cancel
 */
export const actOnCaseReferral = async (req, res) => {
  const { action } = req.params;

  const { data: referral, error: refErr } = await supabaseAdmin
    .from('case_referrals')
    .select(REFERRAL_FIELDS)
    .eq('id', req.params.id)
    .maybeSingle();

  if (refErr) return res.status(500).json({ error: 'Could not load the referral.' });

  const plan = planTransition({ referral, action, caller: { id: req.user.id }, body: req.body });

  // Some refusals still carry a patch — an expiry discovered on the way in is
  // recorded even though the action itself is refused.
  if (!plan.ok) {
    if (plan.patch && referral) {
      await supabaseAdmin.from('case_referrals').update(plan.patch)
        .eq('id', referral.id).eq('status', referral.status);
    }
    return res.status(plan.status).json({ error: plan.error });
  }

  const { data: visit } = await supabaseAdmin
    .from('visits')
    .select('id, visit_code, status, assistant_id, patient_id, assigned_doctor_id, patients ( full_name )')
    .eq('id', referral.visit_id)
    .maybeSingle();

  // A case the referring doctor has already decided cannot be picked up again.
  if (action === 'accept' && (!visit || CLOSED_VISIT_STATUSES.includes(visit.status))) {
    await supabaseAdmin.from('case_referrals')
      .update({ status: 'cancelled', completed_at: new Date().toISOString() })
      .eq('id', referral.id).eq('status', referral.status);
    return res.status(409).json({ error: 'The referring doctor has already decided this case.' });
  }

  const { data: updated, error: updErr } = await supabaseAdmin
    .from('case_referrals')
    .update(plan.patch)
    .eq('id', referral.id)
    .eq('status', referral.status)
    .select(REFERRAL_FIELDS)
    .maybeSingle();

  if (updErr) {
    console.error('case referral update failed:', updErr.message);
    return res.status(500).json({ error: 'The answer could not be saved.' });
  }
  if (!updated) {
    return res.status(409).json({ error: 'This referral changed while you were answering it. Reload and try again.' });
  }

  if (plan.visitPatch) {
    // Transfer of care: move the case only if it is still where the referral
    // said it was. If it moved in the meantime, undo the referral answer rather
    // than leave a transfer recorded that did not happen.
    const { data: moved } = await supabaseAdmin
      .from('visits')
      .update(plan.visitPatch)
      .eq('id', referral.visit_id)
      .eq('assigned_doctor_id', referral.from_doctor_id)
      .select('id')
      .maybeSingle();

    if (!moved) {
      await supabaseAdmin.from('case_referrals').update({
        status: referral.status,
        responded_at: referral.responded_at,
        completed_at: referral.completed_at,
        accountable_doctor_id: referral.accountable_doctor_id
      }).eq('id', referral.id);
      return res.status(409).json({
        error: 'The case is no longer assigned to the referring doctor, so it cannot be transferred.'
      });
    }
  }

  await logAuditEvent({
    actorId: req.user.id,
    actorRole: req.user.role,
    action: `CASE_REFERRAL_${plan.outcome.toUpperCase()}`,
    entityType: 'VISITS',
    entityId: referral.visit_id,
    metadata: {
      referral_id: referral.id,
      referral_type: referral.referral_type,
      status: updated.status,
      accountable_doctor_id: updated.accountable_doctor_id,
      transferred: Boolean(plan.visitPatch)
    },
    ip: req.ip
  });

  const recipientFor = {
    from: { id: referral.from_doctor_id, role: 'DOCTOR' },
    to: { id: referral.to_doctor_id, role: 'DOCTOR' },
    assistant: visit?.assistant_id ? { id: visit.assistant_id, role: 'CLINIC_ASSISTANT' } : null
  };
  const recipients = (plan.notify || []).map((k) => recipientFor[k]).filter(Boolean);

  if (recipients.length) {
    await notify({
      consultationId: null,
      recipients,
      event: REFERRAL_EVENTS[plan.outcome],
      payload: {
        referral_id: referral.id,
        visit_id: referral.visit_id,
        patient_id: visit?.patient_id || null,
        visit_code: visit?.visit_code || null,
        patient_name: first(visit?.patients)?.full_name || null,
        referral_type: referral.referral_type,
        status: updated.status,
        by_doctor_name: req.user.name || null,
        transferred: Boolean(plan.visitPatch)
      }
    });
  }

  return res.json({ referral: updated });
};
