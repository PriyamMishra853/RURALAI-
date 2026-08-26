import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { supabase, supabaseAdmin } from '../config/supabase.js';
import { logAuditEvent } from '../middleware/audit.middleware.js';

const ROLE_DB_TO_API = {
  clinic_assistant: 'CLINIC_ASSISTANT',
  doctor: 'DOCTOR',
  admin: 'ADMIN'
};
const issueToken = (profile) =>
  jwt.sign(
    {
      id: profile.id,
      email: profile.email,
      name: profile.full_name,
      role: ROLE_DB_TO_API[profile.role] || 'CLINIC_ASSISTANT'
    },
    config.jwtSecret,
    { expiresIn: '24h' }
  );

const publicUser = (profile) => ({
  id: profile.id,
  email: profile.email,
  name: profile.full_name,
  role: ROLE_DB_TO_API[profile.role] || 'CLINIC_ASSISTANT',
  phone: profile.phone
});

/**
 * POST /api/auth/login  { email, password }
 * Password is verified against Supabase Auth. The role always comes from the
 * staff_profiles table — it can never be chosen by the client.
 */
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const cleanEmail = email.toLowerCase().trim();

    // 1. Verify the password with Supabase Auth
    const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password
    });

    if (authErr || !authData?.user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // 2. Load the staff profile (source of truth for role)
    const { data: profile, error: profErr } = await supabaseAdmin
      .from('staff_profiles')
      .select('*')
      .eq('email', cleanEmail)
      .maybeSingle();

    if (profErr || !profile) {
      return res.status(403).json({
        error: 'No staff profile is linked to this account. Ask an administrator to register you.'
      });
    }

    if (profile.status !== 'active') {
      return res.status(403).json({ error: `This account is ${profile.status}. Contact an administrator.` });
    }

    const token = issueToken(profile);

    await logAuditEvent({
      actorId: profile.id,
      actorRole: ROLE_DB_TO_API[profile.role],
      action: 'USER_LOGIN',
      entityType: 'STAFF_PROFILES',
      entityId: profile.id,
      metadata: { email: profile.email }
    });

    return res.json({ token, user: publicUser(profile) });
  } catch (error) {
    console.error('Login error:', error.message);
    return res.status(500).json({ error: 'Server error during authentication', details: error.message });
  }
};

export const logout = async (req, res) => {
  if (req.user) {
    await logAuditEvent({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'USER_LOGOUT',
      entityType: 'STAFF_PROFILES',
      entityId: req.user.id
    });
  }
  return res.json({ message: 'Successfully logged out' });
};

export const getMe = async (req, res) => {
  return res.json({ user: req.user });
};
