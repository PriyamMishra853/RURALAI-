import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

/**
 * Rate limiters for the endpoints worth attacking.
 *
 * KNOWN GAP: the store is in-memory, so limits are counted per process. Behind
 * the load balancer required by §3.1 an attacker gets the limit multiplied by
 * the instance count. A shared Redis store closes this and is listed in
 * docs/PHASE1_PRODUCTION_READINESS_PLAN.md §A.4 — it needs a Redis URL, which
 * is on the outstanding credentials list.
 *
 * ── Who a limit applies to matters more than the number ────────────────────
 *
 * A clinic sits behind one public IP: every assistant, every doctor and every
 * tablet in the building shares it. Keyed by address, "20 AI requests a
 * minute" is 20 for the entire centre — the third assistant to scan a
 * prescription in the same minute gets a refusal that reads to them as a bug,
 * and the busier the clinic the worse it behaves. That is the opposite of what
 * a limiter is for: it should stop one runaway caller, not the afternoon rush.
 *
 * So every limiter mounted after `authenticateUser` is keyed by the signed-in
 * user. Each member of staff gets their own budget, and one person looping a
 * broken page cannot take the AI away from everyone else.
 *
 * Two limiters cannot do that, because they run before anyone is identified:
 *   · the global ceiling, mounted on `/api` in app.js
 *   · login, where the caller is by definition not signed in yet
 * Those stay address-keyed, and their numbers are chosen knowing that a whole
 * building shares one key.
 */

const num = (raw, fallback) => {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * IPv6 addresses are handed out a machine at a time, so a raw address is not a
 * caller — `ipKeyGenerator` collapses one to its subnet. Never key on req.ip
 * directly.
 */
const ipKey = (req) => ipKeyGenerator(req.ip || req.socket?.remoteAddress || 'unknown');

/**
 * The signed-in user where we know who is calling, the address before that.
 * The prefix keeps keys readable when debugging a limit somebody hit.
 */
export const userOrIpKey = (prefix) => (req) =>
  (req.user?.id ? `${prefix}:u:${req.user.id}` : `${prefix}:ip:${ipKey(req)}`);

/**
 * Login has no user yet, so it is keyed by address AND the account being
 * tried. Keyed by address alone, ten fat-fingered passwords across a centre
 * would lock out everybody else standing in the same building — including the
 * doctor who has not typed anything wrong.
 *
 * Normalised exactly as auth.controller.js normalises it, so the limiter and
 * the login agree on what one account is.
 */
export const loginKey = (req) => {
  const email = String(req.body?.email || '').toLowerCase().trim().slice(0, 160);
  return `login:${ipKey(req)}:${email}`;
};

const limitResponse = (message) => (req, res) =>
  res.status(429).json({ error: message });

/**
 * Login is the credential-guessing surface. Staff accounts are provisioned by
 * an admin and are few, so a legitimate user never comes close to this —
 * and `skipSuccessfulRequests` means only failures count.
 */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: num(process.env.RATE_LIMIT_LOGIN_FAILURES, 10),
  keyGenerator: loginKey,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: limitResponse('Too many sign-in attempts. Wait 15 minutes and try again.')
});

/**
 * Patient lookup is the surface for probing the identifier space to discover
 * which patients exist. Per assistant: one searches a handful of times per
 * consultation, never hundreds.
 */
export const patientSearchRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: num(process.env.RATE_LIMIT_PATIENT_SEARCH, 60),
  keyGenerator: userOrIpKey('search'),
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitResponse('Too many patient lookups. Slow down and try again shortly.')
});

/**
 * AI assessment and OCR calls cost real money per request, so an unbounded
 * caller is a billing incident as well as a load problem. Per member of staff:
 * a busy clinic is many people working normally, not one caller running away.
 */
export const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: num(process.env.RATE_LIMIT_AI_PER_MIN, 20),
  keyGenerator: userOrIpKey('ai'),
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitResponse('Too many AI requests in a short period. Wait a moment and retry.')
});

/**
 * Baseline ceiling for everything else — a runaway guard, not a quota.
 *
 * Address-keyed, because it is mounted before anyone is identified, so this
 * number is the budget for a whole building: a centre with twenty staff, each
 * loading a page that makes a handful of calls, must fit inside it with room
 * to spare. The old 300 was a per-person number doing a per-building job.
 */
export const globalRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: num(process.env.RATE_LIMIT_GLOBAL_PER_MIN, 1200),
  keyGenerator: (req) => `global:ip:${ipKey(req)}`,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitResponse('Too many requests. Please slow down.')
});

/**
 * The hospital acknowledgement link — the one clinical write reachable without
 * signing in. Tokens are 192 random bits, so this is not what makes guessing
 * infeasible; it is what makes trying expensive and visible. Address-keyed,
 * because there is no user, and generous enough for a hospital reception desk
 * whose whole building shares an address too.
 */
export const publicReferralRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: num(process.env.RATE_LIMIT_PUBLIC_REFERRAL, 60),
  keyGenerator: (req) => `pubref:ip:${ipKey(req)}`,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitResponse('Too many requests from this network. Wait a few minutes and try again.')
});
