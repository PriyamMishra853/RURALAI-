/**
 * Provision the staff accounts the login page offers.
 *
 * Run: npm run seed:staff        (add -- --purge to remove them again)
 *
 * There is no public registration route (plan §C.3), so accounts can only be
 * created by an admin — or by this script, which is the bootstrap case: the
 * very first admin cannot be created by an admin.
 *
 * Each account is created in two places, and BOTH are required for login:
 *   1. Supabase Auth — holds the password.
 *   2. staff_profiles — holds the role. The role is never taken from the
 *      client or from auth metadata, so a compromised auth record still
 *      cannot grant itself a role.
 *
 * Idempotent: re-running updates existing rows rather than failing.
 *
 * ── SECURITY ─────────────────────────────────────────────────────────────
 * The assistant and doctor passwords below are the ones hardcoded in
 * frontend/src/pages/LoginPage.jsx, so they ship inside the public JS bundle.
 * That is a deliberate convenience for a demo and is acceptable ONLY for
 * throwaway accounts on throwaway data.
 *
 * The ADMIN account deliberately does not follow that pattern. It has no
 * default password: set SEED_ADMIN_PASSWORD or the admin is skipped. An admin
 * account whose password is published in a JS bundle is an open door to the
 * whole platform, and this one is going in front of a state government.
 * ─────────────────────────────────────────────────────────────────────────
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in backend/.env');
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const purge = process.argv.includes('--purge');

/**
 * Demo staff. Names are marked as demo data rather than presented as real
 * clinicians — registration numbers are obviously non-real by construction so
 * nobody mistakes one for a genuine NMC number.
 */
const STAFF = [
  {
    email: 'assistant@clinic.org',
    password: 'Assist@123',
    full_name: 'Demo Clinic Assistant',
    role: 'clinic_assistant',
    phone: '+91-00000-00001'
  },
  {
    email: 'doctor@clinic.org',
    password: 'Doctor@123',
    full_name: 'Demo Doctor (General Medicine)',
    role: 'doctor',
    phone: '+91-00000-00002',
    doctor: { registration_number: 'DEMO-NMC-0001', specialization: 'General Medicine' }
  },
  {
    email: 'dr.priya@clinic.org',
    password: 'Priya@1234',
    full_name: 'Demo Doctor (Pediatrics)',
    role: 'doctor',
    phone: '+91-00000-00003',
    doctor: { registration_number: 'DEMO-NMC-0002', specialization: 'Pediatrics' }
  },
  {
    email: 'dr.arjun@clinic.org',
    password: 'Arjun@1234',
    full_name: 'Demo Doctor (Cardiology)',
    role: 'doctor',
    phone: '+91-00000-00004',
    doctor: { registration_number: 'DEMO-NMC-0003', specialization: 'Cardiology' }
  },
  {
    email: 'dr.kavita@clinic.org',
    password: 'Kavita@1234',
    full_name: 'Demo Doctor (Dermatology)',
    role: 'doctor',
    phone: '+91-00000-00005',
    doctor: { registration_number: 'DEMO-NMC-0004', specialization: 'Dermatology' }
  },
  {
    email: 'dr.sanjay@clinic.org',
    password: 'Sanjay@1234',
    full_name: 'Demo Doctor (Orthopedics)',
    role: 'doctor',
    phone: '+91-00000-00006',
    doctor: { registration_number: 'DEMO-NMC-0005', specialization: 'Orthopedics' }
  },
  {
    email: 'dr.meera@clinic.org',
    password: 'Meera@1234',
    full_name: 'Demo Doctor (General Medicine)',
    role: 'doctor',
    phone: '+91-00000-00007',
    doctor: { registration_number: 'DEMO-NMC-0006', specialization: 'General Medicine' }
  },
  {
    email: 'admin@clinic.org',
    // No default. See the security note at the top of this file.
    password: process.env.SEED_ADMIN_PASSWORD || null,
    full_name: 'Platform Administrator',
    role: 'admin',
    phone: '+91-00000-00008'
  }
];

/** Find an existing auth user by email, paging through the admin list. */
const findAuthUser = async (email) => {
  let page = 1;
  for (;;) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
    page += 1;
  }
};

const upsertStaff = async (entry) => {
  const email = entry.email.toLowerCase();

  if (!entry.password) {
    return { email, status: 'SKIPPED', detail: 'no password — set SEED_ADMIN_PASSWORD' };
  }

  // 1. Supabase Auth user (holds the password)
  const existing = await findAuthUser(email);
  if (existing) {
    const { error } = await db.auth.admin.updateUserById(existing.id, {
      password: entry.password,
      email_confirm: true
    });
    if (error) throw new Error(`auth update failed: ${error.message}`);
  } else {
    const { error } = await db.auth.admin.createUser({
      email,
      password: entry.password,
      email_confirm: true,
      user_metadata: { full_name: entry.full_name }
    });
    if (error) throw new Error(`auth create failed: ${error.message}`);
  }

  // 2. staff_profiles row (holds the role — the source of truth)
  const { data: profile, error: profErr } = await db
    .from('staff_profiles')
    .upsert(
      {
        full_name: entry.full_name,
        role: entry.role,
        email,
        phone: entry.phone,
        status: 'active'
      },
      { onConflict: 'email' }
    )
    .select()
    .single();
  if (profErr) throw new Error(`staff_profiles upsert failed: ${profErr.code} ${profErr.message}`);

  // 3. doctor_profiles, for doctors only
  if (entry.doctor) {
    const { error: docErr } = await db.from('doctor_profiles').upsert(
      {
        staff_id: profile.id,
        registration_number: entry.doctor.registration_number,
        specialization: entry.doctor.specialization,
        qualification: 'DEMO DATA — not a real qualification',
        is_available_for_consultation: true
      },
      { onConflict: 'staff_id' }
    );
    if (docErr) throw new Error(`doctor_profiles upsert failed: ${docErr.message}`);
  }

  return { email, status: existing ? 'UPDATED' : 'CREATED', detail: entry.role };
};

const removeStaff = async (entry) => {
  const email = entry.email.toLowerCase();
  await db.from('staff_profiles').delete().eq('email', email);
  const existing = await findAuthUser(email);
  if (existing) await db.auth.admin.deleteUser(existing.id);
  return { email, status: 'REMOVED', detail: '' };
};

// ---- Run ----
console.log(`\n${purge ? 'Removing' : 'Provisioning'} demo staff accounts\n${'─'.repeat(66)}`);

let failures = 0;
for (const entry of STAFF) {
  try {
    const r = await (purge ? removeStaff(entry) : upsertStaff(entry));
    const icon = r.status === 'SKIPPED' ? '!' : '✓';
    console.log(`${icon} ${r.email.padEnd(26)} ${r.status.padEnd(8)} ${r.detail}`);
  } catch (err) {
    failures += 1;
    console.log(`✗ ${entry.email.padEnd(26)} FAILED   ${err.message.slice(0, 90)}`);
  }
}

console.log('─'.repeat(66));
if (failures) {
  console.log(`\n${failures} account(s) failed.`);
  console.log('If the error mentions a missing table, the schema is not applied yet —');
  console.log('run database/apply_all.sql in the Supabase SQL Editor first.\n');
  process.exit(1);
}
if (!purge) {
  console.log('\nDemo passwords are the ones shown on the login page.');
  console.log('The admin account needs SEED_ADMIN_PASSWORD and is never given a default.\n');
}
