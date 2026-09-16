/**
 * Closed-loop hospital referral: what a referral may become, and who may make it so.
 *
 * The risks are specific. A public link that could say a patient never came,
 * or overwrite an outcome, would let anyone holding a forwarded URL rewrite a
 * clinical record. A follow-up that counted "unknown" as arrived would report a
 * completion rate nobody earned. These pin both.
 */
import { describe, expect, it } from '@jest/globals';

const {
  buildReferral, planUpdate, publicView, isOverdue, sortForFollowUp,
  hashToken, newAckToken, tokenUsable, FOLLOW_UP_HOURS
} = await import('../src/services/hospitalReferralRules.js');

const NOW = new Date('2026-09-17T10:00:00Z');
const visit = (over = {}) => ({ id: 'v1', patient_id: '123456789012', district_id: 'd1', risk_level: 'moderate', ...over });
const ref = (over = {}) => ({
  id: 'r1', status: 'referred', origin: 'doctor_decision', referral_code: 'RF-ABCDEFGH',
  hospital_name: 'District Hospital Pune', created_at: '2026-09-16T10:00:00Z',
  follow_up_due_at: '2026-09-19T10:00:00Z', reached_at: null, reached_via: null, ...over
});

describe('creating a referral', () => {
  it('refuses without a visit or a hospital', () => {
    expect(buildReferral({ visit: null, hospitalName: 'X', origin: 'emergency' }).status).toBe(404);
    expect(buildReferral({ visit: visit(), hospitalName: '  ', origin: 'emergency' }).status).toBe(400);
    expect(buildReferral({ visit: visit(), hospitalName: 'x'.repeat(201), origin: 'emergency' }).status).toBe(400);
    expect(buildReferral({ visit: visit(), hospitalName: 'X', origin: 'guess' }).status).toBe(400);
  });

  it('gives an emergency a day and a routine referral three', () => {
    const e = buildReferral({ visit: visit(), hospitalName: 'H', origin: 'emergency', now: NOW });
    const r = buildReferral({ visit: visit(), hospitalName: 'H', origin: 'doctor_decision', now: NOW });
    expect(e.value.urgency).toBe('emergency');
    expect(new Date(e.value.follow_up_due_at) - NOW).toBe(FOLLOW_UP_HOURS.emergency * 3600e3);
    expect(r.value.urgency).toBe('routine');
    expect(new Date(r.value.follow_up_due_at) - NOW).toBe(FOLLOW_UP_HOURS.routine * 3600e3);
  });

  it('treats a doctor referring a high-risk case as an emergency', () => {
    const built = buildReferral({ visit: visit({ risk_level: 'HIGH' }), hospitalName: 'H', origin: 'doctor_decision' });
    expect(built.value.urgency).toBe('emergency');
  });

  it('stores only the hash of the acknowledgement token', () => {
    const built = buildReferral({ visit: visit(), hospitalName: 'H', origin: 'emergency' });
    expect(built.value.ack_token_hash).toBe(hashToken(built.token));
    expect(JSON.stringify(built.value)).not.toContain(built.token);
  });

  it('issues a code that can be read over a phone', () => {
    const { value } = buildReferral({ visit: visit(), hospitalName: 'H', origin: 'emergency' });
    expect(value.referral_code).toMatch(/^RF-[A-HJKMNP-Z2-9]{8}$/);
  });
});

describe('the acknowledgement token', () => {
  it('expires, and a missing expiry is never usable', () => {
    const { expiresAt } = newAckToken(NOW);
    expect(tokenUsable({ ack_token_expires_at: expiresAt }, NOW)).toBe(true);
    expect(tokenUsable({ ack_token_expires_at: expiresAt }, new Date('2027-01-01'))).toBe(false);
    expect(tokenUsable({ ack_token_expires_at: null }, NOW)).toBe(false);
  });
});

describe('what the hospital link may do', () => {
  it('cannot say a patient never arrived, or give up on them', () => {
    expect(planUpdate({ referral: ref(), action: 'not_reached', actor: 'hospital', body: { reason: 'cost' } }).status).toBe(403);
    expect(planUpdate({ referral: ref(), action: 'lost', actor: 'hospital' }).status).toBe(403);
  });

  it('confirms arrival, and a second tap changes nothing', () => {
    const plan = planUpdate({ referral: ref(), action: 'reached', actor: 'hospital', now: NOW });
    expect(plan.patch).toMatchObject({ status: 'reached', reached_via: 'hospital', reached_at: NOW.toISOString() });
    expect(plan.event).toBe('REFERRAL_REACHED');
    expect(planUpdate({ referral: ref({ status: 'reached' }), action: 'reached', actor: 'hospital' }).unchanged).toBe(true);
  });

  it('records an outcome once, and cannot overwrite it', () => {
    const plan = planUpdate({ referral: ref({ status: 'reached', reached_at: 'earlier', reached_via: 'hospital' }), action: 'outcome', actor: 'hospital', body: { outcome: 'admitted' } });
    expect(plan.patch).toMatchObject({ status: 'closed', outcome: 'admitted', reached_at: 'earlier' });
    expect(planUpdate({ referral: ref({ status: 'closed', outcome: 'admitted' }), action: 'outcome', actor: 'hospital', body: { outcome: 'died' } }).status).toBe(409);
  });

  it('never writes notes', () => {
    const plan = planUpdate({ referral: ref(), action: 'reached', actor: 'hospital', body: { notes: 'anything' } });
    expect(plan.patch).not.toHaveProperty('notes');
  });
});

