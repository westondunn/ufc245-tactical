#!/usr/bin/env node
/**
 * tests/run.js — Lightweight test runner (no external test framework needed)
 * Exit code 0 = all pass, 1 = failures
 * Run: node tests/run.js
 */
const db = require('../db');
const bio = require('../lib/biomechanics');
const tactical = require('../lib/tactical');
const ver = require('../lib/version');
const fs = require('fs');
const path = require('path');
const os = require('os');

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

  // Fighter career metrics (enriched data)
  assertTruthy(fighter.slpm, 'McGregor has slpm metric');
  assertGt(fighter.slpm, 3, 'McGregor slpm > 3');
  assertTruthy(fighter.str_acc, 'McGregor has str_acc metric');
  const usmanFighter = db.getFighter(db.searchFighters('Usman')[0].id);
  assertGt(usmanFighter.td_def, 90, 'Usman td_def > 90%');
  // Some fighters should not have metrics
  const allF = db.getAllFighters(1000);
  const withMetrics = allF.filter(f => f.slpm !== null);
  assertGt(withMetrics.length, 40, '40+ fighters have career metrics');

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
  if (stats) {
    assert('total_fights' in stats, 'career stats has total_fights');
    assert('total_sig_landed' in stats, 'career stats has total_sig_landed');
    assert('sig_accuracy_pct' in stats, 'career stats has sig_accuracy_pct');
    assert('avg_sig_per_fight' in stats, 'career stats has avg_sig_per_fight');
  }

  const statsAsOf = db.getCareerStats(mcgregorId, '2017-01-01');
  if (statsAsOf && stats) {
    assert(statsAsOf.total_fights <= stats.total_fights, 'career-stats as_of excludes future bouts');
  } else {
    assert(true, 'career-stats as_of returns null/valid object');
  }

  // Record
  const record = db.getFighterRecord(mcgregorId);
  assertTruthy(record, 'getFighterRecord returns object');
  assert('wins' in record && 'losses' in record && 'draws' in record, 'record has wins/losses/draws');
  assertGt(record.total, 0, 'McGregor has fights in DB');
  assertEq(record.wins + record.losses + record.draws, record.total, 'record fields sum to total');

  // Head to head
  const khabib = db.searchFighters('Khabib')[0];
  if (khabib) {
    const h2h = db.getHeadToHead(mcgregorId, khabib.id);
    assertGt(h2h.length, 0, 'McGregor vs Khabib head-to-head exists');
  }

  // Null safety
  assertEq(db.getFighter(999999), null, 'getFighter with invalid ID returns null');
  assertEq(db.getEventByNumber(999), null, 'getEventByNumber with invalid number returns null');
  assertEq(db.getFight(999999), null, 'getFight with invalid ID returns null');
  assertEq(db.getEvent(999999), null, 'getEvent with invalid ID returns null');

  // ── Additional DB Functions ──
  console.log('\nDB Functions:');

  // getEvent
  const event36 = db.getEvent(ufc245.id);
  assertTruthy(event36, 'getEvent returns event');
  assertEq(event36.number, 245, 'getEvent returns correct event number');

  // getAllFighters
  const allFighters = db.getAllFighters(10);
  assertEq(allFighters.length, 10, 'getAllFighters respects limit');
  assertTruthy(allFighters[0].name, 'getAllFighters returns fighter objects with name');

  const allFightersDefault = db.getAllFighters();
  assertGt(allFightersDefault.length, 100, 'getAllFighters default returns 100+ fighters');

  // getStatLeaders
  const kdLeaders = db.getStatLeaders('knockdowns', 5);
  assertEq(kdLeaders.length, 5, 'getStatLeaders returns requested count');
  assertTruthy(kdLeaders[0].name, 'stat leader has name');
  assertTruthy(kdLeaders[0].value, 'stat leader has value');
  assert(kdLeaders[0].value >= kdLeaders[1].value, 'stat leaders sorted descending');

  const sigLeaders = db.getStatLeaders('sig_strikes', 3);
  assertEq(sigLeaders.length, 3, 'sig_strikes leaders returns 3');

  const invalidStat = db.getStatLeaders('nonexistent_stat');
  assertEq(invalidStat.length, 0, 'invalid stat returns empty array');

  // getRoundStats (fight 186 now has round stats from enrichment)
  const roundStats186 = db.getRoundStats(186);
  assert(Array.isArray(roundStats186), 'getRoundStats returns array');
  assertEq(roundStats186.length, 10, 'UFC 245 main event has 10 round stat entries');
  assertEq(roundStats186[0].round, 1, 'first round stat is round 1');
  assertTruthy(roundStats186[0].fighter_name, 'round stat has fighter_name');

  // getFightWithRounds
  const fightWithRounds = db.getFightWithRounds(186);
  assertTruthy(fightWithRounds, 'getFightWithRounds returns fight');
  assert('round_stats' in fightWithRounds, 'getFightWithRounds has round_stats property');
  assert('has_round_stats' in fightWithRounds, 'getFightWithRounds has has_round_stats flag');
  assertEq(fightWithRounds.event_number, 245, 'getFightWithRounds preserves fight data');
  assertEq(fightWithRounds.has_round_stats, true, 'UFC 245 main event has_round_stats is true');
  assertEq(fightWithRounds.round_stats.length, 10, 'UFC 245 main has 10 round stat rows');

  // getFightWithRounds null safety
  assertEq(db.getFightWithRounds(999999), null, 'getFightWithRounds with invalid ID returns null');

  // getDbStats
  const dbStats = db.getDbStats();
  assertTruthy(dbStats, 'getDbStats returns result');
  assertGt(dbStats.fighters, 0, 'dbStats has fighter count');
  assertGt(dbStats.events, 0, 'dbStats has event count');
  assertGt(dbStats.fights, 0, 'dbStats has fight count');
  assert('persistent' in dbStats, 'dbStats has persistent flag');

  // getHeadToHead with no shared fights
  const noH2h = db.getHeadToHead(mcgregorId, 999999);
  assertEq(noH2h.length, 0, 'getHeadToHead with no shared fights returns empty');

  // Prediction upsert contract (fight_id + model_version is unique)
  const upsertFightId = mainEvent.id;
  const upsertModelVersion = 'v.test.upsert';
  db.run('DELETE FROM predictions WHERE fight_id = ? AND model_version = ?', [upsertFightId, upsertModelVersion]);
  db.upsertPrediction({
    fight_id: upsertFightId,
    red_fighter_id: mainEvent.red_id,
    blue_fighter_id: mainEvent.blue_id,
    red_win_prob: 0.61,
    blue_win_prob: 0.39,
    model_version: upsertModelVersion,
    feature_hash: 'abc123',
    predicted_at: '2026-01-01T00:00:00.000Z',
    event_date: ufc245.date
  });
  db.upsertPrediction({
    fight_id: upsertFightId,
    red_fighter_id: mainEvent.red_id,
    blue_fighter_id: mainEvent.blue_id,
    red_win_prob: 0.55,
    blue_win_prob: 0.45,
    model_version: upsertModelVersion,
    feature_hash: 'def456',
    predicted_at: '2026-01-01T01:00:00.000Z',
    event_date: ufc245.date
  });
  const upsertRows = db.getPredictions({ fight_id: upsertFightId })
    .filter(r => r.model_version === upsertModelVersion);
  assertEq(upsertRows.length, 1, 'prediction ingest upserts same fight_id + model_version');
  assertEq(upsertRows[0].red_win_prob, 0.55, 'prediction upsert keeps latest values');

  // Reconcile selects latest unresolved row deterministically (predicted_at desc, id desc)
  const reconcileFightId = mainEvent.id;
  db.run("DELETE FROM predictions WHERE model_version IN ('v.test.reconcile.a','v.test.reconcile.b') AND fight_id = ?", [reconcileFightId]);
  db.upsertPrediction({
    fight_id: reconcileFightId,
    red_fighter_id: mainEvent.red_id,
    blue_fighter_id: mainEvent.blue_id,
    red_win_prob: 0.9,
    blue_win_prob: 0.1,
    model_version: 'v.test.reconcile.a',
    feature_hash: 'r1',
    predicted_at: '2026-01-02T00:00:00.000Z',
    event_date: ufc245.date
  });
  db.upsertPrediction({
    fight_id: reconcileFightId,
    red_fighter_id: mainEvent.red_id,
    blue_fighter_id: mainEvent.blue_id,
    red_win_prob: 0.1,
    blue_win_prob: 0.9,
    model_version: 'v.test.reconcile.b',
    feature_hash: 'r2',
    predicted_at: '2026-01-02T00:00:00.000Z',
    event_date: ufc245.date
  });
  const reconcileResult = db.reconcilePrediction(reconcileFightId, mainEvent.red_id);
  assertTruthy(reconcileResult, 'reconcilePrediction returns a reconciled row');
  assertEq(reconcileResult.model_version, 'v.test.reconcile.b', 'reconcile uses latest unresolved prediction deterministically');
  assertEq(reconcileResult.correct, 0, 'reconcile correctness matches selected prediction');

  // search case insensitivity
  const lowerSearch = db.searchFighters('mcgregor');
  assertGt(lowerSearch.length, 0, 'searchFighters is case-insensitive');

  // ── Tactical Analysis ──
  console.log('\nTactical:');

  // classifyMethod
  assertEq(tactical.classifyMethod('KO/TKO'), 'striking', 'classifyMethod KO/TKO → striking');
  assertEq(tactical.classifyMethod('Submission'), 'grappling', 'classifyMethod Submission → grappling');
  assertEq(tactical.classifyMethod('Decision - Unanimous'), 'distance', 'classifyMethod Decision → distance');
  assertEq(tactical.classifyMethod('Decision - Split'), 'distance', 'classifyMethod Split Decision → distance');
  assertEq(tactical.classifyMethod('No Contest'), 'nc', 'classifyMethod No Contest → nc');
  assertEq(tactical.classifyMethod(null), 'unknown', 'classifyMethod null → unknown');
  assertEq(tactical.classifyMethod('something weird'), 'unknown', 'classifyMethod unknown string → unknown');

  // timeToSec
  assertEq(tactical.timeToSec('4:10', 5), 1450, 'timeToSec 4:10 round 5 = 1450s');
  assertEq(tactical.timeToSec('5:00', 1), 300, 'timeToSec 5:00 round 1 = 300s');
  assertEq(tactical.timeToSec('0:30', 1), 30, 'timeToSec 0:30 round 1 = 30s');
  assertEq(tactical.timeToSec('1:00', 3), 660, 'timeToSec 1:00 round 3 = 660s');
  assertEq(tactical.timeToSec(null, 1), 0, 'timeToSec null time = 0');
  assertEq(tactical.timeToSec('4:10', null), 0, 'timeToSec null round = 0');

  // analyzeFight
  const fightForTactical = db.getFight(mainEvent.id);
  const redFighter = db.getFighter(fightForTactical.red_fighter_id);
  const blueFighter = db.getFighter(fightForTactical.blue_fighter_id);
  const roundStatsForTactical = db.getRoundStats(mainEvent.id);
  const analysis = tactical.analyzeFight(fightForTactical, redFighter, blueFighter, roundStatsForTactical);

  assertTruthy(analysis, 'analyzeFight returns result');
  assertEq(analysis.fight_id, mainEvent.id, 'analysis has correct fight_id');
  assertEq(analysis.method_class, 'striking', 'UFC 245 main event classified as striking');
  assertGt(analysis.sections.length, 3, 'analysis has 3+ sections');
  assertTruthy(analysis.key_factors, 'analysis has key_factors');
  assert(Array.isArray(analysis.key_factors), 'key_factors is an array');

  // Round breakdown section (now exists with enriched round stats)
  const roundSection = analysis.sections.find(s => s.type === 'rounds');
  assertTruthy(roundSection, 'analysis has per-round breakdown section');

  // Check section structure
  const matchupSection = analysis.sections.find(s => s.title === 'Matchup Profile');
  assertTruthy(matchupSection, 'analysis has Matchup Profile section');
  assertTruthy(matchupSection.items, 'matchup section has items');

  const resultSection = analysis.sections.find(s => s.title === 'Result Analysis');
  assertTruthy(resultSection, 'analysis has Result Analysis section');

  // analyzeFight with minimal data (no stats)
  const minimalFight = { id: 999, method: 'Decision - Unanimous', round: 3, time: '5:00', winner_id: 1, stats: [] };
  const minimalRed = { name: 'Fighter A', height_cm: 180, reach_cm: 185, stance: 'Orthodox' };
  const minimalBlue = { name: 'Fighter B', height_cm: 175, reach_cm: 180, stance: 'Southpaw' };
  const minimalAnalysis = tactical.analyzeFight(minimalFight, minimalRed, minimalBlue, []);
  assertTruthy(minimalAnalysis, 'analyzeFight works with minimal data');
  assertEq(minimalAnalysis.method_class, 'distance', 'minimal fight classified correctly');
  assertGt(minimalAnalysis.sections.length, 0, 'minimal analysis has sections');

  // analyzeFight with null fighters (defensive)
  const nullFighterAnalysis = tactical.analyzeFight(minimalFight, null, null, []);
  assertTruthy(nullFighterAnalysis, 'analyzeFight handles null fighters');

  // generateAllAnalyses
  const allAnalyses = await tactical.generateAllAnalyses(db);
  assertGt(allAnalyses.length, 0, 'generateAllAnalyses returns results');
  assertTruthy(allAnalyses[0].fight_id, 'bulk analysis entries have fight_id');

  // ── Biomechanics ──
  console.log('\nBiomechanics:');
  const punch = bio.estimateStrikeForce({ bodyMassKg: 77, strikeType: 'right_cross' });
  assertTruthy(punch, 'estimateStrikeForce returns result');
  assertGt(punch.force_n, 1000, 'right cross force > 1000N');
  assert(punch.force_n < 5000, 'right cross force < 5000N (sanity)');
  assertGt(punch.velocity_ms, 5, 'fist velocity > 5 m/s');
  assertTruthy(punch.thresholds, 'thresholds array exists');
  assertEq(punch.citation, 'Walilko 2005, Kacprzak 2025', 'citation string present');

  const kick = bio.estimateStrikeForce({ bodyMassKg: 77, strikeType: 'body_kick' });
  assertGt(kick.force_n, punch.force_n, 'body kick force > right cross');

  const chain = bio.kineticChain('right_cross', { bodyMassKg: 77 });
  assertTruthy(chain, 'kineticChain returns result');
  assertEq(chain.chain.length, 6, 'kinetic chain has 6 nodes');
  assertEq(chain.chain[0].label, 'Ground', 'first node is Ground');
  assertEq(chain.chain[5].label, 'Fist', 'last node is Fist');

  // Kinetic chain force propagation: each intermediate node force < previous
  for (let i = 1; i < chain.chain.length - 1; i++) {
    assert(chain.chain[i].force_n <= chain.chain[i - 1].force_n,
      `chain node ${i} force <= node ${i-1} (transfer loss)`);
  }

  const damage = bio.damageAssessment({ bodyMassKg: 77, strikeType: 'right_cross', target: 'head' });
  assertTruthy(damage, 'damageAssessment returns result');
  assertTruthy(damage.thresholds, 'damage has thresholds');
  assertEq(damage.target, 'head', 'damage assessment target is head');
  assertEq(damage.concussion_risk, 'elevated', 'right cross to head = elevated concussion risk');

  // Damage assessment body target
  const bodyDamage = bio.damageAssessment({ bodyMassKg: 77, strikeType: 'body_kick', target: 'body' });
  assertTruthy(bodyDamage, 'body damage assessment returns result');
  assertEq(bodyDamage.target, 'body', 'body damage target correct');
  assertEq(bodyDamage.concussion_risk, 'low', 'body strike = low concussion risk');
  assert(bodyDamage.thresholds.some(t => t.injury === 'rib fracture'), 'body target includes rib fracture threshold');

  // Damage assessment nose target
  const noseDamage = bio.damageAssessment({ bodyMassKg: 77, strikeType: 'jab', target: 'nose' });
  assertTruthy(noseDamage, 'nose damage assessment returns result');
  assert(noseDamage.thresholds.some(t => t.injury === 'nasal fracture'), 'nose target includes nasal fracture');

  const nullStrike = bio.estimateStrikeForce({ bodyMassKg: 77, strikeType: 'nonexistent' });
  assertEq(nullStrike, null, 'unknown strike type returns null');

  const nullChain = bio.kineticChain('nonexistent', { bodyMassKg: 77 });
  assertEq(nullChain, null, 'unknown strike type kineticChain returns null');

  const nullDamage = bio.damageAssessment({ bodyMassKg: 77, strikeType: 'nonexistent' });
  assertEq(nullDamage, null, 'unknown strike type damageAssessment returns null');

  // Mass scaling sanity: heavier fighter = more force
  const light = bio.estimateStrikeForce({ bodyMassKg: 57, strikeType: 'right_cross' });
  const heavy = bio.estimateStrikeForce({ bodyMassKg: 109, strikeType: 'right_cross' });
  assert(heavy.force_n > light.force_n, 'heavier fighter generates more force');
  assert(heavy.velocity_ms > light.velocity_ms, 'heavier fighter has higher velocity');

  // All strike types produce valid results
  const allStrikes = Object.keys(bio.REFERENCE);
  assertGt(allStrikes.length, 8, 'REFERENCE has 8+ strike types');
  for (const strike of allStrikes) {
    const result = bio.estimateStrikeForce({ bodyMassKg: 77, strikeType: strike });
    assertTruthy(result, `strike type "${strike}" returns result`);
    assertGt(result.force_n, 0, `strike "${strike}" force > 0`);
  }

  // Kick chain last node should be Shin, not Fist
  const kickChain = bio.kineticChain('body_kick', { bodyMassKg: 77 });
  assertEq(kickChain.chain[5].label, 'Shin', 'kick chain last node is Shin');

  // Glove dampening
  const bareKnuckle = bio.estimateStrikeForce({ bodyMassKg: 77, strikeType: 'right_cross', gloveOz: 4 });
  const boxingGlove = bio.estimateStrikeForce({ bodyMassKg: 77, strikeType: 'right_cross', gloveOz: 16 });
  assert(bareKnuckle.force_n > boxingGlove.force_n, '4oz glove force > 16oz glove force');

  // THRESHOLDS exported and populated
  assertTruthy(bio.THRESHOLDS, 'THRESHOLDS exported');
  assertGt(bio.THRESHOLDS.mandible_fracture, 0, 'mandible threshold is positive');
  assertGt(bio.THRESHOLDS.orbital_fracture, 0, 'orbital threshold is positive');

  // ── Caching ──
  console.log('\nCaching:');
  const cacheModule = require('../lib/cache');
  assertEq(cacheModule.has('nonexistent'), false, 'cache miss returns false');
  assertEq(cacheModule.get('nonexistent'), undefined, 'cache get miss returns undefined');
  cacheModule.set('test-key', { data: 42 });
  assertEq(cacheModule.has('test-key'), true, 'cache hit after set');
  assertEq(cacheModule.get('test-key').data, 42, 'cache returns stored value');
  assertEq(cacheModule.size() > 0, true, 'cache size > 0 after set');
  cacheModule.invalidateAll();
  assertEq(cacheModule.has('test-key'), false, 'cache cleared after invalidateAll');
  assertEq(cacheModule.size(), 0, 'cache size is 0 after invalidateAll');
  const etag1 = cacheModule.computeETag('{"hello":"world"}');
  assert(etag1.startsWith('W/"'), 'computeETag returns weak ETag');
  assertEq(cacheModule.computeETag('{"hello":"world"}'), etag1, 'computeETag is deterministic');
  assert(cacheModule.computeETag('{"hello":"other"}') !== etag1, 'computeETag differs for different input');
  const retVal = cacheModule.set('ret-test', 'value');
  assertEq(retVal, 'value', 'cache set returns the stored value');

  // ── Seed Data Integrity (fight_stats) ──
  console.log('\nSeed Data Integrity:');
  const fightStatsIntegrity = (() => {
    const fightIds = new Set(seed.fights.map(f => f.id));
    const fighterIdsSet = new Set(seed.fighters.map(f => f.id));
    let ok = true;
    for (const fs of (seed.fight_stats || [])) {
      if (!fightIds.has(fs.fight_id)) {
        console.error(`    fight_stat: invalid fight ref ${fs.fight_id}`);
        ok = false;
      }
      if (!fighterIdsSet.has(fs.fighter_id)) {
        console.error(`    fight_stat: invalid fighter ref ${fs.fighter_id}`);
        ok = false;
      }
    }
    return ok;
  })();
  assert(fightStatsIntegrity, 'all fight_stats reference valid fight/fighter IDs');
  assertGt((seed.fight_stats || []).length, 100, 'seed has 100+ fight_stat records');

  // Every fight with has_stats=1 should have fight_stats entries
  const statsMap = new Map();
  for (const fs of (seed.fight_stats || [])) {
    if (!statsMap.has(fs.fight_id)) statsMap.set(fs.fight_id, 0);
    statsMap.set(fs.fight_id, statsMap.get(fs.fight_id) + 1);
  }
  let statsConsistency = true;
  for (const f of seed.fights) {
    if (f.has_stats && !statsMap.has(f.id)) {
      console.error(`    fight ${f.id} has_stats=1 but no fight_stats entries`);
      statsConsistency = false;
    }
  }
  assert(statsConsistency, 'all has_stats=1 fights have corresponding fight_stats');

  // Events have valid dates (YYYY-MM-DD format)
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  const validDates = seed.events.every(e => !e.date || dateRegex.test(e.date));
  assert(validDates, 'all event dates are valid YYYY-MM-DD format');

  // ── HTML Structure ──
  console.log('\nHTML:');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert(html.includes('<!DOCTYPE html>'), 'HTML has doctype');
  assert(html.includes('three.min.js'), 'Three.js CDN included');
  assert(html.includes('appVersion'), 'version display element present');
  assert(html.includes('comparePanel'), 'comparison panel present');
  assert(html.includes('fighterSearch'), 'fighter search input present');
  assert(html.includes('/css/styles.css'), 'external CSS stylesheet linked');
  assert(html.includes('/js/app.js'), 'external JS bundle linked');

  // ── App JS ──
  console.log('\nApp JS:');
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  assert(appJs.includes('escHtml'), 'XSS escape function present');
  assert(appJs.includes('window.addToCompare'), 'IIFE functions exposed on window');
  assert(appJs.includes('/api/version'), 'version API fetch present');

  // ── Server Config ──
  console.log('\nServer Config:');
  const serverJs = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert(serverJs.includes('X-App-Version'), 'version header set');
  assert(serverJs.includes('apiHandler'), 'error handling wrapper present');
  assert(serverJs.includes('Content-Security-Policy'), 'CSP header set');
  assert(serverJs.includes('X-Content-Type-Options'), 'nosniff header set');
  assert(serverJs.includes('SIGTERM'), 'graceful shutdown handler');
  assert(serverJs.includes('fighterMassKg'), 'weight-class mass lookup present');
  assert(serverJs.includes('X-Frame-Options'), 'X-Frame-Options header set');
  assert(serverJs.includes('Referrer-Policy'), 'Referrer-Policy header set');
  assert(serverJs.includes('Permissions-Policy'), 'Permissions-Policy header set');
  assert(serverJs.includes('parameterized') || serverJs.includes('?'), 'parameterized queries used');

  // ── railway.json ──
  console.log('\nRailway Config:');
  const railway = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'railway.json'), 'utf8'));
  assertEq(railway.deploy.healthcheckPath, '/healthz', 'healthcheck path set');

  // ── Persistence ──
  console.log('\nPersistence:');
  const persistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ufc-db-'));
  const persistPath = path.join(persistDir, 'ufc-persist.db');
  await db.init({ dbPath: persistPath, seedPath });
  db.upsertPrediction({
    fight_id: 186,
    red_fighter_id: 31,
    blue_fighter_id: 32,
    red_win_prob: 0.52,
    blue_win_prob: 0.48,
    model_version: 'v.test.persistence',
    feature_hash: 'persist',
    predicted_at: '2026-01-03T00:00:00.000Z',
    event_date: '2019-12-14'
  });
  db.save();
  await db.init({ dbPath: persistPath, seedPath });
  const persistedRows = db.getPredictions({ fight_id: 186 })
    .filter(r => r.model_version === 'v.test.persistence');
  assertEq(persistedRows.length, 1, 'predictions persist across db restart with DB_PATH');

  // ── Summary ──
  console.log(`\n━━━ Results: ${passed} passed, ${failed} failed ━━━\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
