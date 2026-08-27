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
