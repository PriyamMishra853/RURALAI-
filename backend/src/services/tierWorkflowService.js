import { supabaseAdmin } from '../config/supabase.js';
// The formulary and medicine-availability lookups are deliberately not imported
// here any more: this workflow renders in the assistant's portal, and nothing
// in it may name a medicine. Prescribing lives with the doctor.
import { getPrecautions } from './aiInferenceClient.js';
import { buildReferral } from './referralService.js';
import { ageFromDob } from './patientFields.js';

/**
 * Tier workflow — spec §3.6.
 *
 * The rules engine decides the tier. This decides what that tier *produces*.
 * Each tier has a different, defined output set, and the differences are not
 * cosmetic — they change who is accountable for the patient next:
 *
 *   LOW     complete plan, acted on now, doctor reviews in the daily batch
 *   MEDIUM  nothing is dispensed until a doctor has seen the patient on video
 *   HIGH    the case leaves the platform entirely; referral, not consultation
 *
 * One invariant runs through all three: medication is only ever emitted for
 * LOW, and only from the practitioner-signed formulary. MEDIUM withholds it
 * because the consultation is the gate; HIGH withholds it because the patient
 * is going to a hospital, and a sub-centre handing out tablets on the way is
 * how a referral gets delayed.
 */

/**
 * The AI orchestrator works in three tiers (LOW/MEDIUM/HIGH) while the database
 * stores four (adding `emergency`). `emergency` is HIGH plus an immediate
 * referral flag — the same workflow, escalated presentation.
 */
