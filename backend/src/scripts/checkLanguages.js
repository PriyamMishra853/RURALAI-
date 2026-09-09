/**
 * Fail if the server's language registry and the browser's have drifted apart.
 *
 * The two lists exist separately on purpose — the API must not import from the
 * browser bundle — but they describe the same set of languages, and a language
 * present on one side and absent from the other is a bug that only shows up as
 * a health worker picking a language and getting English clinical audio back.
 *
 * Run by `npm run check`. Exits non-zero on drift so CI catches it rather than
 * a user does.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { LANGUAGES as SERVER_LANGUAGES } from '../config/languages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_LANGUAGES = path.resolve(__dirname, '../../../frontend/src/i18n/languages.js');

/**
 * Read the codes out of the frontend list textually rather than importing it.
 *
 * That file is ESM with JSX-adjacent tooling around it and lives outside this
 * package; parsing the `code:` fields is both simpler and more robust than
 * arranging for Node here to resolve a module over there.
 */
const readFrontendCodes = () => {
  if (!fs.existsSync(FRONTEND_LANGUAGES)) return null;
  const src = fs.readFileSync(FRONTEND_LANGUAGES, 'utf8');
  const block = src.slice(src.indexOf('export const LANGUAGES'), src.indexOf('export const DEFAULT_LANGUAGE'));
  return [...block.matchAll(/code:\s*'([a-z]{2,3})'/g)].map((m) => m[1]);
};

const main = () => {
  const frontend = readFrontendCodes();

  if (!frontend) {
    // A backend-only checkout is a legitimate deployment shape, not a failure.
    console.log('languages: frontend list not present in this checkout — skipped.');
    return 0;
  }

  const server = SERVER_LANGUAGES.map((l) => l.code);
  const missingOnServer = frontend.filter((c) => !server.includes(c));
  const missingOnClient = server.filter((c) => !frontend.includes(c));

  if (!missingOnServer.length && !missingOnClient.length) {
    console.log(`languages: ${server.length} codes, both lists agree.`);
    return 0;
  }

  if (missingOnServer.length) {
    console.error(`languages: offered in the UI but unknown to the API — ${missingOnServer.join(', ')}`);
    console.error('  A user can select these and the server will fall back to English.');
  }
  if (missingOnClient.length) {
    console.error(`languages: known to the API but not offered in the UI — ${missingOnClient.join(', ')}`);
  }
  return 1;
};

process.exit(main());
