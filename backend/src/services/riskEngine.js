/**
 * Clinical Risk Engine & Protocol Safety Classifier
 *
 * Categorizes every case as LOW, MEDIUM, or HIGH.
 * HIGH cases with life-threatening red flags additionally carry
 * immediateReferral: true (ambulance / district-hospital escalation).
 * This rule engine always overrides the LLM's own risk output.
 *
 * Three invariants this file is solely responsible for
 * (docs/PHASE1_PRODUCTION_READINESS_PLAN.md §D.6):
 *
 *   1. Escalation is monotonic. A rule may raise a tier and can never lower one.
 *   2. Missing data escalates. Absence of evidence is not evidence of absence —
 *      a case with no vitals recorded is an unassessed case, not a well patient.
 *   3. LOW is earned, never defaulted. It requires the core vitals to be both
 *      present and in range.
 */

export const TIER_RANK = { LOW: 0, MEDIUM: 1, HIGH: 2 };

/** Returns whichever of the two tiers is higher. Never lowers. */
export const higherTier = (current, candidate) =>
  TIER_RANK[candidate] > TIER_RANK[current] ? candidate : current;

/**
 * Parse a vital sign into a number.
 *
 * Returns null for absent or unparseable values so that a genuine reading of
 * zero is never confused with "not recorded". The previous `if (spo2)` guards
 * skipped both cases identically, which meant an SpO2 of 0 — a device fault or
 * a peri-arrest patient — silently passed every red-flag check.
 */
const toNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * Normalise a temperature to Fahrenheit.
 *
 * Every threshold in this file is in °F, but assistants and devices report in
 * either scale. An unconverted 39 °C reads as 39 °F, which is below every
 * threshold — a high fever would have triaged LOW. Human body temperatures in
 * °C never reach 45 and in °F never fall below 80, so the scales cannot be
 * confused in any survivable range.
 */
const toFahrenheit = (raw) => {
  const n = toNumber(raw);
  if (n === null) return { value: null, converted: false };
  if (n < 45) return { value: (n * 9) / 5 + 32, converted: true };
  return { value: n, converted: false };
};

/** Age in years, or null when not recorded. Accepts months for infants. */
const resolveAgeYears = (patient = {}) => {
  const years = toNumber(patient.age ?? patient.age_years);
  if (years !== null) return years;
  const months = toNumber(patient.age_months);
  if (months !== null) return months / 12;
  return null;
};

const RED_FLAG_SYMPTOMS = [
  'chest pain',
  'unconscious',
  'severe shortness of breath',
  'heavy bleeding',
  'seizure',
  'stiff neck',
  'altered sensorium'
];

/**
 * `ruleTier` mirrors `riskLevel` under the name the assessment pipeline uses
 * when combining this with the model's tier. `riskLevel` is unchanged so
 * existing callers keep working.
 */
const buildResult = ({ riskLevel, riskReasoning, warnings, missingData, requiresDoctor, immediateReferral }) => ({
  riskLevel,
  ruleTier: riskLevel,
  riskReasoning,
  warnings,
  missingData,
  requiresDoctor,
  immediateReferral
});

/**
 * @param {object} vitals
 * @param {string} symptoms
 * @param {string} history
 * @param {object} [patient]  { age } — enables the age-banded paediatric rules.
 */
