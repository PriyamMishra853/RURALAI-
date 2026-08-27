import { supabaseAdmin } from '../config/supabase.js';
import { logAuditEvent } from '../middleware/audit.middleware.js';
import { applyScope } from '../middleware/auth.middleware.js';
import { ROLES, ROLE_API_TO_DB, ROLE_DB_TO_API, CREATABLE_ROLES } from '../config/roles.js';

const STAFF_FIELDS =
  'id, full_name, email, phone, role, status, state_id, district_id, preferred_language, is_demo, created_at';

/** GET /api/admin/regions — states, and districts for one state. */
export const getRegions = async (req, res) => {
  const { stateId } = req.query;

  const { data: states, error: sErr } = await supabaseAdmin
    .from('states').select('id, name, code, region_type').order('name');
  if (sErr) return res.status(500).json({ error: 'Could not load states.' });

  // A scoped admin sees only their own state in the picker.
  const visibleStates =
    req.scope.kind === 'national' ? states : states.filter((s) => s.id === req.scope.stateId);

  let districts = [];
  const targetState = stateId || (req.scope.kind !== 'national' ? req.scope.stateId : null);
  if (targetState) {
    if (req.scope.kind !== 'national' && targetState !== req.scope.stateId) {
      return res.status(403).json({ error: 'That state is outside your administrative region.' });
    }
    const { data } = await supabaseAdmin
      .from('districts').select('id, name, state_id').eq('state_id', targetState).order('name');
    districts = data || [];
    if (req.scope.kind === 'district') {
      districts = districts.filter((d) => d.id === req.scope.districtId);
    }
  }

  return res.json({ states: visibleStates, districts });
};

/**
 * GET /api/admin/users — roster, always constrained to the caller's region.
 * The scope comes from req.scope (derived from the caller's own profile), so a
 * query parameter can narrow the result but never widen it.
 */
export const getUsers = async (req, res) => {
  const { role, districtId, stateId, query, page = 0, pageSize = 50 } = req.query;

  let q = supabaseAdmin.from('staff_profiles').select(STAFF_FIELDS, { count: 'exact' });
  q = applyScope(q, req.scope);

  if (role && ROLE_API_TO_DB[role]) q = q.eq('role', ROLE_API_TO_DB[role]);

  if (districtId) {
    if (req.scope.kind === 'district' && districtId !== req.scope.districtId) {
      return res.status(403).json({ error: 'That district is outside your administrative region.' });
    }
    q = q.eq('district_id', districtId);
  }
  if (stateId) {
    if (req.scope.kind !== 'national' && stateId !== req.scope.stateId) {
      return res.status(403).json({ error: 'That state is outside your administrative region.' });
    }
    q = q.eq('state_id', stateId);
  }
  if (query) q = q.or(`full_name.ilike.%${query}%,email.ilike.%${query}%`);

  const from = Number(page) * Number(pageSize);
  q = q.range(from, from + Number(pageSize) - 1).order('full_name');

  const { data, error, count } = await q;
  if (error) return res.status(500).json({ error: 'Could not load the staff roster.' });

  return res.json({
    total: count ?? 0,
    page: Number(page),
    pageSize: Number(pageSize),
    users: (data || []).map((u) => ({ ...u, role: ROLE_DB_TO_API[u.role] }))
  });
};

/**
 * POST /api/admin/users — the only way a staff account comes into existence.
 *
 * Creates the Supabase Auth user and the profile together. If the profile
 * insert fails the Auth user is removed again, so a half-created account can
 * never be left behind with no role attached — that orphan is exactly what
 * auth.middleware now refuses to sign in.
 */
