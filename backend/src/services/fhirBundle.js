/**
 * A visit as a FHIR R4 document (Roadmap v3, Phase 3).
 *
 * Why a document and not a pile of resources: a receiving hospital needs to
 * know what it has been given and who stands behind it. A Bundle of type
 * `document` starts with a Composition — a signed-off statement of what the
 * consultation was — and everything else hangs off that.
 *
 * Three rules this file exists to enforce:
 *
 *   1. **No patient is keyed on Aadhaar.** The identifier is patients.
 *      patient_uid (migration 20), which is random and means nothing outside
 *      this system. The Aadhaar number is not in the bundle at all — not as an
 *      identifier, not as a hash, not in a narrative.
 *
 *   2. **A default nobody measured is not an observation.** The intake form
 *      opens at 98.6 °F and 120/80. Until migration 17 those were stored
 *      exactly like readings; now `intake_provenance` says which is which, and
 *      an unconfirmed default is left out. Exporting it would be telling
 *      another hospital that a temperature was taken when it was not.
 *
 *   3. **The AI's draft is not exported.** The doctor's diagnosis is the
 *      clinical record. An AI summary travelling inside a FHIR document would
 *      be read downstream as a finding, which is precisely what the platform's
 *      first ground rule refuses.
 *
 * Pure: it takes plain objects and returns a plain object. No database, no
 * clock of its own, no network.
 */

const SNOMED = 'http://snomed.info/sct';
const LOINC = 'http://loinc.org';
const UCUM = 'http://unitsofmeasure.org';
const OBS_CATEGORY = 'http://terminology.hl7.org/CodeSystem/observation-category';
const PATIENT_ID_SYSTEM = 'https://ruralhealthgrid.in/id/patient-uid';
const VISIT_ID_SYSTEM = 'https://ruralhealthgrid.in/id/visit-code';

/**
 * One Observation each, except blood pressure, which FHIR models as one
 * observation with two components — splitting it loses the fact that the two
 * numbers are a single reading.
 */
const VITALS = [
  { key: 'temperature_f', code: '8310-5', display: 'Body temperature', unit: '°F', ucum: '[degF]' },
  { key: 'pulse_bpm', code: '8867-4', display: 'Heart rate', unit: 'beats/minute', ucum: '/min' },
  { key: 'spo2_percent', code: '59408-5', display: 'Oxygen saturation in Arterial blood by Pulse oximetry', unit: '%', ucum: '%' },
  { key: 'respiratory_rate', code: '9279-1', display: 'Respiratory rate', unit: 'breaths/minute', ucum: '/min' },
  { key: 'weight_kg', code: '29463-7', display: 'Body weight', unit: 'kg', ucum: 'kg' },
  { key: 'height_cm', code: '8302-2', display: 'Body height', unit: 'cm', ucum: 'cm' },
  // Not a vital sign: a laboratory result that happens to be taken at the desk.
  { key: 'blood_glucose_mgdl', code: '2339-0', display: 'Glucose [Mass/volume] in Blood', unit: 'mg/dL', ucum: 'mg/dL', category: 'laboratory' }
];

const GENDER = { male: 'male', female: 'female', other: 'other' };

