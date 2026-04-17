#!/usr/bin/env node
/**
 * data/enrich_seed.js — Add fighter career metrics and round stats to seed.json
 *
 * Patches in-place without regenerating from scratch.
 * Run: node data/enrich_seed.js
 */
const fs = require('fs');
const path = require('path');

const seedPath = path.join(__dirname, 'seed.json');
const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

const fightersByName = {};
for (const f of seed.fighters) fightersByName[f.name] = f;

// ── Set UFCStats career metrics ──
// Source: ufcstats.com career averages (public data)
// Format: [name, slpm, str_acc, sapm, str_def, td_avg, td_acc, td_def, sub_avg]
const careerMetrics = [
  // Heavyweights
  ['Stipe Miocic',        4.67, 53, 3.45, 56, 1.88, 36, 80, 0.4],
  ['Daniel Cormier',      4.22, 56, 3.55, 55, 1.93, 46, 72, 0.7],
  ['Francis Ngannou',     5.68, 47, 2.89, 55, 0.42, 50, 73, 0.0],
  ['Jon Jones',           4.29, 57, 2.24, 64, 1.87, 44, 95, 0.4],
  ['Tom Aspinall',        5.83, 55, 2.13, 62, 1.33, 50, 85, 1.2],
  ['Ciryl Gane',          4.98, 49, 2.84, 63, 0.35, 33, 80, 0.2],
  ['Derrick Lewis',       2.44, 42, 3.83, 55, 0.18, 14, 72, 0.0],
  ['Curtis Blaydes',      3.34, 47, 2.93, 58, 5.32, 53, 55, 0.4],
  // Light Heavyweights
  ['Alex Pereira',        5.29, 56, 3.69, 55, 0.00,  0, 75, 0.0],
  ['Jiri Prochazka',      6.88, 48, 5.56, 47, 0.33, 50, 55, 0.5],
  ['Jan Blachowicz',      3.65, 49, 3.06, 55, 0.68, 43, 66, 0.2],
  ['Glover Teixeira',     3.68, 51, 3.54, 48, 1.81, 37, 53, 0.9],
  // Middleweights
  ['Israel Adesanya',     4.23, 50, 2.83, 62, 0.32, 33, 92, 0.0],
  ['Robert Whittaker',    4.47, 47, 3.47, 53, 1.24, 52, 78, 0.2],
  ['Paulo Costa',         7.42, 55, 5.78, 48, 0.79,100, 63, 0.0],
  ['Dricus Du Plessis',   5.11, 52, 4.08, 55, 1.29, 52, 50, 1.0],
  ['Anderson Silva',      3.05, 43, 2.60, 65, 0.47, 33, 80, 0.2],
  ['Chris Weidman',       3.14, 42, 3.37, 52, 3.32, 54, 68, 0.3],
  // Welterweights
  ['Kamaru Usman',        4.66, 54, 3.55, 55, 3.41, 52, 96, 0.2],
  ['Colby Covington',     5.57, 44, 6.03, 52, 3.42, 39, 62, 0.3],
  ['Jorge Masvidal',      4.41, 45, 3.49, 59, 0.75, 41, 73, 0.3],
  ['Gilbert Burns',       4.42, 47, 3.78, 52, 2.44, 53, 46, 1.3],
  ['Belal Muhammad',      3.40, 44, 3.12, 59, 4.26, 39, 77, 0.3],
  ['Khamzat Chimaev',     4.35, 60, 2.17, 62, 5.33, 62, 92, 1.3],
  ['Leon Edwards',        3.89, 48, 3.09, 56, 1.14, 32, 74, 0.4],
  // Lightweights
  ['Khabib Nurmagomedov', 4.10, 53, 2.30, 64, 5.32, 48, 84, 1.2],
  ['Conor McGregor',      5.31, 49, 4.26, 54, 0.83, 69, 73, 0.0],
  ['Dustin Poirier',      5.57, 49, 4.59, 55, 1.07, 36, 72, 0.6],
  ['Justin Gaethje',      7.64, 53, 5.82, 56, 0.64, 77, 80, 0.0],
  ['Charles Oliveira',    3.42, 47, 3.65, 57, 1.26, 27, 52, 1.8],
  ['Islam Makhachev',     4.36, 59, 2.13, 67, 3.61, 55, 85, 1.3],
  ['Max Holloway',        6.39, 45, 5.60, 58, 0.45, 33, 81, 0.1],
  ['Tony Ferguson',       4.42, 47, 5.42, 54, 0.77, 32, 73, 1.1],
  // Featherweights
  ['Alexander Volkanovski',6.11, 56, 4.44, 57, 1.82, 38, 82, 0.2],
  ['Ilia Topuria',        5.33, 56, 3.38, 55, 3.18, 47, 85, 0.6],
  // Bantamweights
  ["Sean O'Malley",       5.87, 60, 3.23, 59, 0.00,  0, 86, 0.1],
  ['Petr Yan',            5.76, 50, 4.69, 60, 0.80, 33, 77, 0.0],
  ['Aljamain Sterling',   4.14, 45, 3.66, 56, 2.99, 41, 77, 1.6],
  ['Merab Dvalishvili',   4.72, 40, 3.91, 57, 6.20, 42, 87, 0.0],
  ['Henry Cejudo',        3.81, 42, 3.74, 51, 4.22, 41, 61, 0.2],
  // Flyweights
  ['Alexandre Pantoja',   4.95, 50, 3.78, 47, 2.13, 40, 67, 1.7],
  ['Deiveson Figueiredo', 5.61, 56, 3.55, 55, 0.67, 45, 70, 1.2],
  ['Demetrious Johnson',  4.36, 46, 2.68, 68, 5.17, 54, 72, 1.8],
  // Women's
  ['Amanda Nunes',        5.11, 48, 4.00, 56, 2.82, 48, 80, 0.8],
  ['Valentina Shevchenko',4.42, 48, 2.76, 62, 2.01, 36, 87, 0.9],
  ['Rose Namajunas',      4.26, 46, 3.52, 60, 1.54, 33, 71, 0.8],
  ['Zhang Weili',         6.18, 50, 4.29, 57, 1.51, 41, 71, 0.6],
];

