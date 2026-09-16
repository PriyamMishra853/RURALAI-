import { Router } from 'express';
import { authenticateUser, authorizeRoles } from '../middleware/auth.middleware.js';
import { denyAdminClinicalAccess } from '../middleware/clinicalAccess.middleware.js';
import { requireFeature, FEATURES } from '../config/features.js';
import { ROLES } from '../config/roles.js';
import { listFollowUps, actOnFollowUp } from '../controllers/followUp.controller.js';

/**
 * Follow-up recall (Roadmap v3, Phase 4). The flag is checked before
 * authentication, so a deployment without the feature answers 404 to everyone.
 */
const router = Router();

router.use(requireFeature(FEATURES.FOLLOW_UP_TRACKING));
router.use(authenticateUser);
router.use(denyAdminClinicalAccess);

const CLINICAL = authorizeRoles(ROLES.CLINIC_ASSISTANT, ROLES.DOCTOR);

router.get('/', CLINICAL, listFollowUps);
router.post('/:id/:action', CLINICAL, actOnFollowUp);

export default router;
