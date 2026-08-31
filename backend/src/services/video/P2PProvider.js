import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { config } from '../../config/env.js';
import { VideoProvider, appMeetingUrl } from './VideoProvider.js';

/**
 * Peer-to-peer WebRTC provider.
 *
 * Implements the same `VideoProvider` contract as MediasoupProvider (§3.4), so
 * scheduling and the state machine cannot tell them apart. The difference is
 * only in how media flows:
 *
 *   mediasoup — media goes through a server-side SFU. Scales past two peers,
 *               needs a native worker binary (Linux/macOS).
 *   P2P       — media goes directly between the two peers, signalled over the
 *               app's own authenticated WebSocket. Two participants maximum,
 *               runs anywhere Node runs.
 *
 * A consultation is a doctor and an assistant — exactly two peers — so P2P is
 * a correct fit for this workload, not merely a stand-in. It is the active
 * provider wherever the mediasoup worker cannot run.
 *
 * The room id is a random UUID, never derived from patient data: an earlier
 * build used `room_<patient_code>_<timestamp>`, which was guessable.
 */
export class P2PProvider extends VideoProvider {
  constructor() {
    super();
    /** consultationId -> roomId */
    this.rooms = new Map();
  }

  get name() {
    return 'p2p';
  }

  async isAvailable() {
    // Needs nothing beyond the API process itself.
    return true;
  }

  async createMeeting(consultationId) {
    let roomId = this.rooms.get(consultationId);
    if (!roomId) {
      roomId = crypto.randomUUID();
      this.rooms.set(consultationId, roomId);
    }
    return { roomId, meetingUrl: appMeetingUrl(consultationId) };
  }

  /**
   * Short-lived per-user credentials. The signalling socket verifies this token
   * AND re-checks participation against the consultation row, so a leaked token
   * alone does not admit anyone.
   */
  async joinMeeting(consultationId, userId, role, { roomId } = {}) {
    const known = roomId || this.rooms.get(consultationId) || (await this.createMeeting(consultationId)).roomId;
    this.rooms.set(consultationId, known);

    const token = jwt.sign(
      { consultationId, userId, role, roomId: known, peer: crypto.randomUUID() },
      config.jwtSecret,
      { expiresIn: '2h' }
    );

    return {
      provider: 'p2p',
      token,
      roomId: known,
      // STUN is enough on one network; a TURN relay is required across
      // carrier-grade NAT, which is why its absence is surfaced by npm run check.
      iceServers: buildIceServers()
    };
  }

  async endMeeting(consultationId) {
    this.rooms.delete(consultationId);
  }
}

/**
 * Open Relay — Metered's free, publicly documented TURN service.
 *
 * Used only when no relay is configured. A relay is not optional in this
 * deployment: a doctor at home and a clinic on a rural mobile ISP are both
 * behind carrier-grade NAT, which STUN cannot traverse, so without one those
 * calls simply never connect.
 *
 * A TURN server forwards DTLS-SRTP it cannot decrypt, so this does not expose
 * consultation media to the relay operator. It is still a shared free tier with
 * no capacity guarantee — set TURN_URL to a dedicated service for production.
 */
const PUBLIC_FALLBACK_TURN = {
  urls: [
    'turn:openrelay.metered.ca:80',
    'turn:openrelay.metered.ca:443',
    'turn:openrelay.metered.ca:443?transport=tcp'
  ],
  username: 'openrelayproject',
  credential: 'openrelayproject'
};

let warnedAboutFallback = false;

function buildIceServers() {
  const servers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ];

  // Providers issue several URLs for one credential — UDP, TCP, and 443 for
  // networks that only allow HTTPS-looking traffic. Accept them as a
  // comma-separated list so all three can be offered.
  const configured = (process.env.TURN_URL || '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);

  if (configured.length) {
    servers.push({
      urls: configured,
      username: process.env.TURN_USERNAME || '',
      credential: process.env.TURN_CREDENTIAL || ''
    });
  } else {
    servers.push(PUBLIC_FALLBACK_TURN);
    if (!warnedAboutFallback) {
      warnedAboutFallback = true;
      console.warn(
        'TURN_URL is not set — falling back to the free public Open Relay service. ' +
        'Calls will connect across networks, but on a shared free tier with no capacity ' +
        'guarantee. Set TURN_URL / TURN_USERNAME / TURN_CREDENTIAL for production.'
      );
    }
  }

  return servers;
}
