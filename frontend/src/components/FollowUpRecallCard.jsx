import React, { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Loader2, AlertTriangle, RefreshCw, Phone } from 'lucide-react';
import api from '../services/api';
import { useI18n } from '../i18n/index.jsx';
import { useFeature, FEATURES } from '../context/FeatureContext';
import { Card, Button } from './ui';

/**
 * Follow-up recall (Roadmap v3, Phase 4).
 *
 * A doctor's "follow up in N days" becomes a patient on this list when it falls
 * due. Most of them close themselves: registering the patient's next visit
 * marks the follow-up kept. The rest are the phone calls — so the number is the
 * first thing on each row, and what happened on the last call is right under it.
 *
 * Absent entirely unless follow_up_tracking is switched on.
 */

const CONTACT_RESULTS = [
  ['will_come', 'recall.result.will_come', 'Will come'],
  ['no_answer', 'recall.result.no_answer', 'No answer'],
  ['unreachable', 'recall.result.unreachable', 'Number not reachable'],
  ['declined', 'recall.result.declined', 'Does not want to come'],
  ['moved_away', 'recall.result.moved_away', 'Has moved away']
];

const MISSED_REASONS = [
  ['no_contact', 'recall.missed.no_contact', 'Could not be contacted'],
  ['declined', 'recall.missed.declined', 'Declined'],
  ['moved_away', 'recall.missed.moved_away', 'Moved away'],
  ['cost', 'recall.missed.cost', 'Could not afford it'],
  ['transport', 'recall.missed.transport', 'No transport'],
  ['other', 'recall.missed.other', 'Other']
];

const CANCEL_REASONS = [
  ['referred_elsewhere', 'recall.cancel.referred_elsewhere', 'Under care elsewhere'],
  ['no_longer_needed', 'recall.cancel.no_longer_needed', 'No longer needed'],
  ['died', 'recall.cancel.died', 'Patient died'],
  ['entered_in_error', 'recall.cancel.entered_in_error', 'Entered in error']
];

const FORMS = {
  contact: { options: CONTACT_RESULTS, field: 'result', labelKey: 'recall.callResult', label: 'What happened on the call?' },
  missed: { options: MISSED_REASONS, field: 'reason', labelKey: 'recall.whyMissed', label: 'Why was it missed?' },
  cancel: { options: CANCEL_REASONS, field: 'reason', labelKey: 'recall.whyCancel', label: 'Why is it no longer needed?' }
};

const labelFor = (options, value) => options.find(([v]) => v === value);

