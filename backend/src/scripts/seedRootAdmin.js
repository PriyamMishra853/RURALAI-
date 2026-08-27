/**
 * Provision the super_admin account.
 *
 * Spec §3.8: the administrator signs in with "a secret email/password known
 * only to the developer — not a public signup flow". So this account is
 * deliberately kept out of the demo seed, out of the repository, and out of
 * the frontend bundle. It exists only where you run this command with your own
 * credentials in the environment.
 *
 *   ROOT_ADMIN_EMAIL=you@example.com \
 *   ROOT_ADMIN_PASSWORD='...' \
 *   npm run seed:root
 *
 * Re-running with the same email rotates the password rather than erroring.
 */

import 'dotenv/config';
import { makeClient } from './lib/db.js';
import { supabaseAdmin } from '../config/supabase.js';

const MIN_PASSWORD_LENGTH = 12;

const main = async () => {
  const email = (process.env.ROOT_ADMIN_EMAIL || '').toLowerCase().trim();
  const password = process.env.ROOT_ADMIN_PASSWORD || '';
  const fullName = process.env.ROOT_ADMIN_NAME || 'Platform Administrator';

  if (!email || !password) {
    console.error(
      'Refusing to run: set ROOT_ADMIN_EMAIL and ROOT_ADMIN_PASSWORD.\n' +
      "There is no default — a super_admin with a known password is the same as no password."
    );
    process.exit(1);
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`Refusing to run: ROOT_ADMIN_PASSWORD is shorter than ${MIN_PASSWORD_LENGTH} characters.`);
    process.exit(1);
  }

  const client = makeClient();
  await client.connect();

  try {
    // Is there already an Auth user for this address?
    let authUserId = null;
    const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const existing = list?.users?.find((u) => u.email?.toLowerCase() === email);

    if (existing) {
      await supabaseAdmin.auth.admin.updateUserById(existing.id, { password });
      authUserId = existing.id;
      console.log('Existing Auth user found — password rotated.');
    } else {
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName, root: true }
      });
      if (error) throw new Error(`Auth user creation failed: ${error.message}`);
      authUserId = data.user.id;
      console.log('Auth user created.');
    }

    // super_admin carries no region scope — the CHECK constraint requires both
    // state_id and district_id to be NULL for this role.
    await client.query(
      `INSERT INTO staff_profiles (auth_user_id, full_name, email, role, status, is_demo)
       VALUES ($1, $2, $3, 'super_admin', 'active', FALSE)
       ON CONFLICT (email) DO UPDATE
         SET auth_user_id = EXCLUDED.auth_user_id,
             role         = 'super_admin',
             status       = 'active',
             full_name    = EXCLUDED.full_name`,
      [authUserId, fullName, email]
    );

    console.log(`\nsuper_admin ready: ${email}`);
    console.log('This account is not listed in DEMO_CREDENTIALS.md and is not referenced by the frontend.');
  } finally {
    await client.end();
  }
};

main().catch((err) => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
