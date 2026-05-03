/**
 * UFC Tactical Dashboard — Full-stack server
 * Static frontend + SQLite API + biomechanics engine
 */

// ============================================================
// IMPORTANT: better-auth ESM-only compatibility note
// ============================================================
//
// better-auth v1.6.9+ ships its Node.js adapter (better-auth/node) as an
// ES Module (.mjs). Node.js v22 enforces strict ESM/CJS boundaries and will
// throw "ERR_REQUIRE_ESM" if you attempt to load an .mjs file via require().
//
// WHY we cannot use require():
//   require('better-auth/node')  →  ERR_REQUIRE_ESM on Node 22+
//   This crashes the server at startup and breaks every deployment.
//
// WHY we use dynamic import() instead:
//   import() is the only way to load an ESM module from a CommonJS file at
//   runtime. It returns a Promise, which is why it must live inside an async
//   function (the bootstrap IIFE at the bottom of this file).
//
// WHY the bootstrap pattern:
//   Top-level await is not available in CommonJS modules. Wrapping startup in
//   an async IIFE lets us await the dynamic import before the server begins
//   accepting connections, so toNodeHandler and fromNodeHeaders are guaranteed
//   to be resolved before any request hits the auth route.
//
// ⚠️  DO NOT convert the dynamic import back to require() — it will break
//     deployments on Node.js v22+ with a hard ERR_REQUIRE_ESM crash.
// ⚠️  DO NOT move the import() call outside the async bootstrap function —
//     top-level await is not supported in CommonJS (.js) modules.
//
// If you need to upgrade better-auth, verify whether the package has added a
// CJS build before switching back to require(). Check the package exports in
// node_modules/better-auth/package.json under the "node" condition.
// ============================================================

// These are populated by the async bootstrap below via dynamic import().
// They are intentionally declared here (module scope) so the route handlers
// defined further down can close over them once the bootstrap resolves.
let toNodeHandler, fromNodeHeaders;

const express = require('express');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('./db');
const { buildAuth } = require('./auth');
// `auth` is populated inside the async bootstrap by awaiting buildAuth().
// Middleware closures (resolveUser etc.) reference this binding directly;
// JS resolves the variable at call-time, by which time bootstrap has run.
let auth;
const bio = require('./lib/biomechanics');
const tactical = require('./lib/tactical');
const ver = require('./lib/version');
const cache = require('./lib/cache');
const { buildPredictionReview } = require('./lib/predictionReview');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'production';
const IS_PRODUCTION = NODE_ENV === 'production';

app.set('trust proxy', 1);
app.use(compression());

// The better-auth handler isn't available until the async bootstrap
// completes its dynamic import — but the route MUST be registered here
// at module-load time, BEFORE the SPA static fallback below. Otherwise
// the fallback wins (it's earlier in the middleware chain) and every
// /api/auth/* request returns index.html. We register a placeholder
// that defers to `_authNodeHandler`, which the bootstrap populates.
let _authNodeHandler = null;
app.all('/api/auth/{*any}', (req, res, next) => {
  if (!_authNodeHandler) {
    return res.status(503).json({ error: 'auth_not_ready', message: 'Server is still booting; retry shortly.' });
  }
  return _authNodeHandler(req, res, next);
});

// IMPORTANT: skip JSON body parsing for /api/auth/* — better-auth's
// toNodeHandler consumes the raw request stream itself. If express.json
// runs first, the body is exhausted before better-auth sees it, the
// auth handler returns nothing, and Express falls through to the SPA
// static fallback (every /api/auth/* request returns index.html).
// This is order-sensitive: the auth route is registered later, inside
// the async bootstrap, after toNodeHandler resolves via dynamic import.
const _jsonParser = express.json({ limit: process.env.JSON_BODY_LIMIT || '2mb' });
app.use((req, res, next) => {
  if (req.path.startsWith('/api/auth/')) return next();
  return _jsonParser(req, res, next);
});
app.use(cookieParser());

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
    "img-src 'self' data: https://ufc.com https://www.ufc.com https://*.ufc.com https://flagcdn.com; " +
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

// Error wrapper for async-safe route handlers.
// Errors thrown with `err.status` + `err.code` map to that response (used by
// ValidationError and the pick_locked error from the DB layer).
function apiHandler(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (err) {
      if (err && err.status && err.code) {
        return res.status(err.status).json({
          error: err.code,
          message: err.message,
          ...(err.reason ? { reason: err.reason } : {})
        });
      }
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
app.get('/api/fighters/search', apiHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  res.json(await db.searchFighters(q));
}));

// Fighter profile
app.get('/api/fighters/:id', apiHandler(async (req, res) => {
  const fighter = await db.getFighter(parseInt(req.params.id, 10));
  if (!fighter) return res.status(404).json({ error: 'fighter_not_found' });
  res.json(fighter);
}));

// Fighter's event history (all UFC cards they appeared on)
app.get('/api/fighters/:id/events', apiHandler(async (req, res) => {
  const events = await db.getFighterEvents(parseInt(req.params.id, 10));
  const grouped = {};
  for (const row of events) {
    if (!grouped[row.id]) {
      grouped[row.id] = { event_id: row.id, number: row.number, name: row.name, date: row.date, venue: row.venue, city: row.city, fights: [] };
    }
    grouped[row.id].fights.push({
      fight_id: row.fight_id, red_name: row.red_name, blue_name: row.blue_name,
      red_headshot_url: row.red_headshot_url, red_body_url: row.red_body_url,
      blue_headshot_url: row.blue_headshot_url, blue_body_url: row.blue_body_url,
      red_id: row.red_id, blue_id: row.blue_id, method: row.method,
      round: row.round, time: row.time, winner_id: row.winner_id,
      is_title: row.is_title, is_main: row.is_main
    });
  }
  res.json(Object.values(grouped));
}));

// All events
app.get('/api/events', apiHandler(async (req, res) => {
  // Event lifecycle state is time-sensitive; fetch fresh rows so live cards
  // fall into History as soon as their end window passes.
  res.json(await db.getAllEvents());
}));

// Event detail + full card
app.get('/api/events/:id/card', apiHandler(async (req, res) => {
  const eventId = parseInt(req.params.id, 10);
  if (isNaN(eventId)) return res.status(400).json({ error: 'invalid_id' });
  const event = await db.getEvent(eventId);
  if (!event) return res.status(404).json({ error: 'event_not_found' });
  const card = await db.getEventCard(eventId);
  res.json({ event, card });
}));

// Event by UFC number (e.g., /api/events/number/245)
app.get('/api/events/number/:num', apiHandler(async (req, res) => {
  const num = parseInt(req.params.num, 10);
  if (isNaN(num)) return res.status(400).json({ error: 'invalid_number' });
  const event = await db.getEventByNumber(num);
  if (!event) return res.status(404).json({ error: 'event_not_found' });
  const card = await db.getEventCard(event.id);
  res.json({ event, card });
}));

