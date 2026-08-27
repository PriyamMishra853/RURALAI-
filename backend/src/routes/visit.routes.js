import { Router } from 'express';
import { createVisit, getVisitById, updateVisit } from '../controllers/visit.controller.js';
import { authenticateUser, authorizeRoles } from '../middleware/auth.middleware.js';
import { denyAdminClinicalAccess } from '../middleware/clinicalAccess.middleware.js';
import { ROLES } from '../config/roles.js';

const router = Router();

router.use(authenticateUser);
router.use(denyAdminClinicalAccess);

router.post('/', authorizeRoles(ROLES.CLINIC_ASSISTANT), createVisit);
router.get('/:id', authorizeRoles(ROLES.CLINIC_ASSISTANT, ROLES.DOCTOR), getVisitById);
router.patch('/:id', authorizeRoles(ROLES.CLINIC_ASSISTANT, ROLES.DOCTOR), updateVisit);

export default router;
