/**
 * Role constants, mirroring backend/src/config/roles.js.
 *
 * These drive navigation and which controls render. They are a convenience,
 * never a security boundary — the API re-checks every role on every request,
 * because anything in this bundle is editable by whoever is holding the browser.
 */

export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  STATE_ADMIN: 'STATE_ADMIN',
  DISTRICT_ADMIN: 'DISTRICT_ADMIN',
  DOCTOR: 'DOCTOR',
  CLINIC_ASSISTANT: 'CLINIC_ASSISTANT',
  AUDITOR: 'AUDITOR'
};

export const ADMIN_ROLES = [ROLES.SUPER_ADMIN, ROLES.STATE_ADMIN, ROLES.DISTRICT_ADMIN];

export const HOME_ROUTE = {
  [ROLES.SUPER_ADMIN]: '/admin/dashboard',
  [ROLES.STATE_ADMIN]: '/admin/dashboard',
  [ROLES.DISTRICT_ADMIN]: '/admin/dashboard',
  [ROLES.AUDITOR]: '/admin/audit',
  [ROLES.DOCTOR]: '/doctor/queue',
  [ROLES.CLINIC_ASSISTANT]: '/assistant/dashboard'
};

export const ROLE_LABEL = {
  [ROLES.SUPER_ADMIN]: 'Super Administrator',
  [ROLES.STATE_ADMIN]: 'State Administrator',
  [ROLES.DISTRICT_ADMIN]: 'District Administrator',
  [ROLES.DOCTOR]: 'Doctor',
  [ROLES.CLINIC_ASSISTANT]: 'Clinic Assistant',
  [ROLES.AUDITOR]: 'Auditor'
};

export const homeFor = (role) => HOME_ROUTE[role] || '/';

/**
 * Translation key per role.
 *
 * ROLE_LABEL above stays as the English fallback — it is what `t()` renders
 * when a locale has not translated the role yet, and it keeps the handful of
 * non-React call sites working. Anything rendering to a user should use
 * `t(ROLE_KEY[role], ROLE_LABEL[role])` so the sidebar caption and the user
 * card are not the two English words left on an otherwise Hindi screen.
 */
export const ROLE_KEY = {
  [ROLES.SUPER_ADMIN]: 'role.superAdmin',
  [ROLES.STATE_ADMIN]: 'role.stateAdmin',
  [ROLES.DISTRICT_ADMIN]: 'role.districtAdmin',
  [ROLES.DOCTOR]: 'role.doctor',
  [ROLES.CLINIC_ASSISTANT]: 'role.assistant',
  [ROLES.AUDITOR]: 'role.auditor'
};
