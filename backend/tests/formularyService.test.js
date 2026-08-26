/**
 * Formulary rules engine tests.
 *
 * The behaviour under test is mostly refusal: this engine's job is to emit
 * nothing far more often than it emits something. Each gate gets a case
 * proving it blocks, because a gate that silently stops working looks exactly
 * like a gate that had nothing to block.
 *
 * See docs/PHASE1_PRODUCTION_READINESS_PLAN.md §D.2.
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import {
  assertRuleSourced,
  formatMedicationLine,
  selectMedications
} from '../src/services/formularyService.js';

const ADULT = { age: 34 };

/**
 * The shipped formulary is unsigned, so the signature gate blocks everything
 * by default. These tests opt out of that gate to exercise the ones behind it;
 * the gate itself is covered in its own block below.
 */
beforeEach(() => {
  process.env.REQUIRE_SIGNED_FORMULARY = 'false';
});
afterEach(() => {
  delete process.env.REQUIRE_SIGNED_FORMULARY;
});

describe('tier gate', () => {
  it('emits nothing for a HIGH-risk case', () => {
    const result = selectMedications({ tier: 'HIGH', patient: ADULT, symptoms: 'fever' });
    expect(result.medications).toEqual([]);
    expect(result.suppressed[0].reason).toMatch(/referral/i);
  });

  it('emits nothing for a MEDIUM-risk case', () => {
    const result = selectMedications({ tier: 'MEDIUM', patient: ADULT, symptoms: 'fever' });
    expect(result.medications).toEqual([]);
    expect(result.suppressed[0].reason).toMatch(/doctor during consultation/i);
  });

  it('emits medication for a LOW-risk case that matches an indication', () => {
    const result = selectMedications({ tier: 'LOW', patient: ADULT, symptoms: 'fever' });
    expect(result.medications.length).toBeGreaterThan(0);
    expect(result.medications[0].drug).toMatch(/Paracetamol/);
  });
});

describe('signature gate', () => {
  it('emits nothing while the formulary is unsigned and signing is required', () => {
    process.env.REQUIRE_SIGNED_FORMULARY = 'true';
    const result = selectMedications({ tier: 'LOW', patient: ADULT, symptoms: 'fever' });
    expect(result.medications).toEqual([]);
    expect(result.suppressed[0].reason).toMatch(/not been signed/i);
  });

  it('labels every line as unsigned when the gate is relaxed for a demo', () => {
    const result = selectMedications({ tier: 'LOW', patient: ADULT, symptoms: 'fever' });
    expect(result.notices.join(' ')).toMatch(/UNSIGNED PLACEHOLDER/);
    expect(formatMedicationLine(result.medications[0])).toMatch(/UNSIGNED PLACEHOLDER/);
  });
});

describe('exclusion gates', () => {
  it('blocks paracetamol when the history records liver disease', () => {
    const result = selectMedications({
      tier: 'LOW',
      patient: ADULT,
      symptoms: 'fever',
      history: 'known liver disease'
    });
    expect(result.medications).toEqual([]);
    expect(result.suppressed[0].reason).toMatch(/liver disease/);
  });

  it('blocks a medicine the patient is allergic to', () => {
    const result = selectMedications({
      tier: 'LOW',
      patient: ADULT,
      symptoms: 'fever',
      allergies: 'paracetamol'
    });
    expect(result.medications).toEqual([]);
    expect(result.suppressed[0].reason).toMatch(/allergy/i);
  });

  it('blocks on a red-flag symptom even though the indication matches', () => {
    const result = selectMedications({
      tier: 'LOW',
      patient: ADULT,
      symptoms: 'fever with stiff neck'
    });
    expect(result.medications).toEqual([]);
    expect(result.suppressed[0].reason).toMatch(/red flag/i);
  });

  it('blocks a medicine not established as safe in pregnancy', () => {
    const result = selectMedications({
      tier: 'LOW',
      patient: { ...ADULT, is_pregnant: true },
      symptoms: 'minor wound on the arm'
    });
    expect(result.medications).toEqual([]);
    expect(result.suppressed[0].reason).toMatch(/pregnancy/i);
  });
});

describe('age and weight gates', () => {
  it('refuses to dose when age is unknown rather than assuming an adult', () => {
    const result = selectMedications({ tier: 'LOW', patient: {}, symptoms: 'fever' });
    expect(result.medications).toEqual([]);
    expect(result.suppressed[0].reason).toMatch(/age is not recorded/i);
  });

  it('blocks paracetamol for an infant under 3 months', () => {
    const result = selectMedications({
      tier: 'LOW',
      patient: { age_months: 2 },
      symptoms: 'fever'
    });
    expect(result.medications).toEqual([]);
    expect(result.suppressed[0].reason).toMatch(/under 3 months/i);
  });

  it('refuses a per-kilogram dose when no weight is recorded', () => {
    const result = selectMedications({
      tier: 'LOW',
      patient: { age: 6 },
      symptoms: 'fever'
    });
    expect(result.medications).toEqual([]);
    expect(result.suppressed[0].reason).toMatch(/body weight/i);
  });

  it('emits a per-kilogram dose once a weight is recorded', () => {
    const result = selectMedications({
      tier: 'LOW',
      patient: { age: 6, weight_kg: 20 },
      symptoms: 'fever'
    });
    expect(result.medications).toHaveLength(1);
    expect(result.medications[0].dose).toMatch(/15 mg\/kg/);
    expect(result.medications[0].dose).toMatch(/20 kg/);
  });

  it('applies the paediatric zinc protocol to a child but not an adult', () => {
    const child = selectMedications({
      tier: 'LOW',
      patient: { age: 3, weight_kg: 14 },
      symptoms: 'loose motion'
    });
    expect(child.medications.map((m) => m.drug)).toContain('Zinc sulphate');

    const adult = selectMedications({ tier: 'LOW', patient: ADULT, symptoms: 'loose motion' });
    expect(adult.medications.map((m) => m.drug)).not.toContain('Zinc sulphate');
  });
});

describe('rule sourcing', () => {
  it('stamps every emitted medication with the formulary entry it came from', () => {
    const result = selectMedications({ tier: 'LOW', patient: ADULT, symptoms: 'fever' });
    for (const med of result.medications) {
      expect(med.rule_source_id).toMatch(/^FORM-/);
      expect(med.requires_doctor_approval).toBe(true);
    }
  });

  it('throws rather than emitting a medication with no rule source', () => {
    expect(() => assertRuleSourced([{ drug: 'Amoxicillin', dose: '500mg' }])).toThrow(
      /rule_source_id/
    );
  });

  it('accepts a properly sourced list', () => {
    const { medications } = selectMedications({ tier: 'LOW', patient: ADULT, symptoms: 'fever' });
    expect(() => assertRuleSourced(medications)).not.toThrow();
  });
});

describe('rendered line', () => {
  it('always carries the doctor-approval caveat', () => {
    const { medications } = selectMedications({ tier: 'LOW', patient: ADULT, symptoms: 'fever' });
    expect(formatMedicationLine(medications[0])).toMatch(/subject to doctor approval$/);
  });
});
