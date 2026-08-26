import { Router } from 'express';
import {
  createPatient,
  getPatients,
  getPatientById,
  getPatientHistory
} from '../controllers/patient.controller.js';
import { authenticateUser, authorizeRoles } from '../middleware/auth.middleware.js';
import { denyAdminClinicalAccess } from '../middleware/clinicalAccess.middleware.js';
import { patientSearchRateLimiter } from '../middleware/rateLimit.middleware.js';

const router = Router();

router.use(authenticateUser);
// Admins have no clinical access — plan §C.2. Fails closed for any route
// added below, including one that forgets its own role list.
router.use(denyAdminClinicalAccess);

router.post('/', authorizeRoles('CLINIC_ASSISTANT'), createPatient);
// Lookup is the surface for probing which patients exist.
router.get('/', patientSearchRateLimiter, authorizeRoles('CLINIC_ASSISTANT', 'DOCTOR'), getPatients);
router.get('/:id', patientSearchRateLimiter, authorizeRoles('CLINIC_ASSISTANT', 'DOCTOR'), getPatientById);
router.get('/:id/history', authorizeRoles('CLINIC_ASSISTANT', 'DOCTOR'), getPatientHistory);

export default router;
