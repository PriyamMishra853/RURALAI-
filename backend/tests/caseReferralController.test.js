/**
 * Doctor-to-doctor referral endpoints: what the controller does with the rules.
 *
 * caseReferralRules.test.js pins the decisions. These pin the writing: that a
 * refused request writes nothing, that the database's refusal of a second open
 * referral becomes a 409 rather than a 500, and — the one that matters most —
 * that a transfer of care which cannot move the case leaves no transfer
 * recorded.
 */
import { describe, expect, it, beforeEach, jest } from '@jest/globals';

const db = {};
const reset = () => {
  Object.assign(db, {
    visit: null, staff: null, prior: [], refRow: null,
    insertResult: null, insertError: null,
    updateResult: null, visitMove: null,
    writes: []
  });
};
reset();

jest.unstable_mockModule('../src/config/supabase.js', () => {
  const resolve = (s) => {
    if (s.op === 'insert') {
      db.writes.push({ table: s.table, op: 'insert', payload: s.payload });
      return { data: db.insertResult, error: db.insertError };
    }
    if (s.op === 'update') {
      db.writes.push({ table: s.table, op: 'update', payload: s.payload, filters: { ...s.filters } });
      if (s.table === 'case_referrals') return { data: s.wantsRow ? db.updateResult : null, error: null };
      if (s.table === 'visits') return { data: db.visitMove, error: null };
      return { data: null, error: null };
    }
    if (s.table === 'visits') return { data: db.visit, error: null };
    if (s.table === 'staff_profiles') return { data: db.staff, error: null };
    if (s.table === 'case_referrals') {
      return 'visit_id' in s.filters ? { data: db.prior, error: null } : { data: db.refRow, error: null };
    }
    return { data: null, error: null };
  };

  const from = (table) => {
    const s = { table, op: 'select', filters: {}, payload: null, wantsRow: false };
    const chain = {
      select() { if (s.op !== 'select') s.wantsRow = true; return chain; },
      eq(k, v) { s.filters[k] = v; return chain; },
      in(k, v) { s.filters[k] = v; return chain; },
      order() { return chain; },
      limit() { return chain; },
      insert(rows) { s.op = 'insert'; s.payload = rows; return chain; },
      update(patch) { s.op = 'update'; s.payload = patch; return chain; },
      single: async () => resolve(s),
      maybeSingle: async () => resolve(s),
      then: (ok, fail) => Promise.resolve(resolve(s)).then(ok, fail)
    };
    return chain;
  };

  return { supabaseAdmin: { from } };
});

const notified = [];
jest.unstable_mockModule('../src/services/notificationService.js', () => ({
  notify: async (n) => { notified.push(n); return []; },
  EVENTS: {}
}));
jest.unstable_mockModule('../src/middleware/audit.middleware.js', () => ({ logAuditEvent: async () => undefined }));

const { createCaseReferral, actOnCaseReferral } = await import('../src/controllers/caseReferral.controller.js');
const { istDateString } = await import('../src/services/schedulingService.js');

const DOCTOR = { id: 'doc-a', role: 'DOCTOR', name: 'Dr. A' };

const mockRes = () => {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; if (res.statusCode == null) res.statusCode = 200; return res; };
  return res;
};

const openVisit = (over = {}) => ({
  id: 'visit-1', visit_code: 'VIS-1', assigned_doctor_id: 'doc-a', district_id: 'dist-1',
  visit_date: istDateString(), status: 'awaiting_doctor', assistant_id: 'ast-1', patient_id: 'p-1',
  patients: { full_name: 'Test Patient' }, ...over
});

beforeEach(() => { reset(); notified.length = 0; });

