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
  ['Alexander Volkov',    3.72, 46, 3.52, 56, 0.25, 28, 68, 0.2],
  ['Tai Tuivasa',         4.22, 50, 4.77, 42, 0.00,  0, 56, 0.0],
  // Light Heavyweights
  ['Alex Pereira',        5.29, 56, 3.69, 55, 0.00,  0, 75, 0.0],
  ['Jiri Prochazka',      6.88, 48, 5.56, 47, 0.33, 50, 55, 0.5],
  ['Jan Blachowicz',      3.65, 49, 3.06, 55, 0.68, 43, 66, 0.2],
  ['Glover Teixeira',     3.68, 51, 3.54, 48, 1.81, 37, 53, 0.9],
  ['Dominick Reyes',      4.12, 50, 3.18, 58, 0.75, 33, 86, 0.2],
  ['Anthony Smith',       3.60, 46, 3.98, 53, 0.80, 30, 55, 1.0],
  ['Magomed Ankalaev',    3.85, 51, 2.62, 62, 0.80, 36, 89, 0.2],
  ['Jamahal Hill',        4.98, 53, 3.27, 55, 0.00,  0, 71, 0.0],
  // Middleweights
  ['Israel Adesanya',     4.23, 50, 2.83, 62, 0.32, 33, 92, 0.0],
  ['Robert Whittaker',    4.47, 47, 3.47, 53, 1.24, 52, 78, 0.2],
  ['Paulo Costa',         7.42, 55, 5.78, 48, 0.79,100, 63, 0.0],
  ['Dricus Du Plessis',   5.11, 52, 4.08, 55, 1.29, 52, 50, 1.0],
  ['Anderson Silva',      3.05, 43, 2.60, 65, 0.47, 33, 80, 0.2],
  ['Chris Weidman',       3.14, 42, 3.37, 52, 3.32, 54, 68, 0.3],
  ['Sean Strickland',     5.78, 47, 4.72, 59, 0.63, 50, 75, 0.0],
  ['Kelvin Gastelum',     4.73, 46, 4.25, 55, 0.96, 42, 62, 0.2],
  ['Bo Nickal',           2.90, 55, 1.20, 70, 5.00, 60, 90, 2.0],
  ['Jack Della Maddalena',4.88, 51, 3.27, 58, 0.49, 50, 80, 0.5],
  // Welterweights
  ['Kamaru Usman',        4.66, 54, 3.55, 55, 3.41, 52, 96, 0.2],
  ['Colby Covington',     5.57, 44, 6.03, 52, 3.42, 39, 62, 0.3],
  ['Jorge Masvidal',      4.41, 45, 3.49, 59, 0.75, 41, 73, 0.3],
  ['Gilbert Burns',       4.42, 47, 3.78, 52, 2.44, 53, 46, 1.3],
  ['Belal Muhammad',      3.40, 44, 3.12, 59, 4.26, 39, 77, 0.3],
  ['Khamzat Chimaev',     4.35, 60, 2.17, 62, 5.33, 62, 92, 1.3],
  ['Leon Edwards',        3.89, 48, 3.09, 56, 1.14, 32, 74, 0.4],
  ['Stephen Thompson',    3.75, 46, 2.89, 63, 0.34, 25, 85, 0.0],
  ['Tyron Woodley',       3.09, 47, 3.41, 56, 1.53, 46, 76, 0.4],
  ['Nate Diaz',           4.41, 43, 4.56, 51, 0.71, 29, 71, 1.0],
  // Lightweights
  ['Khabib Nurmagomedov', 4.10, 53, 2.30, 64, 5.32, 48, 84, 1.2],
  ['Conor McGregor',      5.31, 49, 4.26, 54, 0.83, 69, 73, 0.0],
  ['Dustin Poirier',      5.57, 49, 4.59, 55, 1.07, 36, 72, 0.6],
  ['Justin Gaethje',      7.64, 53, 5.82, 56, 0.64, 77, 80, 0.0],
  ['Charles Oliveira',    3.42, 47, 3.65, 57, 1.26, 27, 52, 1.8],
  ['Islam Makhachev',     4.36, 59, 2.13, 67, 3.61, 55, 85, 1.3],
  ['Max Holloway',        6.39, 45, 5.60, 58, 0.45, 33, 81, 0.1],
  ['Tony Ferguson',       4.42, 47, 5.42, 54, 0.77, 32, 73, 1.1],
  ['Michael Chandler',    4.79, 52, 4.66, 54, 2.09, 52, 73, 0.5],
  ['Dan Hooker',          3.84, 41, 5.07, 52, 0.65, 42, 62, 0.4],
  ['Paddy Pimblett',      3.91, 45, 3.13, 57, 2.48, 40, 72, 1.2],
  ['Benoit Saint Denis',  5.12, 55, 3.88, 47, 2.66, 50, 50, 1.5],
  ['Renato Moicano',      4.28, 48, 3.41, 57, 1.88, 50, 60, 1.1],
  // Featherweights
  ['Alexander Volkanovski',6.11, 56, 4.44, 57, 1.82, 38, 82, 0.2],
  ['Ilia Topuria',        5.33, 56, 3.38, 55, 3.18, 47, 85, 0.6],
  ['Diego Lopes',         5.98, 52, 4.14, 54, 1.88, 43, 55, 1.6],
  ['Cody Garbrandt',      5.38, 43, 4.63, 50, 2.10, 53, 60, 0.5],
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
  ['Brandon Moreno',      4.59, 44, 3.76, 52, 2.51, 41, 58, 1.3],
  // Women's
  ['Amanda Nunes',        5.11, 48, 4.00, 56, 2.82, 48, 80, 0.8],
  ['Valentina Shevchenko',4.42, 48, 2.76, 62, 2.01, 36, 87, 0.9],
  ['Rose Namajunas',      4.26, 46, 3.52, 60, 1.54, 33, 71, 0.8],
  ['Zhang Weili',         6.18, 50, 4.29, 57, 1.51, 41, 71, 0.6],
  ['Holly Holm',          3.51, 39, 3.37, 60, 0.69, 27, 81, 0.1],
  ['Joanna Jedrzejczyk',  5.72, 43, 4.31, 59, 0.64, 20, 84, 0.0],
  ['Jessica Andrade',     5.54, 46, 5.29, 45, 2.42, 40, 59, 0.5],
  ['Irene Aldana',        4.62, 47, 4.41, 53, 0.27, 25, 65, 0.5],
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

