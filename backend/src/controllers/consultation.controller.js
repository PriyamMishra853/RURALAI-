import { supabaseAdmin } from '../config/supabase.js';
import { logAuditEvent } from '../middleware/audit.middleware.js';
import { getVideoProvider, VideoProviderError } from '../services/video/index.js';
import { notify, consultationParties, EVENTS } from '../services/notificationService.js';
import { relayToCall } from '../services/realtimeHub.js';
import { ROLES } from '../config/roles.js';
import {
  buildDateStrip, buildSlots, doctorsFreeAt, doctorsForDay,
  insideJoinWindow, minutesUntilJoinable,
  CONSULTATION_MINUTES, istDateString, istNow
} from '../services/schedulingService.js';

/**
 * Consultation state machine — spec §3.
 *
 *   SCHEDULED -> ACTIVE -> COMPLETED,  plus CANCELLED and MISSED.
 *
 * Every transition happens here, server-side. The frontend requests a
 * transition and renders whatever this returns; it never decides one. Each
 * guard is re-evaluated at the moment of action rather than trusted from
 * whatever the UI last rendered (§preamble).
 */

const FIELDS = `
  id, visit_id, patient_id, doctor_id, assistant_id,
  consultation_type, status,
  scheduled_start_time, scheduled_end_time, actual_start_time, actual_end_time,
  meeting_provider, meeting_room_id, meeting_url,
  cancelled_by, cancellation_reason, created_at,
  visits ( id, visit_code, risk_level, chief_complaint ),
  patients ( aadhaar_number, full_name, gender, date_of_birth, village_line1, phone ),
  doctor:doctor_id ( id, full_name ),
  assistant:assistant_id ( id, full_name )
`;

/**
 * A doctor may only ever see their own rows; an assistant only theirs (§7).
 *
 * Both sides of a consultation are recorded on it, including when the doctor
 * books the call — `assistant_id` is inherited from the visit in that case, so
 * one list serves both portals rather than each seeing only what it created.
 */
const scopeToCaller = (q, user) =>
  user.role === ROLES.DOCTOR ? q.eq('doctor_id', user.id) : q.eq('assistant_id', user.id);

/** Postgres unique-violation — our partial indexes on one-ACTIVE-per-doctor/patient. */
const isUniqueViolation = (error) => error?.code === '23505';

// ---------------------------------------------------------------------------
// Scheduling surface (§2)
// ---------------------------------------------------------------------------

/** GET /api/consultations/availability/dates — the 7-day strip (§2.1). */
export const getDateStrip = async (req, res) => {
  const strip = await buildDateStrip(req.user.districtId);
  return res.json({ dates: strip, today: istDateString() });
};

/** GET /api/consultations/availability/slots?date=YYYY-MM-DD (§2.3). */
export const getSlots = async (req, res) => {
  const date = req.query.date || istDateString();

  // A past date has no slots, and saying so is clearer than returning [].
  if (date < istDateString()) {
    return res.status(400).json({ error: 'That date is in the past.' });
  }

  const { doctors, slots } = await buildSlots(req.user.districtId, date);
  return res.json({ date, doctors, slots, server_time: new Date().toISOString() });
};

/** GET /api/consultations/availability/doctors?at=ISO — doctors free at one instant (§2.5). */
export const getDoctorsAt = async (req, res) => {
  const { at } = req.query;
  if (!at) return res.status(400).json({ error: 'at (ISO timestamp) is required.' });

  const free = await doctorsFreeAt(req.user.districtId, at);
  const all = await doctorsForDay(req.user.districtId, istDateString(new Date(at)));
  const freeIds = new Set(free.map((d) => d.id));

  // Actually in a consultation right now, as distinct from simply off duty.
  const { data: busyRows } = await supabaseAdmin
    .from('consultations').select('doctor_id').eq('status', 'ACTIVE');
  const busyIds = new Set((busyRows || []).map((r) => r.doctor_id));

  return res.json({
    at,
    doctors: all
      .filter((d) => d.working)
      .map((d) => ({
        ...d,
        available: freeIds.has(d.id),
        /*
         * Say which reason applies.
         *
         * This reported "Currently in consultation" for every unavailable
         * doctor, including the far more common case of the request falling
         * outside their working window. During a demo at 17:01 that produced
         * five doctors all apparently mid-consultation while the consultations
         * table was empty — a message that actively misdirects whoever is
         * trying to work out why nothing can be booked.
         */
        label: freeIds.has(d.id)
          ? 'Available'
          : (busyIds.has(d.id) ? 'Currently in consultation' : 'Outside working hours')
      }))
  });
};