describe('creating a referral', () => {
  const req = (body) => ({ params: { id: 'visit-1' }, body, user: DOCTOR, ip: '127.0.0.1' });
  const body = { to_doctor_id: 'doc-b', referral_type: 'second_opinion', clinical_question: 'Is this rash a drug reaction?' };

  it('asks for a doctor before touching the database', async () => {
    const res = mockRes();
    await createCaseReferral(req({ ...body, to_doctor_id: undefined }), res);
    expect(res.statusCode).toBe(400);
    expect(db.writes).toHaveLength(0);
  });

  it('writes the validated row and tells the receiving doctor', async () => {
    db.visit = openVisit();
    db.staff = { id: 'doc-b', full_name: 'Dr. B', role: 'doctor', status: 'active', district_id: 'dist-1' };
    db.insertResult = { id: 'ref-1', referral_type: 'second_opinion', urgency: 'routine', depth: 1 };

    const res = mockRes();
    await createCaseReferral(req(body), res);

    expect(res.statusCode).toBe(201);
    const insert = db.writes.find((w) => w.op === 'insert');
    expect(insert.payload[0]).toMatchObject({
      from_doctor_id: 'doc-a', to_doctor_id: 'doc-b', status: 'requested', accountable_doctor_id: 'doc-a'
    });
    expect(notified).toHaveLength(1);
    expect(notified[0].event).toBe('CASE_REFERRAL_REQUESTED');
    expect(notified[0].recipients).toEqual([{ id: 'doc-b', role: 'DOCTOR' }]);
    // Identifiers only: the clinical question stays on the case.
    expect(JSON.stringify(notified[0].payload)).not.toMatch(/rash/);
  });

  it('writes nothing when the rules refuse', async () => {
    db.visit = openVisit({ assigned_doctor_id: 'doc-x' });
    db.staff = { id: 'doc-b', role: 'doctor', status: 'active', district_id: 'dist-1' };
    const res = mockRes();
    await createCaseReferral(req(body), res);
    expect(res.statusCode).toBe(404);
    expect(db.writes).toHaveLength(0);
    expect(notified).toHaveLength(0);
  });

  it('turns the one-open-referral index into a 409, not a 500', async () => {
    db.visit = openVisit();
    db.staff = { id: 'doc-b', role: 'doctor', status: 'active', district_id: 'dist-1' };
    db.insertError = { code: '23505', message: 'duplicate key value violates unique constraint' };
    const res = mockRes();
    await createCaseReferral(req(body), res);
    expect(res.statusCode).toBe(409);
    expect(notified).toHaveLength(0);
  });
});

describe('answering a referral', () => {
  const req = (action, body = {}, user = { id: 'doc-b', role: 'DOCTOR', name: 'Dr. B' }) =>
    ({ params: { id: 'ref-1', action }, body, user, ip: '127.0.0.1' });
  const transfer = (over = {}) => ({
    id: 'ref-1', visit_id: 'visit-1', from_doctor_id: 'doc-a', to_doctor_id: 'doc-b',
    referral_type: 'transfer_of_care', status: 'requested',
    expires_at: new Date(Date.now() + 3600e3).toISOString(),
    accountable_doctor_id: 'doc-a', responded_at: null, completed_at: null, ...over
  });

  it('moves the case on an accepted transfer and tells both the referrer and the assistant', async () => {
    db.refRow = transfer();
    db.visit = openVisit();
    db.updateResult = { ...transfer(), status: 'completed', accountable_doctor_id: 'doc-b' };
    db.visitMove = { id: 'visit-1' };

    const res = mockRes();
    await actOnCaseReferral(req('accept'), res);

    expect(res.statusCode).toBe(200);
    const moved = db.writes.find((w) => w.table === 'visits' && w.op === 'update');
    expect(moved.payload).toMatchObject({ assigned_doctor_id: 'doc-b' });
    // Only while still assigned to the referring doctor.
    expect(moved.filters).toMatchObject({ assigned_doctor_id: 'doc-a' });
    expect(notified[0].recipients).toEqual([
      { id: 'doc-a', role: 'DOCTOR' },
      { id: 'ast-1', role: 'CLINIC_ASSISTANT' }
    ]);
  });

  it('refuses and records no transfer when the case has already moved', async () => {
    db.refRow = transfer();
    db.visit = openVisit();
    db.updateResult = { ...transfer(), status: 'completed', accountable_doctor_id: 'doc-b' };
    db.visitMove = null;

    const res = mockRes();
    await actOnCaseReferral(req('accept'), res);

    expect(res.statusCode).toBe(409);
    const rollback = db.writes.filter((w) => w.table === 'case_referrals' && w.op === 'update').at(-1);
    expect(rollback.payload).toMatchObject({ status: 'requested', accountable_doctor_id: 'doc-a' });
    expect(notified).toHaveLength(0);
  });

  it('reports a referral that changed underneath the answer', async () => {
    db.refRow = transfer({ referral_type: 'second_opinion' });
    db.visit = openVisit();
    db.updateResult = null;

    const res = mockRes();
    await actOnCaseReferral(req('accept'), res);
    expect(res.statusCode).toBe(409);
    expect(notified).toHaveLength(0);
  });

  it('will not let a decided case be picked up again', async () => {
    db.refRow = transfer();
    db.visit = openVisit({ status: 'completed' });

    const res = mockRes();
    await actOnCaseReferral(req('accept'), res);

    expect(res.statusCode).toBe(409);
    const cancelled = db.writes.find((w) => w.table === 'case_referrals' && w.op === 'update');
    expect(cancelled.payload).toMatchObject({ status: 'cancelled' });
    expect(db.writes.some((w) => w.table === 'visits')).toBe(false);
  });
});
