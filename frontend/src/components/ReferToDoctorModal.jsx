import React, { useEffect, useMemo, useState } from 'react';
import { X, Loader2, Send, AlertCircle, ArrowRightLeft } from 'lucide-react';
import api from '../services/api';
import { useI18n } from '../i18n/index.jsx';

/**
 * Refer this case to another doctor (Roadmap v3, Phase 1, F1).
 *
 * The three types are presented with what each does to responsibility, not
 * just their names, because that is the part a doctor must not get wrong: a
 * second opinion or a consult leaves the case — and accountability for it —
 * with the referring doctor; a transfer hands both over at acceptance.
 *
 * Doctors are grouped by speciality. A physician looking for help is looking
 * for "a paediatrician", not scrolling for a name.
 *
 * Everything this form checks, the server checks again. The form exists to
 * catch the obvious mistake before a round trip, not to be the control.
 */

// `value` is the enum the API accepts and must not change.
export const REFERRAL_TYPES = [
  {
    value: 'second_opinion',
    labelKey: 'referral.type.secondOpinion', label: 'Second opinion',
    hintKey: 'referral.type.secondOpinion.hint', hint: 'You keep the case and decide it. They review it and advise.'
  },
  {
    value: 'specialist_consult',
    labelKey: 'referral.type.consult', label: 'Specialist consult',
    hintKey: 'referral.type.consult.hint', hint: 'You keep the case. A specialist reviews it and returns an opinion.'
  },
  {
    value: 'transfer_of_care',
    labelKey: 'referral.type.transfer', label: 'Transfer of care',
    hintKey: 'referral.type.transfer.hint', hint: 'When they accept, the case and responsibility for it move to them.'
  }
];

