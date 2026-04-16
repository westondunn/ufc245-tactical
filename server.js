/**
 * UFC Tactical Dashboard — Full-stack server
 * Static frontend + SQLite API + biomechanics engine
 */
const express = require('express');
const compression = require('compression');
const path = require('path');
const db = require('./db');
const bio = require('./lib/biomechanics');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'production';

app.set('trust proxy', 1);
app.use(compression());
app.use(express.json());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
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

// Access log
app.use((req, _res, next) => {
  if (!req.path.startsWith('/api/')) { next(); return; }
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ============================================================
// API ROUTES
// ============================================================

// Fighter search (autocomplete)
app.get('/api/fighters/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  res.json(db.searchFighters(q));
});

// Fighter profile
app.get('/api/fighters/:id', (req, res) => {
  const fighter = db.getFighter(parseInt(req.params.id, 10));
  if (!fighter) return res.status(404).json({ error: 'fighter_not_found' });
  res.json(fighter);
});

// Fighter's event history (all UFC cards they appeared on)
app.get('/api/fighters/:id/events', (req, res) => {
  const events = db.getFighterEvents(parseInt(req.params.id, 10));
  // Group by event
  const grouped = {};
  for (const row of events) {
    if (!grouped[row.id]) {
      grouped[row.id] = {
        event_id: row.id,
        number: row.number,
        name: row.name,
        date: row.date,
        venue: row.venue,
        city: row.city,
        fights: []
      };
    }
    grouped[row.id].fights.push({
      fight_id: row.fight_id,
      red_name: row.red_name,
      blue_name: row.blue_name,
      red_id: row.red_id,
      blue_id: row.blue_id,
      method: row.method,
      round: row.round,
      time: row.time,
      winner_id: row.winner_id,
      is_title: row.is_title,
      is_main: row.is_main
    });
  }
  res.json(Object.values(grouped));
});

// All events
app.get('/api/events', (req, res) => {
  res.json(db.getAllEvents());
});

// Event detail + full card
app.get('/api/events/:id/card', (req, res) => {
  const eventId = parseInt(req.params.id, 10);
  const event = db.getEvent(eventId);
  if (!event) return res.status(404).json({ error: 'event_not_found' });
  const card = db.getEventCard(eventId);
  res.json({ event, card });
});

// Event by UFC number (e.g., /api/events/number/245)
app.get('/api/events/number/:num', (req, res) => {
  const event = db.getEventByNumber(parseInt(req.params.num, 10));
  if (!event) return res.status(404).json({ error: 'event_not_found' });
  const card = db.getEventCard(event.id);
  res.json({ event, card });
});

// Fight detail with stats
app.get('/api/fights/:id', (req, res) => {
  const fight = db.getFight(parseInt(req.params.id, 10));
  if (!fight) return res.status(404).json({ error: 'fight_not_found' });
  res.json(fight);
});

// Fighter career stats (aggregated)
app.get('/api/fighters/:id/career-stats', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const fighter = db.getFighter(id);
  if (!fighter) return res.status(404).json({ error: 'fighter_not_found' });
  const stats = db.getCareerStats(id);
  const record = db.getFighterRecord(id);
  res.json({ fighter, stats, record });
});

// Compare two fighters
app.get('/api/fighters/:id1/compare/:id2', (req, res) => {
  const id1 = parseInt(req.params.id1, 10);
  const id2 = parseInt(req.params.id2, 10);
  const f1 = db.getFighter(id1);
  const f2 = db.getFighter(id2);
  if (!f1 || !f2) return res.status(404).json({ error: 'fighter_not_found' });

  const stats1 = db.getCareerStats(id1);
  const stats2 = db.getCareerStats(id2);
  const record1 = db.getFighterRecord(id1);
  const record2 = db.getFighterRecord(id2);
  const h2h = db.getHeadToHead(id1, id2);

  // Generate biomechanics comparison for a right cross at each fighter's weight
  const massKg1 = Math.round(f1.height_cm * 0.42); // rough estimate from height
  const massKg2 = Math.round(f2.height_cm * 0.42);
  const bio1 = bio.estimateStrikeForce({ bodyMassKg: massKg1, strikeType: 'right_cross' });
  const bio2 = bio.estimateStrikeForce({ bodyMassKg: massKg2, strikeType: 'right_cross' });

  res.json({
    fighters: [
      { ...f1, career_stats: stats1, record: record1, biomechanics: bio1 },
      { ...f2, career_stats: stats2, record: record2, biomechanics: bio2 }
    ],
    head_to_head: h2h,
    common_weight_class: f1.weight_class === f2.weight_class ? f1.weight_class : null
  });
});

// Biomechanics calculation endpoint
app.get('/api/biomechanics/estimate', (req, res) => {
  const bodyMassKg = parseFloat(req.query.mass) || 77;
  const strikeType = req.query.strike || 'right_cross';
  const target = req.query.target || 'head';

  const estimate = bio.damageAssessment({ bodyMassKg, strikeType, target });
  if (!estimate) return res.status(400).json({ error: 'unknown_strike_type', available: Object.keys(bio.REFERENCE) });
  res.json(estimate);
});

// Kinetic chain for a strike type
app.get('/api/biomechanics/chain', (req, res) => {
  const bodyMassKg = parseFloat(req.query.mass) || 77;
  const strikeType = req.query.strike || 'right_cross';

  const chain = bio.kineticChain(strikeType, { bodyMassKg });
  if (!chain) return res.status(400).json({ error: 'unknown_strike_type' });
  res.json(chain);
});

// Available strike types
app.get('/api/biomechanics/strikes', (_req, res) => {
  res.json({
    strikes: Object.entries(bio.REFERENCE).map(([type, ref]) => ({
      type,
      reference_force_n: ref.force_n,
      reference_velocity_ms: ref.velocity_ms,
      reference_mass_kg: ref.mass_kg
    })),
    thresholds: bio.THRESHOLDS
  });
});

// ============================================================
// STATIC + HEALTH + FALLBACK
// ============================================================

app.use(express.static(path.join(__dirname, 'public'), {
  etag: true, lastModified: true, maxAge: '1d',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  }
}));

app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', service: 'ufc-tactical', uptime_s: Math.round(process.uptime()), node: process.version, env: NODE_ENV });
});

app.use((req, res) => {
  if (req.accepts('html')) return res.status(200).sendFile(path.join(__dirname, 'public', 'index.html'));
  res.status(404).json({ error: 'not_found', path: req.path });
});

// ============================================================
// START (async for db init)
// ============================================================
(async () => {
  await db.init();
  console.log('[db] SQLite initialized and seeded');

  const server = app.listen(PORT, () => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  UFC Tactical Dashboard · API + Frontend');
    console.log(`  listening on :${PORT}  ·  env=${NODE_ENV}`);
    console.log('  endpoints:');
    console.log('    GET /api/fighters/search?q=...');
    console.log('    GET /api/fighters/:id/events');
    console.log('    GET /api/events/:id/card');
    console.log('    GET /api/fights/:id');
    console.log('    GET /api/biomechanics/estimate?mass=&strike=&target=');
    console.log('    GET /api/biomechanics/chain?mass=&strike=');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  });

  ['SIGTERM', 'SIGINT'].forEach(sig => {
    process.on(sig, () => {
      console.log(`[${sig}] shutting down…`);
      server.close(() => { console.log('bye'); process.exit(0); });
      setTimeout(() => process.exit(1), 10_000).unref();
    });
  });
})();

