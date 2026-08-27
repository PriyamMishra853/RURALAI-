/**
 * The role model, in one place.
 *
 * Baseline from spec §3.8 was Admin / Doctor / Clinical Assistant. Three roles
 * were added because the spec's own requirements imply them:
 *
 *   SUPER_ADMIN    "logs in via a secret email/password known only to the
 *                  developer" — that is a different account class from the
 *                  regional administrators who manage rosters day to day, and
 *                  collapsing them means the day-to-day account also holds
 *                  nationwide delete rights.
 *
 *   STATE_ADMIN /  "can add/update/delete and view doctors and Clinical
 *   DISTRICT_ADMIN Assistants on a region basis ... state-wise, then
 *                  district-wise". A region basis is only enforceable if the
 *                  admin's own scope is a column, not a UI filter.
 *
 *   AUDITOR        Not in the baseline. Added because compliance review
 *                  otherwise requires handing someone an admin account, and
 *                  an admin account can mutate the roster. An auditor reads
 *                  audit logs and aggregate counts and can change nothing.
 */

export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  STATE_ADMIN: 'STATE_ADMIN',
  DISTRICT_ADMIN: 'DISTRICT_ADMIN',
  DOCTOR: 'DOCTOR',
  CLINIC_ASSISTANT: 'CLINIC_ASSISTANT',
  AUDITOR: 'AUDITOR'
};

/** Database enum value -> API role name. */
export const ROLE_DB_TO_API = {
  super_admin: ROLES.SUPER_ADMIN,
  state_admin: ROLES.STATE_ADMIN,
  district_admin: ROLES.DISTRICT_ADMIN,
  doctor: ROLES.DOCTOR,
  clinic_assistant: ROLES.CLINIC_ASSISTANT,
  auditor: ROLES.AUDITOR
};

/** API role name -> database enum value. */
export const ROLE_API_TO_DB = Object.fromEntries(
  Object.entries(ROLE_DB_TO_API).map(([db, api]) => [api, db])
);

/** Roles that administer the staff roster. None of them may touch clinical data. */
export const ADMIN_ROLES = new Set([
  ROLES.SUPER_ADMIN,
  ROLES.STATE_ADMIN,
  ROLES.DISTRICT_ADMIN
]);

/** Roles that see patient clinical records at all. */
export const CLINICAL_ROLES = new Set([
  ROLES.DOCTOR,
  ROLES.CLINIC_ASSISTANT
]);

/**
 * Which roles each admin tier may create. A district admin cannot mint peers
 * or superiors, so a single compromised district account cannot widen itself.
 * super_admin is absent from every list: it is provisioned only by
 * `npm run seed:root`, never through the API.
 */
export const CREATABLE_ROLES = {
  [ROLES.SUPER_ADMIN]:    [ROLES.STATE_ADMIN, ROLES.DISTRICT_ADMIN, ROLES.DOCTOR, ROLES.CLINIC_ASSISTANT, ROLES.AUDITOR],
  [ROLES.STATE_ADMIN]:    [ROLES.DISTRICT_ADMIN, ROLES.DOCTOR, ROLES.CLINIC_ASSISTANT, ROLES.AUDITOR],
  [ROLES.DISTRICT_ADMIN]: [ROLES.DOCTOR, ROLES.CLINIC_ASSISTANT],
  [ROLES.DOCTOR]:         [],
  [ROLES.CLINIC_ASSISTANT]: [],
  [ROLES.AUDITOR]:        []
};

/** Where each role lands after sign-in. */
export const HOME_ROUTE = {
  [ROLES.SUPER_ADMIN]:      '/admin/dashboard',
  [ROLES.STATE_ADMIN]:      '/admin/dashboard',
  [ROLES.DISTRICT_ADMIN]:   '/admin/dashboard',
  [ROLES.AUDITOR]:          '/admin/audit',
  [ROLES.DOCTOR]:           '/doctor/queue',
  [ROLES.CLINIC_ASSISTANT]: '/assistant/dashboard'
};

export const isAdmin    = (role) => ADMIN_ROLES.has(role);
export const isClinical = (role) => CLINICAL_ROLES.has(role);
