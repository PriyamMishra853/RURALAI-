/**
 * The visit as a FHIR R4 document.
 *
 * Phase 3's exit criterion is two sentences: records export as valid FHIR R4,
 * and no patient is keyed on Aadhaar. These check the second one hard — an
 * Aadhaar number must not appear anywhere in the document, in any field — and
 * the structural parts of the first that can be checked without the official
 * validator: a document that starts with a Composition, references that
 * resolve, and every resource identified.
 *
 * The third rule is this platform's own: a vital the assistant never
 * confirmed is not a measurement, and must not be handed to another hospital
 * as one.
 */
import { describe, expect, it } from '@jest/globals';

const { buildVisitBundle, bundleProblems, exportableVitals } = await import('../src/services/fhirBundle.js');

const AADHAAR = '234567890123';

const PATIENT = {
  patient_uid: '11111111-2222-3333-4444-555555555555',
  full_name: 'Sample Patient',
  gender: 'female',
  date_of_birth: '1988-04-02',
  village_line1: 'Rampur Kalan',
  address_district: 'Pune',
  pin_code: '411001',
  aadhaar_number: AADHAAR
};

const VISIT = {
  id: 'visit-1', visit_code: 'VIS-2026-000123', status: 'completed',
  created_at: '2026-09-19T04:00:00.000Z', district_id: 'dist-1',
  chief_complaint: 'Fever & breathlessness', symptom_duration: '3 days',
  medical_history: 'Diabetes', known_allergies: 'Penicillin',
  current_medications: 'Metformin 500', is_pregnant: false
};

const VITALS = {
  temperature_f: 101.4, blood_pressure_systolic: 140, blood_pressure_diastolic: 90,
  pulse_bpm: 96, spo2_percent: 94, respiratory_rate: 16, weight_kg: 62.5, blood_glucose_mgdl: 190,
  recorded_at: '2026-09-19T04:05:00.000Z'
};

const PROVENANCE = {
  v: 1, mode: 'voice_assisted',
  fields: {
    temperature_f: { source: 'voice', confirmed: true },
    blood_pressure_systolic: { source: 'typed', confirmed: true },
    blood_pressure_diastolic: { source: 'typed', confirmed: true },
    pulse_bpm: { source: 'typed', confirmed: true },
    spo2_percent: { source: 'typed', confirmed: true },
    // Never touched: the form's own starting value.
    respiratory_rate: { source: 'default', confirmed: false },
    weight_kg: { source: 'typed', confirmed: true },
    blood_glucose_mgdl: { source: 'typed', confirmed: true }
  }
};

const build = (over = {}) => buildVisitBundle({
  patient: PATIENT, visit: VISIT, vitals: VITALS, provenance: PROVENANCE,
  district: { name: 'Pune' },
  diagnosis: 'Community-acquired pneumonia',
  review: { created_at: '2026-09-19T05:00:00.000Z', decision: 'prescribe' },
  prescription: { signed_at: '2026-09-19T05:01:00.000Z', items: [{ name: 'Amoxicillin', strength: '500 mg', frequency: 'three times a day', duration: '5 days' }] },
  doctor: { id: 'doc-1', full_name: 'Dr Rao' },
  assistant: { id: 'ast-1', full_name: 'Sunita' },
  now: new Date('2026-09-19T06:00:00.000Z'),
  ...over
});

const resources = (bundle, type) => bundle.entry.map((e) => e.resource).filter((r) => r.resourceType === type);

describe('the document', () => {
  it('is a FHIR document that starts with a Composition and resolves', () => {
    const bundle = build();
    expect(bundle.resourceType).toBe('Bundle');
    expect(bundle.type).toBe('document');
    expect(bundle.entry[0].resource.resourceType).toBe('Composition');
    expect(bundleProblems(bundle, { aadhaar: AADHAAR })).toEqual([]);
  });

  it('never carries the Aadhaar number, in any field', () => {
    const serialised = JSON.stringify(build());
    expect(serialised).not.toContain(AADHAAR);
    const [patient] = resources(build(), 'Patient');
    expect(patient.identifier).toEqual([{ system: expect.any(String), value: PATIENT.patient_uid }]);
  });

  it('refuses to build without an internal identifier', () => {
    expect(() => build({ patient: { ...PATIENT, patient_uid: null } })).toThrow(/patient_uid/);
  });
});

