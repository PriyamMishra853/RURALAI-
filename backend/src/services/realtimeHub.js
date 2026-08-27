import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import url from 'url';
import { config } from '../config/env.js';
import { supabaseAdmin } from '../config/supabase.js';
import { ROLE_DB_TO_API } from '../config/roles.js';

/**
 * Realtime hub — one authenticated WebSocket per signed-in staff member.
 *
 * Carries two things over the same connection, per spec §4.2 ("reuse the same
 * realtime infra as the notification system rather than standing up a second
 * channel"):
 *
 *   1. Notifications  — consultation scheduled / started / cancelled / …
 *   2. Call signalling — the per-consultation negotiation messages
 *
 * Identity always comes from the verified token and the staff_profiles row.
 * Nothing about who a socket claims to be is taken from the query string; that
 * was the exact hole in the original signalling server, where `role=DOCTOR` in
 * a URL was enough to join a live consultation.
 */

/** staffId -> Set<WebSocket> (a user may have several tabs open) */
const userSockets = new Map();
/** consultationId -> Set<WebSocket> */
const callRooms = new Map();

const addSocket = (map, key, ws) => {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(ws);
};

const removeSocket = (map, key, ws) => {
  const set = map.get(key);
  if (!set) return;
  set.delete(ws);
  if (!set.size) map.delete(key);
};

const send = (ws, payload) => {
  if (ws.readyState !== WebSocket.OPEN) return;
  try { ws.send(JSON.stringify(payload)); } catch { /* peer vanished mid-send */ }
};

/** Push a notification to every tab a user has open. Returns how many got it. */
export const pushToUser = (staffId, payload) => {
  const sockets = userSockets.get(staffId);
  if (!sockets) return 0;
  for (const ws of sockets) send(ws, payload);
  return sockets.size;
};

/** Relay a signalling message to the other peers in a call. */
export const relayToCall = (consultationId, senderWs, payload) => {
  const room = callRooms.get(consultationId);
  if (!room) return;
  for (const ws of room) if (ws !== senderWs) send(ws, payload);
};

export const isUserOnline = (staffId) => Boolean(userSockets.get(staffId)?.size);

/** Verify a bearer token and resolve it to an ACTIVE staff profile. */
const authenticate = async (token) => {
  if (!token) return null;

  let authUserId = null;
  let email = null;
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    authUserId = decoded.authUserId;
    email = decoded.email;
  } catch {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) return null;
    authUserId = data.user.id;
    email = data.user.email;
  }

  let q = supabaseAdmin.from('staff_profiles').select('id, full_name, role, status, district_id');
  q = authUserId ? q.eq('auth_user_id', authUserId) : q.eq('email', String(email).toLowerCase());
  const { data: profile } = await q.maybeSingle();

  if (!profile || profile.status !== 'active') return null;
  return {
    staffId: profile.id,
    name: profile.full_name,
    role: ROLE_DB_TO_API[profile.role],
    districtId: profile.district_id
  };
};

/** Is this user actually a participant of this consultation? */
const isParticipant = async (consultationId, staffId) => {
  const { data } = await supabaseAdmin
    .from('consultations')
    .select('id, doctor_id, assistant_id, status')
    .eq('id', consultationId)
    .maybeSingle();

  if (!data) return false;
  if (data.status === 'COMPLETED' || data.status === 'CANCELLED') return false;
  return data.doctor_id === staffId || data.assistant_id === staffId;
};

const refuse = (socket, code, reason) => {
  try { socket.write(`HTTP/1.1 ${code} ${reason}\r\nConnection: close\r\n\r\n`); } catch { /* gone */ }
  socket.destroy();
};

export const setupRealtimeHub = (httpServer) => {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', async (request, socket, head) => {
    const parsed = url.parse(request.url, true);
    if (parsed.pathname !== '/realtime' && parsed.pathname !== '/realtime/') return;

    // Browsers do not apply CORS to WebSockets, so this origin check is the
    // only thing standing in for it.
    const origin = request.headers.origin;
    if (origin && !config.allowedOrigins.includes(origin)) return refuse(socket, 403, 'Forbidden');

    // The browser WebSocket API cannot set an Authorization header, so the
    // token arrives as a query parameter. Short-lived, and not logged.
    const identity = await authenticate(parsed.query.token).catch(() => null);
    if (!identity) return refuse(socket, 401, 'Unauthorized');

    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.identity = identity;
      ws.callId = null;
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    addSocket(userSockets, ws.identity.staffId, ws);
    send(ws, { type: 'connected', role: ws.identity.role, name: ws.identity.name });

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      await handleMessage(ws, msg);
    });

    ws.on('close', () => cleanup(ws));
    ws.on('error', () => cleanup(ws));
  });

  const ping = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 25000);

  wss.on('close', () => clearInterval(ping));

  console.log('Realtime hub mounted on /realtime (notifications + call signalling)');
  return wss;
};

async function handleMessage(ws, msg) {
  switch (msg.type) {
    case 'ping':
      return send(ws, { type: 'pong' });

    /**
     * Join a call's signalling room. Membership is re-verified against the
     * consultation row here — a token alone is never enough, so a leaked or
     * replayed token cannot put someone into a call they are not part of.
     */
    case 'call:join': {
      const { consultationId } = msg;
      if (!consultationId) return send(ws, { type: 'call:error', message: 'consultationId is required.' });

      if (!(await isParticipant(consultationId, ws.identity.staffId))) {
        return send(ws, { type: 'call:error', message: 'You are not a participant of this consultation.' });
      }

      // A reconnect replaces the stale socket instead of being rejected as a
      // third participant (§3.8).
      const room = callRooms.get(consultationId);
      if (room) {
        for (const peer of [...room]) {
          if (peer !== ws && peer.identity.staffId === ws.identity.staffId) {
            removeSocket(callRooms, consultationId, peer);
            try { peer.close(4000, 'Replaced by reconnection'); } catch { /* gone */ }
          }
        }
      }

      ws.callId = consultationId;
      addSocket(callRooms, consultationId, ws);

      const peers = [...(callRooms.get(consultationId) || [])].filter((p) => p !== ws);
      send(ws, {
        type: 'call:joined',
        // Exactly one side creates the offer. The second peer to arrive is the
        // initiator, which is what prevents SDP offer glare.
        initiator: peers.length > 0,
        peers: peers.map((p) => ({ name: p.identity.name, role: p.identity.role }))
      });
      relayToCall(consultationId, ws, {
        type: 'call:peer-joined',
        name: ws.identity.name,
        role: ws.identity.role
      });
      return undefined;
    }

    // Media negotiation. roomId is never read from the message body — it is
    // fixed at join, so a connected socket cannot hop into another call.
    case 'call:offer':
    case 'call:answer':
    case 'call:ice':
    case 'call:transport':
    case 'call:produce':
    case 'call:consume': {
      if (!ws.callId) return send(ws, { type: 'call:error', message: 'Join the call first.' });
      return relayToCall(ws.callId, ws, { ...msg, from: ws.identity.role });
    }

    case 'call:leave': {
      if (ws.callId) {
        relayToCall(ws.callId, ws, { type: 'call:peer-left', role: ws.identity.role });
        removeSocket(callRooms, ws.callId, ws);
        ws.callId = null;
      }
      return undefined;
    }

    default:
      return undefined;
  }
}

function cleanup(ws) {
  if (ws.callId) {
    relayToCall(ws.callId, ws, { type: 'call:peer-left', role: ws.identity?.role });
    removeSocket(callRooms, ws.callId, ws);
  }
  if (ws.identity?.staffId) removeSocket(userSockets, ws.identity.staffId, ws);
}
