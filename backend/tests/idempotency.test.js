/**
 * Making a write safe to repeat.
 *
 * The failure this prevents is a real one on a rural link: the request
 * arrives, the answer does not, the assistant presses the button again, and
 * the patient is registered twice. The rules that matter are that a repeat
 * returns the first answer without doing the work again, that a failed write
 * stays retryable, and that losing the idempotency store never costs the
 * write itself.
 */
import { describe, expect, it, beforeEach, jest } from '@jest/globals';

const db = {};
const reset = () => {
  db.rows = [];
  db.readError = null;
  db.insertError = null;
  db.inserts = 0;
};

jest.unstable_mockModule('../src/config/supabase.js', () => {
  const build = (table) => {
    const filters = [];
    const chain = {
      select: () => chain,
      delete: () => chain,
      lt: () => chain,
      gt: () => chain,
      eq: (col, val) => { filters.push([col, val]); return chain; },
      insert: (rows) => {
        db.inserts += 1;
        if (!db.insertError) db.rows.push(rows[0]);
        return Promise.resolve({ error: db.insertError });
      },
      maybeSingle: async () => {
        if (db.readError) return { data: null, error: db.readError };
        const row = db.rows.find((r) => filters.every(([col, val]) => r[col] === val));
        return { data: row || null, error: null };
      }
    };
    return chain;
  };
  return { supabaseAdmin: { from: build } };
});

const { idempotent } = await import('../src/middleware/idempotency.middleware.js');

const makeRes = () => {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.set = (k, v) => { res.headers[k] = v; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};

const USER = { id: 'ast-1', role: 'CLINIC_ASSISTANT' };

/** Run the middleware, then the handler it guards, if it was allowed through. */
const run = async ({ key, body = { name: 'Asha' }, handler, user = USER }) => {
  const req = { body, user, get: (h) => (h === 'Idempotency-Key' ? key : undefined) };
  const res = makeRes();
  let reached = false;
  await idempotent('patients.create')(req, res, () => { reached = true; });
  if (reached && handler) handler(res);
  return { res, reached };
};

const created = (res) => res.status(201).json({ id: 'p1' });

beforeEach(reset);

describe('with a key', () => {
  it('does the work once and replays the answer after that', async () => {
    const first = await run({ key: 'k1', handler: created });
    expect(first.reached).toBe(true);
    expect(first.res.body).toEqual({ id: 'p1' });

    const second = await run({ key: 'k1', handler: created });
    expect(second.reached).toBe(false);
    expect(second.res.statusCode).toBe(201);
    expect(second.res.body).toEqual({ id: 'p1' });
    expect(second.res.headers['Idempotency-Replayed']).toBe('true');
  });

  it('refuses the same key with a different body rather than answering wrongly', async () => {
    await run({ key: 'k1', handler: created });
    const other = await run({ key: 'k1', body: { name: 'Someone else' }, handler: created });
    expect(other.reached).toBe(false);
    expect(other.res.statusCode).toBe(409);
  });

  it('keeps a failed write retryable', async () => {
    await run({ key: 'k2', handler: (res) => res.status(500).json({ error: 'database unavailable' }) });
    const retry = await run({ key: 'k2', handler: created });
    expect(retry.reached).toBe(true);
    expect(retry.res.body).toEqual({ id: 'p1' });
  });

  it('keeps one person\'s key out of another\'s reach', async () => {
    await run({ key: 'k1', handler: created });
    const other = await run({ key: 'k1', user: { id: 'ast-2' }, handler: created });
    expect(other.reached).toBe(true);
  });

  it('refuses a key too long to be a key', async () => {
    const { res, reached } = await run({ key: 'x'.repeat(200) });
    expect(reached).toBe(false);
    expect(res.statusCode).toBe(400);
  });
});

describe('without a key, or without the store', () => {
  it('changes nothing for a caller that sends no key', async () => {
    const { reached } = await run({ key: undefined, handler: created });
    expect(reached).toBe(true);
    expect(db.inserts).toBe(0);
  });

  it('lets the write through when the store cannot be read', async () => {
    db.readError = { message: 'relation "request_idempotency" does not exist' };
    const { reached, res } = await run({ key: 'k3', handler: created });
    expect(reached).toBe(true);
    expect(res.body).toEqual({ id: 'p1' });
  });

  it('does not fail the write when the answer cannot be stored', async () => {
    db.insertError = { code: '23505', message: 'duplicate key' };
    const { reached, res } = await run({ key: 'k4', handler: created });
    expect(reached).toBe(true);
    expect(res.statusCode).toBe(201);
  });
});
