import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { makeClient } from './lib/db.js';

/**
 * A copy of the database that this project controls.
 *
 * Supabase takes managed backups on its paid tiers, and those remain the real
 * disaster-recovery story. This exists for the parts that story does not cover:
 * proving to a hospital that a copy can be produced on demand, holding a
 * known-good snapshot from the morning of a pilot, and having something
 * restorable if the project's Supabase account itself becomes unreachable.
 *
 * ── What is in the file ────────────────────────────────────────────────────
 *
 * Patient names, Aadhaar numbers, phone numbers, symptoms, diagnoses and
 * prescriptions. It is the most sensitive artefact this repository can
 * produce. Two consequences, both enforced below rather than written in a
 * README nobody reads:
 *
 *   · it is never written anywhere git would pick it up
 *   · the path is printed at the end, because somebody has to decide where it
 *     then lives, and that decision cannot be made by a script
 *
 * Encrypt it at rest and delete it when the pilot ends.
 *
 * ── What is NOT in the file ────────────────────────────────────────────────
 *
 * Uploaded photographs and documents live in Supabase Storage, not in
 * Postgres, so they are not in this dump. The rows that reference them are, so
 * a restore gives a record that knows a document existed, with no image behind
 * it. Storage has to be exported separately.
 *
 * Usage:
 *   npm run db:backup              a full dump (pg_dump if present, else JSON)
 *   npm run db:backup -- --json    force the JSON export
 *   BACKUP_DIR=D:/secure npm run db:backup
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);

/**
 * Refuse to write patient data anywhere git is watching.
 *
 * A dump inside the working tree is one `git add -A` away from being published
 * for ever, and this repository has already had secrets committed once. The
 * check is on the ignore rules rather than on good intentions.
 */
const assertNotCommittable = (dir) => {
  const inside = !path.relative(REPO_ROOT, dir).startsWith('..');
  if (!inside) return;

  const check = spawnSync('git', ['check-ignore', '-q', dir], { cwd: REPO_ROOT });
  if (check.status !== 0) {
    console.error(
      `\nRefusing to write a database dump to ${dir}.\n`
      + 'That path is inside the repository and is not gitignored, so the dump\n'
      + 'could be committed. Add it to .gitignore, or set BACKUP_DIR to a\n'
      + 'directory outside the repository.\n'
    );
    process.exit(1);
  }
};

const withPgDump = (outDir) => {
  const probe = spawnSync('pg_dump', ['--version'], { encoding: 'utf8' });
  if (probe.error) return null;

  const file = path.join(outDir, `ruralai-${stamp()}.dump`);
  console.log(`pg_dump found (${probe.stdout.trim()}). Writing a custom-format dump.`);

  const run = spawnSync(
    'pg_dump',
    ['-Fc', '--no-owner', '--no-privileges', '-d', process.env.DATABASE_URL, '-f', file],
    { encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] }
  );

  if (run.status !== 0) {
    console.error('pg_dump failed. Falling back to the JSON export.');
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return null;
  }

  const bytes = fs.statSync(file).size;
  if (bytes === 0) {
    console.error('pg_dump produced an empty file. Falling back to the JSON export.');
    fs.unlinkSync(file);
    return null;
  }

  return { file, bytes, restore: `pg_restore --clean --no-owner -d "<connection string>" "${file}"` };
};

/**
 * Every public table, one JSON-lines file each.
 *
 * pg_dump is the better artefact, but it is a PostgreSQL client tool that is
 * not installed on most Windows laptops, and a backup procedure nobody can run
 * is not a backup procedure. This needs nothing that is not already a
 * dependency of this project.
 */
const withJson = async (outDir) => {
  const dir = path.join(outDir, `ruralai-${stamp()}`);
  fs.mkdirSync(dir, { recursive: true });
  console.log(`Exporting to JSON lines in ${dir}`);

  const client = makeClient();
  await client.connect();
  let bytes = 0;
  const counts = [];

  try {
    const { rows: tables } = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
    );

    for (const { tablename } of tables) {
      // Identifier, not a value: quoted rather than parameterised, which a
      // table name cannot be.
      const { rows } = await client.query(`SELECT * FROM "${tablename}"`);
      const file = path.join(dir, `${tablename}.jsonl`);
      const body = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
      fs.writeFileSync(file, body, 'utf8');
      bytes += Buffer.byteLength(body);
      counts.push({ table: tablename, rows: rows.length });
      process.stdout.write(`\r   ${tablename}: ${rows.length} rows          `);
    }
    process.stdout.write('\n');
  } finally {
    await client.end();
  }

  const total = counts.reduce((n, c) => n + c.rows, 0);
  console.log(`\n${counts.length} tables, ${total.toLocaleString('en-IN')} rows.`);
  for (const c of counts.filter((c) => c.rows > 0).sort((a, b) => b.rows - a.rows).slice(0, 10)) {
    console.log(`   ${String(c.rows).padStart(7)}  ${c.table}`);
  }

  return {
    file: dir,
    bytes,
    restore: 'Each file is one table as JSON lines. Restore by inserting them in '
      + 'foreign-key order, or use pg_dump/pg_restore for a real recovery.'
  };
};

const main = async () => {
  const outDir = process.env.BACKUP_DIR
    ? path.resolve(process.env.BACKUP_DIR)
    : path.join(REPO_ROOT, 'backups');

  fs.mkdirSync(outDir, { recursive: true });
  assertNotCommittable(outDir);

  console.log(`Target: ${new URL(process.env.DATABASE_URL).hostname}`);

  const forceJson = process.argv.includes('--json');
  const result = (!forceJson && withPgDump(outDir)) || await withJson(outDir);

  const mb = (result.bytes / 1048576).toFixed(2);
  console.log('\n----------------------------------------------------------------');
  console.log(`Backup written: ${result.file}`);
  console.log(`Size: ${mb} MB`);
  console.log(`Restore: ${result.restore}`);
  console.log('\nThis file contains patient data. Encrypt it at rest, keep it off');
  console.log('shared drives, and delete it when it is no longer needed.');
  console.log('Uploaded images and documents are NOT included — they live in');
  console.log('Supabase Storage and must be exported separately.');
  console.log('----------------------------------------------------------------');
};

main().catch((err) => {
  console.error(`\nBackup failed: ${err.message}`);
  process.exit(1);
});
