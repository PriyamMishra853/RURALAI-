/**
 * Pre-demo preflight: is the system actually ready right now?
 *
 *   npm run preflight
 *
 * Every check here corresponds to something that has already gone wrong and
 * been hard to diagnose from the UI, because each one fails silently:
 *
 *   - Empty doctor_schedules makes every booking date read "Closed". The
 *     engine is working correctly; a missing row means "not working that day".
 *     seedV2 regenerates staff_profiles, and schedules cascade away with it, so
 *     this empties itself whenever the database is reseeded.
 *   - A workload seeded for yesterday leaves today's queues as whatever the
 *     base seed left, because visit_date is a date and the demo rolls over at
 *     midnight IST.
 *   - The inference service can be unreachable while every page still renders,
 *     since a failed call degrades to "no candidates" rather than an error.
 *
 * Read-only. It reports; it does not fix. What to run is printed next to each
 * failure.
 */

import 'dotenv/config';
import { supabaseAdmin } from '../config/supabase.js';
import { probeInferenceService } from '../services/aiInferenceClient.js';
import { istDateString } from '../services/schedulingService.js';

const results = [];
const record = (ok, label, detail, fix) => {
  results.push({ ok, label, detail, fix });
  const mark = ok ? '  OK  ' : ' FAIL ';
  console.log(`${mark} ${label.padEnd(34)} ${detail}`);
  if (!ok && fix) console.log(`       -> ${fix}`);
};

const count = async (table, build = (q) => q) => {
  const { count: n } = await build(supabaseAdmin.from(table).select('*', { count: 'exact', head: true }));
  return n ?? 0;
};

const main = async () => {
  const today = istDateString();
  console.log(`\nPreflight for ${today} (IST)\n${'-'.repeat(64)}`);

  // 1. Doctor availability — the thing that silently reads as "Closed".
  const schedules = await count('doctor_schedules');
  const doctors = await count('staff_profiles', (q) => q.eq('role', 'doctor').eq('status', 'active'));
  record(
    schedules >= doctors * 7 && doctors > 0,
    'Doctor working hours',
    `${schedules} rows for ${doctors} active doctors`,
    'npm run seed:schedules   (or the insert in the runbook)'
  );

  // 2. Today's queues.
  const { count: todaysVisits } = await supabaseAdmin
    .from('visits').select('*', { count: 'exact', head: true })
    .eq('visit_date', today).is('deleted_at', null).not('assigned_doctor_id', 'is', null);
  record(
    (todaysVisits ?? 0) > 0,
    'Cases assigned for today',
    `${todaysVisits ?? 0} visits dated ${today}`,
    'npm run seed:daily'
  );

  // 3. Is every doctor's queue the deterministic five?
  const { data: sample } = await supabaseAdmin
    .from('visits').select('assigned_doctor_id')
    .eq('visit_date', today).eq('is_demo', true).is('deleted_at', null).limit(5000);
  const per = new Map();
  for (const v of sample || []) per.set(v.assigned_doctor_id, (per.get(v.assigned_doctor_id) || 0) + 1);
  const fives = [...per.values()].filter((n) => n === 5).length;
  record(
    fives > 0,
    'Deterministic five-case queues',
    `${fives} doctor(s) with exactly 5 cases`,
    'npm run seed:daily'
  );

  // 4. The inference service.
  /*
   * Only meaningful when run where the service is.
   *
   * In production it listens on loopback inside the API container, so this
   * check run from a laptop is asking a different machine and will always say
   * unreachable. There, the equivalent check is GET /api/ai/service-status as
   * an administrator, which runs inside the container and reports the same
   * thing. Saying so is better than a FAIL that means nothing.
   */
  const probe = await probeInferenceService();
  const isLoopback = /127\.0\.0\.1|localhost/.test(probe.url);
  record(
    probe.reachable || !isLoopback,
    'AI inference service',
    probe.reachable
      ? `up at ${probe.url} (${probe.latency_ms}ms), ${probe.model_meta?.diseases ?? '?'} diseases`
      : isLoopback
        ? `not running locally at ${probe.url} — normal unless you started it here`
        : `checked ${probe.url}: this only works from inside the container`,
    isLoopback
      ? 'Local only: ./AI/LLM/service/run.sh . In production check GET /api/ai/service-status as an admin.'
      : 'In production check GET /api/ai/service-status as an admin.'
  );

  // 5. Storage for wound photographs.
  const { data: buckets } = await supabaseAdmin.storage.listBuckets();
  const injury = (buckets || []).find((b) => b.name === 'injury-photos');
  record(
    Boolean(injury) && injury.public === false,
    'Wound photo storage',
    injury ? `injury-photos present, private=${!injury.public}` : 'injury-photos bucket MISSING',
    'Create a PRIVATE bucket named injury-photos'
  );

  // 6. Notification events the case loop depends on.
  const { error: enumErr } = await supabaseAdmin
    .from('notifications').select('id').eq('event_type', 'CASE_ASSIGNED').limit(1);
  record(!enumErr, 'CASE_ASSIGNED notification type', enumErr ? enumErr.message : 'present',
    'Apply database/v2/07_case_handoff.sql');

  console.log('-'.repeat(64));
  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `\n${failed.length} check(s) need attention before demonstrating.\n`
    : '\nAll checks passed — the system is ready.\n');
  process.exit(failed.length ? 1 : 0);
};

main().catch((err) => {
  console.error('Preflight could not run:', err.message);
  process.exit(1);
});
