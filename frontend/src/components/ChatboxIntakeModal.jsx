import React, { useEffect, useRef, useState } from 'react';
import {
  Mic, MicOff, Loader2, X, Volume2, VolumeX, AlertCircle, Send, RotateCcw, MessageSquare, CheckCircle2
} from 'lucide-react';
import api from '../services/api';
import { useI18n } from '../i18n/index.jsx';

/**
 * CHATBOX — voice or typed intake, in one conversation (Roadmap v3, F2).
 *
 * The assistant talks or types to it, one message at a time, in whatever
 * order the patient gives the details. Each message fills in more of a draft;
 * the CHATBOX answers with what it understood and what is still missing, and
 * the assistant answers that in the next message. Nothing reaches the form
 * until the assistant applies the draft, and every applied value is marked for
 * checking there.
 *
 * What it deliberately does not do:
 *
 *   · submit anything — the form stays the path of record
 *   · keep audio or text anywhere but this component's memory; the server
 *     stores neither
 *   · touch a field the assistant already filled in on the form; the server
 *     returns those as skipped
 *
 * A later message may correct an earlier one ("sorry, pulse is 92"): both are
 * drafts, and the newer draft wins. A typed message is still read by a model,
 * so typed values need the same checking as spoken ones — they are recorded as
 * `chat` rather than `voice` so the two can be told apart.
 *
 * Push to talk, never always-listening, and only after the assistant has said
 * the patient agreed. Typing sends no audio and needs no recording consent.
 */

/**
 * The server answers in the database's spelling; this form has its own. The
 * mapping is explicit because a silent mismatch would drop a reading a health
 * worker had just given, which is the one failure this feature cannot have.
 */
const VITALS_TO_FORM = {
  blood_glucose_mgdl: 'blood_glucose_mgdl',
  temperature_f: 'temperature',
  blood_pressure_systolic: 'blood_pressure_systolic',
  blood_pressure_diastolic: 'blood_pressure_diastolic',
  pulse_bpm: 'pulse',
  spo2_percent: 'spo2',
  respiratory_rate: 'respiratory_rate'
};