// ---------------------------------------------------------------------------
// Booking (§2.4)
// ---------------------------------------------------------------------------

/**
 * POST /api/consultations  { visit_id, doctor_id, scheduled_start_time }
 *
 * §2.4 re-runs the whole availability check here, at booking time. The slot
 * list the assistant is looking at may be seconds stale, and "it was free when
 * the page rendered" is not a fact about now.
 */
export const createConsultation = async (req, res) => {
  const { visit_id, doctor_id, scheduled_start_time } = req.body || {};
  if (!visit_id || !doctor_id || !scheduled_start_time) {
    return res.status(400).json({ error: 'visit_id, doctor_id and scheduled_start_time are required.' });
  }

  const start = new Date(scheduled_start_time);
  if (Number.isNaN(start.getTime())) {
    return res.status(400).json({ error: 'scheduled_start_time is not a valid timestamp.' });
  }
  if (start.getTime() < Date.now() - 60000) {
    return res.status(400).json({ error: 'That time is in the past. Choose an upcoming slot.' });
  }
  const end = new Date(start.getTime() + CONSULTATION_MINUTES * 60000);

  // The visit must belong to this clinic.
  const { data: visit } = await supabaseAdmin
    .from('visits')
    .select('id, patient_id, district_id, assistant_id')
    .eq('id', visit_id)
    .eq('district_id', req.user.districtId)
    .maybeSingle();
  if (!visit) return res.status(404).json({ error: 'No such visit at this clinic.' });

  // 1 + 2. Re-check the doctor is working then, and still free then.
  const free = await doctorsFreeAt(req.user.districtId, start.toISOString());
  if (!free.some((d) => d.id === doctor_id)) {
    return res.status(409).json({
      error: 'This slot is no longer available. Please select another time.',
      refresh: true
    });
  }

  // 3. And has no ACTIVE consultation right now (§3.4).
  const { data: activeNow } = await supabaseAdmin
    .from('consultations').select('id').eq('doctor_id', doctor_id).eq('status', 'ACTIVE').maybeSingle();
  if (activeNow) {
    return res.status(409).json({
      error: 'This slot is no longer available. Please select another time.',
      refresh: true
    });
  }

  // 4. Insert. The partial unique indexes are the final backstop if two
  //    requests reached this line together.
  const { data: consultation, error } = await supabaseAdmin
    .from('consultations')
    .insert([{
      visit_id,
      patient_id: visit.patient_id,
      doctor_id,
      assistant_id: req.user.role === ROLES.CLINIC_ASSISTANT ? req.user.id : (visit.assistant_id || null),
      consultation_type: 'SCHEDULED',
      status: 'SCHEDULED',
      scheduled_start_time: start.toISOString(),
      scheduled_end_time: end.toISOString()
    }])
    .select(FIELDS)
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      return res.status(409).json({ error: 'This slot is no longer available. Please select another time.', refresh: true });
    }
    console.error('consultation insert failed:', error.message);
    return res.status(500).json({ error: 'The consultation could not be booked.' });
  }

  // §3.5 — the room is created ONCE, now, and reused by every later join.
  await attachMeeting(consultation);

  /*
   * The visit stays 'awaiting_doctor' while a consultation is merely booked.
   *
   * This wrote 'consultation_scheduled', which is not a value visit_status has
   * — so Postgres rejected every one of these updates and the result was
   * discarded, leaving the visit silently untouched. Booking a call does not
   * change the visit's clinical state anyway: the patient is still waiting for
   * a doctor, and when the call actually starts the join transition sets
   * 'in_consultation'. The consultations row is the source of truth for the
   * booking itself, so duplicating it here would only be a second copy to
   * disagree with.
   */
  const { error: statusErr } = await supabaseAdmin
    .from('visits').update({ status: 'awaiting_doctor' }).eq('id', visit_id);
  if (statusErr) console.error('visit status update failed after booking:', statusErr.message);

  await notify({
    consultationId: consultation.id,
    recipients: consultationParties(consultation),
    event: EVENTS.SCHEDULED,
    payload: {
      doctor_name: consultation.doctor?.full_name,
      patient_name: consultation.patients?.full_name,
      scheduled_time: consultation.scheduled_start_time,
      status: 'SCHEDULED',
      join_url: `/call/${consultation.id}`
    }
  });

  await logAuditEvent({
    actorId: req.user.id, actorRole: req.user.role,
    action: 'CONSULTATION_SCHEDULED', entityType: 'CONSULTATIONS',
    entityId: consultation.id, metadata: { doctor_id, scheduled_start_time: start.toISOString() }, ip: req.ip
  });

  return res.status(201).json(await reload(consultation.id));
};

