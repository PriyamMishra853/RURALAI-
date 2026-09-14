import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Stethoscope, Clock, CheckCircle2, Pill, FileDown, Siren, RefreshCw
} from 'lucide-react';
import api from '../services/api';
import { downloadVisitReport } from '../services/reportDownload';
import { useRealtime } from '../context/RealtimeContext';
import { Card, CardHeader, Badge, Button, Alert, Spinner, cn } from './ui';
import SpeakButton from './SpeakButton';
import { useI18n } from '../i18n/index.jsx';

/**
 * The doctor's decision, on the assistant's screen — spec §3.6.
 *
 * The assistant is standing with the patient waiting to know what to do. Before
 * this the decision lived only in the doctor's portal, so the loop never
 * closed and the assistant had to ask.
 *
 * Arrives live over the realtime socket, with a poll as the fallback transport:
 * a missed socket message must not mean a patient waits indefinitely.
 *
 * HIGH-risk visits show a closed state instead of a pending one. Those were
 * referred to hospital, and a spinner that never resolves would imply a review
 * is still coming when none ever will.
 */

/*
 * The left-hand values are what the database stores and never change; the pair
 * on the right is [catalogue key, English fallback].
 *
 * NOTE: `treat_locally` reads differently here to the same decision in
 * NotificationBell — "Treat locally — protocol care" versus "Treat locally".
 * That difference is deliberate and predates this change: the notification is
 * a one-line summary and this is the full decision panel. They therefore keep
 * separate keys rather than being merged into one that would be wrong in one
 * of the two places.
 */
const DECISION_LABEL = {
  prescribe: ['decision.prescribe', 'Prescription issued'],
  treat_locally: ['decision.treatLocallyFull', 'Treat locally — protocol care'],
  follow_up: ['decision.followUp', 'Follow-up scheduled'],
  refer_hospital: ['decision.referHospital', 'Referred to hospital'],
  no_action_needed: ['decision.noAction', 'No action needed']
};

/** Resolve a stored decision to readable text, falling back to the raw value. */
const decisionText = (t, decision) => {
  const entry = DECISION_LABEL[decision];
  return entry ? t(entry[0], entry[1]) : decision;
};

const DECISION_TONE = {
  prescribe: 'low',
  treat_locally: 'low',
  follow_up: 'moderate',
  refer_hospital: 'emergency',
  no_action_needed: 'neutral'
};


