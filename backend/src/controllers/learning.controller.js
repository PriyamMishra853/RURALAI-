import { supabaseAdmin } from '../config/supabase.js';
import { logAuditEvent } from '../middleware/audit.middleware.js';
import { buildCandidate, promoteVersion, learningStatus } from '../services/learningService.js';

/**
 * The model's learning, for the people accountable for it (Roadmap v3, F3).
 *
 * Everything here is de-identified — a learning example is a complaint, a
 * diagnosis, an age band and a gender — so administrators may see it, which
 * they may not do with a case.
 */

/** GET /api/learning/status */
export const getLearningStatus = async (req, res) => {
  try {
    return res.json(await learningStatus());
  } catch (err) {
    console.error('learning status failed:', err.message);
    return res.status(500).json({ error: 'Learning status could not be read.' });
  }
};

/** GET /api/learning/examples?status=approved|rejected|pending&outcome= */
export const listExamples = async (req, res) => {
  let query = supabaseAdmin
    .from('learning_examples')
    .select('id, symptoms_text, diagnosis_text, age_band, gender, status, last_outcome, mapped_label, created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (['approved', 'rejected', 'pending'].includes(req.query.status)) query = query.eq('status', req.query.status);
  if (req.query.outcome) query = query.eq('last_outcome', String(req.query.outcome));
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: 'Examples could not be read.' });
  return res.json({ examples: data || [] });
};

/** POST /api/learning/candidate — retrain now, rather than waiting for the next visit. */
export const retrainNow = async (req, res) => {
  const result = await buildCandidate({ actor: { id: req.user.id, role: req.user.role } });
  if (result.error) return res.status(503).json({ error: result.error });
  return res.status(201).json(result);
};

/** POST /api/learning/versions/:version/promote */
export const promote = async (req, res) => {
  const version = Number.parseInt(req.params.version, 10);
  if (!Number.isInteger(version) || version < 1) return res.status(400).json({ error: 'Name a model version.' });
  const result = await promoteVersion({ version, actor: { id: req.user.id, role: req.user.role } });
  if (result.error) return res.status(result.status || 500).json({ error: result.error });
  return res.json(result);
};

/**
 * POST /api/learning/examples/:id/reject — a wrong label out of the training
 * set. It stops teaching the next candidate; the live model changes only when
 * that candidate is promoted.
 */
export const rejectExample = async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('learning_examples')
    .update({ status: 'rejected', reviewed_by: req.user.id, reviewed_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .neq('status', 'rejected')
    .select('id, status')
    .maybeSingle();
  if (error) return res.status(500).json({ error: 'The example could not be updated.' });
  if (!data) return res.status(404).json({ error: 'No such example, or it is already rejected.' });

  await logAuditEvent({
    actorId: req.user.id, actorRole: req.user.role, action: 'LEARNING_EXAMPLE_REJECTED',
    entityType: 'MODEL', entityId: data.id, metadata: {}, ip: req.ip
  });
  return res.json({ example: data });
};
