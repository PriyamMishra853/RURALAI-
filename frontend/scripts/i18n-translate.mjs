/**
 * Fill in the missing strings for a locale, using the models this project
 * already has keys for.
 *
 *   node scripts/i18n-translate.mjs --lang hi           # one language
 *   node scripts/i18n-translate.mjs --all               # every language
 *   node scripts/i18n-translate.mjs --lang ta --dry-run # show, do not write
 *   node scripts/i18n-translate.mjs --all --force       # redo existing strings
 *
 * ── Why a build-time script and not a runtime service ───────────────────────
 *
 * The alternative was translating on demand in the browser. That would have
 * been less code and it is the wrong shape for this product:
 *
 *   It is used where the network is worst. A sub-centre on a weak link should
 *   not need a round trip to a language model before it can render a button.
 *   The output here is a 1–3 KB JSON chunk served from the same bundle as
 *   everything else, and it works with no connection at all.
 *
 *   It has to be reviewable. This is a clinical interface: a mistranslated
 *   triage tier changes what a health worker does with a dying patient. A file
 *   in the repository can be read by a speaker, corrected, and diffed. Text
 *   generated fresh on each page load cannot.
 *
 *   It has to be stable. The same key must produce the same words today and
 *   next week, or two health workers comparing screens see different wording
 *   for the same tier.
 *
 * So: a script, run deliberately, whose output is committed.
 *
 * ── What it will not do ─────────────────────────────────────────────────────
 *
 * It never overwrites an existing translation unless --force is passed. Some
 * of these strings were written by hand — the Hindi in hi.json, the referral
 * panel's wording — and a machine pass silently replacing them would be a
 * regression, not an update.
 *
 * It never touches `reviewed: true` in languages.js. Machine translation does
 * not make a locale reviewed; only a qualified speaker does. The interface
 * says so on the language gate, and that stays honest.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES = path.resolve(__dirname, '../src/i18n/locales');
const LANGUAGES_JS = path.resolve(__dirname, '../src/i18n/languages.js');
const BACKEND_LANGUAGES = path.resolve(__dirname, '../../backend/src/config/languages.js');

/* ------------------------------------------------------------------ config */

const GROQ_MODEL = process.env.GROQ_TEXT_MODEL || 'openai/gpt-oss-120b';
const GEMINI_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-3.5-flash';

/** Strings per request. Small enough that one bad batch is cheap to redo. */
const BATCH = 40;

/* ------------------------------------------------------------------- env */

/**
 * Read the backend .env without adding a dotenv dependency to the frontend.
 *
 * The keys live there because that is where they are used; this script is the
 * only thing in the frontend tree that needs them, and only when run by hand.
 */
const loadEnv = () => {
  const file = path.resolve(__dirname, '../../backend/.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^['"]|['"]$/g, '');
    if (value && !process.env[m[1]]) process.env[m[1]] = value;
  }
};

/* --------------------------------------------------------------- languages */

/**
 * The language list, read out of the backend registry.
 *
 * That file already holds exactly what this script needs — the code and a
 * `promptName` that tells a model which script to write in — and reading it
 * rather than repeating it means a language cannot be added to the product and
 * forgotten here.
 */
