/**
 * Server enums, rendered in the reader's language.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * The API returns two different kinds of text and they need opposite treatment.
 *
 *   An enum — 'SCHEDULED', 'REJOIN', 'HIGH' — is a contract. It must stay
 *   English on the wire: it is compared in code, stored in Postgres, matched in
 *   tests, and read by whoever is debugging a log at 2am. Translating it at the
 *   source would break all of that.
 *
 *   A label — "Join Active Consultation" — is presentation, and belongs in the
 *   language of whoever is looking at the screen.
 *
 * The server currently sends both: `join_action` (the enum) and `join_label`
 * (English prose derived from it). Rather than ask the backend to localise
 * prose it has no business owning, the browser derives the label from the enum
 * it already receives. The server's English string is kept only as the fallback
 * argument, so an enum this file has not learned yet still renders the sentence
 * the API sent instead of a blank button.
 *
 * That also fixes a real bug in passing: the WAIT label was interpolated
 * server-side as "Join available in 12 min" and would have needed re-fetching
 * to stay accurate. Built here from `minutes_until_joinable`, it is correct on
 * every render.
 */

/** Consultation lifecycle, as stored in `consultations.status`. */
const CONSULTATION_STATUS = {
  SCHEDULED: ['consult.status.scheduled', 'Scheduled'],
  ACTIVE: ['consult.status.active', 'Live'],
  COMPLETED: ['consult.status.completed', 'Completed'],
  CANCELLED: ['consult.status.cancelled', 'Cancelled'],
  MISSED: ['consult.status.missed', 'Missed']
};

export const consultationStatusLabel = (t, status) => {
  const entry = CONSULTATION_STATUS[status];
  // An unknown status renders as its own enum rather than as empty space. A
  // clinical screen showing nothing where a state should be is worse than one
  // showing a word the reader has to ask about.
  if (!entry) return status || '';
  return t(entry[0], entry[1]);
};

/**
 * The join button's caption.
 *
 * @param {Function} t          translate
 * @param {object} consultation the decorated row from /api/consultations
 */
export const joinActionLabel = (t, consultation) => {
  const action = consultation?.join_action;
  const minutes = consultation?.minutes_until_joinable;

  switch (action) {
    case 'REJOIN':
      return t('consult.join.active', 'Join active consultation');
    case 'JOIN':
      return t('consult.join.now', 'Join consultation');
    case 'WAIT':
      return t('consult.join.wait', 'Join available in {minutes} min', {
        minutes: Number.isFinite(minutes) ? minutes : '—'
      });
    default:
      // DISABLED: the button is inert and reads as the state it is in.
      return consultationStatusLabel(t, consultation?.status)
        || consultation?.join_label
        || '';
  }
};

/**
 * Visit workflow state, as stored in `visits.status`.
 *
 * Kept beside the consultation statuses rather than in the page that renders
 * them, because three screens show this same set and they were drifting.
 */
const VISIT_STATUS = {
  DRAFT: ['visit.status.draft', 'Draft'],
  ASSESSED: ['visit.status.assessed', 'Assessed'],
  AWAITING_REVIEW: ['visit.status.awaitingReview', 'Awaiting review'],
  IN_CONSULTATION: ['visit.status.inConsultation', 'In consultation'],
  REVIEWED: ['visit.status.reviewed', 'Reviewed'],
  REFERRED: ['visit.status.referred', 'Referred'],
  CLOSED: ['visit.status.closed', 'Closed'],
  WITHDRAWN: ['visit.status.withdrawn', 'Withdrawn']
};

export const visitStatusLabel = (t, status) => {
  const entry = VISIT_STATUS[status];
  if (!entry) return status || '';
  return t(entry[0], entry[1]);
};

/**
 * Turn any enum into readable text as a last resort.
 *
 * Used where the server may add states faster than this file learns them:
 * 'AWAITING_REVIEW' becomes 'Awaiting review' rather than shouting in
 * snake case at somebody mid-consultation.
 */
export const humaniseEnum = (value) => {
  if (!value) return '';
  const s = String(value).replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/**
 * Render a server field that arrives as a `<name>` / `<name>_key` pair.
 *
 * Several services emit fixed prose with a catalogue key beside it — the tier
 * workflow's headlines and notes, the referral panel's capacity instruction,
 * the labels on the national emergency numbers. They are enumerable and never
 * vary by case, so translating them needs no model call and works with no
 * connection at all, which is the opposite of what routing them through the
 * AI path would give.
 *
 *   serverText(t, workflow, 'headline')
 *   serverText(t, line, 'label')
 *
 * Falls back to the English the server sent, then to empty. A field the server
 * has not yet learned to key still renders its sentence.
 */
export const serverText = (t, obj, field) => {
  if (!obj) return '';
  const english = obj[field] || '';
  const key = obj[`${field}_key`];
  return key ? t(key, english) : english;
};
