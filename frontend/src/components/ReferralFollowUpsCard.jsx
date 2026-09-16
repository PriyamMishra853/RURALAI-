import React, { useCallback, useEffect, useState } from 'react';
import { Building2, Loader2, AlertTriangle, RefreshCw, Link2, CheckCircle2 } from 'lucide-react';
import api from '../services/api';
import { useI18n } from '../i18n/index.jsx';
import { useFeature, FEATURES } from '../context/FeatureContext';
import { Card, Button } from './ui';

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

const REASONS = [
  ['cost', 'followup.reason.cost', 'Could not afford it'],
  ['transport', 'followup.reason.transport', 'No transport'],
  ['distance', 'followup.reason.distance', 'Too far'],
  ['family_refused', 'followup.reason.family_refused', 'Family refused'],
  ['improved', 'followup.reason.improved', 'Felt better'],
  ['died_before_arrival', 'followup.reason.died_before_arrival', 'Died before reaching'],
  ['other', 'followup.reason.other', 'Other']
];

export const OUTCOME_OPTIONS = [
  ['admitted', 'followup.outcome.admitted', 'Admitted'],
  ['treated_discharged', 'followup.outcome.treated_discharged', 'Treated and sent home'],
  ['referred_onward', 'followup.outcome.referred_onward', 'Sent on to another hospital'],
  ['left_against_advice', 'followup.outcome.left_against_advice', 'Left against advice'],
  ['died', 'followup.outcome.died', 'Died']
];

const STATUS_LABEL = {
  referred: ['followup.status.referred', 'Not heard back'],
  reached: ['followup.status.reached', 'Reached hospital'],
  not_reached: ['followup.status.not_reached', 'Did not reach'],
  lost_to_follow_up: ['followup.status.lost', 'Lost to follow-up'],
  closed: ['followup.status.closed', 'Outcome recorded']
};

export default function ReferralFollowUpsCard() {
  const enabled = useFeature(FEATURES.REFERRAL_TRACKING);
  const { t, formatNumber, formatDate } = useI18n();

  const [list, setList] = useState({ referrals: [], counts: { overdue: 0, open: 0 } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [form, setForm] = useState(null);          // { id, mode: 'not_reached' | 'outcome', value }
  const [links, setLinks] = useState({});

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

  const act = async (referral, action, body = {}) => {
    setBusyId(referral.id);
    setError(null);
    try {
      await api.post(`/referral-tracking/${referral.id}/${action}`, body);
      setForm(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || t('followup.saveFailed', 'That could not be saved.'));
    } finally {
      setBusyId(null);
    }
  };

  const issueLink = async (referral) => {
    setBusyId(referral.id);
    setError(null);
    try {
      const res = await api.post(`/referral-tracking/${referral.id}/ack-link`);
      const url = `${window.location.origin}${res.data.ack_path}`;
      setLinks((prev) => ({ ...prev, [referral.id]: url }));
      // Copied where the browser allows it; shown on screen either way, so a
      // refused clipboard never loses the link.
      try { await navigator.clipboard?.writeText(url); } catch { /* shown below */ }
    } catch (err) {
      setError(err.response?.data?.error || t('followup.linkFailed', 'A hospital link could not be issued.'));
    } finally {
      setBusyId(null);
    }
  };

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
          {referrals.map((r) => {
            const [labelKey, label] = STATUS_LABEL[r.status] || [r.status, r.status];
            const busy = busyId === r.id;
            const editing = form?.id === r.id ? form : null;
            const canReach = ['referred', 'not_reached', 'lost_to_follow_up'].includes(r.status);
            const options = editing?.mode === 'not_reached' ? REASONS : OUTCOME_OPTIONS;

            return (
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
                      {r.overdue ? t('followup.overdue', 'Overdue') : t(labelKey, label)}
                    </p>
                    {r.status === 'referred' && (
                      <p className="text-[10px] text-ink-subtle">{t('followup.dueBy', 'Know by {time}', { time: due(r) })}</p>
                    )}
                  </div>
                </div>

                {editing ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select
                      value={editing.value}
                      onChange={(e) => setForm({ ...editing, value: e.target.value })}
                      aria-label={editing.mode === 'not_reached'
                        ? t('followup.whyNot', 'Why did the patient not reach?')
                        : t('followup.whatHappened', 'What happened at the hospital?')}
                      className="bg-surface-raised border border-line-strong rounded-field px-2 py-1.5 text-xs text-ink"
                    >
                      <option value="">
                        {editing.mode === 'not_reached' ? t('followup.chooseReason', 'Choose a reason…') : t('followup.chooseOutcome', 'Choose the outcome…')}
                      </option>
                      {options.map(([value, key, en]) => <option key={value} value={value}>{t(key, en)}</option>)}
                    </select>
                    <Button
                      size="sm"
                      disabled={!editing.value || busy}
                      onClick={() => act(r, editing.mode, editing.mode === 'not_reached' ? { reason: editing.value } : { outcome: editing.value })}
                    >
                      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t('action.save', 'Save')}
                    </Button>
                    <button type="button" onClick={() => setForm(null)} className="text-[11px] text-ink-muted underline">
                      {t('action.cancel', 'Cancel')}
                    </button>
                  </div>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {canReach && (
                      <Button size="sm" disabled={busy} onClick={() => act(r, 'reached')}>
                        <CheckCircle2 className="w-3.5 h-3.5" /> {t('followup.reached', 'Reached hospital')}
                      </Button>
                    )}
                    {r.status === 'referred' && (
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => setForm({ id: r.id, mode: 'not_reached', value: '' })}>
                        {t('followup.didNotReach', 'Did not reach')}
                      </Button>
                    )}
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => setForm({ id: r.id, mode: 'outcome', value: '' })}>
                      {t('followup.recordOutcome', 'Record outcome')}
                    </Button>
                    {['referred', 'not_reached'].includes(r.status) && (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(r, 'lost')}>
                        {t('followup.lost', 'Could not be traced')}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => issueLink(r)}>
                      <Link2 className="w-3.5 h-3.5" /> {t('followup.hospitalLink', 'Link for the hospital')}
                    </Button>
                  </div>
                )}

                {links[r.id] && (
                  <p className="mt-2 text-[10px] text-ink-muted break-all">
                    {t('followup.linkCopied', 'Send this to the hospital reception (copied). It replaces any earlier link:')}{' '}
                    <span className="text-ink font-mono">{links[r.id]}</span>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
