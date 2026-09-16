import { supabaseAdmin } from '../config/supabase.js';
import { logAuditEvent } from '../middleware/audit.middleware.js';
import {
  buildReferral, newAckToken, hashToken, tokenUsable, referralCode, OPEN_STATUSES
} from './hospitalReferralRules.js';

/**
 * Closed-loop hospital referral: the writes (Roadmap v3, Phase 1).
 *
 * A service rather than controller code, because two controllers create
 * referrals — the doctor's review and the assistant's emergency confirmation —
 * and the referral PDF needs to issue a link. None of them should import
 * another controller to do it.
 *
 * The token hash is written here and filtered on here, and never selected into
 * anything that leaves this file.
 */

export const REFERRAL_FIELDS = `
  id, visit_id, patient_id, district_id, origin, urgency, hospital_name, hospital_district,
  referral_code, referred_by, status, not_reached_reason, outcome, notes,
  follow_up_due_at, reached_at, reached_via, closed_at, ack_token_expires_at, created_at, updated_at
`;

/** Insert, retrying once on the vanishingly rare referral-code collision. */
export const insertReferral = async (row) => {
  let value = row;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await supabaseAdmin
      .from('hospital_referrals')
      .insert([value])
      .select(REFERRAL_FIELDS)
      .single();
    if (!error) return { data };
    if (error.code === '23505' && /referral_code/.test(error.message || '') && attempt === 0) {
      value = { ...value, referral_code: referralCode() };
      continue;
    }
    return { error };
  }
  return { error: { message: 'referral could not be inserted' } };
};

/**
 * Called from the doctor's review. Never throws and never fails the review:
 * the decision is the clinical record, and losing it because the follow-up
 * tracker had a bad moment would be the wrong trade. A failure is logged loudly
 * and audited instead.
 */
export const createReferralForDecision = async ({ visit, doctor, hospitalName, ip }) => {
  try {
    const built = buildReferral({ visit, hospitalName, origin: 'doctor_decision', referredBy: doctor.id });
    if (!built.ok) {
      console.warn('hospital referral not tracked:', built.error);
      return null;
    }

    const { data, error } = await insertReferral(built.value);
    if (error) {
      // 23505 on the open-referral index: this visit is already being followed
      // up — an assistant confirmed the emergency before the doctor decided.
      if (error.code === '23505') return null;
      console.error('hospital referral insert failed:', error.message);
      await logAuditEvent({
        actorId: doctor.id, actorRole: doctor.role, action: 'HOSPITAL_REFERRAL_NOT_TRACKED',
        entityType: 'VISITS', entityId: visit.id, metadata: { reason: error.message }, ip
      });
      return null;
    }

    await logAuditEvent({
      actorId: doctor.id, actorRole: doctor.role, action: 'HOSPITAL_REFERRAL_CREATED',
      entityType: 'VISITS', entityId: visit.id,
      metadata: { referral_id: data.id, referral_code: data.referral_code, origin: data.origin, urgency: data.urgency },
      ip
    });
    return { referral: data, ackToken: built.token };
  } catch (err) {
    console.error('hospital referral tracking failed:', err.message);
    return null;
  }
};

export const fetchInDistrict = async (id, districtId) => {
  const { data, error } = await supabaseAdmin
    .from('hospital_referrals')
    .select(`${REFERRAL_FIELDS}, visits ( visit_code, assistant_id, risk_level )`)
    .eq('id', id)
    .eq('district_id', districtId)
    .maybeSingle();
  return { data, error };
};

/**
 * The referral a hospital link points at, if the link is still good.
 *
 * Unknown, malformed and expired all come back the same way, so the endpoint
 * cannot be used to learn which of those a guessed token was.
 */
export const findByToken = async (token, now = new Date()) => {
  if (typeof token !== 'string' || token.length < 24 || token.length > 128) return null;
  const { data, error } = await supabaseAdmin
    .from('hospital_referrals')
    .select(`${REFERRAL_FIELDS}, visits ( assistant_id )`)
    .eq('ack_token_hash', hashToken(token))
    .maybeSingle();
  if (error) {
    console.error('referral link lookup failed:', error.message);
    return null;
  }
  return data && tokenUsable(data, now) ? data : null;
};

/** A fresh link. The previous one stops working, which is the point of reprinting. */
export const rotateAckToken = async (referralId) => {
  const { token, hash, expiresAt } = newAckToken();
  const { error } = await supabaseAdmin
    .from('hospital_referrals')
    .update({ ack_token_hash: hash, ack_token_expires_at: expiresAt, updated_at: new Date().toISOString() })
    .eq('id', referralId);
  return error ? { error } : { token, expiresAt };
};

/** For the referral PDF: the open referral on a visit, with a link to print. */
export const issueAckLinkForVisit = async (visitId) => {
  const { data: referral } = await supabaseAdmin
    .from('hospital_referrals')
    .select('id, referral_code, hospital_name')
    .eq('visit_id', visitId)
    .in('status', OPEN_STATUSES)
    .maybeSingle();
  if (!referral) return null;

  const rotated = await rotateAckToken(referral.id);
  if (rotated.error) return null;
  return {
    referral_code: referral.referral_code,
    hospital_name: referral.hospital_name,
    ack_path: `/r/${rotated.token}`,
    expires_at: rotated.expiresAt
  };
};

/**
 * Apply a planned change only if the referral is still in the state the plan
 * was made from. Supabase REST has no multi-statement transaction; this is how
 * a receptionist and an assistant acting at the same moment get one success and
 * one "reload", never a blend of the two.
 */
export const applyGuardedUpdate = async (referral, patch) => {
  const { data, error } = await supabaseAdmin
    .from('hospital_referrals')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', referral.id)
    .eq('status', referral.status)
    .select(REFERRAL_FIELDS)
    .maybeSingle();
  return { data, error };
};
