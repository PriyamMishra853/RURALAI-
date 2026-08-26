import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Secrets that were committed to the public repository at some point and must
 * never be accepted again, plus the old hardcoded fallback. Anyone reading the
 * repo history can sign a token with these, and a forged token carries whatever
 * role it claims — including ADMIN.
 */
const KNOWN_LEAKED_SECRETS = new Set([
  'virtual_village_clinic_jwt_secret',
  'virtual_clinic_jwt_secret_key_2026'
]);

const MIN_SECRET_LENGTH = 32;

/**
 * Resolve the JWT signing secret.
 *
 * In production a missing, short or previously-leaked secret is fatal: booting
 * anyway would serve traffic that anyone can forge tokens against. In
 * development a random secret is generated instead, so there is no fixed value
 * to leak — the only cost is that tokens do not survive a restart.
 */
const resolveJwtSecret = () => {
  const secret = process.env.JWT_SECRET;

  const problem = !secret
    ? 'JWT_SECRET is not set'
    : KNOWN_LEAKED_SECRETS.has(secret)
      ? 'JWT_SECRET is a publicly known value from this repository'
      : secret.length < MIN_SECRET_LENGTH
        ? `JWT_SECRET is shorter than ${MIN_SECRET_LENGTH} characters`
        : null;

  if (!problem) return secret;

  if (isProduction) {
    throw new Error(
      `Refusing to start: ${problem}. Generate one with \`openssl rand -base64 48\` and set JWT_SECRET.`
    );
  }

  console.warn(
    `⚠️  ${problem}. Using a random development secret — sessions will not survive a restart.\n` +
      '   Set JWT_SECRET in backend/.env before deploying anywhere.'
  );
  return crypto.randomBytes(48).toString('base64');
};

/**
 * Origins allowed to call the API with credentials. `*` was previously sent for
 * every origin, which lets any website drive the API using a signed-in user's
 * browser. Comma-separated list in CORS_ALLOWED_ORIGINS.
 */
const resolveAllowedOrigins = () => {
  const configured = (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  if (configured.length > 0) return configured;

  if (isProduction) {
    throw new Error(
      'Refusing to start: CORS_ALLOWED_ORIGINS is not set. List the exact origins the frontend is served from.'
    );
  }

  // The API also serves the built frontend, so its own origin must be allowed
  // or the app cannot call itself when PORT is anything non-default.
  const ownPort = process.env.PORT || 5000;
  return [
    `http://localhost:${ownPort}`,
    `http://127.0.0.1:${ownPort}`,
    'http://localhost:3000',
    'http://localhost:5000',
    'http://localhost:5173'
  ];
};

export const config = {
  isProduction,
  port: process.env.PORT || 5000,
  jwtSecret: resolveJwtSecret(),
  allowedOrigins: resolveAllowedOrigins(),
  supabase: {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },
  groq: {
    apiKey: process.env.GROQ_API_KEY,
  },
  qdrant: {
    // QDRANT_CLUSTER_ENDPOINT wins: it is the name the Qdrant Cloud console
    // uses, and QDRANT_URL has already been left pointing at a decommissioned
    // cluster once. Whichever is set and reachable should be the one used.
    url: process.env.QDRANT_CLUSTER_ENDPOINT || process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY,
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
  },
  resend: {
    apiKey: process.env.RESEND_API_KEY,
  },
};

/**
 * Supabase is the only dependency the clinical routes cannot degrade past — a
 * missing service-role key means every patient write fails at runtime rather
 * than at boot, which is a far worse way to find out.
 */
if (isProduction && (!config.supabase.url || !config.supabase.serviceRoleKey)) {
  throw new Error(
    'Refusing to start: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in production.'
  );
}