/**
 * POST /api/consultations/instant  { visit_id }  — spec §2.6.
 *
 * Skips SCHEDULED entirely: inserts straight to ACTIVE, guarded by the
 * one-active-per-doctor index. If two assistants grab the same doctor at once,
 * exactly one insert wins and the loser moves to the next candidate.
 */
export const createInstantConsultation = async (req, res) => {
  const { visit_id } = req.body || {};
  if (!visit_id) return res.status(400).json({ error: 'visit_id is required.' });

  const { data: visit } = await supabaseAdmin
    .from('visits')
    .select('id, patient_id, district_id, assistant_id')
    .eq('id', visit_id)
    .eq('district_id', req.user.districtId)
    .maybeSingle();
  if (!visit) return res.status(404).json({ error: 'No such visit at this clinic.' });

  const now = new Date();
  const candidates = await doctorsFreeAt(req.user.districtId, now.toISOString(), { requireWorkingNow: true });

  if (!candidates.length) {
    return res.status(404).json({
      error: 'No doctors are available right now.',
      fallback: 'schedule'
    });
  }

  const end = new Date(now.getTime() + CONSULTATION_MINUTES * 60000);

  for (const candidate of candidates) {
    const { data: consultation, error } = await supabaseAdmin
      .from('consultations')
      .insert([{
        visit_id,
        patient_id: visit.patient_id,
        doctor_id: candidate.id,
        assistant_id: req.user.role === ROLES.CLINIC_ASSISTANT ? req.user.id : (visit.assistant_id || null),
        consultation_type: 'INSTANT',
        status: 'ACTIVE',
        scheduled_start_time: now.toISOString(),
        scheduled_end_time: end.toISOString(),
        actual_start_time: now.toISOString()
      }])
      .select(FIELDS)
      .single();

    if (error) {
      // Someone else reserved this doctor between the check and the insert.
      // That is expected under load — try the next candidate.
      if (isUniqueViolation(error)) continue;
      console.error('instant consultation insert failed:', error.message);
      return res.status(500).json({ error: 'The consultation could not be started.' });
    }

    try {
      await attachMeeting(consultation);
    } catch (err) {
      // §4.3 — provider failed. Roll the reservation back rather than leaving
      // an ACTIVE row with no room, which would block this doctor entirely.
      await supabaseAdmin.from('consultations')
        .update({ status: 'CANCELLED', cancellation_reason: 'Video session could not be created.' })
        .eq('id', consultation.id);
      return res.status(503).json({ error: 'Unable to start the video session, please retry.', retryable: true });
    }

    await supabaseAdmin.from('visits').update({ status: 'in_consultation' }).eq('id', visit_id);

    await notify({
      consultationId: consultation.id,
      recipients: consultationParties(consultation),
      event: EVENTS.STARTED,
      payload: {
        doctor_name: consultation.doctor?.full_name,
        patient_name: consultation.patients?.full_name,
        scheduled_time: now.toISOString(),
        status: 'ACTIVE',
        instant: true,
        join_url: `/call/${consultation.id}`
      }
    });

    await logAuditEvent({
      actorId: req.user.id, actorRole: req.user.role,
      action: 'CONSULTATION_INSTANT_STARTED', entityType: 'CONSULTATIONS',
      entityId: consultation.id, metadata: { doctor_id: candidate.id }, ip: req.ip
    });

    return res.status(201).json({ ...(await reload(consultation.id)), doctor_name: candidate.name });
  }

  // Every candidate was taken while we worked through the list.
  return res.status(409).json({ error: 'The available doctors were just taken. Try again or schedule instead.', refresh: true });
};

