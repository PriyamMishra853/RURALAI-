import { Router } from 'express';
import {
  createPatient,
  getPatients,
  getPatientById,
  getPatientHistory
} from '../controllers/patient.controller.js';
import { authenticateUser, authorizeRoles } from '../middleware/auth.middleware.js';
import { patientSearchRateLimiter } from '../middleware/rateLimit.middleware.js';

const router = Router();

router.use(authenticateUser);

router.post('/', authorizeRoles('CLINIC_ASSISTANT', 'ADMIN'), createPatient);
// Lookup is the surface for probing which patients exist.
router.get('/', patientSearchRateLimiter, authorizeRoles('CLINIC_ASSISTANT', 'DOCTOR', 'ADMIN'), getPatients);
router.get('/:id', patientSearchRateLimiter, authorizeRoles('CLINIC_ASSISTANT', 'DOCTOR', 'ADMIN'), getPatientById);
router.get('/:id/history', authorizeRoles('CLINIC_ASSISTANT', 'DOCTOR', 'ADMIN'), getPatientHistory);

export default router;
