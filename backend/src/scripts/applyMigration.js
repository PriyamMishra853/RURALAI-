/**
 * Apply named migrations to an existing database, without dropping anything.
 *
 * applyV2.js rebuilds from 01_reset.sql and is destructive by design — it is
 * how a fresh environment is created. There was no way to add migration 12 to a
 * database that already holds real visits, which meant every new migration
 * either waited for a rebuild or got applied by hand in a SQL console with no
 * record of what ran.
 *
 * This runs exactly the files you name, in the order you name them, and nothing
 * else. It refuses to run 01_reset.sql at all: that file exists to destroy, and
 * destroying should never be something this script can be talked into.
 *
 * Usage:
 *   node src/scripts/applyMigration.js 12_referral_facility_attrs.sql 13_document_jobs.sql
 *   node src/scripts/applyMigration.js --dry-run 13_document_jobs.sql
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeClient, runSqlFile } from './lib/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const V2_DIR = path.resolve(__dirname, '../../../database/v2');

const main = async () => {
  const dryRun = process.argv.includes('--dry-run');
  const names = process.argv.slice(2).filter((a) => !a.startsWith('--'));

  if (!names.length) {
    const available = fs.readdirSync(V2_DIR).filter((f) => /^\d{2}_.*\.sql$/.test(f)).sort();
    console.log('Name the migrations to apply, in order. Available:\n');
    for (const f of available) console.log(`  ${f}`);
    console.log('\n  node src/scripts/applyMigration.js 12_referral_facility_attrs.sql 13_document_jobs.sql');
    process.exit(1);
  }

  for (const name of names) {
    if (name.includes('reset')) {
      console.error(`Refusing to run ${name}. That file drops the database; use applyV2.js if that is genuinely what you want.`);
      process.exit(1);
    }
    if (!fs.existsSync(path.join(V2_DIR, name))) {
      console.error(`No such migration: ${name}`);
      process.exit(1);
    }
  }

  console.log(`Target: ${new URL(process.env.DATABASE_URL).hostname}`);
  console.log(`Applying: ${names.join(', ')}\n`);

  if (dryRun) {
    for (const name of names) {
      const sql = fs.readFileSync(path.join(V2_DIR, name), 'utf8');
      console.log(`--- ${name} (${sql.split('\n').length} lines) ---`);
      // Statements that change shape, so a reviewer can see the effect without
      // reading the whole file.
      for (const line of sql.split('\n')) {
        if (/^\s*(CREATE|ALTER|DROP)\s/i.test(line)) console.log(`  ${line.trim()}`);
      }
    }
    console.log('\n--dry-run: nothing applied.');
    return;
  }

  // makeClient() returns an unconnected client. A query issued before connect()
  // waits forever, Node finds nothing else to do and exits silently, and the
  // run looks like it stopped for no reason with nothing applied. That is
  // exactly what this script did until this line existed.
  const client = makeClient();
  await client.connect();
  try {
    for (const name of names) {
      console.log(`  ${name} ...`);
      await runSqlFile(client, path.join(V2_DIR, name));
      console.log('    ok');
    }
    console.log('\nDone.');
  } finally {
    await client.end();
  }
};

main().catch((err) => {
  console.error(`\nMigration failed: ${err.message}`);
  process.exit(1);
});
