/**
 * UFC 245 · Usman vs. Covington — Tactical Dashboard
 * Production server for Railway deployment.
 */
const express = require('express');
const compression = require('compression');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'production';

// Trust proxy for correct req.ip / https behind Railway's edge
app.set('trust proxy', 1);

// Gzip/brotli compression
app.use(compression());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // Allow Google Fonts only
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; " +
    "img-src 'self' data:; " +
    "connect-src 'self'"
  );
  next();
});

// Tiny access log
app.use((req, _res, next) => {
  const t = new Date().toISOString();
  console.log(`[${t}] ${req.method} ${req.path}`);
  next();
});

// Static: cache immutable assets for 1 day, html no-cache so updates show
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  maxAge: '1d',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    }
  }
}));

// Health check for Railway
app.get('/healthz', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'ufc245-tactical',
    uptime_s: Math.round(process.uptime()),
    node: process.version,
    env: NODE_ENV
  });
});

// 404 fallback → index (SPA-friendly, though this is a single-page doc)
app.use((req, res) => {
  if (req.accepts('html')) {
    return res.status(200).sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  res.status(404).json({ error: 'not_found', path: req.path });
});

const server = app.listen(PORT, () => {
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  UFC 245 Tactical Dashboard`);
  console.log(`  listening on :${PORT}  ·  env=${NODE_ENV}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
});

// Graceful shutdown for Railway deploys
['SIGTERM', 'SIGINT'].forEach(sig => {
  process.on(sig, () => {
    console.log(`[${sig}] shutting down gracefully…`);
    server.close(() => {
      console.log('server closed · bye');
      process.exit(0);
    });
    // Force-exit safeguard
    setTimeout(() => process.exit(1), 10_000).unref();
  });
});
