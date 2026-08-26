/**
 * Golden case suite for the triage rule engine.
 *
 * Per docs/PHASE1_PRODUCTION_READINESS_PLAN.md §D.7 this suite is the
 * regression gate: a change that flips any case below fails the build. Add a
 * case here before changing a threshold, never after.
 *
 * These thresholds come from published sources (NEWS2, IMNCI) but are NOT
 * validated for this deployment — see §J.5 item 16. The tests assert that the
 * code does what the rules say, not that the rules are clinically correct.
 */
import { describe, expect, it } from '@jest/globals';
import { calculateRiskLevel, higherTier } from '../src/services/riskEngine.js';

/** A complete set of in-range vitals for an adult. */
const NORMAL_VITALS = {
  spo2: 98,
  temperature: 98.6,
  blood_pressure_systolic: 118,
  blood_pressure_diastolic: 76,
  pulse: 76
};
const ADULT = { age: 34 };

describe('higherTier', () => {
  it('raises a tier', () => {
    expect(higherTier('LOW', 'HIGH')).toBe('HIGH');
    expect(higherTier('LOW', 'MEDIUM')).toBe('MEDIUM');
  });

  it('never lowers a tier', () => {
    expect(higherTier('HIGH', 'LOW')).toBe('HIGH');
    expect(higherTier('HIGH', 'MEDIUM')).toBe('HIGH');
    expect(higherTier('MEDIUM', 'LOW')).toBe('MEDIUM');
  });
});

describe('invariant: LOW is earned, never defaulted', () => {
  it('returns LOW only when every core vital is present and in range', () => {
    const result = calculateRiskLevel(NORMAL_VITALS, 'mild headache', '', ADULT);
    expect(result.riskLevel).toBe('LOW');
    expect(result.missingData).toEqual([]);
    expect(result.requiresDoctor).toBe(false);
  });

  it('does NOT return LOW for an empty case', () => {
    // The regression this suite exists for: an assistant who records nothing
    // used to get "vitals within standard physiological ranges".
    const result = calculateRiskLevel({}, '', '');
    expect(result.riskLevel).toBe('MEDIUM');
    expect(result.requiresDoctor).toBe(true);
    expect(result.riskReasoning).not.toMatch(/within standard physiological ranges/i);
  });

  it('names every missing core vital so the assistant knows what to capture', () => {
    const result = calculateRiskLevel({}, '', '');
    expect(result.missingData).toEqual([
      'SpO2 not recorded',
      'Temperature not recorded',
      'Blood pressure not recorded',
      'Pulse not recorded',
      'Patient age not recorded'
    ]);
  });

  it('floors at MEDIUM when even one core vital is absent', () => {
    const { spo2, ...withoutSpo2 } = NORMAL_VITALS;
    const result = calculateRiskLevel(withoutSpo2, 'mild headache', '', ADULT);
    expect(result.riskLevel).toBe('MEDIUM');
    expect(result.missingData).toContain('SpO2 not recorded');
  });

  it('floors at MEDIUM when age is unknown, even with complete vitals', () => {
    const result = calculateRiskLevel(NORMAL_VITALS, 'mild headache', '');
    expect(result.riskLevel).toBe('MEDIUM');
    expect(result.missingData).toContain('Patient age not recorded');
  });
});

describe('invariant: a reading of zero is a reading, not an absence', () => {
  it('treats SpO2 of 0 as a critical red flag', () => {
    // `if (spo2 && spo2 < 90)` skipped this case entirely.
    const result = calculateRiskLevel({ ...NORMAL_VITALS, spo2: 0 }, '', '', ADULT);
    expect(result.riskLevel).toBe('HIGH');
    expect(result.immediateReferral).toBe(true);
  });

  it('treats systolic BP of 0 as a critical red flag', () => {
    const result = calculateRiskLevel(
      { ...NORMAL_VITALS, blood_pressure_systolic: 0 },
      '',
      '',
      ADULT
    );
    expect(result.riskLevel).toBe('HIGH');
    expect(result.immediateReferral).toBe(true);
  });

  it('treats an unparseable vital as absent rather than as zero', () => {
    const result = calculateRiskLevel({ ...NORMAL_VITALS, spo2: 'n/a' }, '', '', ADULT);
    expect(result.riskLevel).toBe('MEDIUM');
    expect(result.missingData).toContain('SpO2 not recorded');
    expect(result.immediateReferral).toBe(false);
  });

  it('accepts vitals supplied as numeric strings', () => {
    const result = calculateRiskLevel({ ...NORMAL_VITALS, spo2: '88' }, '', '', ADULT);
    expect(result.riskLevel).toBe('HIGH');
    expect(result.immediateReferral).toBe(true);
  });
});