export const WORKFLOW_TIER = { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' };

const normaliseTier = (level) => {
  const t = String(level || 'MEDIUM').toUpperCase();
  if (t === 'EMERGENCY') return WORKFLOW_TIER.HIGH;
  if (t === 'MODERATE') return WORKFLOW_TIER.MEDIUM;
  return WORKFLOW_TIER[t] || WORKFLOW_TIER.MEDIUM;
};

/**
 * Speciality routing for MEDIUM — spec asks for doctor selection driven by
 * disease category. Keys are matched against the candidate disease names from
 * pipeline 1; anything unmatched falls through to General Medicine, which is
 * the correct default rather than a failure.
 */
const SPECIALITY_BY_KEYWORD = [
  [/heart|cardiac|angina|myocard|mitral|aortic|arrhythm|hypertens/i, 'Cardiology'],
  [/lung|pulmon|asthma|copd|bronch|pneumon|respirat|tubercul/i, 'Pulmonology'],
  [/skin|derma|eczema|psorias|rash|fungal|acne|urticar/i, 'Dermatology'],
  [/bone|fractur|joint|arthrit|orthop|sprain|dislocat/i, 'Orthopaedics'],
  [/pregnan|obstetr|gynaec|gynec|menstrua|uterin|ovarian/i, 'Obstetrics & Gynaecology'],
  [/child|paediatr|pediatr|infant|neonat/i, 'Paediatrics'],
  [/eye|ocular|retin|conjunctiv|glaucom|catarac/i, 'Ophthalmology'],
  [/ear|nose|throat|sinus|tonsil|otitis|laryng/i, 'ENT'],
];

export const specialityFor = (diseaseNames = []) => {
  const text = diseaseNames.join(' ');
  for (const [pattern, speciality] of SPECIALITY_BY_KEYWORD) {
    if (pattern.test(text)) return speciality;
  }
  return 'General Medicine';
};

/**
 * Diet guidance. Explicitly optional per the spec, and deliberately generic:
 * it is non-clinical supportive advice, not a prescribed therapeutic diet,
 * which is a dietitian's decision and not something to generate per-patient.
 */
const DIET_BY_PATTERN = [
  [/diarrh|gastro|loose|dysenter|cholera/i, [
    'Small, frequent sips of ORS or clean boiled water throughout the day.',
    'Bland foods — rice, banana, curd, khichdi. Avoid oily and spiced food.',
    'Continue breastfeeding if the patient is an infant.'
  ]],
  [/fever|flu|infect|viral|malaria|dengue|typhoid/i, [
    'Increase fluids — water, nimbu paani, coconut water, thin dal.',
    'Light, easily digested meals; do not force a full meal during fever.',
    'Avoid outside or reheated food until the fever settles.'
  ]],
  [/diabet|glucose|sugar/i, [
    'Fixed meal times; do not skip meals.',
    'Reduce refined sugar, sweets and sweetened drinks.',
    'Prefer whole grains, dal and vegetables over polished rice and maida.'
  ]],
  [/hypertens|blood pressure|cardiac|heart/i, [
    'Reduce added salt, pickles and papad.',
    'Avoid deep-fried food and reused cooking oil.',
    'Prefer fresh vegetables and fruit where affordable.'
  ]],
  [/anaem|anemia|iron|weak/i, [
    'Iron-rich foods — green leafy vegetables, jaggery, dates, ragi.',
    'Take vitamin C (lemon, amla, guava) with meals to help iron absorb.',
    'Avoid tea or coffee immediately after meals.'
  ]],
];

const dietFor = (assessment) => {
  const text = [
    assessment?.patient_summary,
    ...(assessment?.disease_candidates?.candidates || []).map((c) => c.disease)
  ].filter(Boolean).join(' ');

  for (const [pattern, items] of DIET_BY_PATTERN) {
    if (pattern.test(text)) return items;
  }
  // No confident match means no guidance rather than filler. Generic "eat well"
  // advice on a clinical record is noise the assistant has to read past.
  return [];
};

/** Dataset-sourced precautions for the top candidate, with a safe fallback. */
const precautionsFor = async (assessment) => {
  const top = assessment?.disease_candidates?.candidates?.[0]?.disease;
  if (top) {
    const res = await getPrecautions(top);
    if (res?.ok && res.precautions?.length) {
      return { source: `dataset:${res.disease}`, items: res.precautions };
    }
  }
  return {
    source: 'protocol',
    items: [
      'Return to the sub-centre immediately if symptoms worsen.',
      'Complete any treatment exactly as the doctor directs.',
      'Keep the patient hydrated and resting.'
    ]
  };
};

/**
 * Medication — never emitted to the clinic assistant, at any tier.
 *
 * Prescribing is the doctor's decision. This workflow is rendered in the
 * assistant's portal, so no medicine may appear in it: not a model's
 * suggestion, and not a signed formulary entry either. The distinction that
 * used to be drawn here — LOW tier may carry medication, MEDIUM and HIGH may
 * not — put a dose in front of a health worker for exactly the cases nobody
 * was going to look at again, which is the wrong way round.
 *
 * The formulary engine is untouched and still governs what a doctor may
 * prescribe. What changed is who is shown its output.
 *
 * The returned shape is unchanged, so the tier screen and the PDF both render
 * the reason where they used to render a list.
 */
const medicationFor = async (tier) => ({
  emitted: false,
  reason: tier === WORKFLOW_TIER.HIGH
    ? 'No medication is issued — this patient is being referred to hospital.'
    : 'Medication is prescribed by the doctor after review. None is suggested here.',
  signature_status: null,
  notices: [],
  items: []
});

/**
 * Build the tier-specific output bundle.
 *
 * @returns {Promise<object>} the block attached to the assessment as `workflow`
 */
export const buildTierWorkflow = async ({ assessment, patient, visit, districtName }) => {
  const tier = normaliseTier(assessment?.risk_level);

  const [precautions, medication] = await Promise.all([
    precautionsFor(assessment),
    medicationFor(tier)
  ]);

  const base = {
    tier,
    // Item 1 in every tier: what the assistant does right now, before anything
    // else happens. Same list the assessment already produced.
    first_aid: assessment?.first_aid_steps || [],
    patient: {
      name: patient?.full_name,
      age: ageFromDob(patient?.date_of_birth),
      gender: patient?.gender,
      village: patient?.village_line1,
      district: districtName,
      phone: patient?.phone
    },
    precautions,
    diet: dietFor(assessment),
    medication
  };

  if (tier === WORKFLOW_TIER.LOW) {
    return {
      ...base,
      headline: 'Protocol care — complete plan issued',
      // Reviewed in the daily batch, not as an interruption.
      doctor_action: {
        queue: 'DAILY_REVIEW',
        notify: true,
        note: 'Queued for the doctor’s daily review. The assistant may act on this plan now.'
      },
      consultation: null,
      referral: null
    };
  }

  if (tier === WORKFLOW_TIER.MEDIUM) {
    const candidates = (assessment?.disease_candidates?.candidates || []).map((c) => c.disease);
    const speciality = specialityFor(candidates);
    return {
      ...base,
      headline: 'Video consultation required before treatment',
      doctor_action: {
        queue: 'CONSULTATION',
        notify: true,
        note: 'A doctor must see this patient before any treatment is given.'
      },
      consultation: {
        required: true,
        // Load-balancing happens at booking time in schedulingService; this is
        // the routing hint that narrows the pool to the right speciality.
        speciality,
        routing_basis: candidates.length ? `disease candidates: ${candidates.slice(0, 3).join(', ')}` : 'no candidates — general pool',
        note: 'The doctor’s review returns to this screen when the call ends.'
      },
      referral: null
    };
  }

  // HIGH — the case leaves the platform.
  const referral = await buildReferral({
    districtName,
    lat: null,
    lon: null
  });

  return {
    ...base,
    headline: 'Refer immediately — danger zone',
    danger_zone: true,
    doctor_action: {
      // Spec §3.6: nothing is queued to the doctor portal for HIGH. A referral
      // message only; the case closes and is reviewed offline.
      queue: 'NONE',
      notify: false,
      note: 'No doctor queue entry. A referral notice is recorded and the case is closed for offline review.'
    },
    consultation: null,
    referral
  };
};
