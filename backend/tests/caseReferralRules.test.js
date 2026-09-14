/**
 * Doctor-to-doctor referral rules (Roadmap v3, Phase 1, F1).
 *
 * What these pin, because each is a way a patient comes to harm:
 *
 *   accountability never lapses — a question keeps the case with the doctor who
 *   asked it; a transfer moves it at acceptance, not before
 *
 *   a case cannot circulate — one open referral, no re-sending to a doctor who
 *   declined, a hard depth limit
 *
 *   an unanswered urgent request stops blocking the case on its own, with no
 *   background job having to run
 *
 *   nobody outside the two doctors can learn that a referral exists
 */
import { describe, expect, it } from '@jest/globals';
import {
  validateNewReferral, planTransition, effectiveStatus, expiresAt,
  MAX_DEPTH, EXPIRY_MINUTES, REFERRAL_EVENTS
} from '../src/services/caseReferralRules.js';

const NOW = new Date('2026-09-14T10:00:00.000Z');
const TODAY = '2026-09-14';

const caller = { id: 'doc-a' };
const visit = (over = {}) => ({
  id: 'visit-1', assigned_doctor_id: 'doc-a', district_id: 'dist-1',
  visit_date: TODAY, status: 'awaiting_doctor', ...over
});
const target = (over = {}) => ({ id: 'doc-b', role: 'doctor', status: 'active', district_id: 'dist-1', ...over });
const body = (over = {}) => ({
  referral_type: 'second_opinion', urgency: 'routine',
  clinical_question: 'Is this rash consistent with a drug reaction?', ...over
});
const create = (over = {}) => validateNewReferral({
  visit: visit(), caller, target: target(), priorReferrals: [], body: body(), today: TODAY, now: NOW, ...over
});

const referral = (over = {}) => ({
  id: 'ref-1', visit_id: 'visit-1', from_doctor_id: 'doc-a', to_doctor_id: 'doc-b',
  referral_type: 'second_opinion', status: 'requested',
  expires_at: new Date(NOW.getTime() + 60 * 60 * 1000).toISOString(), ...over
});
const act = (action, over = {}) => planTransition({
  referral: referral(over.referral), action, caller: over.caller || { id: 'doc-b' }, body: over.body || {}, now: NOW
});

describe('making a referral', () => {
  it('builds the row for a valid second opinion, accountable to the referring doctor', () => {
    const r = create();
    expect(r.ok).toBe(true);
    expect(r.value).toMatchObject({
      visit_id: 'visit-1', from_doctor_id: 'doc-a', to_doctor_id: 'doc-b',
      status: 'requested', depth: 1, accountable_doctor_id: 'doc-a'
    });
  });

  it('refuses a case that is not assigned to the caller, without revealing it', () => {
    const r = create({ visit: visit({ assigned_doctor_id: 'doc-x' }) });
    expect(r).toMatchObject({ ok: false, status: 404 });
  });

  it('refuses a referral to oneself', () => {
    expect(create({ target: target({ id: 'doc-a' }) })).toMatchObject({ ok: false, status: 400 });
  });

  it('refuses a doctor in another district', () => {
    expect(create({ target: target({ district_id: 'dist-2' }) })).toMatchObject({ ok: false, status: 404 });
  });

  it('refuses an inactive doctor, or someone who is not a doctor', () => {
    expect(create({ target: target({ status: 'suspended' }) })).toMatchObject({ ok: false, status: 404 });
    expect(create({ target: target({ role: 'clinic_assistant' }) })).toMatchObject({ ok: false, status: 404 });
  });

  it('refuses a case from a previous day', () => {
    expect(create({ visit: visit({ visit_date: '2026-09-13' }) })).toMatchObject({ ok: false, status: 409 });
  });

  it('refuses a case that is already closed', () => {
    for (const status of ['completed', 'referred', 'cancelled']) {
      expect(create({ visit: visit({ status }) })).toMatchObject({ ok: false, status: 409 });
    }
  });

  it('refuses a second open referral on the same case', () => {
    const prior = [referral({ status: 'accepted', to_doctor_id: 'doc-c' })];
    expect(create({ priorReferrals: prior })).toMatchObject({ ok: false, status: 409 });
  });

  it('allows a new referral once the earlier request has expired', () => {
    const prior = [referral({ status: 'requested', to_doctor_id: 'doc-c', expires_at: new Date(NOW.getTime() - 1000).toISOString() })];
    expect(create({ priorReferrals: prior }).ok).toBe(true);
  });

  it('refuses to send a case back to a doctor who declined it', () => {
    const prior = [referral({ status: 'declined', to_doctor_id: 'doc-b' })];
    expect(create({ priorReferrals: prior })).toMatchObject({ ok: false, status: 409 });
  });

  it(`stops a case being referred more than ${MAX_DEPTH} times`, () => {
    const prior = ['doc-c', 'doc-d', 'doc-e'].map((to) => referral({ status: 'completed', to_doctor_id: to }));
    expect(create({ priorReferrals: prior })).toMatchObject({ ok: false, status: 409 });
  });

  it('does not count cancelled referrals towards the depth limit', () => {
    const prior = ['doc-c', 'doc-d', 'doc-e'].map((to) => referral({ status: 'cancelled', to_doctor_id: to }));
    const r = create({ priorReferrals: prior });
    expect(r.ok).toBe(true);
    expect(r.value.depth).toBe(1);
  });

  it('requires a real clinical question', () => {
    expect(create({ body: body({ clinical_question: 'see pls' }) })).toMatchObject({ ok: false, status: 400 });
  });

  it('rejects an unknown referral type or urgency', () => {
    expect(create({ body: body({ referral_type: 'handoff' }) })).toMatchObject({ ok: false, status: 400 });
    expect(create({ body: body({ urgency: 'asap' }) })).toMatchObject({ ok: false, status: 400 });
  });

  it('gives an urgent request half an hour and a routine one a day', () => {
    const urgent = create({ body: body({ urgency: 'urgent' }) }).value;
    const routine = create().value;
    expect(new Date(urgent.expires_at).getTime() - NOW.getTime()).toBe(EXPIRY_MINUTES.urgent * 60 * 1000);
    expect(new Date(routine.expires_at).getTime() - NOW.getTime()).toBe(EXPIRY_MINUTES.routine * 60 * 1000);
  });
});