// Fight detail with stats
app.get('/api/fights/:id', apiHandler(async (req, res) => {
  const fight = await db.getFight(parseInt(req.params.id, 10));
  if (!fight) return res.status(404).json({ error: 'fight_not_found' });
  res.json(fight);
}));

// Fight detail with per-round stats
app.get('/api/fights/:id/rounds', apiHandler(async (req, res) => {
  const fight = await db.getFightWithRounds(parseInt(req.params.id, 10));
  if (!fight) return res.status(404).json({ error: 'fight_not_found' });
  res.json(fight);
}));

// Tactical breakdown for a single fight
app.get('/api/fights/:id/tactical', apiHandler(async (req, res) => {
  const fightId = parseInt(req.params.id, 10);
  const key = `tactical:fight:${fightId}`;
  let result = cache.get(key);
  if (!result) {
    const fight = await db.getFight(fightId);
    if (!fight) return res.status(404).json({ error: 'fight_not_found' });
    const red = await db.getFighter(fight.red_fighter_id);
    const blue = await db.getFighter(fight.blue_fighter_id);
    const roundStats = await db.getRoundStats(fightId);
    result = cache.set(key, tactical.analyzeFight(fight, red, blue, roundStats));
  }
  res.json(result);
}));

// Tactical breakdowns for an entire event card
app.get('/api/events/:id/tactical', apiHandler(async (req, res) => {
  const eventId = parseInt(req.params.id, 10);
  if (isNaN(eventId)) return res.status(400).json({ error: 'invalid_id' });
  const key = `tactical:event:${eventId}`;
  let result = cache.get(key);
  if (!result) {
    const event = await db.getEvent(eventId);
    if (!event) return res.status(404).json({ error: 'event_not_found' });
    const card = await db.getEventCard(eventId);
    const analyses = [];
    for (const bout of card) {
      const fight = await db.getFight(bout.id);
      if (!fight) continue;
      const red = await db.getFighter(fight.red_fighter_id);
      const blue = await db.getFighter(fight.blue_fighter_id);
      const roundStats = await db.getRoundStats(bout.id);
      const analysis = tactical.analyzeFight(fight, red, blue, roundStats);
      if (analysis) analyses.push(analysis);
    }
    result = cache.set(key, { event, analyses });
  }
  res.json(result);
}));

// Read-only prediction-review overlay for an event card.
// Returns event identity (with date_mismatch vs ?official_date=YYYY-MM-DD),
// per-fight matrix with trust grade + missing-data warning, model audit,
// and a live-checklist skeleton. Never mutates predictions.
app.get('/api/events/:id/prediction-review', apiHandler(async (req, res) => {
  const eventId = parseInt(req.params.id, 10);
  if (isNaN(eventId)) return res.status(400).json({ error: 'invalid_id' });
  const officialDate = typeof req.query.official_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.official_date)
    ? req.query.official_date
    : null;
  const review = await buildPredictionReview({ db, eventId, officialDate });
  if (!review) return res.status(404).json({ error: 'event_not_found' });
  res.json(review);
}));

// All tactical breakdowns (bulk)
app.get('/api/tactical/all', apiHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=7200');
  const key = 'tactical:all';
  let result = cache.get(key);
  if (!result) {
    const analyses = await tactical.generateAllAnalyses(db);
    result = cache.set(key, { count: analyses.length, analyses });
  }
  res.json(result);
}));

// Fun facts — aggregated trivia (countries, ages, physical extremes, stance, methods).
// Soft-TTL of 60 s: lib/cache.js has no built-in TTL, but direct DB writes
// from backfill scripts (nationality / DOB) don't call cache.invalidateAll(),
// so a stale entry would otherwise hang around until the next admin save or
// server restart. 60 s is short enough to feel responsive after a backfill,
// long enough to absorb a burst of polled requests.
const FUNFACTS_TTL_MS = 60 * 1000;
let _funfactsAt = 0;
app.get('/api/funfacts', apiHandler(async (_req, res) => {
  let result = cache.get('funfacts:v1');
  const ageMs = Date.now() - _funfactsAt;
  if (!result || ageMs > FUNFACTS_TTL_MS) {
    result = cache.set('funfacts:v1', await db.getFunFacts());
    _funfactsAt = Date.now();
  }
  res.json(result);
}));

// Stat leaders
app.get('/api/stats/leaders', apiHandler(async (req, res) => {
  const stat = req.query.stat || 'sig_strikes';
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  const key = `leaders:${stat}:${limit}`;
  let result = cache.get(key);
  if (!result) {
    const leaders = await db.getStatLeaders(stat, limit);
    result = cache.set(key, { stat, leaders });
  }
  res.json(result);
}));

// All fighters (paginated)
app.get('/api/fighters', apiHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 500, 1000);
  const key = `fighters:all:${limit}`;
  let result = cache.get(key);
  if (!result) { result = cache.set(key, await db.getAllFighters(limit)); }
  res.json(result);
}));

// Fighter career stats (aggregated)
app.get('/api/fighters/:id/career-stats', apiHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const asOf = req.query.as_of ? String(req.query.as_of).trim() : null;
  if (asOf && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return res.status(400).json({ error: 'invalid_as_of', message: 'Expected YYYY-MM-DD' });
  }
  const key = `career:${id}:${asOf || 'latest'}`;
  let result = cache.get(key);
  if (!result) {
    const fighter = await db.getFighter(id);
    if (!fighter) return res.status(404).json({ error: 'fighter_not_found' });
    const stats = await db.getCareerStats(id, asOf);
    const record = await db.getFighterRecord(id);
    result = cache.set(key, { fighter, stats, record });
  }
  res.json(result);
}));

