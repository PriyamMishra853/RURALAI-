/**
 * Baseline metrics and feature flags (Roadmap v3, Phase 0).
 *
 * The baseline is only worth having if it is scoped exactly like the rest of
 * the admin dashboard — a district admin must not see another district's
 * medians — and if an absent outcome is never presented as a zero.
 *
 * The flags are only worth having if an unknown name enables nothing and a
 * disabled feature's route is indistinguishable from one that does not exist.
 */
import { describe, expect, it, beforeEach, jest } from '@jest/globals';

const calls = [];
const rpcResult = { data: null, error: null };

jest.unstable_mockModule('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    rpc: async (name, args) => { calls.push({ name, args }); return rpcResult; }
  }
}));

const { getBaselineMetrics, getDistrictOutcomes, scopeArgs, parseWindow } = await import('../src/controllers/metrics.controller.js');
const { parseFlags, requireFeature, setFlagsForTest, isEnabled, enabledFeatures, FEATURES } =
  await import('../src/config/features.js');

const mockRes = () => {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; if (res.statusCode == null) res.statusCode = 200; return res; };
  return res;
};

beforeEach(() => {
  calls.length = 0;
  rpcResult.data = { window_days: 30, visits: 0 };
  rpcResult.error = null;
});

describe('baseline scope', () => {
  it('passes a district admin their district and nothing wider', () => {
    expect(scopeArgs({ kind: 'district', stateId: 's1', districtId: 'd1' }))
      .toEqual({ scope_state: null, scope_district: 'd1' });
  });

  it('passes a state admin their state', () => {
    expect(scopeArgs({ kind: 'state', stateId: 's1' })).toEqual({ scope_state: 's1', scope_district: null });
  });

  it('passes nothing for a national view', () => {
    expect(scopeArgs({ kind: 'national' })).toEqual({ scope_state: null, scope_district: null });
  });

  it('sends the resolved scope to the database function', async () => {
    const res = mockRes();
    await getBaselineMetrics({ query: {}, scope: { kind: 'district', districtId: 'd9' } }, res);
    expect(calls[0].name).toBe('baseline_metrics');
    expect(calls[0].args).toMatchObject({ scope_district: 'd9', scope_state: null, window_days: 30, include_demo: false });
  });
});

describe('baseline window and demo data', () => {
  it('clamps the window to between a day and a year', () => {
    expect(parseWindow('0')).toBe(1);
    expect(parseWindow('9999')).toBe(365);
    expect(parseWindow('abc')).toBe(30);
    expect(parseWindow(undefined)).toBe(30);
    expect(parseWindow('90')).toBe(90);
  });

  it('excludes demo data unless explicitly asked for it', async () => {
    await getBaselineMetrics({ query: {}, scope: { kind: 'national' } }, mockRes());
    await getBaselineMetrics({ query: { includeDemo: 'true' }, scope: { kind: 'national' } }, mockRes());
    expect(calls[0].args.include_demo).toBe(false);
    expect(calls[1].args.include_demo).toBe(true);
  });
});

describe('what the baseline says it cannot measure', () => {
  it('names the outcomes that are not yet measurable instead of reporting zero', async () => {
    const res = mockRes();
    await getBaselineMetrics({ query: {}, scope: { kind: 'national' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.not_yet_measurable.referral_completion).toMatch(/no status/i);
    expect(res.body.not_yet_measurable.follow_up_adherence).toMatch(/nothing acts on/i);
    expect(res.body).not.toHaveProperty('referral_completion_rate');
  });

  it('stops calling referral completion unmeasurable once the figure exists', async () => {
    rpcResult.data = { window_days: 30, referral_completion: { due: 4, reached: 3, rate: 0.75 } };
    const res = mockRes();
    await getBaselineMetrics({ query: {}, scope: { kind: 'national' } }, res);
    expect(res.body.referral_completion.rate).toBe(0.75);
    expect(res.body.not_yet_measurable.referral_completion).toBeUndefined();
    expect(res.body.not_yet_measurable.follow_up_adherence).toBeDefined();
  });

  it('stops calling follow-up adherence unmeasurable once the figure exists', async () => {
    rpcResult.data = { window_days: 30, follow_up_adherence: { due: 5, kept: 3, rate: 0.6 } };
    const res = mockRes();
    await getBaselineMetrics({ query: {}, scope: { kind: 'national' } }, res);
    expect(res.body.follow_up_adherence.rate).toBe(0.6);
    expect(res.body.not_yet_measurable.follow_up_adherence).toBeUndefined();
  });

  it('fails loudly rather than returning an empty baseline', async () => {
    rpcResult.error = { message: 'function baseline_metrics does not exist' };
    const res = mockRes();
    await getBaselineMetrics({ query: {}, scope: { kind: 'national' } }, res);
    expect(res.statusCode).toBe(500);
  });
});

describe('feature flags', () => {
  it('enables only known feature names', () => {
    const flags = parseFlags('doctor_referral, Baseline_Metrics ,not_a_feature');
    expect([...flags].sort()).toEqual(['baseline_metrics', 'doctor_referral']);
  });

  it('enables nothing when unset', () => {
    expect(parseFlags(undefined).size).toBe(0);
    expect(parseFlags('').size).toBe(0);
  });

  it('answers 404 for a disabled feature, as if the route did not exist', () => {
    setFlagsForTest('');
    const res = mockRes();
    let reached = false;
    requireFeature(FEATURES.DOCTOR_REFERRAL)({}, res, () => { reached = true; });
    expect(reached).toBe(false);
    expect(res.statusCode).toBe(404);
  });

  it('lets an enabled feature through', () => {
    setFlagsForTest('doctor_referral');
    let reached = false;
    requireFeature(FEATURES.DOCTOR_REFERRAL)({}, mockRes(), () => { reached = true; });
    expect(reached).toBe(true);
    expect(isEnabled(FEATURES.DOCTOR_REFERRAL)).toBe(true);
    expect(enabledFeatures()).toEqual(['doctor_referral']);
    setFlagsForTest('');
  });
});

describe('outcomes by district', () => {
  const run = async (scope, query = {}) => {
    const res = mockRes();
    await getDistrictOutcomes({ query, scope }, res);
    return res;
  };

  it('is scoped exactly as the baseline is', async () => {
    await run({ kind: 'district', stateId: 's1', districtId: 'd1' });
    expect(calls[0]).toMatchObject({
      name: 'district_outcomes',
      args: { scope_state: null, scope_district: 'd1', window_days: 30, include_demo: false }
    });
    await run({ kind: 'state', stateId: 's1' }, { days: '90', includeDemo: 'true' });
    expect(calls[1].args).toMatchObject({ scope_state: 's1', scope_district: null, window_days: 90, include_demo: true });
  });

  it('returns the rows with the sample size beside each figure', async () => {
    rpcResult.data = {
      window_days: 30,
      districts: [{ district: 'Pune', state: 'Maharashtra', visits: 12, decision_minutes: { n: 4, median: 22 } }]
    };
    const res = await run({ kind: 'state', stateId: 's1' });
    expect(res.statusCode).toBe(200);
    expect(res.body.districts[0]).toMatchObject({ district: 'Pune', decision_minutes: { n: 4, median: 22 } });
    expect(res.body.note).toMatch(/Read n before the median/);
  });

  it('fails loudly rather than returning an empty dashboard', async () => {
    rpcResult.error = { message: 'function district_outcomes does not exist' };
    const res = await run({ kind: 'national' });
    expect(res.statusCode).toBe(500);
  });
});
