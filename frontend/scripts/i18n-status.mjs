/**
 * Translation coverage, per locale.
 *
 *   node scripts/i18n-status.mjs            # table
 *   node scripts/i18n-status.mjs --min 60   # exit non-zero under 60% anywhere
 *
 * Coverage is not quality — a locale at 100% may still be wrong, which is what
 * `reviewed` in languages.js is for. What this catches is the other failure:
 * a language offered on the gate that turns out to be almost entirely English
 * once somebody picks it.
 *
 * `--min` is deliberately not wired into `npm run build`. Shipping a partial
 * locale is a supported state — English fallback is the whole design — so this
 * is a report to look at, not a gate to trip over.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES = path.resolve(__dirname, '../src/i18n/locales');
const LANGUAGES_JS = path.resolve(__dirname, '../src/i18n/languages.js');

/** The offered languages, in the order the selector shows them. */
const readLanguages = () => {
  const src = fs.readFileSync(LANGUAGES_JS, 'utf8');
  const block = src.slice(src.indexOf('export const LANGUAGES'), src.indexOf('export const DEFAULT_LANGUAGE'));
  return [...block.matchAll(/\{\s*code:\s*'([a-z]{2,3})'[^}]*english:\s*'([^']+)'[^}]*reviewed:\s*(true|false)/g)]
    .map((m) => ({ code: m[1], english: m[2], reviewed: m[3] === 'true' }));
};

const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);

const bar = (pct, width = 20) => {
  const filled = Math.round((pct / 100) * width);
  return '█'.repeat(filled) + '·'.repeat(width - filled);
};

const main = () => {
  const en = readJson(path.join(LOCALES, 'en.json'));
  if (!en) {
    console.error('locales/en.json is missing. Run: npm run i18n:extract');
    return 1;
  }

  const enKeys = Object.keys(en);
  const languages = readLanguages();
  const minIdx = process.argv.indexOf('--min');
  const min = minIdx === -1 ? null : Number(process.argv[minIdx + 1]);

  console.log(`\nReference: en.json — ${enKeys.length} keys\n`);
  console.log('  code  language          coverage                 keys      reviewed');
  console.log('  ' + '─'.repeat(72));

  let worst = 100;
  const rows = [];

  for (const lang of languages) {
    if (lang.code === 'en') continue;
    const table = readJson(path.join(LOCALES, `${lang.code}.json`));
    const have = table ? enKeys.filter((k) => k in table).length : 0;
    const pct = Math.round((have / enKeys.length) * 100);
    worst = Math.min(worst, pct);
    rows.push({ ...lang, have, pct, missing: !table });
  }

  // Worst first: the ones that need work are the ones worth seeing at the top.
  rows.sort((a, b) => a.pct - b.pct);

  for (const r of rows) {
    const flag = r.reviewed ? 'yes' : '—';
    console.log(
      `  ${r.code.padEnd(5)} ${r.english.padEnd(16)} ${bar(r.pct)} ${String(r.pct).padStart(3)}%`
      + `  ${String(r.have).padStart(4)}/${enKeys.length}   ${flag}`
      + (r.missing ? '   (no file)' : '')
    );
  }

  const reviewed = rows.filter((r) => r.reviewed).length;
  console.log('  ' + '─'.repeat(72));
  console.log(`  ${rows.length} locales · ${reviewed} checked by a speaker · lowest coverage ${worst}%\n`);

  if (min != null && worst < min) {
    console.error(`Coverage below the requested minimum of ${min}%.`);
    return 1;
  }
  return 0;
};

process.exit(main());