const escapeXml = (text) => String(text)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const narrative = (text) => ({
  status: 'generated',
  div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>${escapeXml(text)}</p></div>`
});

const clean = (value) => {
  const text = String(value ?? '').trim();
  return text || null;
};

const numberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * Which recorded values a person actually stands behind.
 *
 * Absent provenance means the visit predates migration 17: nothing is known
 * about how those numbers were captured, so they are exported as recorded —
 * with the document itself saying provenance was not available.
 */
export const exportableVitals = (vitals, provenance) => {
  const fields = provenance?.fields;
  const out = {};
  for (const [key, value] of Object.entries(vitals || {})) {
    if (numberOrNull(value) === null) continue;
    const entry = fields?.[key];
    if (entry && entry.source === 'default' && !entry.confirmed) continue;
    out[key] = Number(value);
  }
  return out;
};

export const buildVisitBundle = ({
  patient, visit, vitals = {}, provenance = null, district = null,
  diagnosis = null, review = null, prescription = null, referral = null,
  doctor = null, assistant = null, now = new Date()
}) => {
  if (!patient?.patient_uid) throw new Error('A patient_uid is required: an export may not be keyed on Aadhaar.');
  if (!visit?.id) throw new Error('A visit is required.');

  const entries = [];
  const urn = (id) => `urn:uuid:${id}`;
  const add = (resource) => {
    entries.push({ fullUrl: urn(resource.id), resource });
    return { reference: urn(resource.id) };
  };

  const ids = {
    composition: `${visit.id}-composition`,
    patient: patient.patient_uid,
    encounter: visit.id,
    organization: `${visit.district_id || 'clinic'}-org`
  };

  const patientRef = { reference: urn(ids.patient) };
  const encounterRef = { reference: urn(ids.encounter) };

  // ── who and where ─────────────────────────────────────────────────────────
  const organization = {
    resourceType: 'Organization', id: ids.organization,
    name: district?.name ? `Rural Health Grid — ${district.name}` : 'Rural Health Grid',
    type: [{ coding: [{ system: SNOMED, code: '43741000', display: 'Site of care' }] }],
    ...(district?.name ? { address: [{ district: district.name, country: 'IN' }] } : {})
  };
  const organizationRef = add(organization);

  const practitioners = [];
  for (const [person, role] of [[doctor, 'doctor'], [assistant, 'assistant']]) {
    if (!person?.id || !clean(person.full_name)) continue;
    practitioners.push({
      role,
      ref: add({
        resourceType: 'Practitioner', id: `${person.id}`,
        name: [{ text: person.full_name }]
      })
    });
  }
  const doctorRef = practitioners.find((p) => p.role === 'doctor')?.ref || null;
  const authorRef = doctorRef || practitioners[0]?.ref || organizationRef;

  add({
    resourceType: 'Patient', id: ids.patient,
    // The only identifier. Aadhaar is an attribute of the record in this
    // system's own database, and does not travel.
    identifier: [{ system: PATIENT_ID_SYSTEM, value: patient.patient_uid }],
    name: [{ text: patient.full_name }],
    gender: GENDER[String(patient.gender || '').toLowerCase()] || 'unknown',
    birthDate: patient.date_of_birth || undefined,
    address: [{
      line: [patient.village_line1, patient.village_line2].filter(Boolean),
      district: patient.address_district || undefined,
      postalCode: patient.pin_code || undefined,
      country: 'IN'
    }]
  });

  add({
    resourceType: 'Encounter', id: ids.encounter,
    identifier: [{ system: VISIT_ID_SYSTEM, value: visit.visit_code }],
    status: ['completed', 'referred'].includes(visit.status) ? 'finished' : 'in-progress',
    class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB', display: 'ambulatory' },
    subject: patientRef,
    period: { start: visit.intake_started_at || visit.created_at, ...(visit.closed_at ? { end: visit.closed_at } : {}) },
    serviceProvider: organizationRef,
    ...(clean(visit.chief_complaint) ? { reasonCode: [{ text: clean(visit.chief_complaint) }] }: {})
  });

  // ── what was measured ─────────────────────────────────────────────────────
  const measured = exportableVitals(vitals, provenance);
  const effective = vitals.recorded_at || visit.created_at;
  const observationRefs = [];
  const observation = (id, code, display, category, body) => observationRefs.push(add({
    resourceType: 'Observation', id: `${visit.id}-${id}`,
    status: 'final',
    category: [{ coding: [{ system: OBS_CATEGORY, code: category, display: category === 'vital-signs' ? 'Vital Signs' : 'Laboratory' }] }],
    code: { coding: [{ system: LOINC, code, display }], text: display },
    subject: patientRef, encounter: encounterRef, effectiveDateTime: effective,
    ...body
  }));

  const systolic = measured.blood_pressure_systolic;
  const diastolic = measured.blood_pressure_diastolic;
  if (systolic !== undefined && diastolic !== undefined) {
    observation('bp', '85354-9', 'Blood pressure panel with all children optional', 'vital-signs', {
      component: [
        { code: { coding: [{ system: LOINC, code: '8480-6', display: 'Systolic blood pressure' }] }, valueQuantity: { value: systolic, unit: 'mmHg', system: UCUM, code: 'mm[Hg]' } },
        { code: { coding: [{ system: LOINC, code: '8462-4', display: 'Diastolic blood pressure' }] }, valueQuantity: { value: diastolic, unit: 'mmHg', system: UCUM, code: 'mm[Hg]' } }
      ]
    });
  }

  for (const v of VITALS) {
    const value = measured[v.key];
    if (value === undefined) continue;
    observation(v.key, v.code, v.display, v.category || 'vital-signs', {
      valueQuantity: { value, unit: v.unit, system: UCUM, code: v.ucum }
    });
  }

  // ── what the doctor concluded ─────────────────────────────────────────────
  const conditionRefs = [];
  if (clean(diagnosis)) {
    conditionRefs.push(add({
      resourceType: 'Condition', id: `${visit.id}-condition`,
      clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }] },
      verificationStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status', code: 'confirmed' }] },
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-category', code: 'encounter-diagnosis', display: 'Encounter Diagnosis' }] }],
      code: { text: clean(diagnosis) },
      subject: patientRef, encounter: encounterRef,
      recordedDate: review?.created_at || visit.created_at,
      ...(doctorRef ? { asserter: doctorRef } : {})
    }));
  }

  const medicationRefs = [];
  for (const [i, item] of (prescription?.items || []).entries()) {
    const name = clean(item?.name);
    if (!name) continue;
    const dosage = [item.frequency, item.duration, item.instructions].map(clean).filter(Boolean).join(' · ');
    medicationRefs.push(add({
      resourceType: 'MedicationRequest', id: `${visit.id}-med-${i}`,
      status: 'active', intent: 'order',
      medicationCodeableConcept: { text: [name, clean(item.strength)].filter(Boolean).join(' ') },
      subject: patientRef, encounter: encounterRef,
      authoredOn: prescription.signed_at || review?.created_at || visit.created_at,
      ...(doctorRef ? { requester: doctorRef } : {}),
      ...(dosage ? { dosageInstruction: [{ text: dosage }] } : {})
    }));
  }

  const referralRefs = [];
  if (referral?.hospital_name) {
    referralRefs.push(add({
      resourceType: 'ServiceRequest', id: `${visit.id}-referral`,
      status: referral.status === 'closed' ? 'completed' : 'active',
      intent: 'order',
      priority: referral.urgency === 'emergency' ? 'stat' : 'routine',
      code: { coding: [{ system: SNOMED, code: '3457005', display: 'Patient referral' }], text: `Referral to ${referral.hospital_name}` },
      subject: patientRef, encounter: encounterRef,
      authoredOn: referral.created_at || visit.created_at,
      ...(doctorRef ? { requester: doctorRef } : {}),
      ...(referral.referral_code ? { identifier: [{ system: 'https://ruralhealthgrid.in/id/referral-code', value: referral.referral_code }] } : {})
    }));
  }

  // ── the document itself ───────────────────────────────────────────────────
  const section = (title, text, refs = []) => {
    if (!clean(text) && !refs.length) return null;
    return {
      title,
      text: narrative(clean(text) || `${refs.length} recorded`),
      ...(refs.length ? { entry: refs } : {})
    };
  };

  const provenanceNote = provenance
    ? 'Values left at the form default and never confirmed are omitted.'
    : 'This visit predates provenance recording, so how each value was captured is unknown.';

  const sections = [
    section('Chief complaint', [clean(visit.chief_complaint), clean(visit.symptom_duration) && `for ${clean(visit.symptom_duration)}`].filter(Boolean).join(' ')),
    section('History', [
      clean(visit.medical_history) && `Known conditions: ${clean(visit.medical_history)}`,
      clean(visit.known_allergies) && `Allergies: ${clean(visit.known_allergies)}`,
      clean(visit.current_medications) && `Current medicines: ${clean(visit.current_medications)}`,
      visit.is_pregnant === true ? 'Pregnant: yes' : visit.is_pregnant === false ? 'Pregnant: no' : null
    ].filter(Boolean).join('. ')),
    section(`Measurements — ${provenanceNote}`, observationRefs.length ? '' : 'Nothing measured was confirmed by a person.', observationRefs),
    section('Diagnosis', clean(diagnosis) ? '' : null, conditionRefs),
    section('Medication', medicationRefs.length ? '' : null, medicationRefs),
    section('Referral', referralRefs.length ? '' : null, referralRefs)
  ].filter(Boolean);

  entries.unshift({
    fullUrl: urn(ids.composition),
    resource: {
      resourceType: 'Composition', id: ids.composition,
      status: review ? 'final' : 'preliminary',
      type: { coding: [{ system: SNOMED, code: '371530004', display: 'Clinical consultation report' }], text: 'OP consultation record' },
      subject: patientRef, encounter: encounterRef,
      date: (review?.created_at || visit.created_at || now.toISOString()),
      author: [authorRef],
      title: `Consultation ${visit.visit_code || ''}`.trim(),
      custodian: organizationRef,
      section: sections
    }
  });

  return {
    resourceType: 'Bundle',
    id: `${visit.id}-document`,
    identifier: { system: 'urn:ietf:rfc:3986', value: urn(`${visit.id}-document`) },
    type: 'document',
    timestamp: now.toISOString(),
    entry: entries
  };
};

/**
 * What a receiving system would reject, checked before we hand it over: a
 * reference pointing at nothing, a resource without an id, or — the one that
 * matters most — a national identity number anywhere in the document.
 */
export const bundleProblems = (bundle, { aadhaar = null } = {}) => {
  const problems = [];
  const urls = new Set((bundle.entry || []).map((e) => e.fullUrl));

  if (bundle.type !== 'document') problems.push('bundle is not a document');
  if (bundle.entry?.[0]?.resource?.resourceType !== 'Composition') problems.push('a document must begin with a Composition');

  const walk = (node, path) => {
    if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`));
    if (!node || typeof node !== 'object') return;
    if (typeof node.reference === 'string' && node.reference.startsWith('urn:uuid:') && !urls.has(node.reference)) {
      problems.push(`${path}.reference points at nothing: ${node.reference}`);
    }
    for (const [key, value] of Object.entries(node)) walk(value, `${path}.${key}`);
  };
  walk(bundle.entry, 'entry');

  for (const { resource } of bundle.entry || []) {
    if (!resource?.resourceType) problems.push('an entry has no resourceType');
    if (!resource?.id) problems.push(`${resource?.resourceType} has no id`);
  }

  if (aadhaar && JSON.stringify(bundle).includes(String(aadhaar))) {
    problems.push('the Aadhaar number appears in the bundle');
  }
  return problems;
};
