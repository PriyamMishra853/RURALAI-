import express from 'express';
import helmet from 'helmet';

/**
 * Content security policy, REPORT-ONLY by default (Roadmap v3, Phase 6).
 *
 * A policy that blocks something the app needs takes the whole clinic down,
 * and nothing in a test suite can prove a policy right for every screen and
 * browser in use. So it ships reporting what it would have blocked, to
 * /api/csp-report, and blocks nothing. Once the reports are quiet it is flipped
 * to enforcing with CSP_ENFORCE=true — a variable, not a code change.
 *
 * The hosts are the ones the app actually uses: its own origin (the API and the
 * /realtime WebSocket), Supabase for storage images and the client, and Google
 * Fonts. frame-ancestors 'none' is the clickjacking defence, in its modern form.
 */
export const cspDirectives = (supabaseUrl = process.env.SUPABASE_URL) => {
  let supabaseOrigin = null;
  try { supabaseOrigin = new URL(supabaseUrl).origin; } catch { /* not configured */ }
  const supabase = supabaseOrigin ? [supabaseOrigin] : [];

  return {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
    imgSrc: ["'self'", 'data:', 'blob:', ...supabase],
    mediaSrc: ["'self'", 'blob:'],
    connectSrc: ["'self'", 'wss:', ...supabase],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
    reportUri: ['/api/csp-report']
  };
};

export const contentSecurityPolicy = ({ enforce = process.env.CSP_ENFORCE === 'true', supabaseUrl } = {}) =>
  helmet.contentSecurityPolicy({
    useDefaults: false,
    reportOnly: !enforce,
    directives: cspDirectives(supabaseUrl)
  });

/**
 * Where the browser sends what the policy would have blocked. One short log
 * line, with query strings cut off: a report carries the page URL, and a URL
 * is exactly where a token or an identifier would leak into a log.
 */
const withoutQuery = (value) => String(value || '').split(/[?#]/)[0].slice(0, 200);

export const describeViolation = (body) => {
  const report = body?.['csp-report'] || body || {};
  const directive = report['violated-directive'] || report['effective-directive'] || '?';
  return `CSP would block: ${directive} ${withoutQuery(report['blocked-uri'])} on ${withoutQuery(report['document-uri'])}`;
};

export const cspReportRoute = [
  express.json({ type: ['application/csp-report', 'application/json'], limit: '16kb' }),
  (req, res) => {
    console.warn(describeViolation(req.body));
    res.status(204).end();
  }
];
