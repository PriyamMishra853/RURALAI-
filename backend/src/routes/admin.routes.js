import { Router } from 'express';
import {
  getRegions, getUsers, createUser, updateUser, deactivateUser,
  getAnalytics, getAuditLogs
} from '../controllers/admin.controller.js';
import { authenticateUser, authorizeRoles, attachRegionScope } from '../middleware/auth.middleware.js';
import { ROLES } from '../config/roles.js';

const router = Router();

router.use(authenticateUser);
router.use(authorizeRoles(ROLES.SUPER_ADMIN, ROLES.STATE_ADMIN, ROLES.DISTRICT_ADMIN, ROLES.AUDITOR));
// Every handler below reads req.scope rather than trusting a region from the
// request, so an admin cannot query outside their own state or district.
router.use(attachRegionScope);

const ADMINS_ONLY = authorizeRoles(ROLES.SUPER_ADMIN, ROLES.STATE_ADMIN, ROLES.DISTRICT_ADMIN);

router.get('/regions', getRegions);

router.get('/users', getUsers);
router.post('/users', ADMINS_ONLY, createUser);
router.patch('/users/:id', ADMINS_ONLY, updateUser);
router.delete('/users/:id', ADMINS_ONLY, deactivateUser);

router.get('/analytics', getAnalytics);
// Auditors reach this one too — it is the reason that role exists.
router.get('/audit', getAuditLogs);

export default router;
