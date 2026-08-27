import { Router } from 'express';
import {
  createPatient, getPatients, lookupByAadhaar, getPatientDetail, updatePatient
} from '../controllers/patient.controller.js';
import { authenticateUser, authorizeRoles } from '../middleware/auth.middleware.js';
import { denyAdminClinicalAccess } from '../middleware/clinicalAccess.middleware.js';
import { patientSearchRateLimiter } from '../middleware/rateLimit.middleware.js';
import { ROLES } from '../config/roles.js';

const router = Router();

router.use(authenticateUser);
// Admins and auditors have no clinical access. Mounted on the router so a
// route added below without its own role list still fails closed.
router.use(denyAdminClinicalAccess);

const CLINICAL = authorizeRoles(ROLES.CLINIC_ASSISTANT, ROLES.DOCTOR);

// Reads are POSTs wherever the Aadhaar number is the key: it is the patient
// identifier now, and a URL path would put it into access logs, proxy logs and
// browser history. The rate limiter matters more for the same reason — these
// are the routes an attacker would walk to probe which Aadhaars are registered.
router.post('/lookup', patientSearchRateLimiter, CLINICAL, lookupByAadhaar);
router.post('/detail', patientSearchRateLimiter, CLINICAL, getPatientDetail);

router.get('/', patientSearchRateLimiter, CLINICAL, getPatients);
router.post('/', authorizeRoles(ROLES.CLINIC_ASSISTANT), createPatient);
router.patch('/', authorizeRoles(ROLES.CLINIC_ASSISTANT), updatePatient);

export default router;