// Compare two fighters
app.get('/api/fighters/:id1/compare/:id2', apiHandler(async (req, res) => {
  const id1 = parseInt(req.params.id1, 10);
  const id2 = parseInt(req.params.id2, 10);
  const key = `compare:${id1}:${id2}`;
  let result = cache.get(key);
  if (!result) {
    const f1 = await db.getFighter(id1);
    const f2 = await db.getFighter(id2);
    if (!f1 || !f2) return res.status(404).json({ error: 'fighter_not_found' });

    const stats1 = await db.getCareerStats(id1);
    const stats2 = await db.getCareerStats(id2);
    const record1 = await db.getFighterRecord(id1);
    const record2 = await db.getFighterRecord(id2);
    const h2h = await db.getHeadToHead(id1, id2);

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
app.get('/api/predictions', apiHandler(async (req, res) => {
  const opts = {};
  if (req.query.fight_id) opts.fight_id = parseInt(req.query.fight_id, 10);
  if (req.query.upcoming === '1') opts.upcoming = true;
  if (req.query.from) opts.event_date_from = req.query.from;
  if (req.query.to) opts.event_date_to = req.query.to;
  if (req.query.limit) opts.limit = Math.min(parseInt(req.query.limit) || 50, 200);
  res.json(await db.getPredictions(opts));
}));

// Public: prediction accuracy stats
app.get('/api/predictions/accuracy', apiHandler(async (req, res) => {
  const opts = {};
  if (req.query.breakdown) opts.breakdown = String(req.query.breakdown).slice(0, 32);
  res.json(await db.getPredictionAccuracy(opts));
}));

// Public: event-by-event model accuracy trend
app.get('/api/predictions/trends', apiHandler(async (req, res) => {
  const opts = {};
  if (req.query.from) opts.event_date_from = String(req.query.from).slice(0, 10);
  if (req.query.to) opts.event_date_to = String(req.query.to).slice(0, 10);
  if (req.query.limit) opts.limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
  res.json(await db.getPredictionTrends(opts));
}));

// Public: ranked model records after fights are reconciled
app.get('/api/predictions/models/leaderboard', apiHandler(async (req, res) => {
  const opts = {};
  if (req.query.from) opts.event_date_from = String(req.query.from).slice(0, 10);
  if (req.query.to) opts.event_date_to = String(req.query.to).slice(0, 10);
  if (req.query.limit) opts.limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
  res.json(await db.getModelLeaderboard(opts));
}));

// Public: recent model prediction calls compared with official fight outcomes
app.get('/api/predictions/outcomes', apiHandler(async (req, res) => {
  const opts = {};
  if (req.query.from) opts.event_date_from = String(req.query.from).slice(0, 10);
  if (req.query.to) opts.event_date_to = String(req.query.to).slice(0, 10);
  if (req.query.limit) opts.limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
  if (req.query.model_version) opts.model_version = String(req.query.model_version).slice(0, 120);
  if (req.query.event_id) opts.event_id = parseInt(req.query.event_id, 10);
  if (req.query.fight_id) opts.fight_id = parseInt(req.query.fight_id, 10);
  res.json(await db.getPredictionOutcomeDetails(opts));
}));

// Protected: ingest predictions from microservice
app.post('/api/predictions/ingest', requirePredictionKey, apiHandler(async (req, res) => {
  const predictions = req.body.predictions;
  if (!Array.isArray(predictions)) return res.status(400).json({ error: 'predictions array required' });
  let ingested = 0;
  let skippedInvalid = 0;
  let skippedLocked = 0;
  const acceptedIndices = [];
  const lockedIndices = [];
  const skipped = [];
  for (let index = 0; index < predictions.length; index++) {
    const p = predictions[index];
    if (!p.fight_id || p.red_win_prob == null || p.blue_win_prob == null || !p.model_version || !p.predicted_at) {
      skippedInvalid++;
      continue;
    }
    if (p.enrichment_level && !['lr', 'ensemble'].includes(p.enrichment_level)) {
      skippedInvalid++;
      continue;
    }
    const lock = await db.getPredictionLockState(p);
    if (lock && lock.locked) {
      skippedLocked++;
      lockedIndices.push(index);
      skipped.push({
        index,
        fight_id: p.fight_id,
        reason: lock.reason || 'locked',
        event_date: lock.event_date || p.event_date || null
      });
      continue;
    }
    await db.upsertPrediction(p);
    acceptedIndices.push(index);
    ingested++;
  }
  if (ingested > 0) await db.save();
  res.json({
    status: 'ok',
    ingested,
    skipped_invalid: skippedInvalid,
    skipped_locked: skippedLocked,
    skipped,
    accepted_indices: acceptedIndices,
    locked_indices: lockedIndices
  });
}));

// Protected: reconcile predictions with actual results
app.post('/api/predictions/reconcile', requirePredictionKey, apiHandler(async (req, res) => {
  const results = req.body.results;
  if (!Array.isArray(results)) return res.status(400).json({ error: 'results array required' });
  const reconciled = [];
  let officialCaptured = 0;
  let reconciledPredictions = 0;
  for (const r of results) {
    if (!r.fight_id || !r.actual_winner_id) continue;
    const official = await db.upsertOfficialOutcome({
      fight_id: r.fight_id,
      winner_id: r.actual_winner_id,
      method: r.method,
      method_detail: r.method_detail,
      round: r.round,
      time: r.time,
      status: r.status || 'official',
      source: r.source || 'prediction_reconcile',
      source_url: r.source_url,
      captured_at: r.captured_at,
      raw: r
    });
    if (official) officialCaptured++;
    const result = await db.reconcilePrediction(r.fight_id, r.actual_winner_id);
    if (result) {
      reconciled.push(result);
      reconciledPredictions += result.reconciled_count || 1;
    }
  }
  if (reconciled.length > 0 || officialCaptured > 0) {
    await db.save();
    if (officialCaptured > 0) cache.invalidateAll();
  }
  res.json({ status: 'ok', reconciled: reconciledPredictions, fights: reconciled.length, official_captured: officialCaptured, results: reconciled });
}));

// Protected: remove passed/concluded fights from active prediction reads.
// Rows are marked stale instead of physically deleted so historical pick
// snapshots and audit trails keep their model reference.
app.post('/api/predictions/prune', requirePredictionKey, apiHandler(async (req, res) => {
  const before = typeof req.body.before === 'string' ? req.body.before.slice(0, 10) : undefined;
  const include_concluded = req.body.include_concluded !== false;
  const result = await db.prunePastPredictions({ before, include_concluded });
  if (result.pruned > 0) await db.save();
  res.json({ status: 'ok', ...result, include_concluded });
}));

// Public read: latest official/in-progress outcome snapshots captured by jobs
app.get('/api/events/:id/official-outcomes', apiHandler(async (req, res) => {
  const eventId = parseInt(req.params.id, 10);
  if (!Number.isFinite(eventId)) return res.status(400).json({ error: 'invalid_event_id' });
  const event = await db.getEvent(eventId);
  if (!event) return res.status(404).json({ error: 'event_not_found' });
  res.json({ event_id: eventId, outcomes: await db.getOfficialOutcomesForEvent(eventId) });
}));

// Protected write: prediction/official-data jobs can snapshot live or final outcomes.
// Final snapshots also update fights.winner_id/method/round/time, which lets the
// existing reconciliation jobs score model predictions and user picks.
app.post('/api/events/:id/official-outcomes', requirePredictionKey, apiHandler(async (req, res) => {
  const eventId = parseInt(req.params.id, 10);
  if (!Number.isFinite(eventId)) return res.status(400).json({ error: 'invalid_event_id' });
  const event = await db.getEvent(eventId);
  if (!event) return res.status(404).json({ error: 'event_not_found' });
  const outcomes = Array.isArray(req.body.outcomes) ? req.body.outcomes : null;
  if (!outcomes) return res.status(400).json({ error: 'outcomes array required' });

  const fightIds = new Set((await db.getEventCard(eventId)).map(f => Number(f.id)));
  const saved = [];
  const errors = [];
  for (const outcome of outcomes) {
    const fightId = parseInt(outcome && outcome.fight_id, 10);
    if (!Number.isFinite(fightId) || !fightIds.has(fightId)) {
      errors.push({ fight_id: outcome && outcome.fight_id, error: 'fight_not_in_event' });
      continue;
    }
    try {
      const savedOutcome = await db.upsertOfficialOutcome({
        ...outcome,
        source: outcome.source || 'official_outcome_job'
      });
      if (savedOutcome) saved.push(savedOutcome);
    } catch (err) {
      errors.push({ fight_id: fightId, error: err.code || err.message || 'outcome_failed' });
    }
  }

  if (saved.length) {
    await db.save();
    cache.invalidateAll();
  }
  let picks = null;
  if (req.body.reconcile_picks === true && saved.length) {
    picks = await db.reconcilePicksForEvent(eventId);
    await db.save();
  }
  res.json({ status: errors.length ? 'partial' : 'ok', event_id: eventId, captured: saved.length, outcomes: saved, errors, picks });
}));

// ============================================================
// DATA AUDIT API (internal, key-protected)
// ============================================================
const auditApi = require('./data/audit/api');
const { runAudit: runAuditJob } = require('./data/audit/runner');

app.get('/api/data/coverage', requirePredictionKey, apiHandler(async (req, res) => {
  if (req.query.diff === 'last2') {
    return res.json(await auditApi.getDiffLast2());
  }
  if (req.query.table && req.query.column) {
    return res.json(await auditApi.getColumnHistory({
      table: String(req.query.table).slice(0, 64),
      column: String(req.query.column).slice(0, 64),
      scope: req.query.scope ? String(req.query.scope).slice(0, 64) : null,
      limit: req.query.limit,
    }));
  }
  let runId = req.query.run && req.query.run !== 'latest' ? String(req.query.run).slice(0, 64) : null;
  if (!runId) runId = await auditApi.getLatestCompleteRunId();
  if (!runId) return res.json({ run_id: null, snapshots: [] });
  res.json({ run_id: runId, snapshots: await auditApi.getCoverageForRun(runId) });
}));

app.post('/api/data/audit/run', requirePredictionKey, apiHandler(async (req, res) => {
  const scope = req.body && req.body.scope ? String(req.body.scope).slice(0, 64) : null;
  const result = await runAuditJob({ scope, triggerSource: 'http' });
  res.json(result);
}));

const backfillApi = require('./data/backfill/api');
const { runBackfill: runBackfillJob } = require('./data/backfill/dispatcher');

app.post('/api/data/backfill/run', requirePredictionKey, apiHandler(async (req, res) => {
  const runId = req.body && req.body.runId ? String(req.body.runId).slice(0, 64) : null;
  const dryRun = !!(req.body && req.body.dryRun);
  if (!runId) return res.status(400).json({ error: 'runId required' });
  const result = await runBackfillJob({ runId, dryRun });
  res.json(result);
}));

app.get('/api/data/backfill/queue', requirePredictionKey, apiHandler(async (req, res) => {
  const status = req.query.status ? String(req.query.status).slice(0, 32) : 'pending';
  const limit = parseInt(req.query.limit || '50', 10);
  const offset = parseInt(req.query.offset || '0', 10);
  res.json(await backfillApi.listQueue({ status, limit, offset }));
}));

// ============================================================
// USER PICKS API (additive, flag-gated via ENABLE_PICKS)
// ============================================================
const validate = require('./lib/validate');
const rateLimit = require('./lib/rate-limit');
const ENABLE_PICKS = /^(1|true|yes|on)$/i.test(String(process.env.ENABLE_PICKS || ''));
const CREATE_USER_PER_HOUR = Math.max(1, parseInt(process.env.PICKS_RATE_LIMIT_CREATE_USER || '5', 10) || 5);
const PICK_WRITES_PER_MIN = Math.max(1, parseInt(process.env.PICKS_RATE_LIMIT_PER_MIN || '60', 10) || 60);
// Transition flag: while flipped on, requireUser still accepts the legacy
// `x-user-id` header so the existing frontend keeps working before the auth UI
// ships. Remove in Phase 10 once the frontend is fully cookie-based.
const LEGACY_HEADER_AUTH = /^(1|true|yes|on)$/i.test(String(process.env.LEGACY_HEADER_AUTH || '1'));

function requirePicksFlag(_req, res, next) {
  if (!ENABLE_PICKS) return res.status(503).json({ error: 'picks_disabled', message: 'Set ENABLE_PICKS=true to enable' });
  next();
}

/**
 * Resolve the authenticated user from (a) a better-auth session cookie, or
 * (b) when LEGACY_HEADER_AUTH=1, the x-user-id header. Used as a primitive by
 * requireUser/optionalAuth.
 *
 * Returns the user row or null. Never throws.
 */
async function resolveUser(req) {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (session && session.user) return session.user;
  } catch (_) { /* fall through to legacy */ }
  if (LEGACY_HEADER_AUTH) {
    const userId = req.headers['x-user-id'];
    if (userId) return db.getUser(userId);
  }
  return null;
}

async function requireUser(req, res, next) {
  try {
    const user = await resolveUser(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

async function optionalAuth(req, _res, next) {
  try {
    req.user = await resolveUser(req);
    next();
  } catch (err) {
    next(err);
  }
}

// Create profile (rate-limited per IP; override via PICKS_RATE_LIMIT_CREATE_USER)
app.post('/api/users', requirePicksFlag, apiHandler(async (req, res) => {
  const ip = req.ip || '0.0.0.0';
  if (!rateLimit.consume('createUser:' + ip, CREATE_USER_PER_HOUR, 60 * 60 * 1000)) {
    return res.status(429).json({ error: 'rate_limited', message: 'Too many profiles created from this IP' });
  }
  const input = validate.validateUserInput(req.body);
  const user = await db.createUser(input);
  await db.save();
  res.json({ user });
}));

// Lightweight count for the claim prompt — checks both `users` and `users_legacy`
// so a pre-migration guest id can be looked up. Returns { exists, count }.
// Public (unauthenticated) — knowing the id was already the auth token in the
// guest-only era, so leaking the count is consistent with that model.
app.get('/api/picks/guest-count/:guestId', requirePicksFlag, apiHandler(async (req, res) => {
  const id = req.params.guestId;
  const inUsers = await db.getUser(id);
  const inLegacy = inUsers ? null : await db.oneRow('SELECT id FROM users_legacy WHERE id = ?', [id]);
  const exists = !!(inUsers || inLegacy);
  if (!exists) return res.json({ exists: false, count: 0 });
  const row = await db.oneRow('SELECT COUNT(*) AS c FROM user_picks WHERE user_id = ?', [id]);
  res.json({ exists: true, count: row ? Number(row.c) : 0 });
}));

// Claim a legacy guest profile under the current authenticated account.
// Body: { guestId }. Atomically rewrites user_picks ownership and marks the
// legacy row as claimed. Returns claimed_picks count + any backfilled fields.
// (Lives under /api/picks/* rather than /api/auth/* — the auth wildcard mount
// catches everything under /api/auth/.)
app.post('/api/picks/claim-guest', requirePicksFlag, requireUser, apiHandler(async (req, res) => {
  const guestId = String(req.body && req.body.guestId || '').trim();
  if (!guestId) return res.status(400).json({ error: 'missing_guest_id' });
  if (guestId === req.user.id) return res.status(400).json({ error: 'self_claim' });
  const result = await db.claimGuestProfile(guestId, req.user.id);
  await db.save();
  res.json({ ok: true, ...result });
}));

// Fetch profile (public — used to resume sessions)
app.get('/api/users/:id', requirePicksFlag, apiHandler(async (req, res) => {
  const user = await db.getUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'user_not_found' });
  res.json({ user });
}));

// Update own profile (self only)
app.patch('/api/users/:id', requirePicksFlag, requireUser, apiHandler(async (req, res) => {
  if (req.params.id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  const patch = {};
  if (req.body.display_name !== undefined) patch.display_name = validate.validateDisplayName(req.body.display_name);
  if (req.body.avatar_key !== undefined)   patch.avatar_key   = validate.validateAvatarKey(req.body.avatar_key);
  const user = await db.updateUser(req.params.id, patch);
  await db.save();
  res.json({ user });
}));

// Get user's picks (optionally filtered by event or reconciled state)
app.get('/api/users/:id/picks', requirePicksFlag, apiHandler(async (req, res) => {
  const user = await db.getUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'user_not_found' });
  const opts = {};
  if (req.query.event_id) opts.event_id = parseInt(req.query.event_id, 10);
  if (req.query.reconciled === '1') opts.reconciled = true;
  if (req.query.reconciled === '0') opts.reconciled = false;
  res.json({ picks: await db.getPicksForUser(req.params.id, opts) });
}));

// User accuracy + vs-model aggregate stats
app.get('/api/users/:id/stats', requirePicksFlag, apiHandler(async (req, res) => {
  const user = await db.getUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'user_not_found' });
  res.json({
    user: { id: user.id, display_name: user.display_name, avatar_key: user.avatar_key },
    stats: await db.getUserStats(req.params.id)
  });
}));

// Self-only event-by-event user trend vs model trend
app.get('/api/users/:id/trends', requirePicksFlag, requireUser, apiHandler(async (req, res) => {
  if (req.params.id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  const user = await db.getUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'user_not_found' });
  const opts = {};
  if (req.query.from) opts.event_date_from = String(req.query.from).slice(0, 10);
  if (req.query.to) opts.event_date_to = String(req.query.to).slice(0, 10);
  if (req.query.limit) opts.limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({
    user: { id: user.id, display_name: user.display_name, avatar_key: user.avatar_key },
    ...(await db.getUserTrends(req.params.id, opts))
  });
}));

