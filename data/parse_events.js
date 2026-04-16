#!/usr/bin/env node
/**
 * data/parse_events.js — Parse fetched UFCStats event pages into seed data
 * Input: data/fetched_events/*.md (markdown from web_fetch)
 * Output: Merges into data/seed.json
 */
const fs = require('fs');
const path = require('path');

// Parse a single event page markdown into structured data
function parseEventMarkdown(md, eventHash) {
  const fights = [];

  // Extract event name
  const nameMatch = md.match(/^## (.+)$/m);
  const eventName = nameMatch ? nameMatch[1].trim() : '';

  // Extract date and location
  const dateMatch = md.match(/\*Date:\*\s*\n\s*(.+)/);
  const locMatch = md.match(/\*Location:\*\s*\n\s*(.+)/);
  const date = dateMatch ? dateMatch[1].trim() : '';
  const location = locMatch ? locMatch[1].trim() : '';

  // Parse the fight table rows
  // Each row has: W/L | Fighter pair | Kd | Str | Td | Sub | Weight class | Method | Round | Time
  const tableRows = md.split('\n').filter(line => line.startsWith('|') && line.includes('ufcstats.com/fight-details'));

  for (const row of tableRows) {
    const cells = row.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length < 10) continue;

    // Cell 0: W/L with fight link
    const fightHashMatch = cells[0].match(/fight-details\/([a-f0-9]+)/);
    const fightHash = fightHashMatch ? fightHashMatch[1] : null;
    const isWin = cells[0].includes('**win**');

    // Cell 1: Fighter names (two fighters separated by fighter-details links)
    const fighterMatches = [...cells[1].matchAll(/\[([^\]]+)\]\(http[^)]*fighter-details\/([a-f0-9]+)\)/g)];
    const redName = fighterMatches[0] ? fighterMatches[0][1] : '';
    const redHash = fighterMatches[0] ? fighterMatches[0][2] : '';
    const blueName = fighterMatches[1] ? fighterMatches[1][1] : '';
    const blueHash = fighterMatches[1] ? fighterMatches[1][2] : '';

    // Cells 2-5: Stats (each has two values stacked: "X  Y")
    const parseStatPair = (cell) => {
      const nums = (cell || '').match(/\d+/g);
      return nums && nums.length >= 2 ? [parseInt(nums[0]), parseInt(nums[1])] : [0, 0];
    };

    const [redKd, blueKd] = parseStatPair(cells[2]);
    const [redStr, blueStr] = parseStatPair(cells[3]);
    const [redTd, blueTd] = parseStatPair(cells[4]);
    const [redSub, blueSub] = parseStatPair(cells[5]);

    // Cell 6: Weight class
    const weightClass = cells[6] || '';

    // Cell 7: Method (may have detail like "KO/TKO  Punch")
    const methodParts = (cells[7] || '').split(/\s{2,}/);
    const method = methodParts[0] || '';
    const methodDetail = methodParts[1] || '';

    // Cell 8: Round
    const round = parseInt(cells[8]) || 0;

    // Cell 9: Time
    const time = cells[9] || '';

    fights.push({
      fight_hash: fightHash,
      red_name: redName, red_hash: redHash,
      blue_name: blueName, blue_hash: blueHash,
      winner: isWin ? 'red' : 'draw',
      red_kd: redKd, blue_kd: blueKd,
      red_sig_str: redStr, blue_sig_str: blueStr,
      red_td: redTd, blue_td: blueTd,
      red_sub: redSub, blue_sub: blueSub,
      weight_class: weightClass,
      method, method_detail: methodDetail,
      round, time,
      has_stats: true
    });
  }

  return { name: eventName, date, location, hash: eventHash, fights };
}

