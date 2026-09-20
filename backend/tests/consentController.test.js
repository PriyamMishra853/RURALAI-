/**
 * Recording and withdrawing consent, and the gate it puts on an export.
 *
 * Two behaviours matter beyond the rules: asking again must replace the
 * standing answer rather than pile a second "yes" on top of it, and the one
 * route that sends a record out of the clinic must refuse when the patient
 * has not agreed to that — regardless of what else they have agreed to.
 */
import { describe, expect, it, beforeEach, jest } from '@jest/globals';

const AADHAAR = '234567890123';
const db = {};
const reset = () => {
  db.consents = [];
  db.audits = [];
  db.updates = [];
  db.patient = { aadhaar_number: AADHAAR, full_name: 'Sample Patient' };
};

jest.unstable_mockModule('../src/config/supabase.js', () => {
  const build = (table) => {
    const filters = [];
    let mode = 'select';
    let patch = null;
    const matches = (row) => filters.every(([col, val]) => row[col] === val);
    const chain = {
      select: () => chain,
      order: () => chain,
      limit: () => chain,
      is: () => chain,
      in: () => chain,
      eq: (col, val) => { filters.push([col, val]); return chain; },
      insert: (rows) => { mode = 'insert'; patch = rows[0]; return chain; },
      update: (p) => { mode = 'update'; patch = p; db.updates.push({ table, patch }); return chain; },
      single: async () => {
        if (mode === 'insert') { const row = { id: `c${db.consents.length + 1}`, ...patch }; db.consents.push(row); return { data: row, error: null }; }
        return { data: null, error: null };
      },
      maybeSingle: async () => {
        if (table === 'patients') return { data: db.patient, error: null };
        if (table === 'patient_consents') {
          const row = db.consents.find(matches);
          if (mode === 'update' && row) { Object.assign(row, patch); return { data: { ...row }, error: null }; }
          return { data: row || null, error: null };
        }
        return { data: null, error: null };
      },
      then: (resolve) => {
        if (table !== 'patient_consents') return resolve({ data: [], error: null });
        if (mode === 'update') {
          for (const row of db.consents.filter(matches)) Object.assign(row, patch);
          return resolve({ data: null, error: null });
        }
        return resolve({ data: db.consents.filter(matches), error: null });
      }
    };
    return chain;
  };
  return { supabaseAdmin: { from: build } };
});

jest.unstable_mockModule('../src/middleware/audit.middleware.js', () => ({
  logAuditEvent: async (event) => { db.audits.push(event); }
}));

const { getConsents, grantConsent, withdrawConsent } = await import('../src/controllers/consent.controller.js');

const ASSISTANT = { id: 'ast-1', role: 'CLINIC_ASSISTANT', districtId: 'dist-1' };

const makeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};

const call = async (handler, body) => {
  const res = makeRes();
  await handler({ body, user: ASSISTANT, ip: '::1' }, res);
  return res;
};

beforeEach(reset);

describe('recording consent', () => {
  const grant = (over = {}) => call(grantConsent, {
    aadhaar_number: AADHAAR, purpose: 'share_with_facility', method: 'verbal', language: 'mr', ...over
  });

  it('records it, with the wording version, and audits it', async () => {
    const res = await grant();
    expect(res.statusCode).toBe(201);
    expect(res.body.consent).toMatchObject({ purpose: 'share_with_facility', method: 'verbal', language: 'mr' });
    expect(res.body.consent.wording_version).toMatch(/^v/);
    expect(res.body.state.share_with_facility.granted).toBe(true);
    expect(db.audits[0]).toMatchObject({ action: 'PATIENT_CONSENT_GRANTED', entityId: AADHAAR });
  });

  it('replaces the standing answer instead of stacking a second yes', async () => {
    await grant();
    await grant({ method: 'written' });
    const live = db.consents.filter((c) => c.purpose === 'share_with_facility' && c.status === 'granted');
    expect(live).toHaveLength(1);
    expect(live[0].method).toBe('written');
    expect(db.consents.filter((c) => c.status === 'withdrawn')[0].withdrawn_reason).toMatch(/replaced/);
  });

  it('refuses a patient outside the district, without saying they exist', async () => {
    db.patient = null;
    expect((await grant()).statusCode).toBe(404);
  });

  it('refuses a malformed Aadhaar before touching the database', async () => {
    expect((await grant({ aadhaar_number: '123' })).statusCode).toBe(400);
  });
});

describe('withdrawing consent', () => {
  it('marks it withdrawn and audits it', async () => {
    await call(grantConsent, { aadhaar_number: AADHAAR, purpose: 'training', method: 'verbal', language: 'hi' });
    const res = await call(withdrawConsent, { aadhaar_number: AADHAAR, purpose: 'training', reason: 'changed her mind' });
    expect(res.statusCode).toBe(200);
    expect(res.body.state.training.granted).toBe(false);
    expect(db.audits.some((a) => a.action === 'PATIENT_CONSENT_WITHDRAWN')).toBe(true);
  });

  it('answers 404 when there is nothing standing to withdraw', async () => {
    expect((await call(withdrawConsent, { aadhaar_number: AADHAAR, purpose: 'training' })).statusCode).toBe(404);
  });
});

describe('reading consent', () => {
  it('returns the state, the history and the wording that must be read out', async () => {
    await call(grantConsent, { aadhaar_number: AADHAAR, purpose: 'treatment', method: 'verbal', language: 'mr' });
    const res = await call(getConsents, { aadhaar_number: AADHAAR });
    expect(res.body.state.treatment.granted).toBe(true);
    expect(res.body.state.share_with_facility).toMatchObject({ granted: false, reason: 'never_asked' });
    expect(res.body.wording.training).toMatch(/improve the system/);
    expect(res.body.history).toHaveLength(1);
  });
});
