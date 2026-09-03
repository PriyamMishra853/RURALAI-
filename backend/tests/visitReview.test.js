/**
 * The doctor's decision reaching the assistant.
 *
 * This is the loop the platform exists to close: the assistant is standing with
 * the patient, and the doctor's instruction is the thing they are waiting for.
 * Two ways it has failed, both silent:
 *
 *   The review was discarded for anything emergency-tier or referred, and a
 *   "reviewed offline by the receiving facility" message shown instead — while
 *   the instruction the assistant needed sat in the database. An emergency case
 *   is exactly where a signed decision matters most.
 *
 *   The panel that displays it renders only when the page knows which visit is
 *   open, and the page never looked one up. That half lives in the frontend;
 *   this file covers the endpoint.
 */
import { describe, expect, it, beforeEach, jest } from '@jest/globals';

const db = { visit: null };

jest.unstable_mockModule('../src/config/supabase.js', () => {
  const build = () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      maybeSingle: async () => ({ data: db.visit, error: null })
    };
    return chain;
  };
  return { supabaseAdmin: { from: build } };
});

jest.unstable_mockModule('../src/middleware/audit.middleware.js', () => ({ logAuditEvent: async () => undefined }));
jest.unstable_mockModule('../src/services/notificationService.js', () => ({
  notify: async () => [], EVENTS: { CASE_ASSIGNED: 'CASE_ASSIGNED', REVIEW_COMPLETED: 'DOCTOR_REVIEW_COMPLETED' }
}));

const { getVisitReview } = await import('../src/controllers/visit.controller.js');

const ASSISTANT = { id: 'ast-1', role: 'CLINIC_ASSISTANT', districtId: 'dist-1' };

const REVIEW = {
  id: 'rev-1',
  decision: 'refer_hospital',
  clinical_notes: 'Diagnosis: suspected dengue with warning signs',
  agreed_with_ai: true,
  created_at: '2026-09-03T10:00:00.000Z'
};

const visitWith = (over = {}) => ({
  id: 'visit-1',
  visit_code: 'VIS-000001',
  status: 'awaiting_doctor',
  risk_level: 'moderate',
  chief_complaint: 'fever',
  patients: { full_name: 'Rashmi Gupta' },
  doctor: { full_name: 'Dr Asha Rao' },
  doctor_reviews: [],
  prescriptions: [],
  ...over
});

const run = async () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  await getVisitReview({ params: { id: 'visit-1' }, user: ASSISTANT }, res);
  return res;
};

beforeEach(() => { db.visit = visitWith(); });

describe('a routine case', () => {
  it('reports pending while no review exists', async () => {
    const res = await run();
    expect(res.body.pending).toBe(true);
    expect(res.body.review).toBeNull();
    expect(res.body.closed).toBe(false);
  });

  it('returns the review once the doctor signs one', async () => {
    db.visit = visitWith({ doctor_reviews: [REVIEW], status: 'completed' });
    const res = await run();
    expect(res.body.pending).toBe(false);
    expect(res.body.review.decision).toBe('refer_hospital');
    expect(res.body.doctor_name).toBe('Dr Asha Rao');
  });

  it('returns the most recent review when there are several', async () => {
    const older = { ...REVIEW, id: 'rev-0', decision: 'follow_up', created_at: '2026-09-03T08:00:00.000Z' };
    db.visit = visitWith({ doctor_reviews: [older, REVIEW] });
    const res = await run();
    expect(res.body.review.id).toBe('rev-1');
  });
});

describe('an emergency or referred case', () => {
  it('shows the doctor\'s decision when one was recorded', async () => {
    // The regression: this returned closed:true and review:null, hiding the
    // most urgent instruction in the system behind a generic notice.
    db.visit = visitWith({ risk_level: 'emergency', status: 'referred', doctor_reviews: [REVIEW] });
    const res = await run();
    expect(res.body.closed).toBe(false);
    expect(res.body.review).not.toBeNull();
    expect(res.body.review.clinical_notes).toMatch(/dengue/);
  });

  it('still reports closed when no decision was ever recorded', async () => {
    // A spinner that never resolves would imply a review is coming when the
    // case has left the platform entirely.
    db.visit = visitWith({ risk_level: 'emergency', status: 'referred', doctor_reviews: [] });
    const res = await run();
    expect(res.body.closed).toBe(true);
    expect(res.body.reason).toMatch(/referred to hospital/i);
  });
});

describe('scoping', () => {
  it('refuses a visit the caller cannot see', async () => {
    db.visit = null;
    const res = await run();
    expect(res.statusCode).toBe(404);
  });
});