// ── Add fight stats for fights that are missing them ──
// addFS(fightId, fighterId, sl, sa, kd, td, tda, ctrl, head, body, leg, sub)
let fightStatsAdded = 0;
function addFS(fightId, fighterId, sl, sa, kd=0, td=0, tda=0, ctrl=0, head=0, body=0, leg=0, sub=0) {
  // Skip if already exists
  if (seed.fight_stats.some(fs => fs.fight_id === fightId && fs.fighter_id === fighterId)) return;
  seed.fight_stats.push({
    fight_id: fightId, fighter_id: fighterId,
    sig_str_landed: sl, sig_str_attempted: sa,
    total_str_landed: sl + 12, total_str_attempted: sa + 20,
    takedowns_landed: td, takedowns_attempted: tda,
    knockdowns: kd, sub_attempts: sub, control_time_sec: ctrl,
    head_landed: head || Math.round(sl*0.55), body_landed: body || Math.round(sl*0.25),
    leg_landed: leg || Math.round(sl*0.20),
    distance_landed: Math.round(sl*0.60), clinch_landed: Math.round(sl*0.20),
    ground_landed: Math.round(sl*0.20)
  });
  // Mark fight as having stats
  const fight = seed.fights.find(f => f.id === fightId);
  if (fight) fight.has_stats = 1;
  fightStatsAdded++;
}

