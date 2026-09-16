/**
 * Where each intake value came from, and when the intake started.
 *
 * Two things the platform could not say before this, both found in production
 * data rather than guessed:
 *
 *   · Every pre-filled vital is stored as though it were measured. The form
 *     opens at 98.6 °F / 120/80 / 78 bpm, and an assistant who never touches
 *     those fields saves them into visit_vitals indistinguishable from a
 *     reading taken off a patient. A model trained on that learns the defaults.
 *
 *   · `intake_minutes` measured the wrong interval. The visit row is created
 *     lazily, at the first assessment or document upload, so "visit created ->
 *     first assessment" was a median of 11 seconds on real visits — the gap
 *     between two API calls. The CHATBOX exists to beat intake time, and there
 *     was no intake time to beat.
 *
 * Sources:
 *   typed     entered by the assistant — typing a value is confirming it
 *   dictated  a verbatim transcript from the symptom microphone
 *   voice     proposed by the CHATBOX from speech, then applied
 *   default   the form's starting value. Unconfirmed unless a person said it
 *             was measured and correct — and then the record says exactly
 *             that, rather than pretending it was typed
 *
 * Only typing confirms by itself. For anything else the client must say whether
 * a person confirmed it (ground rule 2). It is stored as told: the server
 * cannot see a screen, and a recorded claim of confirmation is still a record
 * of who made it.
 */

export const PROVENANCE_VERSION = 1;
export const SOURCES = ['typed', 'dictated', 'voice', 'default'];
export const MODES = ['manual', 'voice_assisted'];

/** The form's keys are the UI's; the record uses the column names. */
const FIELD_ALIASES = { temperature: 'temperature_f', pulse: 'pulse_bpm', spo2: 'spo2_percent' };

export const FIELD_KEYS = [
  'symptoms', 'duration', 'medical_history', 'known_allergies',
  'temperature_f', 'blood_pressure_systolic', 'blood_pressure_diastolic',
  'pulse_bpm', 'spo2_percent', 'respiratory_rate', 'blood_glucose_mgdl',
  'weight', 'height'
];

// A form left open over lunch is not an intake that took three hours.
export const MAX_INTAKE_SECONDS = 4 * 60 * 60;
export const MAX_VOICE_SESSIONS = 50;

export const canonicalField = (key) => {
  const field = FIELD_ALIASES[key] || key;
  return FIELD_KEYS.includes(field) ? field : null;
};

const confirmedFor = (source, claimed) => {
  if (source === 'typed') return true;
  return claimed === true;
};

/**
 * Validate what the client reports. Unknown fields and sources are dropped,
 * never guessed at. Returns null when nothing usable remains.
 */
export const normaliseProvenance = (raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const input = raw.fields;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;

  const fields = {};
  for (const [key, entry] of Object.entries(input)) {
    const field = canonicalField(key);
    const source = typeof entry === 'string' ? entry : entry?.source;
    if (!field || !SOURCES.includes(source)) continue;
    fields[field] = { source, confirmed: confirmedFor(source, entry?.confirmed) };
  }

  const entries = Object.values(fields);
  if (!entries.length) return null;

  const count = (pred) => entries.filter(pred).length;
  const counts = {
    typed: count((f) => f.source === 'typed'),
    dictated: count((f) => f.source === 'dictated'),
    voice: count((f) => f.source === 'voice'),
    voice_confirmed: count((f) => f.source === 'voice' && f.confirmed),
    default: count((f) => f.source === 'default'),
    default_unconfirmed: count((f) => f.source === 'default' && !f.confirmed)
  };

  // Dictating the complaint is how the manual form has always worked, so it
  // stays in the manual baseline. Only the CHATBOX makes an intake voice-assisted.
  const mode = counts.voice > 0 ? 'voice_assisted' : 'manual';
  const sessions = Number.parseInt(raw.voice?.sessions, 10);

  return {
    v: PROVENANCE_VERSION,
    mode,
    fields,
    voice: mode === 'voice_assisted'
      ? {
          consent: raw.voice?.consent === true,
          sessions: Number.isFinite(sessions) ? Math.min(MAX_VOICE_SESSIONS, Math.max(1, sessions)) : 1
        }
      : null,
    counts
  };
};

/**
 * When the intake began, from how long the client says it has been running.
 *
 * Elapsed time rather than a timestamp: a clinic tablet's clock is whatever it
 * was last set to, and a monotonic duration is immune to that.
 */
export const intakeStartedAt = (elapsedSeconds, now = new Date()) => {
  if (elapsedSeconds === null || elapsedSeconds === undefined || elapsedSeconds === '') return null;
  const seconds = Number(elapsedSeconds);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_INTAKE_SECONDS) return null;
  return new Date(now.getTime() - Math.round(seconds) * 1000).toISOString();
};
