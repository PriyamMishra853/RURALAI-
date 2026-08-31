/**
 * Medication is the doctor's decision.
 *
 * The assessment and the tier workflow are both rendered in the clinic
 * assistant's portal, so neither may name a medicine — not one the model
 * invented, and not one the signed formulary chose either. A health worker
 * acting on a drug name from an automated summary is the specific outcome this
 * boundary exists to prevent, and "the rules picked it" does not make it their
 * decision to act on.
 *
 * These cases exist because the boundary is invisible in the UI once it works:
 * nothing renders, so nothing looks wrong when it silently comes back.
 */
import { describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }), limit: async () => ({ data: [] }) }) })
    })
  }
}));

// The precaution lookup is a network call; the workflow must build without it.
jest.unstable_mockModule('../src/services/aiInferenceClient.js', () => ({
  getPrecautions: async () => ({ ok: false }),
  getMedicineAvailability: async () => ({ ok: false })
}));

jest.unstable_mockModule('../src/services/referralService.js', () => ({
  buildReferral: async () => ({ required: false })
}));

const { buildTierWorkflow } = await import('../src/services/tierWorkflowService.js');

const PATIENT = { date_of_birth: '1990-04-02', gender: 'female' };
const VISIT = {
  chief_complaint: 'fever and headache for two days',
  medical_history: '',
  known_allergies: ''
};

/** Every string anywhere in a structure, for a blunt "does a drug name appear" sweep. */
const allStrings = (value, out = []) => {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => allStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => allStrings(v, out));
  return out;
};

// Molecules the formulary can emit. If any reaches the assistant's workflow,
// the boundary has been breached somewhere upstream.
//
// Matched on word boundaries, not as substrings: "ORS" is a real formulary
// entry and also sits inside "worsen" and "doctors", both of which belong in
// safety advice. A check that fails on those would be turned off rather than
// fixed, which is worse than not having it.
const DRUG_NAMES = ['paracetamol', 'acetaminophen', 'ibuprofen', 'ors', 'zinc', 'cetirizine', 'amoxicillin'];
const mentionsDrug = (haystack, drug) => new RegExp(`\\b${drug}\\b`, 'i').test(haystack);

describe.each([
  ['LOW', 'LOW'],
  ['MEDIUM', 'MEDIUM'],
  ['HIGH', 'HIGH']
])('tier workflow — %s risk', (_label, risk) => {
  const build = () => buildTierWorkflow({
    assessment: { risk_level: risk, patient_summary: 'Adult with fever.', first_aid_steps: [] },
    patient: PATIENT,
    visit: VISIT,
    districtName: 'Agra'
  });

  it('never emits medication', async () => {
    const workflow = await build();
    expect(workflow.medication.emitted).toBe(false);
    expect(workflow.medication.items).toEqual([]);
  });

  it('explains why, so the screen is not just blank', async () => {
    const workflow = await build();
    expect(typeof workflow.medication.reason).toBe('string');
    expect(workflow.medication.reason.length).toBeGreaterThan(0);
  });

  it('mentions no drug name anywhere in the workflow', async () => {
    const workflow = await build();
    const haystack = allStrings(workflow).join(' ');
    for (const drug of DRUG_NAMES) {
      expect({ drug, mentioned: mentionsDrug(haystack, drug) }).toEqual({ drug, mentioned: false });
    }
  });
});

describe('LOW risk specifically', () => {
  // LOW was the tier that used to carry medication, on the reasoning that a
  // mild case is safe to treat on protocol. It is also the tier least likely
  // to be reviewed by a doctor afterwards, which is what made it the worst
  // place to print a dose rather than the best.
  it('is treated no differently from any other tier', async () => {
    const workflow = await buildTierWorkflow({
      assessment: { risk_level: 'LOW', patient_summary: 'Mild self-limiting complaint.', first_aid_steps: [] },
      patient: PATIENT,
      visit: VISIT,
      districtName: 'Agra'
    });
    expect(workflow.medication.emitted).toBe(false);
    expect(workflow.medication.items).toHaveLength(0);
  });
});
