import { supabaseAdmin } from '../config/supabase.js';
import { logAuditEvent } from '../middleware/audit.middleware.js';
import { buildFollowUp, followUpsCompletedBy } from './followUpRules.js';

/**
 * Follow-up recall: the writes (Roadmap v3, Phase 4).
 *
 * Both entry points are called from inside another request — the doctor's
 * review and the creation of a visit — and neither may fail it. The decision
 * and the visit are the clinical record; a follow-up that could not be written
 * is logged and audited, and the request carries on.
 */

export const FOLLOW_UP_FIELDS = `
  id, visit_id, patient_id, district_id, created_by, interval_days, due_at, window_ends_at,
  status, completed_at, completed_via, completed_visit_id, closed_reason, closed_at,
  contact_attempts, last_contact_at, last_contact_result, notes, created_at, updated_at
`;

export const createFollowUpForDecision = async ({ visit, doctor, days, ip }) => {
  try {
    const built = buildFollowUp({ visit, doctorId: doctor.id, days });
    if (!built.ok) {
      console.warn('follow-up not scheduled:', built.error);
      return null;
    }

    const { data, error } = await supabaseAdmin
      .from('follow_ups').insert([built.value]).select(FOLLOW_UP_FIELDS).single();
    if (error) {
      if (error.code === '23505') return null; // already scheduled for this visit
      console.error('follow-up insert failed:', error.message);
      await logAuditEvent({
        actorId: doctor.id, actorRole: doctor.role, action: 'FOLLOW_UP_NOT_SCHEDULED',
        entityType: 'VISITS', entityId: visit.id, metadata: { reason: error.message }, ip
      });
      return null;
    }

    await logAuditEvent({
      actorId: doctor.id, actorRole: doctor.role, action: 'FOLLOW_UP_SCHEDULED',
      entityType: 'VISITS', entityId: visit.id,
      metadata: { follow_up_id: data.id, interval_days: data.interval_days, due_at: data.due_at },
      ip
    });
    return data;
  } catch (err) {
    console.error('follow-up scheduling failed:', err.message);
    return null;
  }
};

/**
 * A visit was created for a patient: complete whatever follow-ups it answers.
 * Guarded on status, so a follow-up an assistant cancels at the same moment
 * stays cancelled.
 */
export const completeForReturnVisit = async ({ visit, actor, ip }) => {
  try {
    const { data: candidates, error } = await supabaseAdmin
      .from('follow_ups')
      .select(FOLLOW_UP_FIELDS)
      .eq('patient_id', visit.patient_id)
      .in('status', ['scheduled', 'missed'])
      .limit(20);
    if (error) {
      console.warn('return-visit follow-up lookup failed:', error.message);
      return [];
    }

    const completed = [];
    for (const followUp of followUpsCompletedBy(candidates, visit)) {
      const { data, error: updateError } = await supabaseAdmin
        .from('follow_ups')
        .update({
          status: 'completed',
          completed_at: visit.created_at,
          completed_via: 'return_visit',
          completed_visit_id: visit.id,
          closed_reason: null,
          closed_at: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', followUp.id)
        .eq('status', followUp.status)
        .select('id')
        .maybeSingle();
      if (updateError) {
        console.warn('return-visit follow-up update failed:', updateError.message);
        continue;
      }
      if (!data) continue;

      completed.push(followUp.id);
      await logAuditEvent({
        actorId: actor.id, actorRole: actor.role, action: 'FOLLOW_UP_COMPLETED',
        entityType: 'VISITS', entityId: followUp.visit_id,
        metadata: { follow_up_id: followUp.id, via: 'return_visit', return_visit_id: visit.id, was: followUp.status },
        ip
      });
    }
    return completed;
  } catch (err) {
    console.error('return-visit follow-up completion failed:', err.message);
    return [];
  }
};

export const fetchInDistrict = async (id, districtId) => supabaseAdmin
  .from('follow_ups')
  .select(FOLLOW_UP_FIELDS)
  .eq('id', id)
  .eq('district_id', districtId)
  .maybeSingle();

/** Apply a planned change only if the row still matches what the plan was made from. */
export const applyGuardedUpdate = async (followUp, patch, guard) => {
  let query = supabaseAdmin
    .from('follow_ups')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', followUp.id);
  for (const [column, value] of Object.entries(guard)) query = query.eq(column, value);
  return query.select(FOLLOW_UP_FIELDS).maybeSingle();
};
