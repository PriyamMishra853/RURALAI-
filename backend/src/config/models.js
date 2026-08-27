/**
 * Model identifiers, in one place.
 *
 * These were previously hardcoded in three separate service files. When Groq
 * decommissioned `llama-3.3-70b-versatile`, every one of those call sites
 * started returning 404 and each service quietly fell back to its non-AI path.
 * Nothing failed loudly, and the assessment pipeline ran for an unknown period
 * with no model in it at all.
 *
 * Two changes stop that recurring:
 *   1. One definition per model, overridable by env so a decommission is a
 *      config change rather than a code change.
 *   2. `verifyModelsAvailable()` below, run by `npm run check`, turns a
 *      decommissioned model into a red line in a report instead of silence.
 */

/** Clinical assessment synthesis and text structuring. */
export const GROQ_TEXT_MODEL = process.env.GROQ_TEXT_MODEL || 'openai/gpt-oss-120b';

/** Multilingual speech-to-text for symptom capture. */
export const GROQ_SPEECH_MODEL = process.env.GROQ_SPEECH_MODEL || 'whisper-large-v3-turbo';

/**
 * Wound photography and document vision.
 *
 * gemini-2.5-flash was decommissioned for new API keys: it still APPEARS in
 * the /models listing, but generateContent returns 404 "no longer available to
 * new users". That combination made the health check pass while every wound
 * photo and every prescription silently fell back to the non-vision path.
 * The listing is therefore not sufficient evidence — see verifyModelsAvailable.
 */
export const GEMINI_VISION_MODEL = process.env.GEMINI_VISION_MODEL || 'gemini-3.6-flash';

/**
 * Fallback chain, tried in order.
 *
 * Gemini free-tier quota is PER MODEL, so a key can be exhausted on
 * gemini-3.6-flash (429) while gemini-3.5-flash still answers normally. Without
 * a chain, one exhausted model silently disables every wound photo and every
 * prescription read — which is exactly what happened once already.
 */
export const GEMINI_VISION_FALLBACKS = (
  process.env.GEMINI_VISION_FALLBACKS || 'gemini-3.6-flash,gemini-3.5-flash,gemini-3.1-flash-lite'
).split(',').map((m) => m.trim()).filter(Boolean);

/**
 * Confirm every configured model still exists at its provider.
 * Returns a list of { model, provider, available, detail }.
 */
export const verifyModelsAvailable = async () => {
  const checks = [];

  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${groqKey}` }
    });
    const ids = res.ok ? ((await res.json()).data || []).map((m) => m.id) : [];
    for (const model of [GROQ_TEXT_MODEL, GROQ_SPEECH_MODEL]) {
      checks.push({
        model,
        provider: 'Groq',
        available: ids.includes(model),
        detail: ids.includes(model) ? '' : `not offered; available: ${ids.slice(0, 4).join(', ')}…`
      });
    }
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    // A real generateContent call with an image, not a /models listing.
    // Listing a model proves nothing: gemini-2.5-flash was listed for months
    // after generateContent started returning 404 for new keys.
    const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    let available = false;
    let detail = '';
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL}:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [
              { text: 'Reply with JSON {"ok":true}' },
              { inline_data: { mime_type: 'image/png', data: pixel } }
            ] }],
            generationConfig: { temperature: 0, response_mime_type: 'application/json', maxOutputTokens: 512 }
          })
        }
      );
      available = res.ok;
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        detail = `generateContent ${res.status}: ${(body.error?.message || '').slice(0, 110)}`;
      }
    } catch (e) {
      detail = e.message;
    }
    checks.push({ model: GEMINI_VISION_MODEL, provider: 'Gemini', available, detail });
  }

  return checks;
};