// Submit / update a pick (UPSERT on user+fight; 409 if locked)
app.post('/api/picks', requirePicksFlag, requireUser, apiHandler(async (req, res) => {
  if (!rateLimit.consume('picks:' + req.user.id, PICK_WRITES_PER_MIN, 60 * 1000)) {
    return res.status(429).json({ error: 'rate_limited' });
  }
  const input = validate.validatePickInput(req.body);
  const result = await db.upsertPick({ ...input, user_id: req.user.id });
  if (!result) return res.status(400).json({ error: 'upsert_failed' });
  await db.save();
  res.json(result);
}));

// Delete own pick (409 if locked)
app.delete('/api/picks/:pickId', requirePicksFlag, requireUser, apiHandler(async (req, res) => {
  const pickId = parseInt(req.params.pickId, 10);
  if (!Number.isFinite(pickId)) return res.status(400).json({ error: 'invalid_pick_id' });
  const result = await db.deletePick(req.user.id, pickId);
  if (!result.deleted) {
    const status = result.reason === 'not_found' ? 404 : 409;
    return res.status(status).json({ error: result.reason });
  }
  await db.save();
  res.json({ deleted: true });
}));

// All-time leaderboard
app.get('/api/leaderboard', requirePicksFlag, apiHandler(async (req, res) => {
  const limit = req.query.limit ? Math.min(parseInt(req.query.limit, 10) || 50, 500) : 50;
  // Default top-50 is precomputed every 5 min by the cron task — serve from cache.
  if (limit === 50 && cache.has('leaderboard:all:50')) {
    return res.json(cache.get('leaderboard:all:50'));
  }
  res.json({ leaderboard: await db.getLeaderboard({ limit }) });
}));

