/**
 * Range-check vitals before they reach the risk engine.
 *
 * A transposed digit produces a physiologically impossible value, and the
 * triage rules would treat it as a genuine red flag. Rejecting it here is the
 * difference between "re-enter the pulse" and a false emergency referral.
 *
 * This lived in visit.controller.js until the CHATBOX (Roadmap v3, F2) needed
 * the same check. A spoken "one forty over ninety" has to face exactly the
 * limits a typed 140/90 faces — a second copy of these ranges that drifted from
 * the first would mean voice intake accepting a number the form rejects, which
 * is the one difference between the two paths that would matter clinically. So
 * it moved here, where both can import it, and visit.controller.js re-exports
 * it so its own callers are unchanged.
 *
 * Deliberately free of any database or network dependency: it is the piece both
 * paths must agree on, so it must be testable on its own.
 */

/** Units the visits table will accept — see 04_visit_history.sql. */
export const DURATION_UNITS = ['days', 'months', 'years'];

export const validateVitalsRanges = (vitals) => {
  const errors = [];
  if (!vitals) return { isValid: true, errors: [], cleanVitals: {} };

  const num = (...candidates) => {
    for (const v of candidates) {
      if (v !== undefined && v !== null && v !== '') {
        const parsed = Number(v);
        if (!Number.isNaN(parsed)) return parsed;
      }
    }
    return null;
  };

  const check = (value, lo, hi, label, unit) => {
    if (value !== null && (value < lo || value > hi)) {
      errors.push(`${label} ${value}${unit} is outside the plausible range (${lo}-${hi}${unit}).`);
    }
    return value;
  };

  const temperature = check(num(vitals.temperature, vitals.temperature_f), 95, 107, 'Temperature', '°F');
  const systolic    = check(num(vitals.systolic_bp, vitals.blood_pressure_systolic), 50, 300, 'Systolic BP', ' mmHg');
  const diastolic   = check(num(vitals.diastolic_bp, vitals.blood_pressure_diastolic), 20, 200, 'Diastolic BP', ' mmHg');
  const pulse       = check(num(vitals.pulse_bpm, vitals.pulse), 20, 250, 'Pulse', ' bpm');
  const spo2        = check(num(vitals.spo2_percent, vitals.spo2, vitals.oxygen_saturation), 50, 100, 'SpO2', '%');
  const respiratory = check(num(vitals.respiratory_rate), 5, 80, 'Respiratory rate', '/min');
  const glucose     = check(num(vitals.blood_glucose_mgdl), 20, 800, 'Blood glucose', ' mg/dL');
  // Collected by the form since the beginning and dropped here until
  // migration 19 gave visit_vitals somewhere to put them.
  const weight      = check(num(vitals.weight_kg, vitals.weight), 0.5, 500, 'Weight', ' kg');
  const height      = check(num(vitals.height_cm, vitals.height), 20, 250, 'Height', ' cm');

  if (systolic !== null && diastolic !== null && diastolic >= systolic) {
    errors.push(`Diastolic BP (${diastolic}) must be lower than systolic (${systolic}). Check the reading.`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    cleanVitals: {
      temperature_f: temperature,
      blood_pressure_systolic: systolic,
      blood_pressure_diastolic: diastolic,
      pulse_bpm: pulse,
      spo2_percent: spo2,
      respiratory_rate: respiratory,
      blood_glucose_mgdl: glucose,
      // Omitted rather than sent as null, so a database still on migration 18
      // — where these columns do not exist — stores the rest as it always did.
      ...(weight !== null ? { weight_kg: weight } : {}),
      ...(height !== null ? { height_cm: height } : {})
    }
  };
};
