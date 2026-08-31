import http from 'http';
import app from './app.js';
import { config } from './config/env.js';
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

// One WebSocket surface: /realtime carries notifications and consultation call
// signalling together. A second server on /signal used to sit alongside it,
// serving an assessment-screen call path that had become unreachable — its
// entry point could no longer be triggered from the UI, and it booked
// consultations with a payload the API rejects. It has been removed rather than
// left mounted as an unused way into live consultations.
setupRealtimeHub(server);

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
📡 Realtime + Call: ${WS_URL}/realtime
⚡ Groq LLM: ${config.groq.apiKey ? 'CONNECTED' : 'MOCK/FALLBACK'}
🔍 Qdrant RAG: ${config.qdrant.url ? 'CONNECTED' : 'MOCK/FALLBACK'}
📊 Supabase DB: ${config.supabase.url ? 'CONNECTED' : 'MOCK/FALLBACK'}
======================================================================
  `);
});
