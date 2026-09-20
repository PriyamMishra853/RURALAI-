import crypto from 'crypto';

/**
 * Turning verified cases into a training dataset (Roadmap v3, Phase 5 / doc 12 P0).
 *
 * This is the curation harness the learning system is not allowed to start
 * without, and it is mostly refusals:
 *
 *   · **Consent is the gate.** Only patients with an active `training` consent
 *     are in it. Treatment consent is not training consent (migration 21).
 *   · **A case with no doctor review is not a verified case.** The doctor's
 *     decision is the label; without one there is nothing to learn from, only
 *     an AI draft agreeing with itself.
 *   · **A value nobody confirmed is not a measurement.** The form opens at
 *     98.6 °F; an untouched default in a training set teaches the default.
 *   · **Nobody is identifiable.** No Aadhaar, no internal identifier, no name,
 *     no phone, no village line, no date of birth, no exact timestamps.
 *
 * Pure: the script does the reading and writing, these are the rules.
 */

export const RULES_VERSION = 'dataset-rules-v1';

/**
 * Age in bands, because a date of birth identifies a person in a village of
 * four hundred and an exact age very nearly does. The bands are the ones the
 * triage rules already treat differently.
 */
export const AGE_BANDS = [
  [0, 1, '0-1'], [1, 5, '1-4'], [5, 12, '5-11'], [12, 18, '12-17'],
  [18, 30, '18-29'], [30, 45, '30-44'], [45, 60, '45-59'], [60, 75, '60-74'], [75, 200, '75+']
];

export const ageBand = (years) => {
  // Number(null) is 0, which would band an unknown age as an infant.
  if (years === null || years === undefined || years === '') return null;
  const n = Number(years);
  if (!Number.isFinite(n) || n < 0) return null;
  return AGE_BANDS.find(([lo, hi]) => n >= lo && n < hi)?.[2] || null;
};

/**
 * A pseudonym that links a patient's cases inside one export and nowhere else.
 *
 * Salted with the dataset id, which changes per export, so two datasets cannot
 * be joined to rebuild a patient's history — and never derived from the
 * Aadhaar number, which is a 12-digit space anyone could enumerate.
 */
export const pseudonym = (patientUid, datasetId) =>
  crypto.createHash('sha256').update(`${datasetId}:${patientUid}`).digest('hex').slice(0, 16);

/** Which recorded values a person stands behind. Same rule as the FHIR export. */
export const confirmedVitals = (vitals, provenance) => {
  const fields = provenance?.fields;
  const out = {};
  for (const [key, value] of Object.entries(vitals || {})) {
    if (value === null || value === undefined || value === '' || key === 'recorded_at') continue;
    const entry = fields?.[key];
    if (!entry) continue;                                   // unknown capture: not evidence
    if (entry.source === 'default' && !entry.confirmed) continue;
    if (!entry.confirmed) continue;                         // heard but never checked
    out[key] = { value: Number(value), source: entry.source };
  }
  return out;
};

const diagnosisFrom = (review) => {
  const line = String(review?.clinical_notes || '').split('\n').find((l) => l.startsWith('Diagnosis:'));
  return line ? line.slice('Diagnosis:'.length).trim() : null;
};

/** Why a case is not in the dataset. Counted, so the manifest can be honest. */
export const EXCLUSIONS = ['no_training_consent', 'no_doctor_review', 'no_diagnosis', 'demo_data'];

export const excludeReason = ({ hasConsent, review, isDemo, includeDemo }) => {
  if (isDemo && !includeDemo) return 'demo_data';
  if (!hasConsent) return 'no_training_consent';
  if (!review) return 'no_doctor_review';
  if (!diagnosisFrom(review)) return 'no_diagnosis';
  return null;
};

/**
 * One case, de-identified. The month, not the day: a date plus a village is a
 * person, and nothing here needs to know which Tuesday it was.
 */
