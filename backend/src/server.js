import http from 'http';
import app from './app.js';
import { config } from './config/env.js';
import { setupRealtimeHub } from './services/realtimeHub.js';
import { startConsultationSweeper } from './services/consultationSweeper.js';
import { recoverAbandonedJobs } from './services/documentJobs.js';
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

/**
 * Documents whose extraction died with the last container.
 *
 * The reader runs inside this process, so a deploy or a crash mid-extraction
 * leaves the job row saying `running` for ever, and the operator's screen waits
 * for a result nobody is computing. Closing those out is the first thing a new
 * container should do.
 */
recoverAbandonedJobs().catch((err) =>
  console.error('Abandoned document jobs could not be closed:', err.message));

// One WebSocket surface: /realtime carries notifications and consultation call
// signalling together. A second server on /signal used to sit alongside it,
// serving an assessment-screen call path that had become unreachable — its
// entry point could no longer be triggered from the UI, and it booked
// consultations with a payload the API rejects. It has been removed rather than
// left mounted as an unused way into live consultations.
const wss = setupRealtimeHub(server);

// Resolve the video provider at boot, not at call time: finding out the SFU
// cannot start while a doctor waits to join is the worst moment to learn it.
getVideoProvider().catch((err) => console.error('Video provider selection failed:', err.message));

startConsultationSweeper();

/**
 * Stop on the platform's signal instead of being cut off mid-request.
 *
 * Railway sends SIGTERM on every deploy and every restart. With no handler,
 * Node exits on the spot: a review being saved, a consultation being booked or
 * an upload in flight dies at whatever line it had reached, and the clinic sees
 * a failed request for work the server had already started. Closing the
 * listener first refuses new connections while letting accepted ones finish.
 *
 * The deadline is the other half. A socket that never closes — a realtime
 * client on a bad rural link is exactly that — must not hold the container open
 * until the platform kills it anyway, so there is a fixed grace period and then
 * the process exits regardless.
 */
const SHUTDOWN_GRACE_MS = Number(process.env.SHUTDOWN_GRACE_MS) || 10000;
let shuttingDown = false;

const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received — refusing new requests, finishing the ones in flight.`);

  const giveUp = setTimeout(() => {
    console.warn(`Still busy after ${SHUTDOWN_GRACE_MS}ms — exiting anyway.`);
    process.exit(0);
  }, SHUTDOWN_GRACE_MS);
  giveUp.unref?.();

  // 1012 is "service restart": browsers reconnect to the new container on their
  // own rather than treating this as an error worth showing anyone.
  for (const client of wss.clients) {
    try { client.close(1012, 'Server restarting'); } catch { /* already gone */ }
  }

  server.close(() => {
    clearTimeout(giveUp);
    console.log('HTTP server closed cleanly.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

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