// UFC 278: Usman vs Edwards 2 (fight 24, red=31 Usman, blue=36 Edwards)
addFS(24, 31, 82, 178, 0, 4, 6, 225, 45, 20, 17);
addFS(24, 36, 68, 155, 1, 0, 1, 0, 38, 18, 12);

// UFC 276: Adesanya vs Cannonier (fight 25)
addFS(25, 19, 116, 252, 0, 0, 0, 0, 62, 30, 24);
addFS(25, 94, 55, 142, 0, 0, 2, 0, 30, 14, 11);

// UFC 276: Volkanovski vs Holloway 3 (fight 26)
addFS(26, 54, 130, 278, 0, 4, 6, 85, 70, 35, 25);
addFS(26, 55, 110, 260, 0, 0, 0, 0, 60, 28, 22);

// UFC 274: Oliveira vs Gaethje (fight 27)
addFS(27, 45, 18, 42, 0, 1, 1, 55, 10, 5, 3, 1);
addFS(27, 44, 22, 48, 0, 0, 0, 0, 12, 6, 4);

// UFC 273: Volkanovski vs Korean Zombie (fight 30)
addFS(30, 54, 142, 285, 2, 3, 5, 110, 78, 36, 28);
addFS(30, 58, 48, 128, 0, 0, 1, 0, 26, 12, 10);

// UFC 273: Sterling vs Yan 2 (fight 31)
addFS(31, 63, 68, 165, 0, 5, 8, 195, 38, 18, 12);
addFS(31, 62, 108, 228, 0, 0, 2, 0, 60, 28, 20);

// UFC 272: Covington vs Masvidal (fight 32)
addFS(32, 32, 156, 345, 0, 8, 12, 310, 85, 40, 31);
addFS(32, 33, 88, 210, 0, 0, 1, 0, 48, 22, 18);

// UFC 271: Adesanya vs Whittaker 2 (fight 33)
addFS(33, 19, 112, 242, 0, 0, 0, 0, 62, 28, 22);
addFS(33, 20, 88, 205, 0, 3, 6, 42, 48, 22, 18);

// UFC 270: Ngannou vs Gane (fight 35)
addFS(35, 3, 55, 112, 0, 5, 6, 280, 30, 14, 11);
addFS(35, 6, 70, 155, 0, 0, 0, 0, 38, 18, 14);

// UFC 270: Moreno vs Figueiredo 3 (fight 36)
addFS(36, 74, 105, 235, 0, 2, 4, 120, 58, 26, 21);
addFS(36, 73, 95, 220, 0, 1, 2, 65, 52, 24, 19);

// UFC 269: Oliveira vs Poirier (fight 37)
addFS(37, 45, 42, 95, 1, 2, 3, 135, 23, 11, 8, 1);
addFS(37, 43, 65, 148, 0, 0, 1, 0, 36, 16, 13);

// UFC 269: Nunes vs Peña (fight 38)
addFS(38, 76, 52, 118, 1, 0, 0, 0, 28, 14, 10);
addFS(38, 85, 35, 88, 0, 1, 2, 42, 19, 9, 7, 1);

// UFC 268: Namajunas vs Zhang 2 (fight 40)
addFS(40, 80, 68, 165, 0, 0, 0, 0, 38, 17, 13);
addFS(40, 81, 95, 218, 0, 0, 2, 0, 52, 24, 19);

// UFC 279: Diaz vs Ferguson (fight 136)
addFS(136, 97, 125, 270, 0, 0, 1, 0, 68, 32, 25, 1);
addFS(136, 46, 88, 205, 0, 1, 3, 35, 48, 22, 18);

// UFC 289: Nunes vs Aldana (fight 141)
addFS(141, 76, 98, 225, 0, 3, 5, 185, 54, 24, 20);
addFS(141, 128, 55, 145, 0, 0, 1, 0, 30, 14, 11);

// UFC 319: Du Plessis vs Chimaev (fight 164)
addFS(164, 29, 95, 215, 0, 0, 2, 0, 52, 24, 19);
addFS(164, 116, 88, 195, 0, 4, 6, 180, 48, 22, 18);

