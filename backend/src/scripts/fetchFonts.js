/**
 * Download the Noto faces the PDF reports need.
 *
 *   npm run fonts:install              # every script this app offers
 *   npm run fonts:install -- --script Devanagari
 *   npm run fonts:install -- --list    # what is missing, download nothing
 *
 * ── Why this is a script and not a committed asset ──────────────────────────
 *
 * The twelve families are about 10 MB together. They are not ours to
 * redistribute, they change independently of this codebase, and a deployment
 * that only ever prints English should not have to carry them. So the build
 * fetches them instead — see nixpacks.toml, where the step is deliberately
 * non-fatal.
 *
 * ── Why failure here must not fail the build ────────────────────────────────
 *
 * Without a font the report still renders. It renders in English, and prints a
 * line on the page saying which script was unavailable, so nobody is misled
 * about what the patient was handed (see reportLocale.js). Blocking a deploy
 * over a font mirror being briefly unreachable would take a working clinical
 * system offline to fix a degradation that already announces itself.
 *
 * So: every failure is reported and skipped, and the process exits 0 unless
 * `--strict` is passed.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SCRIPT_FONT } from '../services/reportLocale.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.resolve(__dirname, '../../assets/fonts');

/**
 * The canonical Noto distribution.
 *
 * `hinted/ttf` rather than the variable or unhinted builds: pdfkit embeds a
 * static TTF, and hinting is what keeps 7pt footer text legible on the cheap
 * inkjets a sub-centre actually prints on.
 */
const BASE = 'https://raw.githubusercontent.com/notofonts/notofonts.github.io/main/fonts';
const url = (family, weight) => `${BASE}/${family}/hinted/ttf/${family}-${weight}.ttf`;

const WEIGHTS = ['Regular', 'Bold'];

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
};

const human = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;

const download = async (family, weight, dest) => {
  const res = await fetch(url(family, weight), { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const buf = Buffer.from(await res.arrayBuffer());

  /*
   * A truncated or HTML-error response written to disk is worse than no file:
   * reportLocale would find it, register it with pdfkit, and the render would
   * throw mid-report rather than falling back cleanly to English.
   *
   * The magic number is the real check — the first four bytes of a TrueType
   * file are 0x00010000 (or 'true'), and of an OpenType file 'OTTO'. An error
   * page or a redirect body fails it immediately.
   *
   * The size floor is only a guard against a truncated-but-valid-looking
   * response, and is deliberately low. An earlier version used 20 KB and
   * rejected Ol Chiki and Meetei Mayek, which are perfectly good fonts that
   * happen to be about 15 KB because those scripts have a few dozen glyphs
   * rather than a few hundred. Sizing a check to Devanagari and applying it to
   * every script is how a working font gets thrown away.
   */
  const magic = buf.subarray(0, 4);
  const isTtf = magic.equals(Buffer.from([0x00, 0x01, 0x00, 0x00])) || magic.toString('latin1') === 'true';
  const isOtf = magic.toString('latin1') === 'OTTO';
  if (!isTtf && !isOtf) throw new Error('not a TrueType/OpenType file');
  if (buf.length < 4096) throw new Error(`truncated (${buf.length} bytes)`);

  // Write beside the target and rename, so an interrupted run never leaves a
  // half-written font that looks installed.
  const tmp = `${dest}.part`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, dest);
  return buf.length;
};

const main = async () => {
  const listOnly = process.argv.includes('--list');
  const strict = process.argv.includes('--strict');
  const only = arg('script');

  fs.mkdirSync(FONT_DIR, { recursive: true });

  const scripts = Object.entries(SCRIPT_FONT)
    .filter(([name]) => !only || name.toLowerCase() === only.toLowerCase())
    .sort((a, b) => b[1].languages.length - a[1].languages.length);

  if (!scripts.length) {
    console.error(`Unknown script "${only}". Known: ${Object.keys(SCRIPT_FONT).join(', ')}`);
    return 1;
  }

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  let bytes = 0;

  for (const [script, def] of scripts) {
    for (const weight of WEIGHTS) {
      const dest = path.join(FONT_DIR, `${def.file}-${weight}.ttf`);

      if (fs.existsSync(dest)) {
        skipped += 1;
        continue;
      }
      if (listOnly) {
        console.log(`  missing  ${def.file}-${weight}.ttf  (${script}: ${def.languages.length} language(s))`);
        failed += 1;
        continue;
      }

      try {
        const n = await download(def.file, weight, dest);
        bytes += n;
        downloaded += 1;
        console.log(`  ok       ${def.file}-${weight}.ttf  ${human(n)}`);
      } catch (err) {
        failed += 1;
        console.warn(`  failed   ${def.file}-${weight}.ttf  ${err.message}`);
      }
    }
  }

  if (listOnly) {
    console.log(`\n${failed} file(s) missing, ${skipped} already present.`);
    return strict && failed ? 1 : 0;
  }

  console.log(`\n${downloaded} downloaded (${human(bytes)}), ${skipped} already present, ${failed} failed.`);

  if (failed) {
    console.log('Reports for the affected scripts will render in English and say so on the page.');
  }

  return strict && failed ? 1 : 0;
};

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    // Never let an unexpected throw here fail a deploy — see the header.
    console.warn(`font download aborted: ${err.message}`);
    process.exit(process.argv.includes('--strict') ? 1 : 0);
  });
