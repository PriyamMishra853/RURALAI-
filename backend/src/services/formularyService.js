import { FORMULARY, SIGNATURE_STATUS } from '../data/formulary.js';

/**
 * Formulary rules engine — the only source of medication in this system.
 *
 * Plan §D.2: medicine is never model-authored. A language model producing a
 * plausible-sounding dose is the highest-consequence failure mode in the
 * platform, because a plausible dose is exactly the kind a health worker acts
 * on. So medication is selected here, deterministically, from a reviewed list,
 * and every emitted record carries the `rule_source_id` of the entry it came
 * from.
 *
 * `assertRuleSourced()` is the application-layer stand-in for the database
 * constraint the plan calls for (`care_plan_medications.rule_source_id NOT
 * NULL`). It stays once the constraint exists — the database is the guarantee,
 * this is the early, loud failure.
 */

/**
 * When true, unsigned entries are never emitted. Defaults to on in production:
 * a demo may show the mechanism working against placeholder data, but a
 * deployment must not hand a patient a dose no clinician approved.
 */
const requireSignedFormulary = () =>
  process.env.REQUIRE_SIGNED_FORMULARY === 'true' ||
  (process.env.NODE_ENV === 'production' && process.env.REQUIRE_SIGNED_FORMULARY !== 'false');

const UNSIGNED_NOTICE =
  'UNSIGNED PLACEHOLDER — not reviewed by a registered medical practitioner. Not for clinical use.';

const normalise = (text) => (text || '').toLowerCase();

const matchesAny = (haystack, needles = []) =>
  needles.some((n) => haystack.includes(normalise(n)));

/** Pick the dose band covering this age. Returns null when age is unknown. */
const bandForAge = (entry, ageYears) => {
  if (ageYears === null || ageYears === undefined) return null;
  return (
    entry.doseBands.find((b) => ageYears >= b.minAgeYears && ageYears < b.maxAgeYears) || null
  );
};

const resolveAgeYears = (patient = {}) => {
  const years = Number(patient.age ?? patient.age_years);
  if (Number.isFinite(years)) return years;
  const months = Number(patient.age_months);
  if (Number.isFinite(months)) return months / 12;
  return null;
};

/**
 * Select medication for a case.
 *
 * Returns `{ medications, suppressed, notices }`. `medications` is empty
 * whenever any gate fails — an empty list is a valid, safe answer and the
 * caller must render it as "no medication suggested", never fall back to
 * something else.
 *
 * @param {object} input
 * @param {'LOW'|'MEDIUM'|'HIGH'} input.tier   Final triage tier.
 * @param {object} input.patient               { age | age_months, weight_kg, is_pregnant }
 * @param {string} input.symptoms
 * @param {string} input.history
 * @param {string} input.allergies
 */
