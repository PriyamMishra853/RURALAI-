/**
 * ⚠️  UNSIGNED PLACEHOLDER FORMULARY — NOT APPROVED FOR CLINICAL USE ⚠️
 *
 * Plan §D.2. Medication suggestions may never be authored by a language model.
 * They come from this file, through the rules engine in
 * services/formularyService.js, and every emitted medication carries the
 * `rule_source_id` of the entry it came from.
 *
 * EVERY ENTRY BELOW IS `UNSIGNED_PLACEHOLDER`.
 *
 * The dose figures are the standard published values from the WHO Model List
 * of Essential Medicines and India's NLEM, restricted to items that are
 * genuinely over-the-counter. They have NOT been reviewed by a registered
 * medical practitioner for this deployment, this population, or this care
 * model, and until they have been they must not reach a patient.
 *
 * `formularyService` refuses to emit any unsigned entry when
 * REQUIRE_SIGNED_FORMULARY is on — which is the default in production.
 *
 * TO PUT THIS INTO REAL USE:
 *   1. A registered medical practitioner reviews every entry.
 *   2. They set `signature.status` to 'SIGNED', with their name, NMC
 *      registration number and the date.
 *   3. Any edit to an entry resets it to UNSIGNED_PLACEHOLDER. A formulary
 *      that can be edited after signing was never really signed.
 *
 * This is the single longest-lead-time item in the project (plan §J.5 #15) and
 * nothing technical substitutes for it.
 */

export const SIGNATURE_STATUS = {
  UNSIGNED: 'UNSIGNED_PLACEHOLDER',
  SIGNED: 'SIGNED'
};

const unsigned = {
  status: SIGNATURE_STATUS.UNSIGNED,
  signedBy: null,
  registrationNumber: null,
  signedAt: null
};

/**
 * Entries are matched on `indications` against the recorded symptom text.
 * `maxTier: 'LOW'` on every entry is not decoration — the engine refuses to
 * emit anything for a MEDIUM or HIGH case regardless of what matches.
 */
