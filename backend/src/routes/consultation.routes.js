import { Router } from 'express';
import {
  getDateStrip, getSlots, getDoctorsAt,
  createConsultation, createInstantConsultation,
  joinConsultation, endConsultation, cancelConsultation,
  getConsultations, getConsultation
} from '../controllers/consultation.controller.js';
import { authenticateUser, authorizeRoles } from '../middleware/auth.middleware.js';
import { denyAdminClinicalAccess } from '../middleware/clinicalAccess.middleware.js';
import { ROLES } from '../config/roles.js';

const router = Router();

// §7 — every endpoint is authenticated and role-checked server-side. Nothing
// here is inferred from which UI route the caller came from.
router.use(authenticateUser);
router.use(denyAdminClinicalAccess);

const CLINICAL = authorizeRoles(ROLES.CLINIC_ASSISTANT, ROLES.DOCTOR);
const ASSISTANT = authorizeRoles(ROLES.CLINIC_ASSISTANT);

// --- Scheduling surface (§2) ---
router.get('/availability/dates', CLINICAL, getDateStrip);
router.get('/availability/slots', CLINICAL, getSlots);
router.get('/availability/doctors', CLINICAL, getDoctorsAt);

// --- Booking (§2.4, §2.6) ---
router.post('/', ASSISTANT, createConsultation);
router.post('/instant', ASSISTANT, createInstantConsultation);

// --- Listing (§6.1). Static paths are declared before /:id so that
//     "availability" is never parsed as a consultation id. ---
router.get('/', CLINICAL, getConsultations);
router.get('/:id', CLINICAL, getConsultation);

// --- State transitions (§3.6, §3.7) ---
router.post('/:id/join', CLINICAL, joinConsultation);
router.post('/:id/end', CLINICAL, endConsultation);
router.post('/:id/cancel', CLINICAL, cancelConsultation);

export default router;
