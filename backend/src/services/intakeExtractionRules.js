import { validateVitalsRanges, DURATION_UNITS } from './vitalsValidation.js';

/**
 * What the CHATBOX is allowed to fill, and what it must refuse to guess.
 *
 * Roadmap v3, F2. The assistant speaks; a model returns JSON; this module
 * decides what of it may touch the form. It holds no model call, no database
 * and no network, because it is the part that has to be right and therefore
 * the part that has to be testable on its own.
 *
 * ── The three rules everything here serves ─────────────────────────────────
 *
 * 1. NEVER INVENT. Silence, noise, or a phrase this module cannot parse fills
 *    nothing. A field left empty costs the assistant a moment of typing; a
 *    field filled with a plausible guess is a fabricated clinical observation
 *    with a health worker's name against it.
 *
 * 2. NEVER OVERWRITE WHAT A PERSON TYPED. The same rule already governs OCR.
 *    What the assistant typed wins, always, and a voice value that disagrees is
 *    reported as skipped rather than applied quietly.
 *
 * 3. EVERY NUMBER IS READ BACK. Vitals and durations are returned marked as
 *    needing confirmation. Nothing here marks a value confirmed — only a person
 *    can do that, from the form.
 *
 * The output is a proposal for the manual form, never a submission. The form
 * stays exactly as it is and remains the path of record.
 */

/** Vitals the form collects, in the database's own spelling. */
export const VITAL_KEYS = [
  'temperature_f',
  'blood_pressure_systolic',
  'blood_pressure_diastolic',
  'pulse_bpm',
  'spo2_percent',
  'respiratory_rate',
  'blood_glucose_mgdl'
];

/** Non-vital fields the form collects. Nothing outside this list is accepted. */
export const TEXT_FIELDS = [
  'chief_complaint',
  'symptoms',
  'medical_history',
  'known_allergies',
  'current_medications'
];

export const INTAKE_FIELDS = [...TEXT_FIELDS, 'symptom_duration_value', 'symptom_duration_unit', 'is_pregnant'];

/**
 * What the CHATBOX asks about when it is missing, in the order a person would.
 * Vitals are not here: an assistant may legitimately have taken none yet, and a
 * machine nagging for a blood pressure it cannot measure is noise.
 */
export const QUESTION_ORDER = [
  ['chief_complaint', 'What is the main problem the patient came with?'],
  ['symptom_duration_value', 'How long has this been going on?'],
  ['medical_history', 'Any known conditions, or is the history clear?'],
  ['current_medications', 'Is the patient taking any medicine at the moment?']
];

const WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fourty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100
};

/**
 * A number as it is actually said in a clinic.
 *
 * "140", "one forty", "one hundred forty" and "one hundred and forty" are the
 * same reading. The pair rule — a single digit followed by a tens word — is
 * what makes "one forty" mean 140 rather than 1 and 40; it is how blood
 * pressure is spoken aloud in Indian English, and without it the commonest
 * phrasing in the room parses to nonsense.
 *
 * Temperatures are read digit by digit — "one oh one point four" is 101.4 —
 * so "oh" is a zero and "point" starts the decimals. A run of bare digits is
 * only read as one number where the reading makes that unambiguous: with an
 * "oh" in it, or before "point". "two three days" stays unreadable; it is
 * "two or three days", and 23 would be an invented duration.
 *
 * The unit said after a number is ignored ("twenty eight per minute"); any
 * other word makes the whole phrase unreadable.
 *
 * Returns null for anything it cannot read. Null is a question, not a zero.
 */
const ZERO_WORDS = new Set(['oh', 'o']);
const UNIT_WORDS = /\b(per\s+min(ute)?|bpm|beats|breaths|percent|degrees?|fahrenheit|mmhg|mg\/dl|mg\s*per\s*dl)\b|%|°f?/g;

const digitWord = (w) => (ZERO_WORDS.has(w) ? 0 : (WORDS[w] !== undefined && WORDS[w] <= 9 ? WORDS[w] : null));

const parseDigitRun = (words) => {
  const digits = words.map(digitWord);
  if (digits.some((d) => d === null) || digits[0] === 0) return null;
  return Number(digits.join(''));
};

