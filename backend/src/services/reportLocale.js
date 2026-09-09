import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { LANGUAGE_BY_CODE, DEFAULT_LANGUAGE } from '../config/languages.js';

/**
 * Language support for the generated PDF reports.
 *
 * ── The constraint this file exists to handle honestly ──────────────────────
 *
 * A PDF is not a web page. It carries its own fonts, and pdfkit's built-in
 * ones — Helvetica and friends — are the fourteen standard PDF fonts, which
 * between them cover Latin, Greek and Cyrillic and nothing else. Drawing
 * Devanagari or Tamil with Helvetica does not produce a warning; it produces a
 * page of empty boxes.
 *
 * That matters more here than almost anywhere. The referral sheet and the
 * clinical summary are the documents the patient physically carries away and
 * reads at home with nobody there to explain them. A page of boxes is worse
 * than a page of English: English is at least readable by somebody they can
 * show it to.
 *
 * So this module does three things, in order:
 *
 *   1. Looks for a font that can actually draw the language's script.
 *   2. If it finds one, registers it and returns a translator, so the whole
 *      report renders in that language.
 *   3. If it does not, returns an English renderer and says so — `fallback`
 *      is set, and reportPdfService prints one line on the document
 *      explaining that this copy is in English. Silence there would leave a
 *      health worker assuming the patient can read the sheet they were handed.
 *
 * ── Installing the fonts ────────────────────────────────────────────────────
 *
 * Drop the Noto TTFs into `backend/assets/fonts/`. They are not committed:
 * they are ~10 MB in total, they are not ours, and a deployment that only ever
 * prints English should not have to carry them.
 *
 *     NotoSansDevanagari-Regular.ttf   NotoSansDevanagari-Bold.ttf
 *     NotoSansBengali-Regular.ttf      NotoSansBengali-Bold.ttf
 *     …and so on for the scripts you serve — see SCRIPT_FONT below.
 *
 * Available from https://fonts.google.com/noto. `npm run check:fonts` reports
 * which scripts are covered and which languages therefore still print English.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.resolve(__dirname, '../../assets/fonts');
const LOCALE_DIR = path.resolve(__dirname, '../../../frontend/src/i18n/locales');

/**
 * Which font file draws which script, and which languages use it.
 *
 * Keyed by script rather than by language because one font serves many: a
 * single Devanagari face covers Hindi, Marathi, Maithili, Bhojpuri, Awadhi,
 * Magahi, Rajasthani, Chhattisgarhi, Haryanvi, Konkani, Nepali, Dogri, Bodo
 * and Sanskrit. Installing one file localises fourteen languages.
 */
export const SCRIPT_FONT = {
  Devanagari: {
    file: 'NotoSansDevanagari',
    languages: ['hi', 'mr', 'mai', 'sa', 'kok', 'ne', 'doi', 'brx', 'bho', 'awa', 'mag', 'raj', 'hne', 'bgc']
  },
  Bengali: { file: 'NotoSansBengali', languages: ['bn', 'as'] },
  Tamil: { file: 'NotoSansTamil', languages: ['ta'] },
  Telugu: { file: 'NotoSansTelugu', languages: ['te'] },
  Kannada: { file: 'NotoSansKannada', languages: ['kn', 'tcy'] },
  Malayalam: { file: 'NotoSansMalayalam', languages: ['ml'] },
  Gujarati: { file: 'NotoSansGujarati', languages: ['gu'] },
  Gurmukhi: { file: 'NotoSansGurmukhi', languages: ['pa'] },
  Odia: { file: 'NotoSansOriya', languages: ['or'] },
  Arabic: { file: 'NotoNaskhArabic', languages: ['ur', 'ks', 'sd'] },
  OlChiki: { file: 'NotoSansOlChiki', languages: ['sat'] },
  MeeteiMayek: { file: 'NotoSansMeeteiMayek', languages: ['mni'] }
};

/**
 * Languages written in the Latin alphabet.
 *
 * These need no font at all — Helvetica draws them — so they localise with
 * nothing installed.
 */
const LATIN = new Set(['en', 'kha', 'lus']);

const SCRIPT_FOR_LANGUAGE = (() => {
  const out = {};
  for (const [script, def] of Object.entries(SCRIPT_FONT)) {
    for (const code of def.languages) out[code] = script;
  }
  return out;
})();

