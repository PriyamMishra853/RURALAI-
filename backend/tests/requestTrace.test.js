/**
 * Request IDs and the slow/failed request log.
 *
 * The point is that "it didn't work" becomes a search: every response names
 * itself, and anything slow or failed is logged under that name — without
 * reflecting a caller's arbitrary header into the log, and without leaking a
 * query string.
 */
import { describe, expect, it, afterEach } from '@jest/globals';
import express from 'express';

const { traceRequests, requestId, logLine } = await import('../src/middleware/requestTrace.middleware.js');

let server;
const serve = async (lines, slowMs = 50) => {
  const app = express();
  app.use(traceRequests({ slowMs, log: (line) => lines.push(line) }));
  app.get('/api/fast', (req, res) => res.json({ id: req.id }));
  app.get('/api/slow', (req, res) => setTimeout(() => res.json({ ok: true }), 80));
  app.get('/api/broken', (req, res) => res.status(500).json({ request_id: req.id }));
  app.get('/page', (req, res) => setTimeout(() => res.send('ok'), 80));
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  return `http://127.0.0.1:${server.address().port}`;
};

afterEach(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  server = null;
});

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('every response names itself', () => {
  it('returns the ID in a header, the same one the handler saw', async () => {
    const base = await serve([]);
    const res = await fetch(`${base}/api/fast`);
    const body = await res.json();
    expect(res.headers.get('x-request-id')).toBe(body.id);
  });

  it('honours a caller\'s ID only when it looks like one', () => {
    expect(requestId('retry-7f3a9c21')).toBe('retry-7f3a9c21');
    for (const junk of ['short', '<script>alert(1)</script>', 'x'.repeat(100), '', undefined, 'a b c d e f g h']) {
      expect(requestId(junk)).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});

describe('what gets logged', () => {
  it('logs a slow API call and a failed one, not a fast one', async () => {
    const lines = [];
    const base = await serve(lines);
    await fetch(`${base}/api/fast`);
    await fetch(`${base}/api/slow`);
    await fetch(`${base}/api/broken`);
    await settle();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^SLOW GET \/api\/slow -> 200 in \d+ ms \[/);
    expect(lines[1]).toMatch(/^FAILED GET \/api\/broken -> 500/);
  });

  it('does not judge a page or a stream as a slow request', async () => {
    const lines = [];
    const base = await serve(lines);
    await fetch(`${base}/page`);
    await settle();
    expect(lines).toHaveLength(0);
  });

  it('never logs a query string', () => {
    const line = logLine({ id: 'abc', method: 'POST', url: '/api/patients/lookup?aadhaar=234567890123&token=xyz', status: 500, ms: 12 });
    expect(line).not.toContain('234567890123');
    expect(line).not.toContain('xyz');
    expect(line).toContain('/api/patients/lookup');
  });
});