export const calculateRiskLevel = (vitals = {}, symptoms = '', history = '', patient = {}) => {
  const warnings = [];
  const missingData = [];
  let riskLevel = 'LOW';
  let immediateReferral = false;

  const escalate = (tier, message) => {
    riskLevel = higherTier(riskLevel, tier);
    if (message) warnings.push(message);
  };

  const { value: temp, converted: tempConverted } = toFahrenheit(
    vitals.temperature ?? vitals.temperature_fahrenheit ?? vitals.temperature_celsius
  );
  const spo2 = toNumber(vitals.spo2 ?? vitals.oxygen_saturation);
  const sysBP = toNumber(vitals.blood_pressure_systolic ?? vitals.systolic_bp);
  const pulse = toNumber(vitals.pulse ?? vitals.pulse_bpm);
  const respRate = toNumber(vitals.respiratory_rate);
  const ageYears = resolveAgeYears(patient);

  if (tempConverted) {
    warnings.push(`Temperature was recorded in Celsius and converted to ${temp.toFixed(1)}°F for triage.`);
  }

  const symLower = (symptoms || '').toLowerCase();
  const histLower = (history || '').toLowerCase();

  // ---- HIGH RISK: life-threatening red flags (immediate referral) ----
  if (spo2 !== null && spo2 < 90) {
    immediateReferral = true;
    escalate('HIGH', `CRITICAL: Oxygen saturation (SpO2) ${spo2}% is below 90% — severe hypoxemia.`);
  }
  if (sysBP !== null && sysBP < 90) {
    immediateReferral = true;
    escalate('HIGH', 'CRITICAL: Systolic blood pressure below 90 mmHg indicates possible shock.');
  } else if (sysBP !== null && sysBP >= 180) {
    immediateReferral = true;
    escalate('HIGH', 'CRITICAL: Systolic blood pressure 180 mmHg or above indicates hypertensive crisis.');
  }

  const matchedRedFlags = RED_FLAG_SYMPTOMS.filter((s) => symLower.includes(s));
  if (matchedRedFlags.length > 0) {
    immediateReferral = true;
    escalate('HIGH', `CRITICAL: Red-flag symptom reported (${matchedRedFlags.join(', ')}).`);
  }

  // Any fever in an infant under 2 months is an emergency under IMNCI, however
  // well the child otherwise appears.
  if (ageYears !== null && ageYears < 2 / 12 && temp !== null && temp >= 100.4) {
    immediateReferral = true;
    escalate('HIGH', 'CRITICAL: Fever in an infant under 2 months requires immediate referral (IMNCI).');
  }

  if (immediateReferral) {
    return buildResult({
      riskLevel: 'HIGH',
      riskReasoning:
        'Life-threatening red flags detected. Stop protocol care, alert the doctor immediately, and arrange emergency hospital referral.',
      warnings,
      missingData,
      requiresDoctor: true,
      immediateReferral: true
    });
  }

  // ---- HIGH RISK: serious but not immediately life-threatening ----
  if (spo2 !== null && spo2 >= 90 && spo2 < 94) {
    escalate('HIGH', `Oxygen saturation is low (${spo2}%). Doctor review required urgently.`);
  }
  if (respRate !== null && (respRate > 30 || respRate < 8)) {
    escalate('HIGH', `Abnormal respiratory rate recorded: ${respRate}/min.`);
  }
  if (temp !== null && temp >= 103.5) {
    escalate('HIGH', `Very high body temperature recorded: ${temp.toFixed(1)}°F.`);
  }

  // ---- MEDIUM RISK ----
  if (temp !== null && temp > 101.5) {
    escalate('MEDIUM', `High body temperature recorded: ${temp.toFixed(1)}°F.`);
  }
  if (pulse !== null && (pulse > 110 || pulse < 50)) {
    escalate('MEDIUM', `Abnormal pulse rate recorded: ${pulse} bpm.`);
  }
  if (symLower.includes('fever') && (symLower.includes('cough') || symLower.includes('vomiting'))) {
    escalate('MEDIUM', 'Multiple concurrent symptoms (fever with respiratory or gastrointestinal involvement).');
  }
  if (/diabetes|hypertension|heart|copd|asthma/.test(histLower)) {
    escalate('MEDIUM', 'Chronic comorbidity in history raises baseline risk — doctor review advised.');
  }

  // ---- Invariant 2: missing data escalates ----
  //
  // A case cannot be cleared as LOW on vitals nobody measured. Each absent core
  // vital is named so the assistant knows exactly what to go back and capture,
  // and the tier is floored at MEDIUM so a doctor sees the case either way.
  if (spo2 === null) missingData.push('SpO2 not recorded');
  if (temp === null) missingData.push('Temperature not recorded');
  if (sysBP === null) missingData.push('Blood pressure not recorded');
  if (pulse === null) missingData.push('Pulse not recorded');
  if (ageYears === null) missingData.push('Patient age not recorded');

  if (missingData.length > 0) {
    escalate(
      'MEDIUM',
      `Triage is incomplete — ${missingData.join(', ')}. Absent readings cannot be treated as normal readings.`
    );
  }

  if (riskLevel === 'HIGH') {
    return buildResult({
      riskLevel,
      riskReasoning: `Serious warning indicators present — urgent doctor evaluation required. ${warnings.join(' ')}`,
      warnings,
      missingData,
      requiresDoctor: true,
      immediateReferral: false
    });
  }

  if (riskLevel === 'MEDIUM') {
    return buildResult({
      riskLevel,
      riskReasoning: `Case requires professional doctor evaluation. Warning indicators: ${warnings.join(' ')}`,
      warnings,
      missingData,
      requiresDoctor: true,
      immediateReferral: false
    });
  }

  // ---- LOW RISK: reached only with all core vitals present and in range ----
  return buildResult({
    riskLevel: 'LOW',
    riskReasoning:
      'All core vitals recorded and within standard physiological ranges. Eligible for approved first-aid protocol guidance; doctor consultation available on request.',
    warnings: warnings.length ? warnings : ['Monitor the patient for any developing red-flag symptoms.'],
    missingData,
    requiresDoctor: false,
    immediateReferral: false
  });
};
