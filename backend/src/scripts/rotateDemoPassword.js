/**
 * Rotate the shared demo password.
 *
 * The demo accounts share one password so the demo is usable, which is a
 * reasonable trade for seeded accounts holding no real patient data — but it
 * means the password reaches every person who is ever shown the system, gets
 * pasted into chats and tickets, and never expires on its own.
 *
 *   npm run rotate:demo                  # generate a new password
 *   npm run rotate:demo -- 'YourChoice'  # set a specific one
 *
 * The new password is written to database/v2/DEMO_CREDENTIALS.md, which is
 * gitignored, and printed once. It is deliberately not echoed anywhere else:
 * the point of rotating is to stop it living in places that outlast its use.
 *
 * Only accounts on the demo domain are touched. A real administrator account —
 * the one created by seed:root — is never in scope, and this refuses to run
 * against anything that is not a seeded demo address.
 */

import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const DEMO_DOMAIN = '@vvc-demo.example.com';

/**
 * A readable password that is still hard to guess.
 *
 * Two words, a number and a symbol beats a random string here: it has to be
 * typed on a phone during a demonstration, and an unreadable password gets
 * written on a sticky note, which is worse than a weaker one.
 */
const generate = () => {
  const words = ['Harbour', 'Lantern', 'Meadow', 'Copper', 'Willow', 'Anchor', 'Falcon', 'Cedar', 'Marble', 'Quartz'];
  const pick = () => words[crypto.randomInt(words.length)];
  const digits = String(crypto.randomInt(1000, 9999));
  return `${pick()}-${pick()}-${digits}!`;
};

const main = async () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
    process.exit(1);
  }

  const requested = process.argv[2];
  if (requested && requested.length < 12) {
    console.error('Choose at least 12 characters.');
    process.exit(1);
  }
  const password = requested || generate();

  const supabase = createClient(url, key);

  // Page through the auth users; there is no server-side filter for this.
  const demoUsers = [];
  for (let page = 1; page <= 40; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      console.error('Could not list accounts:', error.message);
      process.exit(1);
    }
    const batch = data?.users || [];
    demoUsers.push(...batch.filter((u) => (u.email || '').endsWith(DEMO_DOMAIN)));
    if (batch.length < 200) break;
  }

  if (!demoUsers.length) {
    console.error(`No accounts found on ${DEMO_DOMAIN}. Nothing to rotate.`);
    process.exit(1);
  }

  console.log(`Rotating ${demoUsers.length} demo account(s) on ${DEMO_DOMAIN} …`);

  let done = 0;
  const failed = [];
  for (const user of demoUsers) {
    const { error } = await supabase.auth.admin.updateUserById(user.id, { password });
    if (error) failed.push(`${user.email}: ${error.message}`);
    else done += 1;
    if (done % 50 === 0) process.stdout.write(`\r  ${done}/${demoUsers.length}`);
  }
  process.stdout.write(`\r  ${done}/${demoUsers.length}\n`);

  if (failed.length) {
    console.error(`\n${failed.length} account(s) did not rotate:`);
    failed.slice(0, 5).forEach((f) => console.error('  ' + f));
  }

  // Record it where the seed already records demo logins — a gitignored file.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const credsPath = path.resolve(here, '../../../database/v2/DEMO_CREDENTIALS.md');
  try {
    let doc = fs.existsSync(credsPath) ? fs.readFileSync(credsPath, 'utf8') : '# Demo credentials\n';
    doc = doc.replace(/Shared password for every demo account below: `[^`]*`/,
      `Shared password for every demo account below: \`${password}\``);
    if (!doc.includes(password)) {
      doc += `\n\nShared password for every demo account below: \`${password}\`\n`;
    }
    doc += `\n<!-- rotated ${new Date().toISOString()} -->\n`;
    fs.writeFileSync(credsPath, doc, 'utf8');
    console.log(`\nWritten to ${path.relative(process.cwd(), credsPath)} (gitignored).`);
  } catch (err) {
    console.warn('Could not update DEMO_CREDENTIALS.md:', err.message);
  }

  console.log(`
================================================================
DEMO PASSWORD ROTATED
================================================================
  Accounts updated  ${done}${failed.length ? ` (${failed.length} failed)` : ''}
  New password      ${password}

  Shown once, here. It is in DEMO_CREDENTIALS.md, which is
  gitignored — the previous one is now invalid everywhere.

  If seeds are re-run, set DEMO_ACCOUNT_PASSWORD to this value
  first, or seedV2 will reset the accounts to its own default.
================================================================
`);
};

main().catch((err) => {
  console.error('Rotation failed:', err.message);
  process.exit(1);
});