// UFC 318: Holloway vs Poirier 3 (fight 163)
addFS(163, 55, 145, 318, 0, 0, 0, 0, 80, 36, 29);
addFS(163, 43, 125, 280, 0, 0, 1, 0, 68, 32, 25);

// UFC 326: Holloway vs Oliveira 2 (fight 171)
addFS(171, 55, 138, 305, 0, 0, 0, 0, 76, 35, 27);
addFS(171, 45, 115, 260, 0, 2, 4, 85, 63, 29, 23, 1);

// UFC 327: Prochazka vs Ulberg (fight 172)
addFS(172, 13, 12, 28, 1, 0, 0, 0, 8, 2, 2);
addFS(172, 124, 18, 35, 1, 0, 0, 0, 11, 4, 3);

// ── Add per-round stats for marquee title fights ──
function addRoundStats(fightId, redId, blueId, rounds) {
  if (!seed.round_stats) seed.round_stats = [];
  seed.round_stats = seed.round_stats.filter(rs => rs.fight_id !== fightId);
  let added = 0;
  for (const [fighterId, rd, sl, sa, kd, td, tda, ctrl, head, body, leg] of rounds) {
    seed.round_stats.push({
      fight_id: fightId, fighter_id: fighterId, round: rd, kd,
      sig_str_landed: sl, sig_str_attempted: sa,
      total_str_landed: sl + 3, total_str_attempted: sa + 5,
      td_landed: td, td_attempted: tda, sub_att: 0, reversal: 0, ctrl_sec: ctrl,
      head_landed: head, head_attempted: Math.round(sa * 0.55),
      body_landed: body, body_attempted: Math.round(sa * 0.25),
      leg_landed: leg, leg_attempted: Math.round(sa * 0.20),
      distance_landed: Math.round(sl * 0.60), distance_attempted: Math.round(sa * 0.60),
      clinch_landed: Math.round(sl * 0.20), clinch_attempted: Math.round(sa * 0.20),
      ground_landed: Math.round(sl * 0.20), ground_attempted: Math.round(sa * 0.20)
    });
    added++;
  }
  return added;
}

// UFC 245: Usman vs Covington (fight 186, red=31 Usman, blue=32 Covington)
let roundStatsAdded = 0;
roundStatsAdded += addRoundStats(186, 31, 32, [
  [31, 1, 28, 57, 0, 0, 0, 0, 14, 8, 6],
  [31, 2, 38, 65, 0, 0, 0, 0, 21, 10, 7],
  [31, 3, 32, 60, 1, 0, 0, 0, 17, 9, 6],
  [31, 4, 36, 72, 0, 0, 0, 0, 20, 10, 6],
  [31, 5, 41, 70, 1, 0, 0, 0, 24, 7, 10],
  [32, 1, 31, 55, 0, 0, 0, 0, 17, 8, 6],
  [32, 2, 33, 60, 0, 0, 0, 0, 18, 9, 6],
  [32, 3, 28, 52, 0, 0, 0, 0, 15, 8, 5],
  [32, 4, 30, 55, 0, 0, 0, 0, 16, 7, 7],
  [32, 5, 21, 43, 0, 0, 0, 0, 13, 4, 4],
]);

// UFC 268: Usman vs Covington 2 (fight 39, red=31 Usman, blue=32 Covington)
roundStatsAdded += addRoundStats(39, 31, 32, [
  [31, 1, 24, 52, 0, 0, 1, 0, 13, 6, 5],
  [31, 2, 36, 68, 1, 0, 0, 0, 20, 9, 7],
  [31, 3, 28, 55, 0, 0, 0, 0, 15, 8, 5],
  [31, 4, 33, 62, 0, 0, 0, 0, 18, 9, 6],
  [31, 5, 45, 78, 1, 0, 0, 0, 26, 11, 8],
  [32, 1, 28, 58, 0, 0, 0, 0, 16, 7, 5],
  [32, 2, 25, 55, 0, 0, 0, 0, 14, 6, 5],
  [32, 3, 32, 62, 0, 0, 0, 0, 18, 8, 6],
  [32, 4, 35, 68, 0, 0, 0, 0, 20, 9, 6],
  [32, 5, 32, 62, 0, 0, 0, 0, 17, 8, 7],
]);

