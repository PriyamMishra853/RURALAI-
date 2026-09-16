/**
 * What a rate limit applies to.
 *
 * The numbers are easy to read off the file; the key is the part that decides
 * whether a limiter protects the clinic or breaks it. A centre shares one
 * public IP, so an address-keyed budget is a budget for the whole building —
 * these pin that every limiter running after authentication is keyed by the
 * person instead, and that the two which cannot be keep working safely.
 */
import { describe, expect, it } from '@jest/globals';

const { userOrIpKey, loginKey, aiRateLimiter, patientSearchRateLimiter, loginRateLimiter, globalRateLimiter } =
  await import('../src/middleware/rateLimit.middleware.js');

const req = (over = {}) => ({ ip: '203.0.113.7', socket: {}, body: {}, ...over });

describe('who a limit applies to', () => {
  const key = userOrIpKey('ai');

  it('gives two assistants at the same clinic their own budgets', () => {
    const shared = { ip: '203.0.113.7' };
    const first = key(req({ ...shared, user: { id: 'assistant-1' } }));
    const second = key(req({ ...shared, user: { id: 'assistant-2' } }));
    expect(first).not.toBe(second);
    expect(first).toBe('ai:u:assistant-1');
  });

  it('follows the person, not the device they moved to', () => {
    const user = { id: 'doctor-9' };
    expect(key(req({ ip: '203.0.113.7', user }))).toBe(key(req({ ip: '198.51.100.2', user })));
  });

  it('falls back to the address before anyone is signed in', () => {
    expect(key(req())).toBe('ai:ip:203.0.113.7');
  });
});

describe('addresses that are not one caller', () => {
  const key = userOrIpKey('ai');

  it('treats an IPv6 subnet as one caller, since a machine gets a fresh address at will', () => {
    const a = key(req({ ip: '2001:db8:1234:5600::1' }));
    const b = key(req({ ip: '2001:db8:1234:5600::99ff' }));
    expect(a).toBe(b);
    expect(a).not.toContain('::1');
  });

  it('does not throw when the address is missing entirely', () => {
    expect(() => key({ body: {} })).not.toThrow();
    expect(key({ body: {} })).toContain('ai:ip:');
  });
});

describe('the login key', () => {
  it('separates accounts, so one person’s typos cannot lock out the building', () => {
    const shared = { ip: '203.0.113.7' };
    const mine = loginKey(req({ ...shared, body: { email: 'asha@clinic.in' } }));
    const theirs = loginKey(req({ ...shared, body: { email: 'doctor@clinic.in' } }));
    expect(mine).not.toBe(theirs);
  });

  it('normalises the address exactly as the login does, so retries count against one bucket', () => {
    const typed = loginKey(req({ body: { email: '  Asha@Clinic.IN ' } }));
    const clean = loginKey(req({ body: { email: 'asha@clinic.in' } }));
    expect(typed).toBe(clean);
  });

  it('still counts an attempt that names no account', () => {
    expect(() => loginKey(req({ body: undefined }))).not.toThrow();
    expect(loginKey(req({ body: {} }))).toBe('login:203.0.113.7:');
  });
});

describe('the limiters themselves', () => {
  it('are middleware', () => {
    for (const limiter of [aiRateLimiter, patientSearchRateLimiter, loginRateLimiter, globalRateLimiter]) {
      expect(typeof limiter).toBe('function');
    }
  });
});
