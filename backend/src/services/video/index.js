import { MediasoupProvider } from './MediasoupProvider.js';
import { P2PProvider } from './P2PProvider.js';

export { VideoProviderError } from './VideoProvider.js';

/**
 * Provider selection, resolved once at startup.
 *
 * Preference order is mediasoup (SFU, scales past two peers), then peer-to-peer.
 * Selection happens at boot rather than at call time on purpose: discovering
 * that the SFU cannot start while a doctor is waiting to join is the worst
 * possible moment to find out.
 *
 * Override with VIDEO_PROVIDER=mediasoup|p2p to pin one explicitly.
 */

let selected = null;
let selecting = null;

const build = async () => {
  const forced = (process.env.VIDEO_PROVIDER || '').toLowerCase();

  if (forced === 'p2p') {
    console.log('Video provider: p2p (pinned by VIDEO_PROVIDER)');
    return new P2PProvider();
  }

  const mediasoup = new MediasoupProvider();
  if (await mediasoup.isAvailable()) {
    await mediasoup.init();
    console.log('Video provider: mediasoup (SFU)');
    return mediasoup;
  }

  if (forced === 'mediasoup') {
    // Pinned but unusable — say so loudly rather than silently downgrading,
    // because someone deliberately asked for the SFU.
    throw new Error(
      'VIDEO_PROVIDER=mediasoup was requested but the mediasoup worker cannot run on this host. ' +
      'mediasoup needs a native worker binary (Linux/macOS, or WSL2/Docker on Windows).'
    );
  }

  console.log('Video provider: p2p (mediasoup worker unavailable on this host)');
  return new P2PProvider();
};

/** Resolve the active provider. Safe to call concurrently. */
export const getVideoProvider = async () => {
  if (selected) return selected;
  if (!selecting) {
    selecting = build().then((p) => {
      selected = p;
      selecting = null;
      return p;
    });
  }
  return selecting;
};

export const shutdownVideoProvider = async () => {
  if (selected?.shutdown) await selected.shutdown();
  selected = null;
};
