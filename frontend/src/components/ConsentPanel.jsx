import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
import api from '../services/api';
import { useI18n } from '../i18n/index.jsx';
import { useFeature, FEATURES } from '../context/FeatureContext';
import { Card, Button } from './ui';

/**
 * What this patient has agreed to (Roadmap v3, Phase 3).
 *
 * Three separate questions, asked and recorded separately, because they are
 * separate: being treated here, the record leaving the clinic, and the record
 * being used to improve the models. One tick covering all three would not be
 * consent, it would be a formality.
 *
 * The wording the patient must hear comes from the server with the state, so
 * the sentence read out and the version stored can never drift apart.
 */

const PURPOSES = [
  ['treatment', 'consent.treatment', 'Treatment here'],
  ['share_with_facility', 'consent.share', 'Sending the record on'],
  ['training', 'consent.training', 'Improving the system']
];

const METHODS = [
  ['verbal', 'consent.method.verbal', 'Said yes'],
  ['written', 'consent.method.written', 'Signed'],
  ['thumb_impression', 'consent.method.thumb', 'Thumb impression']
];

const REASON = {
  never_asked: ['consent.neverAsked', 'Not asked'],
  expired: ['consent.expired', 'Expired — ask again'],
  withdrawn: ['consent.withdrawn', 'Withdrawn']
};

export default function ConsentPanel({ aadhaarNumber }) {
  const enabled = useFeature(FEATURES.PATIENT_CONSENT);
  const { t, lang, formatDate } = useI18n();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [asking, setAsking] = useState(null);       // { purpose, method }

  const load = useCallback(async () => {
    if (!aadhaarNumber) return;
    setLoading(true);
    try {
      const res = await api.post('/patients/consents', { aadhaar_number: aadhaarNumber });
      setData(res.data);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || t('consent.loadFailed', 'Consent could not be read.'));
    } finally {
      setLoading(false);
    }
  }, [aadhaarNumber, t]);

  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled || !aadhaarNumber) return null;

  const act = async (path, body, purpose) => {
    setBusy(purpose);
    setError(null);
    try {
      const res = await api.post(path, { aadhaar_number: aadhaarNumber, ...body });
      setData((prev) => ({ ...prev, state: res.data.state }));
      setAsking(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || t('consent.saveFailed', 'That could not be saved.'));
    } finally {
      setBusy(null);
    }
  };

  const state = data?.state || {};

  return (
    <Card>
      <div className="px-4 sm:px-5 py-3 border-b border-line flex items-center gap-3">
        <ShieldCheck className="w-4 h-4 text-gov-600" />
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-ink">{t('consent.title', 'What this patient has agreed to')}</h3>
          <p className="text-[11px] text-ink-muted">
            {t('consent.subtitle', 'Read the sentence out in the patient’s language, then record their answer. Each is asked separately.')}
          </p>
        </div>
        <button type="button" onClick={load} aria-label={t('action.refresh', 'Refresh')} className="ml-auto p-1.5 rounded-field hover:bg-surface-sunken">
          <RefreshCw className={`w-4 h-4 text-ink-muted ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <p role="alert" className="px-5 pt-3 text-xs text-tier-emergency flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {error}
        </p>
      )}

      <ul className="divide-y divide-line">
        {PURPOSES.map(([purpose, labelKey, label]) => {
          const here = state[purpose] || {};
          const [reasonKey, reasonText] = REASON[here.reason] || REASON.never_asked;
          const working = busy === purpose;
          const open = asking?.purpose === purpose;

          return (
            <li key={purpose} className="px-4 sm:px-5 py-3">
              <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-ink">{t(labelKey, label)}</p>
                  {data?.wording?.[purpose] && (
                    <p className="text-[11px] text-ink-muted mt-0.5">“{data.wording[purpose]}”</p>
                  )}
                </div>
                <div className="ml-auto text-right">
                  <p className={`text-[11px] font-semibold ${here.granted ? 'text-tier-low' : 'text-ink-muted'}`}>
                    {here.granted ? t('consent.granted', 'Agreed') : t(reasonKey, reasonText)}
                  </p>
                  {here.granted && here.expires_at && (
                    <p className="text-[10px] text-ink-subtle">
                      {t('consent.until', 'until {date}', { date: formatDate(here.expires_at, { day: 'numeric', month: 'short', year: 'numeric' }) })}
                    </p>
                  )}
                </div>
              </div>

              {open ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <select
                    value={asking.method}
                    onChange={(e) => setAsking({ ...asking, method: e.target.value })}
                    aria-label={t('consent.howGiven', 'How did the patient answer?')}
                    className="bg-surface-raised border border-line-strong rounded-field px-2 py-1.5 text-xs text-ink"
                  >
                    {METHODS.map(([value, key, en]) => <option key={value} value={value}>{t(key, en)}</option>)}
                  </select>
                  <Button
                    size="sm"
                    disabled={working}
                    onClick={() => act('/patients/consents/grant', { purpose, method: asking.method, language: lang }, purpose)}
                  >
                    {working ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t('consent.record', 'Record the yes')}
                  </Button>
                  <button type="button" onClick={() => setAsking(null)} className="text-[11px] text-ink-muted underline">
                    {t('action.cancel', 'Cancel')}
                  </button>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {!here.granted && (
                    <Button size="sm" disabled={working} onClick={() => setAsking({ purpose, method: 'verbal' })}>
                      {t('consent.ask', 'Patient agreed')}
                    </Button>
                  )}
                  {here.granted && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={working}
                      onClick={() => act('/patients/consents/withdraw', { purpose }, purpose)}
                    >
                      {t('consent.withdrawAction', 'Patient has withdrawn it')}
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p className="px-5 py-3 text-[10px] text-ink-subtle border-t border-line">
        {t('consent.note', 'Saying no to the last two changes nothing about the care this patient receives. The record of the language and wording is what shows the consent was informed.')}
      </p>
    </Card>
  );
}
