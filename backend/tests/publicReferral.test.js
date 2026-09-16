/**
 * The hospital acknowledgement link: the one clinical write reachable without
 * signing in. These pin that a bad token learns nothing, that the link cannot
 * do more than the rules allow, and that what comes back never carries an
 * identifier or a note.
 */
import { describe, expect, it, beforeEach, jest } from '@jest/globals';

const state = { referral: null, updateResult: null, updates: [], notified: [], audits: [] };

jest.unstable_mockModule('../src/services/hospitalReferralService.js', () => ({
  REFERRAL_FIELDS: '*',
  insertReferral: async () => ({}),
  fetchInDistrict: async () => ({}),
  rotateAckToken: async () => ({}),
  findByToken: async (token) => (token === 'good-token-good-token-good' ? state.referral : null),
  applyGuardedUpdate: async (referral, patch) => {
    state.updates.push(patch);
    return { data: state.updateResult, error: null };
  }
}));

jest.unstable_mockModule('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: (table) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({
          data: table === 'patients'
            ? { full_name: 'Ram Naresh Yadav', gender: 'male', date_of_birth: '1958-03-01' }
            : { name: 'Pune' },
          error: null
        })
      };
      return chain;
    }
  }
}));

jest.unstable_mockModule('../src/services/notificationService.js', () => ({
  notify: async (n) => { state.notified.push(n); return []; },
  EVENTS: {}
}));
jest.unstable_mockModule('../src/middleware/audit.middleware.js', () => ({
  logAuditEvent: async (a) => { state.audits.push(a); }
}));

const { getPublicReferral, actOnPublicReferral } = await import('../src/controllers/hospitalReferral.controller.js');

const mockRes = () => {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; if (res.statusCode == null) res.statusCode = 200; return res; };
  return res;
};

const referral = (over = {}) => ({
  id: 'r1', visit_id: 'v1', patient_id: '123456789012', district_id: 'd1',
  origin: 'emergency', urgency: 'emergency', referred_by: 'ast-1', status: 'referred',
  referral_code: 'RF-ABCDEFGH', hospital_name: 'District Hospital Pune',
  notes: 'family worried about cost', created_at: '2026-09-16T10:00:00Z',
  reached_at: null, reached_via: null, outcome: null,
  visits: { assistant_id: 'ast-1' }, ...over
});

beforeEach(() => {
  state.referral = referral();
  state.updateResult = null;
  state.updates.length = 0;
  state.notified.length = 0;
  state.audits.length = 0;
});

describe('a token that does not work', () => {
  it('learns nothing about why', async () => {
    const res = mockRes();
    await getPublicReferral({ params: { token: 'guess' } }, res);
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toMatch(/not valid, or it has expired/);
  });

  it('writes nothing', async () => {
    const res = mockRes();
    await actOnPublicReferral({ params: { token: 'guess', action: 'reached' }, body: {} }, res);
    expect(res.statusCode).toBe(404);
    expect(state.updates).toHaveLength(0);
  });
});

describe('a working link', () => {
  const req = (action, body = {}) => ({ params: { token: 'good-token-good-token-good', action }, body, ip: '1.2.3.4' });

  it('cannot record that a patient never came', async () => {
    const res = mockRes();
    await actOnPublicReferral(req('not_reached', { reason: 'cost' }), res);
    expect(res.statusCode).toBe(403);
    expect(state.updates).toHaveLength(0);
    expect(state.notified).toHaveLength(0);
  });

  it('confirms arrival, tells the clinic once, and audits with no staff actor', async () => {
    state.updateResult = { ...referral(), status: 'reached', reached_via: 'hospital', reached_at: '2026-09-17T10:00:00Z' };

    const res = mockRes();
    await actOnPublicReferral(req('reached'), res);

    expect(res.statusCode).toBe(200);
    expect(state.updates[0]).toMatchObject({ status: 'reached', reached_via: 'hospital' });
    expect(state.notified).toHaveLength(1);
    // The referrer and the visit's assistant are the same person here: told once.
    expect(state.notified[0].recipients).toEqual([{ id: 'ast-1', role: 'CLINIC_ASSISTANT' }]);
    expect(state.notified[0].event).toBe('REFERRAL_REACHED');
    expect(state.audits[0]).toMatchObject({ actorId: null, metadata: expect.objectContaining({ via: 'hospital_link' }) });
  });

  it('returns a view with no identifier and no note', async () => {
    state.updateResult = { ...referral(), status: 'reached', reached_at: 'now', reached_via: 'hospital' };
    const res = mockRes();
    await actOnPublicReferral(req('reached'), res);

    const text = JSON.stringify(res.body);
    expect(text).not.toContain('123456789012');
    expect(text).not.toContain('family worried');
    expect(text).not.toContain('Yadav');
    expect(res.body.referral.patient.first_name).toBe('Ram');
  });

  it('treats a second tap as done, not as another event', async () => {
    state.referral = referral({ status: 'reached', reached_at: 'earlier', reached_via: 'hospital' });
    const res = mockRes();
    await actOnPublicReferral(req('reached'), res);
    expect(res.body.unchanged).toBe(true);
    expect(state.updates).toHaveLength(0);
    expect(state.notified).toHaveLength(0);
  });

  it('reports a race rather than blending two answers', async () => {
    state.updateResult = null;
    const res = mockRes();
    await actOnPublicReferral(req('reached'), res);
    expect(res.statusCode).toBe(409);
    expect(state.notified).toHaveLength(0);
  });
});
