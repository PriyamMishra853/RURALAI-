import { Router } from 'express';
import {
  getDoctorQueue, getQueueDates, getDoctorCaseDetails, recordDoctorReview, listDoctors
} from '../controllers/doctor.controller.js';
import { authenticateUser, authorizeRoles } from '../middleware/auth.middleware.js';
import { denyAdminClinicalAccess } from '../middleware/clinicalAccess.middleware.js';
import { ROLES } from '../config/roles.js';
import { createCaseReferral, listCaseReferrals, actOnCaseReferral } from '../controllers/caseReferral.controller.js';
import { requireFeature, FEATURES } from '../config/features.js';

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

// Doctor-to-doctor referral (Roadmap v3, Phase 1). Behind a flag: with
// doctor_referral off, these answer 404 exactly as a build without them would.
const REFERRALS = requireFeature(FEATURES.DOCTOR_REFERRAL);
router.get('/referrals', DOCTOR_ONLY, REFERRALS, listCaseReferrals);
router.post('/cases/:id/referrals', DOCTOR_ONLY, REFERRALS, createCaseReferral);
router.post('/referrals/:id/:action', DOCTOR_ONLY, REFERRALS, actOnCaseReferral);

export default router;
