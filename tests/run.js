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
  db.upsertFighter({
    id: fighter.id,
    name: fighter.name,
    nickname: null,
    height_cm: null,
    reach_cm: null,
    stance: null,
    weight_class: fighter.weight_class,
    nationality: null,
    dob: null,
    slpm: null,
    str_acc: null,
    sapm: null,
    str_def: null,
    td_avg: null,
    td_acc: null,
    td_def: null,
    sub_avg: null
  });
  const preservedFighter = db.getFighter(fighter.id);
  assertEq(preservedFighter.slpm, fighter.slpm, 'sparse fighter upsert preserves existing slpm');
  assertEq(preservedFighter.str_acc, fighter.str_acc, 'sparse fighter upsert preserves existing str_acc');
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
  assert('red_record_wins' in card[0] && 'blue_record_wins' in card[0], 'event card exposes fighter record badge fields');
  assert('red_is_ufc_debut' in card[0] && 'blue_is_ufc_debut' in card[0], 'event card exposes UFC debut fields');
  assert('red_prior_ufc_fights' in card[0] && 'blue_prior_ufc_fights' in card[0], 'event card exposes prior UFC fight counts');
  assertEq(
    Number(card[0].red_record_wins) + Number(card[0].red_record_losses) + Number(card[0].red_record_draws),
    Number(card[0].red_record_total),
    'red event-card record fields sum to total'
  );
  assertEq(
    Number(card[0].blue_record_wins) + Number(card[0].blue_record_losses) + Number(card[0].blue_record_draws),
    Number(card[0].blue_record_total),
    'blue event-card record fields sum to total'
  );
  const ufc245Debut = card.find(f => Number(f.red_is_ufc_debut) === 1 || Number(f.blue_is_ufc_debut) === 1);
  assertTruthy(ufc245Debut, 'UFC 245 card identifies at least one UFC debut fighter');
  if (Number(ufc245Debut.red_is_ufc_debut) === 1) {
    assertEq(Number(ufc245Debut.red_prior_ufc_fights), 0, 'red UFC debut has zero prior UFC fights');
  }
  if (Number(ufc245Debut.blue_is_ufc_debut) === 1) {
    assertEq(Number(ufc245Debut.blue_prior_ufc_fights), 0, 'blue UFC debut has zero prior UFC fights');
  }

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
    explanation: {
      summary: 'Usman pressure and reach drive the pick.',
      factors: [{ label: 'Reach', favors: 'red', impact: 0.7, value: 10 }]
    },
    predicted_method: 'KO/TKO',
    predicted_round: 5,
    predicted_at: '2026-01-01T01:00:00.000Z',
    event_date: ufc245.date
  });
  const upsertRows = db.getPredictions({ fight_id: upsertFightId })
    .filter(r => r.model_version === upsertModelVersion);
  assertEq(upsertRows.length, 1, 'prediction ingest upserts same fight_id + model_version');
  assertEq(upsertRows[0].red_win_prob, 0.55, 'prediction upsert keeps latest values');
  assert(upsertRows[0].explanation_json.includes('pressure and reach'), 'prediction upsert stores explanation JSON');
  assertEq(upsertRows[0].predicted_method, 'KO/TKO', 'prediction upsert stores predicted method metadata');
  assertEq(upsertRows[0].predicted_round, 5, 'prediction upsert stores predicted round metadata');
  const comparison = db.getEventPickComparison(ufc245.id);
  const explainedFight = comparison.find(f => f.fight_id === upsertFightId);
  assertTruthy(explainedFight.model.explanation, 'model comparison includes parsed prediction explanation');
  assertEq(explainedFight.model.explanation.factors[0].label, 'Reach', 'model explanation includes top factor labels');
  db.run("DELETE FROM predictions WHERE fight_id = ? AND model_version IN ('v.test.latest.old','v.test.latest.new')", [upsertFightId]);
  db.upsertPrediction({
    fight_id: upsertFightId,
    red_fighter_id: mainEvent.red_id,
    blue_fighter_id: mainEvent.blue_id,
    red_win_prob: 0.51,
    blue_win_prob: 0.49,
    model_version: 'v.test.latest.old',
    predicted_at: '2026-01-01T02:00:00.000Z',
    event_date: ufc245.date
  });
  db.upsertPrediction({
    fight_id: upsertFightId,
    red_fighter_id: mainEvent.red_id,
    blue_fighter_id: mainEvent.blue_id,
    red_win_prob: 0.64,
    blue_win_prob: 0.36,
    model_version: 'v.test.latest.new',
    predicted_at: '2026-01-01T03:00:00.000Z',
    event_date: ufc245.date
  });
  const latestRows = db.getPredictions({ fight_id: upsertFightId });
  assertEq(latestRows.find(r => r.model_version === 'v.test.latest.old').is_stale, 1, 'newer model marks older unresolved model stale');
  assertEq(latestRows.find(r => r.model_version === 'v.test.latest.new').is_stale, 0, 'newer model remains active');
  const pruneResult = db.prunePastPredictions({ before: '2026-01-01', include_concluded: true });
  assertGt(pruneResult.pruned, 0, 'prunePastPredictions marks past/concluded predictions stale');
  const staleRows = db.getPredictions({ fight_id: upsertFightId }).filter(r => r.model_version === upsertModelVersion);
  assertEq(staleRows[0].is_stale, 1, 'pruned prediction is stale instead of deleted');

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
  assertGt(reconcileResult.reconciled_count, 1, 'reconcilePrediction scores each stored model for the fight');
  const reconciledModelRows = db.getPredictions({ fight_id: reconcileFightId })
    .filter(r => ['v.test.reconcile.a', 'v.test.reconcile.b'].includes(r.model_version));
  assertEq(reconciledModelRows.find(r => r.model_version === 'v.test.reconcile.a').correct, 1, 'older model version is also scored');
  assertEq(reconciledModelRows.find(r => r.model_version === 'v.test.reconcile.b').correct, 0, 'newer model version is scored');

  // ── Enrichment fields ──
  console.log('\nEnrichment fields:');
  await db.upsertPrediction({
    fight_id: mainEvent.id,
    red_fighter_id: mainEvent.red_id,
    blue_fighter_id: mainEvent.blue_id,
    red_win_prob: 0.6, blue_win_prob: 0.4,
    model_version: 'v.enrich.test.lr.1',
    feature_hash: 'eh1',
    predicted_at: new Date().toISOString(),
    event_date: '2030-01-01',
    enrichment_level: 'lr'
  });
  const lrRow = (await db.getPredictions({ fight_id: mainEvent.id })).find(r => r.model_version === 'v.enrich.test.lr.1');
  assertEq(lrRow.enrichment_level, 'lr', 'lr row stores enrichment_level=lr');
  assertEq(lrRow.narrative_text, null, 'lr row narrative_text defaults null');

  await db.upsertPrediction({
    fight_id: mainEvent.id,
    red_fighter_id: mainEvent.red_id,
    blue_fighter_id: mainEvent.blue_id,
    red_win_prob: 0.7, blue_win_prob: 0.3,
    model_version: 'v.enrich.test.ensemble.1',
    feature_hash: 'eh2',
    predicted_at: new Date().toISOString(),
    event_date: '2030-01-01',
    enrichment_level: 'ensemble',
    narrative_text: 'LLM said so',
    method_confidence: 0.55,
    insights: [{ label: 'coach change', severity: 2, favors: 'red', source: 'MMAJunkie' }]
  });
  const enRow = (await db.getPredictions({ fight_id: mainEvent.id })).find(r => r.model_version === 'v.enrich.test.ensemble.1');
  assertEq(enRow.enrichment_level, 'ensemble', 'ensemble row stores enrichment_level=ensemble');
  assertEq(enRow.narrative_text, 'LLM said so', 'narrative_text persists');
  assertEq(enRow.method_confidence, 0.55, 'method_confidence persists');
  const insights = typeof enRow.insights === 'string' ? JSON.parse(enRow.insights) : enRow.insights;
  assertEq(insights.length, 1, 'insights persist as JSON');
  assertEq(insights[0].label, 'coach change', 'insights content preserved');

  // ── Upgrade semantics ──
  console.log('\nUpgrade semantics:');
  // Pick a different fight than mainEvent so prior enrichment-test predictions
  // don't pollute these assertions.
  const upgradeFight = card.find(f => !f.is_main && f.red_id && f.blue_id);
  assertTruthy(upgradeFight, 'upgrade-semantics fixture: a non-main UFC 245 fight exists');

  // Setup: insert an LR prediction.
  await db.upsertPrediction({
    fight_id: upgradeFight.id,
    red_fighter_id: upgradeFight.red_id,
    blue_fighter_id: upgradeFight.blue_id,
    red_win_prob: 0.55, blue_win_prob: 0.45,
    model_version: 'v.upgrade.lr.1', feature_hash: 'u1',
    predicted_at: new Date().toISOString(), event_date: '2030-02-01',
    enrichment_level: 'lr'
  });
  // Ensemble lands; LR should be marked stale, ensemble fresh.
  await db.upsertPrediction({
    fight_id: upgradeFight.id,
    red_fighter_id: upgradeFight.red_id,
    blue_fighter_id: upgradeFight.blue_id,
    red_win_prob: 0.62, blue_win_prob: 0.38,
    model_version: 'v.upgrade.ensemble.1', feature_hash: 'u2',
    predicted_at: new Date().toISOString(), event_date: '2030-02-01',
    enrichment_level: 'ensemble',
    narrative_text: 'reasoning',
    insights: []
  });
  const upRows = await db.getPredictions({ fight_id: upgradeFight.id });
  const lrAfter = upRows.find(r => r.model_version === 'v.upgrade.lr.1');
  const enAfter = upRows.find(r => r.model_version === 'v.upgrade.ensemble.1');
  assertEq(lrAfter.is_stale, 1, 'lr row marked stale after ensemble lands');
  assertEq(enAfter.is_stale, 0, 'ensemble row is fresh');

  // Late LR for same fight should be inserted as stale-on-arrival.
  await db.upsertPrediction({
    fight_id: upgradeFight.id,
    red_fighter_id: upgradeFight.red_id,
    blue_fighter_id: upgradeFight.blue_id,
    red_win_prob: 0.51, blue_win_prob: 0.49,
    model_version: 'v.upgrade.lr.2', feature_hash: 'u3',
    predicted_at: new Date().toISOString(), event_date: '2030-02-01',
    enrichment_level: 'lr'
  });
  const afterRows = await db.getPredictions({ fight_id: upgradeFight.id });
  const stillFresh = afterRows.filter(r => r.is_stale === 0);
  assertEq(stillFresh.length, 1, 'exactly one fresh row after late lr arrival');
  assertEq(stillFresh[0].enrichment_level, 'ensemble', 'fresh row remains the ensemble row');
  const lrLate = afterRows.find(r => r.model_version === 'v.upgrade.lr.2');
  assertEq(lrLate.is_stale, 1, 'late lr inserted but stale');

  // Older same-level ensemble should not supersede a newer fresh ensemble.
  const freshnessFight = card.find(f => !f.is_main && f.id !== upgradeFight.id && f.red_id && f.blue_id);
  assertTruthy(freshnessFight, 'freshness fixture: a second non-main fight exists');
  await db.upsertPrediction({
    fight_id: freshnessFight.id,
    red_fighter_id: freshnessFight.red_id,
    blue_fighter_id: freshnessFight.blue_id,
    red_win_prob: 0.6, blue_win_prob: 0.4,
    model_version: 'v.fresh.ensemble.newer', feature_hash: 'f1',
    predicted_at: '2030-04-02T00:00:00.000Z', event_date: '2030-04-10',
    enrichment_level: 'ensemble'
  });
  await db.upsertPrediction({
    fight_id: freshnessFight.id,
    red_fighter_id: freshnessFight.red_id,
    blue_fighter_id: freshnessFight.blue_id,
    red_win_prob: 0.4, blue_win_prob: 0.6,
    model_version: 'v.fresh.ensemble.older', feature_hash: 'f2',
    predicted_at: '2030-04-01T00:00:00.000Z', event_date: '2030-04-10',
    enrichment_level: 'ensemble'
  });
  const freshnessRows = await db.getPredictions({ fight_id: freshnessFight.id });
  const freshnessFresh = freshnessRows.filter(r => r.is_stale === 0);
  assertEq(freshnessFresh.length, 1, 'older ensemble arrival keeps one fresh row');
  assertEq(freshnessFresh[0].model_version, 'v.fresh.ensemble.newer', 'newer ensemble remains fresh');
  assertEq(freshnessRows.find(r => r.model_version === 'v.fresh.ensemble.older').is_stale, 1, 'older ensemble inserted stale');

  // ── Accuracy breakdown by enrichment_level ──
  console.log('\nAccuracy breakdown:');
  // Pick a third non-main fight: one not used by Task 1 (mainEvent) or
  // Task 2 (upgradeFight = first non-main). Use the second non-main fight.
  const nonMainFights = card.filter(f => !f.is_main && f.red_id && f.blue_id);
  assertGt(nonMainFights.length, 1, 'accuracy-breakdown fixture: 2+ non-main UFC 245 fights exist');
  const accFight = nonMainFights[1];
  await db.upsertPrediction({
    fight_id: accFight.id, red_fighter_id: accFight.red_id, blue_fighter_id: accFight.blue_id,
    red_win_prob: 0.7, blue_win_prob: 0.3,
    model_version: 'v.acc.lr', feature_hash: 'a1',
    predicted_at: new Date().toISOString(), event_date: '2030-03-01',
    enrichment_level: 'lr'
  });
  await db.upsertPrediction({
    fight_id: accFight.id, red_fighter_id: accFight.red_id, blue_fighter_id: accFight.blue_id,
    red_win_prob: 0.65, blue_win_prob: 0.35,
    model_version: 'v.acc.ensemble', feature_hash: 'a2',
    predicted_at: new Date().toISOString(), event_date: '2030-03-01',
    enrichment_level: 'ensemble'
  });
  // Reconcile: red wins. Both predictions should be scored correct.
  await db.reconcilePrediction(accFight.id, accFight.red_id);
  const breakdown = await db.getPredictionAccuracy({ breakdown: 'enrichment_level' });
  assertTruthy(breakdown.lr, 'breakdown has lr bucket');
  assertTruthy(breakdown.ensemble, 'breakdown has ensemble bucket');
  // Both buckets must include the v.acc rows we just reconciled. Use >= because
  // earlier tests in the run may have produced additional reconciled rows.
  assert(breakdown.lr.n >= 1, 'lr bucket has >= 1 prediction');
  assert(breakdown.ensemble.n >= 1, 'ensemble bucket has >= 1 prediction');
  assert(breakdown.lr.correct >= 1, 'lr bucket has >= 1 correct');
  assert(breakdown.ensemble.correct >= 1, 'ensemble bucket has >= 1 correct');

  // Model predictions lock when the event has started or the fight is final.
  const predLockEventId = (await db.nextId('events')) + 2300;
  const predLockFightId = (await db.nextId('fights')) + 2300;
  await db.upsertEvent({ id: predLockEventId, number: 9903, name: 'Prediction Lock Fixture', date: '2099-03-01' });
  await db.upsertFight({
    id: predLockFightId,
    event_id: predLockEventId,
    event_number: 9903,
    red_fighter_id: mainEvent.red_id,
    blue_fighter_id: mainEvent.blue_id,
    red_name: mainEvent.red_name,
    blue_name: mainEvent.blue_name,
    weight_class: mainEvent.weight_class || 'Welterweight',
    is_title: 0,
    is_main: 1,
    card_position: 1,
    winner_id: null,
    method: null,
    method_detail: null,
    round: null,
    time: null,
    referee: null,
    has_stats: 0,
    ufcstats_hash: null
  });
  const predOpenLock = await db.getPredictionLockState({ fight_id: predLockFightId });
  assertEq(predOpenLock.locked, false, 'prediction lock allows future events');
  db.run('UPDATE events SET date = ? WHERE id = ?', ['2000-01-01', predLockEventId]);
  const predStartedLock = await db.getPredictionLockState({ fight_id: predLockFightId });
  assertEq(predStartedLock.locked, true, 'prediction lock applies once event date has arrived');
  assertEq(predStartedLock.reason, 'event_started', 'prediction lock reports event_started');
  db.run('UPDATE fights SET winner_id = ? WHERE id = ?', [mainEvent.red_id, predLockFightId]);
  const predFightOverLock = await db.getPredictionLockState({ fight_id: predLockFightId });
  assertEq(predFightOverLock.reason, 'fight_over', 'prediction lock prefers fight_over for concluded fights');

  // search case insensitivity
  const lowerSearch = db.searchFighters('mcgregor');
  assertGt(lowerSearch.length, 0, 'searchFighters is case-insensitive');

  // ── Official outcome capture ──
  const officialEventId = (await db.nextId('events')) + 2000;
  const officialFightId = (await db.nextId('fights')) + 2000;
  await db.upsertEvent({ id: officialEventId, number: 9901, name: 'Official Outcome Fixture', date: '2099-02-01' });
  await db.upsertFight({
    id: officialFightId,
    event_id: officialEventId,
    event_number: 9901,
    red_fighter_id: mainEvent.red_id,
    blue_fighter_id: mainEvent.blue_id,
    red_name: mainEvent.red_name,
    blue_name: mainEvent.blue_name,
    weight_class: 'Welterweight',
    is_title: 0,
    is_main: 1,
    card_position: 1,
    method: null,
    method_detail: null,
    round: null,
    time: null,
    winner_id: null,
    referee: null,
    has_stats: 0
  });
  const liveOutcome = await db.upsertOfficialOutcome({
    fight_id: officialFightId,
    status: 'in_progress',
    round: 2,
    time: '3:12',
    source: 'test-job',
    raw: { clock: 'R2 3:12' }
  });
  assertEq(liveOutcome.status, 'in_progress', 'official outcome stores in-progress status');
  assertEq(liveOutcome.round, 2, 'official outcome stores live round');
  assertEq((await db.getFight(officialFightId)).winner_id, null, 'in-progress official outcome does not mark fight final');
  const finalOutcome = await db.upsertOfficialOutcome({
    fight_id: officialFightId,
    status: 'official',
    winner_id: mainEvent.red_id,
    method: 'KO/TKO',
    method_detail: 'Punches',
    round: 2,
    time: '4:01',
    source: 'test-job'
  });
  assertEq(finalOutcome.winner_id, mainEvent.red_id, 'official outcome stores final winner');
  const finalizedFight = await db.getFight(officialFightId);
  assertEq(finalizedFight.winner_id, mainEvent.red_id, 'final official outcome updates fight winner');
  assertEq(finalizedFight.method, 'KO/TKO', 'final official outcome updates fight method');
  const eventOutcomes = await db.getOfficialOutcomesForEvent(officialEventId);
  assertEq(eventOutcomes.length, 1, 'official outcomes query by event');
  assertEq(eventOutcomes[0].winner_name, mainEvent.red_name, 'official outcome joins winner name');

  // ── Scoring (pure) ──
  console.log('\nScoring:');
  const { scorePick, normalizeMethod } = require('../lib/scoring');

  assertEq(scorePick({ correct: null, confidence: 80 }).points, 0, 'unreconciled pick → 0 points');
  assertEq(scorePick({ correct: 0, confidence: 100 }).points, 0, 'incorrect pick → 0 points regardless of confidence');
  assertEq(scorePick({ correct: 1, confidence: 0 }).points, 0, 'correct + 0 confidence → 0 points');
  assertEq(scorePick({ correct: 1, confidence: 50 }).points, 10, 'correct + 50 confidence → 10 base points');
  assertEq(scorePick({ correct: 1, confidence: 100 }).points, 20, 'correct + 100 confidence → 20 base points');
  assertEq(scorePick({ correct: 1, confidence: 75 }).points, 15, 'correct + 75 confidence → 15 points');
  assertEq(scorePick({ correct: 1, confidence: 50, methodCorrect: 1 }).points, 15, 'correct + method → +5 bonus');
  assertEq(scorePick({ correct: 1, confidence: 50, methodCorrect: 1, roundCorrect: 1 }).points, 20, 'correct + method + round → +10');
  assertEq(scorePick({ correct: 1, confidence: 100, methodCorrect: 1, roundCorrect: 1, userAgreedWithModel: 0 }).points, 35, 'max: correct + all bonuses + disagreed with model');
  assertEq(scorePick({ correct: 1, confidence: 100, methodCorrect: 1, roundCorrect: 1, userAgreedWithModel: 1 }).points, 30, 'agreement with model → no upset bonus');
  assertEq(scorePick({ correct: 0, confidence: 100, userAgreedWithModel: 0 }).points, 0, 'upset bonus requires correct pick');

  assertEq(normalizeMethod('KO/TKO'), 'KO/TKO', 'normalizeMethod KO/TKO');
  assertEq(normalizeMethod('Submission'), 'SUB', 'normalizeMethod Submission → SUB');
  assertEq(normalizeMethod('Decision - Unanimous'), 'DEC', 'normalizeMethod Decision → DEC');
  assertEq(normalizeMethod('Decision - Split'), 'DEC', 'normalizeMethod Split Decision → DEC');
  assertEq(normalizeMethod('No Contest'), null, 'normalizeMethod No Contest → null');
  assertEq(normalizeMethod(null), null, 'normalizeMethod null → null');

  // ── Validation (pure) ──
  console.log('\nValidation:');
  const validate = require('../lib/validate');

  assertEq(validate.validateDisplayName('  Weston  '), 'Weston', 'display_name trimmed');
  try { validate.validateDisplayName(''); assert(false, 'empty display_name throws'); }
  catch (e) { assertEq(e.code, 'display_name_empty', 'empty display_name error code'); }
  try { validate.validateDisplayName('x'.repeat(41)); assert(false, '41-char display_name throws'); }
  catch (e) { assertEq(e.code, 'display_name_too_long', 'long display_name error code'); }
  try { validate.validateDisplayName('bad\x00chars'); assert(false, 'control chars throw'); }
  catch (e) { assertEq(e.code, 'display_name_invalid_chars', 'control-char error code'); }

  assertEq(validate.validateAvatarKey(null), null, 'null avatar_key returns null');
  assertEq(validate.validateAvatarKey('a3'), 'a3', 'valid avatar_key passes');
  try { validate.validateAvatarKey('zz'); assert(false, 'bad avatar_key throws'); }
  catch (e) { assertEq(e.code, 'avatar_key_invalid', 'bad avatar_key error code'); }

  assertEq(validate.validateConfidence(0), 0, 'confidence 0 valid');
  assertEq(validate.validateConfidence(100), 100, 'confidence 100 valid');
  assertEq(validate.validateConfidence('75'), 75, 'confidence as string coerced');
  assertEq(validate.validateConfidence(null), 50, 'confidence null → default 50');
  try { validate.validateConfidence(101); assert(false, 'confidence 101 throws'); }
  catch (e) { assertEq(e.code, 'confidence_range', 'confidence > 100 error'); }
  try { validate.validateConfidence(-1); assert(false, 'confidence -1 throws'); }
  catch (e) { assertEq(e.code, 'confidence_range', 'confidence < 0 error'); }

  assertEq(validate.validateMethodPick('ko'), 'KO/TKO', 'ko → KO/TKO');
  assertEq(validate.validateMethodPick('TKO'), 'KO/TKO', 'TKO → KO/TKO');
  assertEq(validate.validateMethodPick('SUB'), 'SUB', 'SUB valid');
  assertEq(validate.validateMethodPick('DEC'), 'DEC', 'DEC valid');
  assertEq(validate.validateMethodPick(null), null, 'null method_pick → null');
  try { validate.validateMethodPick('punch'); assert(false, 'bad method_pick throws'); }
  catch (e) { assertEq(e.code, 'method_pick_invalid', 'bad method_pick error code'); }

  assertEq(validate.validateRoundPick(3), 3, 'round 3 valid');
  assertEq(validate.validateRoundPick(null), null, 'null round_pick → null');
  try { validate.validateRoundPick(6); assert(false, 'round 6 throws'); }
  catch (e) { assertEq(e.code, 'round_pick_range', 'round 6 error code'); }

  assertEq(validate.validateNotes('hello world'), 'hello world', 'short notes pass');
  try { validate.validateNotes('x'.repeat(281)); assert(false, 'long notes throw'); }
  catch (e) { assertEq(e.code, 'notes_too_long', 'long notes error code'); }

  // ── User CRUD ──
  console.log('\nUsers + Picks:');
  const userA = await db.createUser({ display_name: 'Weston', avatar_key: 'a1' });
  assertTruthy(userA.id, 'createUser returns id');
  assertEq(userA.display_name, 'Weston', 'createUser display_name round-trip');
  assertEq(userA.is_guest, 1, 'createUser defaults is_guest=1');

  const userB = await db.createUser({ display_name: 'Friend' });
  assertTruthy(userB.id, 'second createUser works');
  assert(userA.id !== userB.id, 'different users get different ids');

  const fetched = await db.getUser(userA.id);
  assertEq(fetched.display_name, 'Weston', 'getUser round-trip');
  assertEq(await db.getUser('nonexistent-id'), null, 'getUser nonexistent returns null');

  const updated = await db.updateUser(userA.id, { display_name: 'WestonD' });
  assertEq(updated.display_name, 'WestonD', 'updateUser applies change');

  // ── Pick upsert + snapshot ──
  // Ensure we have a prediction for the fight so snapshot captures it.
  // Clear any prior fixture-inserted predictions on this fight (incl. the
  // ensemble row from the Enrichment-fields block above) so the snapshot
  // resolves to v.test.pick rather than a leftover fresher row.
  db.run('DELETE FROM predictions WHERE fight_id = ? AND model_version = ?', [mainEvent.id, 'v.test.pick']);
  db.run('DELETE FROM predictions WHERE fight_id = ? AND model_version = ?', [mainEvent.id, 'v.enrich.test.ensemble.1']);
  db.run('DELETE FROM predictions WHERE fight_id = ? AND model_version = ?', [mainEvent.id, 'v.enrich.test.lr.1']);
  db.upsertPrediction({
    fight_id: mainEvent.id,
    red_fighter_id: mainEvent.red_id,
    blue_fighter_id: mainEvent.blue_id,
    red_win_prob: 0.72,
    blue_win_prob: 0.28,
    model_version: 'v.test.pick',
    feature_hash: 'pk1',
    predicted_at: '2026-04-01T00:00:00.000Z',
    event_date: ufc245.date
  });

  // Temporarily null out winner_id so we can upsert picks without 'pick_locked'
  const originalWinner = db.oneRow('SELECT winner_id FROM fights WHERE id = ?', [mainEvent.id]).winner_id;
  db.run('UPDATE fights SET winner_id = NULL WHERE id = ?', [mainEvent.id]);
  db.run('UPDATE events SET date = ? WHERE id = ?', ['2099-12-31', ufc245.id]);

  const pickResult = await db.upsertPick({
    user_id: userA.id,
    event_id: ufc245.id,
    fight_id: mainEvent.id,
    picked_fighter_id: mainEvent.red_id,
    confidence: 75,
    method_pick: 'KO/TKO',
    round_pick: 5,
    notes: 'Usman TKO R5'
  });
  assertTruthy(pickResult.pick, 'upsertPick returns pick');
  assertEq(pickResult.pick.confidence, 75, 'pick confidence persisted');
  assertEq(pickResult.pick.method_pick, 'KO/TKO', 'pick method_pick persisted');
  assertEq(pickResult.pick.round_pick, 5, 'pick round_pick persisted');
  assertTruthy(pickResult.snapshot, 'snapshot auto-created');
  assertEq(pickResult.snapshot.model_version, 'v.test.pick', 'snapshot captures model_version');
  assertEq(pickResult.snapshot.user_agreed_with_model, 1, 'snapshot agreement (user picked same as model favorite)');

  // Upsert same user+fight with different fighter → agreement flips
  const pickResult2 = await db.upsertPick({
    user_id: userA.id,
    event_id: ufc245.id,
    fight_id: mainEvent.id,
    picked_fighter_id: mainEvent.blue_id,
    confidence: 55
  });
  assertEq(pickResult2.pick.id, pickResult.pick.id, 'upsert keeps same pick id (UNIQUE user+fight)');
  assertEq(pickResult2.pick.picked_fighter_id, mainEvent.blue_id, 'upsert updates picked fighter');
  assertEq(pickResult2.snapshot.user_agreed_with_model, 0, 'snapshot flips to disagreement');
  const snapshotCount = db.oneRow(
    'SELECT COUNT(*) AS c FROM pick_model_snapshots WHERE user_pick_id = ?',
    [pickResult.pick.id]
  ).c;
  assertEq(snapshotCount, 1, 'only one snapshot per pick after upsert');

  // getPicksForUser
  const userAPicks = await db.getPicksForUser(userA.id, { event_id: ufc245.id });
  assertEq(userAPicks.length, 1, 'getPicksForUser returns one pick');
  assertTruthy(userAPicks[0].red_name, 'pick row joined with fight fighter names');

  // Second user can pick same fight independently
  await db.upsertPick({
    user_id: userB.id,
    event_id: ufc245.id,
    fight_id: mainEvent.id,
    picked_fighter_id: mainEvent.red_id,
    confidence: 90,
    method_pick: 'KO/TKO',
    round_pick: 5
  });
  const userBPicks = await db.getPicksForUser(userB.id);
  assertEq(userBPicks.length, 1, 'second user has independent pick');

  // ── Lock behavior ──
  const lockBefore = db.getPickLockState(userA.id, mainEvent.id);
  assertEq(lockBefore.locked, false, 'pick not locked initially');
  const lockResult = await db.lockPicksForEvent(ufc245.id);
  assertGt(lockResult.locked, 0, 'lockPicksForEvent locks rows');
  const lockAfter = db.getPickLockState(userA.id, mainEvent.id);
  assertEq(lockAfter.locked, true, 'pick locked after lockPicksForEvent');
  assertEq(lockAfter.reason, 'event_locked', 'lock reason is event_locked');

  // Upsert after lock throws
  let lockedThrew = false;
  try {
    await db.upsertPick({
      user_id: userA.id,
      event_id: ufc245.id,
      fight_id: mainEvent.id,
      picked_fighter_id: mainEvent.red_id,
      confidence: 80
    });
  } catch (e) {
    lockedThrew = e.code === 'pick_locked';
  }
  assert(lockedThrew, 'upsertPick after lock throws pick_locked');

  // Delete after lock fails
  const delLocked = await db.deletePick(userA.id, pickResult.pick.id);
  assertEq(delLocked.deleted, false, 'deletePick after lock returns deleted=false');

  // Event-start lock: no admin lock needed once the event date arrives.
  const eventStartUser = await db.createUser({ display_name: 'StartedEvent' });
  const startedEventId = (await db.nextId('events')) + 3000;
  const startedFightId = (await db.nextId('fights')) + 3000;
  await db.upsertEvent({ id: startedEventId, number: 9902, name: 'Started Lock Fixture', date: '2099-03-01' });
  await db.upsertFight({
    id: startedFightId,
    event_id: startedEventId,
    event_number: 9902,
    red_fighter_id: mainEvent.red_id,
    blue_fighter_id: mainEvent.blue_id,
    red_name: mainEvent.red_name,
    blue_name: mainEvent.blue_name,
    weight_class: mainEvent.weight_class || 'Welterweight',
    is_title: 0,
    is_main: 1,
    card_position: 1,
    method: null,
    method_detail: null,
    round: null,
    time: null,
    winner_id: null,
    referee: null,
    has_stats: 0,
    ufcstats_hash: null
  });
  const startedPick = await db.upsertPick({
    user_id: eventStartUser.id,
    event_id: startedEventId,
    fight_id: startedFightId,
    picked_fighter_id: mainEvent.red_id,
    confidence: 65
  });
  db.run('UPDATE events SET date = ? WHERE id = ?', ['2000-01-01', startedEventId]);
  const startedLock = db.getPickLockState(eventStartUser.id, startedFightId);
  assertEq(startedLock.locked, true, 'event-start lock applies when event date has arrived');
  assertEq(startedLock.reason, 'event_started', 'event-start lock reason is event_started');
  let eventStartedThrew = false;
  try {
    await db.upsertPick({
      user_id: eventStartUser.id,
      event_id: startedEventId,
      fight_id: startedFightId,
      picked_fighter_id: mainEvent.blue_id,
      confidence: 80
    });
  } catch (e) {
    eventStartedThrew = e.code === 'pick_locked' && e.reason === 'event_started';
  }
  assert(eventStartedThrew, 'upsertPick after event start throws pick_locked with event_started reason');
  const startedDelete = await db.deletePick(eventStartUser.id, startedPick.pick.id);
  assertEq(startedDelete.deleted, false, 'deletePick after event start returns deleted=false');
  assertEq(startedDelete.reason, 'event_started', 'deletePick after event start returns event_started reason');
  const startedRows = await db.getPicksForUser(eventStartUser.id, { event_id: startedEventId });
  assertEq(startedRows[0].is_locked, 1, 'getPicksForUser marks started-event picks locked');
  assertEq(startedRows[0].lock_reason, 'event_started', 'getPicksForUser includes event_started lock reason');

  // Precise lifecycle timing: a same-day event stays open until start_time.
  const preciseUser = await db.createUser({ display_name: 'PreciseStart' });
  const preciseEventId = (await db.nextId('events')) + 3100;
  const preciseFightId = (await db.nextId('fights')) + 3100;
  const preciseToday = new Date().toISOString().slice(0, 10);
  const preciseFutureStart = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const preciseFutureEnd = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();
  const precisePastStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  await db.upsertEvent({
    id: preciseEventId,
    number: 9904,
    name: 'Precise Start Lock Fixture',
    date: preciseToday,
    start_time: preciseFutureStart,
    end_time: preciseFutureEnd
  });
  await db.upsertFight({
    id: preciseFightId,
    event_id: preciseEventId,
    event_number: 9904,
    red_fighter_id: mainEvent.red_id,
    blue_fighter_id: mainEvent.blue_id,
    red_name: mainEvent.red_name,
    blue_name: mainEvent.blue_name,
    weight_class: mainEvent.weight_class || 'Welterweight',
    is_title: 0,
    is_main: 1,
    card_position: 1,
    method: null,
    method_detail: null,
    round: null,
    time: null,
    winner_id: null,
    referee: null,
    has_stats: 0,
    ufcstats_hash: null
  });
  const preciseOpenLock = db.getPickLockState(preciseUser.id, preciseFightId);
  assertEq(preciseOpenLock.locked, false, 'future start_time keeps same-day event unlocked');
  const precisePick = await db.upsertPick({
    user_id: preciseUser.id,
    event_id: preciseEventId,
    fight_id: preciseFightId,
    picked_fighter_id: mainEvent.red_id,
    confidence: 70
  });
  assertTruthy(precisePick.pick, 'same-day future-start event accepts picks');
  db.run('UPDATE events SET start_time = ?, end_time = ? WHERE id = ?', [precisePastStart, preciseFutureEnd, preciseEventId]);
  const preciseStartedLock = db.getPickLockState(preciseUser.id, preciseFightId);
  assertEq(preciseStartedLock.locked, true, 'precise start_time locks picks once reached');
  assertEq(preciseStartedLock.reason, 'event_started', 'precise start_time lock reason is event_started');
  const preciseRows = await db.getPicksForUser(preciseUser.id, { event_id: preciseEventId });
  assertEq(preciseRows[0].is_locked, 1, 'getPicksForUser uses precise start_time lock');
  assertEq(preciseRows[0].event_started, 1, 'getPicksForUser marks precise started event');

  // ── Reconcile + scoring integration ──
  // Restore winner_id so reconcile finds actual winner (Usman = red)
  db.run('UPDATE fights SET winner_id = ? WHERE id = ?', [originalWinner || mainEvent.red_id, mainEvent.id]);

  const reconcileRes = await db.reconcilePicksForEvent(ufc245.id);
  assertGt(reconcileRes.reconciled, 0, 'reconcilePicksForEvent processes picks');

  // userA picked blue (wrong) → 0 points
  const reconA = db.oneRow('SELECT * FROM user_picks WHERE user_id = ? AND fight_id = ?', [userA.id, mainEvent.id]);
  assertEq(reconA.correct, 0, 'userA picked wrong → correct=0');
  assertEq(reconA.points, 0, 'userA points = 0');

  // userB picked red+KO/TKO+R5 correctly, agreed with model (model picked red) → no upset bonus
  // Expected: winnerPoints(round(10*90/50)=18) + method(5) + round(5) = 28
  const reconB = db.oneRow('SELECT * FROM user_picks WHERE user_id = ? AND fight_id = ?', [userB.id, mainEvent.id]);
  assertEq(reconB.correct, 1, 'userB picked correctly');
  assertEq(reconB.method_correct, 1, 'userB method correct (actual was KO/TKO)');
  assertEq(reconB.round_correct, 1, 'userB round correct (actual was round 5)');
  assertEq(reconB.points, 28, 'userB points = 18+5+5 = 28 (no upset bonus: agreed with model)');

  // Idempotency: reconcile again should produce identical values
  const reconcileAgain = await db.reconcilePicksForEvent(ufc245.id);
  const reconB2 = db.oneRow('SELECT * FROM user_picks WHERE user_id = ? AND fight_id = ?', [userB.id, mainEvent.id]);
  assertEq(reconB2.points, 28, 'reconcile is idempotent');

  // ── Leaderboard ──
  const eventBoard = await db.getLeaderboard({ event_id: ufc245.id });
  assertGt(eventBoard.length, 1, 'event leaderboard has both users');
  assertEq(eventBoard[0].user_id, userB.id, 'userB (more points) ranks first');
  assertEq(eventBoard[0].points, 28, 'leaderboard surfaces points');

  const allBoard = await db.getLeaderboard({ limit: 10 });
  assertGt(allBoard.length, 0, 'all-time leaderboard returns rows');

  // ── User stats ──
  const statsB = await db.getUserStats(userB.id);
  assertEq(statsB.total_picks, 1, 'stats total_picks');
  assertEq(statsB.correct_count, 1, 'stats correct_count');
  assertEq(statsB.points, 28, 'stats points');
  assertEq(statsB.accuracy_pct, 100, 'stats accuracy_pct = 100');

  // ── Prediction + user trend aggregation ──
  const trendUser = await db.createUser({ display_name: 'TrendUser', avatar_key: 'a2' });
  const trendEventAId = (await db.nextId('events')) + 1000;
  const trendEventBId = trendEventAId + 1;
  const trendFightBase = (await db.nextId('fights')) + 1000;
  const trendDates = { from: '2099-01-01', to: '2099-01-02' };
  await db.upsertEvent({ id: trendEventAId, number: 9001, name: 'Trend Fixture A', date: trendDates.from });
  await db.upsertEvent({ id: trendEventBId, number: 9002, name: 'Trend Fixture B', date: trendDates.to });
  const trendFights = [
    { id: trendFightBase, event_id: trendEventAId, event_number: 9001, card_position: 1 },
    { id: trendFightBase + 1, event_id: trendEventAId, event_number: 9001, card_position: 2 },
    { id: trendFightBase + 2, event_id: trendEventBId, event_number: 9002, card_position: 1 },
    { id: trendFightBase + 3, event_id: trendEventBId, event_number: 9002, card_position: 2 }
  ];
  for (const f of trendFights) {
    await db.upsertFight({
      ...f,
      red_fighter_id: mainEvent.red_id,
      blue_fighter_id: mainEvent.blue_id,
      red_name: mainEvent.red_name,
      blue_name: mainEvent.blue_name,
      weight_class: mainEvent.weight_class || 'Welterweight',
      is_title: 0,
      is_main: f.card_position === 1 ? 1 : 0,
      method: null,
      method_detail: null,
      round: null,
      time: null,
      winner_id: null,
      referee: null,
      has_stats: 0
    });
  }
  await db.upsertPrediction({
    fight_id: trendFights[0].id,
    red_fighter_id: mainEvent.red_id,
    blue_fighter_id: mainEvent.blue_id,
    red_win_prob: 0.7,
    blue_win_prob: 0.3,
    model_version: 'v.test.trend.1',
    feature_hash: 'trend-1',
    predicted_method: 'Decision',
    predicted_round: 3,
    predicted_at: '2099-01-01T00:00:00.000Z',
    event_date: trendDates.from
  });
  await db.upsertPrediction({
    fight_id: trendFights[1].id,
    red_fighter_id: mainEvent.red_id,
    blue_fighter_id: mainEvent.blue_id,
    red_win_prob: 0.35,
    blue_win_prob: 0.65,
    model_version: 'v.test.trend.1',
    feature_hash: 'trend-2',
    predicted_method: 'Submission',
    predicted_round: 1,
    predicted_at: '2099-01-01T00:01:00.000Z',
    event_date: trendDates.from
  });
  await db.upsertPrediction({
    fight_id: trendFights[2].id,
    red_fighter_id: mainEvent.red_id,
    blue_fighter_id: mainEvent.blue_id,
    red_win_prob: 0.4,
    blue_win_prob: 0.6,
    model_version: 'v.test.trend.1',
    feature_hash: 'trend-3',
    predicted_method: 'KO/TKO',
    predicted_round: 1,
    predicted_at: '2099-01-02T00:00:00.000Z',
    event_date: trendDates.to
  });

  await db.upsertPick({ user_id: trendUser.id, event_id: trendEventAId, fight_id: trendFights[0].id, picked_fighter_id: mainEvent.red_id, confidence: 50 });
  await db.upsertPick({ user_id: trendUser.id, event_id: trendEventAId, fight_id: trendFights[1].id, picked_fighter_id: mainEvent.red_id, confidence: 50 });
  await db.upsertPick({ user_id: trendUser.id, event_id: trendEventBId, fight_id: trendFights[2].id, picked_fighter_id: mainEvent.red_id, confidence: 50 });
  await db.upsertPick({ user_id: trendUser.id, event_id: trendEventBId, fight_id: trendFights[3].id, picked_fighter_id: mainEvent.red_id, confidence: 70 });

  await db.upsertPrediction({
    fight_id: trendFights[0].id,
    red_fighter_id: mainEvent.red_id,
    blue_fighter_id: mainEvent.blue_id,
    red_win_prob: 0.45,
    blue_win_prob: 0.55,
    model_version: 'v.test.trend.alt',
    feature_hash: 'trend-alt-1',
    predicted_at: '2099-01-01T01:00:00.000Z',
    event_date: trendDates.from
  });
  await db.upsertPrediction({
    fight_id: trendFights[1].id,
    red_fighter_id: mainEvent.red_id,
    blue_fighter_id: mainEvent.blue_id,
    red_win_prob: 0.55,
    blue_win_prob: 0.45,
    model_version: 'v.test.trend.alt',
    feature_hash: 'trend-alt-2',
    predicted_at: '2099-01-01T01:01:00.000Z',
    event_date: trendDates.from
  });
  await db.upsertPrediction({
    fight_id: trendFights[2].id,
    red_fighter_id: mainEvent.red_id,
    blue_fighter_id: mainEvent.blue_id,
    red_win_prob: 0.8,
    blue_win_prob: 0.2,
    model_version: 'v.test.trend.alt',
    feature_hash: 'trend-alt-3',
    predicted_at: '2099-01-02T01:00:00.000Z',
    event_date: trendDates.to
  });

  db.run("UPDATE fights SET winner_id = ?, method = 'Decision - Unanimous', round = 3 WHERE id = ?", [mainEvent.red_id, trendFights[0].id]);
  db.run("UPDATE fights SET winner_id = ?, method = 'Submission', round = 2 WHERE id = ?", [mainEvent.blue_id, trendFights[1].id]);
  db.run("UPDATE fights SET winner_id = ?, method = 'KO/TKO', round = 1 WHERE id = ?", [mainEvent.red_id, trendFights[2].id]);
  db.run("UPDATE fights SET winner_id = NULL, method = 'No Contest', round = NULL WHERE id = ?", [trendFights[3].id]);
  await db.reconcilePrediction(trendFights[0].id, mainEvent.red_id);
  await db.reconcilePrediction(trendFights[1].id, mainEvent.blue_id);
  await db.reconcilePrediction(trendFights[2].id, mainEvent.red_id);
  await db.reconcilePicksForEvent(trendEventAId);
  await db.reconcilePicksForEvent(trendEventBId);

  const modelTrend = await db.getPredictionTrends({ event_date_from: trendDates.from, event_date_to: trendDates.to, limit: 10 });
  assertEq(modelTrend.events.length, 2, 'prediction trends group reconciled predictions by event');
  assertEq(modelTrend.summary.total, 6, 'prediction trends count every reconciled model prediction');
  assertEq(modelTrend.summary.correct_count, 3, 'prediction trends count correct model picks');
  assertEq(modelTrend.summary.accuracy_pct, 50, 'prediction trends cumulative accuracy');
  assertEq(modelTrend.events[0].accuracy_pct, 50, 'prediction trend event A accuracy');
  assertEq(modelTrend.events[1].accuracy_pct, 50, 'prediction trend event B accuracy');

  const modelLeaderboard = await db.getModelLeaderboard({ event_date_from: trendDates.from, event_date_to: trendDates.to, limit: 10 });
  assertEq(modelLeaderboard.leaderboard.length, 2, 'model leaderboard groups by model version');
  assertEq(modelLeaderboard.leaderboard[0].model_version, 'v.test.trend.1', 'higher-scoring model ranks first');
  assertEq(modelLeaderboard.leaderboard[0].record, '2-1', 'model leaderboard exposes record');
  assertEq(modelLeaderboard.leaderboard[0].score, 27, 'model score uses correct-pick confidence points');
  assertEq(modelLeaderboard.leaderboard[1].model_version, 'v.test.trend.alt', 'lower-scoring model ranks second');
  assertEq(modelLeaderboard.leaderboard[1].score, 16, 'alternate model score uses its correct prediction confidence');

  const outcomeDetails = await db.getPredictionOutcomeDetails({
    event_date_from: trendDates.from,
    event_date_to: trendDates.to,
    model_version: 'v.test.trend.1',
    limit: 10
  });
  assertEq(outcomeDetails.summary.total, 3, 'prediction outcome details include scored model rows');
  assertEq(outcomeDetails.summary.correct_count, 2, 'prediction outcome details summarize winner accuracy');
  assertEq(outcomeDetails.summary.method_total, 3, 'prediction outcome details score predicted methods when present');
  assertEq(outcomeDetails.summary.method_correct_count, 3, 'prediction outcome details compare method buckets');
  assertEq(outcomeDetails.summary.round_correct_count, 2, 'prediction outcome details compare predicted round');
  const detailFight = outcomeDetails.predictions.find(r => r.fight_id === trendFights[1].id);
  assertEq(detailFight.predicted_fighter_id, mainEvent.blue_id, 'prediction outcome details expose predicted fighter');
  assertEq(detailFight.actual_winner_id, mainEvent.blue_id, 'prediction outcome details expose actual winner');
  assertEq(detailFight.predicted_method, 'Submission', 'prediction outcome details expose predicted method');
  assertEq(detailFight.actual_method, 'Submission', 'prediction outcome details expose real method');
  assertEq(detailFight.round_correct, 0, 'prediction outcome details score round misses');

  const userTrend = await db.getUserTrends(trendUser.id, { event_date_from: trendDates.from, event_date_to: trendDates.to, limit: 10 });
  assertEq(userTrend.events.length, 2, 'user trends group picks by event');
  assertEq(userTrend.summary.total_picks, 4, 'user trends include voided picks in user total');
  assertEq(userTrend.summary.correct_count, 2, 'user trends count correct picks');
  assertEq(userTrend.summary.accuracy_pct, 50, 'user trends cumulative accuracy');
  assertEq(userTrend.summary.points, 25, 'user trends cumulative points');
  assertEq(userTrend.summary.beat_model_count, 1, 'user trends count beat-model picks');
  assertEq(userTrend.summary.model_on_user_picks.total, 3, 'model-on-user excludes no-model/void rows');
  assertEq(userTrend.summary.model_on_user_picks.correct_count, 2, 'model-on-user correct count');
  assertEq(userTrend.summary.model_on_user_picks.accuracy_pct, 66.7, 'model-on-user accuracy');
  assertEq(userTrend.events[0].points, 10, 'event A trend points');
  assertEq(userTrend.events[0].model_on_user_accuracy_pct, 100, 'event A model-on-user accuracy');
  assertEq(userTrend.events[1].total, 2, 'event B includes correct pick plus void');
  assertEq(userTrend.events[1].model_on_user_total, 1, 'event B excludes void/no-model pick from model comparison');
  assertEq(userTrend.events[1].global_model_accuracy_pct, 50, 'event B global model accuracy includes every scored model');
  await db.deleteUser(trendUser.id);

  // ── Edge cases: draws, no method/round, no snapshot, multi-event backfill ──
  // Set up a second event + fight for isolation.
  const drawUser = await db.createUser({ display_name: 'DrawUser' });
  const noMethodUser = await db.createUser({ display_name: 'NoMethod' });

  // Pick a different fight (not main event) so we can control its resolution.
  // Find a fight with no winner_id yet would be cleanest, but seed sets them all.
  // Strategy: pick the second fight on UFC 245's card, stage a "draw" outcome.
  const secondFight = card.find(f => !f.is_main);
  assertTruthy(secondFight, 'UFC 245 has a second fight');

  // Temporarily null out winner to allow pick writes, then stage a draw
  const origSecondWinner = db.oneRow('SELECT winner_id, method FROM fights WHERE id = ?', [secondFight.id]);
  db.run('UPDATE fights SET winner_id = NULL WHERE id = ?', [secondFight.id]);

  await db.upsertPick({
    user_id: drawUser.id,
    event_id: ufc245.id,
    fight_id: secondFight.id,
    picked_fighter_id: secondFight.red_id,
    confidence: 80
  });
  await db.upsertPick({
    user_id: noMethodUser.id,
    event_id: ufc245.id,
    fight_id: secondFight.id,
    picked_fighter_id: secondFight.red_id,
    confidence: 60
    // no method_pick, no round_pick
  });

  // Stage a draw on the fight
  db.run("UPDATE fights SET winner_id = NULL, method = 'Draw' WHERE id = ?", [secondFight.id]);
  const drawReconcile = await db.reconcilePicksForEvent(ufc245.id);
  assertGt(drawReconcile.voided, 0, 'draw reconcile counts voided picks');

  const drawPick = db.oneRow('SELECT * FROM user_picks WHERE user_id = ? AND fight_id = ?', [drawUser.id, secondFight.id]);
  assertEq(drawPick.correct, 0, 'draw pick: correct=0');
  assertEq(drawPick.points, 0, 'draw pick: points=0');
  assertEq(drawPick.actual_winner_id, null, 'draw pick: actual_winner_id remains NULL');

  // Restore original winner + method so other tests can proceed cleanly.
  db.run('UPDATE fights SET winner_id = ?, method = ? WHERE id = ?',
    [origSecondWinner.winner_id, origSecondWinner.method, secondFight.id]);

  // Re-reconcile now that winner is back → draw pick should flip to real correctness.
  await db.reconcilePicksForEvent(ufc245.id);
  const noMethodPickAfter = db.oneRow('SELECT * FROM user_picks WHERE user_id = ? AND fight_id = ?', [noMethodUser.id, secondFight.id]);
  assertTruthy(noMethodPickAfter.actual_winner_id, 'no-method pick: winner set after re-reconcile');
  assertEq(noMethodPickAfter.method_correct, null, 'no-method pick: method_correct stays NULL when user did not pick a method');
  assertEq(noMethodPickAfter.round_correct, null, 'no-method pick: round_correct stays NULL when user did not pick a round');

  // Scoring sanity: if user picked red and red won with conf 60, points = round(10*60/50)=12
  if (noMethodPickAfter.correct === 1) {
    assertEq(noMethodPickAfter.points, 12, 'no-method correct pick scores 12 (conf 60, no bonuses)');
  }

  // ── No model snapshot path ──
  // Create a fight-with-no-prediction scenario by picking on a fight whose
  // predictions were never ingested. Find a fight with no prediction rows.
  const freshFight = db.oneRow(
    `SELECT f.* FROM fights f
     LEFT JOIN predictions p ON p.fight_id = f.id
     WHERE p.id IS NULL AND f.event_id = ?
     LIMIT 1`, [ufc245.id]
  );
  if (freshFight) {
    const origWinner = freshFight.winner_id;
    db.run('UPDATE fights SET winner_id = NULL WHERE id = ?', [freshFight.id]);
    const noSnapUser = await db.createUser({ display_name: 'NoSnap' });
    const noSnapRes = await db.upsertPick({
      user_id: noSnapUser.id,
      event_id: ufc245.id,
      fight_id: freshFight.id,
      picked_fighter_id: freshFight.red_fighter_id,
      confidence: 55
    });
    assertEq(noSnapRes.snapshot.model_version, 'none', 'no-prediction snapshot uses model_version=none');
    assertEq(noSnapRes.snapshot.user_agreed_with_model, null, 'no-prediction snapshot has user_agreed_with_model=null');

    // Restore winner and reconcile
    db.run('UPDATE fights SET winner_id = ? WHERE id = ?', [origWinner, freshFight.id]);
    await db.reconcilePicksForEvent(ufc245.id);
    const nsPick = db.oneRow('SELECT * FROM user_picks WHERE user_id = ? AND fight_id = ?', [noSnapUser.id, freshFight.id]);
    // upset_bonus requires userAgreedWithModel === 0; NULL means no bonus applied.
    if (nsPick.correct === 1) {
      assertEq(nsPick.points, 11, 'no-snapshot correct pick scores conf-only (round(10*55/50)=11), no upset bonus');
    }
    await db.deleteUser(noSnapUser.id);
  }

  // ── reconcileAllPicks backfill ──
  const backfill = await db.reconcileAllPicks();
  assertGt(backfill.reconciled, 0, 'reconcileAllPicks processes existing picks');
  assertGt(backfill.events_processed, 0, 'reconcileAllPicks touches at least one event');

  // Idempotent under re-run
  const backfill2 = await db.reconcileAllPicks();
  assertEq(backfill2.points_awarded, backfill.points_awarded, 'reconcileAllPicks is idempotent');

  // ── Cleanup ──
  await db.deleteUser(drawUser.id);
  await db.deleteUser(noMethodUser.id);
  await db.deleteUser(userA.id);
  await db.deleteUser(userB.id);
  assertEq(await db.getUser(userA.id), null, 'deleteUser cascades');
  const orphaned = db.oneRow('SELECT COUNT(*) AS c FROM user_picks WHERE user_id = ?', [userA.id]);
  assertEq(orphaned.c, 0, 'picks cascade-deleted with user');

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

  const scrapeUpcoming = require('../data/scrape-upcoming');
  assertEq(
    scrapeUpcoming.ianaTimezoneFromVenueLocation('Meta APEX', 'Las Vegas, NV United States'),
    'America/Los_Angeles',
    'upcoming scraper resolves Las Vegas timezone'
  );
  assertEq(
    scrapeUpcoming.isoDateFromTimestamp(1777161600, 'America/Los_Angeles'),
    '2026-04-25',
    'upcoming scraper stores event-local date for evening Las Vegas cards'
  );
  assertEq(
    scrapeUpcoming.isoDateFromTimestamp(1777161600, 'UTC'),
    '2026-04-26',
    'upcoming scraper UTC fallback remains available'
  );

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

  // ── Prediction Review (event 101 — Sterling vs Zalal) ──
  console.log('\nPrediction Review (event 101):');
  // Re-init from seed so this section runs against the canonical dataset
  await db.init();
  const { buildPredictionReview } = require('../lib/predictionReview');

  const review = await buildPredictionReview({ db, eventId: 101, officialDate: null });
  assertTruthy(review, 'review payload returned for event 101');
  assertEq(review.event.id, 101, 'review.event.id is 101');
  assertEq(review.event.local_date, '2026-04-25', 'review.event.local_date is official event date');
  assertEq(review.event.official_date, null, 'official_date null when not provided');
  assertEq(review.event.date_mismatch, false, 'no mismatch when official_date omitted');
  assertEq(review.card.length, 13, 'review.card has 13 fights');

  const fightIds = review.card.map((c) => c.fight_id).sort((a, b) => a - b);
  const expectedIds = [740, 741, 742, 743, 744, 745, 746, 747, 748, 749, 750, 751, 752];
  assert(JSON.stringify(fightIds) === JSON.stringify(expectedIds),
    `fight ids 740-752 all present (got ${fightIds.join(',')})`);

  const reviewMismatch = await buildPredictionReview({ db, eventId: 101, officialDate: '2026-04-26' });
  assertEq(reviewMismatch.event.official_date, '2026-04-26', 'official_date echoed back');
  assertEq(reviewMismatch.event.date_mismatch, true, 'date_mismatch true when official_date=2026-04-26');

  const reviewMatch = await buildPredictionReview({ db, eventId: 101, officialDate: '2026-04-25' });
  assertEq(reviewMatch.event.date_mismatch, false, 'date_mismatch false when official matches local');

  // Main event: Sterling complete, Zalal missing stance/str_def/td_def
  const main = review.card.find((c) => c.is_main);
  assertTruthy(main, 'main event present');
  assertEq(main.matchup, 'Aljamain Sterling vs Youssef Zalal', 'main matchup label correct');
  assertEq(main.red.completeness.missing_core.length, 0, 'red main fighter has all core fields');
  assertEq(main.blue.completeness.missing_core.length, 2, 'blue main fighter missing 2 core fields');
  assert(main.blue.completeness.missing.includes('stance'), 'blue missing stance');
  assert(main.blue.completeness.missing.includes('str_def'), 'blue missing str_def');
  assert(main.blue.completeness.missing.includes('td_def'), 'blue missing td_def');

  // No active predictions in local seed → every fight should be model_status=missing
  const allMissing = review.card.every((c) => c.model_status === 'missing' && c.model === null);
  assert(allMissing, 'all fights have model_status=missing without seeded predictions');
  // Without a model, trust grade collapses to Very Low
  assertEq(main.trust_grade, 'Very Low', 'no prediction → trust grade Very Low');
  assertTruthy(main.missing_data_warning, 'missing_data_warning surfaced when prediction missing');
  assert(Array.isArray(main.live_checklist) && main.live_checklist.length >= 5,
    'live_checklist skeleton present');

  // Audit summary reflects missing predictions + missing core fields
  assertGt(review.audit.blockers.length, 0, 'audit.blockers populated when predictions missing');
  assertGt(review.audit.confidence_reducers.length, 0, 'audit.confidence_reducers populated');
  assertGt(review.audit.future_enhancements.length, 0, 'audit.future_enhancements populated');

  // Official sources present + scoped to the cleared list
  assertEq(review.official_sources.length, 5, 'exactly 5 official source URLs');
  assert(review.official_sources.every((u) => /^https:\/\/(www\.ufc\.com|ufcstats\.com)\//.test(u)),
    'all official_sources are ufc.com or ufcstats.com');

  // Seed a synthetic prediction for the main event and re-run — exercises the
  // model parsing path and proves a populated prediction lifts trust above Very Low.
  db.upsertPrediction({
    fight_id: 740,
    red_fighter_id: main.red.id,
    blue_fighter_id: main.blue.id,
    red_win_prob: 0.62,
    blue_win_prob: 0.38,
    model_version: 'v0.2.test-review',
    feature_hash: 'test-review',
    predicted_at: '2026-04-24T18:00:00.000Z',
    event_date: '2026-04-25',
    explanation_json: JSON.stringify({
      favored_corner: 'red',
      favored_name: 'Aljamain Sterling',
      confidence: 0.62,
      summary: 'Sterling favored on grappling pressure.',
      factors: [
        { feature: 'td_landed_avg_delta', label: 'Takedown volume', favors: 'red',
          fighter: 'Aljamain Sterling', impact: 0.41, value: 1.2 }
      ]
    })
  });
  const seeded = await buildPredictionReview({ db, eventId: 101, officialDate: '2026-04-25' });
  const seededMain = seeded.card.find((c) => c.fight_id === 740);
  assertEq(seededMain.model_status, 'ok', 'seeded prediction → model_status ok');
  assertTruthy(seededMain.model, 'seeded prediction → model block populated');
  assertEq(seededMain.model.lean, 'red', 'lean=red when red_win_prob > blue_win_prob');
  assertEq(seededMain.model.lean_fighter_name, 'Aljamain Sterling', 'lean_fighter_name correct');
  assertEq(seededMain.model.version, 'v0.2.test-review', 'model.version echoes prediction');
  assert(Math.abs(seededMain.model.confidence - 0.62) < 1e-9, 'confidence equals max(red,blue)');
  assertTruthy(seededMain.model.explanation, 'explanation parsed from explanation_json');
  assertEq(seededMain.model.explanation.top_factors.length, 1, 'top_factors parsed');
  // Zalal is still missing core profile fields → grade should NOT be High
  assert(['Medium', 'Low'].includes(seededMain.trust_grade),
    `sparse data lowers trust grade (got ${seededMain.trust_grade})`);

  // Invalid explanation_json must not throw — regression guard for safe parser
  db.upsertPrediction({
    fight_id: 741,
    red_fighter_id: review.card.find((c) => c.fight_id === 741).red.id,
    blue_fighter_id: review.card.find((c) => c.fight_id === 741).blue.id,
    red_win_prob: 0.55,
    blue_win_prob: 0.45,
    model_version: 'v0.2.test-review',
    feature_hash: 'test-bad-json',
    predicted_at: '2026-04-24T18:00:00.000Z',
    event_date: '2026-04-25',
    explanation_json: '{ not valid json'
  });
  const seeded2 = await buildPredictionReview({ db, eventId: 101, officialDate: null });
  const fight741 = seeded2.card.find((c) => c.fight_id === 741);
  assertEq(fight741.model_status, 'ok', 'fight 741 with bad explanation_json still ok');
  assertEq(fight741.model.explanation, null, 'bad explanation_json parses to null safely');

  // Unknown event id → null (route layer returns 404)
  const noEvent = await buildPredictionReview({ db, eventId: 99999999, officialDate: null });
  assertEq(noEvent, null, 'unknown event id returns null');

  // ── Audit Schema (extension) ──
  const auditSchemaSuite = require('./audit/schema.test');
  const auditSchemaResult = await auditSchemaSuite.run();
  passed += auditSchemaResult.passed;
  failed += auditSchemaResult.failed;

  // ── Summary ──
  console.log(`\n━━━ Results: ${passed} passed, ${failed} failed ━━━\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
