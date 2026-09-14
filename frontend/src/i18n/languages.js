/**
 * The languages this interface offers.
 *
 * All 22 languages of the Eighth Schedule, English, and the regional languages
 * with the largest speaker populations in the states this platform serves.
 *
 * `native` is what appears in the selector. A speaker looking for their own
 * language scans for their own script, not for a romanised label they may not
 * read — "ਪੰਜਾਬੀ" is findable to a Punjabi speaker in a way that "Punjabi" is
 * not.
 *
 * `reviewed` is the honest part. It marks whether a qualified speaker has
 * checked the clinical strings in that locale. This is a medical interface: a
 * mistranslated triage tier or dosage instruction is a patient-safety problem,
 * not a cosmetic one, and the selector says so rather than presenting every
 * locale as equally trustworthy. Nothing is blocked — the warning is shown and
 * the choice is the user's.
 */

export const LANGUAGES = [
  // ── Eighth Schedule ──────────────────────────────────────────────────────
  { code: 'hi', native: 'हिन्दी',       english: 'Hindi',      script: 'Devanagari', reviewed: true },
  { code: 'en', native: 'English',      english: 'English',    script: 'Latin',      reviewed: true },
  { code: 'bn', native: 'বাংলা',        english: 'Bengali',    script: 'Bengali',    reviewed: false },
  { code: 'te', native: 'తెలుగు',        english: 'Telugu',     script: 'Telugu',     reviewed: false },
  { code: 'mr', native: 'मराठी',        english: 'Marathi',    script: 'Devanagari', reviewed: false },
  { code: 'ta', native: 'தமிழ்',         english: 'Tamil',      script: 'Tamil',      reviewed: false },
  { code: 'gu', native: 'ગુજરાતી',       english: 'Gujarati',   script: 'Gujarati',   reviewed: false },
  { code: 'ur', native: 'اردو',         english: 'Urdu',       script: 'Arabic',     reviewed: false, rtl: true },
  { code: 'kn', native: 'ಕನ್ನಡ',        english: 'Kannada',    script: 'Kannada',    reviewed: false },
  { code: 'or', native: 'ଓଡ଼ିଆ',         english: 'Odia',       script: 'Odia',       reviewed: false },
  { code: 'ml', native: 'മലയാളം',      english: 'Malayalam',  script: 'Malayalam',  reviewed: false },
  { code: 'pa', native: 'ਪੰਜਾਬੀ',        english: 'Punjabi',    script: 'Gurmukhi',   reviewed: false },
  { code: 'as', native: 'অসমীয়া',       english: 'Assamese',   script: 'Bengali',    reviewed: false },
  { code: 'mai', native: 'मैथिली',       english: 'Maithili',   script: 'Devanagari', reviewed: false },
  { code: 'sa', native: 'संस्कृतम्',      english: 'Sanskrit',   script: 'Devanagari', reviewed: false },
  { code: 'kok', native: 'कोंकणी',      english: 'Konkani',    script: 'Devanagari', reviewed: false },
  { code: 'ne', native: 'नेपाली',        english: 'Nepali',     script: 'Devanagari', reviewed: false },
  { code: 'ks', native: 'کٲشُر',        english: 'Kashmiri',   script: 'Arabic',     reviewed: false, rtl: true },
  { code: 'sd', native: 'سنڌي',         english: 'Sindhi',     script: 'Arabic',     reviewed: false, rtl: true },
  { code: 'doi', native: 'डोगरी',        english: 'Dogri',      script: 'Devanagari', reviewed: false },
  { code: 'mni', native: 'ꯃꯤꯇꯩꯂꯣꯟ',      english: 'Manipuri',   script: 'Meetei Mayek', reviewed: false },
  { code: 'brx', native: 'बड़ो',         english: 'Bodo',       script: 'Devanagari', reviewed: false },
  { code: 'sat', native: 'ᱥᱟᱱᱛᱟᱲᱤ',      english: 'Santali',    script: 'Ol Chiki',   reviewed: false },

  // ── Regional languages with large speaker populations ────────────────────
  // Bhojpuri, Awadhi and Magahi matter disproportionately here: between them
  // they are the first language of much of rural Uttar Pradesh and Bihar,
  // which is exactly who uses this system.
  { code: 'bho', native: 'भोजपुरी',      english: 'Bhojpuri',      script: 'Devanagari', reviewed: false },
  { code: 'awa', native: 'अवधी',        english: 'Awadhi',        script: 'Devanagari', reviewed: false },
  { code: 'mag', native: 'मगही',         english: 'Magahi',        script: 'Devanagari', reviewed: false },
  { code: 'raj', native: 'राजस्थानी',     english: 'Rajasthani',    script: 'Devanagari', reviewed: false },
  { code: 'hne', native: 'छत्तीसगढ़ी',    english: 'Chhattisgarhi', script: 'Devanagari', reviewed: false },
  { code: 'bgc', native: 'हरियाणवी',     english: 'Haryanvi',      script: 'Devanagari', reviewed: false },
  { code: 'tcy', native: 'ತುಳು',         english: 'Tulu',          script: 'Kannada',    reviewed: false },
  { code: 'kha', native: 'Khasi',       english: 'Khasi',         script: 'Latin',      reviewed: false },
  { code: 'lus', native: 'Mizo ṭawng',  english: 'Mizo',          script: 'Latin',      reviewed: false }
];

export const DEFAULT_LANGUAGE = 'en';

export const LANGUAGE_BY_CODE = Object.fromEntries(LANGUAGES.map((l) => [l.code, l]));

export const isRtl = (code) => Boolean(LANGUAGE_BY_CODE[code]?.rtl);

/**
 * Best guess from the browser, used only to pre-highlight a choice in the
 * selector. It never selects on the user's behalf: guessing wrong and then
 * silently rendering a clinical interface in a language somebody cannot read
 * is worse than asking.
 */
export const suggestedLanguage = () => {
  if (typeof navigator === 'undefined') return null;
  const tags = [navigator.language, ...(navigator.languages || [])].filter(Boolean);
  for (const tag of tags) {
    const base = String(tag).toLowerCase().split('-')[0];
    if (LANGUAGE_BY_CODE[base]) return base;
  }
  return null;
};

/**
 * A tag Intl will actually accept.
 *
 * Most of the regional languages here are valid ISO 639-3 codes with no CLDR
 * data behind them: `new Intl.NumberFormat('bgc')` throws or silently falls
 * back, and a thrown formatter in a render is a blank screen. Each is mapped to
 * the closest language that does have data, chosen by script and region so the
 * numerals, date order and grouping a reader sees are the ones they expect.
 */
const INTL_FALLBACK = {
  mai: 'hi', kok: 'mr', doi: 'hi', brx: 'hi', sat: 'hi',
  bho: 'hi', awa: 'hi', mag: 'hi', raj: 'hi', hne: 'hi', bgc: 'hi',
  tcy: 'kn', mni: 'bn', kha: 'en', lus: 'en', sd: 'ur', ks: 'ur'
};

/**
 * Every locale here is Indian, so the region subtag is not a guess — it is the
 * difference between dd/mm/yyyy and mm/dd/yyyy on a clinical record.
 */
export const intlTag = (code) => {
  const base = INTL_FALLBACK[code] || code;
  return base === 'en' ? 'en-IN' : `${base}-IN`;
};
