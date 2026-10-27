/**
 * APA Engineering Services
 * Project Management System with Cost Estimation
 * ---------------------------------------------------------------------------
 * Express server: serves the static front end and exposes the /api routes.
 * The browser talks ONLY to this server; Supabase keys never reach the client.
 */
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import multer from 'multer';

import config, { configProblems } from './config.js';
import { ApiError, notFound } from './lib/http.js';
import { LOGIN_GUARD } from './middleware/rateLimit.js';

import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/users.routes.js';
import clientRoutes from './routes/clients.routes.js';
import materialRoutes from './routes/materials.routes.js';
import pricingRoutes from './routes/pricing.routes.js';
import quotationRoutes from './routes/quotations.routes.js';
import projectRoutes from './routes/projects.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import uploadRoutes from './routes/uploads.routes.js';

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1); // correct client IPs for the sign-in rate limiter

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'same-origin' },
  }),
);

app.use(
  cors({
    origin(origin, callback) {
      // Same-origin requests and tools such as curl send no Origin header.
      if (!origin || config.allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('This origin is not allowed to call the API.'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// ---------------------------------------------------------------------------
// Static front end
// ---------------------------------------------------------------------------
const publicDir = path.join(config.root, 'public');
app.use(
  express.static(publicDir, {
    extensions: ['html'],
    setHeaders(res, filePath) {
      if (/\.(css|js)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
    },
  }),
);

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
app.get('/api/health', (_req, res) => {
  const problems = configProblems();
  res.json({
    status: problems.length ? 'not-configured' : 'ok',
    environment: config.env,
    problems,
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/materials', materialRoutes);
app.use('/api/pricing', pricingRoutes);
app.use('/api/quotations', quotationRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/uploads', uploadRoutes);

// Unknown API route.
app.use('/api', (_req, _res, next) => next(notFound('That API endpoint does not exist.')));

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((error, req, res, _next) => {
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  if (error instanceof multer.MulterError) {
    const message =
      error.code === 'LIMIT_FILE_SIZE'
        ? `That file is too large. The maximum size is ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB.`
        : error.code === 'LIMIT_FILE_COUNT'
          ? 'Too many files were attached.'
          : `The upload failed: ${error.message}`;
    return res.status(400).json({ error: { message, code: error.code } });
  }

  if (error instanceof SyntaxError && 'body' in error) {
    return res.status(400).json({
      error: { message: 'The request body was not valid JSON.', code: 'BAD_JSON' },
    });
  }

  if (error instanceof ApiError) {
    if (error.status >= 500) console.error(`[${requestId}]`, error);
    return res.status(error.status).json({
      error: {
        message: error.message,
        code: error.name,
        ...(error.details ? { fields: error.details } : {}),
      },
    });
  }

  console.error(`[${requestId}] Unhandled error on ${req.method} ${req.originalUrl}`, error);

  return res.status(500).json({
    error: {
      message: config.isProduction
        ? 'Something went wrong on the server. Please try again.'
        : `Server error: ${error.message}`,
      code: 'INTERNAL',
      request_id: requestId,
    },
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const problems = configProblems();

if (!config.isConfigured) {
  console.warn('\n  WARNING - Supabase is not configured yet.');
  for (const problem of problems) console.warn(`   - ${problem}`);
  console.warn('   Copy .env.example to .env, fill in the values, then restart.\n');
}

app.listen(config.port, () => {
  const line = '='.repeat(72);
  console.log(line);
  console.log('  APA ENGINEERING SERVICES - Project Management System');
  console.log(line);
  console.log(`  Server      : http://localhost:${config.port}`);
  console.log(`  Environment : ${config.env}`);
  console.log(`  Supabase    : ${config.isConfigured ? 'configured' : 'NOT CONFIGURED - see the warning above'}`);
  console.log(`  Sign-in lock: ${LOGIN_GUARD.MAX_ATTEMPTS} failed attempts = ${LOGIN_GUARD.LOCK_MS / 60000} minute lockout`);
  console.log(line);
});

export default app;
