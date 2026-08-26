/**
 * Structural block on administrative access to clinical data.
 *
 * Plan §C.2: no admin role may read or write patient clinical data. Managing
 * staff in a region does not require seeing a named patient's record, and this
 * is the strongest compliance claim the platform has — it costs nothing to
 * hold and it is the first thing a health department will ask about.
 *
 * This exists in addition to the per-route role lists, not instead of them. A
 * route added later that forgets its `authorizeRoles` call still fails closed
 * here, because the whole clinical router is mounted behind it. Defence in
 * depth is the point: one forgotten guard should not become a breach.
 *
 * This is an application-layer control. It is NOT a substitute for row-level
 * security in the database, which is still outstanding — see
 * docs/PHASE2_PROGRESS.md.
 */

const ADMIN_ROLES = new Set(['ADMIN', 'SUPER_ADMIN', 'STATE_ADMIN', 'DISTRICT_ADMIN']);

export const denyAdminClinicalAccess = (req, res, next) => {
  if (req.user && ADMIN_ROLES.has(req.user.role)) {
    return res.status(403).json({
      error:
        'Administrator accounts cannot access patient clinical records. This restriction is deliberate and cannot be granted per-account.'
    });
  }
  return next();
};
