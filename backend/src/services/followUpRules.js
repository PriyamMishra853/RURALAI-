/**
 * Follow-up recall: the rules (Roadmap v3, Phase 4).
 *
 * A doctor's "follow up in N days" used to be a sentence in the clinical notes.
 * Nothing scheduled it, nobody was reminded, and whether the patient came back
 * was unknowable — which is why follow-up adherence was the one outcome the
 * baseline had to list as not measurable.
 *
 * A follow-up is kept when the patient comes back: the next visit created for
 * them completes it, with no one having to remember to tick a box. Staff can
 * also record a call, a return seen somewhere else, a miss, or a cancellation.
 *
 * Pure: no database, no clock of its own. The service and controller supply
 * both, so every rule here is testable as a plain function.
 */

export const STATUSES = ['scheduled', 'completed', 'missed', 'cancelled'];
export const OPEN_STATUSES = ['scheduled'];

export const CONTACT_RESULTS = ['will_come', 'no_answer', 'unreachable', 'declined', 'moved_away'];
export const MISSED_REASONS = ['no_contact', 'declined', 'moved_away', 'cost', 'transport', 'other'];
export const CANCEL_REASONS = ['referred_elsewhere', 'no_longer_needed', 'died', 'entered_in_error'];
export const ACTIONS = ['contact', 'completed', 'missed', 'cancel'];

// The doctor's form offers 1–90 days.
export const MIN_DAYS = 1;
export const MAX_DAYS = 90;
// On the recall list a day before it is due, so the call can be made in time.
export const DUE_SOON_HOURS = 24;
// A patient who returns this long after the window closed still came back —
// late — but a visit months later is a new problem, not this follow-up.
export const LATE_RETURN_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_NOTES = 1000;

/** Slack after the due date before a follow-up counts as not kept. */
export const graceDaysFor = (days) => {
  if (days <= 3) return 1;
  if (days <= 14) return 3;
  return 7;
};

export const parseDays = (raw) => {
  const text = String(raw ?? '').trim();
  if (!/^\d{1,3}$/.test(text)) return null;
  const days = Number(text);
  return days >= MIN_DAYS && days <= MAX_DAYS ? days : null;
};

const cleanNotes = (notes) => {
  const text = String(notes ?? '').trim();
  return text ? text.slice(0, MAX_NOTES) : null;
};

export const buildFollowUp = ({ visit, doctorId, days: rawDays, now = new Date() }) => {
  const days = parseDays(rawDays);
  if (!days) return { ok: false, error: `Follow-up needs a number of days from ${MIN_DAYS} to ${MAX_DAYS}.` };
  if (!visit?.id || !visit?.patient_id || !visit?.district_id) {
    return { ok: false, error: 'The visit is missing its patient or district.' };
  }

  const due = new Date(now.getTime() + days * DAY_MS);
  const windowEnds = new Date(due.getTime() + graceDaysFor(days) * DAY_MS);
  return {
    ok: true,
    value: {
      visit_id: visit.id,
      patient_id: visit.patient_id,
      district_id: visit.district_id,
      created_by: doctorId,
      interval_days: days,
      due_at: due.toISOString(),
      window_ends_at: windowEnds.toISOString(),
      status: 'scheduled'
    }
  };
};

/**
 * What a staff action changes. `guard` names the columns the update must still
 * match, so two people acting at once get one success and one "reload".
 */
export const planAction = ({ followUp, action, body = {}, now = new Date() }) => {
  if (!followUp) return { ok: false, status: 404, error: 'No such follow-up.' };
  if (!ACTIONS.includes(action)) return { ok: false, status: 400, error: `action must be one of: ${ACTIONS.join(', ')}` };
  if (!OPEN_STATUSES.includes(followUp.status)) {
    return { ok: false, status: 409, error: 'This follow-up is already closed.' };
  }

  const at = now.toISOString();
  const notes = cleanNotes(body.notes);
  const withNotes = (patch) => (notes ? { ...patch, notes } : patch);

  if (action === 'contact') {
    if (!CONTACT_RESULTS.includes(body.result)) {
      return { ok: false, status: 400, error: `result must be one of: ${CONTACT_RESULTS.join(', ')}` };
    }
    return {
      ok: true,
      guard: { status: followUp.status, contact_attempts: followUp.contact_attempts ?? 0 },
      patch: withNotes({
        contact_attempts: (followUp.contact_attempts ?? 0) + 1,
        last_contact_at: at,
        last_contact_result: body.result
      })
    };
  }

  if (action === 'completed') {
    // Seen by someone, somewhere, without a visit on this platform — an ASHA
    // home visit, the PHC. Recorded as reported, so adherence can say how much
    // of it rests on a return visit and how much on someone's word.
    return {
      ok: true,
      guard: { status: followUp.status },
      patch: withNotes({ status: 'completed', completed_at: at, completed_via: 'reported' })
    };
  }

  if (action === 'missed') {
    if (!MISSED_REASONS.includes(body.reason)) {
      return { ok: false, status: 400, error: `reason must be one of: ${MISSED_REASONS.join(', ')}` };
    }
    return {
      ok: true,
      guard: { status: followUp.status },
      patch: withNotes({ status: 'missed', closed_reason: body.reason, closed_at: at })
    };
  }

  if (!CANCEL_REASONS.includes(body.reason)) {
    return { ok: false, status: 400, error: `reason must be one of: ${CANCEL_REASONS.join(', ')}` };
  }
  return {
    ok: true,
    guard: { status: followUp.status },
    patch: withNotes({ status: 'cancelled', closed_reason: body.reason, closed_at: at })
  };
};

/**
 * Which follow-ups a new visit for the same patient completes.
 *
 * A miss is not final: a patient marked missed who walks in a week later did
 * come back, and the record should say so — late.
 */
export const followUpsCompletedBy = (followUps, visit) => {
  const visitAt = new Date(visit.created_at).getTime();
  return (followUps || []).filter((f) => {
    if (!['scheduled', 'missed'].includes(f.status)) return false;
    if (f.visit_id === visit.id) return false;
    if (new Date(f.created_at).getTime() >= visitAt) return false;
    const lateLimit = new Date(f.window_ends_at).getTime() + LATE_RETURN_DAYS * DAY_MS;
    return visitAt <= lateLimit;
  });
};

export const timingOf = (followUp, now = new Date()) => {
  if (!OPEN_STATUSES.includes(followUp.status)) return 'closed';
  const t = now.getTime();
  if (t > new Date(followUp.window_ends_at).getTime()) return 'overdue';
  if (t >= new Date(followUp.due_at).getTime()) return 'due';
  if (t >= new Date(followUp.due_at).getTime() - DUE_SOON_HOURS * 60 * 60 * 1000) return 'due_soon';
  return 'upcoming';
};

const RANK = { overdue: 0, due: 1, due_soon: 2, upcoming: 3, closed: 4 };

/** Overdue first, longest overdue at the top; then by due date. */
export const sortForRecall = (followUps, now = new Date()) => [...followUps].sort((a, b) => {
  const ra = RANK[timingOf(a, now)];
  const rb = RANK[timingOf(b, now)];
  if (ra !== rb) return ra - rb;
  return new Date(a.due_at) - new Date(b.due_at);
});
