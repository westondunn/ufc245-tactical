#!/usr/bin/env node
/**
 * tests/run.js — Lightweight test runner (no external test framework needed)
 * Exit code 0 = all pass, 1 = failures
 * Run: node tests/run.js
 */
const db = require('../db');
const bio = require('../lib/biomechanics');
const ver = require('../lib/version');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;

function assert(condition, name) {
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

function assertEq(actual, expected, name) {
  assert(actual === expected, `${name} (got ${actual}, expected ${expected})`);
}

function assertGt(actual, min, name) {
  assert(actual > min, `${name} (got ${actual}, expected > ${min})`);
}

function assertTruthy(val, name) {
  assert(!!val, `${name} (got ${JSON.stringify(val)})`);
}

async function run() {
  console.log('\n━━━ UFC Tactical Dashboard · Test Suite ━━━\n');

  // ── Version ──
  console.log('Version:');
  assertTruthy(ver.version, 'version string exists');
  assert(/^\d+\.\d+\.\d+/.test(ver.version), 'version is semver');
  assertTruthy(ver.buildSha, 'build SHA exists');
  assertTruthy(ver.full, 'full version string exists');

  // ── Seed Data ──
  console.log('\nSeed Data:');
  const seedPath = path.join(__dirname, '..', 'data', 'seed.json');
  assert(fs.existsSync(seedPath), 'seed.json exists');
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  assertGt(seed.fighters.length, 50, 'seed has 50+ fighters');
  assertGt(seed.events.length, 30, 'seed has 30+ events');
  assertGt(seed.fights.length, 80, 'seed has 80+ fights');
  // Check data integrity: every fight references valid fighter IDs
  const fighterIds = new Set(seed.fighters.map(f => f.id));
  const eventIds = new Set(seed.events.map(e => e.id));
  let fightIntegrity = true;
  for (const f of seed.fights) {
    if (!fighterIds.has(f.red_fighter_id) || !fighterIds.has(f.blue_fighter_id)) {
      console.error(`    fight ${f.id}: invalid fighter ref (red=${f.red_fighter_id}, blue=${f.blue_fighter_id})`);
      fightIntegrity = false;
    }
    if (!eventIds.has(f.event_id)) {
      console.error(`    fight ${f.id}: invalid event ref (${f.event_id})`);
      fightIntegrity = false;
    }
  }
  assert(fightIntegrity, 'all fights reference valid fighter/event IDs');

  // ── Database ──
  console.log('\nDatabase:');
  await db.init();
  assert(true, 'db.init() succeeds');

  const fighters = db.searchFighters('McGregor');
  assertGt(fighters.length, 0, 'searchFighters("McGregor") returns results');
  assertEq(fighters[0].name, 'Conor McGregor', 'first result is Conor McGregor');

  const emptySearch = db.searchFighters('zzzznonexistent');
  assertEq(emptySearch.length, 0, 'search for nonexistent returns empty');

  const shortSearch = db.searchFighters('a');
  // Should still work (min length is enforced in server, not db)
  assert(Array.isArray(shortSearch), 'single-char search returns array');

  const mcgregorId = fighters[0].id;
  const fighter = db.getFighter(mcgregorId);
  assertTruthy(fighter, 'getFighter returns a fighter');
  assertEq(fighter.nationality, 'Ireland', 'McGregor nationality is Ireland');

  const events = db.getFighterEvents(mcgregorId);
  assertGt(events.length, 5, 'McGregor has 5+ event appearances');

  const allEvents = db.getAllEvents();
  assertGt(allEvents.length, 30, 'getAllEvents returns 30+ events');

  // Find UFC 245 event
  const ufc245 = db.getEventByNumber(245);
  assertTruthy(ufc245, 'getEventByNumber(245) returns an event');
  const card = db.getEventCard(ufc245.id);
  assertGt(card.length, 2, 'UFC 245 card has 2+ fights');

  // Fight detail
  const mainEvent = card.find(f => f.is_main);
  assertTruthy(mainEvent, 'UFC 245 has a main event');
  const fight = db.getFight(mainEvent.id);
  assertTruthy(fight, 'getFight returns fight detail');
  assertEq(fight.method.includes('KO'), true, 'UFC 245 main event method includes KO');

  // Career stats
  const stats = db.getCareerStats(mcgregorId);
  assert(stats === null || typeof stats === 'object', 'getCareerStats returns object or null');

  // Record
  const record = db.getFighterRecord(mcgregorId);
  assertTruthy(record, 'getFighterRecord returns object');
  assert('wins' in record && 'losses' in record && 'draws' in record, 'record has wins/losses/draws');
  assertGt(record.total, 0, 'McGregor has fights in DB');

  // Head to head
  const khabib = db.searchFighters('Khabib')[0];
  if (khabib) {
    const h2h = db.getHeadToHead(mcgregorId, khabib.id);
    assertGt(h2h.length, 0, 'McGregor vs Khabib head-to-head exists');
  }

  // Null safety
  assertEq(db.getFighter(999999), null, 'getFighter with invalid ID returns null');
  assertEq(db.getEventByNumber(999), null, 'getEventByNumber with invalid number returns null');

  // ── Biomechanics ──
  console.log('\nBiomechanics:');
  const punch = bio.estimateStrikeForce({ bodyMassKg: 77, strikeType: 'right_cross' });
  assertTruthy(punch, 'estimateStrikeForce returns result');
  assertGt(punch.force_n, 1000, 'right cross force > 1000N');
  assert(punch.force_n < 5000, 'right cross force < 5000N (sanity)');
  assertGt(punch.velocity_ms, 5, 'fist velocity > 5 m/s');
  assertTruthy(punch.thresholds, 'thresholds array exists');

  const kick = bio.estimateStrikeForce({ bodyMassKg: 77, strikeType: 'body_kick' });
  assertGt(kick.force_n, punch.force_n, 'body kick force > right cross');

  const chain = bio.kineticChain('right_cross', { bodyMassKg: 77 });
  assertTruthy(chain, 'kineticChain returns result');
  assertEq(chain.chain.length, 6, 'kinetic chain has 6 nodes');
  assertEq(chain.chain[0].label, 'Ground', 'first node is Ground');
  assertEq(chain.chain[5].label, 'Fist', 'last node is Fist');

  const damage = bio.damageAssessment({ bodyMassKg: 77, strikeType: 'right_cross', target: 'head' });
  assertTruthy(damage, 'damageAssessment returns result');
  assertTruthy(damage.thresholds, 'damage has thresholds');

  const nullStrike = bio.estimateStrikeForce({ bodyMassKg: 77, strikeType: 'nonexistent' });
  assertEq(nullStrike, null, 'unknown strike type returns null');

  // Mass scaling sanity: heavier fighter = more force
  const light = bio.estimateStrikeForce({ bodyMassKg: 57, strikeType: 'right_cross' });
  const heavy = bio.estimateStrikeForce({ bodyMassKg: 109, strikeType: 'right_cross' });
  assert(heavy.force_n > light.force_n, 'heavier fighter generates more force');

  // ── HTML Structure ──
  console.log('\nHTML:');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert(html.includes('<!DOCTYPE html>'), 'HTML has doctype');
  assert(html.includes('three.min.js'), 'Three.js CDN included');
  assert(html.includes('escHtml'), 'XSS escape function present');
  assert(html.includes('window.addToCompare'), 'IIFE functions exposed on window');
  assert(html.includes('appVersion'), 'version display element present');
  assert(html.includes('/api/version'), 'version API fetch present');
  assert(html.includes('comparePanel'), 'comparison panel present');
  assert(html.includes('fighterSearch'), 'fighter search input present');

  // ── Server Config ──
  console.log('\nServer Config:');
  const serverJs = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert(serverJs.includes('X-App-Version'), 'version header set');
  assert(serverJs.includes('apiHandler'), 'error handling wrapper present');
  assert(serverJs.includes('Content-Security-Policy'), 'CSP header set');
  assert(serverJs.includes('X-Content-Type-Options'), 'nosniff header set');
  assert(serverJs.includes('SIGTERM'), 'graceful shutdown handler');
  assert(serverJs.includes('fighterMassKg'), 'weight-class mass lookup present');

  // ── railway.json ──
  console.log('\nRailway Config:');
  const railway = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'railway.json'), 'utf8'));
  assertEq(railway.deploy.healthcheckPath, '/healthz', 'healthcheck path set');

  // ── Summary ──
  console.log(`\n━━━ Results: ${passed} passed, ${failed} failed ━━━\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
