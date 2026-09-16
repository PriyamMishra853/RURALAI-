import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Building2, CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';
import api from '../services/api';
import { useI18n } from '../i18n/index.jsx';
import { OUTCOME_OPTIONS } from '../components/ReferralFollowUpActions';

/**
 * The hospital acknowledgement page (Roadmap v3, Phase 1).
 *
 * Opened from the link on a referral slip by a reception desk with no account
 * on this system, often on a phone. So: one screen, two large actions, nothing
 * to sign in to, and nothing shown beyond what matches the patient standing in
 * front of them — a first name, an age, where they were referred from.
 */
export default function HospitalReferralPage() {
  const { token } = useParams();
  const { t, formatNumber } = useI18n();

  const [view, setView] = useState(null);
  const [state, setState] = useState('loading');      // loading · ready · invalid · error
  const [outcome, setOutcome] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const path = `/public/referrals/${encodeURIComponent(token || '')}`;

  useEffect(() => {
    let cancelled = false;
    api.get(path)
      .then((res) => { if (!cancelled) { setView(res.data.referral); setState('ready'); } })
      .catch((err) => { if (!cancelled) setState(err.response?.status === 404 ? 'invalid' : 'error'); });
    return () => { cancelled = true; };
  }, [path]);

  const act = async (action, body = {}) => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await api.post(`${path}/${action}`, body);
      setView(res.data.referral);
      setMessage({
        ok: true,
        text: action === 'reached'
          ? t('hospital.arrivedThanks', 'Arrival recorded. The referring clinic has been told.')
          : t('hospital.outcomeThanks', 'Outcome recorded. Thank you.')
      });
    } catch (err) {
      setMessage({ ok: false, text: err.response?.data?.error || t('hospital.failed', 'That could not be saved. Try again.') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-sunken flex items-start sm:items-center justify-center p-4">
      <div className="w-full max-w-md bg-surface-raised rounded-card shadow-raised border border-line overflow-hidden">
        <div className="px-5 py-4 border-b border-line flex items-center gap-3">
          <Building2 className="w-5 h-5 text-gov-600" />
          <div>
            <h1 className="text-sm font-bold text-ink">{t('hospital.title', 'Referred patient')}</h1>
            <p className="text-[11px] text-ink-muted">{t('hospital.subtitle', 'For the receiving hospital. No sign-in needed.')}</p>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {state === 'loading' && (
            <p className="text-xs text-ink-muted flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> {t('hospital.loading', 'Opening the referral…')}
            </p>
          )}

          {(state === 'invalid' || state === 'error') && (
            <p role="alert" className="text-sm text-tier-emergency flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              {state === 'invalid'
                ? t('hospital.invalid', 'This link is not valid, or it has expired. Ask the referring clinic for a new one.')
                : t('hospital.error', 'The referral could not be opened. Check the connection and try again.')}
            </p>
          )}

          {state === 'ready' && view && (
            <>
              <dl className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <dt className="text-ink-muted">{t('hospital.code', 'Referral code')}</dt>
                  <dd className="font-mono font-semibold text-ink">{view.referral_code}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">{t('hospital.patient', 'Patient')}</dt>
                  <dd className="font-semibold text-ink">
                    {view.patient?.first_name || '—'}
                    {view.patient?.age_years != null && `, ${formatNumber(view.patient.age_years)}`}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-muted">{t('hospital.from', 'Referred from')}</dt>
                  <dd className="text-ink">{view.referring_district || '—'}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">{t('hospital.to', 'Referred to')}</dt>
                  <dd className="text-ink">{view.hospital_name}</dd>
                </div>
              </dl>

              {view.urgency === 'emergency' && (
                <p className="text-[11px] font-semibold text-tier-emergency">{t('hospital.emergency', 'Sent as an emergency.')}</p>
              )}

              {view.can_mark_arrived ? (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => act('reached')}
                  className="w-full py-3 rounded-field bg-gov-600 text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  {t('hospital.markArrived', 'The patient has arrived')}
                </button>
              ) : view.status !== 'closed' && (
                <p className="text-xs text-ink flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-gov-600" /> {t('hospital.arrived', 'Arrival is recorded.')}
                </p>
              )}

              {view.can_record_outcome ? (
                <div className="space-y-2">
                  <label htmlFor="outcome" className="block text-[11px] font-semibold text-ink-muted">
                    {t('hospital.outcomeLabel', 'When you know what happened')}
                  </label>
                  <div className="flex gap-2">
                    <select
                      id="outcome"
                      value={outcome}
                      onChange={(e) => setOutcome(e.target.value)}
                      className="flex-1 bg-surface-raised border border-line-strong rounded-field px-2 py-2 text-xs text-ink"
                    >
                      <option value="">{t('followup.chooseOutcome', 'Choose the outcome…')}</option>
                      {OUTCOME_OPTIONS.map(([value, key, en]) => <option key={value} value={value}>{t(key, en)}</option>)}
                    </select>
                    <button
                      type="button"
                      disabled={!outcome || saving}
                      onClick={() => act('outcome', { outcome })}
                      className="px-4 rounded-field border border-gov-600 text-gov-700 text-xs font-semibold disabled:opacity-50"
                    >
                      {t('action.save', 'Save')}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-ink flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-gov-600" /> {t('hospital.closed', 'The outcome is recorded. Nothing more is needed.')}
                </p>
              )}

              {message && (
                <p role="status" className={`text-xs ${message.ok ? 'text-gov-700' : 'text-tier-emergency'}`}>{message.text}</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
