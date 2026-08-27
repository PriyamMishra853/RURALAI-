import http from 'http';
import app from './app.js';
import { config } from './config/env.js';
import { setupSignalingServer } from './services/signalingService.js';
import { setupRealtimeHub } from './services/realtimeHub.js';
import { startConsultationSweeper } from './services/consultationSweeper.js';
import { getVideoProvider } from './services/video/index.js';

const PORT = config.port || 5000;
const BACKEND_URL = process.env.BACKEND_URL || `http://localhost:${PORT}`;
const WS_URL = process.env.WS_URL || `ws://localhost:${PORT}`;

/**
 * Last-resort process guards.
 *
 * A clinical API must not die because one library threw on one bad upload.
 * tesseract.js reports a failed image decode by throwing from its worker
 * thread on a later tick, which escapes every try/catch around the call and
 * killed the whole server — taking every other clinic's session with it.
 *
 * These handlers log loudly and keep serving. They are a safety net, not a
 * substitute for handling errors where they happen: anything landing here is
 * a bug that still needs fixing at its source.
 */
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION — server kept alive:', err?.stack || err);
});

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION — server kept alive:', reason?.stack || reason);
});

const server = http.createServer(app);

// Two upgrade handlers on one HTTP server, each claiming its own path:
//   /realtime — notifications + consultation call signalling (the new hub)
//   /signal   — the legacy direct-call path, kept while the older assessment
//               screen still uses it
setupRealtimeHub(server);
setupSignalingServer(server);

// Resolve the video provider at boot, not at call time: finding out the SFU
// cannot start while a doctor waits to join is the worst moment to learn it.
getVideoProvider().catch((err) => console.error('Video provider selection failed:', err.message));

startConsultationSweeper();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
======================================================================
🏥 VIRTUAL VILLAGE CLINIC AI BACKEND SERVER RUNNING
======================================================================
🚀 API Endpoint: ${BACKEND_URL}/api
🏥 Health Check: ${BACKEND_URL}/api/health
📡 WebRTC Signal: ${WS_URL}/signal
⚡ Groq LLM: ${config.groq.apiKey ? 'CONNECTED' : 'MOCK/FALLBACK'}
🔍 Qdrant RAG: ${config.qdrant.url ? 'CONNECTED' : 'MOCK/FALLBACK'}
📊 Supabase DB: ${config.supabase.url ? 'CONNECTED' : 'MOCK/FALLBACK'}
======================================================================
  `);
});
