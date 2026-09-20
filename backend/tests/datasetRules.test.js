/**
 * The curation harness the learning system cannot start without.
 *
 * Every test here is about something NOT being in the dataset: a patient who
 * never agreed to training use, a case no doctor verified, a vital nobody
 * confirmed, and anything that could name a person.
 */
import { describe, expect, it } from '@jest/globals';

const {
  ageBand, pseudonym, confirmedVitals, excludeReason, deidentifyCase, buildManifest, datasheet
} = await import('../src/services/datasetRules.js');

const DATASET = 'ds-2026-09-20-abc123';
const AADHAAR = '234567890123';

const VISIT = {
  id: 'visit-1', created_at: '2026-09-14T09:12:33.000Z', district_name: 'Pune', state_name: 'Maharashtra',
  chief_complaint: 'Fever and cough', symptom_duration_value: 3, symptom_duration_unit: 'days',
  medical_history: 'Diabetes', known_allergies: null, current_medications: 'Metformin', is_pregnant: false
};
const PATIENT = {
  patient_uid: '11111111-2222-3333-4444-555555555555', age_years: 47, gender: 'female',
  full_name: 'Sonali Deshmukh', aadhaar_number: AADHAAR, date_of_birth: '1979-03-02', phone: '9876543210'
};
const VITALS = { temperature_f: 101.4, pulse_bpm: 96, respiratory_rate: 16, spo2_percent: 97 };
const PROVENANCE = {
  mode: 'voice_assisted',
  fields: {
    temperature_f: { source: 'voice', confirmed: true },
    pulse_bpm: { source: 'typed', confirmed: true },
    respiratory_rate: { source: 'default', confirmed: false },
    spo2_percent: { source: 'voice', confirmed: false }
  }
};
const REVIEW = { clinical_notes: 'Diagnosis: Community-acquired pneumonia\nNotes: rest', decision: 'prescribe', created_at: '2026-09-14T10:00:00.000Z' };

const build = (over = {}) => deidentifyCase({
  visit: VISIT, patient: PATIENT, vitals: VITALS, provenance: PROVENANCE, review: REVIEW, datasetId: DATASET, ...over
});

describe('who is in the dataset', () => {
  const base = { hasConsent: true, review: REVIEW, isDemo: false, includeDemo: false };

  it('excludes a patient who never agreed to training use', () => {
    expect(excludeReason({ ...base, hasConsent: false })).toBe('no_training_consent');
  });

  it('excludes a case no doctor verified', () => {
    expect(excludeReason({ ...base, review: null })).toBe('no_doctor_review');
    expect(excludeReason({ ...base, review: { clinical_notes: 'Notes: looks fine', decision: 'treat_locally' } })).toBe('no_diagnosis');
  });

  it('excludes demo data unless it is asked for', () => {
    expect(excludeReason({ ...base, isDemo: true })).toBe('demo_data');
    expect(excludeReason({ ...base, isDemo: true, includeDemo: true })).toBeNull();
  });

  it('includes a consented, reviewed, diagnosed case', () => {
    expect(excludeReason(base)).toBeNull();
  });
});

describe('what a case contains', () => {
  it('carries nothing that names a person', () => {
    const serialised = JSON.stringify(build());
    for (const identifier of [AADHAAR, PATIENT.patient_uid, PATIENT.full_name, PATIENT.phone, PATIENT.date_of_birth]) {
      expect(serialised).not.toContain(identifier);
    }
  });

  it('generalises age to a band and the date to a month', () => {
    const c = build();
    expect(c.age_band).toBe('45-59');
    expect(c.month).toBe('2026-09');
    expect(c.district).toBe('Pune');
  });

  it('keeps only measurements a person confirmed', () => {
    const measured = build().measurements;
    expect(Object.keys(measured).sort()).toEqual(['pulse_bpm', 'temperature_f']);
    expect(measured.temperature_f).toEqual({ value: 101.4, source: 'voice' });
  });

  it('drops everything when nothing is known about how values were captured', () => {
    expect(confirmedVitals(VITALS, null)).toEqual({});
  });

  it('labels the case with the doctor\'s diagnosis, not the AI\'s', () => {
    expect(build().label).toEqual({
      diagnosis: 'Community-acquired pneumonia', decision: 'prescribe', source: 'doctor_review'
    });
  });

  it('links a patient\'s cases inside one dataset and nowhere else', () => {
    const a = pseudonym(PATIENT.patient_uid, DATASET);
    expect(pseudonym(PATIENT.patient_uid, DATASET)).toBe(a);
    expect(pseudonym(PATIENT.patient_uid, 'ds-other')).not.toBe(a);
    expect(a).not.toContain(PATIENT.patient_uid);
  });
});

describe('age bands', () => {
  it('puts each age where the triage rules would', () => {
    expect(ageBand(0.5)).toBe('0-1');
    expect(ageBand(4)).toBe('1-4');
    expect(ageBand(17)).toBe('12-17');
    expect(ageBand(80)).toBe('75+');
    expect(ageBand(null)).toBeNull();
  });
});

describe('the manifest and datasheet', () => {
  const manifest = buildManifest({
    datasetId: DATASET, generatedAt: '2026-09-20T12:00:00.000Z', windowDays: 365,
    includeDemo: false, districtScope: null, purpose: 'extraction eval', approvedBy: 'IEC/2026/14',
    counts: { cases: 12, patients: 9, considered: 40, excluded: { no_training_consent: 26, no_doctor_review: 2, no_diagnosis: 0, demo_data: 0 } },
    files: [{ name: `${DATASET}.cases.jsonl`, sha256: 'abc', cases: 12 }],
    codeVersion: 'deadbee'
  });

  it('records who decided this data could be used, and for what', () => {
    expect(manifest.purpose).toBe('extraction eval');
    expect(manifest.approved_by).toBe('IEC/2026/14');
    expect(manifest.selection.requires).toContain('active training consent');
  });

  it('says what was left out, rather than only what was kept', () => {
    expect(manifest.counts.excluded.no_training_consent).toBe(26);
    expect(datasheet(manifest)).toMatch(/no_training_consent 26/);
  });

  it('writes a datasheet with the sections a reviewer expects', () => {
    const text = datasheet(manifest);
    for (const heading of ['## Motivation', '## Composition', '## Collection process', '## Preprocessing', '## Uses', '## Known limitations', '## Distribution and maintenance']) {
      expect(text).toContain(heading);
    }
  });
});
