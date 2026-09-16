import { Router } from 'express';
import { authenticateUser, authorizeRoles } from '../middleware/auth.middleware.js';
import { denyAdminClinicalAccess } from '../middleware/clinicalAccess.middleware.js';
import { requireFeature, FEATURES } from '../config/features.js';
import { ROLES } from '../config/roles.js';
import {
  createReferral, listReferrals, actOnReferral, rotateAckLink
} from '../controllers/hospitalReferral.controller.js';

/**
 * Closed-loop hospital referral, staff side (Roadmap v3, Phase 1).
 *
 * The flag is checked first, before authentication, so with referral_tracking
 * off these routes are indistinguishable from routes that were never written.
 */
const router = Router();

router.use(requireFeature(FEATURES.REFERRAL_TRACKING));
router.use(authenticateUser);
router.use(denyAdminClinicalAccess);

const CLINICAL = authorizeRoles(ROLES.CLINIC_ASSISTANT, ROLES.DOCTOR);

router.get('/', CLINICAL, listReferrals);
router.post('/', authorizeRoles(ROLES.CLINIC_ASSISTANT), createReferral);
// Before /:id/:action, or "ack-link" would be read as an action name.
router.post('/:id/ack-link', CLINICAL, rotateAckLink);
router.post('/:id/:action', CLINICAL, actOnReferral);

export default router;
