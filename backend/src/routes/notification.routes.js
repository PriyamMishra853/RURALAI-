import { Router } from 'express';
import { listNotifications, markRead } from '../services/notificationService.js';
import { authenticateUser } from '../middleware/auth.middleware.js';

/**
 * Notification inbox.
 *
 * Every query is scoped to the caller's own staff id inside the service — a
 * recipient_id can never be supplied by the client.
 */
const router = Router();
router.use(authenticateUser);

router.get('/', async (req, res) => {
  const result = await listNotifications(req.user.id, {
    unreadOnly: req.query.unread === 'true',
    limit: Math.min(Number(req.query.limit) || 50, 100)
  });
  return res.json(result);
});

router.post('/read', async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
  const ok = await markRead(req.user.id, ids);
  if (!ok) return res.status(500).json({ error: 'Could not update notifications.' });
  return res.json({ success: true });
});

export default router;
