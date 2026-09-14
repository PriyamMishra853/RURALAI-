import React, { useState } from 'react';
import {
  ArrowRightLeft, CheckCircle2, XCircle, Loader2, AlertCircle, Clock, UserCheck, Undo2, Send
} from 'lucide-react';
import api from '../services/api';
import { useI18n } from '../i18n/index.jsx';
import { REFERRAL_TYPES } from './ReferToDoctorModal';

/**
 * Doctor-to-doctor referrals on a case (Roadmap v3, Phase 1, F1).
 *
 * The same panel serves both ends, because both are looking at the same case:
 *
 *   The assigned doctor sees the case's referral history, can refer it, and can
 *   withdraw a request nobody has answered yet.
 *
 *   A doctor reading the case because it was referred to them sees the question
 *   they were asked, and answers it — accept or decline, then return an opinion
 *   or hand the case back. They never see the decision form: advising is theirs,
 *   deciding is not.
 *
 * Every action is enforced by the server's own rules. The buttons here only
 * reflect them; a stale tab that shows a button the server now refuses gets
 * the server's reason, not a silent failure.
 */

const STATUS = {
  requested: ['referral.status.requested', 'Awaiting an answer'],
  accepted: ['referral.status.accepted', 'Accepted, under review'],
  declined: ['referral.status.declined', 'Declined'],
  expired: ['referral.status.expired', 'Expired unanswered'],
  returned: ['referral.status.returned', 'Handed back'],
  completed: ['referral.status.completed', 'Opinion returned'],
  cancelled: ['referral.status.cancelled', 'Withdrawn'],
  transferred: ['referral.status.transferred', 'Care transferred']
};

const STATUS_TONE = {
  requested: 'text-tier-moderate bg-tier-moderateBg',
  accepted: 'text-gov-700 bg-gov-50',
  completed: 'text-tier-low bg-tier-lowBg',
  transferred: 'text-tier-low bg-tier-lowBg',
  declined: 'text-tier-emergency bg-tier-emergencyBg',
  returned: 'text-ink-muted bg-surface-sunken',
  expired: 'text-ink-muted bg-surface-sunken',
  cancelled: 'text-ink-muted bg-surface-sunken'
};

const first = (v) => (Array.isArray(v) ? v[0] : v) || null;

