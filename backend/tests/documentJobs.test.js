/**
 * Asynchronous document extraction: the cache and the job lifecycle.
 *
 * Two things here are load-bearing and neither is about speed.
 *
 * The cache key is (image hash, patient). The hash alone would be a
 * cross-patient leak — two patients handed the same photographed page would
 * read each other's extraction — and the test below fixes that boundary so a
 * later "optimisation" cannot quietly widen it.
 *
 * The job must always reach a terminal state. A failed or hung model call that
 * leaves a job at 'running' leaves the operator watching a spinner with no
 * result and no manual-entry form, which is worse than the synchronous version
 * this replaced.
 */
import { describe, expect, it, beforeEach, jest } from '@jest/globals';

/* ── a small stand-in for the document_jobs table ─────────────────────────── */

const db = { jobs: [], inserted: [], updates: [], notified: [] };

const makeChain = (table) => {
  const filters = {};
  const chain = {
    _table: table,
    select() { return chain; },
    eq(col, val) { filters[col] = val; return chain; },
    gt() { return chain; },
    in(col, vals) { filters[col] = { in: vals }; return chain; },
    lt(col, val) { filters[col] = { lt: val }; return chain; },
    order() { return chain; },
    limit() { return chain; },
    insert(rows) {
      db.inserted.push({ table, rows });
      const row = { id: `job-${db.inserted.length}`, status: 'queued', created_at: new Date().toISOString(), ...rows[0] };
      db.jobs.push(row);
      chain._row = row;
      return chain;
    },
    // Deferred, like the real client: `.update()` is called BEFORE the filters
    // that narrow it, so applying the patch here would match every row.
    update(patch) { chain._update = patch; return chain; },
    single: async () => ({ data: chain._row || null, error: null }),
    async maybeSingle() {
      const hit = db.jobs.find((j) =>
        (filters.patient_id === undefined || j.patient_id === filters.patient_id)
        && (filters.content_hash === undefined || j.content_hash === filters.content_hash)
        && (filters.status === undefined || j.status === filters.status)
        && (filters.id === undefined || j.id === filters.id)
        && (filters.requested_by === undefined || j.requested_by === filters.requested_by));
      return { data: hit || null, error: null };
    },
    then(resolve) {
      let data = null;
      if (chain._update) {
        db.updates.push({ table, patch: chain._update, filters: { ...filters } });
        const matched = db.jobs.filter((j) =>
          (filters.id === undefined || j.id === filters.id)
          && (filters.status?.in === undefined || filters.status.in.includes(j.status))
          && (filters.created_at?.lt === undefined || j.created_at < filters.created_at.lt));
        matched.forEach((j) => Object.assign(j, chain._update));
        data = matched.map((j) => ({ id: j.id }));
        chain._update = null;
      }
      return Promise.resolve({ data, error: null }).then(resolve);
    }
  };
  return chain;
};

jest.unstable_mockModule('../src/config/supabase.js', () => ({
  supabaseAdmin: { from: (table) => makeChain(table) }
}));

const ocr = { impl: async () => ({ extracted_data: { medications: [] }, raw_text: 'text', ocr_engine: 'gemini' }) };
jest.unstable_mockModule('../src/services/ocrService.js', () => ({
  processMedicalDocument: (...a) => ocr.impl(...a),
  readHealthCard: async () => ({ ok: false, fields: {} })
}));

jest.unstable_mockModule('../src/services/notificationService.js', () => ({
  notify: async (n) => { db.notified.push(n); return []; },
  EVENTS: { DOCUMENT_EXTRACTED: 'DOCUMENT_EXTRACTED' }
}));

const {
  contentHash, findFreshExtraction, createJob, processJob, getJob, recoverAbandonedJobs
} = await import('../src/services/documentJobs.js');

const file = (text) => ({ buffer: Buffer.from(text), mimetype: 'image/jpeg' });
const ACTOR = { id: 'ast-1', role: 'CLINIC_ASSISTANT', districtId: 'dist-1' };

beforeEach(() => {
  db.jobs = []; db.inserted = []; db.updates = []; db.notified = [];
  ocr.impl = async () => ({ extracted_data: { medications: [] }, raw_text: 'text', ocr_engine: 'gemini' });
});