// Event-scoped leaderboard
app.get('/api/events/:id/picks/leaderboard', requirePicksFlag, apiHandler(async (req, res) => {
  const eventId = parseInt(req.params.id, 10);
  if (!Number.isFinite(eventId)) return res.status(400).json({ error: 'invalid_event_id' });
  const limit = req.query.limit ? Math.min(parseInt(req.query.limit, 10) || 50, 500) : 50;
  res.json({ leaderboard: await db.getLeaderboard({ event_id: eventId, limit }) });
}));

// Per-fight user-pick-distribution vs model
app.get('/api/events/:id/picks/model-comparison', requirePicksFlag, apiHandler(async (req, res) => {
  const eventId = parseInt(req.params.id, 10);
  if (!Number.isFinite(eventId)) return res.status(400).json({ error: 'invalid_event_id' });
  res.json({ event_id: eventId, fights: await db.getEventPickComparison(eventId) });
}));

// ============================================================
// STATIC + HEALTH + FALLBACK
// ============================================================

app.use((req, res, next) => {
  if (
    req.path === '/admin' ||
    req.path === '/admin.html' ||
    req.path === '/js/admin.js' ||
    req.path === '/css/admin.css'
  ) {
    return requireLocalAdminPortal(req, res, next);
  }
  next();
});

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
    uptime_s: Math.round(process.uptime()), node: process.version, env: NODE_ENV,
    features: { picks: ENABLE_PICKS }
  });
});

// Version endpoint (consumed by frontend)
app.get('/api/version', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.json({
    version: ver.version, build: ver.full, sha: ver.buildSha, buildTime: ver.buildTime,
    features: { picks: ENABLE_PICKS }
  });
});

// ── ADMIN ENDPOINTS (protected by ADMIN_KEY) ──
const ADMIN_KEY = process.env.ADMIN_KEY || null;
const ENABLE_LOCAL_ADMIN = /^(1|true|yes|on)$/i.test(String(process.env.ENABLE_LOCAL_ADMIN || ''));
const ALLOW_PROD_ADMIN = /^(1|true|yes|on)$/i.test(String(process.env.ALLOW_PROD_ADMIN || ''));
const ADMIN_AUTH_WINDOW_MS = 5 * 60 * 1000;
const ADMIN_AUTH_MAX_FAILURES = 20;
const adminAuthFailures = new Map();

