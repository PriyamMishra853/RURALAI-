import { Router } from 'express';
import {
  createVisit, getVisitById, updateVisit, handOffVisit, getVisitReview, deleteVisit
} from '../controllers/visit.controller.js';
import { authenticateUser, authorizeRoles } from '../middleware/auth.middleware.js';
import { denyAdminClinicalAccess } from '../middleware/clinicalAccess.middleware.js';
import { ROLES } from '../config/roles.js';

const router = Router();

router.use(authenticateUser);
router.use(denyAdminClinicalAccess);

router.post('/', authorizeRoles(ROLES.CLINIC_ASSISTANT), createVisit);
router.get('/:id', authorizeRoles(ROLES.CLINIC_ASSISTANT, ROLES.DOCTOR), getVisitById);
// The doctor's decision, read by the assistant who opened the visit.
router.get('/:id/review', authorizeRoles(ROLES.CLINIC_ASSISTANT, ROLES.DOCTOR), getVisitReview);
router.patch('/:id', authorizeRoles(ROLES.CLINIC_ASSISTANT, ROLES.DOCTOR), updateVisit);

// Handing a case to a doctor is the assistant's action alone. A doctor
// reassigning their own cases is a different decision with different rules,
// and is not this endpoint.
router.post('/:id/handoff', authorizeRoles(ROLES.CLINIC_ASSISTANT), handOffVisit);

// Withdrawing an accidental entry is the assistant's own correction, and only
// while the case is still theirs — the controller refuses once a doctor is
// involved. A doctor closing a case they have seen is a different action.
router.delete('/:id', authorizeRoles(ROLES.CLINIC_ASSISTANT), deleteVisit);

export default router;