const readLanguages = () => {
  const src = fs.readFileSync(BACKEND_LANGUAGES, 'utf8');
  const out = [];
  for (const m of src.matchAll(/L\('([a-z]{2,3})',\s*'([^']*)',\s*'([^']*)'/g)) {
    out.push({ code: m[1], english: m[2], promptName: m[3] });
  }
  if (!out.length) throw new Error('No languages parsed from backend/src/config/languages.js');
  return out;
};

/** Which locales the UI actually offers, so we do not translate a dead file. */
const readOffered = () => {
  const src = fs.readFileSync(LANGUAGES_JS, 'utf8');
  const block = src.slice(src.indexOf('export const LANGUAGES'), src.indexOf('export const DEFAULT_LANGUAGE'));
  return new Set([...block.matchAll(/code:\s*'([a-z]{2,3})'/g)].map((m) => m[1]));
};

/* ----------------------------------------------------------------- prompt */

/**
 * The instruction the model gets.
 *
 * Written for this product specifically, because generic translation
 * instructions produce exactly the failures that matter here: a placeholder
 * dropped so a sentence renders with a hole in it, a triage tier softened into
 * a word that means "urgent" instead of "emergency", a drug name transliterated
 * into something no pharmacist will recognise.
 */
const systemPrompt = (lang) => `You are translating the interface of a rural telemedicine system used in India, into ${lang.promptName}.

The users are village health workers and doctors. Many have limited literacy. Write plain, everyday language — the register of a government health poster, not of a textbook.

RULES, in order of importance:

1. Placeholders like {count}, {name}, {district} are code. Copy them EXACTLY, including the braces. Never translate, reorder the characters inside, or drop one. A missing placeholder renders a sentence with a hole in it.

2. Clinical terms must not be softened. "Emergency" must be the word used for a life-threatening emergency, not one that reads as "urgent". "Refer immediately" must not become "consider referring". This interface triages patients; a weaker word changes what a health worker does.

3. Keep as-is, untranslated:
   - medicine names, dosages, and strengths (Paracetamol, 500 mg, 1-0-1)
   - units and notation (mmHg, bpm, °F, SpO₂, %, km, ₹)
   - numbers and phone numbers (108, 112)
   - proper nouns and abbreviations: Aadhaar, ABHA, MoHFW, NABH, PM-JAY, NMC, PIN, OCR, AI, PDF, SFU
   - anything already inside braces

4. Keep the same punctuation shape: a string ending in "…" ends in "…", one ending in ":" ends in ":", one that is a question stays a question.

5. Keep it short. These are buttons, labels and one-line hints in a fixed layout. A translation twice the length of the English will be cut off on a phone.

6. If a term genuinely has no everyday equivalent in ${lang.promptName}, keep the English word rather than inventing one. A health worker who recognises the English term is better served than one who reads a coinage.

OUTPUT: a JSON object mapping each input key to its translated string. Every key that was given to you, and no others. No explanation, no markdown fence.`;

const userPrompt = (entries) => `Translate the values. The keys are identifiers — return them unchanged.

${JSON.stringify(Object.fromEntries(entries), null, 2)}`;

/* ---------------------------------------------------------------- providers */

const callGroq = async (system, user) => {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
    })
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Groq ${res.status}: ${detail.slice(0, 200)}`);
  }
  return JSON.parse((await res.json()).choices[0].message.content);
};

const callGemini = async (system, user) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
      })
    }
  );

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Gemini ${res.status}: ${detail.slice(0, 200)}`);
  }
  const body = await res.json();
  return JSON.parse(body.candidates[0].content.parts[0].text);
};

/**
 * Groq first, Gemini as the fallback.
 *
 * Same reasoning as the vision path in backend/src/config/models.js: free-tier
 * quota is per provider and per model, so one being exhausted must not stop the
 * run. A batch that fails on both is reported and skipped — the keys simply
 * stay missing and fall back to English, which is the designed behaviour.
 */
const translateBatch = async (lang, entries) => {
  const system = systemPrompt(lang);
  const user = userPrompt(entries);

  for (const [name, fn] of [['Groq', callGroq], ['Gemini', callGemini]]) {
    try {
      const out = await fn(system, user);
      if (out) return out;
    } catch (err) {
      console.warn(`      ${name} failed: ${err.message}`);
    }
  }
  return null;
};

/* --------------------------------------------------------------- validation */

const PLACEHOLDER = /\{[a-zA-Z0-9_]+\}/g;

/**
 * Reject a translation that lost or invented a placeholder.
 *
 * This is the one failure that produces visibly broken output rather than
 * merely imperfect wording — "Showing  of  matches" — so it is checked rather
 * than trusted. A rejected string is left missing and renders in English.
 */