export const createUser = async (req, res) => {
  const { full_name, email, phone, role, state_id, district_id, password, preferred_language } = req.body || {};

  if (!full_name || !email || !role || !password) {
    return res.status(400).json({ error: 'full_name, email, role and password are required.' });
  }
  if (String(password).length < 12) {
    return res.status(400).json({ error: 'Password must be at least 12 characters.' });
  }

  const allowed = CREATABLE_ROLES[req.user.role] || [];
  if (!allowed.includes(role)) {
    return res.status(403).json({
      error: `Your role may create: ${allowed.join(', ') || 'no roles'}. super_admin is provisioned out of band and never through this API.`
    });
  }

  // Force the region to the creator's own scope where the creator is scoped.
  let stateId = state_id;
  let districtId = district_id;
  if (req.scope.kind === 'state') {
    stateId = req.scope.stateId;
  } else if (req.scope.kind === 'district') {
    stateId = req.scope.stateId;
    districtId = req.scope.districtId;
  }

  const needsDistrict = [ROLES.DOCTOR, ROLES.CLINIC_ASSISTANT, ROLES.DISTRICT_ADMIN].includes(role);
  if (needsDistrict && !districtId) {
    return res.status(400).json({ error: `${role} requires a district_id.` });
  }
  if (role !== ROLES.SUPER_ADMIN && !stateId && role !== ROLES.AUDITOR) {
    return res.status(400).json({ error: `${role} requires a state_id.` });
  }

  const cleanEmail = String(email).toLowerCase().trim();

  const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
    email: cleanEmail,
    password,
    email_confirm: true,
    user_metadata: { full_name, created_by: req.user.id }
  });
  if (authErr) {
    return res.status(400).json({ error: `Account could not be created: ${authErr.message}` });
  }

  const { data: profile, error: profErr } = await supabaseAdmin
    .from('staff_profiles')
    .insert([{
      auth_user_id: authData.user.id,
      full_name,
      email: cleanEmail,
      phone: phone || null,
      role: ROLE_API_TO_DB[role],
      state_id: stateId || null,
      district_id: needsDistrict ? districtId : (role === ROLES.STATE_ADMIN ? null : districtId || null),
      preferred_language: preferred_language || 'Hindi',
      created_by: req.user.id,
      is_demo: false
    }])
    .select(STAFF_FIELDS)
    .single();

  if (profErr) {
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id).catch(() => {});
    return res.status(400).json({ error: `Profile could not be created: ${profErr.message}` });
  }

  await logAuditEvent({
    actorId: req.user.id,
    actorRole: req.user.role,
    action: 'STAFF_ACCOUNT_CREATED',
    entityType: 'STAFF_PROFILES',
    entityId: profile.id,
    metadata: { role, email: cleanEmail, district_id: districtId },
    ip: req.ip
  });

  return res.status(201).json({ ...profile, role: ROLE_DB_TO_API[profile.role] });
};