function isLocalRequest(req) {
  const candidates = [
    req.ip,
    req.socket && req.socket.remoteAddress,
    req.connection && req.connection.remoteAddress,
  ].filter(Boolean).map(v => String(v).replace(/^::ffff:/, ''));
  return candidates.some(ip => (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === 'localhost' ||
    ip === '0.0.0.0'
  ));
}
function isLocalAdminEnabled() {
  if (!ENABLE_LOCAL_ADMIN) return false;
  if (IS_PRODUCTION && !ALLOW_PROD_ADMIN) return false;
  return true;
}
function requireLocalAdminPortal(req, res, next) {
  if (!isLocalAdminEnabled()) {
    return res.status(404).json({ error: 'not_found' });
  }
  if (!isLocalRequest(req)) {
    return res.status(403).json({ error: 'local_only', message: 'The admin portal is only available from localhost.' });
  }
  next();
}
function timingSafeAdminKey(input) {
  if (!ADMIN_KEY || typeof input !== 'string') return false;
  const expected = Buffer.from(ADMIN_KEY);
  const actual = Buffer.from(input);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}
function adminRateKey(req) {
  return String(req.ip || (req.socket && req.socket.remoteAddress) || 'unknown').replace(/^::ffff:/, '');
}
function tooManyAdminFailures(req) {
  const key = adminRateKey(req);
  const now = Date.now();
  const rec = adminAuthFailures.get(key);
  if (!rec || now - rec.firstAt > ADMIN_AUTH_WINDOW_MS) {
    adminAuthFailures.delete(key);
    return false;
  }
  return rec.count >= ADMIN_AUTH_MAX_FAILURES;
}
function recordAdminFailure(req) {
  const key = adminRateKey(req);
  const now = Date.now();
  const rec = adminAuthFailures.get(key);
  if (!rec || now - rec.firstAt > ADMIN_AUTH_WINDOW_MS) {
    adminAuthFailures.set(key, { firstAt: now, count: 1 });
  } else {
    rec.count += 1;
  }
}
function clearAdminFailures(req) {
  adminAuthFailures.delete(adminRateKey(req));
}
function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) return res.status(503).json({ error: 'admin_disabled', message: 'Set ADMIN_KEY env var to enable' });
  if (tooManyAdminFailures(req)) return res.status(429).json({ error: 'too_many_attempts' });
  const key = req.headers['x-admin-key'];
  if (!timingSafeAdminKey(typeof key === 'string' ? key : '')) {
    recordAdminFailure(req);
    return res.status(401).json({ error: 'unauthorized' });
  }
  clearAdminFailures(req);
  next();
}

function requireAdminSameOrigin(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const host = req.headers.host;
  if (!host) return res.status(403).json({ error: 'origin_required' });
  const allowed = new Set([`http://${host}`, `https://${host}`]);
  if (origin && !allowed.has(origin)) return res.status(403).json({ error: 'bad_origin' });
  if (!origin && referer) {
    let refOrigin = null;
    try { refOrigin = new URL(referer).origin; } catch {}
    if (!allowed.has(refOrigin)) return res.status(403).json({ error: 'bad_origin' });
  }
  next();
}

function adminActor(req) {
  return req.headers['x-admin-actor'] ? String(req.headers['x-admin-actor']).slice(0, 80) : 'local-admin';
}

app.use('/api/admin', requireAdminSameOrigin);

async function persistAdminMutation({ warm = true } = {}) {
  const ok = await db.save();
  cache.invalidateAll();
  if (warm) await warmCache();
  return ok;
}

app.get('/admin', requireLocalAdminPortal, (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

const adminIssues = require('./data/admin/issues');
const adminRegistry = require('./data/admin/registry');
const adminActions = require('./data/admin/actions');
const backfillReview = require('./data/backfill/review');

app.get('/api/admin/data/overview', requireLocalAdminPortal, requireAdmin, apiHandler(async (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.json({
    ...(await adminIssues.getOverview()),
    editable: adminRegistry.editableTables(),
  });
}));

app.get('/api/admin/data/issues', requireLocalAdminPortal, requireAdmin, apiHandler(async (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.json(await adminIssues.getIssues());
}));

app.get('/api/admin/data/audit-runs', requireLocalAdminPortal, requireAdmin, apiHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.json(await adminIssues.getAuditRuns({ limit: req.query.limit }));
}));

app.post('/api/admin/data/audit/run', requireLocalAdminPortal, requireAdmin, apiHandler(async (req, res) => {
  const scope = req.body && req.body.scope ? String(req.body.scope).slice(0, 64) : null;
  const result = await runAuditJob({ scope, triggerSource: 'admin-portal' });
  await adminActions.logAction({
    action: 'audit_run',
    status: result.status,
    reason: scope ? `scope=${scope}` : null,
    metadata: { run_id: result.run_id, entries: result.summary.length, errors: result.errors.length },
    actor: adminActor(req),
    ip: req.ip,
  });
  res.json(result);
}));

app.post('/api/admin/data/backfill/run', requireLocalAdminPortal, requireAdmin, apiHandler(async (req, res) => {
  let runId = req.body && req.body.runId ? String(req.body.runId).slice(0, 64) : null;
  if (!runId) runId = await auditApi.getLatestCompleteRunId();
  if (!runId) return res.status(400).json({ error: 'runId required' });
  const dryRun = !!(req.body && req.body.dryRun);
  const result = await runBackfillJob({ runId, dryRun });
  await adminActions.logAction({
    action: dryRun ? 'backfill_dry_run' : 'backfill_run',
    status: result.errors && result.errors.length ? 'partial' : 'ok',
    metadata: { run_id: runId, ...result },
    actor: adminActor(req),
    ip: req.ip,
  });
  if (!dryRun) await persistAdminMutation({ warm: true });
  res.json(result);
}));

app.get('/api/admin/data/backfill/queue', requireLocalAdminPortal, requireAdmin, apiHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  const status = req.query.status ? String(req.query.status).slice(0, 32) : 'pending';
  const limit = parseInt(req.query.limit || '100', 10);
  const offset = parseInt(req.query.offset || '0', 10);
  res.json(await backfillApi.listQueue({ status, limit, offset }));
}));

app.post('/api/admin/data/backfill/:id/approve', requireLocalAdminPortal, requireAdmin, apiHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' });
  const result = await backfillReview.approveBackfill(id, {
    reason: req.body && req.body.reason ? String(req.body.reason).slice(0, 500) : null,
    actor: adminActor(req),
    ip: req.ip,
  });
  await persistAdminMutation({ warm: true });
  res.json(result);
}));

