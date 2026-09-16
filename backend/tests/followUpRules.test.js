/**
 * Follow-up recall rules.
 *
 * Adherence is only worth measuring if "kept" means the patient came back. So
 * most of these are about what a return visit may and may not complete, and
 * about a closed follow-up staying closed.
 */
import { describe, expect, it } from '@jest/globals';

const {
  buildFollowUp, planAction, followUpsCompletedBy, timingOf, sortForRecall, graceDaysFor, parseDays
} = await import('../src/services/followUpRules.js');

const NOW = new Date('2026-09-17T10:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const at = (days) => new Date(NOW.getTime() + days * DAY).toISOString();
const VISIT = { id: 'v1', patient_id: '234567890123', district_id: 'd1' };

const open = (over = {}) => ({
  id: 'f1', visit_id: 'v1', status: 'scheduled', contact_attempts: 0,
  created_at: at(0), due_at: at(7), window_ends_at: at(10), ...over
});

describe('scheduling', () => {
  it('schedules from the decision with a grace window', () => {
    const built = buildFollowUp({ visit: VISIT, doctorId: 'doc', days: 7, now: NOW });
    expect(built.ok).toBe(true);
    expect(built.value).toMatchObject({
      visit_id: 'v1', patient_id: '234567890123', district_id: 'd1', created_by: 'doc',
      interval_days: 7, due_at: at(7), window_ends_at: at(10), status: 'scheduled'
    });
  });

  it('scales the grace window with the interval', () => {
    expect(graceDaysFor(1)).toBe(1);
    expect(graceDaysFor(3)).toBe(1);
    expect(graceDaysFor(14)).toBe(3);
    expect(graceDaysFor(30)).toBe(7);
  });

  it('refuses a day count the form could not have sent', () => {
    for (const bad of [0, 91, -2, 2.5, '7 days', '', null, undefined]) {
      expect(parseDays(bad)).toBeNull();
      expect(buildFollowUp({ visit: VISIT, doctorId: 'doc', days: bad, now: NOW }).ok).toBe(false);
    }
    expect(parseDays('14')).toBe(14);
  });

  it('refuses a visit without a patient or district', () => {
    expect(buildFollowUp({ visit: { id: 'v1' }, doctorId: 'doc', days: 3, now: NOW }).ok).toBe(false);
  });
});

describe('staff actions', () => {
  it('counts a call and guards on the attempt count', () => {
    const plan = planAction({ followUp: open({ contact_attempts: 2 }), action: 'contact', body: { result: 'no_answer' }, now: NOW });
    expect(plan.ok).toBe(true);
    expect(plan.guard).toEqual({ status: 'scheduled', contact_attempts: 2 });
    expect(plan.patch).toEqual({ contact_attempts: 3, last_contact_at: NOW.toISOString(), last_contact_result: 'no_answer' });
  });

  it('records a return seen elsewhere as reported, not as a visit', () => {
    const plan = planAction({ followUp: open(), action: 'completed', body: { notes: '  seen by ASHA  ' }, now: NOW });
    expect(plan.patch).toEqual({ status: 'completed', completed_at: NOW.toISOString(), completed_via: 'reported', notes: 'seen by ASHA' });
  });

  it('needs a reason to miss or cancel', () => {
    expect(planAction({ followUp: open(), action: 'missed', body: {}, now: NOW }).status).toBe(400);
    expect(planAction({ followUp: open(), action: 'cancel', body: { reason: 'bored' }, now: NOW }).status).toBe(400);
    expect(planAction({ followUp: open(), action: 'missed', body: { reason: 'transport' }, now: NOW }).patch)
      .toMatchObject({ status: 'missed', closed_reason: 'transport' });
    expect(planAction({ followUp: open(), action: 'cancel', body: { reason: 'died' }, now: NOW }).patch)
      .toMatchObject({ status: 'cancelled', closed_reason: 'died' });
  });

  it('refuses a result it does not know', () => {
    expect(planAction({ followUp: open(), action: 'contact', body: { result: 'maybe' }, now: NOW }).status).toBe(400);
    expect(planAction({ followUp: open(), action: 'delete', body: {}, now: NOW }).status).toBe(400);
  });

  it('leaves a closed follow-up closed', () => {
    for (const status of ['completed', 'missed', 'cancelled']) {
      expect(planAction({ followUp: open({ status }), action: 'contact', body: { result: 'will_come' }, now: NOW }).status).toBe(409);
    }
    expect(planAction({ followUp: null, action: 'contact', body: {}, now: NOW }).status).toBe(404);
  });

  it('caps notes', () => {
    const plan = planAction({ followUp: open(), action: 'completed', body: { notes: 'x'.repeat(5000) }, now: NOW });
    expect(plan.patch.notes).toHaveLength(1000);
  });
});

describe('a return visit', () => {
  const visitAt = (days, id = 'v2') => ({ id, created_at: at(days) });

  it('completes an open follow-up, early or on time', () => {
    expect(followUpsCompletedBy([open()], visitAt(2))).toHaveLength(1);
    expect(followUpsCompletedBy([open()], visitAt(9))).toHaveLength(1);
  });

  it('completes a missed one, because the patient did come back', () => {
    expect(followUpsCompletedBy([open({ status: 'missed' })], visitAt(15))).toHaveLength(1);
  });

  it('does not reach back months, or complete itself', () => {
    expect(followUpsCompletedBy([open()], visitAt(41))).toHaveLength(0);
    expect(followUpsCompletedBy([open()], visitAt(2, 'v1'))).toHaveLength(0);
  });

  it('never completes a cancelled or already-completed follow-up, or one decided after the visit', () => {
    expect(followUpsCompletedBy([open({ status: 'cancelled' }), open({ status: 'completed' })], visitAt(5))).toHaveLength(0);
    expect(followUpsCompletedBy([open({ created_at: at(3) })], visitAt(2))).toHaveLength(0);
  });
});

describe('the recall list', () => {
  it('names where each follow-up stands', () => {
    expect(timingOf(open(), new Date(at(1)))).toBe('upcoming');
    expect(timingOf(open(), new Date(at(6.5)))).toBe('due_soon');
    expect(timingOf(open(), new Date(at(8)))).toBe('due');
    expect(timingOf(open(), new Date(at(11)))).toBe('overdue');
    expect(timingOf(open({ status: 'completed' }), new Date(at(11)))).toBe('closed');
  });

  it('puts the longest-overdue patient first', () => {
    const list = [
      open({ id: 'upcoming', due_at: at(20), window_ends_at: at(23) }),
      open({ id: 'overdue-recent', due_at: at(-5), window_ends_at: at(-2) }),
      open({ id: 'due', due_at: at(-1), window_ends_at: at(2) }),
      open({ id: 'overdue-old', due_at: at(-12), window_ends_at: at(-9) })
    ];
    expect(sortForRecall(list, NOW).map((f) => f.id)).toEqual(['overdue-old', 'overdue-recent', 'due', 'upcoming']);
  });
});
