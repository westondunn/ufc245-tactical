#!/usr/bin/env node
/**
 * data/scrape.js — Pull fight data from ufcstats.com
 *
 * Usage:
 *   node data/scrape.js                    # scrape last 50 numbered events
 *   node data/scrape.js --events 20        # scrape last 20 numbered events
 *   node data/scrape.js --event-hash abc123 # scrape a single event by hash
 *
 * Outputs: data/seed.json (overwrites existing)
 *
 * UFCStats.com is HTTP-only, static HTML, no auth, no rate limiting.
 * Be polite: 1 request/second delay built in.
 */
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const BASE = 'http://ufcstats.com';
const DELAY_MS = 1000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── HTTP fetch with retry ──
async function fetchPage(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'UFC-Tactical-Dashboard/2.0 (github.com/westondunn/ufc245-tactical)' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (e) {
      console.warn(`  [retry ${i + 1}/${retries}] ${e.message}`);
      if (i < retries - 1) await sleep(2000);
      else throw e;
    }
  }
}

// ── Parse helpers ──
function clean(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function parseRecord(text) {
  const m = (text || '').match(/(\d+)-(\d+)-(\d+)/);
  return m ? { w: +m[1], l: +m[2], d: +m[3] } : null;
}

function parseLandedOf(text) {
  const m = clean(text).match(/(\d+)\s+of\s+(\d+)/);
  return m ? { landed: +m[1], attempted: +m[2] } : { landed: 0, attempted: 0 };
}

function parsePct(text) {
  const m = clean(text).match(/(\d+)%/);
  return m ? +m[1] : null;
}

function parseCtrl(text) {
  const m = clean(text).match(/(\d+):(\d+)/);
  return m ? (+m[1] * 60 + +m[2]) : 0;
}

function parseHeight(text) {
  const m = clean(text).match(/(\d+)'\s*(\d+)"/);
  return m ? Math.round(+m[1] * 30.48 + +m[2] * 2.54) : null;
}

function parseReach(text) {
  const m = clean(text).match(/([\d.]+)"/);
  return m ? Math.round(+m[1] * 2.54) : null;
}

function parseWeight(text) {
  const m = clean(text).match(/([\d.]+)\s*lbs/);
  return m ? Math.round(+m[1]) : null;
}

function hashFromUrl(url) {
  const m = (url || '').match(/([a-f0-9]{16})$/);
  return m ? m[1] : null;
}

// ── Step 1: Fetch all completed events, filter numbered ──
async function fetchEventList(maxNumbered = 50) {
  console.log('[1/4] Fetching events list...');
  const html = await fetchPage(`${BASE}/statistics/events/completed?page=all`);
  const $ = cheerio.load(html);
  const events = [];

  $('tr.b-statistics__table-row').each((i, row) => {
    const link = $(row).find('a.b-link');
    if (!link.length) return;
    const name = clean(link.text());
    const href = link.attr('href');
    const hash = hashFromUrl(href);
    if (!hash) return;

    // Extract UFC number from name like "UFC 300: Pereira vs. Hill"
    const numMatch = name.match(/^UFC\s+(\d+)/i);
    if (!numMatch) return; // skip Fight Nights, non-numbered

    const num = +numMatch[1];
    const dateText = clean($(row).find('span.b-statistics__date').text());
    const locationCells = $(row).find('td');
    const location = locationCells.length > 1 ? clean($(locationCells[1]).text()) : '';

    events.push({ num, name, hash, date: dateText, location });
  });

  // Sort descending by number, take the requested count
  events.sort((a, b) => b.num - a.num);
  const selected = events.slice(0, maxNumbered);
  console.log(`  Found ${events.length} numbered events, selected ${selected.length} (UFC ${selected[selected.length-1]?.num}–${selected[0]?.num})`);
  return selected;
}

// ── Step 2: Fetch event detail → list of fight hashes ──
async function fetchEventCard(eventHash) {
  const html = await fetchPage(`${BASE}/event-details/${eventHash}`);
  const $ = cheerio.load(html);
  const fights = [];

  $('tr.b-fight-details__table-row.js-fight-details-click').each((i, row) => {
    const fightUrl = $(row).attr('data-link');
    const fightHash = hashFromUrl(fightUrl);
    if (!fightHash) return;

    // Each cell has two stacked <p> elements: fighter A (top), fighter B (bottom)
    const cols = $(row).find('td');
    const getTexts = (td) => {
      const ps = $(td).find('p.b-fight-details__table-text');
      return ps.map((_, p) => clean($(p).text())).get();
    };

    const winCol = getTexts(cols[0]);     // W/L flags
    const nameCol = getTexts(cols[1]);    // Fighter names
    const kdCol = getTexts(cols[2]);      // Knockdowns
    const strCol = getTexts(cols[3]);     // Sig strikes "X of Y"
    const tdCol = getTexts(cols[4]);      // Takedowns "X of Y"
    const subCol = getTexts(cols[5]);     // Submission attempts

    // Remaining cols: weight class, method, round, time
    const wc = clean($(cols[6]).text());
    const method = clean($(cols[7]).text());
    const round = parseInt(clean($(cols[8]).text())) || 0;
    const time = clean($(cols[9]).text());

    fights.push({
      hash: fightHash,
      red_name: nameCol[0] || '',
      blue_name: nameCol[1] || '',
      weight_class: wc,
      method,
      round,
      time,
      winner: winCol[0] === 'win' ? 'red' : winCol[1] === 'win' ? 'blue' : 'draw',
      card_position: i + 1
    });
  });

  return fights;
}

// ── Step 3: Fetch fight detail → full stats + per-round ──
async function fetchFightDetail(fightHash) {
  const html = await fetchPage(`${BASE}/fight-details/${fightHash}`);
  const $ = cheerio.load(html);

  const detail = { hash: fightHash, fighters: [], method_detail: '', referee: '', round_stats: [] };

  // Parse fighters
  $('div.b-fight-details__person').each((i, el) => {
    const name = clean($(el).find('h3.b-fight-details__person-name a').text());
    const result = clean($(el).find('i.b-fight-details__person-status').text());
    const fighterUrl = $(el).find('h3.b-fight-details__person-name a').attr('href');
    detail.fighters.push({ name, result, hash: hashFromUrl(fighterUrl), side: i === 0 ? 'red' : 'blue' });
  });

  // Parse metadata (method detail, referee, etc.)
  $('i.b-fight-details__label').each((_, el) => {
    const label = clean($(el).text()).replace(':', '');
    const value = clean($(el).parent().text()).replace(clean($(el).text()), '').trim();
    if (label === 'Method') detail.method_full = value;
    if (label === 'Referee') detail.referee = value;
    if (label === 'Details') detail.method_detail = value;
    if (label === 'Round') detail.round = parseInt(value) || 0;
    if (label === 'Time') detail.time = value;
    if (label === 'Time format') detail.time_format = value;
  });

  // Parse weight class / title
  const boutTitle = clean($('i.b-fight-details__fight-title').text());
  detail.weight_class = boutTitle;
  detail.is_title = /title/i.test(boutTitle) || !!$('img[src*="belt.png"]').length;

  // Parse statistics tables (4 sections: totals summary, totals per-round, sig-strikes summary, sig-strikes per-round)
  const sections = $('section.b-fight-details__section.js-fight-section');

  function parseStatsTable(section, isPerRound) {
    const rows = [];
    let currentRound = 0;
    $(section).find('tr.b-fight-details__table-row').each((_, row) => {
      // Check if this is a round header
      const roundLabel = $(row).find('p.b-fight-details__collapse-link_rnd');
      if (roundLabel.length) {
        const rm = clean(roundLabel.text()).match(/Round\s+(\d+)/i);
        if (rm) currentRound = +rm[1];
        return;
      }

      const cols = $(row).find('td');
      if (cols.length < 2) return;

      // Each td has two <p> elements (fighter A, fighter B)
      const data = [];
      cols.each((ci, td) => {
        const ps = $(td).find('p.b-fight-details__table-text');
        const vals = ps.map((_, p) => clean($(p).text())).get();
        data.push(vals);
      });

      if (data.length > 0 && data[0].length >= 2) {
        rows.push({ round: isPerRound ? currentRound : 0, data });
      }
    });
    return rows;
  }

  // Totals per-round (section index 1)
  if (sections.length >= 2) {
    const totalsRounds = parseStatsTable(sections[1], true);
    for (const row of totalsRounds) {
      if (row.round === 0) continue;
      // Columns: Fighter, KD, Sig.str, Sig.str%, Total str, Td, Td%, Sub.att, Rev., Ctrl
      const d = row.data;
      for (let side = 0; side < 2; side++) {
        const sigStr = parseLandedOf(d[2]?.[side]);
        const totalStr = parseLandedOf(d[4]?.[side]);
        const td = parseLandedOf(d[5]?.[side]);
        detail.round_stats.push({
          round: row.round,
          fighter_idx: side,
          kd: parseInt(d[1]?.[side]) || 0,
          sig_str_landed: sigStr.landed,
          sig_str_attempted: sigStr.attempted,
          sig_str_pct: parsePct(d[3]?.[side]),
          total_str_landed: totalStr.landed,
          total_str_attempted: totalStr.attempted,
          td_landed: td.landed,
          td_attempted: td.attempted,
          td_pct: parsePct(d[6]?.[side]),
          sub_att: parseInt(d[7]?.[side]) || 0,
          reversal: parseInt(d[8]?.[side]) || 0,
          ctrl_sec: parseCtrl(d[9]?.[side])
        });
      }
    }
  }

  // Sig-strikes per-round breakdown (section index 3)
  if (sections.length >= 4) {
    const sigRounds = parseStatsTable(sections[3], true);
    for (const row of sigRounds) {
      if (row.round === 0) continue;
      const d = row.data;
      for (let side = 0; side < 2; side++) {
        // Find matching round_stat entry
        const existing = detail.round_stats.find(r => r.round === row.round && r.fighter_idx === side);
        if (existing) {
          const head = parseLandedOf(d[3]?.[side]);
          const body = parseLandedOf(d[4]?.[side]);
          const leg = parseLandedOf(d[5]?.[side]);
          const dist = parseLandedOf(d[6]?.[side]);
          const clinch = parseLandedOf(d[7]?.[side]);
          const ground = parseLandedOf(d[8]?.[side]);
          existing.head_landed = head.landed;
          existing.head_attempted = head.attempted;
          existing.body_landed = body.landed;
          existing.body_attempted = body.attempted;
          existing.leg_landed = leg.landed;
          existing.leg_attempted = leg.attempted;
          existing.distance_landed = dist.landed;
          existing.distance_attempted = dist.attempted;
          existing.clinch_landed = clinch.landed;
          existing.clinch_attempted = clinch.attempted;
          existing.ground_landed = ground.landed;
          existing.ground_attempted = ground.attempted;
        }
      }
    }
  }

  return detail;
}

// ── Step 4: Fetch fighter profile ──
async function fetchFighterProfile(fighterHash) {
  const html = await fetchPage(`${BASE}/fighter-details/${fighterHash}`);
  const $ = cheerio.load(html);

  const name = clean($('span.b-content__title-highlight').text());
  const recordText = clean($('h2.b-content__title').text());
  const record = parseRecord(recordText);
  const nickname = clean($('p.b-content__Nickname').text());

  const profile = { hash: fighterHash, name, nickname, record };

  // Parse tale-of-the-tape
  $('li.b-list__box-list-item_type_block').each((_, el) => {
    const label = clean($(el).find('i.b-list__box-item-title').text());
    const value = clean($(el).text()).replace(label, '').trim();
    if (label === 'Height:') profile.height_cm = parseHeight(value);
    if (label === 'Weight:') profile.weight_lbs = parseWeight(value);
    if (label === 'Reach:') profile.reach_cm = parseReach(value);
    if (label === 'STANCE:') profile.stance = value || null;
    if (label === 'DOB:') profile.dob = value || null;
  });

  // Career stats
  $('div.b-list__info-box_style_middle-small li').each((_, el) => {
    const label = clean($(el).find('i.b-list__box-item-title').text());
    const value = clean($(el).text()).replace(label, '').trim();
    if (label === 'SLpM:') profile.slpm = parseFloat(value) || 0;
    if (label === 'Str. Acc.:') profile.str_acc = parsePct(value);
    if (label === 'SApM:') profile.sapm = parseFloat(value) || 0;
    if (label === 'Str. Def:') profile.str_def = parsePct(value);
    if (label === 'TD Avg.:') profile.td_avg = parseFloat(value) || 0;
    if (label === 'TD Acc.:') profile.td_acc = parsePct(value);
    if (label === 'TD Def.:') profile.td_def = parsePct(value);
    if (label === 'Sub. Avg.:') profile.sub_avg = parseFloat(value) || 0;
  });

  return profile;
}

// ── Main scrape orchestrator ──
async function main() {
  const args = process.argv.slice(2);
  let maxEvents = 50;
  let singleHash = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--events' && args[i + 1]) maxEvents = parseInt(args[i + 1]);
    if (args[i] === '--event-hash' && args[i + 1]) singleHash = args[i + 1];
  }

  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  UFCStats.com Scraper · UFC Tactical Dashboard ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  // Get event list
  let events;
  if (singleHash) {
    events = [{ num: 0, name: 'Single Event', hash: singleHash, date: '', location: '' }];
  } else {
    events = await fetchEventList(maxEvents);
  }

  const allFighters = new Map(); // hash → profile
  const allEvents = [];
  const allFights = [];
  const allRoundStats = [];
  let fightId = 0;

  // Process each event
  for (let ei = 0; ei < events.length; ei++) {
    const evt = events[ei];
    console.log(`\n[2/4] Event ${ei + 1}/${events.length}: ${evt.name}`);
    await sleep(DELAY_MS);

    const card = await fetchEventCard(evt.hash);
    console.log(`  ${card.length} fights on card`);

    allEvents.push({
      number: evt.num,
      name: evt.name,
      date: evt.date,
      location: evt.location,
      hash: evt.hash,
      fight_count: card.length
    });

    // Process each fight
    for (let fi = 0; fi < card.length; fi++) {
      const bout = card[fi];
      fightId++;
      console.log(`  [3/4] Fight ${fi + 1}/${card.length}: ${bout.red_name} vs ${bout.blue_name}`);
      await sleep(DELAY_MS);

      try {
        const detail = await fetchFightDetail(bout.hash);

        allFights.push({
          id: fightId,
          event_hash: evt.hash,
          event_number: evt.num,
          hash: bout.hash,
          red_name: detail.fighters[0]?.name || bout.red_name,
          blue_name: detail.fighters[1]?.name || bout.blue_name,
          red_hash: detail.fighters[0]?.hash,
          blue_hash: detail.fighters[1]?.hash,
          weight_class: detail.weight_class || bout.weight_class,
          is_title: detail.is_title ? 1 : 0,
          method: detail.method_full || bout.method,
          method_detail: detail.method_detail,
          round: detail.round || bout.round,
          time: detail.time || bout.time,
          time_format: detail.time_format,
          winner: bout.winner,
          referee: detail.referee,
          card_position: bout.card_position,
          has_stats: detail.round_stats.length > 0
        });

        // Store per-round stats
        for (const rs of detail.round_stats) {
          allRoundStats.push({
            fight_id: fightId,
            fighter_side: rs.fighter_idx === 0 ? 'red' : 'blue',
            ...rs
          });
        }

        // Queue fighter profiles
        for (const f of detail.fighters) {
          if (f.hash && !allFighters.has(f.hash)) {
            allFighters.set(f.hash, { hash: f.hash, name: f.name, _queued: true });
          }
        }
      } catch (e) {
        console.warn(`    ⚠ Failed: ${e.message}`);
        allFights.push({
          id: fightId, event_hash: evt.hash, event_number: evt.num,
          hash: bout.hash, red_name: bout.red_name, blue_name: bout.blue_name,
          weight_class: bout.weight_class, method: bout.method,
          round: bout.round, time: bout.time, winner: bout.winner,
          card_position: bout.card_position, has_stats: false
        });
      }
    }
  }

  // Fetch fighter profiles
  const fighterHashes = [...allFighters.keys()];
  console.log(`\n[4/4] Fetching ${fighterHashes.length} fighter profiles...`);
  for (let i = 0; i < fighterHashes.length; i++) {
    const h = fighterHashes[i];
    if (i % 20 === 0) console.log(`  ${i}/${fighterHashes.length}...`);
    await sleep(DELAY_MS);
    try {
      const profile = await fetchFighterProfile(h);
      allFighters.set(h, profile);
    } catch (e) {
      console.warn(`  ⚠ Fighter ${h}: ${e.message}`);
    }
  }

  // ── Build seed.json ──
  const fighters = [...allFighters.values()].filter(f => !f._queued);

  // Assign integer IDs
  const fighterIdMap = new Map();
  fighters.forEach((f, i) => { f.id = i + 1; fighterIdMap.set(f.hash, f.id); });

  const eventIdMap = new Map();
  allEvents.forEach((e, i) => { e.id = i + 1; eventIdMap.set(e.hash, e.id); });

  // Map fights to use integer IDs
  const fights = allFights.map(f => ({
    ...f,
    event_id: eventIdMap.get(f.event_hash),
    red_fighter_id: fighterIdMap.get(f.red_hash),
    blue_fighter_id: fighterIdMap.get(f.blue_hash),
    winner_id: f.winner === 'red' ? fighterIdMap.get(f.red_hash) :
               f.winner === 'blue' ? fighterIdMap.get(f.blue_hash) : null
  }));

  // Map round stats to use fighter IDs
  const roundStats = allRoundStats.map(rs => {
    const fight = allFights.find(f => f.id === rs.fight_id);
    return {
      ...rs,
      fighter_id: rs.fighter_side === 'red'
        ? fighterIdMap.get(fight?.red_hash)
        : fighterIdMap.get(fight?.blue_hash)
    };
  });

  const seed = {
    _meta: {
      source: 'ufcstats.com',
      scraped_at: new Date().toISOString(),
      events_count: allEvents.length,
      fights_count: fights.length,
      fighters_count: fighters.length,
      round_stats_count: roundStats.length
    },
    fighters: fighters.map(f => ({
      id: f.id, name: f.name, nickname: f.nickname || null,
      height_cm: f.height_cm || null, reach_cm: f.reach_cm || null,
      weight_lbs: f.weight_lbs || null, stance: f.stance || null,
      dob: f.dob || null, nationality: null,
      weight_class: null, // inferred from fights
      slpm: f.slpm, str_acc: f.str_acc, sapm: f.sapm, str_def: f.str_def,
      td_avg: f.td_avg, td_acc: f.td_acc, td_def: f.td_def, sub_avg: f.sub_avg,
      ufcstats_hash: f.hash
    })),
    events: allEvents.map(e => ({
      id: e.id, number: e.number, name: e.name,
      date: e.date, location: e.location, fight_count: e.fight_count,
      ufcstats_hash: e.hash
    })),
    fights: fights.map(f => ({
      id: f.id, event_id: f.event_id, event_number: f.event_number,
      red_fighter_id: f.red_fighter_id, blue_fighter_id: f.blue_fighter_id,
      red_name: f.red_name, blue_name: f.blue_name,
      weight_class: f.weight_class, is_title: f.is_title,
      method: f.method, method_detail: f.method_detail,
      round: f.round, time: f.time, time_format: f.time_format,
      winner_id: f.winner_id, referee: f.referee,
      card_position: f.card_position, has_stats: f.has_stats,
      ufcstats_hash: f.hash
    })),
    round_stats: roundStats.map(rs => ({
      fight_id: rs.fight_id, fighter_id: rs.fighter_id,
      fighter_side: rs.fighter_side, round: rs.round,
      kd: rs.kd, sig_str_landed: rs.sig_str_landed, sig_str_attempted: rs.sig_str_attempted,
      total_str_landed: rs.total_str_landed, total_str_attempted: rs.total_str_attempted,
      td_landed: rs.td_landed, td_attempted: rs.td_attempted,
      sub_att: rs.sub_att, reversal: rs.reversal, ctrl_sec: rs.ctrl_sec,
      head_landed: rs.head_landed || 0, head_attempted: rs.head_attempted || 0,
      body_landed: rs.body_landed || 0, body_attempted: rs.body_attempted || 0,
      leg_landed: rs.leg_landed || 0, leg_attempted: rs.leg_attempted || 0,
      distance_landed: rs.distance_landed || 0, distance_attempted: rs.distance_attempted || 0,
      clinch_landed: rs.clinch_landed || 0, clinch_attempted: rs.clinch_attempted || 0,
      ground_landed: rs.ground_landed || 0, ground_attempted: rs.ground_attempted || 0
    }))
  };

  const outPath = path.join(__dirname, 'seed.json');
  fs.writeFileSync(outPath, JSON.stringify(seed, null, 2));

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  ✓ ${seed.fighters.length} fighters`);
  console.log(`  ✓ ${seed.events.length} events`);
  console.log(`  ✓ ${seed.fights.length} fights`);
  console.log(`  ✓ ${seed.round_stats.length} round stat entries`);
  console.log(`  → ${outPath}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main().catch(err => {
  console.error('Scraper failed:', err);
  process.exit(1);
});
