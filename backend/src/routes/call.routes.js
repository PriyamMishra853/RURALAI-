import express from 'express';
import { getDoctorAvailability, scheduleCall, listCalls, updateCallStatus } from '../controllers/call.controller.js';

const router = express.Router();

router.get('/availability', getDoctorAvailability);
router.post('/schedule', scheduleCall);
router.get('/', listCalls);
router.patch('/:id/status', updateCallStatus);
router.post('/:id/status', updateCallStatus);

export default router;
