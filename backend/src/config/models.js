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

/** Wound photography and document vision. */
export const GEMINI_VISION_MODEL = process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash';

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
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`);
    const ids = res.ok
      ? ((await res.json()).models || []).map((m) => m.name.replace(/^models\//, ''))
      : [];
    checks.push({
      model: GEMINI_VISION_MODEL,
      provider: 'Gemini',
      available: ids.includes(GEMINI_VISION_MODEL),
      detail: ids.includes(GEMINI_VISION_MODEL) ? '' : 'not offered'
    });
  }

  return checks;
};
