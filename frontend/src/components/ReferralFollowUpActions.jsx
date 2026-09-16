import React, { useState } from 'react';
import { Loader2, AlertTriangle, Link2, CheckCircle2 } from 'lucide-react';
import api from '../services/api';
import { useI18n } from '../i18n/index.jsx';
import { Button } from './ui';

/**
 * What staff can record about one hospital referral (Roadmap v3, Phase 1).
 *
 * Shared by the dashboard worklist and the case view, so a referral is worked
 * the same way from either place: the same choices, the same required reason,
 * the same rules about what each status still allows. The server decides in
 * the end — see planUpdate() — and these buttons only avoid offering what it
 * would refuse.
 */

export const NOT_REACHED_REASONS = [
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

export const STATUS_LABEL = {
  referred: ['followup.status.referred', 'Not heard back'],
  reached: ['followup.status.reached', 'Reached hospital'],
  not_reached: ['followup.status.not_reached', 'Did not reach'],
  lost_to_follow_up: ['followup.status.lost', 'Lost to follow-up'],
  closed: ['followup.status.closed', 'Outcome recorded']
};

/** A stored status, reason or outcome in words; the raw value if it is one we do not know. */
export const statusText = (t, status) => {
  const [key, en] = STATUS_LABEL[status] || [status, status];
  return t(key, en);
};

export const optionText = (t, options, value) => {
  const entry = options.find(([v]) => v === value);
  return entry ? t(entry[1], entry[2]) : value;
};

export default function ReferralFollowUpActions({ referral: r, onChanged }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(null);          // { mode: 'not_reached' | 'outcome', value }
  const [link, setLink] = useState(null);

  const act = async (action, body = {}) => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/referral-tracking/${r.id}/${action}`, body);
      setForm(null);
      await onChanged?.();
    } catch (err) {
      setError(err.response?.data?.error || t('followup.saveFailed', 'That could not be saved.'));
    } finally {
      setBusy(false);
    }
  };

  const issueLink = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post(`/referral-tracking/${r.id}/ack-link`);
      const url = `${window.location.origin}${res.data.ack_path}`;
      setLink(url);
      // Copied where the browser allows it; shown on screen either way, so a
      // refused clipboard never loses the link.
      try { await navigator.clipboard?.writeText(url); } catch { /* shown below */ }
    } catch (err) {
      setError(err.response?.data?.error || t('followup.linkFailed', 'A hospital link could not be issued.'));
    } finally {
      setBusy(false);
    }
  };

  const canReach = ['referred', 'not_reached', 'lost_to_follow_up'].includes(r.status);
  const options = form?.mode === 'not_reached' ? NOT_REACHED_REASONS : OUTCOME_OPTIONS;

  return (
    <>
      {form ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            value={form.value}
            onChange={(e) => setForm({ ...form, value: e.target.value })}
            aria-label={form.mode === 'not_reached'
              ? t('followup.whyNot', 'Why did the patient not reach?')
              : t('followup.whatHappened', 'What happened at the hospital?')}
            className="bg-surface-raised border border-line-strong rounded-field px-2 py-1.5 text-xs text-ink"
          >
            <option value="">
              {form.mode === 'not_reached' ? t('followup.chooseReason', 'Choose a reason…') : t('followup.chooseOutcome', 'Choose the outcome…')}
            </option>
            {options.map(([value, key, en]) => <option key={value} value={value}>{t(key, en)}</option>)}
          </select>
          <Button
            size="sm"
            disabled={!form.value || busy}
            onClick={() => act(form.mode, form.mode === 'not_reached' ? { reason: form.value } : { outcome: form.value })}
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
            <Button size="sm" disabled={busy} onClick={() => act('reached')}>
              <CheckCircle2 className="w-3.5 h-3.5" /> {t('followup.reached', 'Reached hospital')}
            </Button>
          )}
          {r.status === 'referred' && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setForm({ mode: 'not_reached', value: '' })}>
              {t('followup.didNotReach', 'Did not reach')}
            </Button>
          )}
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setForm({ mode: 'outcome', value: '' })}>
            {t('followup.recordOutcome', 'Record outcome')}
          </Button>
          {['referred', 'not_reached'].includes(r.status) && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => act('lost')}>
              {t('followup.lost', 'Could not be traced')}
            </Button>
          )}
          {r.status !== 'closed' && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={issueLink}>
              <Link2 className="w-3.5 h-3.5" /> {t('followup.hospitalLink', 'Link for the hospital')}
            </Button>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-[11px] text-tier-emergency flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {error}
        </p>
      )}

      {link && (
        <p className="mt-2 text-[10px] text-ink-muted break-all">
          {t('followup.linkCopied', 'Send this to the hospital reception (copied). It replaces any earlier link:')}{' '}
          <span className="text-ink font-mono">{link}</span>
        </p>
      )}
    </>
  );
}