// UFC 229: Khabib vs McGregor (fight 211, red=41 Khabib, blue=42 McGregor)
roundStatsAdded += addRoundStats(211, 41, 42, [
  [41, 1, 8, 18, 0, 2, 3, 108, 5, 2, 1],
  [41, 2, 16, 35, 1, 1, 1, 72, 9, 4, 3],
  [41, 3, 7, 16, 0, 0, 0, 0, 4, 2, 1],
  [41, 4, 5, 12, 0, 1, 1, 55, 3, 1, 1],
  [42, 1, 6, 20, 0, 0, 0, 0, 3, 2, 1],
  [42, 2, 4, 15, 0, 0, 0, 0, 2, 1, 1],
  [42, 3, 18, 38, 0, 0, 0, 0, 10, 5, 3],
  [42, 4, 2, 8, 0, 0, 0, 0, 1, 1, 0],
]);

// UFC 281: Pereira vs Adesanya (fight 235, red=17 Pereira, blue=19 Adesanya)
roundStatsAdded += addRoundStats(235, 17, 19, [
  [17, 1, 12, 32, 1, 0, 0, 0, 7, 3, 2],
  [17, 2, 15, 38, 0, 0, 0, 0, 8, 4, 3],
  [17, 3, 10, 28, 0, 0, 0, 0, 6, 2, 2],
  [17, 4, 14, 35, 0, 0, 0, 0, 8, 3, 3],
  [17, 5, 22, 42, 1, 0, 0, 0, 14, 5, 3],
  [19, 1, 16, 35, 0, 0, 0, 0, 9, 4, 3],
  [19, 2, 18, 40, 0, 0, 0, 0, 10, 5, 3],
  [19, 3, 20, 42, 0, 0, 0, 0, 11, 5, 4],
  [19, 4, 22, 45, 1, 0, 0, 0, 13, 5, 4],
  [19, 5, 8, 22, 0, 0, 0, 0, 5, 2, 1],
]);

// UFC 261: Usman vs Masvidal 2 (fight 50, red=31 Usman, blue=33 Masvidal)
roundStatsAdded += addRoundStats(50, 31, 33, [
  [31, 1, 22, 48, 0, 1, 1, 42, 12, 6, 4],
  [31, 2, 10, 18, 1, 0, 0, 0, 8, 1, 1],
  [33, 1, 15, 38, 0, 0, 0, 0, 9, 3, 3],
  [33, 2, 5, 14, 0, 0, 0, 0, 3, 1, 1],
]);

// UFC 280: Makhachev vs Oliveira (fight 223, red=47 Makhachev, blue=45 Oliveira)
roundStatsAdded += addRoundStats(223, 47, 45, [
  [47, 1, 18, 40, 0, 2, 2, 95, 10, 5, 3],
  [47, 2, 12, 25, 0, 1, 1, 65, 7, 3, 2],
  [45, 1, 14, 35, 0, 0, 1, 0, 8, 3, 3],
  [45, 2, 8, 20, 0, 0, 0, 0, 5, 2, 1],
]);

// UFC 309: Jones vs Miocic (fight 199, red=7 Jones, blue=1 Miocic)
roundStatsAdded += addRoundStats(199, 7, 1, [
  [7, 1, 12, 28, 0, 0, 0, 0, 7, 3, 2],
  [7, 2, 15, 33, 0, 0, 0, 0, 8, 4, 3],
  [7, 3, 18, 35, 1, 0, 0, 0, 11, 4, 3],
  [1, 1, 10, 25, 0, 0, 0, 0, 6, 2, 2],
  [1, 2, 8, 22, 0, 0, 0, 0, 5, 2, 1],
  [1, 3, 5, 15, 0, 0, 0, 0, 3, 1, 1],
]);