export const deidentifyCase = ({ visit, patient, vitals, provenance, review, datasetId }) => ({
  case_id: `${datasetId}-${crypto.createHash('sha256').update(visit.id).digest('hex').slice(0, 12)}`,
  patient_ref: pseudonym(patient.patient_uid, datasetId),
  month: String(visit.created_at).slice(0, 7),
  district: visit.district_name || null,
  state: visit.state_name || null,
  age_band: ageBand(patient.age_years),
  gender: patient.gender || 'unknown',
  is_pregnant: typeof visit.is_pregnant === 'boolean' ? visit.is_pregnant : null,
  presentation: {
    chief_complaint: visit.chief_complaint || null,
    duration_days: visit.symptom_duration_value && visit.symptom_duration_unit === 'days'
      ? Number(visit.symptom_duration_value) : null,
    medical_history: visit.medical_history || null,
    known_allergies: visit.known_allergies || null,
    current_medications: visit.current_medications || null
  },
  measurements: confirmedVitals(vitals, provenance),
  intake_mode: provenance?.mode || null,
  label: {
    diagnosis: diagnosisFrom(review),
    decision: review.decision,
    source: 'doctor_review'
  }
});

export const buildManifest = ({
  datasetId, generatedAt, windowDays, includeDemo, districtScope,
  purpose, approvedBy, counts, files, codeVersion
}) => ({
  dataset_id: datasetId,
  generated_at: generatedAt,
  rules_version: RULES_VERSION,
  code_version: codeVersion || null,
  // Recorded because someone has to own the decision to use patient data.
  purpose,
  approved_by: approvedBy,
  selection: {
    window_days: windowDays,
    district: districtScope || 'all',
    include_demo: includeDemo,
    requires: ['active training consent', 'a doctor review with a diagnosis']
  },
  de_identification: {
    removed: ['aadhaar_number', 'patient_uid', 'full_name', 'phone', 'village lines', 'date_of_birth', 'exact timestamps', 'staff identities'],
    generalised: { age: 'bands', date: 'month', location: 'district' },
    patient_ref: 'sha256(dataset_id + patient_uid), truncated — links cases within this dataset only'
  },
  measurements: 'Only values a person confirmed. Untouched form defaults and unchecked voice values are omitted.',
  counts,
  files
});

/** The datasheet that travels with the data, in the standard sections. */
export const datasheet = (manifest) => `# Datasheet — ${manifest.dataset_id}

Generated ${manifest.generated_at} by \`npm run dataset:export\` (${manifest.rules_version}).

## Motivation

Built to train and evaluate the triage and extraction models described in
Roadmap v3 F3. Stated purpose for this export: **${manifest.purpose}**.
Recorded approval: **${manifest.approved_by}**.

## Composition

${manifest.counts.cases} cases from ${manifest.counts.patients} patients, drawn from
the last ${manifest.selection.window_days} days${manifest.selection.district === 'all' ? '' : ` in district ${manifest.selection.district}`}.
Every case has an active **training** consent and a doctor's review carrying a
diagnosis. Demo data is ${manifest.selection.include_demo ? 'INCLUDED — this dataset is not clinical' : 'excluded'}.

Cases left out, and why: ${Object.entries(manifest.counts.excluded).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}.

A case holds: month, district, age band, gender, pregnancy where recorded, the
presentation as the assistant wrote it, the measurements a person confirmed,
how the intake was taken, and the doctor's diagnosis and decision as the label.

## Collection process

Recorded in the course of care by clinic assistants and reviewed by doctors on
the Rural Health Grid platform. Nothing was collected for this dataset; it is a
selection of records that already existed, made under a consent given
separately from consent to treatment.

## Preprocessing

${manifest.measurements} Identifiers removed: ${manifest.de_identification.removed.join(', ')}.
Generalised: age to ${manifest.de_identification.generalised.age}, dates to
${manifest.de_identification.generalised.date}, location to
${manifest.de_identification.generalised.location}. Patient reference:
${manifest.de_identification.patient_ref}.

## Uses

Suitable for model development and evaluation inside the learning plane. **Not**
suitable for identifying individuals, for re-contacting patients, or for any
purpose outside the stated one above.

## Known limitations

- The diagnosis is free text written by a doctor under time pressure, not a coded
  term. Expect synonyms, abbreviations and spelling variation.
- The label is one doctor's opinion, unadjudicated.
- Language coverage follows the clinics in scope, not the country.
- Small n makes any per-district slice unreliable; read the counts first.

## Distribution and maintenance

Stays inside the learning plane. Not to be published or shared outside it. A
later export supersedes this one; datasets are not edited in place.
`;
