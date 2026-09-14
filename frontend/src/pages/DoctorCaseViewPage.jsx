import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Stethoscope, Video, CheckCircle2, ArrowLeft, AlertCircle, RefreshCw,
  Lock, Plus, Trash2, Loader2, Bot, ClipboardCheck, Thermometer, Activity
} from 'lucide-react';
import api from '../services/api';
import ScheduleConsultationModal from '../components/ScheduleConsultationModal';
import RiskBadge from '../components/RiskBadge';
import { maskAadhaar } from '../config/patientFields';
import CaseEvidence from '../components/CaseEvidence';
import { useI18n } from '../i18n/index.jsx';

/**
 * Doctor case file and review.
 *
 * The decision values here are the exact enum the API accepts. They used to be
 * `PRESCRIBE` / `PROTOCOL` / `REFER` while the server expected
 * `prescribe` / `treat_locally` / `refer_hospital`, and the payload never sent
 * a `decision` field at all — so every review failed with "decision must be one
 * of: ..." regardless of what the doctor chose.
 */

/*
 * `value` is the enum the API accepts and must not change. `labelKey`/`hintKey`
 * are the words the doctor reads; `label`/`hint` remain as the English
 * fallback.
 *
 * The labels here are the imperative form the doctor chooses from ("Issue
 * prescription"), which is not the same string as the past-tense form shown
 * back to the assistant afterwards ("Prescription issued") in
 * DoctorReviewPanel — hence a separate key namespace rather than reusing that
 * one.
 */
const DECISIONS = [
  { value: 'prescribe', labelKey: 'choose.prescribe', label: 'Issue prescription', hintKey: 'choose.prescribe.hint', hint: 'Sign a prescription for this patient', needsMeds: true },
  { value: 'treat_locally', labelKey: 'choose.treatLocally', label: 'Treat locally', hintKey: 'choose.treatLocally.hint', hint: 'First-aid protocol care, no prescription' },
  { value: 'follow_up', labelKey: 'choose.followUp', label: 'Follow up', hintKey: 'choose.followUp.hint', hint: 'Review again after a set number of days', needsDays: true },
  { value: 'refer_hospital', labelKey: 'choose.refer', label: 'Refer to hospital', hintKey: 'choose.refer.hint', hint: 'Escalate to a higher centre', needsHospital: true },
  { value: 'no_action_needed', labelKey: 'choose.noAction', label: 'No action needed', hintKey: 'choose.noAction.hint', hint: 'Close the case with no intervention' }
];

const emptyMed = () => ({ name: '', strength: '', frequency: '', duration: '', instructions: '' });

