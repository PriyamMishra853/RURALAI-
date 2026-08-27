import { Router } from 'express';
import {
  getDoctorQueue, getQueueDates, getDoctorCaseDetails, recordDoctorReview, listDoctors
} from '../controllers/doctor.controller.js';
import { authenticateUser, authorizeRoles } from '../middleware/auth.middleware.js';
import { denyAdminClinicalAccess } from '../middleware/clinicalAccess.middleware.js';
import { ROLES } from '../config/roles.js';

const router = Router();

router.use(authenticateUser);
router.use(denyAdminClinicalAccess);

const DOCTOR_ONLY = authorizeRoles(ROLES.DOCTOR);

// Roster, not clinical data — an assistant needs it to pick a doctor.
router.get('/directory', authorizeRoles(ROLES.CLINIC_ASSISTANT, ROLES.DOCTOR), listDoctors);

router.get('/queue', DOCTOR_ONLY, getDoctorQueue);
router.get('/queue/dates', DOCTOR_ONLY, getQueueDates);
router.get('/cases/:id', DOCTOR_ONLY, getDoctorCaseDetails);
router.post('/cases/:id/review', DOCTOR_ONLY, recordDoctorReview);

export default router;