/** Both weights must be present; a bold-less report loses its whole hierarchy. */
const fontPaths = (script) => {
  const def = SCRIPT_FONT[script];
  if (!def) return null;
  const regular = path.join(FONT_DIR, `${def.file}-Regular.ttf`);
  const bold = path.join(FONT_DIR, `${def.file}-Bold.ttf`);
  if (!fs.existsSync(regular) || !fs.existsSync(bold)) return null;
  return { regular, bold };
};

/** Which scripts this deployment can actually draw. Used by check:fonts. */
export const installedScripts = () =>
  Object.keys(SCRIPT_FONT).filter((script) => fontPaths(script) !== null);

/* -------------------------------------------------------------- catalogue */

const CATALOGUE_CACHE = new Map();

/**
 * The UI catalogue for a locale, read from the frontend tree.
 *
 * Reading the frontend's JSON rather than keeping a second copy here is
 * deliberate: the report's labels are the same words as the screen's — "Vitals
 * recorded", "Presenting complaint", the tier names — and two copies of those
 * would drift, which on a clinical document means the printout and the screen
 * disagreeing about what tier a patient is.
 *
 * A backend-only deployment has no frontend tree, and that is a supported
 * shape: the report falls back to the English written at each call site,
 * exactly as the browser does when a locale is missing a key.
 */
const catalogue = (code) => {
  if (CATALOGUE_CACHE.has(code)) return CATALOGUE_CACHE.get(code);

  let table = {};
  try {
    const file = path.join(LOCALE_DIR, `${code}.json`);
    if (fs.existsSync(file)) table = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.warn(`[report] could not read the ${code} catalogue: ${err.message}`);
  }
  CATALOGUE_CACHE.set(code, table);
  return table;
};

const interpolate = (str, vars) => {
  if (!vars) return str;
  let out = str;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{${k}}`).join(v == null ? '' : String(v));
  }
  return out;
};

/* ------------------------------------------------------------------ public */

/**
 * Everything the PDF renderer needs to draw in one language.
 *
 * @param {string} code  a language code; anything unknown becomes English
 * @returns {{
 *   code: string,
 *   rtl: boolean,
 *   t: (key: string, english: string, vars?: object) => string,
 *   fonts: { regular: string, bold: string },
 *   register: (doc: import('pdfkit')) => void,
 *   fallback: null | { requested: string, script: string }
 * }}
 */
export const reportLocale = (code) => {
  const lang = LANGUAGE_BY_CODE[code] || LANGUAGE_BY_CODE[DEFAULT_LANGUAGE];

  const english = {
    code: DEFAULT_LANGUAGE,
    rtl: false,
    t: (key, fallbackText, vars) => interpolate(fallbackText || key, vars),
    fonts: { regular: 'Helvetica', bold: 'Helvetica-Bold' },
    register: () => {},
    fallback: null
  };

  if (lang.code === DEFAULT_LANGUAGE) return english;

  // Latin-script languages draw with the built-in font and need nothing else.
  if (LATIN.has(lang.code)) {
    const table = catalogue(lang.code);
    return {
      ...english,
      code: lang.code,
      t: (key, fallbackText, vars) => interpolate(table[key] ?? fallbackText ?? key, vars)
    };
  }

  const script = SCRIPT_FOR_LANGUAGE[lang.code];
  const files = script ? fontPaths(script) : null;

  if (!files) {
    /*
     * No font for this script. Render English and say so on the document.
     *
     * Deliberately NOT an error: refusing to produce a referral sheet because
     * a font is missing would be a far worse failure than producing an English
     * one. The document explains itself and the health worker knows what they
     * are handing over.
     */
    return { ...english, fallback: { requested: lang.code, script: script || 'unknown' } };
  }

  const table = catalogue(lang.code);

  return {
    code: lang.code,
    rtl: Boolean(lang.rtl) || script === 'Arabic',
    t: (key, fallbackText, vars) => interpolate(table[key] ?? fallbackText ?? key, vars),
    fonts: { regular: `body-${lang.code}`, bold: `bold-${lang.code}` },
    register(doc) {
      doc.registerFont(`body-${lang.code}`, files.regular);
      doc.registerFont(`bold-${lang.code}`, files.bold);
    },
    fallback: null
  };
};
