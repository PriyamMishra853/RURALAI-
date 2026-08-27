import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { config } from './config/env.js';
import { globalRateLimiter } from './middleware/rateLimit.middleware.js';

import authRoutes from './routes/auth.routes.js';
import patientRoutes from './routes/patient.routes.js';
import regionRoutes from './routes/regions.routes.js';
import visitRoutes from './routes/visit.routes.js';
import documentRoutes from './routes/document.routes.js';
import aiRoutes from './routes/ai.routes.js';
import doctorRoutes from './routes/doctor.routes.js';
import consultationRoutes from './routes/consultation.routes.js';
import notificationRoutes from './routes/notification.routes.js';
import reportRoutes from './routes/report.routes.js';
import adminRoutes from './routes/admin.routes.js';
import visionRoutes from './routes/vision.routes.js';
import voiceRoutes from './routes/voice.routes.js';

const app = express();

// Trust the platform proxy so rate limiting and logging see the real client IP
// rather than the load balancer's. Without this every request behind the LB
// shares one bucket and the limiters are meaningless.
app.set('trust proxy', 1);

// Middleware
app.use(
  helmet({
    // The SPA is served from this same origin; the default CSP would block its
    // own bundle. A real policy is listed as a gap in docs/PHASE2_PROGRESS.md.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  })
);

// Origin allowlist, not `*`. With `*` any website could drive this API using a
// signed-in user's browser. Configure via CORS_ALLOWED_ORIGINS.
app.use(
  cors({
    origin(origin, callback) {
      // Same-origin and non-browser callers (curl, health checks) send no Origin.
      if (!origin || config.allowedOrigins.includes(origin)) return callback(null, true);

      // Deny by withholding the CORS headers — never by throwing. An error here
      // propagates to the global handler and turns the request into a 500, which
      // took down same-origin stylesheets and scripts the moment anything added
      // an Origin header. Without the headers the browser blocks the cross-origin
      // read itself, which is the actual enforcement.
      return callback(null, false);
    },
    credentials: true
  })
);

// Uploads arrive as multipart via multer, so JSON bodies are small. The former
// 50mb ceiling let a single request allocate 50mb of heap.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use('/api', globalRateLimiter);

// Serve the built frontend (frontend/dist) when it exists — lets a single
// Railway service host the whole app: UI + /api + /signal on one origin.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIST = path.resolve(__dirname, '../../frontend/dist');
const HAS_FRONTEND = fs.existsSync(path.join(FRONTEND_DIST, 'index.html'));
if (HAS_FRONTEND) {
  app.use(express.static(FRONTEND_DIST));
}

// Root API Endpoint Welcome
app.get(HAS_FRONTEND ? '/api' : ['/', '/api'], (req, res) => {
  res.json({
    status: 'ONLINE',
    service: 'Virtual Village Clinic AI Backend API',
    endpoints: {
      health: '/api/health',
      patients: '/api/patients',
      regions: '/api/regions',
      visits: '/api/visits',
      ai: '/api/ai',
      vision: '/api/vision',
      voice: '/api/voice',
      doctor: '/api/doctor',
      consultations: '/api/consultations',
      notifications: '/api/notifications'
    }
  });
});

// Health Check Endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ONLINE',
    system: 'Virtual Village Clinic AI Backend API',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/regions', regionRoutes);
app.use('/api/visits', visitRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/vision', visionRoutes);
app.use('/api/voice', voiceRoutes);
app.use('/api/doctor', doctorRoutes);
app.use('/api/consultations', consultationRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/admin', adminRoutes);

// SPA fallback: any non-API GET serves the frontend router
if (HAS_FRONTEND) {
  app.get(/^\/(?!api\/|signal).*/, (req, res) => {
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
}

// Global Error Handler
//
// The message is logged in full but only returned to the client outside
// production. Internal errors routinely carry table names, query fragments and
// upstream provider detail, and that is reconnaissance material.
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err);

  const status = err.status || 500;
  const body = { error: status === 500 ? 'Internal Server Error' : err.name || 'Request Error' };

  if (!config.isProduction || status < 500) {
    body.message = err.message || 'An unexpected error occurred.';
  } else {
    body.message = 'An unexpected error occurred. Contact an administrator if this persists.';
  }

  res.status(status).json(body);
});

export default app;
