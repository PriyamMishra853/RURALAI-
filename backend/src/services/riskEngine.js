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

/**
 * Age-banded normal ranges for pulse and respiratory rate (PALS / WHO IMNCI).
 *
 * Every threshold in this file used to be an adult one, applied to every
 * patient. That is wrong in both directions and the errors are not symmetric:
 *
 *   - A healthy 6-month-old has a pulse of 130 and breathes 40 times a minute.
 *     Judged against the adult rules (>110, >30) every well infant in the
 *     district triages MEDIUM, which trains assistants to ignore the tier.
 *   - A 3-year-old in respiratory distress at 38/min is BELOW the adult
 *     ">30 is HIGH" line only by luck, and a 5-year-old with early shock at a
 *     pulse of 140 sits under nothing at all once the adult bands are gone.
 *
 * `rrSevereHigh` / `rrSevereLow` are the HIGH-tier thresholds, derived from
 * IMNCI severe-respiratory-distress cut-offs. The adult row keeps the original
 * 30 / 8 values exactly, so no adult case changes tier as a result of this
 * table — only children stop being judged by an adult's lungs.
 */
const VITAL_BANDS = [
  { maxAgeYears: 1 / 12, pulseLow: 100, pulseHigh: 180, rrLow: 30, rrHigh: 60, rrSevereHigh: 70, rrSevereLow: 20 },
  { maxAgeYears: 1,      pulseLow: 100, pulseHigh: 160, rrLow: 30, rrHigh: 53, rrSevereHigh: 60, rrSevereLow: 20 },
  { maxAgeYears: 3,      pulseLow:  90, pulseHigh: 150, rrLow: 22, rrHigh: 37, rrSevereHigh: 50, rrSevereLow: 15 },
  { maxAgeYears: 6,      pulseLow:  80, pulseHigh: 140, rrLow: 20, rrHigh: 28, rrSevereHigh: 50, rrSevereLow: 14 },
  { maxAgeYears: 12,     pulseLow:  70, pulseHigh: 120, rrLow: 18, rrHigh: 25, rrSevereHigh: 40, rrSevereLow: 12 },
  { maxAgeYears: 18,     pulseLow:  60, pulseHigh: 100, rrLow: 12, rrHigh: 20, rrSevereHigh: 35, rrSevereLow: 10 },
  { maxAgeYears: 130,    pulseLow:  50, pulseHigh: 110, rrLow:  8, rrHigh: 30, rrSevereHigh: 30, rrSevereLow: 8 }
];

const ADULT_BAND = VITAL_BANDS[VITAL_BANDS.length - 1];

/**
 * Unknown age falls back to the adult band. That is the conservative choice
 * here rather than a guess: a missing age already floors the case at MEDIUM
 * through the missing-data rule below, so the fallback can never clear a case.
 */
const bandForAge = (ageYears) => {
  if (ageYears === null) return ADULT_BAND;
  return VITAL_BANDS.find((b) => ageYears < b.maxAgeYears) || ADULT_BAND;
};

/**
 * Dehydration assessment (WHO IMNCI).
 *
 * This is the gap that let a five-year-old with two days of diarrhoea,
 * vomiting and a dry mouth triage LOW: the engine read pulse 110 against the
 * adult ">110" rule, missed by one beat, and cleared the case. Diarrhoeal
 * dehydration is a leading cause of under-five death in India and it is
 * recognised by a SYNDROME, not by any single vital sign crossing a line.
 *
 * Severe signs are assessed separately because they mean immediate referral,
 * not a doctor call.
 */
const DEHYDRATION_SIGNS = [
  'dry mouth', 'mouth dryness', 'dry tongue', 'sunken eyes', 'sunken eye',
  'no tears', 'skin pinch', 'reduced urine', 'less urine', 'low urine',
  'no urine', 'not passing urine', 'dark urine', 'very thirsty', 'thirst',
  'drinking eagerly', 'dry lips', 'muh sukhna'
];

