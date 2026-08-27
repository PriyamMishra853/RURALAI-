import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import url from 'url';
import { config } from '../config/env.js';
import { supabaseAdmin } from '../config/supabase.js';
import { ROLE_DB_TO_API } from '../config/roles.js';

/**
 * WebRTC signaling.
 *
 * v1 took roomId, role and userId straight from the query string and trusted
 * all three, with no token anywhere in the file. Anyone who learned a room id
 * could join a live consultation as "the doctor" — and because rooms cap at
 * two, their presence also locked the real doctor out.
 *
 * Now: the socket must present a valid token, the profile must be active, and
 * the caller must be a recorded participant of that specific consultation.
 * Identity comes from the verified token; the query string supplies only the
 * room being requested.
 */

// roomId -> Map<WebSocket, { staffId, role, name }>
const ROOMS = new Map();

const closeSocket = (socket, code, reason) => {
  try {
    socket.write(`HTTP/1.1 ${code} ${reason}\r\nConnection: close\r\n\r\n`);
  } catch { /* socket already gone */ }
  socket.destroy();
};

/**
 * Resolve a token to an active staff profile. Mirrors auth.middleware: a token
 * proves identity, the profile row decides role — and a missing profile is a
 * refusal, never a default role.
 */
const authenticateToken = async (token) => {
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

  let q = supabaseAdmin.from('staff_profiles').select('id, full_name, role, status');
  q = authUserId ? q.eq('auth_user_id', authUserId) : q.eq('email', String(email).toLowerCase());
  const { data: profile } = await q.maybeSingle();

  if (!profile || profile.status !== 'active') return null;
  return { staffId: profile.id, name: profile.full_name, role: ROLE_DB_TO_API[profile.role] };
};

/** Is this staff member a participant of this consultation room? */
const isParticipant = async (roomId, staffId) => {
  const { data } = await supabaseAdmin
    .from('consultations')
    .select('id, doctor_id, assistant_id, status')
    .eq('meeting_room_id', roomId)
    .maybeSingle();

  if (!data) return false;
  if (data.status === 'completed' || data.status === 'cancelled') return false;
  return data.doctor_id === staffId || data.assistant_id === staffId;
};

export const setupSignalingServer = (httpServer) => {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', async (request, socket, head) => {
    const parsed = url.parse(request.url, true);
    if (parsed.pathname !== '/signal' && parsed.pathname !== '/signal/') return;

    // Reject cross-origin upgrades. Browsers do not apply CORS to WebSockets,
    // so this check is the only thing standing in for it.
    const origin = request.headers.origin;
    if (origin && !config.allowedOrigins.includes(origin)) {
      return closeSocket(socket, 403, 'Forbidden');
    }

    // The browser WebSocket API cannot set an Authorization header, so the
    // token arrives as a query parameter. It is a short-lived bearer token and
    // this URL is not logged by the app; that is the accepted trade.
    const token = parsed.query.token;
    const roomId = parsed.query.roomId;

    if (!token || !roomId) return closeSocket(socket, 401, 'Unauthorized');

    let identity;
    try {
      identity = await authenticateToken(token);
    } catch {
      return closeSocket(socket, 500, 'Internal Server Error');
    }
    if (!identity) return closeSocket(socket, 401, 'Unauthorized');

    if (!(await isParticipant(roomId, identity.staffId))) {
      console.warn(`Signaling: ${identity.staffId} denied for room ${roomId} (not a participant)`);
      return closeSocket(socket, 403, 'Forbidden');
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.staffId = identity.staffId;
      ws.role = identity.role;
      ws.displayName = identity.name;
      ws.roomId = roomId;
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    console.log(`Signaling: ${ws.displayName} (${ws.role}) joined room ${ws.roomId}`);

    joinRoom(ws);

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      let data;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        return;
      }
      handleMessage(ws, data);
    });

    ws.on('close', () => leaveRoom(ws, 'DISCONNECTED'));
    ws.on('error', () => leaveRoom(ws, 'ERROR'));
  });

  const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 20000);

  wss.on('close', () => clearInterval(pingInterval));

  console.log('WebRTC signaling mounted on /signal (token + participant check required)');
  return wss;
};

function joinRoom(ws) {
  if (!ROOMS.has(ws.roomId)) ROOMS.set(ws.roomId, new Map());
  const room = ROOMS.get(ws.roomId);

  // A reconnecting participant replaces their own stale socket.
  for (const [peer] of room.entries()) {
    if (peer !== ws && peer.staffId === ws.staffId) {
      room.delete(peer);
      try { peer.close(4000, 'Replaced by reconnection'); } catch { /* already closed */ }
    }
  }

  if (room.size >= 2) {
    // Membership was verified at upgrade, so this is a genuine third party
    // rather than the impersonation case v1 allowed.
    safeSend(ws, { type: 'error', message: 'This consultation already has two participants.' });
    return ws.close(4003, 'Room full');
  }

  room.set(ws, { staffId: ws.staffId, role: ws.role, name: ws.displayName });

  if (room.size === 2) {
    for (const [peer, info] of room.entries()) {
      if (peer === ws) continue;
      // Exactly one side creates the offer; the newly joined peer is elected
      // initiator, which prevents offer glare.
      safeSend(peer, { type: 'peer-joined', role: ws.role, name: ws.displayName, initiator: false });
      safeSend(ws,   { type: 'peer-joined', role: info.role, name: info.name, initiator: true });
    }
  } else {
    safeSend(ws, { type: 'joined-waiting', message: 'Waiting for the other participant.' });
  }
}

function handleMessage(ws, data) {
  switch (data.type) {
    // roomId is never read from the message body — it is fixed at upgrade, so
    // a connected socket cannot hop into another room by sending a new id.
    case 'offer':
      return relay(ws, { type: 'offer', sdp: data.sdp });
    case 'answer':
      return relay(ws, { type: 'answer', sdp: data.sdp });
    case 'ice-candidate':
      return relay(ws, { type: 'ice-candidate', candidate: data.candidate });
    case 'leave-room':
      relay(ws, { type: 'peer-left', reason: 'LEFT' });
      return leaveRoom(ws, 'LEFT');
    case 'ping':
      return safeSend(ws, { type: 'pong' });
    default:
      return undefined;
  }
}

function safeSend(ws, payload) {
  if (ws.readyState !== WebSocket.OPEN) return;
  try { ws.send(JSON.stringify(payload)); } catch { /* peer vanished mid-send */ }
}

function relay(sender, payload) {
  const room = ROOMS.get(sender.roomId);
  if (!room) return;
  for (const [peer] of room.entries()) if (peer !== sender) safeSend(peer, payload);
}

function leaveRoom(ws, reason) {
  const room = ROOMS.get(ws.roomId);
  if (!room) return;
  relay(ws, { type: 'peer-left', reason });
  room.delete(ws);
  if (room.size === 0) ROOMS.delete(ws.roomId);
}
