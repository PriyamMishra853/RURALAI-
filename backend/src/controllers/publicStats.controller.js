import { supabaseAdmin } from '../config/supabase.js';

/**
 * GET /api/public/stats — the landing page's numbers, from the database.
 *
 * They were typed into the page: 75 districts, 1,880 records, 375 doctors, and
 * "Uttar Pradesh" in the hero — true once, and wrong the day Maharashtra's 36
 * districts were seeded. A public page quoting a figure the system no longer
 * has is the kind of small untruth that makes the large claims harder to
 * believe.
 *
 * Counts only, and only four of them: no names, no districts' patient counts,
 * nothing that says who uses the system. Cached for five minutes because the
 * landing page is the one route anyone on the internet can hammer.
 */

const TTL_MS = 5 * 60 * 1000;
let cached = null;
let cachedAt = 0;

const count = async (table, filter = (q) => q) => {
  const { count: n, error } = await filter(
    supabaseAdmin.from(table).select('*', { count: 'exact', head: true })
  );
  if (error) throw new Error(`${table}: ${error.message}`);
  return n || 0;
};

export const computeStats = async () => {
  const [{ data: states, error: statesError }, patients, doctors] = await Promise.all([
    supabaseAdmin.from('states').select('name, districts ( id )'),
    count('patients'),
    count('staff_profiles', (q) => q.eq('role', 'doctor').eq('status', 'active'))
  ]);
  if (statesError) throw new Error(`states: ${statesError.message}`);

  // Only states the system actually serves: a state row with no districts is
  // a reference entry, not coverage.
  const served = (states || [])
    .map((s) => ({ name: s.name, districts: (s.districts || []).length }))
    .filter((s) => s.districts > 0)
    .sort((a, b) => b.districts - a.districts);

  return {
    states: served,
    districts: served.reduce((n, s) => n + s.districts, 0),
    patients,
    doctors
  };
};

export const getPublicStats = async (req, res) => {
  const now = Date.now();
  if (cached && now - cachedAt < TTL_MS) return res.json(cached);
  try {
    cached = { ...(await computeStats()), generated_at: new Date(now).toISOString() };
    cachedAt = now;
    return res.json(cached);
  } catch (err) {
    console.error('public stats failed:', err.message);
    // A stale answer beats no answer on a public page, and beats an invented one.
    if (cached) return res.json(cached);
    return res.status(503).json({ error: 'Figures are not available right now.' });
  }
};

/** Test seam. */
export const resetPublicStatsCache = () => { cached = null; cachedAt = 0; };
