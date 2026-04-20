/**
 * UFC Tactical Dashboard — Full-stack server
 * Static frontend + SQLite API + biomechanics engine
 */
const express = require('express');
const compression = require('compression');
const path = require('path');
const db = require('./db');
const bio = require('./lib/biomechanics');
const tactical = require('./lib/tactical');
const ver = require('./lib/version');
const cache = require('./lib/cache');

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

// Cache-Control + ETag middleware for API GET requests
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET') return next();
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
  const origJson = res.json.bind(res);
  res.json = function (body) {
    const bodyStr = JSON.stringify(body);
    const etag = cache.computeETag(bodyStr);
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) { res.status(304).end(); return res; }
    res.setHeader('Content-Type', 'application/json');
    res.end(bodyStr);
    return res;
  };
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
  const key = 'events:all';
  let result = cache.get(key);
  if (!result) { result = cache.set(key, db.getAllEvents()); }
  res.json(result);
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

// Tactical breakdown for a single fight
app.get('/api/fights/:id/tactical', apiHandler((req, res) => {
  const fightId = parseInt(req.params.id, 10);
  const key = `tactical:fight:${fightId}`;
  let result = cache.get(key);
  if (!result) {
    const fight = db.getFight(fightId);
    if (!fight) return res.status(404).json({ error: 'fight_not_found' });
    const red = db.getFighter(fight.red_fighter_id);
    const blue = db.getFighter(fight.blue_fighter_id);
    const roundStats = db.getRoundStats(fightId);
    result = cache.set(key, tactical.analyzeFight(fight, red, blue, roundStats));
  }
  res.json(result);
}));

// Tactical breakdowns for an entire event card
app.get('/api/events/:id/tactical', apiHandler((req, res) => {
  const eventId = parseInt(req.params.id, 10);
  if (isNaN(eventId)) return res.status(400).json({ error: 'invalid_id' });
  const key = `tactical:event:${eventId}`;
  let result = cache.get(key);
  if (!result) {
    const event = db.getEvent(eventId);
    if (!event) return res.status(404).json({ error: 'event_not_found' });
    const card = db.getEventCard(eventId);
    const analyses = card.map(bout => {
      const fight = db.getFight(bout.id);
      if (!fight) return null;
      const red = db.getFighter(fight.red_fighter_id);
      const blue = db.getFighter(fight.blue_fighter_id);
      const roundStats = db.getRoundStats(bout.id);
      return tactical.analyzeFight(fight, red, blue, roundStats);
    }).filter(Boolean);
    result = cache.set(key, { event, analyses });
  }
  res.json(result);
}));

// All tactical breakdowns (bulk)
app.get('/api/tactical/all', apiHandler((req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=7200');
  const key = 'tactical:all';
  let result = cache.get(key);
  if (!result) {
    const analyses = tactical.generateAllAnalyses(db);
    result = cache.set(key, { count: analyses.length, analyses });
  }
  res.json(result);
}));

// Stat leaders
app.get('/api/stats/leaders', apiHandler((req, res) => {
  const stat = req.query.stat || 'sig_strikes';
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  const key = `leaders:${stat}:${limit}`;
  let result = cache.get(key);
  if (!result) {
    const leaders = db.getStatLeaders(stat, limit);
    result = cache.set(key, { stat, leaders });
  }
  res.json(result);
}));

// All fighters (paginated)
app.get('/api/fighters', apiHandler((req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 500, 1000);
  const key = `fighters:all:${limit}`;
  let result = cache.get(key);
  if (!result) { result = cache.set(key, db.getAllFighters(limit)); }
  res.json(result);
}));

// Fighter career stats (aggregated)
app.get('/api/fighters/:id/career-stats', apiHandler((req, res) => {
  const id = parseInt(req.params.id, 10);
  const asOf = req.query.as_of ? String(req.query.as_of).trim() : null;
  if (asOf && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return res.status(400).json({ error: 'invalid_as_of', message: 'Expected YYYY-MM-DD' });
  }
  const key = `career:${id}:${asOf || 'latest'}`;
  let result = cache.get(key);
  if (!result) {
    const fighter = db.getFighter(id);
    if (!fighter) return res.status(404).json({ error: 'fighter_not_found' });
    const stats = db.getCareerStats(id, asOf);
    const record = db.getFighterRecord(id);
    result = cache.set(key, { fighter, stats, record });
  }
  res.json(result);
}));