export default function ReferToDoctorModal({ visitId, currentDoctorId, patientName, onClose, onReferred }) {
  const { t } = useI18n();

  const [doctors, setDoctors] = useState([]);
  const [loadingDoctors, setLoadingDoctors] = useState(true);
  const [toDoctorId, setToDoctorId] = useState('');
  const [type, setType] = useState('second_opinion');
  const [urgency, setUrgency] = useState('routine');
  const [question, setQuestion] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.get('/doctor/directory')
      .then((res) => {
        if (!cancelled) setDoctors((res.data?.doctors ?? []).filter((d) => d.id !== currentDoctorId));
      })
      .catch(() => {
        if (!cancelled) setError(t('referral.directoryFailed', 'Could not load the doctors in your district.'));
      })
      .finally(() => { if (!cancelled) setLoadingDoctors(false); });
    return () => { cancelled = true; };
  }, [currentDoctorId, t]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !submitting) onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  const bySpeciality = useMemo(() => {
    const groups = new Map();
    for (const d of doctors) {
      const key = d.specialization || 'General Medicine';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(d);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [doctors]);

  const target = doctors.find((d) => d.id === toDoctorId);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!toDoctorId) {
      setError(t('referral.needDoctor', 'Choose the doctor to refer this case to.'));
      return;
    }
    if (question.trim().length < 10) {
      setError(t('referral.needQuestion', 'State the clinical question you want answered, in at least a sentence.'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post(`/doctor/cases/${visitId}/referrals`, {
        to_doctor_id: toDoctorId,
        referral_type: type,
        urgency,
        clinical_question: question.trim()
      });
      onReferred?.(res.data?.referral);
    } catch (err) {
      setError(err.response?.data?.error || t('referral.sendFailed', 'The referral could not be sent.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] bg-ink/60 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="refer-title"
    >
      <form
        onSubmit={submit}
        className="w-full max-w-lg bg-surface-raised rounded-card border border-line shadow-2xl overflow-hidden max-h-[92vh] flex flex-col"
      >
        <div className="px-5 py-4 border-b border-line flex items-start gap-3">
          <ArrowRightLeft className="w-5 h-5 text-gov-600 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <h2 id="refer-title" className="text-base font-bold text-ink">
              {t('referral.title', 'Refer to a doctor')}
            </h2>
            {patientName && <p className="text-[11px] text-ink-muted truncate">{patientName}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label={t('common.close', 'Close')}
            className="p-1.5 rounded-field text-ink-muted hover:bg-surface-sunken"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <fieldset>
            <legend className="block text-xs font-semibold text-ink-muted mb-1.5">
              {t('referral.typeLabel', 'What you are asking for')}
            </legend>
            <div className="space-y-1.5">
              {REFERRAL_TYPES.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-start gap-2.5 p-2.5 rounded-field border cursor-pointer transition-colors ${
                    type === opt.value ? 'border-gov-600 bg-gov-50 dark:bg-gov-100' : 'border-line hover:border-gov-600/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="referral_type"
                    value={opt.value}
                    checked={type === opt.value}
                    onChange={(e) => setType(e.target.value)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-ink">{t(opt.labelKey, opt.label)}</span>
                    <span className="block text-[11px] text-ink-muted">{t(opt.hintKey, opt.hint)}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor="refer-doctor" className="block text-xs font-semibold text-ink-muted mb-1">
              {t('referral.doctorLabel', 'Doctor')} <span className="text-tier-emergency">*</span>
            </label>
            {loadingDoctors ? (
              <p className="text-[11px] text-ink-muted flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('referral.loadingDoctors', 'Loading doctors in your district…')}
              </p>
            ) : doctors.length === 0 ? (
              <p className="text-[11px] text-ink-muted">
                {t('referral.noDoctors', 'There is no other active doctor in your district to refer to.')}
              </p>
            ) : (
              <select
                id="refer-doctor"
                value={toDoctorId}
                onChange={(e) => setToDoctorId(e.target.value)}
                className="w-full bg-surface-raised border border-line-strong rounded-field px-3 py-2 text-xs text-ink focus:border-gov-600 outline-none"
              >
                <option value="">{t('referral.chooseDoctor', 'Choose a doctor')}</option>
                {bySpeciality.map(([speciality, list]) => (
                  <optgroup key={speciality} label={speciality}>
                    {list.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}{d.qualification ? ` — ${d.qualification}` : ''}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}
          </div>

          <fieldset>
            <legend className="block text-xs font-semibold text-ink-muted mb-1.5">
              {t('referral.urgencyLabel', 'Urgency')}
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {[
                ['routine', 'referral.urgency.routine', 'Routine — answer within a day'],
                ['urgent', 'referral.urgency.urgent', 'Urgent — answer within 30 minutes']
              ].map(([value, key, label]) => (
                <label
                  key={value}
                  className={`p-2.5 rounded-field border text-[11px] font-semibold cursor-pointer ${
                    urgency === value
                      ? (value === 'urgent'
                        ? 'border-tier-emergency bg-tier-emergencyBg text-tier-emergency'
                        : 'border-gov-600 bg-gov-50 dark:bg-gov-100 text-ink')
                      : 'border-line text-ink-muted'
                  }`}
                >
                  <input
                    type="radio"
                    name="urgency"
                    value={value}
                    checked={urgency === value}
                    onChange={(e) => setUrgency(e.target.value)}
                    className="sr-only"
                  />
                  {t(key, label)}
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor="refer-question" className="block text-xs font-semibold text-ink-muted mb-1">
              {t('referral.questionLabel', 'Clinical question')} <span className="text-tier-emergency">*</span>
            </label>
            <textarea
              id="refer-question"
              rows={4}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={2000}
              placeholder={t('referral.questionPlaceholder', 'What do you want the other doctor to answer? e.g. Is this rash consistent with a drug reaction?')}
              className="w-full bg-surface-raised border border-line-strong rounded-field px-3 py-2 text-xs text-ink focus:border-gov-600 outline-none"
            />
          </div>

          {type === 'transfer_of_care' && target && (
            <div className="p-2.5 rounded-field bg-tier-moderateBg border border-tier-moderate/30 text-[11px] text-ink">
              {t('referral.transferWarning', 'When {doctor} accepts, this case leaves your queue and they become responsible for it.', { doctor: target.name })}
            </div>
          )}

          {error && (
            <div role="alert" className="p-2.5 rounded-field bg-tier-emergencyBg border border-tier-emergency/30 text-[11px] text-tier-emergency flex items-start gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {error}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-line flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded-field border border-line-strong text-ink-muted font-semibold text-xs hover:bg-surface-sunken"
          >
            {t('common.cancel', 'Cancel')}
          </button>
          <button
            type="submit"
            disabled={submitting || loadingDoctors || doctors.length === 0}
            className="px-4 py-2 rounded-field bg-gov-600 hover:bg-gov-700 disabled:opacity-40 text-white font-semibold text-xs inline-flex items-center gap-1.5"
          >
            {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {t('referral.send', 'Send referral')}
          </button>
        </div>
      </form>
    </div>
  );
}