export default function FollowUpRecallCard() {
  const enabled = useFeature(FEATURES.FOLLOW_UP_TRACKING);
  const { t, formatNumber, formatDate } = useI18n();

  const [scope, setScope] = useState('due');
  const [list, setList] = useState({ follow_ups: [], counts: { overdue: 0, due: 0, due_soon: 0 } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [form, setForm] = useState(null);          // { id, mode: 'contact' | 'missed' | 'cancel', value }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/follow-ups', { params: { scope } });
      setList(res.data);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || t('recall.loadFailed', 'Follow-ups could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [scope, t]);

  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return null;

  const act = async (followUp, action, body = {}) => {
    setBusyId(followUp.id);
    setError(null);
    try {
      await api.post(`/follow-ups/${followUp.id}/${action}`, body);
      setForm(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || t('recall.saveFailed', 'That could not be saved.'));
    } finally {
      setBusyId(null);
    }
  };

  const { follow_ups: followUps, counts } = list;
  const day = (value) => formatDate(value, { day: 'numeric', month: 'short' });

  const timingLabel = (f) => {
    if (f.timing === 'overdue') return [t('recall.overdue', 'Overdue'), 'text-tier-emergency'];
    if (f.timing === 'due') return [t('recall.due', 'Due now'), 'text-tier-high'];
    if (f.timing === 'due_soon') return [t('recall.dueSoon', 'Due tomorrow'), 'text-ink'];
    return [t('recall.upcoming', 'Due {date}', { date: day(f.due_at) }), 'text-ink-muted'];
  };

  return (
    <Card className={counts.overdue > 0 ? 'border-l-4 border-l-tier-high' : undefined}>
      <div className="px-4 sm:px-5 py-3 border-b border-line flex flex-wrap items-center gap-3">
        <CalendarClock className="w-4 h-4 text-gov-600" />
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-ink">{t('recall.title', 'Follow-ups due')}</h3>
          <p className="text-[11px] text-ink-muted">
            {counts.overdue > 0
              ? t('recall.overdueCount', '{count} overdue — call these patients first', { count: formatNumber(counts.overdue) })
              : t('recall.dueCount', '{count} due now or tomorrow. A new visit for the patient marks it kept.', {
                count: formatNumber(counts.due + counts.due_soon)
              })}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            aria-label={t('recall.scope', 'Which follow-ups to show')}
            className="bg-surface-raised border border-line-strong rounded-field px-2 py-1 text-[11px] text-ink"
          >
            <option value="due">{t('recall.scopeDue', 'Due and overdue')}</option>
            <option value="open">{t('recall.scopeOpen', 'All scheduled')}</option>
          </select>
          <button
            type="button"
            onClick={load}
            aria-label={t('action.refresh', 'Refresh')}
            className="p-1.5 rounded-field hover:bg-surface-sunken"
          >
            <RefreshCw className={`w-4 h-4 text-ink-muted ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="px-5 pt-3 text-xs text-tier-emergency flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {error}
        </p>
      )}

      {!loading && followUps.length === 0 ? (
        <p className="px-5 py-4 text-xs text-ink-muted">
          {scope === 'due'
            ? t('recall.noneDue', 'No follow-up is due.')
            : t('recall.noneOpen', 'No follow-up is scheduled.')}
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {followUps.map((f) => {
            const busy = busyId === f.id;
            const editing = form?.id === f.id ? form : null;
            const config = editing ? FORMS[editing.mode] : null;
            const [timing, timingClass] = timingLabel(f);
            const lastResult = labelFor(CONTACT_RESULTS, f.last_contact_result);

            return (
              <li key={f.id} className="px-4 sm:px-5 py-3">
                <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-ink">
                      {f.patient?.full_name || t('recall.unknownPatient', 'Patient')}
                      {f.patient?.age_years != null && (
                        <span className="font-normal text-ink-muted"> · {formatNumber(f.patient.age_years)}</span>
                      )}
                    </p>
                    <p className="text-[11px] text-ink-muted">
                      {f.patient?.phone && (
                        <a href={`tel:${f.patient.phone}`} className="inline-flex items-center gap-1 text-gov-700 font-semibold mr-2">
                          <Phone className="w-3 h-3" /> {f.patient.phone}
                        </a>
                      )}
                      {f.patient?.village_line1}
                    </p>
                    <p className="text-[10px] text-ink-subtle">
                      {t('recall.asked', '{doctor} asked to see them after {days} days', {
                        doctor: f.doctor_name || t('recall.theDoctor', 'The doctor'),
                        days: formatNumber(f.interval_days)
                      })}
                      {f.contact_attempts > 0 && lastResult && (
                        <> · {t('recall.lastCall', 'Called {count}× — last: {result}', {
                          count: formatNumber(f.contact_attempts),
                          result: t(lastResult[1], lastResult[2])
                        })}</>
                      )}
                    </p>
                  </div>
                  <div className="ml-auto text-right">
                    <p className={`text-[11px] font-semibold ${timingClass}`}>{timing}</p>
                    <p className="text-[10px] text-ink-subtle">{t('recall.dueOn', 'Due {date}', { date: day(f.due_at) })}</p>
                  </div>
                </div>

                {editing ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select
                      value={editing.value}
                      onChange={(e) => setForm({ ...editing, value: e.target.value })}
                      aria-label={t(config.labelKey, config.label)}
                      className="bg-surface-raised border border-line-strong rounded-field px-2 py-1.5 text-xs text-ink"
                    >
                      <option value="">{t(config.labelKey, config.label)}</option>
                      {config.options.map(([value, key, en]) => <option key={value} value={value}>{t(key, en)}</option>)}
                    </select>
                    <Button size="sm" disabled={!editing.value || busy} onClick={() => act(f, editing.mode, { [config.field]: editing.value })}>
                      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t('action.save', 'Save')}
                    </Button>
                    <button type="button" onClick={() => setForm(null)} className="text-[11px] text-ink-muted underline">
                      {t('action.cancel', 'Cancel')}
                    </button>
                  </div>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" disabled={busy} onClick={() => setForm({ id: f.id, mode: 'contact', value: '' })}>
                      <Phone className="w-3.5 h-3.5" /> {t('recall.logCall', 'Log a call')}
                    </Button>
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => act(f, 'completed')}>
                      {t('recall.seenElsewhere', 'Seen elsewhere')}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => setForm({ id: f.id, mode: 'missed', value: '' })}>
                      {t('recall.markMissed', 'Missed')}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => setForm({ id: f.id, mode: 'cancel', value: '' })}>
                      {t('recall.notNeeded', 'Not needed')}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