function StatusBadge({ referral, t }) {
  const key = referral.status === 'completed' && referral.referral_type === 'transfer_of_care'
    ? 'transferred'
    : referral.status;
  const [labelKey, label] = STATUS[key] || [null, key];
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${STATUS_TONE[key] || 'text-ink-muted bg-surface-sunken'}`}>
      {labelKey ? t(labelKey, label) : label}
    </span>
  );
}

function typeLabel(t, value) {
  const opt = REFERRAL_TYPES.find((o) => o.value === value);
  return opt ? t(opt.labelKey, opt.label) : value;
}

export default function CaseReferralPanel({ visit, currentUserId, canRefer, onRefer, onChanged }) {
  const { t, formatDate } = useI18n();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [reason, setReason] = useState('');
  const [opinion, setOpinion] = useState('');

  const referrals = visit?.referrals || [];
  const viaReferral = visit?.access === 'referral';

  // The referral a referred doctor is here to answer: the latest one to them.
  const mine = viaReferral
    ? [...referrals].reverse().find((r) => r.to_doctor_id === currentUserId) || null
    : null;
  const openOutgoing = !viaReferral
    ? referrals.find((r) => ['requested', 'accepted'].includes(r.status)) || null
    : null;

  const act = async (referral, action, body = {}) => {
    setBusy(action);
    setError(null);
    try {
      await api.post(`/doctor/referrals/${referral.id}/${action}`, body);
      setReason('');
      setOpinion('');
      onChanged?.();
    } catch (err) {
      setError(err.response?.data?.error || t('referral.actionFailed', 'That could not be saved. Reload the case and try again.'));
      // A refusal often means the referral moved on (expired, answered elsewhere);
      // reloading shows the state the server is actually in.
      onChanged?.();
    } finally {
      setBusy(null);
    }
  };

  const spinner = (name) => (busy === name ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null);

  return (
    <section className="bg-surface-raised rounded-card border border-line shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-line flex items-center gap-2">
        <ArrowRightLeft className="w-4 h-4 text-gov-600" />
        <h2 className="text-sm font-bold text-ink">
          {viaReferral ? t('referral.panelIncoming', 'Referred to you') : t('referral.panelTitle', 'Doctor referrals')}
        </h2>
        {!viaReferral && canRefer && !openOutgoing && (
          <button
            type="button"
            onClick={onRefer}
            className="ml-auto px-3 py-1.5 rounded-field border border-gov-600 text-gov-700 dark:text-gov-500 font-semibold text-[11px] hover:bg-gov-50 dark:hover:bg-gov-100 inline-flex items-center gap-1.5"
          >
            <Send className="w-3.5 h-3.5" /> {t('referral.title', 'Refer to a doctor')}
          </button>
        )}
      </div>

      <div className="p-5 space-y-3">
        {/* ---- The referred doctor answering ---- */}
        {viaReferral && mine && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-ink">{typeLabel(t, mine.referral_type)}</span>
              {mine.urgency === 'urgent' && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded text-tier-emergency bg-tier-emergencyBg">
                  {t('referral.urgentBadge', 'URGENT')}
                </span>
              )}
              <StatusBadge referral={mine} t={t} />
              <span className="text-[11px] text-ink-muted">
                {t('referral.fromDoctor', 'from {doctor}', { doctor: first(mine.from_doctor)?.full_name || '—' })}
              </span>
            </div>

            <blockquote className="p-3 rounded-field bg-surface-sunken border-l-4 border-gov-600 text-xs text-ink whitespace-pre-wrap">
              {mine.clinical_question}
            </blockquote>

            {mine.status === 'requested' && (
              <>
                <p className="text-[11px] text-ink-muted flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  {t('referral.answerBy', 'Answer by {time}', {
                    time: formatDate(mine.expires_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                  })}
                </p>
                {mine.referral_type === 'transfer_of_care' && (
                  <p className="p-2.5 rounded-field bg-tier-moderateBg border border-tier-moderate/30 text-[11px] text-ink">
                    {t('referral.transferAcceptNote', 'Accepting moves this case to your queue. From that moment you are the doctor responsible for it.')}
                  </p>
                )}
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t('referral.declineReasonPlaceholder', 'Reason, if declining')}
                  className="w-full bg-surface-raised border border-line-strong rounded-field px-3 py-2 text-xs text-ink focus:border-gov-600 outline-none"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => act(mine, 'accept')}
                    className="px-4 py-2 rounded-field bg-tier-low hover:opacity-90 disabled:opacity-40 text-white font-semibold text-xs inline-flex items-center gap-1.5"
                  >
                    {spinner('accept') || <UserCheck className="w-3.5 h-3.5" />} {t('referral.accept', 'Accept')}
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(busy) || reason.trim().length < 5}
                    onClick={() => act(mine, 'decline', { reason: reason.trim() })}
                    className="px-4 py-2 rounded-field border border-tier-emergency text-tier-emergency disabled:opacity-40 font-semibold text-xs inline-flex items-center gap-1.5"
                  >
                    {spinner('decline') || <XCircle className="w-3.5 h-3.5" />} {t('referral.decline', 'Decline')}
                  </button>
                </div>
              </>
            )}

            {mine.status === 'accepted' && mine.referral_type !== 'transfer_of_care' && (
              <>
                <textarea
                  rows={4}
                  value={opinion}
                  onChange={(e) => setOpinion(e.target.value)}
                  placeholder={t('referral.opinionPlaceholder', 'Your opinion for the referring doctor')}
                  className="w-full bg-surface-raised border border-line-strong rounded-field px-3 py-2 text-xs text-ink focus:border-gov-600 outline-none"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={Boolean(busy) || opinion.trim().length < 10}
                    onClick={() => act(mine, 'complete', { response_notes: opinion.trim() })}
                    className="px-4 py-2 rounded-field bg-gov-600 hover:bg-gov-700 disabled:opacity-40 text-white font-semibold text-xs inline-flex items-center gap-1.5"
                  >
                    {spinner('complete') || <CheckCircle2 className="w-3.5 h-3.5" />} {t('referral.returnOpinion', 'Return opinion')}
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(busy) || opinion.trim().length < 5}
                    onClick={() => act(mine, 'return', { reason: opinion.trim() })}
                    className="px-4 py-2 rounded-field border border-line-strong text-ink-muted disabled:opacity-40 font-semibold text-xs inline-flex items-center gap-1.5"
                  >
                    {spinner('return') || <Undo2 className="w-3.5 h-3.5" />} {t('referral.handBack', 'Hand back without an opinion')}
                  </button>
                </div>
              </>
            )}

            {['completed', 'returned', 'declined', 'expired', 'cancelled'].includes(mine.status) && (
              <p className="text-[11px] text-ink-muted">
                {t('referral.closedForYou', 'This referral is closed. The case is shown read-only.')}
              </p>
            )}
          </div>
        )}

        {/* ---- The assigned doctor's referral history ---- */}
        {!viaReferral && (
          referrals.length === 0 ? (
            <p className="text-[11px] text-ink-muted">
              {canRefer
                ? t('referral.noneYet', 'No referrals on this case. Refer it if you need another doctor\'s opinion, or to transfer care.')
                : t('referral.none', 'No referrals on this case.')}
            </p>
          ) : (
            <ul className="space-y-2">
              {referrals.map((r) => (
                <li key={r.id} className="p-3 rounded-field border border-line space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-ink">{typeLabel(t, r.referral_type)}</span>
                    <StatusBadge referral={r} t={t} />
                    <span className="text-[11px] text-ink-muted">
                      {t('referral.toDoctor', 'to {doctor}', { doctor: first(r.to_doctor)?.full_name || '—' })}
                    </span>
                  </div>
                  <p className="text-[11px] text-ink-muted line-clamp-2">{r.clinical_question}</p>
                  {r.response_notes && (
                    <p className="p-2 rounded-field bg-tier-lowBg text-xs text-ink whitespace-pre-wrap">
                      <strong>{t('referral.opinion', 'Opinion:')}</strong> {r.response_notes}
                    </p>
                  )}
                  {r.decline_reason && (
                    <p className="text-[11px] text-ink-muted">
                      <strong>{t('referral.reason', 'Reason:')}</strong> {r.decline_reason}
                    </p>
                  )}
                  {r.status === 'requested' && (
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => act(r, 'cancel')}
                      className="text-[11px] font-semibold text-tier-emergency hover:underline inline-flex items-center gap-1"
                    >
                      {spinner('cancel') || <XCircle className="w-3 h-3" />} {t('referral.withdraw', 'Withdraw request')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )
        )}

        {error && (
          <div role="alert" className="p-2.5 rounded-field bg-tier-emergencyBg border border-tier-emergency/30 text-[11px] text-tier-emergency flex items-start gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {error}
          </div>
        )}
      </div>
    </section>
  );
}
