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
  const tables = ['states', 'districts', 'staff_profiles', 'patients', 'visits', 'ai_assessments', 'consultations'];
  const missing = [];
  for (const table of tables) {
    // `select('*')`, not `select('id')`: patients is keyed on aadhaar_number
    // and has no id column, so naming a column made a healthy table look
    // missing with error 42703 (undefined column).
    const { error } = await db.from(table).select('*').limit(1);
    if (error) missing.push(`${table} (${error.code || error.message?.slice(0, 40)})`);
  }
  if (missing.length) {
    throw new Error(
      `${missing.length}/${tables.length} tables missing — run \`npm run db:apply -- --confirm\`. First: ${missing[0]}`
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

await check('Realtime — notifications + call signalling', true, async () => {
  // Notifications and WebRTC signalling share this one authenticated socket.
  //
  // An unauthenticated connection MUST be refused: the socket admits a caller
  // into a live consultation, so anyone who could open it without a token
  // could join a doctor's call. A 401 here is the pass condition, not a
  // failure — this check asserts the door is locked, and that the server is
  // up enough to lock it.
  const { WebSocket } = await import('ws');
  const port = config.port || 5000;
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/realtime`);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('no response within 5s — is the server running?'));
    }, 5000);

    ws.on('open', () => {
      clearTimeout(timer);
      ws.close();
      reject(new Error('SECURITY: /realtime accepted a connection with no token'));
    });
    ws.on('error', (e) => {
      clearTimeout(timer);
      if (/401/.test(e.message)) resolve('reachable; rejects unauthenticated sockets (401)');
      else reject(new Error(e.message));
    });
  });
});

await check('TURN relay', false, async () => {
  // Not fatal, because the server falls back to a free public relay — but a
  // shared free tier is not something to run a clinic on unknowingly, so an
  // unset TURN_URL is still reported.
  const configured = process.env.TURN_URL || process.env.VITE_TURN_URL;
  if (!configured) {
    throw new Error(
      'no dedicated TURN server configured — falling back to the free public Open Relay. '
      + 'Cross-network calls will connect, but on a shared tier with no capacity guarantee.'
    );
  }
  return configured.split(',').map((u) => u.trim()).filter(Boolean).join(', ');
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