// ---------------------------------------------------------------------------
// Join / End / Cancel (§3.6, §3.7)
// ---------------------------------------------------------------------------

/**
 * POST /api/consultations/:id/join — spec §3.6.
 *
 * Steps run in the spec's order. Status is checked before the window so an
 * already-completed consultation reports that plainly rather than "outside the
 * joining window", which would be misleading.
 */
export const joinConsultation = async (req, res) => {
  const { data: consultation } = await scopeToCaller(
    supabaseAdmin.from('consultations').select(FIELDS).eq('id', req.params.id),
    req.user
  ).maybeSingle();

  if (!consultation) {
    return res.status(404).json({ error: 'You are not a participant of that consultation.' });
  }

  // 3. Terminal states first.
  if (consultation.status === 'COMPLETED') {
    return res.status(409).json({ error: 'This consultation has already been completed.' });
  }
  if (consultation.status === 'CANCELLED') {
    return res.status(409).json({ error: 'This consultation was cancelled.' });
  }
  if (consultation.status === 'MISSED') {
    return res.status(409).json({ error: 'This consultation was missed and can no longer be joined.' });
  }

  // 4. Tolerance window.
  if (!insideJoinWindow(consultation)) {
    const mins = minutesUntilJoinable(consultation);
    return res.status(409).json({
      error: 'This consultation is outside the allowed joining window.',
      minutes_until_joinable: mins
    });
  }

  const isReconnect = consultation.status === 'ACTIVE';

  // 5. Neither party may be in a DIFFERENT active consultation (§3.3).
  if (!isReconnect) {
    const { data: clash } = await supabaseAdmin
      .from('consultations')
      .select('id')
      .eq('status', 'ACTIVE')
      .or(`doctor_id.eq.${consultation.doctor_id},patient_id.eq.${consultation.patient_id}`)
      .neq('id', consultation.id)
      .maybeSingle();
    if (clash) return res.status(409).json({ error: 'You already have an active consultation.' });
  }

  // 6. Transition, guarded by the unique index.
  if (!isReconnect) {
    const { error: upErr } = await supabaseAdmin
      .from('consultations')
      .update({
        status: 'ACTIVE',
        actual_start_time: consultation.actual_start_time || new Date().toISOString()
      })
      .eq('id', consultation.id)
      .eq('status', 'SCHEDULED');   // compare-and-set: loses cleanly to a race

    if (upErr) {
      if (isUniqueViolation(upErr)) {
        return res.status(409).json({ error: 'You already have an active consultation.' });
      }
      return res.status(500).json({ error: 'The consultation could not be started.' });
    }
  }

  // 7. Credentials for the SAME room. §3.8: a reconnect must not create a new one.
  let credentials;
  try {
    const provider = await getVideoProvider();
    credentials = await provider.joinMeeting(
      consultation.id,
      req.user.id,
      req.user.role === ROLES.DOCTOR ? 'doctor' : 'assistant',
      { roomId: consultation.meeting_room_id }
    );
  } catch (err) {
    // §4.3 — do NOT leave the row transitioned on provider failure.
    if (!isReconnect) {
      await supabaseAdmin.from('consultations')
        .update({ status: 'SCHEDULED', actual_start_time: consultation.actual_start_time })
        .eq('id', consultation.id);
    }
    console.error('video join failed:', err instanceof VideoProviderError ? err.cause?.message : err.message);

    await notify({
      consultationId: consultation.id,
      recipients: consultationParties(consultation),
      event: EVENTS.FAILED,
      payload: { message: 'The video session could not be started. The other party can retry.' }
    });

    return res.status(503).json({ error: 'Unable to start the video session, please retry.', retryable: true });
  }

  // 9. Tell the other side — but only on a genuine start, not on a reconnect.
  if (!isReconnect) {
    await notify({
      consultationId: consultation.id,
      recipients: consultationParties(consultation),
      event: EVENTS.STARTED,
      payload: {
        doctor_name: consultation.doctor?.full_name,
        patient_name: consultation.patients?.full_name,
        started_by: req.user.name,
        status: 'ACTIVE',
        join_url: `/call/${consultation.id}`
      }
    });
  }

  await logAuditEvent({
    actorId: req.user.id, actorRole: req.user.role,
    action: isReconnect ? 'CONSULTATION_RECONNECTED' : 'CONSULTATION_JOINED',
    entityType: 'CONSULTATIONS', entityId: consultation.id, ip: req.ip
  });

  return res.json({
    consultation: await reload(consultation.id),
    credentials,
    reconnect: isReconnect
  });
};