describe('expiry needs no background job', () => {
  it('reads a request past its expiry as expired', () => {
    expect(effectiveStatus(referral({ expires_at: new Date(NOW.getTime() - 1).toISOString() }), NOW)).toBe('expired');
  });

  it('leaves an answered referral alone even after its expiry time', () => {
    expect(effectiveStatus(referral({ status: 'accepted', expires_at: new Date(NOW.getTime() - 1).toISOString() }), NOW)).toBe('accepted');
  });

  it('refuses to accept an expired request, and records the expiry', () => {
    const r = act('accept', { referral: { expires_at: new Date(NOW.getTime() - 1).toISOString() } });
    expect(r).toMatchObject({ ok: false, status: 409, patch: { status: 'expired' } });
  });

  it('computes expiry from the urgency', () => {
    expect(expiresAt('urgent', NOW).getTime()).toBe(NOW.getTime() + 30 * 60 * 1000);
  });
});

describe('answering a referral', () => {
  it('accepts an opinion request without moving accountability', () => {
    const r = act('accept');
    expect(r.ok).toBe(true);
    expect(r.patch).toMatchObject({ status: 'accepted', accountable_doctor_id: 'doc-a' });
    expect(r.visitPatch).toBeUndefined();
  });

  it('moves the case, and accountability, at the moment a transfer is accepted', () => {
    const r = act('accept', { referral: { referral_type: 'transfer_of_care' } });
    expect(r.patch).toMatchObject({ status: 'completed', accountable_doctor_id: 'doc-b' });
    expect(r.visitPatch).toMatchObject({ assigned_doctor_id: 'doc-b' });
    expect(r.notify).toContain('assistant');
  });

  it('lets only the receiving doctor accept', () => {
    expect(act('accept', { caller: { id: 'doc-a' } })).toMatchObject({ ok: false, status: 403 });
  });

  it('hides the referral from anyone who is neither party', () => {
    expect(act('accept', { caller: { id: 'doc-z' } })).toMatchObject({ ok: false, status: 404 });
  });

  it('requires a reason to decline', () => {
    expect(act('decline')).toMatchObject({ ok: false, status: 400 });
    const r = act('decline', { body: { reason: 'Not my speciality' } });
    expect(r.patch).toMatchObject({ status: 'declined', decline_reason: 'Not my speciality', accountable_doctor_id: 'doc-a' });
  });

  it('returns an opinion only once accepted, and only with the opinion written', () => {
    expect(act('complete', { body: { response_notes: 'Looks like urticaria, stop the new drug.' } }))
      .toMatchObject({ ok: false, status: 409 });
    expect(act('complete', { referral: { status: 'accepted' }, body: { response_notes: 'ok' } }))
      .toMatchObject({ ok: false, status: 400 });
    const r = act('complete', { referral: { status: 'accepted' }, body: { response_notes: 'Looks like urticaria, stop the new drug.' } });
    expect(r.patch).toMatchObject({ status: 'completed', accountable_doctor_id: 'doc-a' });
  });

  it('does not treat a transfer as something to complete separately', () => {
    const r = act('complete', { referral: { referral_type: 'transfer_of_care', status: 'accepted' }, body: { response_notes: 'long enough notes here' } });
    expect(r).toMatchObject({ ok: false, status: 409 });
  });

  it('hands a case back with a reason, accountability staying with the referrer', () => {
    const r = act('return', { referral: { status: 'accepted' }, body: { reason: 'Needs a surgeon, not me' } });
    expect(r.patch).toMatchObject({ status: 'returned', accountable_doctor_id: 'doc-a' });
  });

  it('lets the referring doctor cancel only an unanswered request', () => {
    expect(act('cancel', { caller: { id: 'doc-a' } }).patch).toMatchObject({ status: 'cancelled' });
    expect(act('cancel', { caller: { id: 'doc-a' }, referral: { status: 'accepted' } })).toMatchObject({ ok: false, status: 409 });
    expect(act('cancel', { caller: { id: 'doc-b' } })).toMatchObject({ ok: false, status: 403 });
  });

  it('maps every outcome to a notification event', () => {
    for (const action of ['accept', 'decline', 'complete', 'return', 'cancel']) {
      const over = {
        accept: {}, decline: { body: { reason: 'Not available' } },
        complete: { referral: { status: 'accepted' }, body: { response_notes: 'Opinion written here.' } },
        return: { referral: { status: 'accepted' }, body: { reason: 'Wrong speciality' } },
        cancel: { caller: { id: 'doc-a' } }
      }[action];
      const r = act(action, over);
      expect(r.ok).toBe(true);
      expect(REFERRAL_EVENTS[r.outcome]).toMatch(/^CASE_REFERRAL_/);
    }
  });
});
