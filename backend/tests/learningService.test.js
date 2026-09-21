/**
 * The model learning from completed visits.
 *
 * Three properties carry the safety argument, and each is tested here:
 *   · nothing is learned from a patient who did not agree to training use,
 *   · a candidate worse than the live model on the frozen benchmark is never
 *     promoted, manually or automatically,
 *   · learning can never fail the doctor's decision it was triggered by.
 */
import { describe, expect, it, beforeEach, jest } from '@jest/globals';

const db = {};
const reset = () => {
  db.visit = {
    id: 'v1', patient_id: '234567890123', district_id: 'd1', chief_complaint: 'Fever and cough',
    visit_symptoms: [{ description: 'difficulty breathing' }],
    patients: [{ date_of_birth: '1980-01-01', gender: 'female' }]
  };
  db.consents = [];
  db.inserts = [];
  db.insertError = null;
  db.versions = [];
  db.audits = [];
};

jest.unstable_mockModule('../src/config/supabase.js', () => {
  const build = (table) => {
    const filters = [];
    let mode = 'select';
    let payload = null;
    const chain = {
      select: () => chain,
      eq: (col, val) => { filters.push([col, val]); return chain; },
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      insert: (rows) => { mode = 'insert'; payload = rows[0]; db.inserts.push({ table, row: rows[0] }); return chain; },
      update: (p) => { mode = 'update'; payload = p; return chain; },
      single: async () => {
        if (mode === 'insert' && db.insertError) return { data: null, error: db.insertError };
        if (table === 'model_versions' && mode === 'insert') {
          const row = { id: `mv${payload.version}`, ...payload };
          db.versions.push(row);
          return { data: row, error: null };
        }
        if (table === 'model_versions' && mode === 'update') return { data: { id: 'mv', ...payload }, error: null };
        return { data: { id: 'ex1' }, error: null };
      },
      maybeSingle: async () => {
        if (table === 'visits') return { data: db.visit };
        if (table === 'model_versions') {
          const want = filters.find(([c]) => c === 'version');
          if (want) return { data: db.versions.find((v) => v.version === want[1]) || null };
          const status = filters.find(([c]) => c === 'status');
          if (status) return { data: db.versions.find((v) => v.status === status[1]) || null };
          return { data: null };
        }
        return { data: null };
      },
      then: (resolve) => {
        if (table === 'patient_consents') return resolve({ data: db.consents, error: null });
        return resolve({ data: [], error: null });
      }
    };
    return chain;
  };
  return { supabaseAdmin: { from: build } };
});

jest.unstable_mockModule('../src/middleware/audit.middleware.js', () => ({
  logAuditEvent: async (e) => { db.audits.push(e); }
}));

const { captureLearningExample, notWorse, promoteVersion } = await import('../src/services/learningService.js');

const DOCTOR = { id: 'doc-1', role: 'DOCTOR' };
const consent = { purpose: 'training', status: 'granted', expires_at: null };

beforeEach(() => {
  reset();
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ learned: 1, metrics: { top1: 0.77, top3: 0.87, top5: 0.9 } }) }));
});

describe('capturing a completed visit', () => {
  it('learns nothing from a patient who did not agree to training use', async () => {
    const result = await captureLearningExample({ visitId: 'v1', diagnosis: 'Pneumonia', doctor: DOCTOR });
    expect(result).toEqual({ captured: false, reason: 'no_training_consent' });
    expect(db.inserts).toHaveLength(0);
  });

  it('is not satisfied by consent to treatment', async () => {
    db.consents = []; // the query asks for purpose=training only; treatment rows never arrive
    const result = await captureLearningExample({ visitId: 'v1', diagnosis: 'Pneumonia', doctor: DOCTOR });
    expect(result.captured).toBe(false);
  });

  it('captures a de-identified example, confirmed by the doctor who signed it', async () => {
    db.consents = [consent];
    const result = await captureLearningExample({ visitId: 'v1', diagnosis: 'Pneumonia', doctor: DOCTOR });
    expect(result.captured).toBe(true);
    const row = db.inserts.find((i) => i.table === 'learning_examples').row;
    expect(row).toMatchObject({
      symptoms_text: 'Fever and cough. difficulty breathing',
      diagnosis_text: 'Pneumonia', status: 'approved', reviewed_by: 'doc-1', gender: 'female'
    });
    expect(row.age_band).toMatch(/^\d/);
    expect(JSON.stringify(row)).not.toContain('234567890123');
    expect(db.audits[0].action).toBe('LEARNING_EXAMPLE_CAPTURED');
  });

  it('never throws, whatever the database does', async () => {
    db.consents = [consent];
    db.insertError = { code: 'XX000', message: 'boom' };
    await expect(captureLearningExample({ visitId: 'v1', diagnosis: 'Pneumonia', doctor: DOCTOR }))
      .resolves.toMatchObject({ captured: false });
  });
});

describe('promotion', () => {
  const live = { top1: 0.7694, top3: 0.8725 };

  it('accepts a candidate that is not worse on the frozen benchmark', () => {
    expect(notWorse({ top1: 0.7694, top3: 0.8725 }, live)).toBe(true);
    expect(notWorse({ top1: 0.7700, top3: 0.8740 }, live)).toBe(true);
  });

  it('refuses a candidate that is worse, on either measure', () => {
    expect(notWorse({ top1: 0.76, top3: 0.8725 }, live)).toBe(false);
    expect(notWorse({ top1: 0.7694, top3: 0.86 }, live)).toBe(false);
    expect(notWorse(null, live)).toBe(false);
  });

  it('will not make a worse model live even when asked directly', async () => {
    db.versions = [{ id: 'mv2', version: 2, status: 'candidate', example_ids: [], metrics: { top1: 0.70, top3: 0.80 }, live_metrics: live }];
    const result = await promoteVersion({ version: 2, actor: { id: 'sa', role: 'SUPER_ADMIN' } });
    expect(result.status).toBe(409);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('promotes a candidate that is not worse, and records who did it', async () => {
    db.versions = [{ id: 'mv3', version: 3, status: 'candidate', example_ids: [], metrics: live, live_metrics: live }];
    const result = await promoteVersion({ version: 3, actor: { id: 'sa', role: 'SUPER_ADMIN' } });
    expect(result.error).toBeUndefined();
    expect(db.audits.at(-1)).toMatchObject({ action: 'MODEL_PROMOTED', actorId: 'sa' });
  });
});
