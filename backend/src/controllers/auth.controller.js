import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { supabase, supabaseAdmin } from '../config/supabase.js';
import { logAuditEvent } from '../middleware/audit.middleware.js';
import { ROLE_DB_TO_API, HOME_ROUTE } from '../config/roles.js';

/**
 * There is no registration endpoint anywhere in this file, and no route file
 * exposes one. Per spec §3.8 doctors and clinic assistants are
 * government-assigned roles: accounts exist only because an administrator
 * created them through POST /api/admin/users.
 */

const issueToken = (profile) =>
  jwt.sign(
    {
      sub: profile.id,
      authUserId: profile.auth_user_id,
      email: profile.email,
      // Role is carried for convenience only. Every request re-reads it from
      // staff_profiles in auth.middleware — a token claim is never trusted for
      // authorisation, so an old token cannot preserve a revoked role.
      role: ROLE_DB_TO_API[profile.role]
    },
    config.jwtSecret,
    { expiresIn: '12h' }
  );

const publicUser = (profile, region) => ({
  id: profile.id,
  email: profile.email,
  name: profile.full_name,
  role: ROLE_DB_TO_API[profile.role],
  phone: profile.phone,
  state: region.state || null,
  district: region.district || null,
  stateId: profile.state_id,
  districtId: profile.district_id,
  home: HOME_ROUTE[ROLE_DB_TO_API[profile.role]] || '/'
});

/**
 * POST /api/auth/login  { email, password }
 *
 * The password is verified by Supabase Auth. The role and region always come
 * from staff_profiles and can never be chosen by the client.
 */
export const login = async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const cleanEmail = String(email).toLowerCase().trim();

  try {
    const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password
    });

    // One message for every failure mode below, so the response cannot be used
    // to tell "no such account" from "wrong password" from "suspended".
    const reject = () => res.status(401).json({ error: 'Invalid email or password.' });

    if (authErr || !authData?.user) return reject();

    const { data: profile } = await supabaseAdmin
      .from('staff_profiles')
      .select('id, auth_user_id, full_name, email, phone, role, status, state_id, district_id')
      .eq('auth_user_id', authData.user.id)
      .maybeSingle();

    if (!profile) {
      // An Auth user with no staff profile is not staff. Signing them in with
      // a default role is exactly the hole that the removed register route had.
      await logAuditEvent({
        action: 'LOGIN_DENIED_NO_PROFILE',
        entityType: 'AUTH',
        metadata: { email: cleanEmail },
        ip: req.ip
      });
      return reject();
    }
    if (profile.status !== 'active') {
      await logAuditEvent({
        actorId: profile.id,
        actorRole: profile.role,
        action: 'LOGIN_DENIED_INACTIVE',
        entityType: 'AUTH',
        metadata: { status: profile.status },
        ip: req.ip
      });
      return reject();
    }

    // Resolve region names for the UI header.
    const region = {};
    if (profile.state_id) {
      const { data: s } = await supabaseAdmin.from('states').select('name').eq('id', profile.state_id).maybeSingle();
      region.state = s?.name;
    }
    if (profile.district_id) {
      const { data: d } = await supabaseAdmin.from('districts').select('name').eq('id', profile.district_id).maybeSingle();
      region.district = d?.name;
    }

    await logAuditEvent({
      actorId: profile.id,
      actorRole: profile.role,
      action: 'LOGIN_SUCCESS',
      entityType: 'AUTH',
      entityId: profile.id,
      ip: req.ip
    });

    return res.json({
      token: issueToken(profile),
      user: publicUser(profile, region)
    });
  } catch (error) {
    console.error('Login error:', error.message);
    return res.status(500).json({ error: 'Sign-in could not be completed. Try again.' });
  }
};

/** GET /api/auth/me — re-reads the profile, so a revoked role takes effect immediately. */
export const getMe = async (req, res) => {
  const { data: profile } = await supabaseAdmin
    .from('staff_profiles')
    .select('id, auth_user_id, full_name, email, phone, role, status, state_id, district_id')
    .eq('id', req.user.id)
    .maybeSingle();

  if (!profile || profile.status !== 'active') {
    return res.status(403).json({ error: 'This account is no longer active.' });
  }

  const region = {};
  if (profile.state_id) {
    const { data: s } = await supabaseAdmin.from('states').select('name').eq('id', profile.state_id).maybeSingle();
    region.state = s?.name;
  }
  if (profile.district_id) {
    const { data: d } = await supabaseAdmin.from('districts').select('name').eq('id', profile.district_id).maybeSingle();
    region.district = d?.name;
  }

  return res.json({ user: publicUser(profile, region) });
};

export const logout = async (req, res) => {
  await logAuditEvent({
    actorId: req.user.id,
    action: 'LOGOUT',
    entityType: 'AUTH',
    entityId: req.user.id,
    ip: req.ip
  });
  // The JWT stays valid until it expires — there is no server-side revocation
  // list yet. Short expiry (12h) limits the window; a token deny-list is the
  // real fix and is not built.
  return res.json({ success: true });
};
