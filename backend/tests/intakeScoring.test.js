/**
 * The intake test set's scorer. It decides whether the Phase 2 exit criterion
 * is met, so it must never pass a near miss or an invented vital.
 */
import { describe, expect, it } from '@jest/globals';

const { scoreCase, summarise } = await import('../src/eval/intakeScoring.js');

const v = (value) => ({ value, source: 'voice', confirmed: false });

describe('scoreCase', () => {
  it('passes only an exact vital', () => {
    const testCase = { id: 'a', lang: 'en', vitals: { blood_pressure_systolic: 140, blood_pressure_diastolic: 90 } };
    expect(scoreCase(testCase, { accept: { blood_pressure_systolic: v(140), blood_pressure_diastolic: v(90) } }).pass).toBe(true);
    const near = scoreCase(testCase, { accept: { blood_pressure_systolic: v(140), blood_pressure_diastolic: v(80) } });
    expect(near.pass).toBe(false);
    expect(near.vitals_exact).toBe(1);
  });

  it('fails a vital nobody said, whatever else was right', () => {
    const score = scoreCase({ id: 'b', lang: 'hi', vitals: { pulse_bpm: 88 } }, { accept: { pulse_bpm: v(88), temperature_f: v(98.6) } });
    expect(score.pass).toBe(false);
    expect(score.fabricated).toEqual(['temperature_f']);
  });

  it('checks durations, either-field presence, substrings and absences', () => {
    const testCase = {
      id: 'c', lang: 'mr', vitals: {},
      duration: { value: 14, unit: 'days' },
      present: ['chief_complaint|symptoms'],
      contains: { known_allergies: 'penicillin' },
      absent: ['is_pregnant']
    };
    const good = {
      accept: {
        symptom_duration_value: v(14), symptom_duration_unit: v('days'),
        symptoms: v('khokla'), known_allergies: v('Penicillin')
      }
    };
    expect(scoreCase(testCase, good).pass).toBe(true);
    expect(scoreCase(testCase, { accept: { ...good.accept, is_pregnant: v(true) } }).pass).toBe(false);
    expect(scoreCase({ ...testCase, duration: null }, good).pass).toBe(false);
  });

  it('counts a refused vital only when it was held back with a reason', () => {
    const testCase = { id: 'd', lang: 'en', vitals: {}, rejected: ['temperature_f'] };
    expect(scoreCase(testCase, { accept: {}, vital_errors: ['Temperature 1001°F is outside 95–107.'] }).pass).toBe(true);
    expect(scoreCase(testCase, { accept: {}, vital_errors: [] }).pass).toBe(false);
  });
});

describe('summarise', () => {
  it('meets the exit criterion only with every vital exact and none invented', () => {
    const perfect = [{ id: 'a', lang: 'en', pass: true, vitals_expected: 2, vitals_exact: 2, fabricated: [] }];
    expect(summarise(perfect).exit_criterion_met).toBe(true);
    expect(summarise([{ ...perfect[0], vitals_exact: 1 }]).exit_criterion_met).toBe(false);
    expect(summarise([{ ...perfect[0], fabricated: ['pulse_bpm'] }]).exit_criterion_met).toBe(false);
    expect(summarise([{ ...perfect[0], vitals_expected: 0, vitals_exact: 0 }]).exit_criterion_met).toBe(false);
  });
});
