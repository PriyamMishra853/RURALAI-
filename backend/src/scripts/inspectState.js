/**
 * Read-only inventory of the live database.
 *
 * Run this before `npm run db:apply` — that command is destructive, and this is
 * how you confirm the target holds only what you think it holds.
 */

import 'dotenv/config';
import { supabaseAdmin } from '../config/supabase.js';

const TABLES = [
  'states', 'districts', 'staff_profiles', 'doctor_profiles', 'patients',
  'visits', 'visit_vitals', 'visit_symptoms', 'patient_documents',
  'ai_assessments', 'consultations', 'doctor_reviews', 'prescriptions', 'audit_logs'
];

console.log(`Target: ${process.env.SUPABASE_URL}\n`);

let missing = 0;
for (const t of TABLES) {
  const { count, error } = await supabaseAdmin.from(t).select('*', { count: 'exact', head: true });
  if (error) {
    missing += 1;
    console.log(String(t).padEnd(22), 'not present');
  } else {
    console.log(String(t).padEnd(22), `${count} rows`);
  }
}

if (missing === TABLES.length) {
  console.log('\nNo v2 tables found — this database has not had `npm run db:apply` run against it yet.');
  process.exit(0);
}

const { data: staff } = await supabaseAdmin.from('staff_profiles').select('role, status, is_demo');
if (staff?.length) {
  const byRole = {};
  for (const s of staff) byRole[s.role] = (byRole[s.role] || 0) + 1;
  console.log('\nStaff by role:', byRole);
  console.log('Demo accounts:', staff.filter((s) => s.is_demo).length, '/', staff.length);
}

const { count: realPatients } = await supabaseAdmin
  .from('patients').select('*', { count: 'exact', head: true }).eq('is_demo', false);

if (realPatients) {
  console.log(`\nWARNING: ${realPatients} patient row(s) are NOT flagged is_demo.`);
  console.log('Do not run `npm run db:apply` against this database without checking what they are.');
} else {
  console.log('\nAll patient rows are flagged is_demo.');
}