describe('content hashing', () => {
  it('gives the same page the same fingerprint', () => {
    expect(contentHash([file('page-a')])).toBe(contentHash([file('page-a')]));
  });

  it('gives different pages different fingerprints', () => {
    expect(contentHash([file('page-a')])).not.toBe(contentHash([file('page-b')]));
  });

  it('treats a reordered multi-page document as a different document', () => {
    // The model reads the pages together, so order is part of the identity.
    const ab = contentHash([file('a'), file('b')]);
    const ba = contentHash([file('b'), file('a')]);
    expect(ab).not.toBe(ba);
  });

  it('ignores empty files rather than hashing undefined', () => {
    expect(contentHash([file('a'), { buffer: Buffer.alloc(0) }])).toBe(contentHash([file('a')]));
  });

  it('is a full sha-256', () => {
    expect(contentHash([file('x')])).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('jobs abandoned by a restart', () => {
  const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const justNow = new Date().toISOString();

  it('closes a job the last container died holding, with an answer the operator can act on', async () => {
    db.jobs.push({ id: 'job-stuck', status: 'running', created_at: old });

    expect(await recoverAbandonedJobs()).toBe(1);

    const row = db.jobs.find((j) => j.id === 'job-stuck');
    expect(row.status).toBe('failed');
    expect(row.error).toMatch(/upload it again/i);
    expect(row.finished_at).toBeTruthy();
  });

  it('closes one that never started, not only one that was running', async () => {
    db.jobs.push({ id: 'job-queued', status: 'queued', created_at: old });
    await recoverAbandonedJobs();
    expect(db.jobs.find((j) => j.id === 'job-queued').status).toBe('failed');
  });

  it('leaves a job younger than the model deadline alone', async () => {
    // It may be running this second — here, or in another instance later on.
    db.jobs.push({ id: 'job-live', status: 'running', created_at: justNow });

    expect(await recoverAbandonedJobs()).toBe(0);
    expect(db.jobs.find((j) => j.id === 'job-live').status).toBe('running');
  });

  it('does not reopen a job that already finished', async () => {
    db.jobs.push({ id: 'job-done', status: 'done', created_at: old, extraction: { medications: [] } });
    await recoverAbandonedJobs();
    expect(db.jobs.find((j) => j.id === 'job-done').status).toBe('done');
  });
});

describe('the cache never crosses a patient boundary', () => {
  const hash = contentHash([file('shared-page')]);

  beforeEach(() => {
    db.jobs.push({
      id: 'job-cached', patient_id: '000000000001', content_hash: hash,
      status: 'done', extraction: { medications: ['A'] }, raw_text: 'r', engine: 'gemini',
      expires_at: new Date(Date.now() + 3600e3).toISOString()
    });
  });

  it('returns the extraction for the same page and the same patient', async () => {
    const hit = await findFreshExtraction({ patientId: '000000000001', hash });
    expect(hit).not.toBeNull();
    expect(hit.extraction.medications).toEqual(['A']);
  });

  it('MISSES for the same page under a different patient', async () => {
    // The whole reason the key is compound. A shared family record or a reused
    // clinic template must never carry one patient's extraction to another.
    const hit = await findFreshExtraction({ patientId: '000000000002', hash });
    expect(hit).toBeNull();
  });

  it('misses for a different page under the same patient', async () => {
    const other = contentHash([file('different-page')]);
    expect(await findFreshExtraction({ patientId: '000000000001', hash: other })).toBeNull();
  });

  it('refuses to look up without a patient', async () => {
    expect(await findFreshExtraction({ patientId: null, hash })).toBeNull();
  });

  it('refuses to look up without a hash', async () => {
    expect(await findFreshExtraction({ patientId: '000000000001', hash: null })).toBeNull();
  });
});

describe('job lifecycle', () => {
  it('creates a job in the queued state carrying its requester', async () => {
    const job = await createJob({
      patientId: '000000000001', visitId: 'v-1', kind: 'prescription',
      hash: contentHash([file('p')]), actor: ACTOR
    });
    expect(job.id).toBeTruthy();
    const row = db.inserted[0].rows[0];
    expect(row.status).toBe('queued');
    expect(row.requested_by).toBe('ast-1');
    expect(row.expires_at).toBeTruthy();
  });

  it('runs to done, stores the draft and announces it', async () => {
    db.jobs.push({ id: 'job-1', requested_by: 'ast-1' });
    const out = await processJob({ jobId: 'job-1', files: [file('p')], kind: 'prescription', actor: ACTOR });

    expect(out.status).toBe('done');
    const done = db.updates.find((u) => u.patch.status === 'done');
    expect(done.patch.extraction).toEqual({ medications: [] });
    expect(done.patch.engine).toBe('gemini');
    expect(done.patch.finished_at).toBeTruthy();
    expect(db.notified[0].event).toBe('DOCUMENT_EXTRACTED');
  });

  it('marks running before it marks done, so a stuck job is visible', async () => {
    db.jobs.push({ id: 'job-1', requested_by: 'ast-1' });
    await processJob({ jobId: 'job-1', files: [file('p')], kind: 'prescription', actor: ACTOR });
    expect(db.updates[0].patch.status).toBe('running');
  });

  it('reaches a terminal state when the model throws', async () => {
    ocr.impl = async () => { throw new Error('provider exploded'); };
    db.jobs.push({ id: 'job-1', requested_by: 'ast-1' });
    const out = await processJob({ jobId: 'job-1', files: [file('p')], kind: 'prescription', actor: ACTOR });

    expect(out.status).toBe('failed');
    const failed = db.updates.find((u) => u.patch.status === 'failed');
    expect(failed.patch.error).toMatch(/provider exploded/);
    expect(db.notified.at(-1).payload.status).toBe('failed');
  });

  it('times out rather than hanging, and says so', async () => {
    process.env.OCR_DEADLINE_MS = '40';
    jest.resetModules();
    const fresh = await import('../src/services/documentJobs.js?timeout');
    // unref'd so the pending timer cannot hold Jest open after the assertion.
    ocr.impl = () => new Promise((r) => { const t = setTimeout(r, 5000); if (t.unref) t.unref(); });
    db.jobs.push({ id: 'job-t', requested_by: 'ast-1' });

    const out = await fresh.processJob({ jobId: 'job-t', files: [file('p')], kind: 'prescription', actor: ACTOR });
    expect(out.status).toBe('timeout');
    const timedOut = db.updates.find((u) => u.patch.status === 'timeout');
    expect(timedOut.patch.error).toMatch(/did not answer/i);
    delete process.env.OCR_DEADLINE_MS;
  }, 10000);

  it('still finishes the job when writing the document row fails', async () => {
    db.jobs.push({ id: 'job-1', requested_by: 'ast-1' });
    const out = await processJob({
      jobId: 'job-1', files: [file('p')], kind: 'prescription', actor: ACTOR,
      onExtracted: async () => { throw new Error('insert failed'); }
    });
    // The extraction succeeded; only its filing failed. The operator must still
    // get their draft rather than a job stuck at 'running'.
    expect(out.status).toBe('done');
    expect(db.updates.find((u) => u.patch.status === 'done')).toBeTruthy();
  });

  it('announces nothing when there is nobody to announce to', async () => {
    db.jobs.push({ id: 'job-1' });
    await processJob({ jobId: 'job-1', files: [file('p')], kind: 'prescription', actor: null });
    expect(db.notified).toHaveLength(0);
  });

  it('never puts the extraction itself in the notification payload', async () => {
    db.jobs.push({ id: 'job-1', requested_by: 'ast-1' });
    await processJob({ jobId: 'job-1', files: [file('p')], kind: 'prescription', actor: ACTOR });
    const payload = db.notified[0].payload;
    expect(payload.job_id).toBeTruthy();
    // A draft duplicated into notifications would sit outside every control
    // that governs patient documents.
    expect(payload.extraction).toBeUndefined();
    expect(JSON.stringify(payload)).not.toMatch(/medications/);
  });
});

describe('reading a job back', () => {
  it('returns the job to the person who asked for it', async () => {
    db.jobs.push({ id: 'job-9', requested_by: 'ast-1', status: 'done', extraction: { a: 1 } });
    const job = await getJob('job-9', ACTOR);
    expect(job.status).toBe('done');
  });

  it('does not return another user’s job', async () => {
    db.jobs.push({ id: 'job-9', requested_by: 'someone-else', status: 'done' });
    expect(await getJob('job-9', ACTOR)).toBeNull();
  });
});