export const FORMULARY = [
  {
    id: 'FORM-ORS-001',
    drug: 'Oral Rehydration Solution (ORS)',
    form: 'Powder sachet for oral solution',
    route: 'Oral',
    indications: ['dehydration', 'diarrhoea', 'diarrhea', 'loose motion', 'vomiting'],
    maxTier: 'LOW',
    doseBands: [
      {
        minAgeYears: 0,
        maxAgeYears: 2,
        dose: '50–100 mL after each loose stool',
        frequency: 'After each loose stool',
        maxDurationDays: 3
      },
      {
        minAgeYears: 2,
        maxAgeYears: 10,
        dose: '100–200 mL after each loose stool',
        frequency: 'After each loose stool',
        maxDurationDays: 3
      },
      {
        minAgeYears: 10,
        maxAgeYears: 120,
        dose: '1 sachet dissolved in 1 litre of clean water, small frequent sips',
        frequency: 'As needed after each loose stool',
        maxDurationDays: 3
      }
    ],
    contraindications: ['bowel obstruction', 'unconscious', 'persistent vomiting'],
    allergyKeys: [],
    pregnancySafe: true,
    redFlagExclusions: ['blood in stool', 'severe dehydration', 'altered sensorium'],
    source: 'WHO EML / NLEM India — low-osmolarity ORS',
    signature: { ...unsigned }
  },
  {
    id: 'FORM-PCM-002',
    drug: 'Paracetamol (Acetaminophen)',
    form: 'Tablet / oral suspension',
    route: 'Oral',
    indications: ['fever', 'pain', 'headache', 'body ache', 'bodyache'],
    maxTier: 'LOW',
    doseBands: [
      {
        minAgeYears: 0,
        maxAgeYears: 0.25,
        dose: 'DO NOT ADMINISTER — refer to a doctor',
        frequency: null,
        maxDurationDays: 0,
        blocked: true,
        blockReason: 'Fever in an infant under 3 months requires medical assessment, not antipyretics.'
      },
      {
        minAgeYears: 0.25,
        maxAgeYears: 12,
        dose: '15 mg/kg body weight per dose',
        frequency: 'Every 6 hours, maximum 4 doses in 24 hours',
        maxDurationDays: 3,
        requiresWeight: true
      },
      {
        minAgeYears: 12,
        maxAgeYears: 120,
        dose: '500 mg per dose',
        frequency: 'Every 6 hours, maximum 3 doses in 24 hours',
        maxDurationDays: 3
      }
    ],
    contraindications: ['liver disease', 'hepatic impairment', 'jaundice', 'alcohol dependence'],
    allergyKeys: ['paracetamol', 'acetaminophen'],
    pregnancySafe: true,
    redFlagExclusions: ['stiff neck', 'altered sensorium', 'rash with fever'],
    source: 'WHO EML / NLEM India',
    signature: { ...unsigned }
  },
  {
    id: 'FORM-ZINC-003',
    drug: 'Zinc sulphate',
    form: 'Dispersible tablet',
    route: 'Oral',
    indications: ['diarrhoea', 'diarrhea', 'loose motion'],
    maxTier: 'LOW',
    doseBands: [
      {
        minAgeYears: 0,
        maxAgeYears: 0.5,
        dose: '10 mg once daily',
        frequency: 'Once daily',
        maxDurationDays: 14
      },
      {
        minAgeYears: 0.5,
        maxAgeYears: 5,
        dose: '20 mg once daily',
        frequency: 'Once daily',
        maxDurationDays: 14
      },
      {
        minAgeYears: 5,
        maxAgeYears: 120,
        dose: 'Not routinely indicated — doctor review',
        frequency: null,
        maxDurationDays: 0,
        blocked: true,
        blockReason: 'Zinc for diarrhoea is an IMNCI paediatric protocol; adults need doctor review.'
      }
    ],
    contraindications: [],
    allergyKeys: ['zinc'],
    pregnancySafe: true,
    redFlagExclusions: ['blood in stool', 'severe dehydration'],
    source: 'WHO/UNICEF IMNCI diarrhoea protocol',
    signature: { ...unsigned }
  },
  {
    id: 'FORM-SALINE-004',
    drug: 'Sodium chloride 0.9% nasal drops',
    form: 'Nasal drops',
    route: 'Nasal',
    indications: ['blocked nose', 'nasal congestion', 'runny nose', 'cold'],
    maxTier: 'LOW',
    doseBands: [
      {
        minAgeYears: 0,
        maxAgeYears: 120,
        dose: '1–2 drops in each nostril',
        frequency: 'Up to 4 times daily',
        maxDurationDays: 5
      }
    ],
    contraindications: ['nasal trauma', 'nasal surgery'],
    allergyKeys: [],
    pregnancySafe: true,
    redFlagExclusions: ['facial trauma', 'clear fluid from nose after head injury'],
    source: 'WHO EML — supportive care',
    signature: { ...unsigned }
  },
  {
    id: 'FORM-POVIDONE-005',
    drug: 'Povidone-iodine 5% solution',
    form: 'Topical solution',
    route: 'Topical',
    indications: ['minor wound', 'abrasion', 'graze', 'cut', 'small laceration'],
    maxTier: 'LOW',
    doseBands: [
      {
        minAgeYears: 2,
        maxAgeYears: 120,
        dose: 'Apply to cleaned wound surface, then cover with a sterile dressing',
        frequency: 'Once at dressing, then at each dressing change',
        maxDurationDays: 5
      },
      {
        minAgeYears: 0,
        maxAgeYears: 2,
        dose: 'DO NOT APPLY — refer to a doctor',
        frequency: null,
        maxDurationDays: 0,
        blocked: true,
        blockReason: 'Iodine absorption risk in infants; wound care under 2 years needs a doctor.'
      }
    ],
    contraindications: ['thyroid disorder', 'iodine sensitivity', 'deep wound', 'puncture wound'],
    allergyKeys: ['iodine', 'povidone'],
    pregnancySafe: false,
    redFlagExclusions: ['deep wound', 'heavy bleeding', 'embedded object', 'animal bite', 'burn'],
    source: 'WHO EML — antiseptic',
    signature: { ...unsigned }
  }
];

/** True when every entry has been signed by a practitioner. */
export const isFormularySigned = () =>
  FORMULARY.every((entry) => entry.signature.status === SIGNATURE_STATUS.SIGNED);