export default function DoctorCaseViewPage() {
  const { t, formatNumber } = useI18n();
  const { id: visitId } = useParams();
  const navigate = useNavigate();

  const [visit, setVisit] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);

  const [decision, setDecision] = useState('prescribe');
  const [diagnosis, setDiagnosis] = useState('');
  const [notes, setNotes] = useState('');
  const [agreedWithAi, setAgreedWithAi] = useState(true);
  const [referralHospital, setReferralHospital] = useState('');
  const [followUpDays, setFollowUpDays] = useState('3');
  const [meds, setMeds] = useState([emptyMed()]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);

  const fetchCase = useCallback(async () => {
    try {
      const res = await api.get(`/doctor/cases/${visitId}`);
      setVisit(res.data);
      setFetchError(null);
    } catch (err) {
      setFetchError(err.response?.data?.error || err.message || t('case.loadFailed', 'Could not load the case file.'));
    } finally {
      setLoading(false);
    }
  }, [visitId, t]);

  useEffect(() => { fetchCase(); }, [fetchCase]);

  const patient = visit?.patients || {};
  const vitals = Array.isArray(visit?.visit_vitals) ? visit.visit_vitals[0] : visit?.visit_vitals;
  const assessment = Array.isArray(visit?.ai_assessments) ? visit.ai_assessments[0] : visit?.ai_assessments;
  const symptoms = visit?.visit_symptoms || [];
  const documents = visit?.patient_documents || [];
  const images = visit?.patient_images || [];
  // Who verified this case at the clinic. The doctor is acting on data someone
  // else collected, so being able to see — and contact — that person is part
  // of the record, not a nicety.
  const assistant = Array.isArray(visit?.assistant) ? visit.assistant[0] : visit?.assistant;

  /**
   * A case from a previous day is history, not work. The queue already hides
   * these, but the case file is reachable by direct URL — and the server
   * rejects the review too, so this is presentation, not the control.
   */
  const todayIso = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const isPast = Boolean(visit?.visit_date && visit.visit_date < todayIso);
  const alreadyReviewed = ['completed', 'referred'].includes(visit?.status);
  const readOnly = isPast || alreadyReviewed;

  const active = useMemo(() => DECISIONS.find((d) => d.value === decision), [decision]);

  const setMed = (i, field, value) =>
    setMeds((prev) => prev.map((m, idx) => (idx === i ? { ...m, [field]: value } : m)));

  const submit = async (e) => {
    e.preventDefault();
    setSubmitError(null);

    if (!diagnosis.trim()) {
      setSubmitError(t('case.needDiagnosis', 'Enter a diagnosis before saving.'));
      return;
    }
    const cleanMeds = meds.filter((m) => m.name.trim());
    if (active?.needsMeds && !cleanMeds.length) {
      setSubmitError(t('case.needMedicine', 'Add at least one medicine, or choose a different decision.'));
      return;
    }
    if (active?.needsHospital && !referralHospital.trim()) {
      setSubmitError(t('case.needHospital', 'Name the hospital you are referring to.'));
      return;
    }

    setSubmitting(true);
    try {
      await api.post(`/doctor/cases/${visitId}/review`, {
        decision,
        diagnosis: diagnosis.trim(),
        clinical_notes: notes.trim() || undefined,
        agreed_with_ai: agreedWithAi,
        prescriptions: cleanMeds,
        referral_hospital: active?.needsHospital ? referralHospital.trim() : undefined,
        follow_up_days: active?.needsDays ? Number(followUpDays) : undefined
      });
      setSaved(true);
      setTimeout(() => navigate('/doctor/queue'), 1200);
    } catch (err) {
      setSubmitError(err.response?.data?.error || t('case.saveFailed', 'The review could not be saved.'));
    } finally {
      setSubmitting(false);
    }
  };

  // ---- states -------------------------------------------------------------
  if (loading) {
    return (
      <div className="py-20 text-center text-xs text-ink-muted flex items-center justify-center gap-2">
        <RefreshCw className="w-4 h-4 text-gov-600 animate-spin" /> {t('case.loading', 'Loading the case file…')}
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="py-20 text-center space-y-4">
        <div className="p-4 rounded-field bg-tier-emergencyBg border border-tier-emergency/30 text-xs text-tier-emergency max-w-lg mx-auto flex items-center gap-2 justify-center">
          <AlertCircle className="w-4 h-4 shrink-0" /> {fetchError}
        </div>
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => { setLoading(true); fetchCase(); }}
            className="px-4 py-2 rounded-field bg-gov-600 text-white font-semibold text-xs hover:bg-gov-700 inline-flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" /> {t('common.retry', 'Try again')}
          </button>
          <button
            type="button"
            onClick={() => navigate('/doctor/queue')}
            className="px-4 py-2 rounded-field border border-line-strong text-ink-muted font-semibold text-xs hover:bg-surface-sunken"
          >
            {t('case.backToQueue', 'Back to queue')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* ---- Header ---- */}
      <div className="bg-surface-raised rounded-card border border-line shadow-sm p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <button
              type="button"
              onClick={() => navigate('/doctor/queue')}
              aria-label={t('case.backToQueue', 'Back to queue')}
              className="p-2 rounded-field bg-surface-sunken hover:bg-surface-sunken text-ink-muted shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg sm:text-xl font-bold text-ink truncate">
                  {patient.full_name || t('common.patient', 'Patient')}
                </h1>
                <RiskBadge level={visit?.risk_level} />
              </div>
              <p className="text-xs text-ink-muted truncate">
                {patient.age_display || '—'}
                {' · '}
                {patient.gender ? t('gender.' + String(patient.gender).toLowerCase(), patient.gender) : '—'}
                {' · '}
                <span className="font-mono">{maskAadhaar(patient.aadhaar_number)}</span> ·{' '}
                <code className="font-mono text-gov-600">{visit?.visit_code}</code>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowSchedule(true)}
            disabled={readOnly}
            className="w-full lg:w-auto px-4 py-2.5 rounded-field bg-gov-600 hover:bg-gov-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-xs shadow-sm flex items-center justify-center gap-2"
          >
            <Video className="w-4 h-4" /> {t('case.videoConsultation', 'Video consultation')}
          </button>
        </div>
      </div>

      {readOnly && (
        <div className="p-3 rounded-field bg-surface-sunken border border-line-strong text-xs text-ink-muted flex items-start gap-2">
          <Lock className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            {alreadyReviewed
              ? (
                <>
                  <strong>{t('case.reviewedLead', 'Already reviewed.')}</strong>{' '}
                  {t('case.reviewedBody', 'This case has been closed and cannot be reviewed again.')}
                </>
              ) : (
                <>
                  <strong>{t('queue.readOnlyLead', 'Read-only.')}</strong>{' '}
                  {t('case.pastBody', 'This case is from a previous day. Ask an administrator to reassign it if it still needs review.')}
                </>
              )}
          </span>
        </div>
      )}

      {/* ---- Clinical summary ---- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="bg-surface-raised p-4 rounded-card border border-line shadow-sm">
          <span className="text-[11px] text-ink-muted font-medium flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5" /> {t('case.chiefComplaint', 'Chief complaint')}
          </span>
          <p className="text-sm font-semibold text-ink mt-1 leading-snug">
            {visit?.chief_complaint || t('common.notRecorded', 'Not recorded')}
          </p>
          {visit?.symptom_duration && (
            <p className="text-[11px] text-ink-muted mt-0.5">
              {t('case.forDuration', 'for {duration}', { duration: visit.symptom_duration })}
            </p>
          )}
        </div>

        <div className="bg-surface-raised p-4 rounded-card border border-line shadow-sm">
          <span className="text-[11px] text-ink-muted font-medium flex items-center gap-1.5">
            <Thermometer className="w-3.5 h-3.5" /> {t('section.vitals', 'Vitals')}
          </span>
          {vitals ? (
            <div className="text-xs text-ink mt-1 space-y-0.5">
              {/* Units stay as printed international notation — mmHg, °F, bpm
                  are read the same everywhere and a localised unit on a vitals
                  line is a misreading waiting to happen. Only the field names
                  are translated. */}
              <p>
                {t('vital.bpShort', 'BP')} {vitals.blood_pressure_systolic ?? '—'}/{vitals.blood_pressure_diastolic ?? '—'} mmHg
              </p>
              <p>{vitals.temperature_f ?? '—'}°F · SpO₂ {vitals.spo2_percent ?? '—'}%</p>
              <p>
                {t('vital.pulse', 'Pulse')} {vitals.pulse_bpm ?? '—'} ·{' '}
                {t('vital.rrShort', 'RR')} {vitals.respiratory_rate ?? '—'}
              </p>
            </div>
          ) : (
            <p className="text-xs text-ink-subtle mt-1">{t('common.notRecorded', 'Not recorded')}</p>
          )}
        </div>

        <div className="bg-surface-raised p-4 rounded-card border border-line shadow-sm">
          <span className="text-[11px] text-ink-muted font-medium">{t('case.historyAllergies', 'History & allergies')}</span>
          <p className="text-xs text-ink mt-1">{visit?.medical_history || t('case.noneReported', 'None reported')}</p>
          <p className="text-xs text-tier-emergency mt-1">
            {visit?.known_allergies || t('case.noAllergies', 'No known allergies')}
          </p>
        </div>

        <div className="bg-surface-raised p-4 rounded-card border border-line shadow-sm">
          <span className="text-[11px] text-ink-muted font-medium">{t('case.attachments', 'Attachments')}</span>
          <p className="text-sm font-semibold text-ink mt-1">
            {t('case.documentCount', '{count} document(s)', { count: formatNumber(documents.length) })}
          </p>
          <p className="text-[11px] text-ink-muted">
            {t('case.symptomCount', '{count} symptom note(s)', { count: formatNumber(symptoms.length) })}
          </p>
          <p className="text-[11px] text-ink-muted">
            {t('case.photoCount', '{count} wound photo(s)', { count: formatNumber(images.length) })}
          </p>
        </div>
      </div>

      {/* ---- AI assistance vs doctor decision ---- */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">

        {/* AI side */}
        <div className="xl:col-span-7 space-y-4">
          <div className="bg-surface-raised rounded-card border border-line shadow-sm overflow-hidden">
            <div className="px-5 py-3 bg-gov-50 border-b border-gov-200 flex items-center gap-2">
              <Bot className="w-4 h-4 text-gov-600" />
              <h2 className="text-sm font-bold text-blue-900">{t('case.aiAssistance', 'AI assistance')}</h2>
              <span className="ml-auto text-[10px] font-semibold text-gov-700 bg-surface-raised px-2 py-0.5 rounded border border-gov-200">
                {t('case.notADiagnosis', 'Not a diagnosis')}
              </span>
            </div>

            <div className="p-5 space-y-4">
              {assessment ? (
                <>
                  <div>
                    <h3 className="text-[11px] font-bold uppercase tracking-wider text-ink-muted mb-1">{t('case.preparedSummary', 'Prepared summary')}</h3>
                    <p className="text-xs text-ink leading-relaxed">{assessment.patient_summary}</p>
                  </div>

                  {Array.isArray(assessment.first_aid_steps) && assessment.first_aid_steps.length > 0 && (
                    <div>
                      <h3 className="text-[11px] font-bold uppercase tracking-wider text-ink-muted mb-1">{t('case.protocolFirstAid', 'Protocol first-aid steps')}</h3>
                      <ul className="text-xs text-ink-muted space-y-1">
                        {assessment.first_aid_steps.map((s, i) => <li key={i}>• {s}</li>)}
                      </ul>
                    </div>
                  )}

                  {Array.isArray(assessment.warnings) && assessment.warnings.length > 0 && (
                    <div className="p-3 rounded-field bg-tier-moderateBg border border-tier-moderate/30">
                      <h3 className="text-[11px] font-bold uppercase tracking-wider text-tier-moderate mb-1">{t('case.warnings', 'Warnings')}</h3>
                      <ul className="text-xs text-tier-moderate space-y-1">
                        {assessment.warnings.map((w, i) => <li key={i}>• {w}</li>)}
                      </ul>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-line">
                    {assessment.recommended_next_action && (
                      <span className="text-[10px] font-bold px-2 py-1 rounded bg-gov-50 text-gov-700 border border-gov-200">
                        {t(
                          'nextAction.' + String(assessment.recommended_next_action).toLowerCase(),
                          assessment.recommended_next_action.replace(/_/g, ' ')
                        )}
                      </span>
                    )}
                    <span className="text-[10px] text-ink-subtle font-mono">{assessment.generated_by}</span>
                  </div>
                </>
              ) : (
                <p className="text-xs text-ink-muted">
                  {t('case.noAssessment', 'No AI assessment was generated for this visit. Review the recorded data directly.')}
                </p>
              )}
            </div>
          </div>

          {symptoms.length > 0 && (
            <div className="bg-surface-raised rounded-card border border-line shadow-sm p-5">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-ink-muted mb-2">{t('case.recordedSymptoms', 'Recorded symptoms')}</h3>
              <ul className="text-xs text-ink-muted space-y-1">
                {symptoms.map((s, i) => (
                  <li key={i}>
                    • {s.description}{' '}
                    <span className="text-ink-subtle">({t('symptomSource.' + s.source, s.source)})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Everything the assistant captured — documents with their
              verification state, and the wound photographs with the vision
              model's reading. For a doctor reviewing remotely these ARE the
              examination, so they are shown in full rather than counted. */}
          <CaseEvidence documents={documents} images={images} />
          {assistant && (
            <div className="bg-surface-raised rounded-card border border-line shadow-sm p-5">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-ink-muted mb-2">{t('case.verifiedBy', 'Verified by')}</h3>
              <p className="text-xs font-semibold text-ink">{assistant.full_name}</p>
              {assistant.email && (
                <a href={`mailto:${assistant.email}`} className="text-[11px] text-gov-600 hover:underline break-all">
                  {assistant.email}
                </a>
              )}
              <p className="text-[10px] text-ink-subtle mt-1">
                {t('case.assistantNote', 'Clinic assistant who recorded and sent this case.')}
              </p>
            </div>
          )}
        </div>

        {/* Doctor side */}
        <div className="xl:col-span-5">
          <form
            onSubmit={submit}
            className="bg-surface-raised rounded-card border border-line shadow-sm overflow-hidden xl:sticky xl:top-6"
          >
            <div className="px-5 py-3 bg-tier-lowBg border-b border-emerald-100 flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-tier-low" />
              <h2 className="text-sm font-bold text-tier-low">{t('case.yourDecision', 'Your decision')}</h2>
              <span className="ml-auto text-[10px] font-semibold text-tier-low bg-surface-raised px-2 py-0.5 rounded border border-tier-low/30">
                {t('case.finalAuthority', 'Final authority')}
              </span>
            </div>

            <fieldset disabled={readOnly || saved} className="p-5 space-y-4 disabled:opacity-60">
              <div>
                <label className="block text-xs font-semibold text-ink-muted mb-1.5">{t('case.decision', 'Decision')}</label>
                <div className="space-y-1.5">
                  {DECISIONS.map((d) => (
                    <label
                      key={d.value}
                      className={`flex items-start gap-2.5 p-2.5 rounded-field border cursor-pointer transition-colors ${
                        decision === d.value ? 'border-tier-low bg-tier-lowBg' : 'border-line hover:border-tier-low/40'
                      }`}
                    >
                      <input
                        type="radio"
                        name="decision"
                        value={d.value}
                        checked={decision === d.value}
                        onChange={(e) => setDecision(e.target.value)}
                        className="mt-0.5 accent-[rgb(var(--tier-low))]"
                      />
                      <span className="min-w-0">
                        <span className="block text-xs font-semibold text-ink">{t(d.labelKey, d.label)}</span>
                        <span className="block text-[11px] text-ink-muted">{t(d.hintKey, d.hint)}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="diagnosis" className="block text-xs font-semibold text-ink-muted mb-1">
                  {t('case.diagnosis', 'Diagnosis')} <span className="text-tier-emergency">*</span>
                </label>
                <input
                  id="diagnosis"
                  value={diagnosis}
                  onChange={(e) => setDiagnosis(e.target.value)}
                  placeholder={t('case.diagnosisPlaceholder', 'e.g. Acute viral febrile illness')}
                  className="w-full bg-surface-raised border border-line-strong rounded-field px-3 py-2 text-xs text-ink focus:border-tier-low outline-none"
                />
              </div>

              <div>
                <label htmlFor="notes" className="block text-xs font-semibold text-ink-muted mb-1">{t('case.clinicalNotes', 'Clinical notes')}</label>
                <textarea
                  id="notes"
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t('case.notesPlaceholder', 'Advice, observations, anything the assistant should act on')}
                  className="w-full bg-surface-raised border border-line-strong rounded-field px-3 py-2 text-xs text-ink focus:border-tier-low outline-none"
                />
              </div>

              {active?.needsHospital && (
                <div>
                  <label htmlFor="hospital" className="block text-xs font-semibold text-ink-muted mb-1">
                    {t('case.referringTo', 'Referring to')} <span className="text-tier-emergency">*</span>
                  </label>
                  <input
                    id="hospital"
                    value={referralHospital}
                    onChange={(e) => setReferralHospital(e.target.value)}
                    placeholder={t('case.hospitalPlaceholder', 'e.g. District Hospital, Agra')}
                    className="w-full bg-surface-raised border border-line-strong rounded-field px-3 py-2 text-xs text-ink focus:border-tier-low outline-none"
                  />
                </div>
              )}

              {active?.needsDays && (
                <div>
                  <label htmlFor="followup" className="block text-xs font-semibold text-ink-muted mb-1">{t('case.followUpDays', 'Follow up in (days)')}</label>
                  <input
                    id="followup"
                    type="number"
                    min="1"
                    max="90"
                    value={followUpDays}
                    onChange={(e) => setFollowUpDays(e.target.value)}
                    className="w-24 bg-surface-raised border border-line-strong rounded-field px-3 py-2 text-xs text-ink focus:border-tier-low outline-none"
                  />
                </div>
              )}

              {active?.needsMeds && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-ink-muted">{t('rx.title', 'Prescription')}</label>
                    <button
                      type="button"
                      onClick={() => setMeds((p) => [...p, emptyMed()])}
                      className="text-[11px] font-semibold text-tier-low hover:underline flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" /> {t('case.addMedicine', 'Add medicine')}
                    </button>
                  </div>

                  <div className="space-y-2">
                    {meds.map((m, i) => (
                      <div key={i} className="p-2.5 rounded-field bg-surface-sunken border border-line space-y-2">
                        <div className="flex gap-2">
                          <input
                            value={m.name}
                            onChange={(e) => setMed(i, 'name', e.target.value)}
                            placeholder={t('field.medicineName', 'Medicine name')}
                            className="flex-1 bg-surface-raised border border-line-strong rounded px-2 py-1.5 text-xs outline-none focus:border-tier-low"
                          />
                          {meds.length > 1 && (
                            <button
                              type="button"
                              onClick={() => setMeds((p) => p.filter((_, idx) => idx !== i))}
                              aria-label={t('case.removeMedicine', 'Remove medicine {n}', { n: formatNumber(i + 1) })}
                              className="p-1.5 rounded text-tier-emergency hover:bg-tier-emergencyBg shrink-0"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <input
                            value={m.strength}
                            onChange={(e) => setMed(i, 'strength', e.target.value)}
                            placeholder="500 mg"
                            className="bg-surface-raised border border-line-strong rounded px-2 py-1.5 text-[11px] outline-none focus:border-tier-low"
                          />
                          <input
                            value={m.frequency}
                            onChange={(e) => setMed(i, 'frequency', e.target.value)}
                            placeholder="1-0-1"
                            className="bg-surface-raised border border-line-strong rounded px-2 py-1.5 text-[11px] outline-none focus:border-tier-low"
                          />
                          <input
                            value={m.duration}
                            onChange={(e) => setMed(i, 'duration', e.target.value)}
                            placeholder="5 days"
                            className="bg-surface-raised border border-line-strong rounded px-2 py-1.5 text-[11px] outline-none focus:border-tier-low"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {assessment && (
                <label className="flex items-center gap-2 text-xs text-ink-muted">
                  <input
                    type="checkbox"
                    checked={agreedWithAi}
                    onChange={(e) => setAgreedWithAi(e.target.checked)}
                    className="accent-[rgb(var(--tier-low))]"
                  />
                  {t('case.agreeWithAi', 'My decision agrees with the AI assessment')}
                </label>
              )}
            </fieldset>

            <div className="px-5 pb-5 space-y-3">
              {submitError && (
                <div role="alert" className="p-2.5 rounded-field bg-tier-emergencyBg border border-tier-emergency/30 text-[11px] text-tier-emergency flex items-start gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {submitError}
                </div>
              )}
              {saved && (
                <div className="p-2.5 rounded-field bg-tier-lowBg border border-tier-low/30 text-[11px] text-tier-low flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" /> {t('case.reviewSaved', 'Review saved. Returning to your queue…')}
                </div>
              )}

              <button
                type="submit"
                disabled={readOnly || submitting || saved}
                className="w-full py-3 rounded-field bg-tier-low hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center justify-center gap-2"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {readOnly
                  ? t('case.readOnly', 'Read-only')
                  : submitting
                    ? t('common.saving', 'Saving…')
                    : t('case.saveReview', 'Save review')}
              </button>
            </div>
          </form>
        </div>
      </div>

      {showSchedule && (
        <ScheduleConsultationModal
          visitId={visitId}
          patientName={patient.full_name}
          onClose={() => setShowSchedule(false)}
          onBooked={() => fetchCase()}
        />
      )}
    </div>
  );
}
