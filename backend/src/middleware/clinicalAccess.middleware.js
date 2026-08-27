import { ADMIN_ROLES, ROLES } from '../config/roles.js';

/**
 * Structural block on administrative access to clinical data.
 *
 * Spec §3.8: "Admin cannot edit patient data." Managing a roster in a region
 * does not require reading a named patient's record, so no admin role — and
 * no auditor — reaches these routers at all.
 *
 * This sits in addition to each route's own role list, not instead of it. A
 * route added later that forgets `authorizeRoles` still fails closed, because
 * the whole clinical router is mounted behind this.
 *
 * The same rule is expressed again as RLS policy in database/v2/03_rls.sql:
 * no admin role appears in any policy on patients, visits or their children.
 * Either layer failing alone is not a breach.
 */

const BLOCKED = new Set([...ADMIN_ROLES, ROLES.AUDITOR]);

export const denyAdminClinicalAccess = (req, res, next) => {
  if (req.user && BLOCKED.has(req.user.role)) {
    return res.status(403).json({
      error:
        'Administrator and auditor accounts cannot access patient clinical records. ' +
        'This restriction is deliberate and cannot be granted per account.'
    });
  }
  return next();
};

/**
 * Confine a clinician to their own district.
 *
 * v1's patient list had no tenancy filter at all, so one assistant could
 * enumerate every patient in the country. Controllers call this to get the
 * district they are allowed to read, and must not take it from the request.
 */
export const callerDistrict = (req) => req.user?.districtId ?? null;
