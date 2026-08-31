/**
 * Call signalling over the realtime hub.
 *
 * The consultation call used to die in two ways that both looked identical to
 * the user — a spinner that never resolved — and neither was reproducible by
 * reading the state machine, because both live in the socket layer:
 *
 *   1. `call:join` was sent once, into a socket that might still be opening.
 *   2. On any reconnect the server dropped the socket from its call room and
 *      the client never re-declared membership, so a network blip permanently
 *      orphaned a live consultation.
 *
 * The rejoin case below is the regression gate for (2). Supabase is mocked:
 * this suite asserts the relay's behaviour, and must not need a database.
 */
import { describe, expect, it, beforeAll, afterAll, jest } from '@jest/globals';
import http from 'http';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'test-secret-for-signalling';

const DOCTOR    = { id: 'doc-1', full_name: 'Dr Asha Rao',  role: 'doctor',           status: 'active', district_id: 'dist-1' };
const ASSISTANT = { id: 'ast-1', full_name: 'Sunita Devi',  role: 'clinic_assistant', status: 'active', district_id: 'dist-1' };
const OUTSIDER  = { id: 'doc-9', full_name: 'Dr Uninvited', role: 'doctor',           status: 'active', district_id: 'dist-1' };

const PROFILES = { 'auth-doc': DOCTOR, 'auth-ast': ASSISTANT, 'auth-out': OUTSIDER };

const CONSULTATION = { id: 'consult-1', doctor_id: 'doc-1', assistant_id: 'ast-1', status: 'SCHEDULED' };

jest.unstable_mockModule('../src/config/env.js', () => ({
  config: { jwtSecret: JWT_SECRET, allowedOrigins: [] }
}));

jest.unstable_mockModule('../src/config/supabase.js', () => {
  const builder = (table) => {
    const filters = {};
    const chain = {
      select: () => chain,
      eq: (column, value) => { filters[column] = value; return chain; },
      maybeSingle: async () => {
        if (table === 'staff_profiles') return { data: PROFILES[filters.auth_user_id] || null };
        if (table === 'consultations') return { data: filters.id === CONSULTATION.id ? CONSULTATION : null };
        return { data: null };
      }
    };
    return chain;
  };
  return { supabaseAdmin: { from: builder } };
});

const { setupRealtimeHub } = await import('../src/services/realtimeHub.js');
const { WebSocket } = await import('ws');

const tokenFor = (authUserId) => jwt.sign({ authUserId, email: `${authUserId}@example.test` }, JWT_SECRET);

let server;
let port;

beforeAll(async () => {
  server = http.createServer();
  setupRealtimeHub(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

/** Open a socket and record everything it receives. */
const connect = (authUserId) => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/realtime?token=${tokenFor(authUserId)}`);
  ws.inbox = [];
  ws.on('message', (raw) => {
    try { ws.inbox.push(JSON.parse(raw.toString())); } catch { /* not our frame */ }
  });
  ws.on('open', () => resolve(ws));
  ws.on('error', reject);
});

/** Wait for one message of a type, polling the recorded inbox. */
const waitFor = async (ws, type, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = ws.inbox.find((m) => m.type === type);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timed out waiting for "${type}"; saw: [${ws.inbox.map((m) => m.type).join(', ')}]`);
};

const join = (ws) => ws.send(JSON.stringify({ type: 'call:join', consultationId: CONSULTATION.id }));
const close = (ws) => new Promise((resolve) => { ws.on('close', resolve); ws.close(); });

describe('authentication', () => {
  it('refuses a socket with no token', async () => {
    await expect(new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/realtime`);
      ws.on('open', () => { ws.close(); resolve('opened'); });
      ws.on('error', reject);
    })).rejects.toThrow(/401/);
  });

  it('refuses an upgrade to a path that is not /realtime', async () => {
    // A silent `return` here used to leave the socket open and unowned.
    await expect(new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/signal?roomId=x`);
      ws.on('open', () => { ws.close(); resolve('opened'); });
      ws.on('error', reject);
    })).rejects.toThrow(/404/);
  });
});

