import { supabaseAdmin } from '../config/supabase.js';
import { logAuditEvent } from '../middleware/audit.middleware.js';
import { isActive } from './consentRules.js';
import { ageBand } from './datasetRules.js';
import { ageFromDob } from './patientFields.js';

/**
 * The model learns from completed visits (Roadmap v3, Phase 5 / F3).
 *
 *   1. capture   A doctor signs a diagnosis. If the patient has an active
 *                training consent, the visit becomes a de-identified learning
 *                example. The doctor's signed review IS the label
 *                confirmation — a registered practitioner decided it.
 *   2. retrain   Shortly after, a candidate model is rebuilt automatically:
 *                the shipped base plus every approved example, scored on a
 *                frozen benchmark beside the live model.
 *   3. promote   The candidate goes live when an administrator promotes it —
 *                or automatically with LEARN_AUTO_PROMOTE=true — and in both
 *                cases only if it is not worse on the benchmark.
 *
 * The live model is always "base + this list", rebuilt on every start from
 * the database (restoreLiveModel), so a redeploy loses nothing and a rollback
 * is re-activating an earlier version.
 *
 * Every entry point here is called from inside another request or at boot,
 * and none of them may fail it: capture failures are logged and audited, and
 * the review goes on.
 */

const BASE_URL = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8001';
const LEARN_TIMEOUT_MS = Number(process.env.LEARN_TIMEOUT_MS) || 60000;
const RETRAIN_DELAY_MS = Number(process.env.LEARN_RETRAIN_DELAY_MS) || 30000;
// "Not worse" on the frozen benchmark: top-3 may not fall by more than this.
// A candidate is compared with the live model on identical rows, so a real
// regression shows; this only absorbs ties that round differently.
export const PROMOTION_TOLERANCE = 0.005;

/** The Python service, with a longer patience than diagnosis gets. */
const learnCall = async (path, body) => {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(LEARN_TIMEOUT_MS)
    });
    if (!res.ok) return { error: `inference service answered ${res.status}` };
    return { data: await res.json() };
  } catch (err) {
    return { error: `inference service unreachable: ${err.message}` };
  }
};

const first = (v) => (Array.isArray(v) ? v[0] : v) || null;

export const captureLearningExample = async ({ visitId, diagnosis, doctor, ip }) => {
  try {
    const { data: visit } = await supabaseAdmin
      .from('visits')
      .select('id, patient_id, district_id, chief_complaint, visit_symptoms ( description ), patients ( date_of_birth, gender )')
      .eq('id', visitId)
      .maybeSingle();
    if (!visit) return { captured: false, reason: 'visit_not_found' };

    // Consent is the gate. Treatment consent is not training consent.
    const { data: consents } = await supabaseAdmin
      .from('patient_consents')
      .select('purpose, status, expires_at')
      .eq('patient_id', visit.patient_id)
      .eq('purpose', 'training');
    if (!(consents || []).some((c) => isActive(c))) return { captured: false, reason: 'no_training_consent' };

    const symptoms = [visit.chief_complaint, ...(visit.visit_symptoms || []).map((s) => s.description)]
      .filter(Boolean)
      .join('. ')
      .slice(0, 2000);
    if (!symptoms.trim() || !String(diagnosis || '').trim()) return { captured: false, reason: 'nothing_to_learn' };

    const patient = first(visit.patients);
    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin.from('learning_examples').insert([{
      visit_id: visit.id,
      district_id: visit.district_id,
      symptoms_text: symptoms,
      diagnosis_text: String(diagnosis).trim().slice(0, 300),
      age_band: ageBand(ageFromDob(patient?.date_of_birth)),
      gender: patient?.gender || null,
      // The signed review is the confirmation: a registered doctor decided it.
      status: 'approved',
      reviewed_by: doctor.id,
      reviewed_at: now
    }]).select('id').single();

    if (error) {
      if (error.code === '23505') return { captured: false, reason: 'already_captured' };
      console.error('learning example not captured:', error.message);
      return { captured: false, reason: 'insert_failed' };
    }

    await logAuditEvent({
      actorId: doctor.id, actorRole: doctor.role, action: 'LEARNING_EXAMPLE_CAPTURED',
      entityType: 'VISITS', entityId: visit.id, metadata: { example_id: data.id }, ip
    });
    scheduleRetrain();
    return { captured: true, id: data.id };
  } catch (err) {
    console.error('learning capture failed:', err.message);
    return { captured: false, reason: 'error' };
  }
};

