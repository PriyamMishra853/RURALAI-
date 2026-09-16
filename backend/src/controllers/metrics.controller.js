import { supabaseAdmin } from '../config/supabase.js';

/**
 * Baseline outcome metrics (Roadmap v3, Phase 0).
 *
 * The "before" every later phase is measured against. Computed in Postgres by
 * baseline_metrics() — see 14_baseline_metrics.sql for what each figure is and,
 * as importantly, which outcomes are deliberately absent because the platform
 * cannot measure them yet.
 *
 * Aggregates only: medians, 90th percentiles and counts. No patient, visit or
 * staff member is identifiable from this response, which is why administrators
 * may read it at all.
 */

const MAX_DAYS = 365;
const DEFAULT_DAYS = 30;

/** Scope exactly as getAnalytics resolves it, so the two views never disagree. */
export const scopeArgs = (scope) => ({
  scope_state: scope?.kind === 'state' ? scope.stateId : null,
  scope_district: scope?.kind === 'district' ? scope.districtId : null
});

export const parseWindow = (raw) => {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_DAYS;
  return Math.min(MAX_DAYS, Math.max(1, n));
};

/**
 * GET /api/admin/metrics/baseline?days=30&includeDemo=false
 */
export const getBaselineMetrics = async (req, res) => {
  const days = parseWindow(req.query.days);
  const includeDemo = req.query.includeDemo === 'true';

  const { data, error } = await supabaseAdmin.rpc('baseline_metrics', {
    ...scopeArgs(req.scope),
    window_days: days,
    include_demo: includeDemo
  });

  if (error) {
    console.error('baseline_metrics failed:', error.message);
    return res.status(500).json({ error: 'Could not compute the baseline metrics.' });
  }

  return res.json({
    scope: req.scope?.kind || 'national',
    generated_at: new Date().toISOString(),
    ...(data || {}),
    // Named on the response, not only in a migration comment, so a dashboard
    // cannot quietly present an absent figure as zero.
    not_yet_measurable: {
      // Only until migration 16: after it the function returns
      // referral_completion, and this note would contradict the figure beside it.
      ...(data?.referral_completion === undefined ? { referral_completion: 'Facility referrals have no status, so arrival and outcome are unknown. Closed-loop referral (Roadmap v3, Phase 1) makes this measurable.' } : {}),
      follow_up_adherence: 'A follow-up decision stores a day count that nothing acts on. The follow-up engine (Roadmap v3, Phase 4) makes this measurable.'
    }
  });
};
