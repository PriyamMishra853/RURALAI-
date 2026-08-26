import { Router } from 'express';
import { login, logout, getMe } from '../controllers/auth.controller.js';
import { authenticateUser } from '../middleware/auth.middleware.js';
import { loginRateLimiter } from '../middleware/rateLimit.middleware.js';

const router = Router();

// There is deliberately no POST /register.
//
// Doctors and Clinical Assistants are government-assigned roles: only an Admin
// creates these accounts, via POST /api/admin/users. The route that used to
// live here accepted an unauthenticated `role` field, so anyone who could
// reach the API could issue themselves an ADMIN account.
// See docs/PHASE1_PRODUCTION_READINESS_PLAN.md §C.3.

router.post('/login', loginRateLimiter, login);
router.post('/logout', authenticateUser, logout);
router.get('/me', authenticateUser, getMe);

export default router;
