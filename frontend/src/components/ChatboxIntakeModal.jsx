import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Loader2, X, Volume2, AlertCircle, CheckCircle2 } from 'lucide-react';
import api from '../services/api';
import { useI18n } from '../i18n/index.jsx';

/**
 * CHATBOX voice intake (Roadmap v3, F2).
 *
 * The assistant speaks; this proposes values for the form behind it. Three
 * things it deliberately does not do:
 *
 *   · it does not submit anything — the assistant applies the values, then
 *     submits the form themselves, so the form stays the path of record
 *   · it does not keep the audio or the transcript anywhere but this component's
 *     memory, and the server stores neither
 *   · it does not touch a field the assistant already filled in; the server
 *     returns those as skipped and they are shown as skipped
 *
 * Push to talk, never always-listening: a clinic room is shared, and audio
 * should leave the device only when someone meant to speak.
 */

/**
 * The server answers in the database's spelling; this form has its own. The
 * mapping is explicit because a silent mismatch would drop a reading a health
 * worker had just said aloud, which is the one failure this feature cannot have.
 */
const VITALS_TO_FORM = {
  temperature_f: 'temperature',
  blood_pressure_systolic: 'blood_pressure_systolic',
  blood_pressure_diastolic: 'blood_pressure_diastolic',
  pulse_bpm: 'pulse',
  spo2_percent: 'spo2',
  respiratory_rate: 'respiratory_rate'
};

/** Fields the server can hear but this form has nowhere to put. */
const NOT_ON_THIS_FORM = {
  current_medications: 'Current medicines',
  is_pregnant: 'Pregnancy',
  blood_glucose_mgdl: 'Blood glucose'
};

const TEXT_TO_FORM = {
  chief_complaint: 'chief_complaint',
  symptoms: 'symptoms',
  medical_history: 'medical_history',
  known_allergies: 'known_allergies',
  symptom_duration_value: 'symptom_duration_value',
  symptom_duration_unit: 'symptom_duration_unit'
};

const label = (t, field) => {
  const names = {
    chief_complaint: t('chatbox.f.complaint', 'Complaint and symptoms'),
    symptoms: t('chatbox.f.symptoms', 'Symptoms'),
    symptom_duration_value: t('chatbox.f.duration', 'Duration'),
    symptom_duration_unit: t('chatbox.f.durationUnit', 'Duration unit'),
    medical_history: t('chatbox.f.history', 'Medical history'),
    known_allergies: t('chatbox.f.allergies', 'Allergies'),
    temperature_f: t('vital.temperature', 'Temperature'),
    blood_pressure_systolic: t('vital.blood_pressure_systolic', 'Systolic BP'),
    blood_pressure_diastolic: t('vital.blood_pressure_diastolic', 'Diastolic BP'),
    pulse_bpm: t('vital.pulse', 'Pulse'),
    spo2_percent: t('vital.spo2', 'SpO₂'),
    respiratory_rate: t('vital.respiratory_rate', 'Respiratory rate'),
    blood_glucose_mgdl: t('vital.glucose', 'Blood glucose'),
    current_medications: t('chatbox.f.medicines', 'Current medicines'),
    is_pregnant: t('chatbox.f.pregnancy', 'Pregnancy')
  };
  return names[field] || field;
};

