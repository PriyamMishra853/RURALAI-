import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Building2, RefreshCw } from 'lucide-react';
import api from '../services/api';
import { useI18n } from '../i18n/index.jsx';
import { useRealtime } from '../context/RealtimeContext';
import { useFeature, FEATURES } from '../context/FeatureContext';
import { Card, CardHeader, Badge, Button, cn } from './ui';
import ReferralFollowUpActions, {
  NOT_REACHED_REASONS, OUTCOME_OPTIONS, statusText, optionText
} from './ReferralFollowUpActions';

/**
 * The hospital referral on the case being worked (Roadmap v3, Phase 1).
 *
 * The dashboard worklist answers "which patients do I phone"; this answers
 * "did this one get there" for the assistant who has the case open, without
 * leaving it to go and find the row. The actions are the worklist's own.
 *
 * Renders nothing until there is a referral, and nothing at all with
 * referral_tracking off.
 */

// A doctor's decision can create the referral; the hospital's link can move it.
const WATCHED_EVENTS = new Set(['DOCTOR_REVIEW_COMPLETED', 'REFERRAL_REACHED', 'REFERRAL_OUTCOME']);

/** Sent by TrackReferralButton when the assistant confirms an emergency referral on this screen. */
export const REFERRAL_TRACKED_EVENT = 'referral-tracking:created';

export default function HospitalReferralStatus({ visitId, className }) {
  const enabled = useFeature(FEATURES.REFERRAL_TRACKING);
  const { t, formatDate } = useI18n();
  const { subscribe } = useRealtime();
  const [referrals, setReferrals] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const shownVisit = useRef(visitId);

  const load = useCallback(async () => {
    if (!visitId) return;
    setRefreshing(true);
    try {
      const res = await api.get('/referral-tracking', { params: { visit_id: visitId } });
      // A slow answer for a case the screen has since moved off is not this case's.
      if (shownVisit.current === visitId) setReferrals(res.data?.referrals || []);
    } catch {
      // Keep what is on screen. The worklist is where a failure to load is reported.
    } finally {
      setRefreshing(false);
    }
  }, [visitId]);

  useEffect(() => {
    shownVisit.current = visitId;
    setReferrals([]);
    if (enabled && visitId) load();
  }, [enabled, visitId, load]);

  useEffect(() => {
    if (!enabled || !visitId) return undefined;
    return subscribe((msg) => {
      if (msg.type === 'notification' && WATCHED_EVENTS.has(msg.event) && msg.payload?.visit_id === visitId) load();
    });
  }, [enabled, visitId, subscribe, load]);

  useEffect(() => {
    if (!enabled || !visitId) return undefined;
    const onTracked = (e) => { if (e.detail?.visitId === visitId) load(); };
    window.addEventListener(REFERRAL_TRACKED_EVENT, onTracked);
    return () => window.removeEventListener(REFERRAL_TRACKED_EVENT, onTracked);
  }, [enabled, visitId, load]);

  if (!enabled || !visitId || referrals.length === 0) return null;

  const when = (iso) => formatDate(iso, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const overdue = referrals.some((r) => r.overdue);

  return (
    <Card className={cn(overdue && 'border-l-4 border-l-tier-high', className)}>
      <CardHeader
        title={t('followup.case.title', 'Hospital referral')}
        subtitle={t('followup.case.subtitle', 'Whether the patient reached the hospital they were sent to')}
        icon={Building2}
        action={
          <Button variant="ghost" size="icon" onClick={load} aria-label={t('action.refresh', 'Refresh')}>
            <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
          </Button>
        }
      />

      <ul className="divide-y divide-line">
        {referrals.map((r) => (
          <li key={r.id} className="p-4 sm:p-5">
            <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{r.hospital_name}</p>
                <p className="text-[11px] text-ink-muted">
                  {t('followup.case.code', 'Referral code')}: <span className="font-mono text-ink">{r.referral_code}</span>
                  {r.hospital_district && <> · {r.hospital_district}</>}
                </p>
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                {r.urgency === 'emergency'
                  ? <Badge tone="emergency">{t('followup.emergency', 'EMERGENCY')}</Badge>
                  : <Badge>{t('followup.case.routine', 'Routine')}</Badge>}
                {r.overdue && <Badge tone="high">{t('followup.overdue', 'Overdue')}</Badge>}
                <Badge tone={r.status === 'closed' || r.status === 'reached' ? 'low' : 'neutral'}>
                  {statusText(t, r.status)}
                </Badge>
              </div>
            </div>

            <div className="mt-2 space-y-0.5 text-[11px] text-ink-muted">
              {r.status === 'referred' && (
                <p className={r.overdue ? 'text-tier-emergency font-semibold' : undefined}>
                  {r.overdue
                    ? t('followup.case.wasDue', 'Should have been known by {time} — find out whether the patient reached', { time: when(r.follow_up_due_at) })
                    : t('followup.dueBy', 'Know by {time}', { time: when(r.follow_up_due_at) })}
                </p>
              )}
              {r.reached_at && (
                <p>
                  {r.reached_via === 'hospital'
                    ? t('followup.case.reachedByHospital', 'Reached {time}, confirmed by the hospital', { time: when(r.reached_at) })
                    : t('followup.case.reachedAt', 'Reached {time}', { time: when(r.reached_at) })}
                </p>
              )}
              {r.not_reached_reason && (
                <p>{t('followup.case.reason', 'Why not: {reason}', { reason: optionText(t, NOT_REACHED_REASONS, r.not_reached_reason) })}</p>
              )}
              {r.outcome && (
                <p className="text-ink font-semibold">
                  {t('followup.case.outcome', 'Outcome: {outcome}', { outcome: optionText(t, OUTCOME_OPTIONS, r.outcome) })}
                </p>
              )}
            </div>

            <ReferralFollowUpActions referral={r} onChanged={load} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
