/**
 * Groq API key pool.
 *
 * Four keys were supplied. They are a capacity pool, not four spare copies of
 * one key — and under the demo condition in §3.1 (one doctor device, several
 * assistant devices, all running assessments at once) a single key hits its
 * rate limit almost immediately. Every Groq call therefore goes through here.
 *
 * Behaviour:
 *   - round-robin across all configured keys
 *   - a 429 benches that key for the cooldown the provider asks for
 *   - a 401/403 retires the key permanently (bad key, not a busy one)
 *   - if every key is benched, the caller waits for the soonest one rather
 *     than silently falling back to the non-AI path — a degraded assessment
 *     that looks normal is worse than one that takes two seconds longer
 */

import Groq from 'groq-sdk';

const KEY_VARS = ['GROQ_API_KEY', 'Groq_API_Key1', 'Groq_API_Key2', 'Groq_API_Key3'];

/** Provider-suggested cooldown when it does not send Retry-After. */
const DEFAULT_COOLDOWN_MS = 20000;
const MAX_WAIT_MS = 30000;

class PooledKey {
  constructor(name, value) {
    this.name = name;
    this.value = value;
    this.client = new Groq({ apiKey: value });
    this.benchedUntil = 0;
    this.retired = false;
    this.calls = 0;
    this.rateLimitHits = 0;
  }

  get available() {
    return !this.retired && Date.now() >= this.benchedUntil;
  }

  bench(ms) {
    this.benchedUntil = Date.now() + ms;
    this.rateLimitHits += 1;
  }

  retire(reason) {
    this.retired = true;
    console.error(`Groq key ${this.name} retired: ${reason}`);
  }
}

const keys = KEY_VARS
  .map((name) => [name, process.env[name]])
  .filter(([, value]) => value && value.trim())
  // Two env vars holding the same key would double the apparent capacity and
  // make the pool bench "both" at once, so collapse duplicates.
  .filter(([, value], i, arr) => arr.findIndex(([, v]) => v === value) === i)
  .map(([name, value]) => new PooledKey(name, value.trim()));

let cursor = 0;

export const poolSize = () => keys.length;

export const poolStatus = () => keys.map((k) => ({
  name: k.name,
  available: k.available,
  retired: k.retired,
  calls: k.calls,
  rate_limit_hits: k.rateLimitHits,
  benched_for_ms: Math.max(0, k.benchedUntil - Date.now())
}));

/** Next usable key, or null if every key is benched or retired. */
const nextKey = () => {
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[(cursor + i) % keys.length];
    if (key.available) {
      cursor = (cursor + i + 1) % keys.length;
      return key;
    }
  }
  return null;
};

/** Milliseconds until the soonest key frees up. Infinity if all are retired. */
const soonestFree = () => {
  const live = keys.filter((k) => !k.retired);
  if (!live.length) return Infinity;
  return Math.max(0, Math.min(...live.map((k) => k.benchedUntil)) - Date.now());
};

const parseRetryAfter = (error) => {
  const header = error?.headers?.['retry-after'] || error?.response?.headers?.['retry-after'];
  if (header) {
    const secs = Number(header);
    if (Number.isFinite(secs)) return Math.min(secs * 1000, MAX_WAIT_MS);
  }
  // Groq embeds the wait in the message when the header is absent.
  const match = /try again in ([\d.]+)s/i.exec(error?.message || '');
  if (match) return Math.min(Number(match[1]) * 1000, MAX_WAIT_MS);
  return DEFAULT_COOLDOWN_MS;
};

/**
 * Run a Groq call against the pool.
 *
 * @param {(client: import('groq-sdk').default) => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
export const withGroq = async (fn) => {
  if (!keys.length) {
    throw new Error('No Groq API key is configured.');
  }

  const attempts = keys.length + 1;   // one pass over the pool, then one wait

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let key = nextKey();

    if (!key) {
      const wait = soonestFree();
      if (!Number.isFinite(wait)) throw new Error('Every Groq key has been retired.');
      if (wait > MAX_WAIT_MS) throw new Error('All Groq keys are rate limited. Try again shortly.');
      await new Promise((r) => setTimeout(r, wait + 50));
      key = nextKey();
      if (!key) continue;
    }

    try {
      key.calls += 1;
      return await fn(key.client);
    } catch (err) {
      const status = err?.status ?? err?.response?.status;

      if (status === 429) {
        const cooldown = parseRetryAfter(err);
        key.bench(cooldown);
        console.warn(`Groq key ${key.name} rate limited; benched ${Math.round(cooldown / 1000)}s`);
        continue;   // straight to the next key
      }

      if (status === 401 || status === 403) {
        key.retire(`auth failed (${status})`);
        continue;
      }

      // Anything else is a real error from the model, not a key problem.
      throw err;
    }
  }

  throw new Error('All Groq keys are rate limited. Try again shortly.');
};

if (keys.length) {
  console.log(`Groq key pool: ${keys.length} key(s) — ${keys.map((k) => k.name).join(', ')}`);
} else {
  console.warn('Groq key pool: no keys configured; LLM features will degrade.');
}