const examplesFor = async (ids) => {
  if (!ids?.length) return [];
  const { data } = await supabaseAdmin
    .from('learning_examples').select('id, symptoms_text, diagnosis_text').in('id', ids);
  return (data || []).map((e) => ({ id: e.id, symptoms_text: e.symptoms_text, diagnosis: e.diagnosis_text }));
};

const liveVersion = async () => {
  const { data } = await supabaseAdmin.from('model_versions').select('*').eq('status', 'live').maybeSingle();
  return data || null;
};

export const notWorse = (candidate, live) => {
  if (!candidate || !live) return false;
  return candidate.top3 >= live.top3 - PROMOTION_TOLERANCE && candidate.top1 >= live.top1 - PROMOTION_TOLERANCE;
};

/** Build a candidate from every approved example, and record it. */
export const buildCandidate = async ({ actor = null } = {}) => {
  const { data: approved, error } = await supabaseAdmin
    .from('learning_examples').select('id, symptoms_text, diagnosis_text').eq('status', 'approved').limit(20000);
  if (error) return { error: `examples could not be read: ${error.message}` };

  const { data: latest } = await supabaseAdmin
    .from('model_versions').select('version').order('version', { ascending: false }).limit(1).maybeSingle();
  const version = (latest?.version || 0) + 1;

  const { data: result, error: callError } = await learnCall('/learn/candidate', {
    version,
    examples: (approved || []).map((e) => ({ id: e.id, symptoms_text: e.symptoms_text, diagnosis: e.diagnosis_text }))
  });
  if (callError) return { error: callError };

  // Say what the model made of each example, so an unmatched diagnosis can be
  // seen and mapped by a person rather than silently teaching nothing.
  for (const outcome of result.outcomes || []) {
    await supabaseAdmin.from('learning_examples')
      .update({ last_outcome: outcome.outcome, mapped_label: outcome.label || null })
      .eq('id', outcome.id);
  }

  const learnedIds = (result.outcomes || []).filter((o) => o.outcome === 'learned').map((o) => o.id);
  const { data: row, error: insertError } = await supabaseAdmin.from('model_versions').insert([{
    version,
    status: 'candidate',
    example_ids: learnedIds,
    learned: learnedIds.length,
    metrics: result.candidate?.metrics || null,
    live_metrics: result.live?.metrics || null,
    created_by: actor?.id || null
  }]).select('*').single();
  if (insertError) return { error: `candidate not recorded: ${insertError.message}` };

  if (actor) {
    await logAuditEvent({
      actorId: actor.id, actorRole: actor.role, action: 'MODEL_CANDIDATE_BUILT',
      entityType: 'MODEL', entityId: row.id, metadata: { version, learned: learnedIds.length }
    });
  }

  // Opt-in: promote on its own when the benchmark says it is not worse.
  if (process.env.LEARN_AUTO_PROMOTE === 'true' && learnedIds.length && notWorse(row.metrics, row.live_metrics)) {
    await promoteVersion({ version, actor: null, reason: 'auto' });
  }

  return { version: row, outcomes: result.outcomes, benchmark: result.benchmark };
};

