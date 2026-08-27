import { Router } from 'express';
import multer from 'multer';
import { analyzeImageAI } from '../controllers/ai.controller.js';
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

// Vision routes matching both /api/vision/analyze and /api/vision/analyze-image
router.post('/analyze', upload.single('image'), analyzeImageAI);
router.post('/analyze-image', upload.single('image'), analyzeImageAI);

export default router;
