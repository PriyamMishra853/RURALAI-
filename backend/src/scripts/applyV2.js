/**
 * Apply the v2 database: drop v1, create the new schema, enable RLS.
 *
 * DESTRUCTIVE. Requires --confirm, and prints what it is about to destroy
 * first. Run `npm run inspect` beforehand if you are not certain the target
 * holds only demo data.
 */

import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeClient, runSqlFile } from './lib/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const V2_DIR = path.resolve(__dirname, '../../../database/v2');

const FILES = ['01_reset.sql', '02_schema.sql', '03_rls.sql', '04_visit_history.sql', '05_consultations.sql', '06_patient_images.sql'];

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
