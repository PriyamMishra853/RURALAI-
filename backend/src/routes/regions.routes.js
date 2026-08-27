import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authenticateUser } from '../middleware/auth.middleware.js';

/**
 * Reference data for the registration form's dropdowns.
 *
 * Readable by any active staff member — it is a list of Indian states and
 * district names, not patient data, and the registration form cannot be filled
 * in without it. Authentication is still required so it is not an open
 * endpoint on the internet.
 */
const router = Router();

router.use(authenticateUser);

/** GET /api/regions/states — all 36 states and union territories. */
router.get('/states', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('states')
    .select('id, name, code, region_type')
    .order('region_type')
    .order('name');

  if (error) return res.status(500).json({ error: 'Could not load states.' });
  return res.json({ states: data || [] });
});

/**
 * GET /api/regions/districts?stateId=...
 *
 * District masters are seeded for Uttar Pradesh only, so this returns an empty
 * list for other states. That is expected: the form offers these as
 * suggestions and accepts free text, because a patient may give an address
 * anywhere in India.
 */
router.get('/districts', async (req, res) => {
  const { stateId } = req.query;
  if (!stateId) return res.status(400).json({ error: 'stateId is required.' });

  const { data, error } = await supabaseAdmin
    .from('districts')
    .select('id, name')
    .eq('state_id', stateId)
    .order('name');

  if (error) return res.status(500).json({ error: 'Could not load districts.' });
  return res.json({ districts: data || [] });
});

export default router;
