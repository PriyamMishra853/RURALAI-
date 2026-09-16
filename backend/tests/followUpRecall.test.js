/**
 * Follow-up recall, through the controllers.
 *
 * The rules are tested on their own; these check the parts that only exist
 * once a database is involved — district scoping, the guarded update losing a
 * race, the doctor's day count being refused only when it would schedule
 * something, and a return visit completing the follow-up it answers without
 * ever failing the visit.
 */
import { describe, expect, it, beforeEach, jest } from '@jest/globals';

const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString();

const db = {};
const reset = () => {
  db.followUps = [];
  db.updates = [];
  db.audits = [];
  db.loseRace = false;
  db.lookupError = null;
};

jest.unstable_mockModule('../src/config/supabase.js', () => {
  const build = (table) => {
    const filters = [];
    let mode = 'select';
    let patch = null;
    let single = false;

    const matches = (row) => filters.every(([op, col, val]) => (op === 'in' ? val.includes(row[col]) : row[col] === val));
    const resolveFollowUps = () => {
      if (mode === 'update') {
        if (db.loseRace) return { data: null, error: null };
        const row = db.followUps.find(matches);
        if (!row) return { data: null, error: null };
        Object.assign(row, patch);
        return { data: { ...row }, error: null };
      }
      if (db.lookupError) return { data: null, error: db.lookupError };
      const rows = db.followUps.filter(matches);
      return { data: single ? rows[0] || null : rows, error: null };
    };

    const chain = {
      select: () => chain,
      order: () => chain,
      limit: () => chain,
      lte: () => chain,
      eq: (col, val) => { filters.push(['eq', col, val]); return chain; },
      in: (col, val) => { filters.push(['in', col, val]); return chain; },
      insert: () => { mode = 'insert'; return chain; },
      update: (p) => { mode = 'update'; patch = p; db.updates.push({ table, patch: p, filters }); return chain; },
      maybeSingle: async () => {
        single = true;
        if (table === 'follow_ups') return resolveFollowUps();
        if (table === 'patients') return { data: { aadhaar_number: '234567890123', full_name: 'Asha' } };
        return { data: null };
      },
      single: async () => ({
        data: { id: 'v-return', patient_id: '234567890123', created_at: new Date().toISOString() },
        error: null
      }),
      then: (resolve) => resolve(table === 'follow_ups' ? resolveFollowUps() : { data: null, error: null })
    };
    return chain;
  };
  return { supabaseAdmin: { from: build } };
});

jest.unstable_mockModule('../src/middleware/audit.middleware.js', () => ({
  logAuditEvent: async (event) => { db.audits.push(event); }
}));

jest.unstable_mockModule('../src/services/notificationService.js', () => ({
  notify: async () => [],
  EVENTS: { CASE_ASSIGNED: 'CASE_ASSIGNED', REVIEW_COMPLETED: 'DOCTOR_REVIEW_COMPLETED' }
}));

const { setFlagsForTest } = await import('../src/config/features.js');
const { actOnFollowUp, listFollowUps } = await import('../src/controllers/followUp.controller.js');
const { createVisit } = await import('../src/controllers/visit.controller.js');
const { recordDoctorReview } = await import('../src/controllers/doctor.controller.js');

const ASSISTANT = { id: 'ast-1', role: 'CLINIC_ASSISTANT', districtId: 'd1' };
const DOCTOR = { id: 'doc-1', role: 'DOCTOR', districtId: 'd1', name: 'Dr Rao' };

const makeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};

const followUp = (over = {}) => ({
  id: 'f1', visit_id: 'v1', patient_id: '234567890123', district_id: 'd1', status: 'scheduled',
  contact_attempts: 0, interval_days: 7, created_at: iso(-9), due_at: iso(-2), window_ends_at: iso(1), ...over
});

beforeEach(() => {
  reset();
  setFlagsForTest('follow_up_tracking');
});

describe('acting on a follow-up', () => {
  const act = async (id, action, body) => {
    const res = makeRes();
    await actOnFollowUp({ params: { id, action }, body, user: ASSISTANT, ip: '::1' }, res);
    return res;
  };

  it('logs a call and audits it', async () => {
    db.followUps = [followUp()];
    const res = await act('f1', 'contact', { result: 'will_come' });
    expect(res.statusCode).toBe(200);
    expect(res.body.follow_up).toMatchObject({ contact_attempts: 1, last_contact_result: 'will_come', timing: 'due' });
    expect(db.audits[0]).toMatchObject({ action: 'FOLLOW_UP_CONTACT', entityId: 'v1' });
  });

  it('cannot reach a follow-up in another district', async () => {
    db.followUps = [followUp({ district_id: 'd2' })];
    const res = await act('f1', 'contact', { result: 'will_come' });
    expect(res.statusCode).toBe(404);
  });

  it('answers 409 when someone else changed it first', async () => {
    db.followUps = [followUp()];
    db.loseRace = true;
    const res = await act('f1', 'missed', { reason: 'transport' });
    expect(res.statusCode).toBe(409);
    expect(db.audits).toHaveLength(0);
  });
});

describe('the recall list', () => {
  it('is scoped to the district and counts what is overdue', async () => {
    db.followUps = [
      followUp({ id: 'a', due_at: iso(-12), window_ends_at: iso(-9) }),
      followUp({ id: 'b' }),
      followUp({ id: 'c', district_id: 'd2' })
    ];
    const res = makeRes();
    await listFollowUps({ query: {}, user: ASSISTANT }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.follow_ups.map((f) => f.id)).toEqual(['a', 'b']);
    expect(res.body.counts).toEqual({ overdue: 1, due: 1, due_soon: 0 });
  });
});

describe('a return visit', () => {
  const visit = () => {
    const res = makeRes();
    return createVisit({ body: { aadhaar_number: '234567890123', vitals: {} }, user: ASSISTANT, ip: '::1' }, res).then(() => res);
  };

  it('completes the patient\'s open follow-up', async () => {
    db.followUps = [followUp()];
    const res = await visit();
    expect(res.statusCode).toBe(201);
    expect(db.followUps[0]).toMatchObject({ status: 'completed', completed_via: 'return_visit', completed_visit_id: 'v-return' });
    expect(db.audits.some((a) => a.action === 'FOLLOW_UP_COMPLETED')).toBe(true);
  });

  it('leaves follow-ups alone when the feature is off', async () => {
    setFlagsForTest('');
    db.followUps = [followUp()];
    await visit();
    expect(db.followUps[0].status).toBe('scheduled');
  });

  it('still creates the visit when the follow-up lookup fails', async () => {
    db.lookupError = { message: 'relation "follow_ups" does not exist' };
    const res = await visit();
    expect(res.statusCode).toBe(201);
  });
});

describe('the doctor\'s follow-up decision', () => {
  const review = (body) => {
    const res = makeRes();
    return recordDoctorReview({ params: { id: 'v1' }, body: { decision: 'follow_up', diagnosis: 'Viral fever', ...body }, user: DOCTOR, ip: '::1' }, res)
      .then(() => res);
  };

  it('refuses a follow-up with no usable day count when it would be scheduled', async () => {
    for (const days of [undefined, 0, 120, 'soon']) {
      const res = await review({ follow_up_days: days });
      expect(res.statusCode).toBe(400);
    }
  });

  it('keeps the old behaviour when the feature is off', async () => {
    setFlagsForTest('');
    const res = await review({});
    // Past validation, to the case lookup, which this mock does not satisfy.
    expect(res.statusCode).toBe(404);
  });
});