/** Make a version live. Refuses one that is worse than the live model. */
export const promoteVersion = async ({ version, actor, reason = 'manual' }) => {
  const { data: target } = await supabaseAdmin.from('model_versions').select('*').eq('version', version).maybeSingle();
  if (!target) return { status: 404, error: 'No such model version.' };
  if (target.status === 'live') return { status: 409, error: 'That version is already live.' };
  if (!notWorse(target.metrics, target.live_metrics)) {
    return { status: 409, error: 'This candidate scores worse than the live model on the frozen benchmark, so it is not promoted.' };
  }

  const examples = await examplesFor(target.example_ids);
  const { data: activated, error } = await learnCall('/learn/activate', { version, examples });
  if (error) return { status: 503, error: `The model could not be activated: ${error}` };

  const now = new Date().toISOString();
  await supabaseAdmin.from('model_versions').update({ status: 'retired' }).eq('status', 'live');
  const { data: row } = await supabaseAdmin.from('model_versions')
    .update({ status: 'live', promoted_at: now, promoted_by: actor?.id || null })
    .eq('version', version)
    .select('*')
    .single();

  await logAuditEvent({
    actorId: actor?.id || null, actorRole: actor?.role || null, action: 'MODEL_PROMOTED',
    entityType: 'MODEL', entityId: row?.id || null,
    metadata: { version, learned: activated.learned, metrics: activated.metrics, reason }
  });
  return { version: row, metrics: activated.metrics };
};

/**
 * Put the live model back after a restart. The inference service starts empty
 * — the shipped base — and learns nothing until it is told the list again.
 * Retries for a while, because the Python service may come up after Node.
 */
export const restoreLiveModel = async ({ attempts = 12, delayMs = 10000 } = {}) => {
  const live = await liveVersion();
  if (!live) return { restored: false, reason: 'no_live_version' };
  const examples = await examplesFor(live.example_ids);
  for (let i = 0; i < attempts; i += 1) {
    const { data, error } = await learnCall('/learn/activate', { version: live.version, examples });
    if (!error) {
      console.log(`Model version ${live.version} restored (${data.learned} learned example(s)).`);
      return { restored: true, version: live.version };
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  console.warn(`Model version ${live.version} could not be restored; the shipped base model is serving.`);
  return { restored: false, reason: 'service_unreachable' };
};

let retrainTimer = null;
/** Several visits closing at once should cost one rebuild, not several. */
export const scheduleRetrain = () => {
  if (retrainTimer) return;
  retrainTimer = setTimeout(async () => {
    retrainTimer = null;
    const result = await buildCandidate();
    if (result.error) console.warn('automatic retrain failed:', result.error);
    else console.log(`Candidate model v${result.version.version} built from ${result.version.learned} example(s).`);
  }, RETRAIN_DELAY_MS);
  retrainTimer.unref?.();
};

export const learningStatus = async () => {
  const count = async (status) => {
    const { count: n } = await supabaseAdmin.from('learning_examples')
      .select('*', { count: 'exact', head: true }).eq('status', status);
    return n || 0;
  };
  const outcome = async (value) => {
    const { count: n } = await supabaseAdmin.from('learning_examples')
      .select('*', { count: 'exact', head: true }).eq('last_outcome', value);
    return n || 0;
  };
  const [approved, rejected, learned, unmatched, noSymptoms, live, { data: candidate }, service] = await Promise.all([
    count('approved'), count('rejected'), outcome('learned'), outcome('unmatched_diagnosis'),
    outcome('no_symptoms_matched'), liveVersion(),
    supabaseAdmin.from('model_versions').select('*').eq('status', 'candidate')
      .order('version', { ascending: false }).limit(1).maybeSingle(),
    learnCall('/learn/status')
  ]);
  return {
    examples: { approved, rejected, learned, unmatched_diagnosis: unmatched, no_symptoms_matched: noSymptoms },
    live: live || null,
    candidate: candidate || null,
    service: service.data || { error: service.error },
    auto_promote: process.env.LEARN_AUTO_PROMOTE === 'true'
  };
};
