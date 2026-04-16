/**
 * UFC Tactical Dashboard — Full-stack server
 * Static frontend + SQLite API + biomechanics engine
 */
const express = require('express');
const compression = require('compression');
const path = require('path');
const db = require('./db');
const bio = require('./lib/biomechanics');
const ver = require('./lib/version');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'production';

app.set('trust proxy', 1);
app.use(compression());
app.use(express.json());

// Version header on all responses
app.use((req, res, next) => {
  res.setHeader('X-App-Version', ver.full);
  next();
});

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

// Error wrapper for async-safe route handlers
function apiHandler(fn) {
  return (req, res) => {
    try { fn(req, res); }
    catch (err) {
      console.error(`[API ERROR] ${req.method} ${req.path}:`, err.message);
      res.status(500).json({ error: 'internal_error', message: NODE_ENV === 'development' ? err.message : 'An error occurred' });
    }
  };
}

// Weight class → approximate mass (kg) mapping for biomechanics
const WEIGHT_CLASS_KG = {
  'Strawweight': 52, 'W-Strawweight': 52,
  'Flyweight': 57, 'W-Flyweight': 57,
  'Bantamweight': 61, 'W-Bantamweight': 61,
  'Featherweight': 66, 'W-Featherweight': 66,
  'Lightweight': 70,
  'Welterweight': 77,
  'Middleweight': 84,
  'Light Heavyweight': 93,
  'Heavyweight': 109
};
function fighterMassKg(fighter) {
  return WEIGHT_CLASS_KG[fighter.weight_class] || Math.round(fighter.height_cm * 0.42);
}

// Fighter search (autocomplete)
app.get('/api/fighters/search', apiHandler((req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  res.json(db.searchFighters(q));
}));

// Fighter profile
app.get('/api/fighters/:id', apiHandler((req, res) => {
  const fighter = db.getFighter(parseInt(req.params.id, 10));
  if (!fighter) return res.status(404).json({ error: 'fighter_not_found' });
  res.json(fighter);
}));

// Fighter's event history (all UFC cards they appeared on)
app.get('/api/fighters/:id/events', apiHandler((req, res) => {
  const events = db.getFighterEvents(parseInt(req.params.id, 10));
  const grouped = {};
  for (const row of events) {
    if (!grouped[row.id]) {
      grouped[row.id] = { event_id: row.id, number: row.number, name: row.name, date: row.date, venue: row.venue, city: row.city, fights: [] };
    }
    grouped[row.id].fights.push({
      fight_id: row.fight_id, red_name: row.red_name, blue_name: row.blue_name,
      red_id: row.red_id, blue_id: row.blue_id, method: row.method,
      round: row.round, time: row.time, winner_id: row.winner_id,
      is_title: row.is_title, is_main: row.is_main
    });
  }
  res.json(Object.values(grouped));
}));

// All events
app.get('/api/events', apiHandler((req, res) => {
  res.json(db.getAllEvents());
}));

// Event detail + full card
app.get('/api/events/:id/card', apiHandler((req, res) => {
  const eventId = parseInt(req.params.id, 10);
  if (isNaN(eventId)) return res.status(400).json({ error: 'invalid_id' });
  const event = db.getEvent(eventId);
  if (!event) return res.status(404).json({ error: 'event_not_found' });
  const card = db.getEventCard(eventId);
  res.json({ event, card });
}));

// Event by UFC number (e.g., /api/events/number/245)
app.get('/api/events/number/:num', apiHandler((req, res) => {
  const num = parseInt(req.params.num, 10);
  if (isNaN(num)) return res.status(400).json({ error: 'invalid_number' });
  const event = db.getEventByNumber(num);
  if (!event) return res.status(404).json({ error: 'event_not_found' });
  const card = db.getEventCard(event.id);
  res.json({ event, card });
}));

// Fight detail with stats
app.get('/api/fights/:id', apiHandler((req, res) => {
  const fight = db.getFight(parseInt(req.params.id, 10));
  if (!fight) return res.status(404).json({ error: 'fight_not_found' });
  res.json(fight);
}));

// Fight detail with per-round stats
app.get('/api/fights/:id/rounds', apiHandler((req, res) => {
  const fight = db.getFightWithRounds(parseInt(req.params.id, 10));
  if (!fight) return res.status(404).json({ error: 'fight_not_found' });
  res.json(fight);
}));

// Stat leaders
app.get('/api/stats/leaders', apiHandler((req, res) => {
  const stat = req.query.stat || 'sig_strikes';
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  const leaders = db.getStatLeaders(stat, limit);
  res.json({ stat, leaders });
}));

// All fighters (paginated)
app.get('/api/fighters', apiHandler((req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 500, 1000);
  res.json(db.getAllFighters(limit));
}));

// Fighter career stats (aggregated)
app.get('/api/fighters/:id/career-stats', apiHandler((req, res) => {
  const id = parseInt(req.params.id, 10);
  const fighter = db.getFighter(id);
  if (!fighter) return res.status(404).json({ error: 'fighter_not_found' });
  const stats = db.getCareerStats(id);
  const record = db.getFighterRecord(id);
  res.json({ fighter, stats, record });
}));

// Compare two fighters
app.get('/api/fighters/:id1/compare/:id2', apiHandler((req, res) => {
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

  const massKg1 = fighterMassKg(f1);
  const massKg2 = fighterMassKg(f2);
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
}));

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
  res.json({
    status: 'ok', service: 'ufc-tactical',
    version: ver.version, build: ver.full, buildTime: ver.buildTime,
    uptime_s: Math.round(process.uptime()), node: process.version, env: NODE_ENV
  });
});

// Version endpoint (consumed by frontend)
app.get('/api/version', (_req, res) => {
  res.json({ version: ver.version, build: ver.full, sha: ver.buildSha, buildTime: ver.buildTime });
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
    console.log(`  UFC Tactical Dashboard · v${ver.full}`);
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