const SEVERE_DEHYDRATION_SIGNS = [
  'lethargic', 'lethargy', 'unable to drink', 'not able to drink',
  'refusing feeds', 'refusing to drink', 'unconscious', 'drowsy',
  'sunken fontanelle', 'skin pinch goes back very slowly', 'no urine'
];

const FLUID_LOSS_TERMS = [
  'diarrhoea', 'diarrhea', 'loose motion', 'loose stool', 'dysentery',
  'vomiting', 'vomit', 'ulti', 'dast', 'cholera'
];

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

  // ---- Dehydration, severe (IMNCI Plan C — immediate referral) ----
  //
  // Checked before the immediateReferral gate below so a severely dehydrated
  // child leaves on the same path as any other emergency.
  const hasFluidLoss = FLUID_LOSS_TERMS.some((t) => symLower.includes(t));
  const severeSigns = SEVERE_DEHYDRATION_SIGNS.filter((s) => symLower.includes(s));

  if (hasFluidLoss && severeSigns.length > 0) {
    immediateReferral = true;
    escalate(
      'HIGH',
      `CRITICAL: Fluid loss with signs of severe dehydration (${severeSigns.join(', ')}). ` +
        'IMNCI Plan C — start fluids and refer urgently.'
    );
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
  const band = bandForAge(ageYears);
  if (respRate !== null && (respRate > band.rrSevereHigh || respRate < band.rrSevereLow)) {
    escalate('HIGH', `Severely abnormal respiratory rate for this age: ${respRate}/min.`);
  }
  if (temp !== null && temp >= 103.5) {
    escalate('HIGH', `Very high body temperature recorded: ${temp.toFixed(1)}°F.`);
  }

  // ---- MEDIUM RISK ----
  if (temp !== null && temp > 101.5) {
    escalate('MEDIUM', `High body temperature recorded: ${temp.toFixed(1)}°F.`);
  }

  // Age-banded, so a well infant is not flagged for a normal infant pulse and
  // a tachycardic child is no longer measured against an adult's ceiling.
  const { pulseLow, pulseHigh, rrLow, rrHigh } = band;
  const ageLabel = ageYears === null
    ? 'adult range (age not recorded)'
    : ageYears < 1
      ? `age ${Math.round(ageYears * 12)} month(s)`
      : `age ${Math.round(ageYears)}`;

  if (pulse !== null && (pulse > pulseHigh || pulse < pulseLow)) {
    escalate(
      'MEDIUM',
      `Pulse ${pulse} bpm is outside the expected ${pulseLow}–${pulseHigh} bpm for ${ageLabel}.`
    );
  }
  if (respRate !== null && (respRate > rrHigh || respRate < rrLow)) {
    escalate(
      'MEDIUM',
      `Respiratory rate ${respRate}/min is outside the expected ${rrLow}–${rrHigh}/min for ${ageLabel}.`
    );
  }

  // ---- Dehydration, some (IMNCI Plan B — supervised rehydration) ----
  //
  // Two signs is the IMNCI threshold for "some dehydration", which requires
  // supervised ORS rather than home care. One sign alone is non-specific — a
  // dry mouth on a hot day is not a clinical finding — so a single sign does
  // not escalate, but fluid loss in a child under five does, because that
  // group decompensates fastest and is where the mortality is.
  const dehydrationSigns = DEHYDRATION_SIGNS.filter((s) => symLower.includes(s));

  if (hasFluidLoss && dehydrationSigns.length >= 2) {
    escalate(
      'MEDIUM',
      `Fluid loss with dehydration signs (${dehydrationSigns.join(', ')}). ` +
        'IMNCI Plan B — supervised rehydration and doctor review.'
    );
  } else if (hasFluidLoss && ageYears !== null && ageYears < 5) {
    escalate(
      'MEDIUM',
      'Diarrhoea or vomiting in a child under five. This group dehydrates fastest — ' +
        'doctor review required even when the child currently looks well.'
    );
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