describe('temperature scale handling', () => {
  it('converts a Celsius reading before applying thresholds', () => {
    // 39 °C is 102.2 °F — a fever. Read as 39 °F it cleared every threshold.
    const result = calculateRiskLevel({ ...NORMAL_VITALS, temperature: 39 }, '', '', ADULT);
    expect(result.riskLevel).toBe('MEDIUM');
    expect(result.warnings.join(' ')).toMatch(/Celsius/);
  });

  it('escalates a Celsius reading that is critical in Fahrenheit terms', () => {
    // 40 °C = 104 °F, above the 103.5 °F HIGH threshold.
    const result = calculateRiskLevel({ ...NORMAL_VITALS, temperature: 40 }, '', '', ADULT);
    expect(result.riskLevel).toBe('HIGH');
  });

  it('leaves a Fahrenheit reading alone', () => {
    const result = calculateRiskLevel({ ...NORMAL_VITALS, temperature: 98.6 }, '', '', ADULT);
    expect(result.warnings.join(' ')).not.toMatch(/Celsius/);
  });
});

describe('HIGH tier with immediate referral', () => {
  it.each([
    ['severe hypoxemia', { spo2: 88 }],
    ['shock', { blood_pressure_systolic: 84 }],
    ['hypertensive crisis', { blood_pressure_systolic: 186 }]
  ])('escalates on %s', (_label, override) => {
    const result = calculateRiskLevel({ ...NORMAL_VITALS, ...override }, '', '', ADULT);
    expect(result.riskLevel).toBe('HIGH');
    expect(result.immediateReferral).toBe(true);
    expect(result.requiresDoctor).toBe(true);
  });

  it.each([
    'chest pain',
    'unconscious',
    'heavy bleeding',
    'seizure',
    'stiff neck'
  ])('escalates on the red-flag symptom "%s"', (symptom) => {
    const result = calculateRiskLevel(NORMAL_VITALS, `patient reports ${symptom}`, '', ADULT);
    expect(result.riskLevel).toBe('HIGH');
    expect(result.immediateReferral).toBe(true);
  });

  it('escalates any fever in an infant under 2 months (IMNCI)', () => {
    const result = calculateRiskLevel(
      { ...NORMAL_VITALS, temperature: 100.8 },
      'irritable',
      '',
      { age_months: 1 }
    );
    expect(result.riskLevel).toBe('HIGH');
    expect(result.immediateReferral).toBe(true);
  });

  it('does not apply the infant rule to an older child at the same temperature', () => {
    const result = calculateRiskLevel(
      { ...NORMAL_VITALS, temperature: 100.8 },
      'irritable',
      '',
      { age: 6 }
    );
    expect(result.immediateReferral).toBe(false);
  });
});

describe('HIGH tier without immediate referral', () => {
  it.each([
    ['borderline hypoxemia', { spo2: 92 }],
    ['tachypnoea', { respiratory_rate: 34 }],
    ['bradypnoea', { respiratory_rate: 6 }],
    ['very high fever', { temperature: 104.1 }]
  ])('escalates on %s', (_label, override) => {
    const result = calculateRiskLevel({ ...NORMAL_VITALS, ...override }, '', '', ADULT);
    expect(result.riskLevel).toBe('HIGH');
    expect(result.immediateReferral).toBe(false);
    expect(result.requiresDoctor).toBe(true);
  });
});

describe('MEDIUM tier', () => {
  it.each([
    ['fever', { temperature: 102.2 }],
    ['tachycardia', { pulse: 124 }],
    ['bradycardia', { pulse: 44 }]
  ])('escalates on %s', (_label, override) => {
    const result = calculateRiskLevel({ ...NORMAL_VITALS, ...override }, '', '', ADULT);
    expect(result.riskLevel).toBe('MEDIUM');
    expect(result.requiresDoctor).toBe(true);
  });

  it('escalates on concurrent fever and cough', () => {
    const result = calculateRiskLevel(NORMAL_VITALS, 'fever and cough for two days', '', ADULT);
    expect(result.riskLevel).toBe('MEDIUM');
  });

  it.each(['diabetes', 'hypertension', 'heart disease', 'COPD', 'asthma'])(
    'escalates on the comorbidity "%s"',
    (condition) => {
      const result = calculateRiskLevel(NORMAL_VITALS, 'mild headache', condition, ADULT);
      expect(result.riskLevel).toBe('MEDIUM');
    }
  );
});

describe('invariant: escalation is monotonic', () => {
  it('a MEDIUM finding cannot pull a HIGH case back down', () => {
    // Critical SpO2 alongside a merely-elevated pulse.
    const result = calculateRiskLevel(
      { ...NORMAL_VITALS, spo2: 85, pulse: 124 },
      '',
      'diabetes',
      ADULT
    );
    expect(result.riskLevel).toBe('HIGH');
    expect(result.immediateReferral).toBe(true);
  });

  it('missing data cannot pull a HIGH case back down', () => {
    const result = calculateRiskLevel({ spo2: 85 }, '', '');
    expect(result.riskLevel).toBe('HIGH');
  });
});
