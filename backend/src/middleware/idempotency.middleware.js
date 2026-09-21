import crypto from 'crypto';
import { supabaseAdmin } from '../config/supabase.js';

/**
 * Make a write safe to repeat (Roadmap v3, Phase 6 groundwork).
 *
 * On a rural link the request arrives and the answer does not. The assistant
 * presses the button again, and the patient is registered twice. Offline
 * capture makes this worse, not better: a queue that replays writes without
 * idempotency is a duplicate generator.
 *
 * A client that sends `Idempotency-Key: <something unique>` gets:
 *   · the work done once, and the response stored,
 *   · the same response on any repeat of that key,
 *   · a 409 if the same key arrives with a different body — that is a client
 *     bug, and answering it with someone else's result would be worse.
 *
 * Without the header nothing changes, so every existing caller is unaffected.
 *
 * Failures here never fail the write. If the store is unreachable the request
 * proceeds exactly as it did before this middleware existed: losing the
 * duplicate protection is bad, losing the registration is worse.
 */

const MAX_KEY = 128;

const hashBody = (body) => crypto.createHash('sha256')
  .update(JSON.stringify(body ?? {}))
  .digest('hex');

export const idempotent = (routeName) => async (req, res, next) => {
  const key = String(req.get('Idempotency-Key') || '').trim();
  if (!key) return next();
  if (key.length > MAX_KEY) {
    return res.status(400).json({ error: `An Idempotency-Key may be at most ${MAX_KEY} characters.` });
  }
  if (!req.user?.id) return next();

  const requestHash = hashBody(req.body);

  const { data: stored, error: readError } = await supabaseAdmin
    .from('request_idempotency')
    .select('request_hash, status_code, response, route')
    .eq('staff_id', req.user.id)
    .eq('idempotency_key', key)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (readError) {
    console.warn('idempotency lookup failed, continuing without it:', readError.message);
    return next();
  }

  if (stored) {
    if (stored.request_hash !== requestHash || stored.route !== routeName) {
      return res.status(409).json({
        error: 'That idempotency key was already used for a different request. Use a new key.'
      });
    }
    res.set('Idempotency-Replayed', 'true');
    return res.status(stored.status_code).json(stored.response);
  }

  // Capture the answer on its way out, and store it only if the work succeeded.
  // A failed write must be retryable: storing a 500 would make the retry
  // return the same 500 forever.
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    const statusCode = res.statusCode || 200;
    if (statusCode >= 200 && statusCode < 300) {
      supabaseAdmin
        .from('request_idempotency')
        .insert([{
          staff_id: req.user.id,
          idempotency_key: key,
          route: routeName,
          request_hash: requestHash,
          status_code: statusCode,
          response: body ?? {}
        }])
        .then(({ error }) => {
          // 23505: two copies of the same request raced. The other one stored
          // the answer, which is the same answer. Nothing to do.
          if (error && error.code !== '23505') {
            console.warn('idempotency record not stored:', error.message);
          }
        });
    }
    return originalJson(body);
  };

  return next();
};

/** Old keys are rubbish, not history. Called from the boot-time sweeper. */
export const purgeExpiredIdempotencyKeys = async () => {
  const { error } = await supabaseAdmin
    .from('request_idempotency')
    .delete()
    .lt('expires_at', new Date().toISOString());
  if (error) console.warn('idempotency purge failed:', error.message);
};
