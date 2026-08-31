/**
 * Client for the Python inference service (AI/LLM/service).
 *
 * The trained models live in Python because that is where scikit-learn lives.
 * Node calls them over HTTP on localhost rather than shelling out per request,
 * so model load happens once at service start instead of on every assessment.
 *
 * Every call fails soft. If the service is down the clinical pipeline must
 * still run — the rules engine and the LLM path do not depend on it, and a
 * missing candidate list degrades the assessment rather than breaking it.
 * What it must never do is silently substitute a guess.
 */

const BASE_URL = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8001';
const TIMEOUT_MS = Number(process.env.AI_SERVICE_TIMEOUT_MS) || 6000;

let lastFailureAt = 0;
const CIRCUIT_COOLDOWN_MS = 30000;

/**
 * Skip the call entirely for a while after a failure.
 *
 * Without this, an assessment run while the service is down waits the full
 * timeout on every request — turning a degraded feature into a slow page.
 */
const circuitOpen = () => Date.now() - lastFailureAt < CIRCUIT_COOLDOWN_MS;

const call = async (path, { method = 'GET', body } = {}) => {
  if (circuitOpen()) return null;

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!res.ok) {
      lastFailureAt = Date.now();
      console.warn(`AI service ${path} -> ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    lastFailureAt = Date.now();
    console.warn(`AI service ${path} unreachable: ${err.message}`);
    return null;
  }
};

export const aiServiceHealth = () => call('/health');

/**
 * Pipeline 1 — ranked disease candidates from recorded symptoms.
 *
 * Returns null when unavailable, which callers must treat as "no candidates",
 * never as "no disease".
 */
export const getDiseaseCandidates = async ({ text, symptoms = [], topK = 5 }) =>
  call('/diagnose', { method: 'POST', body: { text: text || '', symptoms, top_k: topK } });

/**
 * Pipeline 2 — what is actually purchasable for a molecule the signed
 * formulary already selected. Never used to choose a molecule.
 */
export const getMedicineAvailability = async (molecule, strength) =>
  call('/medicine-availability', { method: 'POST', body: { molecule, strength } });

export const getPrecautions = async (disease) =>
  call(`/precautions/${encodeURIComponent(disease)}`);

export const aiServiceConfigured = () => Boolean(BASE_URL);

/**
 * Diagnostic probe — deliberately ignores the circuit breaker.
 *
 * `call()` short-circuits for 30s after a failure, which is right for the
 * clinical path and wrong for a health check: an operator asking "is it up?"
 * during that window would be told nothing, and would be told the same thing
 * whether the service was down or had merely failed once a moment ago.
 *
 * Returns the service's own health payload, the URL it was asked for, and how
 * long it took. No patient data is involved.
 */
export const probeInferenceService = async () => {
  const startedAt = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const latencyMs = Date.now() - startedAt;

    if (!res.ok) {
      return { reachable: false, url: BASE_URL, latency_ms: latencyMs, error: `HTTP ${res.status}` };
    }

    const body = await res.json();
    return {
      reachable: true,
      url: BASE_URL,
      latency_ms: latencyMs,
      status: body?.status ?? null,
      models: body?.models ?? null,
      model_meta: body?.meta
        ? { model: body.meta.model, trained_at: body.meta.trained_at, diseases: body.meta.diseases_kept }
        : null
    };
  } catch (err) {
    return { reachable: false, url: BASE_URL, latency_ms: Date.now() - startedAt, error: err.message };
  }
};
