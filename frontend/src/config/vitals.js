/**
 * Vitals fields, with typical adult values pre-filled and hard limits enforced.
 *
 * `normal` is a starting point, not a measurement. An assistant recording a
 * healthy adult changes two or three boxes instead of six, which is the whole
 * point — but a value left untouched is still a value the triage engine will
 * act on, so the form tracks which fields the assistant actually confirmed and
 * warns before an assessment runs on defaults alone.
 *
 * `min`/`max` are the physiological limits used to reject a typo (a pulse of
 * 1300 from a stuck key). They are deliberately WIDER than the alerting range:
 * a genuine SpO2 of 68 must be enterable, because that is exactly the reading
 * that needs to reach a doctor fastest.
 *
 * Height and weight are excluded per the field spec — they are measured, not
 * defaulted, and vary far too much to guess.
 */

export const VITAL_FIELDS = [
  {
    key: 'temperature',
    label: 'Temperature',
    unit: '°F',
    normal: 98.6,
    min: 95,
    max: 107,
    step: 0.1,
    decimals: 1,
    // Outside these, the reading is plausible but clinically notable.
    alertBelow: 97,
    alertAbove: 100.4
  },
  {
    key: 'blood_pressure_systolic',
    label: 'Systolic BP',
    unit: 'mmHg',
    normal: 120,
    min: 50,
    max: 300,
    step: 1,
    alertBelow: 90,
    alertAbove: 140
  },
  {
    key: 'blood_pressure_diastolic',
    label: 'Diastolic BP',
    unit: 'mmHg',
    normal: 80,
    min: 20,
    max: 200,
    step: 1,
    alertBelow: 60,
    alertAbove: 90
  },
  {
    key: 'pulse',
    label: 'Pulse',
    unit: 'bpm',
    normal: 78,
    min: 20,
    max: 250,
    step: 1,
    alertBelow: 60,
    alertAbove: 100
  },
  {
    key: 'spo2',
    label: 'SpO₂',
    unit: '%',
    normal: 98,
    min: 50,
    max: 100,
    step: 1,
    alertBelow: 94,
    alertAbove: 101
  },
  {
    key: 'respiratory_rate',
    label: 'Respiratory rate',
    unit: '/min',
    normal: 16,
    min: 5,
    max: 80,
    step: 1,
    alertBelow: 12,
    alertAbove: 20
  }
];

/** Measured, never defaulted — left blank for the assistant to fill. */
export const MEASURED_FIELDS = [
  { key: 'weight', label: 'Weight', unit: 'kg', min: 0.5, max: 500, step: 0.1, decimals: 1 },
  { key: 'height', label: 'Height', unit: 'cm', min: 20, max: 250, step: 0.5, decimals: 1 }
];

/** Starting state: typical adult values for the six, blanks for the two. */
export const defaultVitals = () => {
  const v = {};
  for (const f of VITAL_FIELDS) v[f.key] = String(f.normal);
  for (const f of MEASURED_FIELDS) v[f.key] = '';
  return v;
};

const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

/** Hard-limit check for one field. Returns a message, or null. */
export const checkField = (field, value) => {
  const n = num(value);
  if (n === null) return null;
  if (Number.isNaN(n)) return `${field.label} must be a number.`;
  if (n < field.min || n > field.max) {
    return `${field.label} must be between ${field.min} and ${field.max} ${field.unit}.`;
  }
  return null;
};

/** Is this value plausible but clinically notable? Drives the amber highlight. */
export const isAbnormal = (field, value) => {
  const n = num(value);
  if (n === null || Number.isNaN(n)) return false;
  if (field.alertBelow !== undefined && n < field.alertBelow) return true;
  if (field.alertAbove !== undefined && n > field.alertAbove) return true;
  return false;
};

/** Whole-form validation. Returns { errors: {key: msg}, message } */
export const validateVitals = (vitals) => {
  const errors = {};
  for (const f of [...VITAL_FIELDS, ...MEASURED_FIELDS]) {
    const msg = checkField(f, vitals[f.key]);
    if (msg) errors[f.key] = msg;
  }

  const sys = num(vitals.blood_pressure_systolic);
  const dia = num(vitals.blood_pressure_diastolic);
  if (sys !== null && dia !== null && dia >= sys) {
    errors.blood_pressure_diastolic = 'Diastolic must be lower than systolic. Check the reading.';
  }

  const first = Object.values(errors)[0] || null;
  return { errors, message: first };
};
