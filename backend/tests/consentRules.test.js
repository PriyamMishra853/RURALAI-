/**
 * Consent rules.
 *
 * The property that matters: nothing ever reads as consented unless a person
 * granted that exact purpose and it has not expired or been withdrawn. So
 * these mostly check the ways a "yes" must NOT appear — a different purpose,
 * an expired grant, a withdrawal.
 */
import { describe, expect, it } from '@jest/globals';

const {
  buildConsent, planWithdrawal, consentState, refusalForSharing, isActive, WORDING_VERSION
} = await import('../src/services/consentRules.js');

const NOW = new Date('2026-09-20T10:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const at = (days) => new Date(NOW.getTime() + days * DAY).toISOString();

const grant = (purpose, over = {}) => ({
  id: purpose, patient_id: '234567890123', purpose, status: 'granted',
  method: 'verbal', language: 'mr', wording_version: WORDING_VERSION,
  granted_at: at(-1), expires_at: null, ...over
});

describe('recording a consent', () => {
  it('records what would show it was informed', () => {
    const built = buildConsent({
      patientId: '234567890123', districtId: 'd1', purpose: 'treatment',
      method: 'verbal', language: 'mr', recordedBy: 'ast-1', now: NOW
    });
    expect(built.value).toMatchObject({
      purpose: 'treatment', method: 'verbal', language: 'mr',
      wording_version: WORDING_VERSION, recorded_by: 'ast-1', expires_at: null
    });
  });

  it('expires a sharing consent, and only a sharing consent', () => {
    const share = buildConsent({ patientId: 'p', districtId: 'd', purpose: 'share_with_facility', method: 'written', language: 'hi', now: NOW });
    expect(share.value.expires_at).toBe(at(180));
    for (const purpose of ['treatment', 'training']) {
      const other = buildConsent({ patientId: 'p', districtId: 'd', purpose, method: 'verbal', language: 'hi', now: NOW });
      expect(other.value.expires_at).toBeNull();
    }
  });

  it('refuses a purpose, method or language it cannot stand behind', () => {
    const base = { patientId: 'p', districtId: 'd', purpose: 'treatment', method: 'verbal', language: 'hi', now: NOW };
    expect(buildConsent({ ...base, purpose: 'everything' }).status).toBe(400);
    expect(buildConsent({ ...base, method: 'implied' }).status).toBe(400);
    expect(buildConsent({ ...base, language: '  ' }).status).toBe(400);
    expect(buildConsent({ ...base, patientId: null }).status).toBe(400);
  });
});

describe('withdrawal', () => {
  it('is a state, with who and when, not a deletion', () => {
    const plan = planWithdrawal({ consent: grant('training'), reason: 'changed her mind', withdrawnBy: 'ast-1', now: NOW });
    expect(plan.patch).toEqual({
      status: 'withdrawn', withdrawn_at: NOW.toISOString(),
      withdrawn_reason: 'changed her mind', withdrawn_by: 'ast-1'
    });
  });

  it('cannot be done twice', () => {
    expect(planWithdrawal({ consent: grant('training', { status: 'withdrawn' }), now: NOW }).status).toBe(409);
    expect(planWithdrawal({ consent: null, now: NOW }).status).toBe(404);
  });
});

describe('what is true right now', () => {
  it('keeps the three purposes apart', () => {
    const state = consentState([grant('treatment')], NOW);
    expect(state.treatment.granted).toBe(true);
    expect(state.share_with_facility.granted).toBe(false);
    expect(state.training.granted).toBe(false);
    expect(state.training.reason).toBe('never_asked');
  });

  it('reads an expired consent as absent, and says why', () => {
    const state = consentState([grant('share_with_facility', { expires_at: at(-1) })], NOW);
    expect(state.share_with_facility.granted).toBe(false);
    expect(state.share_with_facility.reason).toBe('expired');
    expect(isActive(grant('share_with_facility', { expires_at: at(1) }), NOW)).toBe(true);
  });

  it('reads a withdrawn consent as absent, and says why', () => {
    const state = consentState([grant('training', { status: 'withdrawn', withdrawn_at: at(-1) })], NOW);
    expect(state.training).toMatchObject({ granted: false, reason: 'withdrawn' });
  });

  it('lets a fresh grant after a withdrawal count', () => {
    const state = consentState([
      grant('training', { id: 'old', status: 'withdrawn', withdrawn_at: at(-5) }),
      grant('training', { id: 'new', granted_at: at(-1) })
    ], NOW);
    expect(state.training.granted).toBe(true);
  });
});

describe('the sharing gate', () => {
  it('refuses, in words a health worker can act on', () => {
    expect(refusalForSharing([], NOW)).toMatch(/has not been asked/);
    expect(refusalForSharing([grant('share_with_facility', { expires_at: at(-1) })], NOW)).toMatch(/expired/);
    expect(refusalForSharing([grant('share_with_facility', { status: 'withdrawn', withdrawn_at: at(-1) })], NOW)).toMatch(/withdrew/);
  });

  it('is not satisfied by consent to something else', () => {
    expect(refusalForSharing([grant('treatment'), grant('training')], NOW)).toMatch(/has not been asked/);
  });

  it('allows the disclosure when the patient agreed to it', () => {
    expect(refusalForSharing([grant('share_with_facility', { expires_at: at(30) })], NOW)).toBeNull();
  });
});
