/**
 * Doctor-to-doctor referral — the rules, with no database in them.
 *
 * Every decision about whether a referral may be made, and what an answer to
 * one does, lives here as pure functions. The controller fetches rows, asks
 * these functions, and writes what they say. That split is deliberate: the
 * clinically important behaviour — who is accountable, when a case may move,
 * how long an urgent request may sit unanswered — is testable without a
 * database, and cannot drift between two endpoints that each re-implemented it.
 *
 * ── Accountability ─────────────────────────────────────────────────────────
 *
 * The registered practitioner is accountable for the consultation (TPG 2020).
 * A second opinion or a specialist consult never moves that: the referring
 * doctor asked a question and still owns the decision. A transfer of care
 * moves it, at the moment the receiving doctor accepts and not before — so
 * there is no interval in which nobody owns the case.
 *
 * ── Loops ──────────────────────────────────────────────────────────────────
 *
 * A case may be referred at most MAX_DEPTH times, may not be sent back to a
 * doctor who already declined it, and may have only one open referral at once.
 * A patient waiting while a case circulates between doctors is the failure
 * these limits exist to prevent.
 */

export const REFERRAL_TYPES = ['second_opinion', 'specialist_consult', 'transfer_of_care'];
export const URGENCIES = ['routine', 'urgent'];
export const OPEN_STATUSES = ['requested', 'accepted'];
export const CLOSED_VISIT_STATUSES = ['completed', 'referred', 'cancelled'];
export const ACTIONS = ['accept', 'decline', 'complete', 'return', 'cancel'];
export const MAX_DEPTH = 3;

/**
 * How long a request may sit unanswered. An urgent referral that nobody takes
 * within half an hour must hand control back to the referring doctor, who can
 * then choose someone else; a routine one gets a working day.
 */
export const EXPIRY_MINUTES = { urgent: 30, routine: 24 * 60 };

const QUESTION_MIN = 10;
const QUESTION_MAX = 2000;
const REASON_MIN = 5;
const OPINION_MIN = 10;

/** The notification each outcome sends. Enum values, compared in code. */
export const REFERRAL_EVENTS = {
  requested: 'CASE_REFERRAL_REQUESTED',
  accepted: 'CASE_REFERRAL_ACCEPTED',
  declined: 'CASE_REFERRAL_DECLINED',
  completed: 'CASE_REFERRAL_COMPLETED',
  returned: 'CASE_REFERRAL_RETURNED',
  cancelled: 'CASE_REFERRAL_CANCELLED'
};

const refuse = (status, error) => ({ ok: false, status, error });

export const expiresAt = (urgency, now = new Date()) =>
  new Date(now.getTime() + (EXPIRY_MINUTES[urgency] ?? EXPIRY_MINUTES.routine) * 60 * 1000);

/**
 * The status as it stands right now. A request past its expiry IS expired,
 * whether or not a row has been updated to say so — nothing depends on a
 * background job having run.
 */
export const effectiveStatus = (referral, now = new Date()) =>
  referral?.status === 'requested' && new Date(referral.expires_at).getTime() <= now.getTime()
    ? 'expired'
    : referral?.status;

/**
 * May this doctor refer this case to that doctor?
 *
 * @returns {{ok: true, value: object} | {ok: false, status: number, error: string}}
 *          `value` is the row to insert.
 */
export const validateNewReferral = ({
  visit, caller, target, priorReferrals = [], body = {}, today = null, now = new Date()
}) => {
  const type = body.referral_type;
  if (!REFERRAL_TYPES.includes(type)) {
    return refuse(400, `referral_type must be one of: ${REFERRAL_TYPES.join(', ')}.`);
  }
  const urgency = body.urgency || 'routine';
  if (!URGENCIES.includes(urgency)) {
    return refuse(400, `urgency must be one of: ${URGENCIES.join(', ')}.`);
  }
  const question = String(body.clinical_question || '').trim();
  if (question.length < QUESTION_MIN) {
    return refuse(400, 'State the clinical question you want answered, in at least a sentence.');
  }
  if (question.length > QUESTION_MAX) {
    return refuse(400, `The clinical question is limited to ${QUESTION_MAX} characters.`);
  }

  // Ownership is checked before anything about the case is revealed.
  if (!visit || !caller || visit.assigned_doctor_id !== caller.id) {
    return refuse(404, 'That case is not assigned to you.');
  }
  if (today && visit.visit_date && visit.visit_date < today) {
    return refuse(409, 'This case is from a previous day and is read-only.');
  }
  if (CLOSED_VISIT_STATUSES.includes(visit.status)) {
    return refuse(409, 'This case is already closed.');
  }

  if (target && target.id === caller.id) {
    return refuse(400, 'You cannot refer a case to yourself.');
  }
  // Same district only in Phase 1: sharing a record across a district line
  // needs the consent model Phase 3 builds.
  if (!target || target.role !== 'doctor' || target.status !== 'active'
      || target.district_id !== visit.district_id) {
    return refuse(404, 'That doctor is not available in this district.');
  }

  if (priorReferrals.some((r) => OPEN_STATUSES.includes(effectiveStatus(r, now)))) {
    return refuse(409, 'This case already has an open referral. Wait for an answer, or cancel it first.');
  }
  if (priorReferrals.some((r) => r.to_doctor_id === target.id && r.status === 'declined')) {
    return refuse(409, 'That doctor has already declined this case.');
  }

  const depth = priorReferrals.filter((r) => r.status !== 'cancelled').length + 1;
  if (depth > MAX_DEPTH) {
    return refuse(409, `This case has already been referred ${MAX_DEPTH} times. Decide it, or refer the patient to a hospital.`);
  }

  return {
    ok: true,
    value: {
      visit_id: visit.id,
      district_id: visit.district_id,
      from_doctor_id: caller.id,
      to_doctor_id: target.id,
      referral_type: type,
      urgency,
      clinical_question: question,
      status: 'requested',
      depth,
      // Asking a question never moves accountability.
      accountable_doctor_id: caller.id,
      expires_at: expiresAt(urgency, now).toISOString()
    }
  };
};

