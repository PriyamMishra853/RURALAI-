/**
 * The content security policy, as a browser receives it.
 *
 * Mounted on a bare server with the production module, so this checks the
 * real header rather than a copy of it. The rule that matters most: by default
 * it REPORTS and blocks nothing, because a wrong directive in enforcing mode is
 * a blank screen in a clinic.
 */
import { describe, expect, it, afterEach, jest } from '@jest/globals';
import express from 'express';

const { contentSecurityPolicy, cspReportRoute, describeViolation } =
  await import('../src/middleware/contentSecurity.middleware.js');

let server;
const serve = async (options) => {
  const app = express();
  app.use(contentSecurityPolicy(options));
  app.post('/api/csp-report', ...cspReportRoute);
  app.get('/', (req, res) => res.send('ok'));
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  return `http://127.0.0.1:${server.address().port}`;
};

afterEach(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  server = null;
});

describe('the header', () => {
  it('reports and blocks nothing unless enforcement is switched on', async () => {
    const base = await serve({ enforce: false, supabaseUrl: 'https://abc.supabase.co' });
    const res = await fetch(`${base}/`);
    expect(res.headers.get('content-security-policy-report-only')).toBeTruthy();
    expect(res.headers.get('content-security-policy')).toBeNull();
  });

  it('enforces when told to', async () => {
    const base = await serve({ enforce: true, supabaseUrl: 'https://abc.supabase.co' });
    const res = await fetch(`${base}/`);
    expect(res.headers.get('content-security-policy')).toBeTruthy();
  });

  it('allows exactly what the app uses, and refuses framing and plugins', async () => {
    const base = await serve({ enforce: false, supabaseUrl: 'https://abc.supabase.co/rest/v1' });
    const policy = (await fetch(`${base}/`)).headers.get('content-security-policy-report-only');
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain('img-src \'self\' data: blob: https://abc.supabase.co');
    expect(policy).toContain('connect-src \'self\' wss: https://abc.supabase.co');
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain('report-uri /api/csp-report');
    expect(policy).not.toContain("'unsafe-eval'");
  });

  it('still produces a policy when Supabase is not configured', async () => {
    const base = await serve({ enforce: false, supabaseUrl: undefined });
    const policy = (await fetch(`${base}/`)).headers.get('content-security-policy-report-only');
    expect(policy).toContain("default-src 'self'");
  });
});

describe('violation reports', () => {
  it('are accepted as the browser sends them', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const base = await serve({ enforce: false });
    const res = await fetch(`${base}/api/csp-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/csp-report' },
      body: JSON.stringify({ 'csp-report': { 'violated-directive': 'img-src', 'blocked-uri': 'https://tiles.example.org/1/2.png', 'document-uri': 'https://clinic.example.org/doctor' } })
    });
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('img-src https://tiles.example.org/1/2.png'));
    warn.mockRestore();
  });

  it('never log a query string, which is where a token would be', () => {
    const line = describeViolation({
      'csp-report': {
        'violated-directive': 'connect-src',
        'blocked-uri': 'https://evil.example/collect?token=abc123',
        'document-uri': 'https://clinic.example.org/patient?aadhaar=234567890123#x'
      }
    });
    expect(line).not.toContain('abc123');
    expect(line).not.toContain('234567890123');
    expect(line).toContain('https://clinic.example.org/patient');
  });
});
