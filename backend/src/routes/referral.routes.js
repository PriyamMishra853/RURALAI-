import { Router } from 'express';
import { nearestHospital } from '../controllers/referral.controller.js';
import { authenticateUser, authorizeRoles } from '../middleware/auth.middleware.js';
import { denyAdminClinicalAccess } from '../middleware/clinicalAccess.middleware.js';
import { patientSearchRateLimiter } from '../middleware/rateLimit.middleware.js';
import { ROLES } from '../config/roles.js';

/**
 * Emergency referral routing.
 *
 * Clinical staff only, and an admin has no business here for the same reason
 * they have no business in a patient record: the request carries a live
 * position and a visit id.
 *
 * Rate limited like patient search rather than like the AI routes — this costs
 * nothing at an external provider, but it does accept coordinates and write a
 * clinical record, so it should not be an open firehose.
 */
const router = Router();

router.use(authenticateUser);
router.use(denyAdminClinicalAccess);

router.post(
  '/nearest-hospital',
  authorizeRoles(ROLES.CLINIC_ASSISTANT, ROLES.DOCTOR),
  patientSearchRateLimiter,
  nearestHospital
);

export default router;