// Compare two fighters
app.get('/api/fighters/:id1/compare/:id2', apiHandler((req, res) => {
  const id1 = parseInt(req.params.id1, 10);
  const id2 = parseInt(req.params.id2, 10);
  const key = `compare:${id1}:${id2}`;
  let result = cache.get(key);
  if (!result) {
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

    result = cache.set(key, {
      fighters: [
        { ...f1, career_stats: stats1, record: record1, biomechanics: bio1 },
        { ...f2, career_stats: stats2, record: record2, biomechanics: bio2 }
      ],
      head_to_head: h2h,
      common_weight_class: f1.weight_class === f2.weight_class ? f1.weight_class : null
    });
  }
  res.json(result);
}));

// Biomechanics calculation endpoint
app.get('/api/biomechanics/estimate', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  const bodyMassKg = parseFloat(req.query.mass) || 77;
  const strikeType = req.query.strike || 'right_cross';
  const target = req.query.target || 'head';

  const estimate = bio.damageAssessment({ bodyMassKg, strikeType, target });
  if (!estimate) return res.status(400).json({ error: 'unknown_strike_type', available: Object.keys(bio.REFERENCE) });
  res.json(estimate);
});

// Kinetic chain for a strike type
app.get('/api/biomechanics/chain', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  const bodyMassKg = parseFloat(req.query.mass) || 77;
  const strikeType = req.query.strike || 'right_cross';

  const chain = bio.kineticChain(strikeType, { bodyMassKg });
  if (!chain) return res.status(400).json({ error: 'unknown_strike_type' });
  res.json(chain);
});

// Available strike types
app.get('/api/biomechanics/strikes', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
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
// PREDICTIONS API (communicates with prediction microservice)
// ============================================================
const PREDICTION_SERVICE_KEY = process.env.PREDICTION_SERVICE_KEY || null;

function requirePredictionKey(req, res, next) {
  if (!PREDICTION_SERVICE_KEY) return res.status(503).json({ error: 'predictions_disabled', message: 'Set PREDICTION_SERVICE_KEY env var to enable' });
  const key = req.headers['x-prediction-key'];
  if (key !== PREDICTION_SERVICE_KEY) return res.status(401).json({ error: 'unauthorized' });
  next();
}

// Public: get predictions (upcoming or by fight)
app.get('/api/predictions', apiHandler((req, res) => {
  const opts = {};
  if (req.query.fight_id) opts.fight_id = parseInt(req.query.fight_id, 10);
  if (req.query.upcoming === '1') opts.upcoming = true;
  if (req.query.from) opts.event_date_from = req.query.from;
  if (req.query.to) opts.event_date_to = req.query.to;
  if (req.query.limit) opts.limit = Math.min(parseInt(req.query.limit) || 50, 200);
  res.json(db.getPredictions(opts));
}));

// Public: prediction accuracy stats
app.get('/api/predictions/accuracy', apiHandler((_req, res) => {
  res.json(db.getPredictionAccuracy());
}));

// Protected: ingest predictions from microservice
app.post('/api/predictions/ingest', requirePredictionKey, apiHandler((req, res) => {
  const predictions = req.body.predictions;
  if (!Array.isArray(predictions)) return res.status(400).json({ error: 'predictions array required' });
  let ingested = 0;
  for (const p of predictions) {
    if (!p.fight_id || p.red_win_prob == null || p.blue_win_prob == null || !p.model_version || !p.predicted_at) continue;
    db.upsertPrediction(p);
    ingested++;
  }
  if (ingested > 0) db.save();
  res.json({ status: 'ok', ingested });
}));

// Protected: reconcile predictions with actual results
app.post('/api/predictions/reconcile', requirePredictionKey, apiHandler((req, res) => {
  const results = req.body.results;
  if (!Array.isArray(results)) return res.status(400).json({ error: 'results array required' });
  const reconciled = [];
  for (const r of results) {
    if (!r.fight_id || !r.actual_winner_id) continue;
    const result = db.reconcilePrediction(r.fight_id, r.actual_winner_id);
    if (result) reconciled.push(result);
  }
  if (reconciled.length > 0) db.save();
  res.json({ status: 'ok', reconciled: reconciled.length, results: reconciled });
}));

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
  res.setHeader('Cache-Control', 'no-cache');
  res.json({
    status: 'ok', service: 'ufc-tactical',
    version: ver.version, build: ver.full, buildTime: ver.buildTime,
    uptime_s: Math.round(process.uptime()), node: process.version, env: NODE_ENV
  });
});