describe('call room membership', () => {
  it('introduces two participants to each other', async () => {
    const doctor = await connect('auth-doc');
    const assistant = await connect('auth-ast');

    join(doctor);
    const first = await waitFor(doctor, 'call:joined');
    expect(first.peers).toEqual([]);

    join(assistant);
    const second = await waitFor(assistant, 'call:joined');
    expect(second.peers).toHaveLength(1);
    expect(second.peers[0].name).toBe('Dr Asha Rao');

    const announced = await waitFor(doctor, 'call:peer-joined');
    expect(announced.name).toBe('Sunita Devi');

    await close(doctor);
    await close(assistant);
  });

  it('refuses someone who is not a participant of the consultation', async () => {
    const outsider = await connect('auth-out');
    join(outsider);

    const err = await waitFor(outsider, 'call:error');
    expect(err.message).toMatch(/not a participant/i);

    await close(outsider);
  });

  it('relays an offer to the other peer only', async () => {
    const doctor = await connect('auth-doc');
    const assistant = await connect('auth-ast');
    join(doctor);
    join(assistant);
    await waitFor(assistant, 'call:joined');

    doctor.send(JSON.stringify({ type: 'call:offer', sdp: { type: 'offer', sdp: 'v=0-fake' } }));

    const relayed = await waitFor(assistant, 'call:offer');
    expect(relayed.sdp.sdp).toBe('v=0-fake');
    // The sender must not receive its own offer back.
    expect(doctor.inbox.filter((m) => m.type === 'call:offer')).toHaveLength(0);

    await close(doctor);
    await close(assistant);
  });

  it('tells the remaining peer when the other drops', async () => {
    const doctor = await connect('auth-doc');
    const assistant = await connect('auth-ast');
    join(doctor);
    join(assistant);
    await waitFor(doctor, 'call:peer-joined');

    await close(assistant);

    const left = await waitFor(doctor, 'call:peer-left');
    expect(left.role).toBe('CLINIC_ASSISTANT');

    await close(doctor);
  });

  /**
   * The regression gate.
   *
   * A reconnecting participant must be able to re-declare membership and be
   * seen again by the peer who stayed. Before the fix the client sent
   * `call:join` exactly once, so after any reconnect the server no longer had
   * the socket in the room and the two sides could never find each other again
   * — the call was over even though both people were still sitting there.
   */
  it('restores membership when a participant reconnects and rejoins', async () => {
    const doctor = await connect('auth-doc');
    const assistant = await connect('auth-ast');
    join(doctor);
    join(assistant);
    await waitFor(doctor, 'call:peer-joined');

    // The assistant's network drops.
    await close(assistant);
    await waitFor(doctor, 'call:peer-left');
    doctor.inbox.length = 0;

    // ...and comes back, re-declaring membership as the client now does on
    // every reconnect.
    const reconnected = await connect('auth-ast');
    join(reconnected);

    const rejoined = await waitFor(reconnected, 'call:joined');
    expect(rejoined.peers).toHaveLength(1);
    expect(rejoined.peers[0].name).toBe('Dr Asha Rao');

    const seenAgain = await waitFor(doctor, 'call:peer-joined');
    expect(seenAgain.name).toBe('Sunita Devi');

    await close(doctor);
    await close(reconnected);
  });

  it('replaces a stale socket rather than treating a reconnect as a third party', async () => {
    const doctor = await connect('auth-doc');
    const assistant = await connect('auth-ast');
    join(doctor);
    join(assistant);
    await waitFor(doctor, 'call:peer-joined');

    // Same user, second tab / reconnect before the old socket was reaped.
    const assistantAgain = await connect('auth-ast');
    join(assistantAgain);

    const rejoined = await waitFor(assistantAgain, 'call:joined');
    // Only the doctor — the assistant's own stale socket must have been evicted.
    expect(rejoined.peers).toHaveLength(1);
    expect(rejoined.peers[0].role).toBe('DOCTOR');

    await close(doctor);
    await close(assistantAgain);
  });
});