/** POST /api/consultations/:id/end — spec §3.7. */
export const endConsultation = async (req, res) => {
  const { data: consultation } = await scopeToCaller(
    supabaseAdmin.from('consultations').select(FIELDS).eq('id', req.params.id),
    req.user
  ).maybeSingle();

  if (!consultation) return res.status(404).json({ error: 'You are not a participant of that consultation.' });
  if (consultation.status === 'COMPLETED') return res.json({ consultation, already: true });

  const endedAt = new Date();
  const startedAt = consultation.actual_start_time ? new Date(consultation.actual_start_time) : null;
  const durationSeconds = startedAt ? Math.round((endedAt - startedAt) / 1000) : null;

  await supabaseAdmin
    .from('consultations')
    .update({ status: 'COMPLETED', actual_end_time: endedAt.toISOString() })
    .eq('id', consultation.id);

  try {
    const provider = await getVideoProvider();
    await provider.endMeeting(consultation.id);
  } catch (err) {
    // Teardown failure must not block the state transition — the call is over
    // either way, and a leaked room is an ops problem, not a clinical one.
    console.warn('video teardown failed:', err.message);
  }

  // Drop anyone still holding the signalling room open.
  relayToCall(consultation.id, null, { type: 'call:ended' });

  await supabaseAdmin.from('visits').update({ status: 'awaiting_doctor' }).eq('id', consultation.visit_id);

  await notify({
    consultationId: consultation.id,
    recipients: consultationParties(consultation),
    event: EVENTS.COMPLETED,
    payload: {
      doctor_name: consultation.doctor?.full_name,
      patient_name: consultation.patients?.full_name,
      duration_seconds: durationSeconds,
      status: 'COMPLETED'
    }
  });

  await logAuditEvent({
    actorId: req.user.id, actorRole: req.user.role,
    action: 'CONSULTATION_COMPLETED', entityType: 'CONSULTATIONS',
    entityId: consultation.id, metadata: { duration_seconds: durationSeconds }, ip: req.ip
  });

  return res.json({ consultation: await reload(consultation.id), duration_seconds: durationSeconds });
};

/** POST /api/consultations/:id/cancel — only while SCHEDULED (§6.2). */
export const cancelConsultation = async (req, res) => {
  const { reason } = req.body || {};

  const { data: consultation } = await scopeToCaller(
    supabaseAdmin.from('consultations').select(FIELDS).eq('id', req.params.id),
    req.user
  ).maybeSingle();

  if (!consultation) return res.status(404).json({ error: 'You are not a participant of that consultation.' });
  if (consultation.status !== 'SCHEDULED') {
    return res.status(409).json({ error: `A consultation that is ${consultation.status.toLowerCase()} cannot be cancelled.` });
  }

  await supabaseAdmin
    .from('consultations')
    .update({
      status: 'CANCELLED',
      cancelled_by: req.user.id,
      cancellation_reason: reason || null
    })
    .eq('id', consultation.id);

  try {
    const provider = await getVideoProvider();
    await provider.endMeeting(consultation.id);
  } catch { /* room may never have been created */ }

  await notify({
    consultationId: consultation.id,
    recipients: consultationParties(consultation),
    event: EVENTS.CANCELLED,
    payload: {
      doctor_name: consultation.doctor?.full_name,
      patient_name: consultation.patients?.full_name,
      cancelled_by: req.user.name,
      reason: reason || null,
      status: 'CANCELLED'
    }
  });

  await logAuditEvent({
    actorId: req.user.id, actorRole: req.user.role,
    action: 'CONSULTATION_CANCELLED', entityType: 'CONSULTATIONS',
    entityId: consultation.id, metadata: { reason }, ip: req.ip
  });

  return res.json({ consultation: await reload(consultation.id) });
};