describe('what the clinic may do', () => {
  it('records why a patient did not reach, and insists on a reason', () => {
    expect(planUpdate({ referral: ref(), action: 'not_reached', actor: 'staff', body: {} }).status).toBe(400);
    const plan = planUpdate({ referral: ref(), action: 'not_reached', actor: 'staff', body: { reason: 'transport' } });
    expect(plan.patch).toMatchObject({ status: 'not_reached', not_reached_reason: 'transport' });
    expect(plan.event).toBeNull();
  });

  it('cannot call an arrived patient not reached, or lost', () => {
    expect(planUpdate({ referral: ref({ status: 'reached' }), action: 'not_reached', actor: 'staff', body: { reason: 'cost' } }).status).toBe(409);
    expect(planUpdate({ referral: ref({ status: 'closed' }), action: 'lost', actor: 'staff' }).status).toBe(409);
  });

  it('lets a patient marked lost turn up after all', () => {
    const plan = planUpdate({ referral: ref({ status: 'lost_to_follow_up' }), action: 'reached', actor: 'staff', now: NOW });
    expect(plan.patch).toMatchObject({ status: 'reached', reached_via: 'staff', closed_at: null });
  });

  it('treats an outcome as proof of arrival', () => {
    const plan = planUpdate({ referral: ref({ status: 'not_reached' }), action: 'outcome', actor: 'staff', body: { outcome: 'treated_discharged' }, now: NOW });
    expect(plan.patch).toMatchObject({ status: 'closed', not_reached_reason: null, reached_at: NOW.toISOString(), reached_via: 'staff' });
  });

  it('may correct an outcome the hospital recorded', () => {
    const plan = planUpdate({ referral: ref({ status: 'closed', outcome: 'admitted', reached_at: 't', reached_via: 'hospital' }), action: 'outcome', actor: 'staff', body: { outcome: 'referred_onward' } });
    expect(plan.patch).toMatchObject({ outcome: 'referred_onward', reached_via: 'hospital' });
  });

  it('keeps notes short and treats blank as none', () => {
    expect(planUpdate({ referral: ref(), action: 'lost', actor: 'staff', body: { notes: '  ' } }).patch.notes).toBeNull();
    expect(planUpdate({ referral: ref(), action: 'lost', actor: 'staff', body: { notes: 'x'.repeat(5000) } }).patch.notes).toHaveLength(1000);
  });

  it('refuses an action nobody defined', () => {
    expect(planUpdate({ referral: ref(), action: 'delete', actor: 'staff' }).status).toBe(400);
  });
});

describe('the worklist', () => {
  it('counts only an unanswered referral past its due time as overdue', () => {
    expect(isOverdue(ref({ follow_up_due_at: '2026-09-17T09:00:00Z' }), NOW)).toBe(true);
    expect(isOverdue(ref({ follow_up_due_at: '2026-09-17T11:00:00Z' }), NOW)).toBe(false);
    expect(isOverdue(ref({ status: 'reached', follow_up_due_at: '2026-09-01T00:00:00Z' }), NOW)).toBe(false);
  });

  it('puts overdue first, then what is due soonest', () => {
    const list = sortForFollowUp([
      ref({ id: 'reached', status: 'reached', follow_up_due_at: '2026-09-10T00:00:00Z' }),
      ref({ id: 'later', follow_up_due_at: '2026-09-20T00:00:00Z' }),
      ref({ id: 'overdue', follow_up_due_at: '2026-09-16T00:00:00Z' }),
      ref({ id: 'sooner', follow_up_due_at: '2026-09-18T00:00:00Z' })
    ], NOW);
    expect(list.map((r) => r.id)).toEqual(['overdue', 'sooner', 'later', 'reached']);
  });
});

describe('what a hospital desk sees', () => {
  const view = publicView({
    referral: ref({ notes: 'family worried about cost', patient_id: '123456789012' }),
    patient: { full_name: 'Ram Naresh Yadav', age_years: 68, gender: 'male', aadhaar_number: '123456789012' },
    districtName: 'Pune'
  });

  it('is enough to match the patient in front of them', () => {
    expect(view.patient).toEqual({ first_name: 'Ram', age_years: 68, gender: 'male' });
    expect(view.referring_district).toBe('Pune');
    expect(view.can_mark_arrived).toBe(true);
  });

  it('carries no identifier and no clinical note', () => {
    const text = JSON.stringify(view);
    expect(text).not.toContain('123456789012');
    expect(text).not.toContain('Yadav');
    expect(text).not.toContain('family worried');
  });
});