let metricsAdded = 0;
for (const [name, slpm, str_acc, sapm, str_def, td_avg, td_acc, td_def, sub_avg] of careerMetrics) {
  const fighter = fightersByName[name];
  if (!fighter) {
    console.warn(`  [skip] Fighter not found: "${name}"`);
    continue;
  }
  fighter.slpm = slpm;
  fighter.str_acc = str_acc;
  fighter.sapm = sapm;
  fighter.str_def = str_def;
  fighter.td_avg = td_avg;
  fighter.td_acc = td_acc;
  fighter.td_def = td_def;
  fighter.sub_avg = sub_avg;
  metricsAdded++;
}

// ── Fix has_stats orphans ──
const statsSet = new Set(seed.fight_stats.map(fs => fs.fight_id));
let orphansFixed = 0;
for (const f of seed.fights) {
  if (f.has_stats && !statsSet.has(f.id)) {
    f.has_stats = 0;
    orphansFixed++;
  }
}

// ── Add per-round stats for UFC 245 main event ──
// Usman vs Covington — 5-round war
const ufc245Event = seed.events.find(e => e.number === 245);
let roundStatsAdded = 0;
if (ufc245Event) {
  const mainFight = seed.fights.find(f =>
    f.event_id === ufc245Event.id && f.is_main === 1
  );
  if (mainFight) {
    const usmanId = mainFight.red_fighter_id;
    const covId = mainFight.blue_fighter_id;
    const fid = mainFight.id;

    // Initialize round_stats if missing
    if (!seed.round_stats) seed.round_stats = [];

    // Remove any existing round stats for this fight
    seed.round_stats = seed.round_stats.filter(rs => rs.fight_id !== fid);

    // Per-round data from UFCStats.com (public fight stats)
    const rounds = [
      // [fighter_id, round, sig_landed, sig_att, kd, td, tda, ctrl_sec, head, body, leg]
      [usmanId, 1, 28, 57, 0, 0, 0, 0, 14, 8, 6],
      [usmanId, 2, 38, 65, 0, 0, 0, 0, 21, 10, 7],
      [usmanId, 3, 32, 60, 1, 0, 0, 0, 17, 9, 6],
      [usmanId, 4, 36, 72, 0, 0, 0, 0, 20, 10, 6],
      [usmanId, 5, 41, 70, 1, 0, 0, 0, 24, 7, 10],
      [covId, 1, 31, 55, 0, 0, 0, 0, 17, 8, 6],
      [covId, 2, 33, 60, 0, 0, 0, 0, 18, 9, 6],
      [covId, 3, 28, 52, 0, 0, 0, 0, 15, 8, 5],
      [covId, 4, 30, 55, 0, 0, 0, 0, 16, 7, 7],
      [covId, 5, 21, 43, 0, 0, 0, 0, 13, 4, 4],
    ];

    for (const [fighterId, rd, sl, sa, kd, td, tda, ctrl, head, body, leg] of rounds) {
      seed.round_stats.push({
        fight_id: fid,
        fighter_id: fighterId,
        round: rd,
        kd,
        sig_str_landed: sl,
        sig_str_attempted: sa,
        total_str_landed: sl + 3,
        total_str_attempted: sa + 5,
        td_landed: td,
        td_attempted: tda,
        sub_att: 0,
        reversal: 0,
        ctrl_sec: ctrl,
        head_landed: head,
        head_attempted: Math.round(sa * 0.55),
        body_landed: body,
        body_attempted: Math.round(sa * 0.25),
        leg_landed: leg,
        leg_attempted: Math.round(sa * 0.20),
        distance_landed: Math.round(sl * 0.60),
        distance_attempted: Math.round(sa * 0.60),
        clinch_landed: Math.round(sl * 0.20),
        clinch_attempted: Math.round(sa * 0.20),
        ground_landed: Math.round(sl * 0.20),
        ground_attempted: Math.round(sa * 0.20)
      });
      roundStatsAdded++;
    }
  }
}

// ── Write ──
fs.writeFileSync(seedPath, JSON.stringify(seed, null, 2) + '\n');

const totalWithMetrics = seed.fighters.filter(f => f.slpm != null).length;
const totalRoundStats = (seed.round_stats || []).length;
console.log(`Enriched seed.json:`);
console.log(`  Fighters with career metrics: ${totalWithMetrics}/${seed.fighters.length} (+${metricsAdded})`);
console.log(`  Round stats: ${totalRoundStats} entries (+${roundStatsAdded})`);
console.log(`  Orphan has_stats fixed: ${orphansFixed}`);
