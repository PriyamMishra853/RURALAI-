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

/** Models to try, preferred first. Duplicates collapsed. */
const modelChain = () => [...new Set([GEMINI_VISION_MODEL, ...GEMINI_VISION_FALLBACKS])];

/** Which model actually answered last — surfaced so the UI can show it. */
export let lastGeminiModel = null;

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
    try {
      const res = await fetch(`${urlFor(model)}?key=${config.gemini.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (res.status === 429 || res.status === 404 || res.status === 503) {
        const text = await res.text();
        lastError = `${model}: ${res.status}`;
        console.warn(`Gemini ${model} unavailable (${res.status}); trying next in chain.`);
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
      lastError = `${model}: ${err.message}`;
      console.warn(`Gemini call failed on ${model}:`, err.message);
    }
  }

  console.warn(`Every Gemini model in the chain failed. Last: ${lastError}`);
  return null;
};
