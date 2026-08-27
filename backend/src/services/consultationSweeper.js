import { supabaseAdmin } from '../config/supabase.js';
import { notify, consultationParties, EVENTS } from './notificationService.js';
import { TOLERANCE_MINUTES } from './schedulingService.js';

/**
 * Background sweep — spec §3.1 and §5.
 *
 * Two jobs on one timer:
 *   1. MISSED   — a SCHEDULED consultation whose window has fully expired.
 *   2. REMINDER — fired ~10 minutes before start.
 *
 * Both re-read `status` at send time rather than trusting what it was when the
 * work was queued (§5): a consultation cancelled after a reminder was planned
 * must not still receive that reminder.
 */

const REMINDER_LEAD_MINUTES = 10;
const SWEEP_INTERVAL_MS = 60000;

let timer = null;

const sweepMissed = async () => {
  // Window closed = scheduled_end_time + tolerance is in the past.
  const cutoff = new Date(Date.now() - TOLERANCE_MINUTES * 60000).toISOString();

  const { data, error } = await supabaseAdmin
    .from('consultations')
    .select('id, doctor_id, assistant_id, scheduled_start_time, actual_start_time')
    .eq('status', 'SCHEDULED')
    .lt('scheduled_end_time', cutoff)
    .limit(100);

  if (error || !data?.length) return 0;

  for (const c of data) {
    // Compare-and-set on status: if someone joined in the last moment, the
    // update matches nothing and the consultation is left alone.
    const { error: upErr } = await supabaseAdmin
      .from('consultations')
      .update({ status: 'MISSED' })
      .eq('id', c.id)
      .eq('status', 'SCHEDULED');
    if (upErr) continue;

    await notify({
      consultationId: c.id,
      recipients: consultationParties(c),
      event: EVENTS.CANCELLED,
      payload: {
        status: 'MISSED',
        reason: 'The consultation window expired without anyone joining.',
        scheduled_time: c.scheduled_start_time
      }
    });
  }
  return data.length;
};

const sweepReminders = async () => {
  const now = Date.now();
  const windowStart = new Date(now).toISOString();
  const windowEnd = new Date(now + REMINDER_LEAD_MINUTES * 60000).toISOString();

  const { data, error } = await supabaseAdmin
    .from('consultations')
    .select(`
      id, doctor_id, assistant_id, scheduled_start_time, status,
      doctor:doctor_id ( full_name ),
      patients ( full_name )
    `)
    .eq('status', 'SCHEDULED')          // re-read at send time, per §5
    .is('reminder_sent_at', null)
    .gte('scheduled_start_time', windowStart)
    .lte('scheduled_start_time', windowEnd)
    .limit(100);

  if (error || !data?.length) return 0;

  for (const c of data) {
    // Mark first: a crash between notify and mark would otherwise re-send on
    // the next tick, and a duplicate reminder erodes trust in all of them.
    const { error: markErr } = await supabaseAdmin
      .from('consultations')
      .update({ reminder_sent_at: new Date().toISOString() })
      .eq('id', c.id)
      .is('reminder_sent_at', null);
    if (markErr) continue;

    await notify({
      consultationId: c.id,
      recipients: consultationParties(c),
      event: EVENTS.REMINDER,
      payload: {
        doctor_name: c.doctor?.full_name,
        patient_name: c.patients?.full_name,
        scheduled_time: c.scheduled_start_time,
        status: 'SCHEDULED',
        action: 'Join Consultation',
        join_url: `/call/${c.id}`
      }
    });
  }
  return data.length;
};

export const startConsultationSweeper = () => {
  if (timer) return;

  const tick = async () => {
    try {
      await sweepMissed();
      await sweepReminders();
    } catch (err) {
      // A sweep failure must never take the API down with it.
      console.warn('consultation sweep failed:', err.message);
    }
  };

  timer = setInterval(tick, SWEEP_INTERVAL_MS);
  // Do not hold the process open on this timer alone.
  if (timer.unref) timer.unref();
  tick();
  console.log('Consultation sweeper started (MISSED + reminders, 60s)');
};

export const stopConsultationSweeper = () => {
  if (timer) clearInterval(timer);
  timer = null;
};
