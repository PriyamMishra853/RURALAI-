import { supabaseAdmin } from '../config/supabase.js';
import { pushToUser } from './realtimeHub.js';
import { ROLE_API_TO_DB } from '../config/roles.js';

/**
 * Consultation notifications — spec §5.
 *
 * Every event is persisted first, then pushed live. That order matters: a
 * doctor whose laptop was asleep must still see that a consultation was booked,
 * so the socket push is an optimisation on top of a durable row, never the only
 * delivery path.
 *
 * Deliberately independent of the video provider. If mediasoup or the P2P layer
 * is degraded, notifications keep working — that is the whole reason §5 says to
 * reuse the app's own realtime channel rather than the video provider's.
 */

export const EVENTS = {
  SCHEDULED: 'CONSULTATION_SCHEDULED',
  REMINDER: 'CONSULTATION_REMINDER',
  STARTED: 'CONSULTATION_STARTED',
  CANCELLED: 'CONSULTATION_CANCELLED',
  COMPLETED: 'CONSULTATION_COMPLETED',
  FAILED: 'CONSULTATION_FAILED'
};

/**
 * Record and deliver one event to a set of recipients.
 *
 * @param {Array<{id: string, role: string}>} recipients
 */
export const notify = async ({ consultationId, recipients, event, payload = {} }) => {
  const rows = recipients
    .filter((r) => r?.id)
    .map((r) => ({
      consultation_id: consultationId || null,
      recipient_id: r.id,
      recipient_role: ROLE_API_TO_DB[r.role] || r.role,
      event_type: event,
      payload
    }));

  if (!rows.length) return [];

  const { data, error } = await supabaseAdmin.from('notifications').insert(rows).select();
  if (error) {
    // A failed notification must never break the action that triggered it —
    // a consultation that was booked but whose notification failed is still
    // booked, and the dashboard poll will show it.
    console.warn('notification insert failed:', error.message);
    return [];
  }

  for (const row of data) {
    pushToUser(row.recipient_id, {
      type: 'notification',
      id: row.id,
      event: row.event_type,
      consultation_id: row.consultation_id,
      payload: row.payload,
      created_at: row.created_at
    });
  }
  return data;
};

/** Both sides of a consultation, for the events that concern everyone. */
export const consultationParties = (consultation) => [
  { id: consultation.doctor_id, role: 'DOCTOR' },
  { id: consultation.assistant_id, role: 'CLINIC_ASSISTANT' }
];

export const listNotifications = async (staffId, { unreadOnly = false, limit = 50 } = {}) => {
  let q = supabaseAdmin
    .from('notifications')
    .select('id, consultation_id, event_type, payload, created_at, read_at')
    .eq('recipient_id', staffId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (unreadOnly) q = q.is('read_at', null);

  const { data, error } = await q;
  if (error) return { notifications: [], unread: 0 };

  const { count } = await supabaseAdmin
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('recipient_id', staffId)
    .is('read_at', null);

  return { notifications: data || [], unread: count ?? 0 };
};

export const markRead = async (staffId, ids) => {
  const q = supabaseAdmin
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_id', staffId)     // scoped: you can only read your own
    .is('read_at', null);

  const { error } = ids?.length ? await q.in('id', ids) : await q;
  return !error;
};