// ---------------------------------------------------------------------------
// Listing (§6.1)
// ---------------------------------------------------------------------------

/** GET /api/consultations?scope=today|upcoming|all */
export const getConsultations = async (req, res) => {
  const { scope = 'all', status } = req.query;

  let q = supabaseAdmin.from('consultations').select(FIELDS).order('scheduled_start_time', { ascending: true }).limit(200);
  q = scopeToCaller(q, req.user);
  if (status) q = q.eq('status', status);

  if (scope === 'today') {
    const today = istDateString();
    const start = new Date(`${today}T00:00:00Z`).getTime() - 5.5 * 3600000;
    q = q.gte('scheduled_start_time', new Date(start).toISOString())
         .lt('scheduled_start_time', new Date(start + 86400000).toISOString());
  } else if (scope === 'upcoming') {
    q = q.gte('scheduled_start_time', new Date().toISOString()).in('status', ['SCHEDULED', 'ACTIVE']);
  }

  const { data, error } = await q;
  if (error) {
    console.error('consultations query failed:', error.message);
    return res.status(500).json({ error: 'Could not load consultations.' });
  }

  return res.json({
    consultations: (data || []).map(decorate),
    server_time: new Date().toISOString()
  });
};

/** GET /api/consultations/:id */
export const getConsultation = async (req, res) => {
  const { data } = await scopeToCaller(
    supabaseAdmin.from('consultations').select(FIELDS).eq('id', req.params.id),
    req.user
  ).maybeSingle();

  if (!data) return res.status(404).json({ error: 'You are not a participant of that consultation.' });
  return res.json(decorate(data));
};

// ---------------------------------------------------------------------------

/** Create the room once and store its id — §3.5. */
async function attachMeeting(consultation) {
  const provider = await getVideoProvider();
  const { roomId, meetingUrl } = await provider.createMeeting(consultation.id);
  await supabaseAdmin
    .from('consultations')
    .update({ meeting_provider: provider.name, meeting_room_id: roomId, meeting_url: meetingUrl })
    .eq('id', consultation.id);
  consultation.meeting_room_id = roomId;
  consultation.meeting_url = meetingUrl;
}

async function reload(id) {
  const { data } = await supabaseAdmin.from('consultations').select(FIELDS).eq('id', id).maybeSingle();
  return data ? decorate(data) : null;
}

/**
 * Attach the derived state the Join button renders from (§6.2).
 *
 * Computed here rather than in the browser so the button can never disagree
 * with what the join endpoint will actually allow.
 */
function decorate(c) {
  const now = new Date();
  const joinable = insideJoinWindow(c, now);
  const minutes = minutesUntilJoinable(c, now);

  let action = 'DISABLED';
  let label = c.status;
  if (c.status === 'ACTIVE') { action = 'REJOIN'; label = 'Join Active Consultation'; }
  else if (c.status === 'SCHEDULED' && joinable) { action = 'JOIN'; label = 'Join Consultation'; }
  else if (c.status === 'SCHEDULED') { action = 'WAIT'; label = `Join available in ${minutes} min`; }
  else if (c.status === 'COMPLETED') label = 'Completed';
  else if (c.status === 'CANCELLED') label = 'Cancelled';
  else if (c.status === 'MISSED') label = 'Missed';

  return {
    ...c,
    join_action: action,
    join_label: label,
    minutes_until_joinable: minutes,
    can_cancel: c.status === 'SCHEDULED'
  };
}