export default function ChatboxIntakeModal({
  open, onClose, typed, onApply, consent = false, onConsent, language = 'en', speechLang = 'en-IN'
}) {
  const { t } = useI18n();
  const [recording, setRecording] = useState(false);
  const [stage, setStage] = useState('idle');       // idle · transcribing · reading · done · failed
  const [transcript, setTranscript] = useState('');
  const [proposal, setProposal] = useState(null);
  const [problem, setProblem] = useState(null);

  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);

  /** A microphone left open is a microphone still listening. */
  const releaseMicrophone = () => {
    streamRef.current?.getTracks()?.forEach((track) => track.stop());
    streamRef.current = null;
  };

  useEffect(() => () => releaseMicrophone(), []);

  useEffect(() => {
    if (!open) {
      releaseMicrophone();
      setRecording(false);
      setStage('idle');
      setTranscript('');
      setProposal(null);
      setProblem(null);
    }
  }, [open]);

  if (!open) return null;

  const fail = (message) => {
    setStage('failed');
    setProblem(message);
  };

  const readInto = async (text) => {
    setStage('reading');
    try {
      const res = await api.post('/ai/intake-extract', { transcript: text, typed });
      if (!res.data?.ok) {
        fail(res.data?.reason || t('chatbox.failed', 'The reader could not be reached. Type the details instead.'));
        return;
      }
      setProposal(res.data);
      setStage('done');
    } catch (err) {
      // 404 means the feature is switched off on this deployment; anything else
      // is a bad moment on a rural link. Either way the answer is the form.
      fail(err.response?.status === 404
        ? t('chatbox.off', 'Voice intake is not switched on for this clinic yet.')
        : t('chatbox.failed', 'The reader could not be reached. Type the details instead.'));
    }
  };

  const start = async () => {
    // The audio leaves the building for transcription, so nothing is recorded
    // until the assistant has said the patient agreed.
    if (!consent) return;
    setProblem(null);
    setProposal(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };

      recorder.onstop = async () => {
        releaseMicrophone();
        setStage('transcribing');
        const form = new FormData();
        form.append('audio', new Blob(chunksRef.current, { type: 'audio/webm' }), 'speech.webm');
        form.append('language', language);

        try {
          const res = await api.post('/voice/transcribe', form, {
            headers: { 'Content-Type': 'multipart/form-data' }
          });
          const heard = res.data?.transcript?.trim();
          if (!heard) {
            // The speech service returns no transcript rather than a plausible
            // substitute. Say why, and let them speak again.
            fail(res.data?.reason || t('chatbox.nothingHeard', 'Nothing was heard. Try again, closer to the microphone.'));
            return;
          }
          setTranscript(heard);
          await readInto(heard);
        } catch {
          fail(t('chatbox.transcribeFailed', 'The recording could not be sent. Type the details instead.'));
        }
      };

      recorder.start();
      setRecording(true);
      setStage('idle');
    } catch {
      fail(t('chatbox.noMic', 'The microphone could not be opened. Check the browser permission.'));
    }
  };

  const stop = () => {
    recorderRef.current?.state === 'recording' && recorderRef.current.stop();
    setRecording(false);
  };

  /** Numbers, spoken back, because a misheard one is the whole risk. */
  const readBack = () => {
    if (!proposal || !window.speechSynthesis) return;
    const parts = [];
    for (const [field, entry] of Object.entries(proposal.accept)) {
      if (!entry.read_back) continue;
      parts.push(`${label(t, field)} ${entry.value}`);
    }
    if (!parts.length) return;
    const utterance = new SpeechSynthesisUtterance(parts.join('. '));
    utterance.lang = speechLang;
    window.speechSynthesis.speak(utterance);
  };

  const apply = () => {
    const values = { vitals: {} };
    const unusable = [];

    for (const [field, entry] of Object.entries(proposal?.accept || {})) {
      if (VITALS_TO_FORM[field]) {
        values.vitals[VITALS_TO_FORM[field]] = String(entry.value);
      } else if (TEXT_TO_FORM[field]) {
        values[field] = entry.value;
      } else {
        unusable.push(field);
      }
    }

    onApply(values, unusable);
    onClose();
  };

  const accepted = Object.entries(proposal?.accept || {});
  const heardButHomeless = accepted
    .map(([field]) => field)
    .filter((field) => !VITALS_TO_FORM[field] && !TEXT_TO_FORM[field]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
      <div className="bg-surface-raised w-full sm:max-w-lg rounded-t-card sm:rounded-card shadow-overlay max-h-[92vh] overflow-y-auto">
        <div className="px-5 py-3 border-b border-line flex items-center gap-3 sticky top-0 bg-surface-raised">
          <Mic className="w-4 h-4 text-gov-600" />
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-ink">{t('chatbox.title', 'CHATBOX — say the intake')}</h3>
            <p className="text-[11px] text-ink-muted">
              {t('chatbox.subtitle', 'Speak naturally. Nothing is saved until you apply it and submit the form.')}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('action.close', 'Close')} className="ml-auto p-1.5 rounded-field hover:bg-surface-sunken">
            <X className="w-4 h-4 text-ink-muted" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Consent is a recorded act, not a line of small print. Once given it
              stays for this patient's form; if the patient changes their mind,
              close the CHATBOX and type. */}
          <label className="flex items-start gap-2 text-[11px] text-ink-muted bg-surface-sunken border border-line rounded-field p-3 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={consent}
              disabled={consent}
              onChange={(e) => { if (e.target.checked) onConsent?.(); }}
            />
            <span>
              {t('chatbox.consentLine',
                'The recording is sent for transcription and is not stored — not the audio, not the text. '
                + 'I have told the patient, and they agree to be recorded.')}
            </span>
          </label>

          <button
            type="button"
            onClick={recording ? stop : start}
            disabled={!consent || stage === 'transcribing' || stage === 'reading'}
            className={`w-full py-3 rounded-field font-semibold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-60 ${
              recording ? 'bg-tier-emergency text-white animate-pulse' : 'bg-gov-600 text-white hover:bg-gov-700'
            }`}
          >
            {recording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            {recording ? t('chatbox.stop', 'Stop and read it') : t('chatbox.start', 'Hold the details, then speak')}
          </button>

          {(stage === 'transcribing' || stage === 'reading') && (
            <p className="text-xs text-ink-muted flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              {stage === 'transcribing'
                ? t('chatbox.transcribing', 'Listening back…')
                : t('chatbox.reading', 'Sorting what you said into fields…')}
            </p>
          )}

          {transcript && (
            <div>
              <p className="text-[11px] font-semibold text-ink-muted mb-1">{t('chatbox.heard', 'What was heard')}</p>
              <p className="text-xs text-ink bg-surface-sunken border border-line rounded-field p-3 leading-relaxed">{transcript}</p>
            </div>
          )}

          {problem && (
            <p role="alert" className="text-xs text-tier-emergency flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {problem}
            </p>
          )}

          {proposal && (
            <>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-[11px] font-semibold text-ink-muted">{t('chatbox.proposed', 'Proposed — check every number')}</p>
                  {accepted.some(([, e]) => e.read_back) && (
                    <button type="button" onClick={readBack} className="ml-auto text-[11px] text-gov-700 font-semibold flex items-center gap-1">
                      <Volume2 className="w-3.5 h-3.5" /> {t('chatbox.readBack', 'Read the numbers back')}
                    </button>
                  )}
                </div>

                {accepted.length === 0 ? (
                  <p className="text-xs text-ink-muted">{t('chatbox.nothingUsable', 'Nothing in that could be used. Say it again, or type it.')}</p>
                ) : (
                  <ul className="divide-y divide-line border border-line rounded-field">
                    {accepted.map(([field, entry]) => (
                      <li key={field} className="px-3 py-2 flex items-center gap-3 text-xs">
                        <CheckCircle2 className="w-3.5 h-3.5 text-gov-600 shrink-0" />
                        <span className="text-ink-muted">{label(t, field)}</span>
                        <span className="ml-auto font-semibold text-ink tabular-nums">{String(entry.value)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {proposal.skipped?.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-ink-muted mb-1">{t('chatbox.skipped', 'Not used')}</p>
                  <ul className="space-y-1 text-[11px] text-ink-muted">
                    {proposal.skipped.map((s, i) => (
                      <li key={`${s.field}-${i}`}>
                        <span className="text-ink">{label(t, s.field)}</span>{' — '}
                        {s.reason === 'typed' && t('chatbox.r.typed', 'you already entered a value, which is kept')}
                        {s.reason === 'implausible' && t('chatbox.r.implausible', 'that reading is outside the possible range')}
                        {s.reason === 'incomplete' && t('chatbox.r.incomplete', 'half a blood pressure is not a reading')}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {heardButHomeless.length > 0 && (
                <p className="text-[11px] text-ink-muted">
                  {t('chatbox.notOnForm', 'Heard, but this form has no field for it — write it into the history box if it matters:')}{' '}
                  {heardButHomeless.map((f) => NOT_ON_THIS_FORM[f] || label(t, f)).join(', ')}
                </p>
              )}

              {proposal.questions?.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-ink-muted mb-1">{t('chatbox.stillNeeded', 'Still worth asking')}</p>
                  <ul className="list-disc pl-4 space-y-1 text-[11px] text-ink-muted">
                    {proposal.questions.map((q, i) => <li key={i}>{q.question}</li>)}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-line flex gap-2 sticky bottom-0 bg-surface-raised">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-field border border-line-strong text-xs font-semibold text-ink-muted">
            {t('chatbox.typeInstead', 'Type it instead')}
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={!proposal || accepted.length === 0}
            className="ml-auto px-4 py-2 rounded-field bg-gov-600 text-white text-xs font-semibold disabled:opacity-50"
          >
            {t('chatbox.apply', 'Put these in the form')}
          </button>
        </div>
      </div>
    </div>
  );
}