export const selectMedications = ({
  tier,
  patient = {},
  symptoms = '',
  history = '',
  allergies = ''
} = {}) => {
  const notices = [];
  const suppressed = [];

  // ---- Gate 1: tier. Only LOW cases ever receive medication. ----
  // MEDIUM goes to a doctor-issued prescription over video; HIGH goes to
  // referral and receives no medicine at all.
  if (tier !== 'LOW') {
    return {
      medications: [],
      suppressed: [
        {
          reason:
            tier === 'HIGH'
              ? 'HIGH-risk case: no medication is suggested. Arrange referral.'
              : 'MEDIUM-risk case: medication is issued by the doctor during consultation.'
        }
      ],
      notices
    };
  }

  // ---- Gate 2: signature. ----
  const anyUnsigned = FORMULARY.some((e) => e.signature.status !== SIGNATURE_STATUS.SIGNED);
  if (anyUnsigned && requireSignedFormulary()) {
    return {
      medications: [],
      suppressed: [
        {
          reason:
            'The formulary has not been signed by a registered medical practitioner, so no medication can be suggested. This is a configuration state, not a clinical finding.'
        }
      ],
      notices: [UNSIGNED_NOTICE]
    };
  }
  if (anyUnsigned) notices.push(UNSIGNED_NOTICE);

  const symptomText = normalise(symptoms);
  const historyText = normalise(history);
  const allergyText = normalise(allergies);
  const ageYears = resolveAgeYears(patient);
  const weightKg = Number(patient.weight_kg);
  const isPregnant = patient.is_pregnant === true;

  const medications = [];

  for (const entry of FORMULARY) {
    const skip = (reason) => suppressed.push({ drug: entry.drug, rule_source_id: entry.id, reason });

    if (!matchesAny(symptomText, entry.indications)) continue;

    // ---- Gate 3: red-flag exclusions, checked against symptoms and history ----
    const redFlag = entry.redFlagExclusions.find(
      (f) => symptomText.includes(normalise(f)) || historyText.includes(normalise(f))
    );
    if (redFlag) {
      skip(`Excluded: "${redFlag}" is a red flag for this medicine. Escalate instead.`);
      continue;
    }

    // ---- Gate 4: contraindications ----
    const contra = entry.contraindications.find((c) => historyText.includes(normalise(c)));
    if (contra) {
      skip(`Excluded: patient history records "${contra}".`);
      continue;
    }

    // ---- Gate 5: allergies ----
    const allergy = entry.allergyKeys.find((a) => allergyText.includes(normalise(a)));
    if (allergy) {
      skip(`Excluded: recorded allergy to "${allergy}".`);
      continue;
    }

    // ---- Gate 6: pregnancy ----
    if (isPregnant && !entry.pregnancySafe) {
      skip('Excluded: not established as safe in pregnancy. Doctor review required.');
      continue;
    }

    // ---- Gate 7: age band ----
    // Unknown age is a suppression, not a default to the adult dose. Guessing
    // an adult dose for a child is how a paediatric overdose happens.
    const band = bandForAge(entry, ageYears);
    if (!band) {
      skip('Excluded: patient age is not recorded, so no dose band applies.');
      continue;
    }
    if (band.blocked) {
      skip(`Excluded: ${band.blockReason}`);
      continue;
    }

    // ---- Gate 8: weight-based dosing needs a weight ----
    if (band.requiresWeight && !Number.isFinite(weightKg)) {
      skip('Excluded: this dose is calculated per kilogram and no body weight is recorded.');
      continue;
    }

    medications.push({
      rule_source_id: entry.id,
      drug: entry.drug,
      form: entry.form,
      route: entry.route,
      dose:
        band.requiresWeight && Number.isFinite(weightKg)
          ? `${band.dose} (patient weight ${weightKg} kg)`
          : band.dose,
      frequency: band.frequency,
      max_duration_days: band.maxDurationDays,
      source: entry.source,
      signature_status: entry.signature.status,
      requires_doctor_approval: true
    });
  }

  return { medications, suppressed, notices };
};

/**
 * Reject any medication that did not come from a formulary rule.
 *
 * Called before persisting or returning a care plan. If a model-authored line
 * ever reaches this point, failing loudly here is much better than shipping it.
 */
export const assertRuleSourced = (medications = []) => {
  const orphan = medications.find((m) => !m.rule_source_id);
  if (orphan) {
    throw new Error(
      `Refusing to emit medication without a rule_source_id: ${JSON.stringify(orphan)}. ` +
        'Medication must come from the formulary rules engine, never from a model.'
    );
  }
  return medications;
};

/**
 * Render a medication record as the single line an assistant reads.
 * Kept here so the wording of the approval caveat cannot drift between callers.
 */
export const formatMedicationLine = (m) => {
  const parts = [`${m.drug} (${m.form}) — ${m.dose}`];
  if (m.frequency) parts.push(m.frequency);
  if (m.max_duration_days) parts.push(`maximum ${m.max_duration_days} days`);
  const line = `${parts.join('. ')} — subject to doctor approval`;
  return m.signature_status === SIGNATURE_STATUS.SIGNED ? line : `[${UNSIGNED_NOTICE}] ${line}`;
};
