/**
 * data/scrapers/ufcstats-fight.js
 *
 * Parses an ufcstats.com fight-details page into:
 *   { ufcstats_hash, method_full, method_detail, referee, round, time, time_format,
 *     weight_class, is_title, fighters: [{name, hash, side, result}], fight_stats: [...×2],
 *     round_stats: [...] }
 *
 * Selectors mirror data/scrape.js's existing inline parser.
 */
const cheerio = require('cheerio');
const { fetchPage } = require('./http');

const BASE = 'http://ufcstats.com';

function clean(t) { return (t || '').replace(/\s+/g, ' ').trim(); }

function hashFromUrl(url) {
  const m = (url || '').match(/([a-f0-9]{16})/);
  return m ? m[1] : null;
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

function parseFightPage(html, fightHash) {
  const $ = cheerio.load(html);

  const detail = {
    ufcstats_hash: fightHash || null,
    fighters: [],
    method_full: '',
    method_detail: '',
    referee: '',
    round: null,
    time: null,
    time_format: null,
    weight_class: null,
    is_title: false,
    fight_stats: [],
    round_stats: [],
  };

  // Fighters (red side first)
  $('div.b-fight-details__person').each((i, el) => {
    const name = clean($(el).find('h3.b-fight-details__person-name a').text());
    const result = clean($(el).find('i.b-fight-details__person-status').text());
    const fighterUrl = $(el).find('h3.b-fight-details__person-name a').attr('href');
    detail.fighters.push({
      name,
      hash: hashFromUrl(fighterUrl),
      side: i === 0 ? 'red' : 'blue',
      result,
    });
  });

  // Fight metadata
  $('i.b-fight-details__label').each((_, el) => {
    const label = clean($(el).text()).replace(':', '');
    const value = clean($(el).parent().text()).replace(clean($(el).text()), '').trim();
    if (label === 'Method') detail.method_full = value;
    else if (label === 'Referee') detail.referee = value;
    else if (label === 'Details') detail.method_detail = value;
    else if (label === 'Round') detail.round = parseInt(value, 10) || null;
    else if (label === 'Time') detail.time = value || null;
    else if (label === 'Time format') detail.time_format = value || null;
  });

  const boutTitle = clean($('i.b-fight-details__fight-title').text());
  detail.weight_class = boutTitle || null;
  detail.is_title = /title/i.test(boutTitle) || $('img[src*="belt.png"]').length > 0;

  // Stats sections: 0=totals summary, 1=totals per-round, 2=sig summary, 3=sig per-round
  const sections = $('section.b-fight-details__section.js-fight-section');

  function parseStatsTable(section, isPerRound) {
    const rows = [];
    // Header rows have <th> not <td>; data rows have <td>. ufcstats per-round
    // tables hold 5 data rows in tbody, one per round, with no inline
    // "Round N" labels — derive round from data-row index.
    const dataRowEls = $(section).find('tr.b-fight-details__table-row').toArray()
      .filter(r => $(r).find('td').length > 0);
    dataRowEls.forEach((row, idx) => {
      const cols = $(row).find('td');
      const data = [];
      cols.each((_, td) => {
        const ps = $(td).find('p.b-fight-details__table-text');
        const vals = ps.map((_, p) => clean($(p).text())).get();
        data.push(vals);
      });
      if (data.length > 0 && data[0].length >= 2) {
        rows.push({ round: isPerRound ? (idx + 1) : 0, data });
      }
    });
    return rows;
  }

  // Totals summary (section 1): one row with two fighters' bout totals
  if (sections.length >= 2) {
    const totalsSummary = parseStatsTable(sections[1], false);
    if (totalsSummary[0]) {
      const d = totalsSummary[0].data;
      // Columns: Fighter, KD, Sig.str, Sig.str%, Total str, Td, Td%, Sub.att, Rev., Ctrl
      for (let side = 0; side < 2; side++) {
        const sigStr = parseLandedOf(d[2] && d[2][side]);
        const totalStr = parseLandedOf(d[4] && d[4][side]);
        const td = parseLandedOf(d[5] && d[5][side]);
        detail.fight_stats.push({
          fighter_idx: side,
          fighter_name: detail.fighters[side] ? detail.fighters[side].name : null,
          fighter_hash: detail.fighters[side] ? detail.fighters[side].hash : null,
          knockdowns: parseInt(d[1] && d[1][side], 10) || 0,
          sig_str_landed: sigStr.landed,
          sig_str_attempted: sigStr.attempted,
          sig_str_pct: parsePct(d[3] && d[3][side]),
          total_str_landed: totalStr.landed,
          total_str_attempted: totalStr.attempted,
          takedowns_landed: td.landed,
          takedowns_attempted: td.attempted,
          takedowns_pct: parsePct(d[6] && d[6][side]),
          sub_attempts: parseInt(d[7] && d[7][side], 10) || 0,
          reversals: parseInt(d[8] && d[8][side], 10) || 0,
          control_time_sec: parseCtrl(d[9] && d[9][side]),
        });
      }
    }
  }

  // Per-round totals (section 2)
  if (sections.length >= 3) {
    const totalsRounds = parseStatsTable(sections[2], true);
    for (const row of totalsRounds) {
      if (row.round === 0) continue;
      const d = row.data;
      for (let side = 0; side < 2; side++) {
        const sigStr = parseLandedOf(d[2] && d[2][side]);
        const totalStr = parseLandedOf(d[4] && d[4][side]);
        const td = parseLandedOf(d[5] && d[5][side]);
        detail.round_stats.push({
          round: row.round,
          fighter_idx: side,
          kd: parseInt(d[1] && d[1][side], 10) || 0,
          sig_str_landed: sigStr.landed,
          sig_str_attempted: sigStr.attempted,
          sig_str_pct: parsePct(d[3] && d[3][side]),
          total_str_landed: totalStr.landed,
          total_str_attempted: totalStr.attempted,
          td_landed: td.landed,
          td_attempted: td.attempted,
          td_pct: parsePct(d[6] && d[6][side]),
          sub_att: parseInt(d[7] && d[7][side], 10) || 0,
          reversal: parseInt(d[8] && d[8][side], 10) || 0,
          ctrl_sec: parseCtrl(d[9] && d[9][side]),
        });
      }
    }
  }

  // Sig-strikes per-round (section 4) — adds head/body/leg/distance/clinch/ground
  if (sections.length >= 5) {
    const sigRounds = parseStatsTable(sections[4], true);
    for (const row of sigRounds) {
      if (row.round === 0) continue;
      const d = row.data;
      for (let side = 0; side < 2; side++) {
        const existing = detail.round_stats.find(r => r.round === row.round && r.fighter_idx === side);
        if (!existing) continue;
        const head = parseLandedOf(d[3] && d[3][side]);
        const body = parseLandedOf(d[4] && d[4][side]);
        const leg = parseLandedOf(d[5] && d[5][side]);
        const dist = parseLandedOf(d[6] && d[6][side]);
        const clinch = parseLandedOf(d[7] && d[7][side]);
        const ground = parseLandedOf(d[8] && d[8][side]);
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

  return detail;
}

async function fetchFight(hash, opts = {}) {
  const url = `${BASE}/fight-details/${hash}`;
  const html = await fetchPage(url, opts);
  return { ...parseFightPage(html, hash), source_url: url };
}

module.exports = { parseFightPage, fetchFight };
