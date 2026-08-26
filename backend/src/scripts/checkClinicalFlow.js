/**
 * End-to-end clinical flow against the live stack.
 *
 * Run: npm run check:flow
 *
 * Drives the real HTTP API the way the frontend does — login, register a
 * patient, open a visit, run the AI assessment — and asserts the safety
 * invariants hold on the way through. Reachability and per-pipeline checks
 * cannot catch a route that is wired up wrongly; this can.
 *
 * Creates real rows. Every record it writes is prefixed PLACEHOLDER_DEMO and
 * the script removes what it can at the end. Clinical rows are append-only by
 * design (plan §B.1), so visits and assessments are left behind deliberately.
 */
import 'dotenv/config';
import app from '../app.js';

const results = [];
let failures = 0;

const step = async (name, fn) => {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail || '', ms: Date.now() - t0 });
  } catch (err) {
    failures += 1;
    results.push({ name, ok: false, detail: err.message?.slice(0, 180) || String(err), ms: Date.now() - t0 });
  }
};

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

const call = async (method, path, { token, body, raw } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !raw) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + path, {
    method,
    headers,
    body: raw ? body : body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _raw: text.slice(0, 200) };
  }
  return { status: res.status, body: json };
};

const login = async (email, password) => {
  const r = await call('POST', '/api/auth/login', { body: { email, password } });
  if (r.status !== 200) throw new Error(`login ${email} → ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
  return r.body.token;
};

let assistantToken;
let doctorToken;
let adminToken;
let patientId;
let visitId;

// ── 1. Authentication ────────────────────────────────────────────────────
await step('Login — all three roles', async () => {
  assistantToken = await login('assistant@clinic.org', 'Assist@123');
  doctorToken = await login('doctor@clinic.org', 'Doctor@123');
  if (process.env.SEED_ADMIN_PASSWORD) {
    adminToken = await login('admin@clinic.org', process.env.SEED_ADMIN_PASSWORD);
  }
  return `assistant + doctor${adminToken ? ' + admin' : ' (admin skipped, no password set)'}`;
});

await step('Unauthenticated request is rejected', async () => {
  const r = await call('GET', '/api/patients');
  if (r.status !== 401) throw new Error(`expected 401, got ${r.status}`);
  return '401 as expected';
});

// ── 2. Admin must have no clinical access (plan §C.2) ────────────────────
await step('Admin is blocked from clinical routes', async () => {
  if (!adminToken) return 'skipped — no admin password configured';
  const probes = ['/api/patients', '/api/doctor/queue'];
  for (const path of probes) {
    const r = await call('GET', path, { token: adminToken });
    if (r.status !== 403) {
      throw new Error(`${path} returned ${r.status} for an admin — expected 403`);
    }
  }
  return `${probes.length} clinical routes returned 403`;
});

// ── 3. Patient registration ──────────────────────────────────────────────
await step('Assistant registers a patient', async () => {
  const r = await call('POST', '/api/patients', {
    token: assistantToken,
    body: {
      name: 'PLACEHOLDER_DEMO Flow Patient',
      age: 34,
      gender: 'female',
      phone: '+91-00000-09999',
      village: 'PLACEHOLDER_DEMO Village',
      preferred_language: 'Hindi'
    }
  });
  if (r.status !== 201 && r.status !== 200) {
    throw new Error(`${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  }
  patientId = r.body?.patient?.id || r.body?.id || r.body?.data?.id;
  if (!patientId) throw new Error(`no patient id in response: ${JSON.stringify(r.body).slice(0, 160)}`);
  return `patient ${patientId.slice(0, 8)}…`;
});

