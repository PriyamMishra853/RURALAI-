import { Router } from 'express';
import { authenticateUser, authorizeRoles } from '../middleware/auth.middleware.js';
import { requireFeature, FEATURES } from '../config/features.js';
import { ROLES } from '../config/roles.js';
import {
  getLearningStatus, listExamples, retrainNow, promote, rejectExample
} from '../controllers/learning.controller.js';

/**
 * The model's learning (Roadmap v3, F3). Retraining and reading are for
 * administrators and doctors; making a model live is for the super admin, who
 * answers for what the platform runs.
 */
const router = Router();

router.use(requireFeature(FEATURES.MODEL_LEARNING));
router.use(authenticateUser);

const OVERSIGHT = authorizeRoles(ROLES.SUPER_ADMIN, ROLES.STATE_ADMIN, ROLES.DISTRICT_ADMIN, ROLES.AUDITOR, ROLES.DOCTOR);

router.get('/status', OVERSIGHT, getLearningStatus);
router.get('/examples', OVERSIGHT, listExamples);
router.post('/candidate', authorizeRoles(ROLES.SUPER_ADMIN, ROLES.STATE_ADMIN), retrainNow);
router.post('/versions/:version/promote', authorizeRoles(ROLES.SUPER_ADMIN), promote);
router.post('/examples/:id/reject', authorizeRoles(ROLES.SUPER_ADMIN, ROLES.DOCTOR), rejectExample);

export default router;