/**
 * What an answer to a referral does.
 *
 * @returns {{
 *   ok: boolean, status?: number, error?: string,
 *   patch?: object,        referral columns to write — present even on some refusals
 *   visitPatch?: object,   visit columns to write, for a transfer of care
 *   notify?: string[],     'from' | 'to' | 'assistant'
 *   outcome?: string       key into REFERRAL_EVENTS
 * }}
 */
export const planTransition = ({ referral, action, caller, body = {}, now = new Date() }) => {
  if (!ACTIONS.includes(action)) return refuse(400, `action must be one of: ${ACTIONS.join(', ')}.`);
  if (!referral || !caller) return refuse(404, 'No such referral.');

  const isTo = referral.to_doctor_id === caller.id;
  const isFrom = referral.from_doctor_id === caller.id;
  // Neither party: indistinguishable from a referral that does not exist.
  if (!isTo && !isFrom) return refuse(404, 'No such referral.');

  const at = now.toISOString();
  const current = effectiveStatus(referral, now);

  // Expired but not yet written down: record it, and refuse the action.
  if (current === 'expired' && referral.status === 'requested') {
    return {
      ok: false,
      status: 409,
      error: 'This referral expired before it was answered. The referring doctor can send it to someone else.',
      patch: { status: 'expired', completed_at: at }
    };
  }

  const receiverOnly = () => refuse(403, 'Only the doctor this case was referred to can do that.');
  const wrongState = (need) => refuse(409, `This referral is ${current}; that needs it to be ${need}.`);

  switch (action) {
    case 'accept': {
      if (!isTo) return receiverOnly();
      if (current !== 'requested') return wrongState('awaiting an answer');
      if (referral.referral_type === 'transfer_of_care') {
        // The transfer IS the acceptance: the case becomes theirs now, and they
        // answer for it from this instant.
        return {
          ok: true,
          patch: {
            status: 'completed', responded_at: at, completed_at: at,
            accountable_doctor_id: referral.to_doctor_id
          },
          visitPatch: { assigned_doctor_id: referral.to_doctor_id, assigned_at: at },
          notify: ['from', 'assistant'],
          outcome: 'accepted'
        };
      }
      return {
        ok: true,
        patch: { status: 'accepted', responded_at: at, accountable_doctor_id: referral.from_doctor_id },
        notify: ['from'],
        outcome: 'accepted'
      };
    }

    case 'decline': {
      if (!isTo) return receiverOnly();
      if (current !== 'requested') return wrongState('awaiting an answer');
      const reason = String(body.reason || '').trim();
      if (reason.length < REASON_MIN) {
        return refuse(400, 'Give the referring doctor a reason, so they can choose someone else.');
      }
      return {
        ok: true,
        patch: {
          status: 'declined', responded_at: at, completed_at: at,
          decline_reason: reason, accountable_doctor_id: referral.from_doctor_id
        },
        notify: ['from'],
        outcome: 'declined'
      };
    }

    case 'complete': {
      if (!isTo) return receiverOnly();
      if (referral.referral_type === 'transfer_of_care') {
        return refuse(409, 'A transfer of care is complete when it is accepted.');
      }
      if (current !== 'accepted') return wrongState('accepted');
      const opinion = String(body.response_notes || '').trim();
      if (opinion.length < OPINION_MIN) {
        return refuse(400, 'Write the opinion you are returning to the referring doctor.');
      }
      return {
        ok: true,
        patch: {
          status: 'completed', completed_at: at, response_notes: opinion,
          accountable_doctor_id: referral.from_doctor_id
        },
        notify: ['from'],
        outcome: 'completed'
      };
    }

    case 'return': {
      if (!isTo) return receiverOnly();
      if (current !== 'accepted') return wrongState('accepted');
      const reason = String(body.reason || '').trim();
      if (reason.length < REASON_MIN) return refuse(400, 'Say why the case is being handed back.');
      return {
        ok: true,
        patch: {
          status: 'returned', completed_at: at, decline_reason: reason,
          accountable_doctor_id: referral.from_doctor_id
        },
        notify: ['from'],
        outcome: 'returned'
      };
    }

    case 'cancel': {
      if (!isFrom) return refuse(403, 'Only the referring doctor can cancel a referral.');
      if (current !== 'requested') return refuse(409, 'Only a referral nobody has answered yet can be cancelled.');
      return {
        ok: true,
        patch: { status: 'cancelled', completed_at: at },
        notify: ['to'],
        outcome: 'cancelled'
      };
    }

    default:
      return refuse(400, 'Unknown action.');
  }
};