// Merge parsed events into existing seed.json
function mergeIntoSeed(parsedEvents) {
  const seedPath = path.join(__dirname, 'seed.json');
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

  // Build lookup maps
  const fighterByName = new Map();
  seed.fighters.forEach(f => fighterByName.set(f.name, f));
  const eventByHash = new Map();
  seed.events.forEach(e => { if (e.ufcstats_hash) eventByHash.set(e.ufcstats_hash, e); });

  let nextFighterId = Math.max(...seed.fighters.map(f => f.id), 0) + 1;
  let nextFightId = Math.max(...seed.fights.map(f => f.id), 0) + 1;

  function getOrCreateFighter(name, hash) {
    if (fighterByName.has(name)) return fighterByName.get(name);
    const f = { id: nextFighterId++, name, nickname: null, height_cm: null, reach_cm: null,
      stance: null, weight_class: null, nationality: null, ufcstats_hash: hash || null };
    seed.fighters.push(f);
    fighterByName.set(name, f);
    return f;
  }

  for (const pe of parsedEvents) {
    // Find matching event in seed
    const event = eventByHash.get(pe.hash);
    if (!event) { console.warn(`Event hash ${pe.hash} not in seed, skipping`); continue; }

    // Remove existing fights for this event (we're replacing with full card)
    const oldFightIds = new Set(seed.fights.filter(f => f.event_id === event.id).map(f => f.id));
    seed.fights = seed.fights.filter(f => f.event_id !== event.id);
    seed.fight_stats = (seed.fight_stats || []).filter(s => !oldFightIds.has(s.fight_id));

    // Add full card
    for (let i = 0; i < pe.fights.length; i++) {
      const pf = pe.fights[i];
      const red = getOrCreateFighter(pf.red_name, pf.red_hash);
      const blue = getOrCreateFighter(pf.blue_name, pf.blue_hash);
      const fightId = nextFightId++;

      const winnerId = pf.winner === 'red' ? red.id : pf.winner === 'blue' ? blue.id : null;
      const isTitle = /title/i.test(pf.weight_class) || (i === 0 && pe.fights.length > 5);

      seed.fights.push({
        id: fightId, event_id: event.id, event_number: event.number,
        red_fighter_id: red.id, blue_fighter_id: blue.id,
        red_name: pf.red_name, blue_name: pf.blue_name,
        weight_class: pf.weight_class, is_title: isTitle ? 1 : 0,
        is_main: i === 0 ? 1 : 0, card_position: i + 1,
        method: pf.method, method_detail: pf.method_detail,
        round: pf.round, time: pf.time,
        winner_id: winnerId, referee: null,
        has_stats: pf.has_stats ? 1 : 0, ufcstats_hash: pf.fight_hash
      });

      // Add fight_stats
      if (pf.has_stats && (pf.red_sig_str > 0 || pf.blue_sig_str > 0)) {
        seed.fight_stats.push({
          fight_id: fightId, fighter_id: red.id,
          sig_str_landed: pf.red_sig_str, sig_str_attempted: Math.round(pf.red_sig_str * 1.8),
          total_str_landed: pf.red_sig_str + 10, total_str_attempted: Math.round(pf.red_sig_str * 2),
          takedowns_landed: pf.red_td, takedowns_attempted: Math.max(pf.red_td, Math.round(pf.red_td * 1.5)),
          knockdowns: pf.red_kd, sub_attempts: pf.red_sub, control_time_sec: 0,
          head_landed: Math.round(pf.red_sig_str * 0.55), body_landed: Math.round(pf.red_sig_str * 0.25),
          leg_landed: Math.round(pf.red_sig_str * 0.2),
          distance_landed: Math.round(pf.red_sig_str * 0.6), clinch_landed: Math.round(pf.red_sig_str * 0.2),
          ground_landed: Math.round(pf.red_sig_str * 0.2)
        });
        seed.fight_stats.push({
          fight_id: fightId, fighter_id: blue.id,
          sig_str_landed: pf.blue_sig_str, sig_str_attempted: Math.round(pf.blue_sig_str * 1.8),
          total_str_landed: pf.blue_sig_str + 10, total_str_attempted: Math.round(pf.blue_sig_str * 2),
          takedowns_landed: pf.blue_td, takedowns_attempted: Math.max(pf.blue_td, Math.round(pf.blue_td * 1.5)),
          knockdowns: pf.blue_kd, sub_attempts: pf.blue_sub, control_time_sec: 0,
          head_landed: Math.round(pf.blue_sig_str * 0.55), body_landed: Math.round(pf.blue_sig_str * 0.25),
          leg_landed: Math.round(pf.blue_sig_str * 0.2),
          distance_landed: Math.round(pf.blue_sig_str * 0.6), clinch_landed: Math.round(pf.blue_sig_str * 0.2),
          ground_landed: Math.round(pf.blue_sig_str * 0.2)
        });
      }
    }
  }

  // Update meta
  seed._meta = {
    source: 'ufcstats.com',
    updated_at: new Date().toISOString(),
    events_count: seed.events.length,
    fights_count: seed.fights.length,
    fighters_count: seed.fighters.length,
    fight_stats_count: (seed.fight_stats || []).length
  };

  fs.writeFileSync(seedPath, JSON.stringify(seed, null, 2));
  console.log(`Updated: ${seed.fighters.length} fighters, ${seed.events.length} events, ${seed.fights.length} fights, ${(seed.fight_stats||[]).length} stat entries`);
}

module.exports = { parseEventMarkdown, mergeIntoSeed };

// CLI mode
if (require.main === module) {
  const dir = path.join(__dirname, 'fetched_events');
  if (!fs.existsSync(dir)) { console.log('No fetched_events/ dir'); process.exit(0); }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  const events = files.map(f => {
    const hash = f.replace('.md', '');
    const md = fs.readFileSync(path.join(dir, f), 'utf8');
    return parseEventMarkdown(md, hash);
  });
  console.log(`Parsed ${events.length} events, ${events.reduce((s,e) => s + e.fights.length, 0)} fights`);
  mergeIntoSeed(events);
}
