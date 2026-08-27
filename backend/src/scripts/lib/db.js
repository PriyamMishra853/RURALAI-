import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import pg from 'pg';

/**
 * Direct Postgres access for DDL.
 *
 * supabase-js speaks PostgREST, which cannot CREATE TABLE or CREATE POLICY, so
 * schema work goes through the connection string instead. Supabase's pooler
 * presents a certificate for the pooler host rather than the project host, so
 * verification is relaxed for this admin-only path — the connection is still
 * TLS-encrypted, and the credential travels over it either way.
 */
export const makeClient = () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Copy it from Supabase → Project Settings → Database → Connection string (URI).'
    );
  }
  return new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
};

/** Run one .sql file as a single batch and report what it did. */
export const runSqlFile = async (client, filePath) => {
  const sql = fs.readFileSync(filePath, 'utf8');
  const label = path.basename(filePath);
  process.stdout.write(`   ${label} ... `);
  try {
    await client.query(sql);
    console.log('ok');
  } catch (err) {
    console.log('FAILED');
    throw new Error(`${label}: ${err.message}`);
  }
};

/** Insert rows in chunks; returns the total inserted. */
export const bulkInsert = async (client, table, columns, rows, chunkSize = 500) => {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const values = [];
    const placeholders = chunk.map((row, r) => {
      const cells = columns.map((_, c) => `$${r * columns.length + c + 1}`);
      values.push(...row);
      return `(${cells.join(', ')})`;
    });
    await client.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders.join(', ')}`,
      values
    );
    inserted += chunk.length;
    process.stdout.write(`\r   ${table}: ${inserted}/${rows.length}`);
  }
  if (rows.length) process.stdout.write('\n');
  return inserted;
};
