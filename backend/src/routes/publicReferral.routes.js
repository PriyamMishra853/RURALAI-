import { Router } from 'express';
import { requireFeature, FEATURES } from '../config/features.js';
import { publicReferralRateLimiter } from '../middleware/rateLimit.middleware.js';
import { getPublicReferral, actOnPublicReferral } from '../controllers/hospitalReferral.controller.js';

/**
 * The hospital acknowledgement link (Roadmap v3, Phase 1).
 *
 * No authentication by design: the receiving hospital has no account here, and
 * requiring one would mean the loop never closes. What stands in for a login is
 * a 192-bit token that is scoped to one referral, stored only as a hash,
 * expires, and can only confirm arrival or record an outcome once.
 */
const router = Router();

router.use(requireFeature(FEATURES.REFERRAL_TRACKING));
router.use(publicReferralRateLimiter);

router.get('/:token', getPublicReferral);
router.post('/:token/:action', actOnPublicReferral);

export default router;
