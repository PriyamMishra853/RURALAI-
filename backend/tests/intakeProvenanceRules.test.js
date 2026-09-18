/**
 * The record of where an intake value came from.
 *
 * The point of provenance is that a later reader — a doctor, an audit, the
 * learning system — can tell a measurement from a default and a confirmed
 * voice value from an unchecked one. So these test that the record never
 * upgrades a value: an unknown source is dropped rather than read as typed, and
 * nothing but typing counts as confirmed unless the client explicitly says a
 * person confirmed it.
 */
import { describe, expect, it } from '@jest/globals';

const {
  normaliseProvenance, intakeStartedAt, canonicalField, MAX_INTAKE_SECONDS
} = await import('../src/services/intakeProvenanceRules.js');

describe('field names', () => {
  it('maps the form keys to column names', () => {
    expect(canonicalField('temperature')).toBe('temperature_f');
    expect(canonicalField('pulse')).toBe('pulse_bpm');
    expect(canonicalField('spo2')).toBe('spo2_percent');
    expect(canonicalField('respiratory_rate')).toBe('respiratory_rate');
  });

  it('refuses a field the record has no place for', () => {
    expect(canonicalField('aadhaar_number')).toBeNull();
    expect(canonicalField('__proto__')).toBeNull();
  });
});

describe('normaliseProvenance', () => {
  it('records a manual intake, with defaults kept apart from measurements', () => {
    const p = normaliseProvenance({
      fields: { symptoms: 'typed', temperature: 'default', pulse: { source: 'typed' } }
    });
    expect(p.mode).toBe('manual');
    expect(p.voice).toBeNull();
    expect(p.fields.temperature_f).toEqual({ source: 'default', confirmed: false });
    expect(p.fields.pulse_bpm).toEqual({ source: 'typed', confirmed: true });
    expect(p.counts).toMatchObject({ typed: 2, default: 1, default_unconfirmed: 1, voice: 0 });
  });

  it('keeps a default a default, even once a person has confirmed it', () => {
    const p = normaliseProvenance({
      fields: { spo2: { source: 'default', confirmed: true }, pulse: { source: 'default', confirmed: 'true' } }
    });
    expect(p.fields.spo2_percent).toEqual({ source: 'default', confirmed: true });
    expect(p.fields.pulse_bpm.confirmed).toBe(false);
    expect(p.counts).toMatchObject({ typed: 0, default: 2, default_unconfirmed: 1 });
  });

  it('confirms a voice value only on an explicit true', () => {
    const p = normaliseProvenance({
      fields: {
        temperature: { source: 'voice', confirmed: true },
        pulse: { source: 'voice', confirmed: 'yes' },
        spo2: { source: 'voice' }
      },
      voice: { consent: true, sessions: 2 }
    });
    expect(p.mode).toBe('voice_assisted');
    expect(p.fields.temperature_f.confirmed).toBe(true);
    expect(p.fields.pulse_bpm.confirmed).toBe(false);
    expect(p.fields.spo2_percent.confirmed).toBe(false);
    expect(p.counts).toMatchObject({ voice: 3, voice_confirmed: 1 });
    expect(p.voice).toEqual({ consent: true, sessions: 2 });
  });

  it('records a missing consent as missing, not as given', () => {
    const p = normaliseProvenance({ fields: { symptoms: { source: 'voice', confirmed: true } } });
    expect(p.voice.consent).toBe(false);
    expect(p.voice.sessions).toBe(1);
  });

  it('keeps dictation in the manual baseline', () => {
    const p = normaliseProvenance({ fields: { symptoms: { source: 'dictated', confirmed: false } } });
    expect(p.mode).toBe('manual');
    expect(p.fields.symptoms).toEqual({ source: 'dictated', confirmed: false });
  });

  it('drops unknown fields and sources instead of guessing', () => {
    const p = normaliseProvenance({
      fields: { symptoms: 'typed', temperature: 'ocr', mood: 'typed', pulse: { source: 'magic' } }
    });
    expect(Object.keys(p.fields)).toEqual(['symptoms']);
  });

  it('returns null when nothing usable is left', () => {
    expect(normaliseProvenance(null)).toBeNull();
    expect(normaliseProvenance([])).toBeNull();
    expect(normaliseProvenance({ fields: [] })).toBeNull();
    expect(normaliseProvenance({ fields: { mood: 'typed' } })).toBeNull();
  });

  it('bounds the session count', () => {
    const p = normaliseProvenance({ fields: { pulse: { source: 'voice', confirmed: true } }, voice: { consent: true, sessions: 9999 } });
    expect(p.voice.sessions).toBe(50);
  });
});

describe('what the CHATBOX measures', () => {
  it('separates a corrected value from one that was only ticked', () => {
    const p = normaliseProvenance({
      fields: {
        pulse: { source: 'voice', confirmed: true, edited: true },
        spo2: { source: 'voice', confirmed: true },
        temperature: { source: 'voice', confirmed: false, edited: true }
      },
      voice: { consent: true, sessions: 2, opened: 5 }
    });
    expect(p.fields.pulse_bpm).toEqual({ source: 'voice', confirmed: true, edited: true });
    expect(p.fields.spo2_percent.edited).toBeUndefined();
    // Unconfirmed cannot also be corrected: correcting it is what confirms it.
    expect(p.fields.temperature_f).toEqual({ source: 'voice', confirmed: false });
    expect(p.counts).toMatchObject({ voice: 3, voice_confirmed: 2, voice_edited: 1 });
  });

  it('counts sessions opened against sessions applied', () => {
    const p = normaliseProvenance({
      fields: { pulse: { source: 'voice', confirmed: true } },
      voice: { consent: true, sessions: 2, opened: 5 }
    });
    expect(p.voice).toEqual({ consent: true, sessions: 2, opened: 5 });
  });

  it('holds the fields F2 named that the form now has boxes for', () => {
    const p = normaliseProvenance({
      fields: {
        current_medications: 'typed',
        is_pregnant: { source: 'voice', confirmed: true },
        weight: 'typed',
        height: { source: 'default', confirmed: false },
        blood_glucose_mgdl: 'typed'
      }
    });
    expect(Object.keys(p.fields).sort())
      .toEqual(['blood_glucose_mgdl', 'current_medications', 'height_cm', 'is_pregnant', 'weight_kg']);
  });
});

describe('intakeStartedAt', () => {
  const now = new Date('2026-09-17T10:00:00.000Z');

  it('works back from the elapsed time', () => {
    expect(intakeStartedAt(300, now)).toBe('2026-09-17T09:55:00.000Z');
    expect(intakeStartedAt('90', now)).toBe('2026-09-17T09:58:30.000Z');
  });

  it('refuses a duration that is not an intake', () => {
    expect(intakeStartedAt(-5, now)).toBeNull();
    expect(intakeStartedAt(MAX_INTAKE_SECONDS + 1, now)).toBeNull();
    expect(intakeStartedAt('soon', now)).toBeNull();
    expect(intakeStartedAt(undefined, now)).toBeNull();
    expect(intakeStartedAt(null, now)).toBeNull();
    expect(intakeStartedAt('', now)).toBeNull();
  });
});
