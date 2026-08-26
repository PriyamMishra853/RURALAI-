import rateLimit from 'express-rate-limit';

/**
 * Rate limiters for the endpoints worth attacking.
 *
 * KNOWN GAP: the store is in-memory, so limits are counted per process. Behind
 * the load balancer required by §3.1 an attacker gets the limit multiplied by
 * the instance count. A shared Redis store closes this and is listed in
 * docs/PHASE1_PRODUCTION_READINESS_PLAN.md §A.4 — it needs a Redis URL, which
 * is on the outstanding credentials list.
 */

const limitResponse = (message) => (req, res) =>
  res.status(429).json({ error: message });

/**
 * Login is the credential-guessing surface. Staff accounts are provisioned by
 * an admin and are few, so a legitimate user never comes close to this.
 */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: limitResponse('Too many sign-in attempts. Wait 15 minutes and try again.')
});

/**
 * Patient lookup is the surface for probing the identifier space to discover
 * which patients exist. Slower than login on purpose: an assistant searches a
 * handful of times per consultation, never hundreds.
 */
export const patientSearchRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitResponse('Too many patient lookups. Slow down and try again shortly.')
});

/**
 * AI assessment and OCR calls cost real money per request, so an unbounded
 * caller is a billing incident as well as a load problem.
 */
export const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitResponse('Too many AI requests in a short period. Wait a moment and retry.')
});

/** Baseline ceiling for everything else. Generous — it only catches runaways. */
export const globalRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitResponse('Too many requests. Please slow down.')
});
