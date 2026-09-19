/**
 * Who may export a visit, and what the export is allowed to contain.
 *
 * An export is a disclosure: the whole record leaves in one request. So the
 * scoping is the feature — a doctor may export a case assigned to them, an
 * assistant one in their district, and nobody anything else — and it is
 * recorded in the audit trail like any other disclosure.
 */
import { describe, expect, it, beforeEach, jest } from '@jest/globals';

const AADHAAR = '234567890123';
const db = {};
const reset = () => {
  db.filters = [];
  db.audits = [];
  db.visit = {
    id: 'visit-1', visit_code: 'VIS-1', status: 'completed', created_at: '2026-09-19T04:00:00.000Z',
    district_id: 'dist-1', chief_complaint: 'Fever', assistant_id: 'ast-1', assigned_doctor_id: 'doc-1',
    intake_provenance: null,
    patients: [{
      patient_uid: '11111111-2222-3333-4444-555555555555', aadhaar_number: AADHAAR,
      full_name: 'Sample Patient', gender: 'female', date_of_birth: '1990-01-01',
      village_line1: 'Rampur', address_district: 'Pune', pin_code: '411001'
    }],
    visit_vitals: [{ pulse_bpm: 88, recorded_at: '2026-09-19T04:05:00.000Z' }],
    doctor_reviews: [{ clinical_notes: 'Diagnosis: Viral fever\nNotes: rest', decision: 'treat_locally', created_at: '2026-09-19T05:00:00.000Z' }],
    prescriptions: []
  };
};

jest.unstable_mockModule('../src/config/supabase.js', () => {
  const build = (table) => {
    const chain = {
      select: () => chain,
      is: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      eq: (col, val) => { db.filters.push(`${table}.${col}=${val}`); return chain; },
      maybeSingle: async () => {
        if (table === 'visits') return { data: db.visit, error: null };
        if (table === 'districts') return { data: { name: 'Pune' }, error: null };
        if (table === 'hospital_referrals') return { data: null, error: null };
        return { data: null, error: null };
      },
      then: (resolve) => resolve(table === 'staff_profiles'
        ? { data: [{ id: 'doc-1', full_name: 'Dr Rao' }, { id: 'ast-1', full_name: 'Sunita' }], error: null }
        : { data: null, error: null })
    };
    return chain;
  };
  return { supabaseAdmin: { from: build } };
});

jest.unstable_mockModule('../src/middleware/audit.middleware.js', () => ({
  logAuditEvent: async (event) => { db.audits.push(event); }
}));

const { exportVisitAsFhir } = await import('../src/controllers/fhirExport.controller.js');

const makeRes = () => {
  const res = { statusCode: 200, body: null, contentType: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.type = (t) => { res.contentType = t; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};

const run = async (user) => {
  const res = makeRes();
  await exportVisitAsFhir({ params: { id: 'visit-1' }, user, ip: '::1' }, res);
  return res;
};

const DOCTOR = { id: 'doc-1', role: 'DOCTOR', districtId: 'dist-1' };
const ASSISTANT = { id: 'ast-1', role: 'CLINIC_ASSISTANT', districtId: 'dist-1' };

beforeEach(reset);

describe('scope', () => {
  it('limits a doctor to cases assigned to them', async () => {
    await run(DOCTOR);
    expect(db.filters).toContain('visits.assigned_doctor_id=doc-1');
    expect(db.filters).not.toContain('visits.district_id=dist-1');
  });

  it('limits an assistant to their district', async () => {
    await run(ASSISTANT);
    expect(db.filters).toContain('visits.district_id=dist-1');
  });

  it('answers 404 rather than saying the visit exists elsewhere', async () => {
    db.visit = null;
    const res = await run(DOCTOR);
    expect(res.statusCode).toBe(404);
    expect(db.audits).toHaveLength(0);
  });
});

describe('the exported document', () => {
  it('is served as FHIR and carries the diagnosis from the review', async () => {
    const res = await run(DOCTOR);
    expect(res.statusCode).toBe(200);
    expect(res.contentType).toBe('application/fhir+json');
    expect(res.body.type).toBe('document');
    const condition = res.body.entry.map((e) => e.resource).find((r) => r.resourceType === 'Condition');
    expect(condition.code.text).toBe('Viral fever');
  });

  it('never contains the Aadhaar number', async () => {
    const res = await run(DOCTOR);
    expect(JSON.stringify(res.body)).not.toContain(AADHAAR);
  });

  it('refuses rather than falling back to Aadhaar when there is no internal id', async () => {
    db.visit.patients[0].patient_uid = null;
    const res = await run(DOCTOR);
    expect(res.statusCode).toBe(409);
  });

  it('records the disclosure in the audit trail', async () => {
    await run(ASSISTANT);
    expect(db.audits[0]).toMatchObject({
      action: 'VISIT_EXPORTED_FHIR', entityType: 'VISITS', entityId: 'visit-1', actorId: 'ast-1'
    });
    expect(db.audits[0].metadata.resources).toBeGreaterThan(3);
  });
});
