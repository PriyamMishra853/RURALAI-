import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { supabaseAdmin } from '../config/supabase.js';
import { ROLE_DB_TO_API, ADMIN_ROLES, ROLES } from '../config/roles.js';

/**
 * Load the staff profile that a verified identity maps to.
 *
 * A token proves who you are. It does not prove you are staff. The profile row
 * is the only source of role and region scope — never the token body, never a
 * request field.
 */
const loadProfile = async ({ authUserId, email }) => {
  let query = supabaseAdmin
    .from('staff_profiles')
    .select('id, auth_user_id, full_name, email, role, status, state_id, district_id');

  query = authUserId ? query.eq('auth_user_id', authUserId) : query.eq('email', String(email).toLowerCase());

  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  return data;
};

const toRequestUser = (profile) => ({
  id: profile.id,
  authUserId: profile.auth_user_id,
  email: profile.email,
  name: profile.full_name,
  role: ROLE_DB_TO_API[profile.role],
  stateId: profile.state_id,
  districtId: profile.district_id
});

/**
 * Authenticate, then authorise the identity as active staff.
 *
 * v1 fell back to `roleMap[profile?.role] || 'CLINIC_ASSISTANT'`, so any valid
 * Supabase token with no staff profile was silently granted clinical access —
 * reintroducing the self-registration path that POST /api/auth/register was
 * deliberately removed to close. No profile now means 403, in every path.
 */
export const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    const token = authHeader.slice(7).trim();
    if (!token) return res.status(401).json({ error: 'Authentication required.' });

    let profile = null;

    // Path 1 — a token this API issued.
    try {
      const decoded = jwt.verify(token, config.jwtSecret);
      profile = await loadProfile({ authUserId: decoded.authUserId, email: decoded.email });
    } catch {
      // Path 2 — a Supabase session token.
      const { data, error } = await supabaseAdmin.auth.getUser(token);
      if (error || !data?.user) {
        return res.status(401).json({ error: 'Invalid or expired authentication token.' });
      }
      profile = await loadProfile({ authUserId: data.user.id, email: data.user.email });
    }

    if (!profile) {
      return res.status(403).json({
        error: 'No staff profile is linked to this account. Accounts are issued by an administrator.'
      });
    }
    if (profile.status !== 'active') {
      return res.status(403).json({ error: `This account is ${profile.status}. Contact an administrator.` });
    }
    if (!ROLE_DB_TO_API[profile.role]) {
      // An unmapped enum value must not fall through to a working role.
      return res.status(403).json({ error: 'This account has no usable role assigned.' });
    }

    req.user = toRequestUser(profile);
    return next();
  } catch (error) {
    console.error('Auth middleware error:', error.message);
    return res.status(500).json({ error: 'Authentication could not be completed.' });
  }
};

export const authorizeRoles = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({
      error: `Access denied. This operation requires: ${roles.join(', ')}.`
    });
  }
  return next();
};

/**
 * Region scope for admin roster queries.
 *
 * Attaches the filter an admin is allowed to see, rather than letting the
 * controller decide. super_admin gets no constraint; everyone else gets one
 * they cannot widen from the request.
 */
export const attachRegionScope = (req, res, next) => {
  const { role, stateId, districtId } = req.user || {};
  if (role === ROLES.SUPER_ADMIN) {
    req.scope = { kind: 'national' };
  } else if (role === ROLES.STATE_ADMIN || (role === ROLES.AUDITOR && stateId)) {
    req.scope = { kind: 'state', stateId };
  } else if (role === ROLES.DISTRICT_ADMIN) {
    req.scope = { kind: 'district', stateId, districtId };
  } else if (role === ROLES.AUDITOR) {
    req.scope = { kind: 'national' };
  } else {
    req.scope = { kind: 'district', stateId, districtId };
  }
  return next();
};

/** Apply req.scope to a supabase query builder over staff_profiles/patients. */
export const applyScope = (query, scope) => {
  if (!scope || scope.kind === 'national') return query;
  if (scope.kind === 'state') return query.eq('state_id', scope.stateId);
  return query.eq('district_id', scope.districtId);
};

export const requireAdmin = authorizeRoles(...ADMIN_ROLES);