const placeholdersMatch = (english, translated) => {
  const a = (english.match(PLACEHOLDER) || []).sort().join(',');
  const b = (translated.match(PLACEHOLDER) || []).sort().join(',');
  return a === b;
};

/* -------------------------------------------------------------------- main */

const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});

const writeJson = (file, data) => {
  const sorted = Object.fromEntries(Object.keys(data).sort().map((k) => [k, data[k]]));
  fs.writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
};

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
};

const main = async () => {
  loadEnv();

  const dryRun = process.argv.includes('--dry-run');
  const force = process.argv.includes('--force');

  /*
   * The key is only needed to actually translate.
   *
   * This check used to run first, which meant `--dry-run` — the one mode that
   * makes no model calls at all — refused to run without a key. That is
   * backwards: a dry run is what you want before deciding whether to spend the
   * calls, and often before the key is set up.
   */
  if (!dryRun && !process.env.GROQ_API_KEY && !process.env.GEMINI_API_KEY) {
    console.error('No GROQ_API_KEY or GEMINI_API_KEY found (checked the environment and backend/.env).');
    console.error('Both are already used by this project; either one is enough for this script.');
    console.error('Run with --dry-run to see what would be translated without a key.');
    return 1;
  }
  const offered = readOffered();
  const all = readLanguages().filter((l) => l.code !== 'en' && offered.has(l.code));

  const only = arg('lang');
  const targets = process.argv.includes('--all')
    ? all
    : all.filter((l) => l.code === only);

  if (!targets.length) {
    console.error(only
      ? `Unknown language "${only}".`
      : 'Pass --lang <code> or --all.');
    console.error(`Available: ${all.map((l) => l.code).join(', ')}`);
    return 1;
  }

  const en = readJson(path.join(LOCALES, 'en.json'));
  const enKeys = Object.keys(en);
  console.log(`Reference: ${enKeys.length} English keys.\n`);

  for (const lang of targets) {
    const file = path.join(LOCALES, `${lang.code}.json`);
    const existing = readJson(file);

    const missing = enKeys.filter((k) => force || !(k in existing));
    const covered = enKeys.length - enKeys.filter((k) => !(k in existing)).length;
    const pct = Math.round((covered / enKeys.length) * 100);

    if (!missing.length) {
      console.log(`${lang.code.padEnd(4)} ${lang.english.padEnd(14)} complete (${pct}%)`);
      continue;
    }

    console.log(`${lang.code.padEnd(4)} ${lang.english.padEnd(14)} ${covered}/${enKeys.length} (${pct}%) — translating ${missing.length}`);

    if (dryRun) continue;

    const result = { ...existing };
    let done = 0;
    let rejected = 0;

    for (let i = 0; i < missing.length; i += BATCH) {
      const slice = missing.slice(i, i + BATCH);
      const entries = slice.map((k) => [k, en[k]]);

      const out = await translateBatch(lang, entries);
      if (!out) {
        console.warn(`      batch ${i / BATCH + 1} failed on every provider — left in English`);
        continue;
      }

      for (const [key, english] of entries) {
        const value = out[key];
        if (typeof value !== 'string' || !value.trim()) continue;
        if (!placeholdersMatch(english, value)) {
          rejected += 1;
          continue;
        }
        result[key] = value.trim();
        done += 1;
      }

      process.stdout.write(`      ${Math.min(i + BATCH, missing.length)}/${missing.length}\r`);
    }

    writeJson(file, result);
    const finalPct = Math.round((Object.keys(result).length / enKeys.length) * 100);
    console.log(`      wrote ${done} string(s) → ${finalPct}% coverage`
      + (rejected ? `, ${rejected} rejected for a broken placeholder` : ''));
  }

  if (dryRun) {
    console.log('\nDry run — nothing was written. Re-run without --dry-run to translate.');
    return 0;
  }

  console.log('\nDone. These are machine translations: `reviewed` in languages.js is unchanged,');
  console.log('and the language gate still tells users which locales a speaker has checked.');
  return 0;
};

main().then((code) => process.exit(code));
