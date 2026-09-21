import crypto from 'crypto';

/**
 * A name for every request (Roadmap v3, Phase 6: observability).
 *
 * When a lab report failed to read in production, the only evidence was a job
 * row that said "timeout", and connecting it to what the server was doing at
 * the time took a database query and a guess. A request ID fixes the first
 * half of that: the ID goes back to the browser in a header, into every error
 * body, and into the log line for anything slow or failed, so "it didn't work"
 * becomes a search.
 *
 * An incoming X-Request-Id is honoured when it looks like an ID, so a caller
 * can correlate its own retries. Anything else is replaced — a header is user
 * input, and a log line is not the place to reflect it.
 *
 * The slow-request line is the second half: anything slower than
 * SLOW_REQUEST_MS (default 5 s) is logged with method, path, status and
 * duration. The path is logged without its query string, which is where a
 * token or an identifier would otherwise leak into the log.
 */

const SANE_ID = /^[A-Za-z0-9_-]{8,64}$/;
const SLOW_REQUEST_MS = Number(process.env.SLOW_REQUEST_MS) || 5000;

export const requestId = (incoming) => (SANE_ID.test(String(incoming || '')) ? incoming : crypto.randomUUID());

export const logLine = ({ id, method, url, status, ms }) =>
  `${status >= 500 ? 'FAILED' : 'SLOW'} ${method} ${String(url || '').split('?')[0]} -> ${status} in ${ms} ms [${id}]`;

export const traceRequests = ({ slowMs = SLOW_REQUEST_MS, log = console.warn } = {}) => (req, res, next) => {
  req.id = requestId(req.get('X-Request-Id'));
  res.set('X-Request-Id', req.id);

  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number((process.hrtime.bigint() - startedAt) / 1000000n);
    // A long-lived stream — the realtime socket, a PDF download — is not a
    // slow request, it is a long one. Only API calls are judged.
    if (!req.originalUrl?.startsWith('/api/')) return;
    if (res.statusCode >= 500 || ms >= slowMs) {
      log(logLine({ id: req.id, method: req.method, url: req.originalUrl, status: res.statusCode, ms }));
    }
  });

  next();
};