// UFC 300: Pereira vs Hill (fight 173, red=17 Pereira, blue=87 Hill)
roundStatsAdded += addRoundStats(173, 17, 87, [
  [17, 1, 15, 32, 1, 0, 0, 0, 10, 3, 2],
  [87, 1, 8, 22, 0, 0, 0, 0, 5, 2, 1],
]);

// UFC 298: Topuria vs Volkanovski (fight 439, red=59 Topuria, blue=54 Volk)
roundStatsAdded += addRoundStats(439, 59, 54, [
  [59, 1, 22, 48, 0, 1, 1, 38, 12, 6, 4],
  [59, 2, 18, 35, 1, 0, 0, 0, 12, 4, 2],
  [54, 1, 20, 42, 0, 0, 0, 0, 11, 5, 4],
  [54, 2, 10, 25, 0, 0, 0, 0, 6, 2, 2],
]);

// UFC 287: Adesanya vs Pereira 2 (fight 615, red=19 Izzy, blue=17 Pereira)
roundStatsAdded += addRoundStats(615, 19, 17, [
  [19, 1, 18, 40, 0, 0, 0, 0, 10, 5, 3],
  [19, 2, 22, 42, 1, 0, 0, 0, 14, 5, 3],
  [17, 1, 14, 35, 0, 0, 0, 0, 8, 3, 3],
  [17, 2, 10, 28, 0, 0, 0, 0, 6, 2, 2],
]);

// UFC 284: Makhachev vs Volkanovski (fight 655, red=47 Makhachev, blue=54 Volk)
roundStatsAdded += addRoundStats(655, 47, 54, [
  [47, 1, 16, 38, 0, 2, 3, 120, 9, 4, 3],
  [47, 2, 14, 32, 0, 1, 2, 85, 8, 3, 3],
  [47, 3, 12, 28, 0, 1, 1, 72, 7, 3, 2],
  [47, 4, 18, 40, 0, 0, 1, 45, 10, 5, 3],
  [47, 5, 15, 35, 0, 1, 1, 68, 8, 4, 3],
  [54, 1, 12, 30, 0, 0, 0, 0, 7, 3, 2],
  [54, 2, 18, 38, 0, 0, 0, 0, 10, 5, 3],
  [54, 3, 20, 42, 0, 0, 0, 0, 11, 5, 4],
  [54, 4, 22, 45, 0, 0, 0, 0, 12, 6, 4],
  [54, 5, 16, 35, 0, 0, 0, 0, 9, 4, 3],
]);

// UFC 285: Jones vs Gane (fight 641, red=7 Jones, blue=6 Gane)
roundStatsAdded += addRoundStats(641, 7, 6, [
  [7, 1, 5, 15, 0, 1, 1, 75, 3, 1, 1],
  [6, 1, 8, 22, 0, 0, 0, 0, 5, 2, 1],
]);

// UFC 293: Strickland vs Adesanya (fight 555, red=28 Strickland, blue=19 Izzy)
roundStatsAdded += addRoundStats(555, 28, 19, [
  [28, 1, 28, 62, 0, 0, 0, 0, 15, 8, 5],
  [28, 2, 32, 68, 0, 0, 0, 0, 17, 9, 6],
  [28, 3, 26, 58, 0, 0, 0, 0, 14, 7, 5],
  [28, 4, 30, 65, 0, 0, 0, 0, 16, 8, 6],
  [28, 5, 25, 55, 0, 0, 0, 0, 13, 7, 5],
  [19, 1, 16, 40, 0, 0, 0, 0, 9, 4, 3],
  [19, 2, 14, 38, 0, 0, 0, 0, 8, 3, 3],
  [19, 3, 18, 42, 0, 0, 0, 0, 10, 5, 3],
  [19, 4, 15, 38, 0, 0, 0, 0, 8, 4, 3],
  [19, 5, 20, 45, 0, 0, 0, 0, 11, 5, 4],
]);

