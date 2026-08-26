import express from 'express';
import { getDoctorAvailability, scheduleCall, listCalls, updateCallStatus } from '../controllers/call.controller.js';
import { issueVideoToken } from '../controllers/videoToken.controller.js';
import { authenticateUser, authorizeRoles } from '../middleware/auth.middleware.js';

const router = express.Router();

// NOTE: the routes below this line are still unauthenticated. That predates
// this change and is tracked separately — see docs/PHASE2_PROGRESS.md.
// The token route is guarded because minting a video credential without
// knowing who is asking is not something to ship even briefly.
router.post(
  '/video-token',
  authenticateUser,
  authorizeRoles('CLINIC_ASSISTANT', 'DOCTOR'),
  issueVideoToken
);

router.get('/availability', getDoctorAvailability);
router.post('/schedule', scheduleCall);
router.get('/', listCalls);
router.patch('/:id/status', updateCallStatus);
router.post('/:id/status', updateCallStatus);

export default router;
