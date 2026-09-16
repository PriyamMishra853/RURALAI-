import { supabaseAdmin } from '../config/supabase.js';
import { logAuditEvent } from '../middleware/audit.middleware.js';
import { withAge } from '../services/patientFields.js';
import { planAction, sortForRecall, timingOf, DUE_SOON_HOURS } from '../services/followUpRules.js';
import { FOLLOW_UP_FIELDS, fetchInDistrict, applyGuardedUpdate } from '../services/followUpService.js';

/**
 * Follow-up recall for the clinic (Roadmap v3, Phase 4).
 *
 * The list an assistant works down with a phone: who is due, who is overdue,
 * how to reach them, and what happened the last time someone called.
 */

const first = (v) => (Array.isArray(v) ? v[0] : v) || null;

// follow_ups references visits and staff_profiles twice each, so every embed
// names the foreign key it means.
const LIST_SELECT = `${FOLLOW_UP_FIELDS},
  patients ( full_name, gender, date_of_birth, phone, village_line1 ),
  visit:visits!follow_ups_visit_id_fkey ( visit_code ),
  doctor:staff_profiles!follow_ups_created_by_fkey ( full_name )`;

/** GET /api/follow-ups?scope=due|open|all */
export const listFollowUps = async (req, res) => {
  const scope = ['open', 'all'].includes(req.query.scope) ? req.query.scope : 'due';
  const now = new Date();

  let query = supabaseAdmin
    .from('follow_ups')
    .select(LIST_SELECT)
    .eq('district_id', req.user.districtId)
    .limit(200);
  if (scope === 'all') {
    query = query.order('created_at', { ascending: false });
  } else {
    query = query.eq('status', 'scheduled').order('due_at', { ascending: true });
    if (scope === 'due') {
      query = query.lte('due_at', new Date(now.getTime() + DUE_SOON_HOURS * 60 * 60 * 1000).toISOString());
    }
  }

  const { data, error } = await query;
  if (error) {
    console.error('follow-up recall list failed:', error.message);
    return res.status(500).json({ error: 'Could not load follow-ups.' });
  }

  const followUps = sortForRecall((data || []).map(({ patients, visit, doctor, ...row }) => ({
    ...row,
    timing: timingOf(row, now),
    visit_code: first(visit)?.visit_code || null,
    doctor_name: first(doctor)?.full_name || null,
    patient: patients ? withAge(first(patients)) : null
  })), now);

  const count = (timing) => followUps.filter((f) => f.timing === timing).length;
  return res.json({
    scope,
    follow_ups: followUps,
    counts: { overdue: count('overdue'), due: count('due'), due_soon: count('due_soon') }
  });
};

/**
 * POST /api/follow-ups/:id/:action
 *   contact { result } · completed · missed { reason } · cancel { reason } — each with optional { notes }
 */
export const actOnFollowUp = async (req, res) => {
  const { data: followUp, error } = await fetchInDistrict(req.params.id, req.user.districtId);
  if (error) return res.status(500).json({ error: 'Could not load the follow-up.' });

  const plan = planAction({ followUp, action: req.params.action, body: req.body || {} });
  if (!plan.ok) return res.status(plan.status).json({ error: plan.error });

  const { data, error: updateError } = await applyGuardedUpdate(
    followUp, { ...plan.patch, last_updated_by: req.user.id }, plan.guard
  );
  if (updateError) {
    console.error('follow-up update failed:', updateError.message);
    return res.status(500).json({ error: 'The update could not be saved.' });
  }
  if (!data) {
    return res.status(409).json({ error: 'This follow-up changed while you were updating it. Reload and try again.' });
  }

  await logAuditEvent({
    actorId: req.user.id, actorRole: req.user.role,
    action: `FOLLOW_UP_${req.params.action.toUpperCase()}`,
    entityType: 'VISITS', entityId: followUp.visit_id,
    metadata: {
      follow_up_id: followUp.id, from: followUp.status, to: data.status,
      result: data.last_contact_result, reason: data.closed_reason
    },
    ip: req.ip
  });

  return res.json({ follow_up: { ...data, timing: timingOf(data) } });
};
