import React, { useCallback, useEffect, useState } from 'react';
import { Map, Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
import api from '../../services/api';
import { useI18n } from '../../i18n/index.jsx';
import { useFeature, FEATURES } from '../../context/FeatureContext';
import { Card } from '../ui';

/**
 * District outcomes (Roadmap v3, Phase 7).
 *
 * The baseline card answers "how is this scope doing". This answers the
 * question an administrator actually acts on: which districts are the ones to
 * ask about. One median for a state hides the district where nobody is
 * following anything up.
 *
 * Every figure carries its sample size, and a district with nothing to measure
 * says so rather than showing a zero — a zero reads as a result.
 */

export default function DistrictOutcomesCard() {
  const enabled = useFeature(FEATURES.DISTRICT_OUTCOMES);
  const { t, formatNumber } = useI18n();

  const [days, setDays] = useState(30);
  const [includeDemo, setIncludeDemo] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/metrics/districts', { params: { days, includeDemo } });
      setData(res.data);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || t('admin.districts.failed', 'District outcomes could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [days, includeDemo, t]);

  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return null;

  const dash = '—';
  const minutes = (m) => (m === null || m === undefined ? dash : t('admin.districts.min', '{n} min', { n: formatNumber(m) }));
  const rate = (block) => (!block || block.due === 0 || block.rate === null
    ? dash
    : `${formatNumber(Math.round(block.rate * 100))}%`);
  const withN = (n) => (n ? ` (${formatNumber(n)})` : '');

  const rows = (data?.districts || []).filter((d) => d.visits > 0 || d.sharing_consent?.patients > 0);

  return (
    <Card>
      <div className="px-4 sm:px-5 py-3 border-b border-line flex flex-wrap items-center gap-3">
        <Map className="w-4 h-4 text-gov-600" />
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-ink">{t('admin.districts.title', 'Outcomes by district')}</h3>
          <p className="text-[11px] text-ink-muted">
            {t('admin.districts.subtitle', 'The same measures as the baseline, one row per district. The number in brackets is how many cases it is based on.')}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            aria-label={t('admin.districts.window', 'Window')}
            className="bg-surface-raised border border-line-strong rounded-field px-2 py-1 text-[11px] text-ink"
          >
            <option value={30}>{t('admin.window.30', 'Last 30 days')}</option>
            <option value={90}>{t('admin.window.90', 'Last 90 days')}</option>
            <option value={365}>{t('admin.window.365', 'Last year')}</option>
          </select>
          <label className="flex items-center gap-1.5 text-[11px] text-ink-muted">
            <input type="checkbox" checked={includeDemo} onChange={(e) => setIncludeDemo(e.target.checked)} />
            {t('admin.districts.demo', 'Include demo data')}
          </label>
          <button type="button" onClick={load} aria-label={t('action.refresh', 'Refresh')} className="p-1.5 rounded-field hover:bg-surface-sunken">
            <RefreshCw className={`w-4 h-4 text-ink-muted ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="px-5 pt-3 text-xs text-tier-emergency flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {error}
        </p>
      )}

      {loading && !data ? (
        <p className="px-5 py-4 text-xs text-ink-muted flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> {t('common.loading', 'Loading…')}
        </p>
      ) : rows.length === 0 ? (
        <p className="px-5 py-4 text-xs text-ink-muted">
          {t('admin.districts.none', 'No district in this scope has a case in this window.')}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-ink-muted border-b border-line">
                <th className="py-2 px-3 font-semibold">{t('admin.districts.district', 'District')}</th>
                <th className="py-2 px-3 font-semibold text-right">{t('admin.districts.visits', 'Visits')}</th>
                <th className="py-2 px-3 font-semibold text-right">{t('admin.districts.decision', 'To doctor decision')}</th>
                <th className="py-2 px-3 font-semibold text-right">{t('admin.districts.wait', 'Consultation wait')}</th>
                <th className="py-2 px-3 font-semibold text-right">{t('admin.districts.referral', 'Referrals completed')}</th>
                <th className="py-2 px-3 font-semibold text-right">{t('admin.districts.followUp', 'Follow-ups kept')}</th>
                <th className="py-2 px-3 font-semibold text-right">{t('admin.districts.consent', 'Sharing consent')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((d) => (
                <tr key={`${d.state}-${d.district}`}>
                  <td className="py-2 px-3 text-ink">
                    {d.district}
                    <span className="text-ink-subtle"> · {d.state}</span>
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums text-ink">{formatNumber(d.visits)}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-ink-muted">
                    {minutes(d.decision_minutes?.median)}<span className="text-ink-subtle">{withN(d.decision_minutes?.n)}</span>
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums text-ink-muted">
                    {minutes(d.instant_consult_wait_minutes?.median)}<span className="text-ink-subtle">{withN(d.instant_consult_wait_minutes?.n)}</span>
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums text-ink-muted">
                    {rate(d.referral_completion)}<span className="text-ink-subtle">{withN(d.referral_completion?.due)}</span>
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums text-ink-muted">
                    {rate(d.follow_up_adherence)}<span className="text-ink-subtle">{withN(d.follow_up_adherence?.due)}</span>
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums text-ink-muted">
                    {d.sharing_consent?.patients
                      ? `${formatNumber(d.sharing_consent.granted)}/${formatNumber(d.sharing_consent.patients)}`
                      : dash}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="px-5 py-3 text-[10px] text-ink-subtle border-t border-line">
        {t('admin.districts.note', 'A dash means there was nothing to measure, which is not the same as zero. Referral and follow-up rates count only those whose time has passed.')}
      </p>
    </Card>
  );
}
