/**
 * GET /api/referral-tracking — the worklist, and one case's referrals.
 *
 * The case view asks by visit_id. These pin that asking that way never
 * widens what a user can see (the district filter is still applied, from the
 * signed-in user and not the query), that a malformed id is refused before it
 * reaches Postgres, and that a case's history comes back whole and in order —
 * including the referrals the worklist leaves out.
 */
import { describe, expect, it, beforeEach, jest } from '@jest/globals';

const db = { rows: [], error: null, queries: [] };

jest.unstable_mockModule('../src/config/supabase.js', () => {
  const from = (table) => {
    const q = { table, eq: {}, in: {}, order: null };
    db.queries.push(q);
    const chain = {
      select: () => chain,
      eq: (k, v) => { q.eq[k] = v; return chain; },
      in: (k, v) => { q.in[k] = v; return chain; },
      order: (k, opts) => { q.order = [k, opts]; return chain; },
      limit: () => chain,
      then: (ok, fail) => Promise.resolve({ data: db.rows, error: db.error }).then(ok, fail)
    };
    return chain;
  };
  return { supabaseAdmin: { from } };
});
jest.unstable_mockModule('../src/services/notificationService.js', () => ({ notify: async () => [], EVENTS: {} }));
jest.unstable_mockModule('../src/middleware/audit.middleware.js', () => ({ logAuditEvent: async () => undefined }));

const { listReferrals } = await import('../src/controllers/hospitalReferral.controller.js');

const VISIT = '5b0c1f7e-2a4d-4e8b-9c3f-1d2e3f4a5b6c';
const ASSISTANT = { id: 'ast-1', role: 'CLINIC_ASSISTANT', districtId: 'district-pune' };

const mockRes = () => {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; if (res.statusCode == null) res.statusCode = 200; return res; };
  return res;
};

const get = async (query) => {
  const res = mockRes();
  await listReferrals({ query, user: ASSISTANT }, res);
  return res;
};

const row = (over) => ({
  visit_id: VISIT, district_id: 'district-pune', hospital_name: 'District Hospital Pune',
  urgency: 'emergency', reached_at: null, outcome: null,
  visits: { visit_code: 'V-1', risk_level: 'HIGH', patients: { full_name: 'Asha', gender: 'female', date_of_birth: '1990-01-01' } },
  ...over
});

beforeEach(() => {
  db.rows = [];
  db.error = null;
  db.queries.length = 0;
});

describe('one case, by visit_id', () => {
  it('keeps the district filter from the signed-in user, and adds the visit', async () => {
    const res = await get({ visit_id: VISIT, district_id: 'district-elsewhere' });

    expect(res.statusCode).toBe(200);
    expect(db.queries).toHaveLength(1);
    expect(db.queries[0].table).toBe('hospital_referrals');
    expect(db.queries[0].eq).toEqual({ district_id: 'district-pune', visit_id: VISIT });
  });

  it('returns every status, newest first, as the database ordered them', async () => {
    // Newest is closed, oldest is overdue: the worklist would put the overdue
    // one first. A case's history should not be reshuffled.
    db.rows = [
      row({ id: 'r3', status: 'closed', outcome: 'admitted', created_at: '2026-09-17T09:00:00Z', follow_up_due_at: '2026-09-18T09:00:00Z' }),
      row({ id: 'r2', status: 'not_reached', created_at: '2026-09-12T09:00:00Z', follow_up_due_at: '2026-09-13T09:00:00Z' }),
      row({ id: 'r1', status: 'referred', created_at: '2026-09-01T09:00:00Z', follow_up_due_at: '2026-09-02T09:00:00Z' })
    ];

    const res = await get({ visit_id: VISIT, scope: 'open' });

    expect(db.queries[0].in).toEqual({});
    expect(db.queries[0].order).toEqual(['created_at', { ascending: false }]);
    expect(res.body.referrals.map((r) => r.id)).toEqual(['r3', 'r2', 'r1']);
    expect(res.body.referrals[2].overdue).toBe(true);
    expect(res.body.referrals[0]).not.toHaveProperty('visits');
    expect(res.body.counts).toEqual({ overdue: 1, open: 1 });
  });

  it.each([
    ['not a uuid', 'abc'],
    ['empty', ''],
    ['sql-shaped', "5b0c1f7e-2a4d-4e8b-9c3f-1d2e3f4a5b6c' or 1=1"],
    ['repeated', [VISIT, VISIT]]
  ])('refuses a visit_id that is %s, before querying', async (_, visitId) => {
    const res = await get({ visit_id: visitId });
    expect(res.statusCode).toBe(400);
    expect(db.queries).toHaveLength(0);
  });
});

describe('the worklist, without visit_id', () => {
  it('is unchanged: district-scoped, open referrals only, overdue first', async () => {
    db.rows = [
      row({ id: 'fresh', status: 'referred', created_at: '2026-09-17T09:00:00Z', follow_up_due_at: '2099-01-01T00:00:00Z' }),
      row({ id: 'late', visit_id: 'other', status: 'referred', created_at: '2026-09-01T09:00:00Z', follow_up_due_at: '2026-09-02T09:00:00Z' })
    ];

    const res = await get({});

    expect(db.queries[0].eq).toEqual({ district_id: 'district-pune' });
    expect(db.queries[0].in).toEqual({ status: ['referred', 'reached'] });
    expect(res.body.referrals.map((r) => r.id)).toEqual(['late', 'fresh']);
  });

  it('still takes scope=all', async () => {
    await get({ scope: 'all' });
    expect(db.queries[0].in).toEqual({});
  });
});