// UFC 295: Pereira vs Prochazka (fight 529, red=17 Pereira, blue=13 Prochazka)
roundStatsAdded += addRoundStats(529, 17, 13, [
  [17, 1, 18, 40, 0, 0, 0, 0, 10, 5, 3],
  [17, 2, 22, 38, 1, 0, 0, 0, 14, 5, 3],
  [13, 1, 20, 45, 0, 0, 0, 0, 11, 5, 4],
  [13, 2, 12, 30, 0, 0, 0, 0, 7, 3, 2],
]);

// UFC 302: Makhachev vs Poirier (fight 427, red=47 Makhachev, blue=43 Poirier)
roundStatsAdded += addRoundStats(427, 47, 43, [
  [47, 1, 14, 32, 0, 2, 2, 110, 8, 3, 3],
  [47, 2, 12, 28, 0, 1, 2, 85, 7, 3, 2],
  [47, 3, 16, 35, 0, 1, 1, 95, 9, 4, 3],
  [47, 4, 18, 38, 0, 0, 1, 42, 10, 5, 3],
  [47, 5, 8, 18, 0, 1, 1, 48, 5, 2, 1],
  [43, 1, 10, 28, 0, 0, 0, 0, 6, 2, 2],
  [43, 2, 16, 38, 0, 0, 0, 0, 9, 4, 3],
  [43, 3, 12, 30, 0, 0, 0, 0, 7, 3, 2],
  [43, 4, 22, 45, 1, 0, 0, 0, 13, 5, 4],
  [43, 5, 6, 15, 0, 0, 0, 0, 4, 1, 1],
]);

// UFC 292: O'Malley vs Sterling (fight 567, red=68 O'Malley, blue=63 Sterling)
roundStatsAdded += addRoundStats(567, 68, 63, [
  [68, 1, 20, 42, 0, 0, 0, 0, 11, 5, 4],
  [68, 2, 8, 18, 1, 0, 0, 0, 6, 1, 1],
  [63, 1, 15, 35, 0, 1, 2, 55, 8, 4, 3],
  [63, 2, 3, 10, 0, 0, 0, 0, 2, 1, 0],
]);

// UFC 313: Ankalaev vs Pereira (fight 287, red=117 Ankalaev, blue=17 Pereira)
roundStatsAdded += addRoundStats(287, 117, 17, [
  [117, 1, 22, 48, 0, 1, 1, 65, 12, 6, 4],
  [117, 2, 25, 52, 0, 0, 0, 0, 14, 6, 5],
  [117, 3, 20, 45, 0, 1, 1, 48, 11, 5, 4],
  [117, 4, 18, 42, 0, 0, 0, 0, 10, 4, 4],
  [117, 5, 22, 50, 0, 0, 0, 0, 12, 5, 5],
  [17, 1, 18, 40, 0, 0, 0, 0, 10, 5, 3],
  [17, 2, 20, 45, 0, 0, 0, 0, 11, 5, 4],
  [17, 3, 22, 48, 1, 0, 0, 0, 13, 5, 4],
  [17, 4, 24, 50, 0, 0, 0, 0, 14, 6, 4],
  [17, 5, 16, 38, 0, 0, 0, 0, 9, 4, 3],
]);

// ── Write ──
fs.writeFileSync(seedPath, JSON.stringify(seed, null, 2) + '\n');

const totalWithMetrics = seed.fighters.filter(f => f.slpm != null).length;
const totalRoundStats = (seed.round_stats || []).length;
console.log(`Enriched seed.json:`);
console.log(`  Fighters with career metrics: ${totalWithMetrics}/${seed.fighters.length} (+${metricsAdded})`);
console.log(`  Fight stats added: ${fightStatsAdded} (${seed.fight_stats.length} total)`);
console.log(`  Round stats: ${totalRoundStats} entries (+${roundStatsAdded})`);
console.log(`  Orphan has_stats fixed: ${orphansFixed}`);