app.post('/api/admin/data/backfill/:id/reject', requireLocalAdminPortal, requireAdmin, apiHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' });
  const result = await backfillReview.rejectBackfill(id, {
    reason: req.body && req.body.reason ? String(req.body.reason).slice(0, 500) : null,
    actor: adminActor(req),
    ip: req.ip,
  });
  await persistAdminMutation({ warm: false });
  res.json(result);
}));

app.get('/api/admin/data/entity', requireLocalAdminPortal, requireAdmin, apiHandler(async (req, res) => {
  const table = String(req.query.table || '');
  const id = String(req.query.id || '');
  const row = await adminRegistry.getEntity(table, id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.setHeader('Cache-Control', 'no-cache');
  res.json({ table, id, row, editable: adminRegistry.editableTables()[table] });
}));

app.patch('/api/admin/data/entity', requireLocalAdminPortal, requireAdmin, apiHandler(async (req, res) => {
  const body = req.body || {};
  const result = await adminRegistry.updateEntity({
    table: String(body.table || ''),
    id: String(body.id || ''),
    changes: body.changes,
    reason: body.reason,
    actor: adminActor(req),
    ip: req.ip,
  });
  await persistAdminMutation({ warm: true });
  res.json({ status: 'ok', ...result });
}));

app.get('/api/admin/data/actions', requireLocalAdminPortal, requireAdmin, apiHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.json(await adminActions.listActions({ limit: req.query.limit, offset: req.query.offset }));
}));

// DB statistics — shows current state, persistence info
app.get('/api/admin/db-stats', requireAdmin, apiHandler(async (_req, res) => {
  res.json(await db.getDbStats());
}));

// Save — persist current DB state to disk + invalidate cache
app.post('/api/admin/save', requireAdmin, apiHandler(async (_req, res) => {
  const ok = await db.save();
  if (ok) {
    cache.invalidateAll();
    await warmCache();
    console.log(`[cache] invalidated and re-warmed (${cache.size()} entries)`);
  }
  res.json({ status: ok ? 'saved' : 'not_persistent', dbPath: process.env.DB_PATH || process.env.DATABASE_URL || null, cacheEntries: cache.size() });
}));

// Lock all picks for an event (admin). Picks written after lock return 409.
app.post('/api/admin/events/:id/lock-picks', requireAdmin, apiHandler(async (req, res) => {
  const eventId = parseInt(req.params.id, 10);
  if (!Number.isFinite(eventId)) return res.status(400).json({ error: 'invalid_event_id' });
  const result = await db.lockPicksForEvent(eventId);
  await db.save();
  console.log(`[admin] lock-picks event=${eventId} locked=${result.locked}`);
  res.json({ status: 'ok', event_id: eventId, ...result });
}));

// Reconcile all picks for an event (admin). Idempotent — re-running produces
// identical point totals. Requires fights.winner_id to be populated.
app.post('/api/admin/events/:id/reconcile-picks', requireAdmin, apiHandler(async (req, res) => {
  const eventId = parseInt(req.params.id, 10);
  if (!Number.isFinite(eventId)) return res.status(400).json({ error: 'invalid_event_id' });
  const result = await db.reconcilePicksForEvent(eventId);
  await db.save();
  console.log(`[admin] reconcile-picks event=${eventId} reconciled=${result.reconciled} points=${result.points_awarded}`);
  res.json({ status: 'ok', event_id: eventId, ...result });
}));

// Backfill: reconcile every event that has picks. Idempotent. Useful after a
// scoring formula change or late winner_id ingest.
app.post('/api/admin/reconcile-all-picks', requireAdmin, apiHandler(async (_req, res) => {
  const result = await db.reconcileAllPicks();
  await db.save();
  console.log(`[admin] reconcile-all-picks events=${result.events_processed} reconciled=${result.reconciled} points=${result.points_awarded}`);
  res.json({ status: 'ok', ...result });
}));

// Import new rows from data/seed.json without clobbering existing data.
// Idempotent: rows whose id doesn't already exist are inserted, and existing
// event rows get non-null seed date/timing metadata refreshed. Used after
// data/scrape-upcoming.js updates seed.json with new upcoming events — call
// this endpoint on the live app to sync the additions into the DB.
app.post('/api/admin/import-seed', requireAdmin, apiHandler(async (_req, res) => {
  const seedPath = path.join(__dirname, 'data', 'seed.json');
  if (!fs.existsSync(seedPath)) return res.status(404).json({ error: 'seed_not_found' });
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  const added = { fighters: 0, events: 0, fights: 0 };
  const updated = { fighters: 0, events: 0, fight_outcomes: 0 };
  for (const f of (seed.fighters || [])) {
    const existing = await db.oneRow('SELECT id FROM fighters WHERE id = ?', [f.id]);
    await db.upsertFighter(f);
    if (!existing) added.fighters++;
    else updated.fighters++;
  }
  for (const e of (seed.events || [])) {
    const existing = await db.oneRow('SELECT * FROM events WHERE id = ?', [e.id]);
    if (!existing) {
      await db.upsertEvent(e);
      added.events++;
    } else {
      const changed = ['date', 'start_time', 'end_time', 'timezone', 'venue', 'city', 'country'].some(key => {
        const value = e[key];
        return value != null && value !== '' && String(existing[key] || '') !== String(value);
      });
      if (changed) {
        await db.run(
          `UPDATE events SET
             date       = COALESCE(?, date),
             start_time = COALESCE(?, start_time),
             end_time   = COALESCE(?, end_time),
             timezone   = COALESCE(?, timezone),
             venue      = COALESCE(?, venue),
             city       = COALESCE(?, city),
             country    = COALESCE(?, country)
           WHERE id = ?`,
          [e.date || null, e.start_time || null, e.end_time || null, e.timezone || null,
           e.venue || null, e.city || null, e.country || null, e.id]
        );
        updated.events++;
      }
    }
  }
  for (const f of (seed.fights || [])) {
    const existing = await db.oneRow('SELECT id FROM fights WHERE id = ?', [f.id]);
    if (!existing) {
      await db.upsertFight(f);
      added.fights++;
    } else if (f.winner_id || f.method || f.round || f.time) {
      const outcome = await db.upsertOfficialOutcome({
        fight_id: f.id,
        winner_id: f.winner_id || null,
        method: f.method || null,
        method_detail: f.method_detail || null,
        round: f.round || null,
        time: f.time || null,
        status: f.winner_id ? 'official' : undefined,
        source: 'seed_import',
        raw: f
      });
      if (outcome) updated.fight_outcomes++;
    }
  }
  await db.save();
  cache.invalidateAll();
  console.log(`[admin] import-seed added fighters=${added.fighters} events=${added.events} fights=${added.fights} updated_fighters=${updated.fighters} updated_events=${updated.events} fight_outcomes=${updated.fight_outcomes}`);
  res.json({ status: 'ok', added, updated, cacheEntries: cache.size() });
}));