/** PATCH /api/admin/users/:id — update within scope. Role changes are bounded by CREATABLE_ROLES. */
export const updateUser = async (req, res) => {
  const { id } = req.params;
  const { full_name, phone, status, role, preferred_language } = req.body || {};

  let q = supabaseAdmin.from('staff_profiles').select('id, role, state_id, district_id').eq('id', id);
  q = applyScope(q, req.scope);
  const { data: target } = await q.maybeSingle();

  if (!target) return res.status(404).json({ error: 'No such staff member in your region.' });
  if (target.role === 'super_admin') {
    return res.status(403).json({ error: 'The super administrator account cannot be modified through this API.' });
  }

  const patch = {};
  if (full_name !== undefined) patch.full_name = full_name;
  if (phone !== undefined) patch.phone = phone;
  if (preferred_language !== undefined) patch.preferred_language = preferred_language;
  if (status !== undefined) {
    if (!['active', 'inactive', 'suspended'].includes(status)) {
      return res.status(400).json({ error: 'status must be active, inactive or suspended.' });
    }
    patch.status = status;
  }
  if (role !== undefined) {
    const allowed = CREATABLE_ROLES[req.user.role] || [];
    if (!allowed.includes(role)) {
      return res.status(403).json({ error: `Your role may not assign ${role}.` });
    }
    patch.role = ROLE_API_TO_DB[role];
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update.' });

  const { data, error } = await supabaseAdmin
    .from('staff_profiles').update(patch).eq('id', id).select(STAFF_FIELDS).single();
  if (error) return res.status(400).json({ error: error.message });

  await logAuditEvent({
    actorId: req.user.id, actorRole: req.user.role,
    action: 'STAFF_ACCOUNT_UPDATED', entityType: 'STAFF_PROFILES',
    entityId: id, metadata: patch, ip: req.ip
  });

  return res.json({ ...data, role: ROLE_DB_TO_API[data.role] });
};

/**
 * DELETE /api/admin/users/:id
 *
 * Suspends rather than deletes. Clinical rows reference the staff member who
 * recorded them, and a hard delete would either cascade those away or null out
 * the attribution that makes the audit trail meaningful.
 */
export const deactivateUser = async (req, res) => {
  const { id } = req.params;

  let q = supabaseAdmin.from('staff_profiles').select('id, role, auth_user_id').eq('id', id);
  q = applyScope(q, req.scope);
  const { data: target } = await q.maybeSingle();

  if (!target) return res.status(404).json({ error: 'No such staff member in your region.' });
  if (target.role === 'super_admin') {
    return res.status(403).json({ error: 'The super administrator account cannot be removed through this API.' });
  }
  if (target.id === req.user.id) {
    return res.status(400).json({ error: 'You cannot deactivate your own account.' });
  }

  await supabaseAdmin.from('staff_profiles').update({ status: 'suspended' }).eq('id', id);
  // Revoke the credential too, so an existing session cannot outlive the
  // suspension by re-authenticating.
  if (target.auth_user_id) {
    await supabaseAdmin.auth.admin.updateUserById(target.auth_user_id, { ban_duration: '876000h' }).catch(() => {});
  }

  await logAuditEvent({
    actorId: req.user.id, actorRole: req.user.role,
    action: 'STAFF_ACCOUNT_SUSPENDED', entityType: 'STAFF_PROFILES',
    entityId: id, ip: req.ip
  });

  return res.json({ success: true, id, status: 'suspended' });
};

/**
 * GET /api/admin/analytics — aggregate counts only.
 *
 * Deliberately returns no patient-identifying field: an admin may see that a
 * district has 40 high-risk cases, never who they are.
 */
export const getAnalytics = async (req, res) => {
  const scopeFilter = (q) => applyScope(q, req.scope);

  const countOf = async (table, extra = (q) => q) => {
    const { count } = await extra(
      scopeFilter(supabaseAdmin.from(table).select('*', { count: 'exact', head: true }))
    );
    return count ?? 0;
  };

  const [doctors, assistants, patients, states, districts] = await Promise.all([
    countOf('staff_profiles', (q) => q.eq('role', 'doctor')),
    countOf('staff_profiles', (q) => q.eq('role', 'clinic_assistant')),
    countOf('patients'),
    supabaseAdmin.from('states').select('*', { count: 'exact', head: true }).then((r) => r.count ?? 0),
    supabaseAdmin.from('districts').select('*', { count: 'exact', head: true }).then((r) => r.count ?? 0)
  ]);

  const risk = {};
  for (const tier of ['low', 'moderate', 'high', 'emergency']) {
    risk[tier] = await countOf('visits', (q) => q.eq('risk_level', tier));
  }

  return res.json({
    scope: req.scope.kind,
    doctors, clinic_assistants: assistants, patients,
    states_total: states, districts_total: districts,
    risk_distribution: risk
  });
};

/** GET /api/admin/audit — oversight roles only; already redacted at write time. */
export const getAuditLogs = async (req, res) => {
  const { page = 0, pageSize = 100, action } = req.query;
  const from = Number(page) * Number(pageSize);

  let q = supabaseAdmin
    .from('audit_logs')
    .select('id, actor_id, actor_role, action, entity_type, entity_id, metadata, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, from + Number(pageSize) - 1);

  if (action) q = q.eq('action', action);

  const { data, error, count } = await q;
  if (error) return res.status(500).json({ error: 'Could not load audit logs.' });

  return res.json({ total: count ?? 0, logs: data || [] });
};
