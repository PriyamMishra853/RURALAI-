import { Router } from 'express';
import {
  getDoctorQueue,
  getDoctorCaseDetails,
  recordDoctorReview,
  referPatientToHospital,
  listDoctors
} from '../controllers/doctor.controller.js';
import { authenticateUser, authorizeRoles } from '../middleware/auth.middleware.js';

const router = Router();

router.use(authenticateUser);

router.get('/directory', authorizeRoles('CLINIC_ASSISTANT', 'DOCTOR', 'ADMIN'), listDoctors);
router.get('/queue', authorizeRoles('DOCTOR'), getDoctorQueue);
// The staff directory is a roster, not clinical data, so admins keep it.
router.get('/cases/:id', authorizeRoles('DOCTOR'), getDoctorCaseDetails);
router.post('/cases/:id/review', authorizeRoles('DOCTOR'), recordDoctorReview);
router.post('/cases/:id/refer', authorizeRoles('DOCTOR'), referPatientToHospital);

export default router;
