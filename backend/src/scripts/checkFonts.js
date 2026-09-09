/**
 * Which languages this deployment can actually print.
 *
 * A PDF carries its own fonts. pdfkit's built-ins cover Latin and nothing
 * else, so a report in Hindi or Tamil needs a Noto face installed in
 * backend/assets/fonts — see services/reportLocale.js.
 *
 * Without one the report still renders, in English, and says so on the page.
 * That is a deliberate fallback rather than a failure: refusing to produce a
 * referral sheet because a font is missing would be far worse than producing
 * an English one. But it is a silent-by-default degradation, and this script
 * is how it stops being silent.
 *
 *   node src/scripts/checkFonts.js            # report
 *   node src/scripts/checkFonts.js --require  # exit non-zero if any is missing
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SCRIPT_FONT, installedScripts } from '../services/reportLocale.js';
import { LANGUAGES } from '../config/languages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The report reads its words from the frontend catalogue rather than keeping a
 * second copy — see reportLocale.js. That is the right call for correctness
 * (two copies of "Vitals recorded" drift, and on a clinical document that
 * means the printout and the screen disagreeing about a patient's tier) and it
 * makes the reports depend on a path outside this package.
 *
 * That dependency holds in every deployment shape this project uses, because
 * the whole repository is built into one image. But if it ever stops holding
 * the failure is silent: fonts installed, language requested, and every report
 * still in English. So it is checked here, beside the other thing that has to
 * be true for a report to come out right.
 */
const CATALOGUE_DIR = path.resolve(__dirname, '../../../frontend/src/i18n/locales');

const LATIN = new Set(['en', 'kha', 'lus']);

const main = () => {
  const installed = new Set(installedScripts());
  const rows = [];

  for (const [script, def] of Object.entries(SCRIPT_FONT)) {
    rows.push({
      script,
      file: def.file,
      have: installed.has(script),
      languages: def.languages
    });
  }

  // Most-impact first: one Devanagari file localises fourteen languages, so
  // the missing font that unblocks the most users belongs at the top.
  rows.sort((a, b) => b.languages.length - a.languages.length);

  console.log('\nPDF report fonts\n');
  let blocked = 0;

  for (const r of rows) {
    const mark = r.have ? '✓' : '·';
    const note = r.have ? '' : `  (add ${r.file}-Regular.ttf and -Bold.ttf)`;
    console.log(`  ${mark} ${r.script.padEnd(14)} ${String(r.languages.length).padStart(2)} language(s): ${r.languages.join(', ')}${note}`);
    if (!r.have) blocked += r.languages.length;
  }

  const latin = LANGUAGES.filter((l) => LATIN.has(l.code)).length;
  const total = LANGUAGES.length;
  const printable = total - blocked;

  console.log(`\n  ${printable}/${total} languages print in their own script`
    + ` (${latin} need no font — they use the Latin alphabet).`);

  if (blocked) {
    console.log(`  ${blocked} language(s) will print an English report that says why.`);
    console.log('  Install them with:  npm run fonts:install\n');
  } else {
    console.log('  Every offered language can be printed in its own script.\n');
  }

  // The other half of a correct report: the words.
  const haveCatalogue = fs.existsSync(CATALOGUE_DIR);
  const localeCount = haveCatalogue
    ? fs.readdirSync(CATALOGUE_DIR).filter((f) => f.endsWith('.json')).length
    : 0;

  if (haveCatalogue) {
    console.log(`  Report catalogue: ${localeCount} locale file(s) found.\n`);
  } else {
    console.log('  Report catalogue: NOT FOUND at frontend/src/i18n/locales.');
    console.log('  Reports would render in English whatever language is requested,');
    console.log('  and whatever fonts are installed.\n');
  }

  const failing = (blocked && process.argv.includes('--require')) || !haveCatalogue;
  return process.argv.includes('--require') && failing ? 1 : 0;
};

process.exit(main());
