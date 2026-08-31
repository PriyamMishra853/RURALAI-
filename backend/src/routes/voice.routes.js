import { Router } from 'express';
import multer from 'multer';
import { transcribeSpeech , translateSpeechText } from '../controllers/ai.controller.js';
import { authenticateUser, authorizeRoles } from '../middleware/auth.middleware.js';
import { denyAdminClinicalAccess } from '../middleware/clinicalAccess.middleware.js';
import { aiRateLimiter } from '../middleware/rateLimit.middleware.js';
import { ROLES } from '../config/roles.js';

// Cap upload size: memoryStorage buffers the whole file in heap, so an
// unbounded upload is a trivial denial-of-service.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 }
});
const router = Router();

router.use(authenticateUser);
// These paths reach the same controllers as /api/ai. Without these three the
// alias is a way around the AI rate limiter and the admin block.
router.use(denyAdminClinicalAccess);
router.use(authorizeRoles(ROLES.CLINIC_ASSISTANT, ROLES.DOCTOR));
router.use(aiRateLimiter);

// Voice routes matching /api/voice/transcribe
router.post('/transcribe', upload.single('audio'), transcribeSpeech);

// Read-aloud translation. Same rate limiter as the rest of this router: it is
// a model call and costs money per request.
router.post('/translate', translateSpeechText);

export default router;
