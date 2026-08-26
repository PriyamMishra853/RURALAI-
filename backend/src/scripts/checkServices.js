/**
 * Live connectivity check for every external service.
 *
 * Run: npm run check
 *
 * This is deliberately NOT part of the Jest suite. The test suite injects fakes
 * so CI stays free, deterministic and never spends AI quota; this script is the
 * opposite — it makes real calls, so it catches wiring and credential problems
 * that no unit test can see. Plan §H.3.
 *
 * It never prints a secret. Failures report the provider's message, which is
 * what you actually need to fix the problem.
 */
import '../config/env.js';
import { config } from '../config/env.js';

const results = [];

const check = async (name, required, fn) => {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, status: 'OK', detail: detail || '', ms: Date.now() - started, required });
  } catch (err) {
    results.push({
      name,
      status: 'FAIL',
      detail: err.message?.slice(0, 160) || String(err),
      ms: Date.now() - started,
      required
    });
  }
};

const requireEnv = (value, label) => {
  if (!value) throw new Error(`${label} is not set in backend/.env`);
  return value;
};

await check('Supabase — Auth', true, async () => {
  requireEnv(config.supabase.url, 'SUPABASE_URL');
  requireEnv(config.supabase.anonKey, 'SUPABASE_ANON_KEY');
  const res = await fetch(`${config.supabase.url}/auth/v1/health`, {
    headers: { apikey: config.supabase.anonKey }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
  return 'reachable';
});

await check('Supabase — REST / schema', true, async () => {
  const key = requireEnv(config.supabase.serviceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY');
  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(config.supabase.url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // Probe the tables the clinical path actually needs.
  //
  // Use a real row select, NOT `{ head: true, count: 'exact' }` — a HEAD count
  // against a table that does not exist returns no error, so the head form
  // reports a completely empty database as healthy. That false pass cost an
  // hour; do not "simplify" this back.
  const tables = ['staff_profiles', 'patients', 'visits', 'ai_assessments', 'ai_recommendations'];
  const missing = [];
  for (const table of tables) {
    const { error } = await db.from(table).select('id').limit(1);
    if (error) missing.push(`${table} (${error.code || error.message?.slice(0, 40)})`);
  }
  if (missing.length) {
    throw new Error(
      `${missing.length}/${tables.length} tables missing — run database/schema.sql. First: ${missing[0]}`
    );
  }
  return `${tables.length} core tables present`;
});

await check('Groq — assessment + Whisper', true, async () => {
  const key = requireEnv(config.groq.apiKey, 'GROQ_API_KEY');
  const res = await fetch('https://api.groq.com/openai/v1/models', {
    headers: { Authorization: `Bearer ${key}` }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
  const body = await res.json();
  return `${body.data?.length ?? 0} models available`;
});

await check('Gemini — wound vision', true, async () => {
  const key = requireEnv(config.gemini.apiKey, 'GEMINI_API_KEY');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
  const body = await res.json();
  return `${body.models?.length ?? 0} models available`;
});

await check('Qdrant — protocol corpus', false, async () => {
  const url = requireEnv(config.qdrant.url, 'QDRANT_URL');
  const key = requireEnv(config.qdrant.apiKey, 'QDRANT_API_KEY');
  const res = await fetch(`${url.replace(/\/$/, '')}/collections`, { headers: { 'api-key': key } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
  const body = await res.json();
  const names = (body.result?.collections || []).map((c) => c.name);
  return names.length ? `collections: ${names.join(', ')}` : 'reachable, no collections yet';
});

await check('LiveKit — video', false, async () => {
  const url = requireEnv(process.env.LIVEKIT_URL, 'LIVEKIT_URL');
  requireEnv(process.env.LIVEKIT_API_KEY, 'LIVEKIT_API_KEY');
  requireEnv(process.env.LIVEKIT_API_SECRET, 'LIVEKIT_API_SECRET');
  const httpUrl = url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
  const res = await fetch(httpUrl, { method: 'GET' });
  // LiveKit's root returns 200 with "OK" for a healthy deployment.
  if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
  return `endpoint reachable (HTTP ${res.status})`;
});

await check('Model availability', true, async () => {
  const { verifyModelsAvailable } = await import('../config/models.js');
  const checks = await verifyModelsAvailable();
  const dead = checks.filter((c) => !c.available);
  if (dead.length) {
    throw new Error(dead.map((d) => `${d.model} (${d.provider}) ${d.detail}`).join(' | '));
  }
  return checks.map((c) => c.model).join(', ');
});

await check('Formulary signature gate', true, async () => {
  const { isFormularySigned } = await import('../data/formulary.js');
  const requiring =
    process.env.REQUIRE_SIGNED_FORMULARY === 'true' ||
    (config.isProduction && process.env.REQUIRE_SIGNED_FORMULARY !== 'false');
  if (isFormularySigned()) return 'formulary is SIGNED';
  return requiring
    ? 'UNSIGNED — medication suppressed entirely (safe default)'
    : 'UNSIGNED — medication emitted with warning labels (demo mode)';
});

// ---- Report ----
const pad = (s, n) => String(s).padEnd(n);
console.log('\nRuralAI service check\n' + '─'.repeat(72));
for (const r of results) {
  const icon = r.status === 'OK' ? '✓' : r.required ? '✗' : '!';
  console.log(`${icon} ${pad(r.name, 30)} ${pad(r.status, 6)} ${pad(r.ms + 'ms', 8)} ${r.detail}`);
}
console.log('─'.repeat(72));

const requiredFailures = results.filter((r) => r.status === 'FAIL' && r.required);
const optionalFailures = results.filter((r) => r.status === 'FAIL' && !r.required);

if (optionalFailures.length) {
  console.log(`${optionalFailures.length} optional service(s) unavailable — features degrade, app runs.`);
}
if (requiredFailures.length) {
  console.log(`\n${requiredFailures.length} REQUIRED service(s) failed. The clinical path will not work.\n`);
  process.exit(1);
}
console.log('All required services reachable.\n');
