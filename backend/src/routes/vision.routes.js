import { Router } from 'express';
import multer from 'multer';
import { analyzeImageAI } from '../controllers/ai.controller.js';
import { authenticateUser } from '../middleware/auth.middleware.js';

// Cap upload size: memoryStorage buffers the whole file in heap, so an
// unbounded upload is a trivial denial-of-service.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 }
});
const router = Router();

router.use(authenticateUser);

// Vision routes matching both /api/vision/analyze and /api/vision/analyze-image
router.post('/analyze', upload.single('image'), analyzeImageAI);
router.post('/analyze-image', upload.single('image'), analyzeImageAI);

export default router;
