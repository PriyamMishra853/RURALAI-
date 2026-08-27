import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { config } from '../../config/env.js';
import { VideoProvider, VideoProviderError, appMeetingUrl } from './VideoProvider.js';

/**
 * mediasoup SFU implementation — spec §4.
 *
 * Architecture (§4.2):
 *   Worker (small pool, one per CPU up to a cap)
 *     └─ Router (one per consultation — created in createMeeting)
 *          ├─ Transport (WebRTC send/recv per peer)
 *          ├─ Producer (peer's outgoing tracks)
 *          └─ Consumer (peer's view of every other Producer)
 *
 * IMPORTANT — host requirement:
 *   mediasoup ships a native `mediasoup-worker` binary and officially targets
 *   Linux and macOS. On the Windows host this was developed on, the prebuilt
 *   binary fails to start (0xC0000135, missing MSVC runtime) and the local
 *   meson build also fails, so `npm install mediasoup@3` rolls back.
 *
 *   That is exactly why `isAvailable()` exists and why the provider is loaded
 *   with a dynamic import: on a host without a working worker this class is
 *   never selected, and `videoProvider.js` falls back to the peer-to-peer
 *   provider instead of failing at call time.
 *
 *   To run this in production: deploy on Linux (or WSL2 / Docker), then
 *     npm install mediasoup@3
 *   and set the announced IP (see MEDIASOUP_ANNOUNCED_IP below).
 *
 * Deploy env vars (§4.1):
 *   MEDIASOUP_ANNOUNCED_IP   public IP clients should send media to. REQUIRED
 *                            behind NAT/Docker — without it peers negotiate a
 *                            private address and the call connects but carries
 *                            no media.
 *   MEDIASOUP_MIN_PORT / MAX_PORT   RTC port range to open in the firewall.
 *   MEDIASOUP_WORKER_BIN     pin a prebuilt worker instead of compiling.
 *   MEDIASOUP_SKIP_WORKER_PREBUILT_DOWNLOAD=true   force a local build.
 */

const MEDIA_CODECS = [
  { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    // start bitrate kept modest: rural sub-centre uplinks are the constraint,
    // not the SFU.
    parameters: { 'x-google-start-bitrate': 600 }
  }
];

export class MediasoupProvider extends VideoProvider {
  constructor() {
    super();
    this.mediasoup = null;
    this.workers = [];
    this.nextWorker = 0;
    /** consultationId -> { router, peers: Map<userId, {transports, producers, consumers}> } */
    this.rooms = new Map();
    this.available = null;
  }

  get name() {
    return 'mediasoup';
  }

  async isAvailable() {
    if (this.available !== null) return this.available;
    try {
      // Dynamic import: a missing/unbuildable native module must not crash the
      // API at startup, it must simply mean "this provider is not usable here".
      this.mediasoup = await import('mediasoup');
      const probe = await this.mediasoup.createWorker({ logLevel: 'error' });
      probe.close();
      this.available = true;
    } catch (err) {
      console.warn(`mediasoup provider unavailable on this host: ${err.message}`);
      this.available = false;
    }
    return this.available;
  }

  async init() {
    if (!(await this.isAvailable())) {
      throw new VideoProviderError('The video SFU is not available on this host.', { retryable: false });
    }
    if (this.workers.length) return;

    const count = Math.min(Number(process.env.MEDIASOUP_WORKERS) || 2, 4);
    for (let i = 0; i < count; i += 1) {
      const worker = await this.mediasoup.createWorker({
        logLevel: 'warn',
        rtcMinPort: Number(process.env.MEDIASOUP_MIN_PORT) || 40000,
        rtcMaxPort: Number(process.env.MEDIASOUP_MAX_PORT) || 40100
      });
      // A dead worker takes its rooms with it. Drop them so a later join
      // re-creates the room rather than attaching to a closed router.
      worker.on('died', () => {
        console.error(`mediasoup worker ${worker.pid} died; dropping its rooms.`);
        for (const [id, room] of this.rooms) {
          if (room.workerPid === worker.pid) this.rooms.delete(id);
        }
      });
      this.workers.push(worker);
    }
    console.log(`mediasoup ready: ${this.workers.length} worker(s)`);
  }

  #pickWorker() {
    const w = this.workers[this.nextWorker % this.workers.length];
    this.nextWorker += 1;
    return w;
  }

  /** §3.5 — called ONCE per consultation, at confirmation time. */
  async createMeeting(consultationId) {
    await this.init();
    const existing = this.rooms.get(consultationId);
    if (existing) {
      return { roomId: existing.router.id, meetingUrl: appMeetingUrl(consultationId) };
    }

    try {
      const worker = this.#pickWorker();
      const router = await worker.createRouter({ mediaCodecs: MEDIA_CODECS });
      this.rooms.set(consultationId, { router, workerPid: worker.pid, peers: new Map() });
      return { roomId: router.id, meetingUrl: appMeetingUrl(consultationId) };
    } catch (err) {
      // §4.3 — never surface raw worker errors; caller must not transition state.
      throw new VideoProviderError('Unable to start the video session, please retry.', { cause: err });
    }
  }

  /**
   * §4.2 — returns transport parameters plus a short-lived signed token that
   * identifies this peer on the realtime channel. Never a server secret.
   */
  async joinMeeting(consultationId, userId, role) {
    await this.init();

    let room = this.rooms.get(consultationId);
    if (!room) {
      // Room lost (process restart, worker death). Recreate it — the caller
      // reuses the same consultation, and a fresh router is transparent to it.
      await this.createMeeting(consultationId);
      room = this.rooms.get(consultationId);
    }

    try {
      const transport = await room.router.createWebRtcTransport({
        listenIps: [{
          ip: '0.0.0.0',
          // Without announcedIp behind NAT the call connects and carries no
          // media. This is the single most common mediasoup misconfiguration.
          announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || undefined
        }],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
        initialAvailableOutgoingBitrate: 800000
      });

      if (!room.peers.has(userId)) {
        room.peers.set(userId, { transports: [], producers: [], consumers: [] });
      }
      room.peers.get(userId).transports.push(transport);

      const token = jwt.sign(
        { consultationId, userId, role, roomId: room.router.id, peer: crypto.randomUUID() },
        config.jwtSecret,
        { expiresIn: '2h' }
      );

      return {
        provider: 'mediasoup',
        token,
        roomId: room.router.id,
        rtpCapabilities: room.router.rtpCapabilities,
        transport: {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters
        }
      };
    } catch (err) {
      throw new VideoProviderError('Unable to join the video session, please retry.', { cause: err });
    }
  }

  /** §4.2 — close every Producer/Consumer/Transport, then the Router. */
  async endMeeting(consultationId) {
    const room = this.rooms.get(consultationId);
    if (!room) return;

    for (const peer of room.peers.values()) {
      for (const c of peer.consumers) { try { c.close(); } catch { /* already closed */ } }
      for (const p of peer.producers) { try { p.close(); } catch { /* already closed */ } }
      for (const t of peer.transports) { try { t.close(); } catch { /* already closed */ } }
    }
    try { room.router.close(); } catch { /* already closed */ }
    this.rooms.delete(consultationId);
  }

  async shutdown() {
    for (const id of [...this.rooms.keys()]) await this.endMeeting(id);
    for (const w of this.workers) { try { w.close(); } catch { /* already closed */ } }
    this.workers = [];
  }
}
