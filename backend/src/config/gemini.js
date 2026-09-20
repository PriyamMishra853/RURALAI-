import { config } from './env.js';
import { GEMINI_VISION_MODEL, GEMINI_VISION_FALLBACKS } from './models.js';

/**
 * Minimal Gemini REST client (no SDK dependency).
 *
 * Used for all multimodal work — document OCR, multi-page lab reports, and
 * wound-photo analysis — because the configured Groq key exposes no
 * vision-capable models.
 */

const urlFor = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

/**
 * How long one attempt may take before it is abandoned.
 *
 * Measured on production: a lab report that reads successfully takes 15-31 s.
 * A read that failed burned the whole 75 s job budget, because a request that
 * hangs had nothing to stop it — so the job died having never tried the
 * fallback that would have answered. 45 s is comfortably above a real read and
 * well below the budget.
 */
const ATTEMPT_TIMEOUT_MS = Number(process.env.GEMINI_ATTEMPT_TIMEOUT_MS) || 45000;

/**
 * How long a model that just refused is left alone.
 *
 * 503 and 429 come in runs, not one at a time. Without this every upload pays
 * the same failing round trip before reaching the model that works, which is
 * exactly the time the job did not have.
 */
const COOL_OFF_MS = Number(process.env.GEMINI_COOL_OFF_MS) || 60000;

const unavailableUntil = new Map();

const markUnavailable = (model, now) => unavailableUntil.set(model, now + COOL_OFF_MS);

/** Models to try, preferred first. Duplicates collapsed. */
const allModels = () => [...new Set([GEMINI_VISION_MODEL, ...GEMINI_VISION_FALLBACKS])];

/**
 * The chain to try now: models not cooling off, in preference order. If every
 * model is cooling off the full chain is used anyway — a stale cool-off must
 * never be the reason a clinic gets no answer at all.
 */
const modelChain = (now = Date.now()) => {
  const all = allModels();
  const ready = all.filter((m) => (unavailableUntil.get(m) || 0) <= now);
  return ready.length ? ready : all;
};

/** Test seam: forget which models are cooling off. */
export const resetGeminiAvailability = () => unavailableUntil.clear();

/** Which model actually answered last — surfaced so the UI can show it. */
export let lastGeminiModel = null;

export const lastAnsweringModel = () => lastGeminiModel;

/** Inline payloads Gemini will accept. A PDF is read natively, all pages. */
export const SUPPORTED_INLINE_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
  'application/pdf'
];

export const geminiAvailable = () => Boolean(config.gemini.apiKey);

export const isSupportedInlineType = (mimeType) =>
  SUPPORTED_INLINE_TYPES.includes(String(mimeType || '').toLowerCase());

/**
 * Call Gemini with zero or more inline files and return parsed JSON.
 *
 * @param {string} systemInstruction
 * @param {string} userText
 * @param {{base64: string, mimeType: string}|Array<{base64: string, mimeType: string}>|null} files
 *        One file, or several. Several are sent in a single request so the
 *        model sees pages 1..N of one report together — splitting them into
 *        separate calls loses the cross-page context that makes a lab report
 *        readable (the header on page 1, the reference ranges on page 3).
 * @param {{maxOutputTokens?: number}} [options]
 * @returns {Promise<object|null>} parsed JSON, or null on any failure
 */
export const geminiGenerateJson = async (systemInstruction, userText, files = null, options = {}) => {
  if (!config.gemini.apiKey) return null;

  const list = !files ? [] : (Array.isArray(files) ? files : [files]);

  const parts = [{ text: userText }];
  for (const f of list) {
    if (!f?.base64) continue;
    parts.push({ inline_data: { mime_type: f.mimeType || 'image/jpeg', data: f.base64 } });
  }

  const body = {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0.1,
      response_mime_type: 'application/json',
      // A multi-page report can legitimately produce a long transcription;
      // the default ceiling truncates it into invalid JSON.
      maxOutputTokens: options.maxOutputTokens || 8192
    }
  };

  // Try each model in turn. A 429 means THIS model's quota is exhausted, not
  // that the key is dead — free-tier quota is per model — so the next one in
  // the chain is tried rather than failing the whole request.
  let lastError = null;

  for (const model of modelChain()) {
    const startedAt = Date.now();
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), ATTEMPT_TIMEOUT_MS);
    try {
      const res = await fetch(`${urlFor(model)}?key=${config.gemini.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abort.signal
      });

      if (res.status === 429 || res.status === 404 || res.status === 503) {
        const text = await res.text();
        lastError = `${model}: ${res.status}`;
        markUnavailable(model, Date.now());
        console.warn(`Gemini ${model} unavailable (${res.status}) after ${Date.now() - startedAt} ms; trying next in chain.`);
        void text;
        continue;
      }

      if (!res.ok) {
        const errText = await res.text();
        console.warn(`Gemini API error ${res.status}: ${errText.slice(0, 300)}`);
        return null;
      }

      const data = await res.json();
      const candidate = data?.candidates?.[0];

      // A truncated response is not a partial success — the JSON will not parse,
      // and a half-read lab report must not look like a complete one.
      if (candidate?.finishReason === 'MAX_TOKENS') {
        console.warn('Gemini response hit the output ceiling; treating as unreadable.');
        return null;
      }

      const text = candidate?.content?.parts?.map((p) => p.text).join('') || '';
      if (!text) return null;

      lastGeminiModel = model;
      return JSON.parse(text);
    } catch (err) {
      const abandoned = err.name === 'AbortError';
      lastError = `${model}: ${abandoned ? `no answer in ${ATTEMPT_TIMEOUT_MS} ms` : err.message}`;
      // A model that hangs is as unavailable as one that refuses, and for the
      // next caller it is worse: they would wait the same time again.
      markUnavailable(model, Date.now());
      console.warn(`Gemini call failed on ${model} after ${Date.now() - startedAt} ms:`, lastError);
    } finally {
      clearTimeout(timer);
    }
  }

  console.warn(`Every Gemini model in the chain failed. Last: ${lastError}`);
  return null;
};