app.use((req, res) => {
  if (req.accepts('html')) return res.status(200).sendFile(path.join(__dirname, 'public', 'index.html'));
  res.status(404).json({ error: 'not_found', path: req.path });
});

// ============================================================
// CACHE WARM-UP
// ============================================================
const LEADER_STATS = ['knockdowns','sig_strikes','sig_accuracy','takedowns','td_accuracy','control_time','sub_attempts','fights'];

async function warmCache() {
  const t0 = Date.now();

  // Fighters list (default limit)
  cache.set('fighters:all:500', await db.getAllFighters(500));

  // Stat leaders for all stat types at default limit
  for (const stat of LEADER_STATS) {
    const leaders = await db.getStatLeaders(stat, 10);
    cache.set(`leaders:${stat}:10`, { stat, leaders });
  }

  // All tactical analyses — also populates per-fight and per-event keys
  const events = await db.getAllEvents();
  const allAnalyses = [];
  for (const event of events) {
    const card = await db.getEventCard(event.id);
    const eventAnalyses = [];
    for (const bout of card) {
      const fight = await db.getFight(bout.id);
      if (!fight) continue;
      const red = await db.getFighter(fight.red_fighter_id);
      const blue = await db.getFighter(fight.blue_fighter_id);
      const roundStats = await db.getRoundStats(bout.id);
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
// CRON TASKS — light periodic jobs run inline (no separate service)
// ============================================================

const LOGIN_CLEANUP_MS = 24 * 60 * 60 * 1000;   // daily
const LEADERBOARD_REFRESH_MS = 5 * 60 * 1000;   // every 5 min
const LOGIN_ATTEMPT_TTL_MS = 24 * 60 * 60 * 1000; // keep last 24h of attempts

async function cleanupLoginAttempts() {
  const cutoff = new Date(Date.now() - LOGIN_ATTEMPT_TTL_MS).toISOString();
  try {
    await db.run('DELETE FROM auth_login_attempts WHERE attempted_at < ?', [cutoff]);
  } catch (e) { console.error('[cron] login cleanup failed:', e.message); }
}

async function refreshLeaderboardCache() {
  try {
    const leaderboard = await db.getLeaderboard({ limit: 50 });
    cache.set('leaderboard:all:50', { leaderboard });
  } catch (e) { console.error('[cron] leaderboard refresh failed:', e.message); }
}

function startCronTasks() {
  // Run once at boot, then on interval. .unref() so SIGTERM can exit.
  cleanupLoginAttempts();
  setInterval(cleanupLoginAttempts, LOGIN_CLEANUP_MS).unref();
  refreshLeaderboardCache();
  setInterval(refreshLeaderboardCache, LEADERBOARD_REFRESH_MS).unref();
  console.log(`[cron] started: login-cleanup=${LOGIN_CLEANUP_MS/3600000}h, leaderboard-refresh=${LEADERBOARD_REFRESH_MS/60000}min`);
}

// ============================================================
// START (async for db init)
// ============================================================
async function bootstrap() {
  // ── Load better-auth/node via dynamic import ──────────────────────────────
  // See the comment block at the top of this file for the full explanation.
  // Short version: better-auth/node is ESM-only (.mjs); require() throws
  // ERR_REQUIRE_ESM on Node 22+. Dynamic import() is the correct solution.
  //
  // Runtime safeguard: if the import fails or returns unexpected exports, we
  // crash immediately with a clear message rather than silently serving broken
  // auth routes.
  try {
    const betterAuthNode = await import('better-auth/node');
    toNodeHandler = betterAuthNode.toNodeHandler;
    fromNodeHeaders = betterAuthNode.fromNodeHeaders;

    if (typeof toNodeHandler !== 'function') {
      throw new TypeError(
        `better-auth/node did not export 'toNodeHandler' as a function. ` +
        `Got: ${typeof toNodeHandler}. ` +
        `Check that better-auth is installed correctly (npm install) and that ` +
        `the package version (${require('./package.json').dependencies['better-auth']}) ` +
        `still ships better-auth/node as an ESM module with these exports.`
      );
    }
    if (typeof fromNodeHeaders !== 'function') {
      throw new TypeError(
        `better-auth/node did not export 'fromNodeHeaders' as a function. ` +
        `Got: ${typeof fromNodeHeaders}. ` +
        `Check that better-auth is installed correctly (npm install) and that ` +
        `the package version (${require('./package.json').dependencies['better-auth']}) ` +
        `still ships better-auth/node as an ESM module with these exports.`
      );
    }

    console.log('[auth] better-auth/node loaded via dynamic import (ESM-safe)');
  } catch (err) {
    // Distinguish between our own validation errors and import failures.
    const isImportError = err.code === 'ERR_REQUIRE_ESM' || err.code === 'ERR_MODULE_NOT_FOUND';
    if (isImportError) {
      console.error(
        '[auth] FATAL: Failed to load better-auth/node via dynamic import.\n' +
        '  This usually means the package is not installed or the module path changed.\n' +
        '  Run: npm install\n' +
        '  If the error is ERR_REQUIRE_ESM, do NOT switch to require() — see the\n' +
        '  comment block at the top of server.js for the full explanation.\n',
        err
      );
    } else {
      console.error('[auth] FATAL: better-auth/node import validation failed.\n', err);
    }
    process.exit(1);
  }
  // ─────────────────────────────────────────────────────────────────────────

  // Construct the better-auth instance. buildAuth() does its own dynamic
  // import() of better-auth + better-auth/api so we don't depend on the
  // builder image's Node version supporting require(esm).
  ({ auth } = await buildAuth());
  console.log('[auth] better-auth instance built');

  // Wire up the placeholder route registered at module-load time. The
  // route itself is already in the middleware chain (in front of the SPA
  // fallback); we just point `_authNodeHandler` at the real handler.
  _authNodeHandler = toNodeHandler(auth);
  console.log('[auth] route handler wired');

  await db.init();
  console.log('[db] initialized');
  startCronTasks();

  // Warm the cache in the background. The server can answer requests
  // (and pass /healthz) immediately; cache misses fall through to the DB
  // until warming completes. Keeps boot time bounded for CI/Railway
  // healthchecks regardless of how long the 776-event warm pass takes.
  warmCache().catch(err => console.error('[cache] warm failed:', err));

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

  if (process.env.NODE_ENV !== 'test' && process.env.AUDIT_SCHEDULER !== 'off') {
    const { startScheduler } = require('./data/audit/scheduler');
    startScheduler();
  }

  ['SIGTERM', 'SIGINT'].forEach(sig => {
    process.on(sig, () => {
      console.log(`[${sig}] shutting down…`);
      server.close(() => { console.log('bye'); process.exit(0); });
      setTimeout(() => process.exit(1), 10_000).unref();
    });
  });
}

bootstrap().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
