/**
 * What the CHATBOX may and may not put in front of a health worker.
 *
 * The feature's whole risk is a number nobody said reaching a clinical record,
 * so these are mostly tests about refusing: an unparseable phrase fills
 * nothing, an impossible reading is questioned rather than stored, and a value
 * the assistant typed is never replaced by one the room was noisy enough to
 * mishear.
 */
import { describe, expect, it } from '@jest/globals';

const {
  parseSpokenNumber, parseBloodPressure, parseDuration,
  normaliseExtraction, reconcileWithForm
} = await import('../src/services/intakeExtractionRules.js');

describe('numbers as they are actually said', () => {
  it('reads digits', () => {
    expect(parseSpokenNumber('140')).toBe(140);
    expect(parseSpokenNumber(96)).toBe(96);
    expect(parseSpokenNumber('98.6')).toBe(98.6);
  });

  it('reads the way a blood pressure is spoken aloud', () => {
    expect(parseSpokenNumber('one forty')).toBe(140);
    expect(parseSpokenNumber('one hundred forty')).toBe(140);
    expect(parseSpokenNumber('one hundred and forty')).toBe(140);
  });

  it('reads ordinary compounds', () => {
    expect(parseSpokenNumber('ninety')).toBe(90);
    expect(parseSpokenNumber('twenty five')).toBe(25);
  });

  it('returns nothing for what it cannot read, rather than a plausible zero', () => {
    for (const input of ['', '   ', 'a bit high', 'normal', null, undefined, 'kuch zyada']) {
      expect(parseSpokenNumber(input)).toBeNull();
    }
  });
});

describe('blood pressure', () => {
  it('accepts every form the clinic uses', () => {
    const expected = { blood_pressure_systolic: 140, blood_pressure_diastolic: 90 };
    expect(parseBloodPressure('140/90')).toEqual(expected);
    expect(parseBloodPressure('140 over 90')).toEqual(expected);
    expect(parseBloodPressure('one forty by ninety')).toEqual(expected);
  });

  it('refuses a single number, because it cannot know which reading it is', () => {
    expect(parseBloodPressure('140')).toBeNull();
    expect(parseBloodPressure('one forty')).toBeNull();
  });
});

describe('symptom duration', () => {
  it('reads a value and a unit the column accepts', () => {
    expect(parseDuration('three days')).toEqual({ symptom_duration_value: 3, symptom_duration_unit: 'days' });
    expect(parseDuration('2 months')).toEqual({ symptom_duration_value: 2, symptom_duration_unit: 'months' });
    expect(parseDuration('one year')).toEqual({ symptom_duration_value: 1, symptom_duration_unit: 'years' });
  });

  it('refuses a duration with no number in it', () => {
    expect(parseDuration('a few days')).toBeNull();
    expect(parseDuration('since yesterday')).toBeNull();
    expect(parseDuration('a while')).toBeNull();
  });

  it('refuses a value the column would reject', () => {
    expect(parseDuration('0 days')).toBeNull();
    expect(parseDuration('1200 days')).toBeNull();
  });
});

describe('what a model returns', () => {
  it('keeps the fields the form knows and drops the rest', () => {
    const out = normaliseExtraction({
      chief_complaint: 'Thirst and frequent urination',
      diagnosis: 'Diabetes',           // not the CHATBOX's to decide
      risk_level: 'high',              // nor this
      symptom_duration: 'three days'
    });

    expect(out.fields.chief_complaint).toBe('Thirst and frequent urination');
    expect(out.fields.symptom_duration_value).toBe(3);
    expect(out.dropped).toEqual(expect.arrayContaining(['diagnosis', 'risk_level']));
    expect(out.fields.diagnosis).toBeUndefined();
  });

  it('treats a model saying "not mentioned" as having heard nothing', () => {
    const out = normaliseExtraction({ medical_history: 'Not mentioned', known_allergies: 'none' });
    expect(out.fields.medical_history).toBeUndefined();
    expect(out.fields.known_allergies).toBeUndefined();
  });

  it('never lets free text become a vital sign', () => {
    const out = normaliseExtraction({ pulse_bpm: 'a little fast', temperature_f: 'slight fever' });
    expect(out.vitals.pulse_bpm).toBeUndefined();
    expect(out.vitals.temperature_f).toBeUndefined();
  });
});