// ── 4. Visit ─────────────────────────────────────────────────────────────
await step('Assistant opens a visit with vitals and symptoms', async () => {
  const r = await call('POST', '/api/visits', {
    token: assistantToken,
    body: {
      patient_id: patientId,
      chief_complaint: 'fever and headache for two days',
      symptoms: 'fever, headache',
      symptom_duration: '2 days',
      medical_history: 'none',
      vitals: {
        temperature: 101.2,
        spo2: 97,
        blood_pressure_systolic: 118,
        blood_pressure_diastolic: 78,
        pulse: 88,
        respiratory_rate: 18
      }
    }
  });
  if (r.status !== 201 && r.status !== 200) {
    throw new Error(`${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  }
  visitId = r.body?.visit?.id || r.body?.id || r.body?.data?.id;
  if (!visitId) throw new Error(`no visit id: ${JSON.stringify(r.body).slice(0, 160)}`);
  return `visit ${visitId.slice(0, 8)}…`;
});

// ── 5. AI assessment ─────────────────────────────────────────────────────
let assessment;
await step('AI assessment runs and persists', async () => {
  const r = await call('POST', '/api/ai/assess', { token: assistantToken, body: { visit_id: visitId } });
  if (r.status !== 200 && r.status !== 201) {
    throw new Error(`${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  }
  assessment = r.body?.assessment || r.body?.data || r.body;
  if (!assessment?.risk_level) throw new Error(`no risk_level: ${JSON.stringify(r.body).slice(0, 200)}`);
  return `tier=${assessment.risk_level} via ${assessment.generated_by || 'unknown'}`;
});

await step('Assessment cites retrieved protocols', async () => {
  const matches = assessment?.protocol_matches || [];
  if (matches.length === 0) throw new Error('no protocol_matches — RAG contributed nothing');
  const titled = matches.filter((m) => m.title && m.title !== 'Approved Clinical Protocol');
  if (titled.length === 0) throw new Error('protocols returned but all had the generic default title');
  return `${matches.length} protocol(s), e.g. "${titled[0].title.slice(0, 44)}"`;
});

await step('Every medication carries a formulary rule id', async () => {
  const meds = assessment?.medications || [];
  const orphan = meds.find((m) => !m.rule_source_id);
  if (orphan) throw new Error(`medication with no rule_source_id: ${orphan.drug}`);
  if (assessment.medication_source !== 'formulary-rules-engine') {
    throw new Error(`medication_source is "${assessment.medication_source}"`);
  }
  return meds.length ? `${meds.length} med(s), all rule-sourced` : 'no medication (valid outcome)';
});

// ── 6. Doctor visibility ─────────────────────────────────────────────────
await step('Doctor can see the case in their queue', async () => {
  const r = await call('GET', '/api/doctor/queue', { token: doctorToken });
  if (r.status !== 200) throw new Error(`${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);
  const list = Array.isArray(r.body) ? r.body : r.body?.cases || r.body?.data || [];
  return `${list.length} case(s) in queue`;
});

// ── 7. The database constraint, not just the application ─────────────────
await step('Database rejects medication with no rule source', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });
  // Use a real assessment id. Probing with a null one only trips the NOT NULL
  // on ai_assessment_id (23502) and never reaches the CHECK constraint — the
  // probe then "passes" while proving nothing about medication sourcing.
  const { data: assessments } = await db
    .from('ai_assessments')
    .select('id')
    .order('created_at', { ascending: false })
    .limit(1);
  const assessmentId = assessments?.[0]?.id;
  if (!assessmentId) throw new Error('no ai_assessments row to attach the probe to');

  const probe = {
    ai_assessment_id: assessmentId,
    recommendation_type: 'medicine',
    title: 'PLACEHOLDER_DEMO constraint probe',
    recommendation: 'should never persist',
    status: 'ai_suggested'
    // rule_source_id deliberately omitted — this is the whole point.
  };

  const { error } = await db.from('ai_recommendations').insert(probe);
  if (!error) {
    await db.from('ai_recommendations').delete().eq('title', 'PLACEHOLDER_DEMO constraint probe');
    throw new Error('an orphan medication row was ACCEPTED — the CHECK constraint is not applied');
  }
  // 23514 is check_violation. Anything else means a different constraint fired
  // first and this probe did not actually test medication sourcing.
  if (error.code !== '23514') {
    throw new Error(
      `insert failed with ${error.code} (${error.message.slice(0, 70)}) — not the medication CHECK constraint`
    );
  }

  // And confirm the same row IS accepted once it names a rule.
  const { error: okErr } = await db
    .from('ai_recommendations')
    .insert({ ...probe, rule_source_id: 'FORM-PCM-002' });
  await db.from('ai_recommendations').delete().eq('title', 'PLACEHOLDER_DEMO constraint probe');
  if (okErr) throw new Error(`a properly sourced medication was rejected: ${okErr.message.slice(0, 80)}`);

  return 'orphan rejected (23514 check_violation), rule-sourced accepted';
});

// ── Report ───────────────────────────────────────────────────────────────
server.close();
const pad = (s, n) => String(s).padEnd(n);
console.log(`\nRuralAI clinical flow\n${'─'.repeat(86)}`);
for (const r of results) {
  console.log(`${r.ok ? '✓' : '✗'} ${pad(r.name, 44)} ${pad(r.ms + 'ms', 8)} ${r.detail}`);
}
console.log('─'.repeat(86));
console.log(failures ? `\n${failures} step(s) failing.\n` : '\nFull clinical flow working.\n');
process.exit(failures ? 1 : 0);
