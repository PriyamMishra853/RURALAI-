import crypto from 'crypto';

/**
 * Closed-loop hospital referral: the decisions (Roadmap v3, Phase 1).
 *
 * No database and no network here — the service writes, the controller speaks
 * HTTP, and this decides what a referral may become and who may make it so.
 *
 * ── The lifecycle ──────────────────────────────────────────────────────────
 *
 *   referred ──► reached ──► closed (with an outcome)
 *      │  ▲
 *      ▼  │
 *   not_reached ─┐
 *      │         │
 *      ▼         │
 *   lost_to_follow_up (and back to reached if they turn up)
 *
 * A patient recorded as not reached, or lost, who then arrives is simply
 * reached: the record follows the patient, not the order we learned things in.
 *
 * ── Two actors, two sets of rights ─────────────────────────────────────────
 *
 * The referring clinic can record anything, including correcting an outcome.
 * The hospital, arriving by an unauthenticated link, can only confirm arrival
 * and record an outcome once. It cannot say a patient did not come — a hospital
 * cannot know that — and it cannot overwrite what is already recorded.
 */

export const ORIGINS = ['doctor_decision', 'emergency'];
export const STATUSES = ['referred', 'reached', 'not_reached', 'closed', 'lost_to_follow_up'];
export const OPEN_STATUSES = ['referred', 'reached'];
export const NOT_REACHED_REASONS = [
  'cost', 'transport', 'distance', 'family_refused', 'improved', 'died_before_arrival', 'other'
];
export const OUTCOMES = ['admitted', 'treated_discharged', 'referred_onward', 'left_against_advice', 'died'];
export const STAFF_ACTIONS = ['reached', 'not_reached', 'outcome', 'lost'];
export const HOSPITAL_ACTIONS = ['reached', 'outcome'];

/**
 * When the clinic should know the answer. An emergency not known to have
 * arrived by the next day is a patient to phone now; a routine referral gets
 * three days, which is roughly how long arranging transport takes.
 */
export const FOLLOW_UP_HOURS = { emergency: 24, routine: 72 };

/** Long enough to cover an admission; short enough that an old slip goes dead. */
export const ACK_TOKEN_DAYS = 14;

export const REFERRAL_EVENTS = { reached: 'REFERRAL_REACHED', outcome: 'REFERRAL_OUTCOME' };

const HOSPITAL_NAME_MAX = 200;
const NOTES_MAX = 1000;
// No 0/O, 1/I/L: this code is read aloud over a phone.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const refuse = (status, error) => ({ ok: false, status, error });

export const referralCode = () => {
  let code = '';
  for (let i = 0; i < 8; i += 1) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return `RF-${code}`;
};

export const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/** 192 random bits. Guessing one is not a strategy; the rate limiter is belt and braces. */
export const newAckToken = (now = new Date()) => {
  const token = crypto.randomBytes(24).toString('base64url');
  return {
    token,
    hash: hashToken(token),
    expiresAt: new Date(now.getTime() + ACK_TOKEN_DAYS * 86400e3).toISOString()
  };
};

export const tokenUsable = (referral, now = new Date()) =>
  Boolean(referral?.ack_token_expires_at) && new Date(referral.ack_token_expires_at) > now;

/** An assistant-confirmed referral is by definition an emergency; a doctor's follows the case's tier. */
export const urgencyFor = (visit, origin) =>
  (origin === 'emergency' || ['high', 'emergency'].includes(String(visit?.risk_level || '').toLowerCase())
    ? 'emergency'
    : 'routine');

/**
 * The row for a new referral, and the acknowledgement token to print on the
 * slip. The token is returned once and never stored — only its hash is.
 */
export const buildReferral = ({ visit, hospitalName, hospitalDistrict = null, origin, referredBy, now = new Date() }) => {
  if (!visit?.id) return refuse(404, 'No such visit.');
  if (!ORIGINS.includes(origin)) return refuse(400, `origin must be one of: ${ORIGINS.join(', ')}.`);

  const name = String(hospitalName || '').trim();
  if (!name) return refuse(400, 'Name the hospital the patient is being sent to.');
  if (name.length > HOSPITAL_NAME_MAX) {
    return refuse(400, `The hospital name is limited to ${HOSPITAL_NAME_MAX} characters.`);
  }

  const urgency = urgencyFor(visit, origin);
  const { token, hash, expiresAt } = newAckToken(now);

  return {
    ok: true,
    token,
    value: {
      visit_id: visit.id,
      patient_id: visit.patient_id || null,
      district_id: visit.district_id || null,
      origin,
      urgency,
      hospital_name: name,
      hospital_district: String(hospitalDistrict || '').trim() || null,
      referral_code: referralCode(),
      referred_by: referredBy || null,
      status: 'referred',
      follow_up_due_at: new Date(now.getTime() + FOLLOW_UP_HOURS[urgency] * 3600e3).toISOString(),
      ack_token_hash: hash,
      ack_token_expires_at: expiresAt
    }
  };
};

