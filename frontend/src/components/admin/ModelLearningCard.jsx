import React, { useCallback, useEffect, useState } from 'react';
import { Brain, Loader2, AlertTriangle, RefreshCw, ArrowUpCircle } from 'lucide-react';
import api from '../../services/api';
import { useI18n } from '../../i18n/index.jsx';
import { useAuth } from '../../context/AuthContext';
import { useFeature, FEATURES } from '../../context/FeatureContext';
import { Card, Button } from '../ui';

/**
 * The model learning from the clinics (Roadmap v3, F3).
 *
 * Every visit a doctor completes, for a patient who agreed to training use,
 * teaches the next candidate model — built automatically, scored on a frozen
 * benchmark beside the live one. This card is where a person sees that
 * comparison and decides whether the candidate goes live. A worse candidate
 * cannot be promoted from here or anywhere else.
 */

const pct = (x) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(1)}%`);
const delta = (a, b) => {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  const d = (a - b) * 100;
  if (Math.abs(d) < 0.05) return '±0.0';
  return `${d > 0 ? '+' : ''}${d.toFixed(1)}`;
};

export default function ModelLearningCard() {
  const enabled = useFeature(FEATURES.MODEL_LEARNING);
  const { user } = useAuth();
  const { t, formatNumber } = useI18n();

  const [status, setStatus] = useState(null);
  const [unmatched, setUnmatched] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);

  const role = String(user?.role || '').toUpperCase();
  const canRetrain = ['SUPER_ADMIN', 'STATE_ADMIN'].includes(role);
  const canPromote = role === 'SUPER_ADMIN';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, u] = await Promise.all([
        api.get('/learning/status'),
        api.get('/learning/examples', { params: { outcome: 'unmatched_diagnosis' } })
      ]);
      setStatus(s.data);
      setUnmatched(u.data.examples || []);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || t('learning.loadFailed', 'Learning status could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return null;

  const act = async (kind, request) => {
    setBusy(kind);
    setError(null);
    setNote(null);
    try {
      const res = await request();
      if (kind === 'retrain') {
        const v = res.data.version;
        setNote(t('learning.built', 'Candidate v{version} built from {count} learned example(s).', { version: v.version, count: formatNumber(v.learned) }));
      } else {
        setNote(t('learning.promoted', 'Version {version} is now live.', { version: res.data.version?.version }));
      }
      await load();
    } catch (err) {
      setError(err.response?.data?.error || t('learning.actionFailed', 'That could not be done.'));
    } finally {
      setBusy(null);
    }
  };

  const live = status?.live;
  const candidate = status?.candidate;
  const liveMetrics = candidate?.live_metrics || live?.metrics || status?.service?.base_metrics;
  const ex = status?.examples || {};

  return (
    <Card>
      <div className="px-4 sm:px-5 py-3 border-b border-line flex flex-wrap items-center gap-3">
        <Brain className="w-4 h-4 text-gov-600" />
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-ink">{t('learning.title', 'The model learning from the clinics')}</h3>
          <p className="text-[11px] text-ink-muted">
            {t('learning.subtitle', 'Every completed visit with training consent teaches the next candidate. It goes live only if it is not worse on a frozen benchmark.')}
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
      {note && <p className="px-5 pt-3 text-xs text-tier-low">{note}</p>}

      {loading && !status ? (
        <p className="px-5 py-4 text-xs text-ink-muted flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> {t('common.loading', 'Loading…')}
        </p>
      ) : (
        <div className="p-4 sm:p-5 space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-ink-muted border-b border-line">
                  <th className="py-2 pr-3 font-semibold">{t('learning.model', 'Model')}</th>
                  <th className="py-2 px-3 font-semibold text-right">{t('learning.examples', 'Learned from')}</th>
                  <th className="py-2 px-3 font-semibold text-right">{t('learning.top1', 'Top-1')}</th>
                  <th className="py-2 px-3 font-semibold text-right">{t('learning.top3', 'Top-3')}</th>
                  <th className="py-2 pl-3 font-semibold text-right">{t('learning.top5', 'Top-5')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                <tr>
                  <td className="py-2 pr-3 text-ink">
                    {live ? t('learning.liveVersion', 'Live — v{version}', { version: live.version }) : t('learning.base', 'Live — shipped base model')}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums text-ink-muted">{formatNumber(live?.learned || 0)}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{pct(liveMetrics?.top1)}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{pct(liveMetrics?.top3)}</td>
                  <td className="py-2 pl-3 text-right tabular-nums">{pct(liveMetrics?.top5)}</td>
                </tr>
                {candidate && (
                  <tr>
                    <td className="py-2 pr-3 text-ink">{t('learning.candidate', 'Candidate — v{version}', { version: candidate.version })}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-ink-muted">{formatNumber(candidate.learned)}</td>
                    {['top1', 'top3', 'top5'].map((k) => (
                      <td key={k} className="py-2 px-3 text-right tabular-nums">
                        {pct(candidate.metrics?.[k])}
                        <span className="text-[10px] text-ink-subtle"> ({delta(candidate.metrics?.[k], candidate.live_metrics?.[k])})</span>
                      </td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
            <p className="mt-1 text-[10px] text-ink-subtle">
              {t('learning.benchmark', 'Scored on {count} held-out cases the model never trained on — the same rows every time.', {
                count: formatNumber(status?.service?.benchmark_cases || 0)
              })}
            </p>
          </div>

          <p className="text-[11px] text-ink-muted">
            {t('learning.counts', '{approved} example(s) from consented visits: {learned} taught the model, {unmatched} named a diagnosis the model does not have, {nosym} had no recognisable symptoms. {rejected} rejected.', {
              approved: formatNumber(ex.approved || 0),
              learned: formatNumber(ex.learned || 0),
              unmatched: formatNumber(ex.unmatched_diagnosis || 0),
              nosym: formatNumber(ex.no_symptoms_matched || 0),
              rejected: formatNumber(ex.rejected || 0)
            })}
          </p>

          {unmatched.length > 0 && (
            <div className="p-3 rounded-field bg-surface-sunken border border-line">
              <p className="text-[11px] font-semibold text-ink">{t('learning.gaps', 'Diagnoses the model cannot learn yet')}</p>
              <p className="text-[10px] text-ink-muted mb-1">
                {t('learning.gapsNote', 'Doctors diagnosed these; the model has no class for them. Each is a candidate for the vocabulary, not a failure of the doctor.')}
              </p>
              <ul className="text-[11px] text-ink list-disc pl-4 space-y-0.5">
                {[...new Set(unmatched.map((e) => e.diagnosis_text))].slice(0, 8).map((d) => <li key={d}>{d}</li>)}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {canRetrain && (
              <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => act('retrain', () => api.post('/learning/candidate'))}>
                {busy === 'retrain' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                {t('learning.retrain', 'Retrain now')}
              </Button>
            )}
            {candidate && canPromote && (
              <Button size="sm" disabled={Boolean(busy)} onClick={() => act('promote', () => api.post(`/learning/versions/${candidate.version}/promote`))}>
                {busy === 'promote' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowUpCircle className="w-3.5 h-3.5" />}
                {t('learning.promote', 'Make v{version} live', { version: candidate.version })}
              </Button>
            )}
          </div>

          <p className="text-[10px] text-ink-subtle">
            {status?.auto_promote
              ? t('learning.autoOn', 'Automatic promotion is on: a candidate that is not worse goes live by itself.')
              : t('learning.autoOff', 'A candidate goes live only when the super admin promotes it. The model retrains itself; a person decides when it changes.')}
          </p>
        </div>
      )}
    </Card>
  );
}
