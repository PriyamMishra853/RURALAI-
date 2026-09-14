/**
 * The languages this system can speak, server-side.
 *
 * Mirrors frontend/src/i18n/languages.js. Two copies of a list is not ideal,
 * but the alternative — the API importing from the browser bundle — is worse,
 * and the list is stable: it is the Eighth Schedule plus the regional
 * languages of the states this platform serves. `npm run check:languages`
 * (scripts/checkLanguages.js) fails if the two drift apart, so the duplication
 * is enforced rather than hoped for.
 *
 * ── What the server actually needs a language for ───────────────────────────
 *
 * Three things, and only three:
 *
 *   1. `promptName` — what to call the language when instructing a model. A
 *      model does better with "Bhojpuri (Devanagari script)" than with "bho",
 *      and naming the script matters for the languages written in more than
 *      one.
 *   2. `speechTag` — the closest BCP-47 tag a browser speech voice exists for.
 *      Most of these have no voice of their own; a Bhojpuri passage read by a
 *      Hindi voice is understandable, read by an English one it is not.
 *   3. Validation — an unknown code must be rejected rather than interpolated
 *      into a model prompt.
 *
 * It deliberately does NOT hold UI strings. The interface catalogue lives in
 * the frontend; the server translates generated clinical prose, which is a
 * different job with different safety rules.
 */

const L = (code, english, promptName, speechTag) => ({ code, english, promptName, speechTag });

export const LANGUAGES = [
  // ── Eighth Schedule ──────────────────────────────────────────────────────
  L('en', 'English', 'English', 'en-IN'),
  L('hi', 'Hindi', 'Hindi (Devanagari script)', 'hi-IN'),
  L('bn', 'Bengali', 'Bengali (Bengali script)', 'bn-IN'),
  L('te', 'Telugu', 'Telugu (Telugu script)', 'te-IN'),
  L('mr', 'Marathi', 'Marathi (Devanagari script)', 'mr-IN'),
  L('ta', 'Tamil', 'Tamil (Tamil script)', 'ta-IN'),
  L('gu', 'Gujarati', 'Gujarati (Gujarati script)', 'gu-IN'),
  L('ur', 'Urdu', 'Urdu (Arabic script)', 'ur-IN'),
  L('kn', 'Kannada', 'Kannada (Kannada script)', 'kn-IN'),
  L('or', 'Odia', 'Odia (Odia script)', 'or-IN'),
  L('ml', 'Malayalam', 'Malayalam (Malayalam script)', 'ml-IN'),
  L('pa', 'Punjabi', 'Punjabi (Gurmukhi script)', 'pa-IN'),
  L('as', 'Assamese', 'Assamese (Bengali script)', 'as-IN'),
  L('mai', 'Maithili', 'Maithili (Devanagari script)', 'hi-IN'),
  L('sa', 'Sanskrit', 'Sanskrit (Devanagari script)', 'hi-IN'),
  L('kok', 'Konkani', 'Konkani (Devanagari script)', 'mr-IN'),
  L('ne', 'Nepali', 'Nepali (Devanagari script)', 'ne-NP'),
  L('ks', 'Kashmiri', 'Kashmiri (Arabic script)', 'ur-IN'),
  L('sd', 'Sindhi', 'Sindhi (Arabic script)', 'ur-IN'),
  L('doi', 'Dogri', 'Dogri (Devanagari script)', 'hi-IN'),
  L('mni', 'Manipuri', 'Manipuri / Meiteilon (Meetei Mayek script)', 'bn-IN'),
  L('brx', 'Bodo', 'Bodo (Devanagari script)', 'hi-IN'),
  L('sat', 'Santali', 'Santali (Ol Chiki script)', 'hi-IN'),

  // ── Regional languages with large speaker populations ────────────────────
  L('bho', 'Bhojpuri', 'Bhojpuri (Devanagari script)', 'hi-IN'),
  L('awa', 'Awadhi', 'Awadhi (Devanagari script)', 'hi-IN'),
  L('mag', 'Magahi', 'Magahi (Devanagari script)', 'hi-IN'),
  L('raj', 'Rajasthani', 'Rajasthani / Marwari (Devanagari script)', 'hi-IN'),
  L('hne', 'Chhattisgarhi', 'Chhattisgarhi (Devanagari script)', 'hi-IN'),
  L('bgc', 'Haryanvi', 'Haryanvi (Devanagari script)', 'hi-IN'),
  L('tcy', 'Tulu', 'Tulu (Kannada script)', 'kn-IN'),
  L('kha', 'Khasi', 'Khasi (Latin script)', 'en-IN'),
  L('lus', 'Mizo', 'Mizo (Latin script)', 'en-IN')
];

export const DEFAULT_LANGUAGE = 'en';

export const LANGUAGE_BY_CODE = Object.fromEntries(LANGUAGES.map((l) => [l.code, l]));

/** Lookup by the English name, for the older callers that passed 'Hindi'. */
const BY_ENGLISH = Object.fromEntries(LANGUAGES.map((l) => [l.english.toLowerCase(), l]));

/**
 * Accept a code, an English name, or a full BCP-47 tag, and return the entry.
 *
 * Callers arrive from three directions and all three are legitimate:
 * `Accept-Language: hi-IN` from a browser, `{ target: 'Hindi' }` from the
 * read-aloud control as it was originally written, and `?lang=bho` from the
 * new client. Normalising here means none of them has to know about the
 * others.
 *
 * Returns null for anything unrecognised — the caller decides whether that is
 * a 400 or a silent fall back to English, and those are different decisions in
 * different places.
 */
export const resolveLanguage = (input) => {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  if (LANGUAGE_BY_CODE[raw]) return LANGUAGE_BY_CODE[raw];

  const lower = raw.toLowerCase();
  if (BY_ENGLISH[lower]) return BY_ENGLISH[lower];

  // 'hi-IN', 'pa-Guru-IN' → 'hi', 'pa'
  const base = lower.split('-')[0];
  return LANGUAGE_BY_CODE[base] || null;
};

/**
 * The language to generate in, from a request.
 *
 * Explicit beats implicit: a `lang` in the body or query is a deliberate
 * choice by the client, while Accept-Language is the browser's guess. Falls
 * back to English rather than throwing, because no request should fail purely
 * because it asked for a language nobody has added yet.
 */
export const languageForRequest = (req) => {
  const explicit =
    req?.body?.lang
    || req?.query?.lang
    || req?.get?.('X-Language');
  const fromHeader = (req?.get?.('Accept-Language') || '').split(',')[0];

  return resolveLanguage(explicit)
    || resolveLanguage(fromHeader)
    || LANGUAGE_BY_CODE[DEFAULT_LANGUAGE];
};

export const isDefaultLanguage = (lang) =>
  !lang || lang.code === DEFAULT_LANGUAGE;
