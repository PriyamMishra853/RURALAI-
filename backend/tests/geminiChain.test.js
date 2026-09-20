/**
 * The Gemini fallback chain, which is why a readable lab report was failing.
 *
 * Production evidence: one lab report timed out at the 75 s job deadline, and
 * the identical document read fine 2 minutes later in 31 s. Nothing capped a
 * single attempt, so one hanging request could spend the whole budget without
 * ever reaching the model that would have answered — and the next upload paid
 * the same penalty again, because nothing remembered the refusal.
 */
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';

process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key';
process.env.GEMINI_VISION_MODEL = 'model-a';
process.env.GEMINI_VISION_FALLBACKS = 'model-a,model-b,model-c';
process.env.GEMINI_ATTEMPT_TIMEOUT_MS = '80';
process.env.GEMINI_COOL_OFF_MS = '5000';

const { geminiGenerateJson, resetGeminiAvailability, lastAnsweringModel } =
  await import('../src/config/gemini.js');

const modelOf = (url) => String(url).match(/models\/([^:]+):/)?.[1];
const answered = { ok: true };

/** A reply from the real API's shape. */
const reply = (payload) => ({
  ok: true, status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] })
});
const refusal = (status) => ({ ok: false, status, text: async () => 'unavailable' });
const hang = (signal) => new Promise((_, reject) => {
  signal.addEventListener('abort', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    reject(err);
  });
});

let calls;
const install = (handler) => {
  calls = [];
  global.fetch = jest.fn(async (url, options) => {
    calls.push(modelOf(url));
    return handler(modelOf(url), options);
  });
};

beforeEach(() => { resetGeminiAvailability(); });
afterEach(() => { delete global.fetch; });

const ask = () => geminiGenerateJson('system', 'user', null);

describe('falling through the chain', () => {
  it('moves past a refusal to the model that answers', async () => {
    install((model) => (model === 'model-a' ? refusal(503) : reply(answered)));
    await expect(ask()).resolves.toEqual(answered);
    expect(calls).toEqual(['model-a', 'model-b']);
    expect(lastAnsweringModel()).toBe('model-b');
  });

  it('abandons an attempt that hangs instead of spending the whole job budget', async () => {
    install((model, options) => (model === 'model-a' ? hang(options.signal) : reply(answered)));
    const started = Date.now();
    await expect(ask()).resolves.toEqual(answered);
    // The attempt timeout is 80 ms here; without it this would never return.
    expect(Date.now() - started).toBeLessThan(2000);
    expect(calls).toEqual(['model-a', 'model-b']);
  });

  it('gives up with null when every model refuses', async () => {
    install(() => refusal(429));
    await expect(ask()).resolves.toBeNull();
    expect(calls).toEqual(['model-a', 'model-b', 'model-c']);
  });
});

describe('remembering a refusal', () => {
  it('does not make the next caller pay the same failing round trip', async () => {
    install((model) => (model === 'model-a' ? refusal(503) : reply(answered)));
    await ask();
    await ask();
    // model-a is tried once, not once per request.
    expect(calls.filter((m) => m === 'model-a')).toHaveLength(1);
    expect(calls.filter((m) => m === 'model-b')).toHaveLength(2);
  });

  it('remembers a hang the same way it remembers a refusal', async () => {
    install((model, options) => (model === 'model-a' ? hang(options.signal) : reply(answered)));
    await ask();
    await ask();
    expect(calls.filter((m) => m === 'model-a')).toHaveLength(1);
  });

  it('still tries everything when every model is cooling off', async () => {
    install(() => refusal(503));
    await ask();
    calls.length = 0;
    install(() => refusal(503));
    await ask();
    // A stale cool-off must never be the reason a clinic gets no answer at all.
    expect(calls).toEqual(['model-a', 'model-b', 'model-c']);
  });
});