// Version endpoint (consumed by frontend)
app.get('/api/version', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.json({ version: ver.version, build: ver.full, sha: ver.buildSha, buildTime: ver.buildTime });
});

// ── ADMIN ENDPOINTS (protected by ADMIN_KEY) ──
const ADMIN_KEY = process.env.ADMIN_KEY || null;
function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) return res.status(503).json({ error: 'admin_disabled', message: 'Set ADMIN_KEY env var to enable' });
  const key = req.headers['x-admin-key'] || req.query.key;
  if (key !== ADMIN_KEY) return res.status(401).json({ error: 'unauthorized' });
  next();
}

// DB statistics — shows current state, persistence info
app.get('/api/admin/db-stats', requireAdmin, (_req, res) => {
  res.json(db.getDbStats());
});

// Save — persist current DB state to disk + invalidate cache
app.post('/api/admin/save', requireAdmin, (_req, res) => {
  const ok = db.save();
  if (ok) {
    cache.invalidateAll();
    warmCache();
    console.log(`[cache] invalidated and re-warmed (${cache.size()} entries)`);
  }
  res.json({ status: ok ? 'saved' : 'not_persistent', dbPath: process.env.DB_PATH || null, cacheEntries: cache.size() });
});

app.use((req, res) => {
  if (req.accepts('html')) return res.status(200).sendFile(path.join(__dirname, 'public', 'index.html'));
  res.status(404).json({ error: 'not_found', path: req.path });
});

// ============================================================
// CACHE WARM-UP
// ============================================================
const LEADER_STATS = ['knockdowns','sig_strikes','sig_accuracy','takedowns','td_accuracy','control_time','sub_attempts','fights'];

function warmCache() {
  const t0 = Date.now();

  // Events list
  cache.set('events:all', db.getAllEvents());

  // Fighters list (default limit)
  cache.set('fighters:all:500', db.getAllFighters(500));

  // Stat leaders for all stat types at default limit
  for (const stat of LEADER_STATS) {
    const leaders = db.getStatLeaders(stat, 10);
    cache.set(`leaders:${stat}:10`, { stat, leaders });
  }

  // All tactical analyses — also populates per-fight and per-event keys
  const events = db.getAllEvents();
  const allAnalyses = [];
  for (const event of events) {
    const card = db.getEventCard(event.id);
    const eventAnalyses = [];
    for (const bout of card) {
      const fight = db.getFight(bout.id);
      if (!fight) continue;
      const red = db.getFighter(fight.red_fighter_id);
      const blue = db.getFighter(fight.blue_fighter_id);
      const roundStats = db.getRoundStats(bout.id);
      try {
        const analysis = tactical.analyzeFight(fight, red, blue, roundStats);
        cache.set(`tactical:fight:${bout.id}`, analysis);
        eventAnalyses.push(analysis);
        allAnalyses.push(analysis);
      } catch (e) { /* skip failed analyses */ }
    }
    cache.set(`tactical:event:${event.id}`, { event, analyses: eventAnalyses });
  }
  cache.set('tactical:all', { count: allAnalyses.length, analyses: allAnalyses });

  console.log(`[cache] warmed ${cache.size()} entries in ${Date.now() - t0}ms`);
}

// ============================================================
// START (async for db init)
// ============================================================
(async () => {
  await db.init();
  console.log('[db] SQLite initialized and seeded');
  warmCache();

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