export const parseSpokenNumber = (input) => {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;

  const text = String(input).toLowerCase().replace(UNIT_WORDS, ' ').trim();
  if (!text) return null;

  const digits = text.match(/-?\d+(?:\.\d+)?/);
  if (digits) {
    const n = Number(digits[0]);
    return Number.isFinite(n) ? n : null;
  }

  // "ninety eight point six", "one oh one point four"
  const pointAt = text.split(/\s+/).indexOf('point');
  if (pointAt !== -1) {
    const [whole, fraction] = [text.split(/\s+/).slice(0, pointAt), text.split(/\s+/).slice(pointAt + 1)];
    if (!whole.length || !fraction.length || fraction.length > 2) return null;
    const decimals = fraction.map(digitWord);
    if (decimals.some((d) => d === null)) return null;
    const integer = parseSpokenNumber(whole.join(' '))
      ?? (whole.length >= 2 && whole.length <= 3 ? parseDigitRun(whole) : null);
    if (integer === null || !Number.isInteger(integer)) return null;
    return Number(`${integer}.${decimals.join('')}`);
  }

  const words = text.replace(/\band\b/g, ' ').split(/[\s-]+/).filter(Boolean);
  if (!words.length) return null;

  // "one oh one", "one oh four"
  if (words.some((w) => ZERO_WORDS.has(w))) {
    return words.length >= 2 && words.length <= 3 ? parseDigitRun(words) : null;
  }

  if (!words.every((w) => w in WORDS)) return null;

  const values = words.map((w) => WORDS[w]);

  if (values.length === 1) return values[0];

  // "one hundred forty", "two hundred"
  const hundredAt = values.indexOf(100);
  if (hundredAt === 1 && values[0] >= 1 && values[0] <= 9) {
    const rest = values.slice(2).reduce((sum, v) => sum + v, 0);
    return values[0] * 100 + rest;
  }

  // "one forty" → 140, "two ten" → 210
  if (values.length === 2 && values[0] >= 1 && values[0] <= 9 && values[1] >= 10) {
    return values[0] * 100 + values[1];
  }

  // "twenty five" → 25
  if (values.length === 2 && values[0] >= 20 && values[0] % 10 === 0 && values[1] < 10) {
    return values[0] + values[1];
  }

  // "one twenty five" → 125
  if (values.length === 3 && values[0] >= 1 && values[0] <= 9
      && values[1] >= 20 && values[1] % 10 === 0 && values[1] <= 90 && values[2] >= 1 && values[2] <= 9) {
    return values[0] * 100 + values[1] + values[2];
  }

  return null;
};

/**
 * "140/90", "140 over 90", "one forty by ninety" — all the same reading.
 * Anything with only one number in it is not a blood pressure and returns null:
 * a lone 140 could be a systolic, a glucose or a pulse, and choosing for the
 * assistant is exactly the guess rule 1 forbids.
 */
export const parseBloodPressure = (input) => {
  if (!input) return null;
  const text = String(input).toLowerCase().trim();

  const parts = text.split(/\s*(?:\/|over|by|bata|par)\s*/i).filter(Boolean);
  if (parts.length !== 2) return null;

  const systolic = parseSpokenNumber(parts[0]);
  const diastolic = parseSpokenNumber(parts[1]);
  if (systolic === null || diastolic === null) return null;

  return { blood_pressure_systolic: systolic, blood_pressure_diastolic: diastolic };
};

/**
 * "three days", "2 months", "one year" → the value and unit the visits table
 * stores. "A while", "since yesterday" and "a few days" return null: the column
 * takes a number, and inventing one to satisfy it would put a fabricated
 * duration in front of the triage rules.
 */
export const parseDuration = (input) => {
  if (!input) return null;
  const text = String(input).toLowerCase().trim();

  // The visits table stores days, months or years. A week is exactly seven
  // days, so "two weeks" is stored as 14 days rather than dropped.
  const weeks = /\bweeks?\b/.test(text);
  const unit = weeks ? 'days' : DURATION_UNITS.find((u) => text.includes(u.slice(0, -1)));
  if (!unit) return null;

  // The number is whatever comes right before the unit — "for three days back"
  // reads "three". It used to fall back to the first word, which read "two
  // three days" (two or three) as 2: a guess stored as a duration.
  const unitWord = weeks ? 'week' : unit.slice(0, -1);
  const unitAt = text.search(new RegExp(`\\b${unitWord}`));
  const before = (unitAt === -1 ? text : text.slice(0, unitAt)).replace(/^(since|for|from|last|past|the)\s+/, '').trim();
  const value = parseSpokenNumber(before);
  if (value === null) return null;

  const rounded = Math.round(value) * (weeks ? 7 : 1);
  if (!Number.isInteger(rounded) || rounded < 1 || rounded > 999) return null;

  return { symptom_duration_value: rounded, symptom_duration_unit: unit };
};

const cleanText = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  // A model asked for a field it did not hear tends to answer in one of these
  // rather than leaving it out. None of them is a clinical observation.
  if (/^(none|nil|n\/a|na|unknown|not mentioned|not stated|not specified|-)$/i.test(text)) return null;
  return text.slice(0, 2000);
};

/**
 * Turn whatever the model returned into the fields the form knows, discarding
 * everything else.
 *
 * A model that invents a key is ignored rather than trusted: free text never
 * becomes a vital sign, which is the failure this shape exists to make
 * impossible.
 */
