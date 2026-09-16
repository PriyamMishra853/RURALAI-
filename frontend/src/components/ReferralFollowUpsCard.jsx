import React, { useCallback, useEffect, useState } from 'react';
import { Building2, AlertTriangle, RefreshCw } from 'lucide-react';
import api from '../services/api';
import { useI18n } from '../i18n/index.jsx';
import { useFeature, FEATURES } from '../context/FeatureContext';
import { Card } from './ui';
import ReferralFollowUpActions, { statusText } from './ReferralFollowUpActions';

/**
 * Referral follow-ups (Roadmap v3, Phase 1).
 *
 * The worklist that closes the loop from the clinic's side. Every referral to
 * hospital lands here with a time by which the clinic should know whether the
 * patient got there; past that time it rises to the top, because an emergency
 * that nobody has heard back about is the patient to phone first.
 *
 * Absent entirely unless referral_tracking is switched on.
 */
export default function ReferralFollowUpsCard() {
  const enabled = useFeature(FEATURES.REFERRAL_TRACKING);
  const { t, formatNumber, formatDate } = useI18n();

  const [list, setList] = useState({ referrals: [], counts: { overdue: 0, open: 0 } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/referral-tracking');
      setList(res.data);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || t('followup.loadFailed', 'Referrals could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return null;

  const { referrals, counts } = list;
  const due = (r) => formatDate(r.follow_up_due_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <Card className={counts.overdue > 0 ? 'border-l-4 border-l-tier-high' : undefined}>
      <div className="px-4 sm:px-5 py-3 border-b border-line flex items-center gap-3">
        <Building2 className="w-4 h-4 text-gov-600" />
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-ink">{t('followup.title', 'Referral follow-ups')}</h3>
          <p className="text-[11px] text-ink-muted">
            {counts.overdue > 0
              ? t('followup.overdueCount', '{count} overdue — find out whether these patients reached hospital', { count: formatNumber(counts.overdue) })
              : t('followup.openCount', '{count} referrals waiting for an answer', { count: formatNumber(counts.open) })}
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          aria-label={t('action.refresh', 'Refresh')}
          className="ml-auto p-1.5 rounded-field hover:bg-surface-sunken"
        >
          <RefreshCw className={`w-4 h-4 text-ink-muted ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <p role="alert" className="px-5 pt-3 text-xs text-tier-emergency flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {error}
        </p>
      )}

      {!loading && referrals.length === 0 ? (
        <p className="px-5 py-4 text-xs text-ink-muted">
          {t('followup.none', 'No referral is waiting for an answer.')}
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {referrals.map((r) => (
            <li key={r.id} className="px-4 sm:px-5 py-3">
              <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-ink">
                    {r.patient?.full_name || t('followup.unknownPatient', 'Patient')}
                    {r.patient?.age_years != null && (
                      <span className="font-normal text-ink-muted"> · {formatNumber(r.patient.age_years)}</span>
                    )}
                  </p>
                  <p className="text-[11px] text-ink-muted">
                    {r.hospital_name} · {r.referral_code}
                    {r.urgency === 'emergency' && (
                      <span className="ml-1.5 text-tier-emergency font-semibold">{t('followup.emergency', 'EMERGENCY')}</span>
                    )}
                  </p>
                </div>
                <div className="ml-auto text-right">
                  <p className={`text-[11px] font-semibold ${r.overdue ? 'text-tier-emergency' : 'text-ink'}`}>
                    {r.overdue ? t('followup.overdue', 'Overdue') : statusText(t, r.status)}
                  </p>
                  {r.status === 'referred' && (
                    <p className="text-[10px] text-ink-subtle">{t('followup.dueBy', 'Know by {time}', { time: due(r) })}</p>
                  )}
                </div>
              </div>

              <ReferralFollowUpActions referral={r} onChanged={load} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