/**
 * What an action does to a referral, or why it may not.
 *
 * Returns { ok, patch, event } · { ok, unchanged } · { ok:false, status, error }.
 * `unchanged` is a success: confirming an arrival twice — a receptionist
 * tapping the button again — is not an error worth showing anyone.
 */
export const planUpdate = ({ referral, action, actor, body = {}, now = new Date() }) => {
  if (!referral) return refuse(404, 'No such referral.');

  const known = [...new Set([...STAFF_ACTIONS, ...HOSPITAL_ACTIONS])];
  if (!known.includes(action)) return refuse(400, `action must be one of: ${known.join(', ')}.`);

  if (actor === 'hospital' && !HOSPITAL_ACTIONS.includes(action)) {
    return refuse(403, 'A hospital can confirm arrival or record the outcome. Anything else is recorded by the referring clinic.');
  }

  const at = now.toISOString();
  const via = actor === 'hospital' ? 'hospital' : 'staff';
  const { status } = referral;

  // Notes are the clinic's own record; a public link never writes them.
  const notes = actor === 'staff' && body?.notes !== undefined
    ? (String(body.notes || '').trim().slice(0, NOTES_MAX) || null)
    : undefined;
  const done = (patch) => ({
    ok: true,
    patch: notes === undefined ? patch : { ...patch, notes },
    event: REFERRAL_EVENTS[action] || null
  });

  switch (action) {
    case 'reached': {
      if (status === 'reached' || status === 'closed') return { ok: true, unchanged: true };
      return done({ status: 'reached', reached_at: at, reached_via: via, not_reached_reason: null, closed_at: null });
    }

    case 'not_reached': {
      if (status === 'reached' || status === 'closed') {
        return refuse(409, 'This patient is already recorded as having reached the hospital.');
      }
      const reason = String(body?.reason || '');
      if (!NOT_REACHED_REASONS.includes(reason)) {
        return refuse(400, `Say why the patient did not reach: one of ${NOT_REACHED_REASONS.join(', ')}.`);
      }
      return done({ status: 'not_reached', not_reached_reason: reason, closed_at: null });
    }

    case 'outcome': {
      const outcome = String(body?.outcome || '');
      if (!OUTCOMES.includes(outcome)) return refuse(400, `outcome must be one of: ${OUTCOMES.join(', ')}.`);
      if (status === 'closed' && actor === 'hospital') {
        return refuse(409, 'The outcome is already recorded. The referring clinic can correct it if it is wrong.');
      }
      // An outcome means the patient got there, whatever was recorded before.
      return done({
        status: 'closed',
        outcome,
        closed_at: at,
        reached_at: referral.reached_at || at,
        reached_via: referral.reached_via || via,
        not_reached_reason: null
      });
    }

    case 'lost': {
      if (status === 'reached' || status === 'closed') {
        return refuse(409, 'This patient reached the hospital, so they are not lost to follow-up. Record the outcome instead.');
      }
      if (status === 'lost_to_follow_up') return { ok: true, unchanged: true };
      return done({ status: 'lost_to_follow_up', closed_at: at });
    }

    default:
      return refuse(400, 'Unknown action.');
  }
};

export const isOverdue = (referral, now = new Date()) =>
  referral?.status === 'referred' && new Date(referral.follow_up_due_at) < now;

const WORKLIST_RANK = { referred: 1, reached: 2, not_reached: 3, lost_to_follow_up: 4, closed: 5 };

/** Overdue first, then what needs an answer soonest. */
export const sortForFollowUp = (referrals, now = new Date()) =>
  [...referrals].sort((a, b) => {
    const ra = isOverdue(a, now) ? 0 : (WORKLIST_RANK[a.status] ?? 9);
    const rb = isOverdue(b, now) ? 0 : (WORKLIST_RANK[b.status] ?? 9);
    if (ra !== rb) return ra - rb;
    return new Date(a.follow_up_due_at) - new Date(b.follow_up_due_at);
  });

/**
 * What a hospital desk sees through the link, and nothing more.
 *
 * Enough to match the person in front of them to the slip in their hand — a
 * first name, an age, where they came from — and no Aadhaar number, no notes,
 * no diagnosis. The slip carries the clinical story; a URL that can be
 * forwarded does not need to.
 */
export const publicView = ({ referral, patient = null, districtName = null }) => ({
  referral_code: referral.referral_code,
  hospital_name: referral.hospital_name,
  urgency: referral.urgency,
  referred_on: String(referral.created_at || '').slice(0, 10) || null,
  referring_district: districtName || null,
  patient: {
    first_name: String(patient?.full_name || '').trim().split(/\s+/)[0] || null,
    age_years: patient?.age_years ?? null,
    gender: patient?.gender ?? null
  },
  status: referral.status,
  outcome: referral.outcome || null,
  can_mark_arrived: ['referred', 'not_reached', 'lost_to_follow_up'].includes(referral.status),
  can_record_outcome: referral.status !== 'closed'
});
