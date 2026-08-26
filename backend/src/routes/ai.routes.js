import { Router } from 'express';
import multer from 'multer';
import {
  transcribeSpeech,
  analyzeDocumentAI,
  analyzePatientCase,
  getRiskAssessment,
  analyzeImageAI
} from '../controllers/ai.controller.js';
import { authenticateUser, authorizeRoles } from '../middleware/auth.middleware.js';
import { aiRateLimiter } from '../middleware/rateLimit.middleware.js';

// Cap upload size: memoryStorage buffers the whole file in heap, so an
// unbounded upload is a trivial denial-of-service.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 }
});
const router = Router();

router.use(authenticateUser);
// Every route below spends money per call at an external provider.
router.use(aiRateLimiter);

// Route aliases matching both /api/ai/assess and /api/ai/analyze-patient
router.post('/assess', authorizeRoles('CLINIC_ASSISTANT', 'DOCTOR', 'ADMIN'), analyzePatientCase);
router.post('/analyze-patient', authorizeRoles('CLINIC_ASSISTANT', 'DOCTOR', 'ADMIN'), analyzePatientCase);
router.post('/transcribe', upload.single('audio'), transcribeSpeech);
router.post('/analyze-document', upload.single('file'), analyzeDocumentAI);
router.post('/risk-assessment', getRiskAssessment);
router.post('/analyze-image', upload.single('image'), analyzeImageAI);

export default router;