export default function DoctorReviewPanel({ visitId, className }) {
  // `language` was threaded in only to tell SpeakButton what to read; it now
  // takes that from the selected interface language directly.
  const { t, formatDate } = useI18n();
  const { subscribe } = useRealtime();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [justArrived, setJustArrived] = useState(false);

  const load = useCallback(async (opts = {}) => {
    if (opts.silent) setRefreshing(true);
    try {
      const res = await api.get(`/visits/${visitId}/review`);
      setData((prev) => {
        // Flash the panel only when a review actually lands, not on every poll.
        if (opts.silent && !prev?.review && res.data.review) setJustArrived(true);
        return res.data;
      });
    } catch {
      // A failed poll must not blank a review that is already on screen.
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [visitId]);

  useEffect(() => { if (visitId) load(); }, [visitId, load]);

  // Live: the doctor signing a review pushes DOCTOR_REVIEW_COMPLETED.
  useEffect(() => subscribe((msg) => {
    if (msg.type === 'notification' && msg.event === 'DOCTOR_REVIEW_COMPLETED'
        && msg.payload?.visit_id === visitId) {
      load({ silent: true });
    }
  }), [subscribe, visitId, load]);

  // Fallback poll while the review is still pending.
  useEffect(() => {
    if (!visitId || data?.review || data?.closed) return undefined;
    const t = setInterval(() => load({ silent: true }), 20000);
    return () => clearInterval(t);
  }, [visitId, data, load]);

  useEffect(() => {
    if (!justArrived) return undefined;
    const t = setTimeout(() => setJustArrived(false), 4000);
    return () => clearTimeout(t);
  }, [justArrived]);

  if (!visitId) return null;
  if (loading) {
    return (
      <Card className={className}>
        <Spinner label={t('review.checking', 'Checking for the doctor’s review…')} />
      </Card>
    );
  }
  if (!data) return null;

  // HIGH / referred — closed on this platform.
  if (data.closed) {
    return (
      <Card className={cn('border-l-4 border-l-tier-emergency', className)}>
        <div className="p-4 sm:p-5 flex items-start gap-3">
          <span className="w-10 h-10 rounded-field bg-tier-emergencyBg text-tier-emergency flex items-center justify-center shrink-0">
            <Siren className="w-5 h-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-ink">
              {t('review.closedReferred', 'Case closed — referred to hospital')}
            </p>
            <p className="text-xs text-ink-muted mt-1 leading-relaxed">{data.reason}</p>
          </div>
        </div>
      </Card>
    );
  }

  const review = data.review;
  const rx = data.prescription;

  /*
   * Assembled in English and translated as a whole by the read-aloud control,
   * for the same reason as assessmentToSpeech: fragments translated separately
   * do not reassemble into a grammatical sentence in a verb-final language.
   */
  const speech = review
    ? [
        `The doctor has reviewed this case.`,
        `Decision: ${(DECISION_LABEL[review.decision] || [])[1] || review.decision}.`,
        review.clinical_notes || '',
        rx?.items?.length
          ? 'Prescription. ' + rx.items.map((m) =>
              [m.name, m.strength, m.frequency, m.duration].filter(Boolean).join(', ')).join('. ')
          : ''
      ].filter(Boolean).join(' ')
    : '';

  return (
    <motion.div
      animate={justArrived ? { scale: [1, 1.01, 1] } : {}}
      transition={{ duration: 0.5 }}
    >
      <Card className={cn(
        review ? 'border-l-4 border-l-tier-low' : '',
        justArrived && 'ring-2 ring-tier-low',
        className
      )}>
        <CardHeader
          title={t('review.title', 'Doctor’s review')}
          subtitle={data.doctor_name
            ? t('review.assignedTo', 'Assigned to {name}', { name: data.doctor_name })
            : t('review.awaitingAssignment', 'Awaiting assignment')}
          icon={Stethoscope}
          action={
            <div className="flex items-center gap-2">
              {review && <SpeakButton text={speech} label={t('speak.read', 'Read')} size="sm" />}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => load({ silent: true })}
                aria-label={t('review.check', 'Check for the review')}
              >
                <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
              </Button>
            </div>
          }
        />

        <div className="p-4 sm:p-5">
          {!review ? (
            <div className="flex items-center gap-3 text-sm text-ink-muted">
              <Clock className="w-5 h-5 text-tier-moderate shrink-0 animate-pulse" />
              <div>
                <p className="font-semibold text-ink">{t('review.waiting', 'Waiting for the doctor')}</p>
                <p className="text-xs mt-0.5">
                  {t('review.waitingHint', 'This screen updates on its own the moment the review is signed — no need to refresh.')}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={DECISION_TONE[review.decision] || 'neutral'}>
                  <CheckCircle2 className="w-3 h-3" />
                  {decisionText(t, review.decision)}
                </Badge>
                {review.agreed_with_ai != null && (
                  <Badge tone={review.agreed_with_ai ? 'low' : 'moderate'}>
                    {review.agreed_with_ai
                      ? t('review.agreedAi', 'Agreed with AI assessment')
                      : t('review.differedAi', 'Differed from AI assessment')}
                  </Badge>
                )}
                <span className="text-[11px] text-ink-subtle">
                  {formatDate(review.created_at, { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
              </div>

              {review.clinical_notes && (
                <div className="p-3 rounded-field bg-surface-sunken border border-line">
                  <p className="text-xs text-ink whitespace-pre-line leading-relaxed">
                    {review.clinical_notes}
                  </p>
                </div>
              )}

              {rx?.items?.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted flex items-center gap-1.5 mb-2">
                    <Pill className="w-3.5 h-3.5" />{' '}
                    {t('rx.code', 'Prescription {code}', { code: rx.prescription_code })}
                  </p>
                  <div className="space-y-1.5">
                    {rx.items.map((m, i) => (
                      <div key={i} className="p-2.5 rounded-field bg-surface-sunken border border-line">
                        <p className="text-xs font-bold text-ink">
                          {m.name}{m.strength ? ` ${m.strength}` : ''}
                        </p>
                        <p className="text-[11px] text-ink-muted">
                          {[m.frequency, m.duration, m.instructions].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                    ))}
                  </div>
                  {rx.advice && (
                    <p className="mt-2 text-xs text-ink-muted">
                      <span className="font-semibold text-ink">{t('rx.advice', 'Advice')}: </span>{rx.advice}
                    </p>
                  )}
                </div>
              )}

              <Alert tone="success" icon={CheckCircle2}>
                {t('review.signed', 'A registered practitioner has signed this decision. Give the patient the printed copy and explain it in their own language.')}
              </Alert>

              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  const { ok, error } = await downloadVisitReport(visitId, 'summary', {
                    patientName: data?.patient_name,
                    t
                  });
                  if (!ok) alert(error || t('report.downloadFailed', 'The report could not be downloaded.'));
                }}
              >
                <FileDown className="w-3.5 h-3.5" /> {t('review.print', 'Print for the patient')}
              </Button>
            </div>
          )}
        </div>
      </Card>
    </motion.div>
  );
}