describe('what counts as measured', () => {
  it('leaves out a vital left at the form default and never confirmed', () => {
    const codes = resources(build(), 'Observation').flatMap((o) => o.code.coding.map((c) => c.code));
    expect(codes).toContain('8310-5');   // temperature, heard and confirmed
    expect(codes).toContain('85354-9');  // blood pressure, typed
    expect(codes).not.toContain('9279-1'); // respiratory rate, an untouched default
  });

  it('exports an unconfirmed default only when nothing is known about provenance', () => {
    expect(exportableVitals(VITALS, PROVENANCE).respiratory_rate).toBeUndefined();
    expect(exportableVitals(VITALS, null).respiratory_rate).toBe(16);
    const composition = build({ provenance: null }).entry[0].resource;
    expect(composition.section.map((s) => s.title).join(' ')).toMatch(/predates provenance/);
  });

  it('keeps blood pressure as one reading with two components', () => {
    const [bp] = resources(build(), 'Observation').filter((o) => o.code.coding[0].code === '85354-9');
    expect(bp.component.map((c) => c.valueQuantity.value)).toEqual([140, 90]);
    expect(bp.component[0].valueQuantity.code).toBe('mm[Hg]');
  });

  it('drops a half blood pressure rather than exporting one number', () => {
    const bundle = build({ vitals: { blood_pressure_systolic: 140, recorded_at: VITALS.recorded_at }, provenance: null });
    expect(resources(bundle, 'Observation')).toHaveLength(0);
  });

  it('files glucose as a laboratory result, not a vital sign', () => {
    const [glucose] = resources(build(), 'Observation').filter((o) => o.code.coding[0].code === '2339-0');
    expect(glucose.category[0].coding[0].code).toBe('laboratory');
    expect(glucose.valueQuantity).toEqual({ value: 190, unit: 'mg/dL', system: 'http://unitsofmeasure.org', code: 'mg/dL' });
  });
});

describe('the clinical record, and only the clinical record', () => {
  it('carries the doctor\'s diagnosis and prescription', () => {
    const bundle = build();
    expect(resources(bundle, 'Condition')[0].code.text).toBe('Community-acquired pneumonia');
    const [med] = resources(bundle, 'MedicationRequest');
    expect(med.medicationCodeableConcept.text).toBe('Amoxicillin 500 mg');
    expect(med.dosageInstruction[0].text).toBe('three times a day · 5 days');
  });

  it('is preliminary until a doctor has reviewed it', () => {
    expect(build().entry[0].resource.status).toBe('final');
    expect(build({ review: null, diagnosis: null }).entry[0].resource.status).toBe('preliminary');
  });

  it('carries a referral as a ServiceRequest, urgent when the referral was', () => {
    const bundle = build({ referral: { hospital_name: 'District Hospital Pune', referral_code: 'RF-ABCD2345', status: 'referred', urgency: 'emergency', created_at: VISIT.created_at } });
    const [request] = resources(bundle, 'ServiceRequest');
    expect(request.priority).toBe('stat');
    expect(request.code.text).toMatch(/District Hospital Pune/);
  });

  it('does not export the AI draft', () => {
    const serialised = JSON.stringify(build({ visit: { ...VISIT, ai_summary: 'AI thinks pneumonia' } }));
    expect(serialised).not.toContain('AI thinks pneumonia');
  });
});

describe('bundleProblems', () => {
  it('catches a reference pointing at nothing', () => {
    const bundle = build();
    bundle.entry[1].resource.subject = { reference: 'urn:uuid:missing' };
    expect(bundleProblems(bundle).join(' ')).toMatch(/points at nothing/);
  });

  it('catches an Aadhaar number that slipped in anywhere', () => {
    const bundle = build();
    bundle.entry[1].resource.note = `Patient ${AADHAAR}`;
    expect(bundleProblems(bundle, { aadhaar: AADHAAR })).toContain('the Aadhaar number appears in the bundle');
  });
});
