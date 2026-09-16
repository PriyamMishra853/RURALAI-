/**
 * When an intake started, recorded at visit creation.
 *
 * The timing is a measurement, not part of the case, so the rule that matters
 * most is that it can never cost a visit: a database that has not had
 * migration 17, or a write that fails for any other reason, loses one data
 * point and the visit is still created.
 */
import { describe, expect, it, beforeEach, jest } from '@jest/globals';

const db = { updates: [], inserts: [], timingError: null };

jest.unstable_mockModule('../src/config/supabase.js', () => {
  const build = (table) => {
    let mode = 'select';
    const chain = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      insert: (rows) => { db.inserts.push({ table, rows }); mode = 'insert'; return chain; },
      update: (patch) => { db.updates.push({ table, patch }); mode = 'update'; return chain; },
      maybeSingle: async () => ({
        data: table === 'patients' ? { aadhaar_number: '234567890123', clinic_district_id: 'dist-1' } : null
      }),
      single: async () => ({ data: { id: 'visit-1', visit_code: 'VIS-1' }, error: null }),
      then: (resolve) => resolve(mode === 'update' ? { error: db.timingError } : { data: null, error: null })
    };
    return chain;
  };
  return { supabaseAdmin: { from: build } };
});

jest.unstable_mockModule('../src/middleware/audit.middleware.js', () => ({
  logAuditEvent: async () => undefined
}));

jest.unstable_mockModule('../src/services/notificationService.js', () => ({
  notify: async () => [],
  EVENTS: { CASE_ASSIGNED: 'CASE_ASSIGNED', REVIEW_COMPLETED: 'DOCTOR_REVIEW_COMPLETED' }
}));

const { createVisit } = await import('../src/controllers/visit.controller.js');

const ASSISTANT = { id: 'ast-1', role: 'CLINIC_ASSISTANT', districtId: 'dist-1' };

const makeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};

const run = async (extra = {}) => {
  const res = makeRes();
  await createVisit({
    body: { aadhaar_number: '234567890123', chief_complaint: 'fever', vitals: {}, ...extra },
    user: ASSISTANT,
    ip: '::1'
  }, res);
  return res;
};

const timingWrites = () => db.updates.filter((u) => u.table === 'visits' && 'intake_started_at' in u.patch);

beforeEach(() => {
  db.updates = [];
  db.inserts = [];
  db.timingError = null;
});

describe('createVisit records when the intake began', () => {
  it('works the start back from the elapsed time', async () => {
    const before = Date.now();
    const res = await run({ intake_elapsed_seconds: 240 });
    expect(res.statusCode).toBe(201);
    const [write] = timingWrites();
    const startedMs = new Date(write.patch.intake_started_at).getTime();
    expect(before - startedMs).toBeGreaterThanOrEqual(239_000);
    expect(before - startedMs).toBeLessThanOrEqual(241_000);
  });

  it('writes nothing when the client sent no usable time', async () => {
    await run();
    await run({ intake_elapsed_seconds: -3 });
    await run({ intake_elapsed_seconds: 999_999 });
    expect(timingWrites()).toHaveLength(0);
  });

  it('still creates the visit when the timing write fails', async () => {
    db.timingError = { message: 'column "intake_started_at" of relation "visits" does not exist' };
    const res = await run({ intake_elapsed_seconds: 60 });
    expect(res.statusCode).toBe(201);
    expect(res.body.id).toBe('visit-1');
  });

  it('never puts the timing into the visit insert itself', async () => {
    await run({ intake_elapsed_seconds: 60 });
    const visitInsert = db.inserts.find((i) => i.table === 'visits');
    expect(visitInsert.rows[0]).not.toHaveProperty('intake_started_at');
    expect(visitInsert.rows[0]).not.toHaveProperty('intake_elapsed_seconds');
  });
});
