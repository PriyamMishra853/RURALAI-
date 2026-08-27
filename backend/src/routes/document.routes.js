import { Router } from 'express';
import multer from 'multer';
import { uploadDocument, verifyDocumentExtraction, listDocuments } from '../controllers/document.controller.js';
import { authenticateUser, authorizeRoles } from '../middleware/auth.middleware.js';
import { denyAdminClinicalAccess } from '../middleware/clinicalAccess.middleware.js';
import { aiRateLimiter } from '../middleware/rateLimit.middleware.js';
import { ROLES } from '../config/roles.js';

// memoryStorage buffers the whole file in heap, so the ceiling matters.
// 15 MB x 10 covers a phone photo of every page of a long lab report.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 10 }
});

const router = Router();

router.use(authenticateUser);
router.use(denyAdminClinicalAccess);

/**
 * Accept any field name and any count, so one handler serves the file-manager
 * picker (multiple) and the camera capture (one shot at a time) without the
 * client having to pick a different endpoint.
 */
const anyFiles = (req, res, next) =>
  upload.any()(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        error: err.code === 'LIMIT_FILE_SIZE'
          ? 'A file is larger than 15 MB. Photograph the page again at a lower resolution.'
          : `Upload could not be read: ${err.message}`
      });
    }
    return next();
  });

router.get('/', authorizeRoles(ROLES.CLINIC_ASSISTANT, ROLES.DOCTOR), listDocuments);

// Every upload spends money at an external model provider.
router.post('/upload', authorizeRoles(ROLES.CLINIC_ASSISTANT), aiRateLimiter, anyFiles, uploadDocument);
router.post('/:id/verify', authorizeRoles(ROLES.CLINIC_ASSISTANT, ROLES.DOCTOR), verifyDocumentExtraction);

export default router;
