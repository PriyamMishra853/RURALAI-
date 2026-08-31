/**
 * Apply the v2 database: drop v1, create the new schema, enable RLS.
 *
 * DESTRUCTIVE. Requires --confirm, and prints what it is about to destroy
 * first. Run `npm run inspect` beforehand if you are not certain the target
 * holds only demo data.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeClient, runSqlFile } from './lib/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const V2_DIR = path.resolve(__dirname, '../../../database/v2');

/*
 * Every numbered migration in database/v2, in order, read from disk.
 *
 * This was a hand-maintained list and it had drifted four migrations behind:
 * 07 (case handoff), 08 (visit withdrawal), 09 (emergency registration) and
 * 10 (admin analytics) all existed and none of them ran. Anyone rebuilding
 * from this script got a database where handing a case to a doctor,
 * withdrawing an accidental entry, registering an emergency patient and the
 * whole admin dashboard were broken — and nothing said so, because the script
 * reported success for the files it did know about.
 *
 * Reading the directory means adding a migration is enough to have it applied.
 */
const FILES = fs
  .readdirSync(V2_DIR)
  .filter((f) => /^\d{2}_.*\.sql$/.test(f))
  .sort();

const main = async () => {
  if (!process.argv.includes('--confirm')) {
    console.log(`
This DROPS every existing table in the public schema and rebuilds it.

  Target: ${new URL(process.env.DATABASE_URL).hostname}

Check what is there first:   npm run inspect
Then, if you are sure:       npm run db:apply -- --confirm
`);
    process.exit(1);
  }

  const client = makeClient();
  await client.connect();
  console.log('Connected. Applying v2 schema:\n');

  try {
    for (const f of FILES) {
      await runSqlFile(client, path.join(V2_DIR, f));
    }

    const { rows: tables } = await client.query(
      "SELECT count(*)::int n FROM information_schema.tables WHERE table_schema = 'public'"
    );
    const { rows: policies } = await client.query(
      "SELECT count(*)::int n FROM pg_policies WHERE schemaname = 'public'"
    );
    const { rows: unprotected } = await client.query(`
      SELECT tablename FROM pg_tables t
      WHERE schemaname = 'public'
        AND NOT EXISTS (
          SELECT 1 FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relname = t.tablename AND n.nspname = 'public' AND c.relrowsecurity
        )
    `);

    console.log(`
================================================================
V2 SCHEMA APPLIED
================================================================
  Tables            ${tables[0].n}
  RLS policies      ${policies[0].n}   (v1 had 0)
  Tables without RLS ${unprotected.length ? unprotected.map((r) => r.tablename).join(', ') : 'none'}

  Next:  npm run seed          (36 states, 75 UP districts, demo staff/patients)
         npm run seed:root     (your own super_admin)
================================================================
`);
  } finally {
    await client.end();
  }
};

main().catch((err) => {
  console.error('\nApply failed:', err.message);
  process.exit(1);
});