describe('what reaches the form', () => {
  it('offers spoken values as voice-captured and unconfirmed', () => {
    const { accept } = reconcileWithForm({
      typed: {},
      extracted: { chief_complaint: 'Fever', blood_pressure: 'one forty by ninety', pulse_bpm: 96 }
    });

    expect(accept.chief_complaint).toMatchObject({ value: 'Fever', source: 'voice', confirmed: false });
    expect(accept.blood_pressure_systolic).toMatchObject({ value: 140, read_back: true, confirmed: false });
    expect(accept.pulse_bpm.value).toBe(96);
  });

  it('never overwrites what the assistant typed', () => {
    const { accept, skipped } = reconcileWithForm({
      typed: { chief_complaint: 'Chest pain', vitals: { pulse_bpm: 80 } },
      extracted: { chief_complaint: 'Fever', pulse_bpm: 96 }
    });

    expect(accept.chief_complaint).toBeUndefined();
    expect(accept.pulse_bpm).toBeUndefined();
    expect(skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'chief_complaint', reason: 'typed' }),
      expect.objectContaining({ field: 'pulse_bpm', reason: 'typed' })
    ]));
  });

  it('questions an impossible reading instead of storing it', () => {
    const { accept, skipped, questions } = reconcileWithForm({
      typed: {},
      extracted: { pulse_bpm: 960 }   // a transposed digit
    });

    expect(accept.pulse_bpm).toBeUndefined();
    expect(skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'pulse_bpm', reason: 'implausible' })
    ]));
    expect(questions.some((q) => /say it again/i.test(q.question))).toBe(true);
  });

  it('asks only for what is still missing', () => {
    const { questions } = reconcileWithForm({
      typed: { chief_complaint: 'Fever' },
      extracted: { symptom_duration: 'three days', medical_history: 'Diabetic nine years' }
    });

    const asked = questions.map((q) => q.field);
    expect(asked).not.toContain('chief_complaint');
    expect(asked).not.toContain('symptom_duration_value');
    expect(asked).not.toContain('medical_history');
    expect(asked).toContain('current_medications');
  });

  it('refuses an impossible systolic, whose message never says "blood"', () => {
    const { accept, skipped } = reconcileWithForm({ typed: {}, extracted: { blood_pressure: '400/90' } });

    expect(accept.blood_pressure_systolic).toBeUndefined();
    expect(skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'blood_pressure_systolic', reason: 'implausible' })
    ]));
    // Half a blood pressure is not a reading.
    expect(accept.blood_pressure_diastolic).toBeUndefined();
  });

  it('does not let one bad reading discard an unrelated good one', () => {
    // Regression: matching the validator's prose by keyword collided
    // blood_glucose_mgdl with blood_pressure_* on the word "blood", so an
    // impossible glucose threw away a perfectly good blood pressure.
    const { accept, skipped } = reconcileWithForm({
      typed: {},
      extracted: { blood_glucose_mgdl: 2000, blood_pressure: '120/80' }
    });

    expect(accept.blood_pressure_systolic.value).toBe(120);
    expect(accept.blood_pressure_diastolic.value).toBe(80);
    expect(skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'blood_glucose_mgdl', reason: 'implausible' })
    ]));
  });

  it('drops both halves when the pair cannot be right', () => {
    const { accept, skipped } = reconcileWithForm({ typed: {}, extracted: { blood_pressure: '90/120' } });

    expect(accept.blood_pressure_systolic).toBeUndefined();
    expect(accept.blood_pressure_diastolic).toBeUndefined();
    expect(skipped.filter((s) => s.field.startsWith('blood_pressure'))).toHaveLength(2);
  });

  it('fills nothing from silence', () => {
    const { accept, skipped } = reconcileWithForm({ typed: {}, extracted: {} });
    expect(Object.keys(accept)).toHaveLength(0);
    expect(skipped).toHaveLength(0);
  });
});