const TEXT_TO_FORM = {
  chief_complaint: 'chief_complaint',
  symptoms: 'symptoms',
  medical_history: 'medical_history',
  known_allergies: 'known_allergies',
  current_medications: 'current_medications',
  is_pregnant: 'is_pregnant',
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

const display = (t, field, value) => {
  if (field === 'is_pregnant') return value ? t('assess.pregnancy.yes', 'Yes') : t('assess.pregnancy.no', 'No');
  return String(value);
};

let turnSeq = 0;
const nextId = () => { turnSeq += 1; return `turn-${turnSeq}`; };

export default function ChatboxIntakeModal({
  open, onClose, typed, onApply, onOpened, consent = false, onConsent, language = 'en', speechLang = 'en-IN'
}) {
  const { t } = useI18n();
  const [turns, setTurns] = useState([]);
  // The draft so far: field → { value, via, read_back }. Newer messages win.
  const [session, setSession] = useState({});
  const [draft, setDraft] = useState('');
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(null);           // null · 'transcribing' · 'reading'
  const [muted, setMuted] = useState(false);

  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const threadRef = useRef(null);

  /** A screen that keeps talking after it is closed is its own problem. */
  const stopSpeaking = () => window.speechSynthesis?.cancel();

  /** A microphone left open is a microphone still listening. */
  const releaseMicrophone = () => {
    streamRef.current?.getTracks()?.forEach((track) => track.stop());
    streamRef.current = null;
  };

  useEffect(() => () => { releaseMicrophone(); stopSpeaking(); }, []);

  // Counted on opening, not on applying: the gap between the two is F2's
  // "share of sessions abandoned to the form".
  useEffect(() => { if (open) onOpened?.(); }, [open]);

  useEffect(() => {
    if (!open) {
      releaseMicrophone();
      stopSpeaking();
      setRecording(false);
      setBusy(null);
      setTurns([]);
      setSession({});
      setDraft('');
    }
  }, [open]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, busy]);

  if (!open) return null;

  const addTurn = (turn) => setTurns((prev) => [...prev, { id: nextId(), ...turn }]);

  /** Numbers read back and questions asked aloud: the assistant is looking at the patient. */
  const say = (text) => {
    if (!text || muted || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = speechLang;
    window.speechSynthesis.speak(utterance);
  };

  /** One message, spoken or typed, into the draft. */
  const send = async (text, via) => {
    const message = String(text || '').trim();
    if (!message) return;
    addTurn({ role: 'you', text: message, via });
    setBusy('reading');

    try {
      const res = await api.post('/ai/intake-extract', { transcript: message, typed });
      if (!res.data?.ok) {
        addTurn({ role: 'chatbox', problem: res.data?.reason || t('chatbox.failed', 'The reader could not be reached. Type the details into the form instead.') });
        return;
      }

      const accepted = Object.entries(res.data.accept || {});
      const known = { ...session };
      for (const [field, entry] of accepted) known[field] = { value: entry.value, via, read_back: entry.read_back };
      setSession(known);

      // Only ask for what the whole conversation still lacks, not just this message.
      const questions = (res.data.questions || []).filter((q) => !q.field || !(q.field in known));
      addTurn({ role: 'chatbox', accepted, skipped: res.data.skipped || [], questions });

      const numbers = accepted.filter(([, e]) => e.read_back).map(([f, e]) => `${label(t, f)} ${e.value}`);
      say([...numbers, ...questions.map((q) => q.question)].join('. '));
    } catch (err) {
      addTurn({
        role: 'chatbox',
        problem: err.response?.status === 404
          ? t('chatbox.off', 'Voice intake is not switched on for this clinic yet.')
          : t('chatbox.failed', 'The reader could not be reached. Type the details into the form instead.')
      });
    } finally {
      setBusy(null);
    }
  };

  const sendTyped = () => {
    const text = draft;
    setDraft('');
    send(text, 'chat');
  };

  const startRecording = async () => {
    // The audio leaves the building for transcription, so nothing is recorded
    // until the assistant has said the patient agreed.
    if (!consent) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        releaseMicrophone();
        setBusy('transcribing');
        const form = new FormData();
        form.append('audio', new Blob(chunksRef.current, { type: 'audio/webm' }), 'speech.webm');
        form.append('language', language);
        try {
          const res = await api.post('/voice/transcribe', form, { headers: { 'Content-Type': 'multipart/form-data' } });
          const heard = res.data?.transcript?.trim();
          if (!heard) {
            setBusy(null);
            addTurn({ role: 'chatbox', problem: res.data?.reason || t('chatbox.nothingHeard', 'Nothing was heard. Try again, closer to the microphone — or type it.') });
            return;
          }
          await send(heard, 'voice');
        } catch {
          setBusy(null);
          addTurn({ role: 'chatbox', problem: t('chatbox.transcribeFailed', 'The recording could not be sent. Type it instead.') });
        }
      };
      recorder.start();
      setRecording(true);
    } catch {
      addTurn({ role: 'chatbox', problem: t('chatbox.noMic', 'The microphone could not be opened. Check the browser permission, or type instead.') });
    }
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    setRecording(false);
  };

  const apply = () => {
    const values = { vitals: {} };
    const via = {};
    const unusable = [];
    for (const [field, entry] of Object.entries(session)) {
      if (VITALS_TO_FORM[field]) {
        values.vitals[VITALS_TO_FORM[field]] = String(entry.value);
        via[VITALS_TO_FORM[field]] = entry.via;
      } else if (TEXT_TO_FORM[field]) {
        values[field] = entry.value;
        via[field] = entry.via;
      } else {
        unusable.push(field);
      }
    }
    onApply(values, unusable, via);
    onClose();
  };

  const drafted = Object.entries(session);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
      <div className="bg-surface-raised w-full sm:max-w-lg rounded-t-card sm:rounded-card shadow-overlay h-[92vh] sm:h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-3 border-b border-line flex items-center gap-3">
          <MessageSquare className="w-4 h-4 text-gov-600" />
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-ink">{t('chatbox.chatTitle', 'CHATBOX — speak or type the intake')}</h3>
            <p className="text-[11px] text-ink-muted">
              {t('chatbox.chatSubtitle', 'One message at a time, in any order. Nothing reaches the form until you apply it.')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setMuted((m) => !m); stopSpeaking(); }}
            aria-label={muted ? t('chatbox.unmute', 'Speak automatically') : t('chatbox.mute', 'Stop speaking')}
            className="ml-auto p-1.5 rounded-field hover:bg-surface-sunken"
          >
            {muted ? <VolumeX className="w-4 h-4 text-ink-muted" /> : <Volume2 className="w-4 h-4 text-gov-600" />}
          </button>
          <button type="button" onClick={onClose} aria-label={t('action.close', 'Close')} className="p-1.5 rounded-field hover:bg-surface-sunken">
            <X className="w-4 h-4 text-ink-muted" />
          </button>
        </div>

        {/* The conversation */}
        <div ref={threadRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-surface-sunken/40">
          {turns.length === 0 && (
            <div className="text-center text-xs text-ink-muted px-6 py-8">
              <p className="font-semibold text-ink">{t('chatbox.emptyTitle', 'Tell it what you know, however it comes')}</p>
              <p className="mt-2">
                {t('chatbox.emptyExample', 'For example: “fever for three days, BP 140 over 90, pulse 96, known diabetic on metformin”. Hindi, Marathi and other languages work too.')}
              </p>
            </div>
          )}

          {turns.map((turn) => (turn.role === 'you' ? (
            <div key={turn.id} className="flex justify-end">
              <div className="max-w-[85%] bg-gov-600 text-white rounded-card rounded-br-sm px-3 py-2 text-xs leading-relaxed">
                <p className="text-[10px] uppercase tracking-wider opacity-75 mb-0.5 flex items-center gap-1">
                  {turn.via === 'voice' ? <Mic className="w-3 h-3" /> : <MessageSquare className="w-3 h-3" />}
                  {turn.via === 'voice' ? t('chatbox.youSaid', 'You said') : t('chatbox.youTyped', 'You typed')}
                </p>
                {turn.text}
              </div>
            </div>
          ) : (
            <div key={turn.id} className="flex justify-start">
              <div className="max-w-[90%] bg-surface-raised border border-line rounded-card rounded-bl-sm px-3 py-2 text-xs text-ink space-y-2">
                {turn.problem && (
                  <p role="alert" className="text-tier-emergency flex items-start gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {turn.problem}
                  </p>
                )}
                {turn.accepted?.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-ink-muted mb-1">{t('chatbox.understood', 'Understood — check every number')}</p>
                    <ul className="space-y-0.5">
                      {turn.accepted.map(([field, entry]) => (
                        <li key={field} className="flex items-center gap-2">
                          <CheckCircle2 className="w-3 h-3 text-gov-600 shrink-0" />
                          <span className="text-ink-muted">{label(t, field)}</span>
                          <span className="ml-auto font-semibold tabular-nums">{display(t, field, entry.value)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {turn.accepted?.length === 0 && !turn.problem && (
                  <p className="text-ink-muted">{t('chatbox.nothingUsable', 'Nothing in that could be used. Say it another way, or type it.')}</p>
                )}
                {turn.skipped?.length > 0 && (
                  <ul className="text-[11px] text-ink-muted space-y-0.5">
                    {turn.skipped.map((s, i) => (
                      <li key={`${s.field}-${i}`}>
                        <span className="text-ink">{label(t, s.field)}</span>{' — '}
                        {s.reason === 'typed' && t('chatbox.r.typed', 'you already entered a value, which is kept')}
                        {s.reason === 'implausible' && t('chatbox.r.implausible', 'that reading is outside the possible range')}
                        {s.reason === 'incomplete' && t('chatbox.r.incomplete', 'half a blood pressure is not a reading')}
                      </li>
                    ))}
                  </ul>
                )}
                {turn.questions?.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-ink-muted mb-1">{t('chatbox.stillNeeded', 'Still worth asking')}</p>
                    <ul className="list-disc pl-4 space-y-0.5 text-ink-muted">
                      {turn.questions.map((q, i) => <li key={i}>{q.question}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )))}

          {busy && (
            <p className="text-xs text-ink-muted flex items-center gap-2 px-1">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {busy === 'transcribing' ? t('chatbox.transcribing', 'Listening back…') : t('chatbox.reading', 'Sorting it into fields…')}
            </p>
          )}
        </div>

        {/* The draft so far, and applying it */}
        {drafted.length > 0 && (
          <div className="px-4 py-2 border-t border-line bg-surface-raised flex items-center gap-2">
            <p className="text-[11px] text-ink-muted min-w-0 truncate">
              {t('chatbox.draftCount', '{count} value(s) ready: {fields}', {
                count: drafted.length,
                fields: drafted.map(([f]) => label(t, f)).join(', ')
              })}
            </p>
            <button
              type="button"
              onClick={() => setSession({})}
              aria-label={t('chatbox.startOver', 'Start over')}
              className="ml-auto p-1.5 rounded-field hover:bg-surface-sunken shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5 text-ink-muted" />
            </button>
            <button
              type="button"
              onClick={apply}
              className="shrink-0 px-3 py-1.5 rounded-field bg-gov-600 hover:bg-gov-700 text-white text-xs font-semibold"
            >
              {t('chatbox.applyDraft', 'Put into the form')}
            </button>
          </div>
        )}

        {/* Input: type, or hold the mic. Consent gates the microphone only. */}
        <div className="px-4 py-3 border-t border-line bg-surface-raised space-y-2">
          {!consent && (
            <label className="flex items-start gap-2 text-[11px] text-ink-muted cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => { if (e.target.checked) onConsent?.(); }} />
              <span>
                {t('chatbox.consentMic', 'To use the microphone: the recording is sent for transcription and not stored. I have told the patient, and they agree to be recorded.')}
              </span>
            </label>
          )}
          <div className="flex items-end gap-2">
            <textarea
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendTyped(); }
              }}
              disabled={recording || busy === 'transcribing'}
              placeholder={t('chatbox.typeHere', 'Type what the patient told you…')}
              className="flex-1 resize-none max-h-28 bg-surface-raised border border-line-strong rounded-field px-3 py-2 text-xs text-ink focus:border-gov-500 outline-none"
            />
            <button
              type="button"
              onClick={recording ? stopRecording : startRecording}
              disabled={!consent || Boolean(busy)}
              title={!consent ? t('chatbox.micNeedsConsent', 'Tick the consent line to use the microphone') : undefined}
              aria-label={recording ? t('chatbox.stop', 'Stop and read it') : t('chatbox.speak', 'Speak')}
              className={`p-2.5 rounded-field shrink-0 transition-colors disabled:opacity-40 ${
                recording ? 'bg-tier-emergency text-white animate-pulse' : 'bg-surface-sunken text-gov-700 hover:bg-gov-50'
              }`}
            >
              {recording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={sendTyped}
              disabled={!draft.trim() || Boolean(busy) || recording}
              aria-label={t('chatbox.send', 'Send')}
              className="p-2.5 rounded-field bg-gov-600 text-white shrink-0 hover:bg-gov-700 disabled:opacity-40"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
