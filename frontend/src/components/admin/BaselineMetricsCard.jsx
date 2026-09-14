import React, { useEffect, useState } from 'react';
import { Gauge, Loader2, AlertCircle } from 'lucide-react';
import api from '../../services/api';
import { useI18n } from '../../i18n/index.jsx';

/**
 * Baseline outcome metrics (Roadmap v3, Phase 0).
 *
 * The "before" each later phase is measured against, shown as a table rather
 * than a chart: five unrelated intervals with very different sample sizes share
 * no scale worth plotting, and the sample size beside each median is the most
 * important number on the card — a median of five cases is not a finding.
 *
 * Demo data is off by default, because every seeded visit is synthetic and a
 * baseline of invented timings describes nothing. The outcomes the platform
 * cannot yet measure are listed by name, never shown as zero.
 */

const ROWS = [
  { field: 'intake_minutes', labelKey: 'admin.baseline.intake', label: 'Registration to AI assessment' },
  { field: 'registration_to_decision_minutes', labelKey: 'admin.baseline.decision', label: 'Registration to doctor decision' },
  { field: 'handoff_to_decision_minutes', labelKey: 'admin.baseline.handoff', label: 'Handed to a doctor, to decision' },
  { field: 'instant_consult_wait_minutes', labelKey: 'admin.baseline.instantWait', label: 'Instant consultation wait' },
  { field: 'scheduled_consult_start_delay_minutes', labelKey: 'admin.baseline.scheduledDelay', label: 'Scheduled call, start delay' }
];

export default function BaselineMetricsCard() {
  const { t, formatNumber } = useI18n();
  const [days, setDays] = useState(30);
  const [includeDemo, setIncludeDemo] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get('/admin/metrics/baseline', { params: { days, includeDemo } })
      .then((res) => { if (!cancelled) { setData(res.data); setError(null); } })
      .catch((err) => {
        if (!cancelled) setError(err.response?.data?.error || t('admin.baseline.failed', 'Could not compute the baseline metrics.'));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days, includeDemo, t]);

  const minutes = (v) => (v === null || v === undefined ? '—' : formatNumber(v));

  return (
    <section className="bg-surface-raised rounded-card border border-line shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-line flex flex-wrap items-center gap-3">
        <Gauge className="w-4 h-4 text-gov-600" />
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-ink">{t('admin.baseline.title', 'Baseline outcomes')}</h3>
          <p className="text-[11px] text-ink-muted">
            {t('admin.baseline.subtitle', 'The before that every improvement is measured against')}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            aria-label={t('admin.baseline.window', 'Time window')}
            className="bg-surface-raised border border-line-strong rounded-field px-2 py-1 text-[11px] text-ink"
          >
            {[7, 30, 90, 365].map((d) => (
              <option key={d} value={d}>{t('admin.baseline.days', 'Last {count} days', { count: formatNumber(d) })}</option>
            ))}
          </select>
          <label className="text-[11px] text-ink-muted flex items-center gap-1.5">
            <input type="checkbox" checked={includeDemo} onChange={(e) => setIncludeDemo(e.target.checked)} />
            {t('admin.baseline.includeDemo', 'Include demo data')}
          </label>
        </div>
      </div>

      <div className="p-5">
        {loading ? (
          <p className="text-xs text-ink-muted flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> {t('admin.baseline.loading', 'Computing…')}
          </p>
        ) : error ? (
          <p role="alert" className="text-xs text-tier-emergency flex items-center gap-2">
            <AlertCircle className="w-4 h-4" /> {error}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[11px] text-ink-muted border-b border-line">
                    <th className="py-2 pr-3 font-semibold">{t('admin.baseline.measure', 'Measure')}</th>
                    <th className="py-2 px-3 font-semibold text-right">{t('admin.baseline.cases', 'Cases')}</th>
                    <th className="py-2 px-3 font-semibold text-right">{t('admin.baseline.median', 'Median (min)')}</th>
                    <th className="py-2 pl-3 font-semibold text-right">{t('admin.baseline.p90', '90th percentile (min)')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {ROWS.map((row) => {
                    const m = data?.[row.field] || {};
                    return (
                      <tr key={row.field}>
                        <td className="py-2 pr-3 text-ink">{t(row.labelKey, row.label)}</td>
                        <td className="py-2 px-3 text-right tabular-nums text-ink-muted">{formatNumber(m.n ?? 0)}</td>
                        <td className="py-2 px-3 text-right tabular-nums font-semibold text-ink">{minutes(m.median)}</td>
                        <td className="py-2 pl-3 text-right tabular-nums text-ink">{minutes(m.p90)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="text-[11px] text-ink-muted mt-3">
              {t('admin.baseline.followUps', '{count} follow-up decisions in this window, none of them scheduled by the system.', {
                count: formatNumber(data?.follow_up_decisions ?? 0)
              })}
            </p>

            {data?.not_yet_measurable && (
              <div className="mt-3 p-3 rounded-field bg-surface-sunken border border-line">
                <p className="text-[11px] font-semibold text-ink">
                  {t('admin.baseline.notMeasurable', 'Not yet measurable')}
                </p>
                <ul className="mt-1 space-y-1 text-[11px] text-ink-muted list-disc pl-4">
                  <li>{t('admin.baseline.referralCompletion', 'Referral completion: facility referrals have no status yet, so arrival and outcome are unknown.')}</li>
                  <li>{t('admin.baseline.followUpAdherence', 'Follow-up adherence: nothing schedules a follow-up yet, so adherence cannot be counted.')}</li>
                </ul>
              </div>
            )}

            <p className="text-[10px] text-ink-subtle mt-3">
              {t('admin.baseline.sampleNote', 'A median of a handful of cases is a starting point, not a finding. Read the case count first.')}
            </p>
          </>
        )}
      </div>
    </section>
  );
}
