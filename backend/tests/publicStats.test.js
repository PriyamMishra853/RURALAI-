/**
 * The landing page's figures.
 *
 * They were typed into the page and went stale the day a second state was
 * seeded. What matters now: they are counted, only served states count as
 * coverage, a failure never produces an invented number, and the public
 * endpoint is cached so it cannot be used to hammer the database.
 */
import { describe, expect, it, beforeEach, jest } from '@jest/globals';

const db = {};
const reset = () => {
  db.states = [
    { name: 'Uttar Pradesh', districts: new Array(75).fill({ id: 'x' }) },
    { name: 'Maharashtra', districts: new Array(36).fill({ id: 'x' }) },
    { name: 'Kerala', districts: [] }
  ];
  db.counts = { patients: 2786, staff_profiles: 556 };
  db.fail = false;
  db.reads = 0;
};

jest.unstable_mockModule('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: (table) => {
      db.reads += 1;
      const chain = {
        select: () => chain,
        eq: () => chain,
        then: (resolve) => {
          if (db.fail) return resolve({ data: null, count: null, error: { message: 'database unavailable' } });
          if (table === 'states') return resolve({ data: db.states, error: null });
          return resolve({ count: db.counts[table] ?? 0, error: null });
        }
      };
      return chain;
    }
  }
}));

const { getPublicStats, resetPublicStatsCache } = await import('../src/controllers/publicStats.controller.js');

const makeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};
const run = async () => { const res = makeRes(); await getPublicStats({}, res); return res; };

beforeEach(() => { reset(); resetPublicStatsCache(); });

describe('public stats', () => {
  it('counts what the system actually serves', async () => {
    const { body } = await run();
    expect(body).toMatchObject({
      states: [{ name: 'Uttar Pradesh', districts: 75 }, { name: 'Maharashtra', districts: 36 }],
      districts: 111,
      patients: 2786,
      doctors: 556
    });
  });

  it('does not count a state with no districts as coverage', async () => {
    const { body } = await run();
    expect(body.states.map((s) => s.name)).not.toContain('Kerala');
  });

  it('serves from cache rather than hitting the database on every visit', async () => {
    await run();
    const readsAfterFirst = db.reads;
    await run();
    await run();
    expect(db.reads).toBe(readsAfterFirst);
  });

  it('answers 503 rather than inventing figures when it has none', async () => {
    db.fail = true;
    const res = await run();
    expect(res.statusCode).toBe(503);
    expect(res.body.patients).toBeUndefined();
  });
});
