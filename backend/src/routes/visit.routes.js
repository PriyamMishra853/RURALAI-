import { Router } from 'express';
import { createVisit, getVisitById, updateVisit } from '../controllers/visit.controller.js';
import { authenticateUser, authorizeRoles } from '../middleware/auth.middleware.js';
import { denyAdminClinicalAccess } from '../middleware/clinicalAccess.middleware.js';

const router = Router();

router.use(authenticateUser);
// Admins have no clinical access — plan §C.2. Fails closed for any route
// added below, including one that forgets its own role list.
router.use(denyAdminClinicalAccess);

router.post('/', authorizeRoles('CLINIC_ASSISTANT'), createVisit);
router.get('/:id', authorizeRoles('CLINIC_ASSISTANT', 'DOCTOR'), getVisitById);
router.patch('/:id', authorizeRoles('CLINIC_ASSISTANT', 'DOCTOR'), updateVisit);

export default router;