export const normaliseExtraction = (raw) => {
  const out = { fields: {}, vitals: {}, dropped: [] };
  if (!raw || typeof raw !== 'object') return out;

  for (const key of TEXT_FIELDS) {
    const text = cleanText(raw[key]);
    if (text) out.fields[key] = text;
  }

  const duration = parseDuration(raw.symptom_duration ?? raw.duration)
    ?? (raw.symptom_duration_value !== undefined
      ? parseDuration(`${raw.symptom_duration_value} ${raw.symptom_duration_unit || ''}`)
      : null);
  if (duration) Object.assign(out.fields, duration);

  if (typeof raw.is_pregnant === 'boolean') out.fields.is_pregnant = raw.is_pregnant;

  const spokenBp = parseBloodPressure(raw.blood_pressure ?? raw.bp);
  if (spokenBp) Object.assign(out.vitals, spokenBp);

  const vitalsIn = { ...(raw.vitals && typeof raw.vitals === 'object' ? raw.vitals : {}), ...raw };
  for (const key of VITAL_KEYS) {
    if (out.vitals[key] !== undefined) continue;
    const n = parseSpokenNumber(vitalsIn[key]);
    if (n !== null) out.vitals[key] = n;
  }

  for (const key of Object.keys(raw)) {
    const known = INTAKE_FIELDS.includes(key) || VITAL_KEYS.includes(key)
      || ['vitals', 'blood_pressure', 'bp', 'symptom_duration', 'duration'].includes(key);
    if (!known) out.dropped.push(key);
  }

  return out;
};

/**
 * What the assistant is offered, given what they have already typed.
 *
 * Returns a proposal, never a change: `accept` is what the form may show as
 * voice-captured, `skipped` says which values were refused and why — an
 * impossible vital, or a field the person had already filled in — and
 * `questions` is what is still worth asking aloud.
 *
 * Every accepted value carries `source: 'voice'` and `confirmed: false`.
 * Nothing in this module can mark a value confirmed; that takes a person, in
 * the form, which is what makes the form the path of record.
 */
export const reconcileWithForm = ({ typed = {}, extracted = {} } = {}) => {
  const { fields, vitals, dropped } = normaliseExtraction(extracted);
  const accept = {};
  const skipped = [];

  const typedValue = (key) => {
    const v = typed?.[key] ?? typed?.vitals?.[key];
    return v === undefined || v === null || v === '' ? null : v;
  };

  for (const [key, value] of Object.entries(fields)) {
    if (typedValue(key) !== null) {
      skipped.push({ field: key, value, reason: 'typed' });
      continue;
    }
    accept[key] = { value, source: 'voice', confirmed: false };
  }

  /*
   * Each reading is checked on its own, so a refusal provably belongs to the
   * field it names.
   *
   * The first version of this matched the validator's English against field
   * names, and that is a trap: "blood_glucose_mgdl" and
   * "blood_pressure_systolic" both reduce to "blood", so one impossible
   * glucose would have thrown away a perfectly good blood pressure — while
   * "Systolic BP 400 mmHg" contains no "blood" at all and would have sailed
   * through. Same limits either way, since it is the same function the form
   * calls; only the granularity changed.
   */
  const vitalErrors = [];

  for (const key of VITAL_KEYS) {
    const spoken = vitals[key];
    if (spoken === undefined || spoken === null) continue;

    if (typedValue(key) !== null) {
      skipped.push({ field: key, value: spoken, reason: 'typed' });
      continue;
    }

    const { isValid, errors: fieldErrors, cleanVitals } = validateVitalsRanges({ [key]: spoken });
    if (!isValid) {
      skipped.push({ field: key, value: spoken, reason: 'implausible' });
      vitalErrors.push(...fieldErrors);
      continue;
    }

    accept[key] = { value: cleanVitals[key], source: 'voice', confirmed: false, read_back: true };
  }

  // Systolic below diastolic is the one rule that needs both numbers, so it is
  // checked once they are both in hand. Either the pair is offered or neither
  // is: half of a misheard blood pressure is not a reading.
  const systolic = accept.blood_pressure_systolic?.value;
  const diastolic = accept.blood_pressure_diastolic?.value;
  if (systolic !== undefined && diastolic !== undefined) {
    const { isValid, errors: pairErrors } = validateVitalsRanges({
      blood_pressure_systolic: systolic,
      blood_pressure_diastolic: diastolic
    });
    if (!isValid) {
      delete accept.blood_pressure_systolic;
      delete accept.blood_pressure_diastolic;
      skipped.push(
        { field: 'blood_pressure_systolic', value: systolic, reason: 'implausible' },
        { field: 'blood_pressure_diastolic', value: diastolic, reason: 'implausible' }
      );
      vitalErrors.push(...pairErrors);
    }
  }

  // The same principle where only one side was refused: a lone diastolic tells
  // a clinician nothing and invites them to read it as a pair that was never
  // taken, so it leaves with its partner.
  const BP_KEYS = ['blood_pressure_systolic', 'blood_pressure_diastolic'];
  const oneHalfRefused = BP_KEYS.some(
    (key) => skipped.some((s) => s.field === key && s.reason === 'implausible')
  );
  if (oneHalfRefused) {
    for (const key of BP_KEYS) {
      if (accept[key] === undefined) continue;
      skipped.push({ field: key, value: accept[key].value, reason: 'incomplete' });
      delete accept[key];
    }
  }

  const questions = [];
  for (const [key, question] of QUESTION_ORDER) {
    if (typedValue(key) === null && accept[key] === undefined) questions.push({ field: key, question });
  }
  for (const message of vitalErrors) questions.push({ field: null, question: `${message} Please say it again.` });

  return { accept, skipped, questions, dropped, vitalErrors };
};
