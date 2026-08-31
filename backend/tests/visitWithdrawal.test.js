/**
 * Withdrawing an accidental case.
 *
 * The button is trivial; the refusals are the feature. A case may be withdrawn
 * only while it is still the assistant's own work in progress, because the
 * alternative is a case disappearing from a doctor's queue while they are
 * reading it — or a clinical decision being erased after the fact.
 *
 * These assert each refusal separately, so a future change that loosens one
 * guard cannot hide behind another still passing.
 */
import { describe, expect, it, beforeEach, jest } from '@jest/globals';

const db = {
  visit: null,
  consultations: 0,
  reviews: 0,
  updateError: null,
  updates: []
};

jest.unstable_mockModule('../src/config/supabase.js', () => {
  const build = (table) => {
    let mode = 'select';
    const chain = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      update: (patch) => { db.updates.push({ table, patch }); mode = 'update'; return chain; },
      maybeSingle: async () => ({ data: table === 'visits' ? db.visit : null }),
      // The count and update queries are awaited directly rather than through
      // maybeSingle, so the chain itself has to be thenable.
      then: (resolve) => {
        if (mode === 'update') return resolve({ error: db.updateError });
        if (table === 'consultations') return resolve({ count: db.consultations });
        if (table === 'doctor_reviews') return resolve({ count: db.reviews });
        return resolve({ data: null, error: null });
      }
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

const { deleteVisit } = await import('../src/controllers/visit.controller.js');

const ASSISTANT = { id: 'ast-1', role: 'CLINIC_ASSISTANT', districtId: 'dist-1', name: 'Sunita', email: 's@x.test' };

const LIVE_VISIT = {
  id: 'visit-1',
  visit_code: 'VIS-2026-000001',
  status: 'in_progress',
  assigned_doctor_id: null,
  deleted_at: null,
  patient_id: '000000000001'
};

/** Minimal Express double that records what the handler answered. */
const makeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};

const run = async (overrides = {}) => {
  const res = makeRes();
  await deleteVisit({ params: { id: 'visit-1' }, body: { reason: 'wrong patient' }, user: ASSISTANT, ip: '::1' }, res);
  return res;
};

beforeEach(() => {
  db.visit = { ...LIVE_VISIT };
  db.consultations = 0;
  db.reviews = 0;
  db.updateError = null;
  db.updates = [];
});

describe('withdrawing a case that is still the assistant\'s own', () => {
  it('withdraws it', async () => {
    const res = await run();
    expect(res.statusCode).toBe(200);
    expect(res.body.deleted).toBe(true);
    expect(res.body.visit_code).toBe('VIS-2026-000001');
  });

  it('records who withdrew it and why, rather than removing the row', async () => {
    await run();
    const update = db.updates.find((u) => u.table === 'visits');
    expect(update.patch.deleted_at).toEqual(expect.any(String));
    expect(update.patch.deleted_by).toBe('ast-1');
    expect(update.patch.deletion_reason).toBe('wrong patient');
    expect(update.patch.status).toBe('cancelled');
  });
});

describe('refusals', () => {
  it('refuses once a doctor has been assigned', async () => {
    db.visit.assigned_doctor_id = 'doc-1';
    const res = await run();
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toMatch(/already been sent to a doctor/i);
    expect(db.updates).toHaveLength(0);
  });

  it('refuses once a consultation is booked against it', async () => {
    db.consultations = 1;
    const res = await run();
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toMatch(/consultation/i);
    expect(db.updates).toHaveLength(0);
  });

  it('refuses once a doctor has recorded a decision', async () => {
    db.reviews = 1;
    const res = await run();
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toMatch(/decision/i);
    expect(db.updates).toHaveLength(0);
  });

  it('refuses a visit outside the caller\'s district', async () => {
    // The district filter is part of the lookup, so an out-of-district visit
    // simply does not resolve.
    db.visit = null;
    const res = await run();
    expect(res.statusCode).toBe(404);
    expect(db.updates).toHaveLength(0);
  });

  it('says which guard applied, not a flat refusal', async () => {
    db.visit.assigned_doctor_id = 'doc-1';
    const assigned = await run();
    db.visit.assigned_doctor_id = null;
    db.consultations = 1;
    const booked = await run();
    expect(assigned.body.error).not.toBe(booked.body.error);
  });
});

describe('withdrawing twice', () => {
  it('is not an error — the caller wanted it gone and it is gone', async () => {
    db.visit.deleted_at = '2026-08-31T00:00:00.000Z';
    const res = await run();
    expect(res.statusCode).toBe(200);
    expect(res.body.already_deleted).toBe(true);
    expect(db.updates).toHaveLength(0);
  });
});

describe('when the write fails', () => {
  it('reports failure rather than claiming the case was withdrawn', async () => {
    db.updateError = { message: 'connection reset' };
    const res = await run();
    expect(res.statusCode).toBe(500);
    expect(res.body.deleted).toBeUndefined();
  });
});
