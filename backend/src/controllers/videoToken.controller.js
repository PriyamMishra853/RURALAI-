import { AccessToken } from 'livekit-server-sdk';
import { config } from '../config/env.js';

/**
 * Issue a short-lived LiveKit access token.
 *
 * The API secret never leaves the server. This is the structural difference
 * from the ZegoCloud path that used `generateKitTokenForTest`, which needs the
 * server secret inside the browser bundle — anyone loading the page could mint
 * tokens for any room on the account.
 *
 * POST /api/calls/video-token  { room, identity, name? }
 */
export const issueVideoToken = async (req, res) => {
  const { room, identity, name } = req.body || {};

  if (!config.livekit.apiKey || !config.livekit.apiSecret || !config.livekit.url) {
    return res.status(503).json({
      error: 'Video is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET.'
    });
  }
  if (!room || !identity) {
    return res.status(400).json({ error: 'room and identity are required.' });
  }

  try {
    const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
      identity: String(identity),
      name: name ? String(name) : String(identity),
      // Short TTL: a token is for joining one call now, not a standing key.
      ttl: '15m'
    });

    at.addGrant({
      room: String(room),
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true
    });

    const token = await at.toJwt();
    return res.json({ token, url: config.livekit.url, room, identity });
  } catch (err) {
    console.error('LiveKit token generation failed:', err.message);
    return res.status(500).json({ error: 'Could not issue a video token.' });
  }
};
