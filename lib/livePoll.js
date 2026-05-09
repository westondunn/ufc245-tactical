/**
 * lib/livePoll.js
 *
 * Live event poller — scrapes ufcstats during an event window and ingests
 * winner / method / round / time + per-round + summary fight stats into the
 * main DB as soon as ufcstats publishes them.
 *
 * Idempotent: each poll re-checks every fight on the card; ones already
 * synced (winner_id set) are skipped. round_stats and fight_stats use
 * ON CONFLICT DO UPDATE so partial early publishes get refreshed if the
 * scoreboard later corrects.
 */

const { fetchEvent } = require('../data/scrapers/ufcstats-event');
const { fetchFight } = require('../data/scrapers/ufcstats-fight');

function nameKey(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

async function pollLiveEvent(eventId, db, opts = {}) {
  const log = opts.log || console.log;
  const event = await db.getEvent(eventId);
  if (!event) return { status: 'error', reason: 'event_not_found' };
  if (!event.ufcstats_hash) return { status: 'skipped', reason: 'no_event_hash' };

  const card = await db.allRows(
    `SELECT id, red_fighter_id, blue_fighter_id, red_name, blue_name,
            winner_id, method, has_stats, ufcstats_hash
       FROM fights
      WHERE event_id = ?`,
    [eventId]
  );
  const localByNames = new Map();
  for (const f of card) {
    const key = nameKey(f.red_name) + '|' + nameKey(f.blue_name);
    const rev = nameKey(f.blue_name) + '|' + nameKey(f.red_name);
    localByNames.set(key, f);
    localByNames.set(rev, f);
  }

  let scraped;
  try {
    scraped = await fetchEvent(event.ufcstats_hash);
  } catch (e) {
    return { status: 'error', reason: 'event_scrape_failed', detail: e.message };
  }

  let updated = 0;
  let scrapedFights = 0;
  let skipped = 0;
  for (const sf of scraped.fights) {
    const key = nameKey(sf.red_name) + '|' + nameKey(sf.blue_name);
    const local = localByNames.get(key);
    if (!local) { skipped++; continue; }
    scrapedFights++;

    // Only ingest once a method is published. ufcstats only fills the row
    // after the fight ends; until then `method` is empty.
    if (!sf.method) continue;
    // Already fully synced — skip to be polite.
    if (local.winner_id && local.has_stats) continue;

    let fightDetail;
    try {
      fightDetail = await fetchFight(sf.fight_hash);
    } catch (e) {
      log(`[live-poll] fight scrape failed for ${sf.red_name} vs ${sf.blue_name}: ${e.message}`);
      continue;
    }

    // Map scraped sides (red=0, blue=1 by ufcstats DOM order) to our local
    // red_fighter_id / blue_fighter_id by matching name. Fall back to
    // positional assumption if names disagree.
    const sideToFighterId = {};
    for (let i = 0; i < fightDetail.fighters.length; i++) {
      const fname = nameKey(fightDetail.fighters[i].name);
      if (fname === nameKey(local.red_name)) sideToFighterId[i] = local.red_fighter_id;
      else if (fname === nameKey(local.blue_name)) sideToFighterId[i] = local.blue_fighter_id;
    }
    if (sideToFighterId[0] == null) sideToFighterId[0] = local.red_fighter_id;
    if (sideToFighterId[1] == null) sideToFighterId[1] = local.blue_fighter_id;

    // Winner: scraper sets winner_side='red' on the row when row[0] has the green
    // status. fightDetail.fighters[0] is whatever ufcstats considers the first
    // person — typically the winner. Use sf.winner_side from event-table parse.
    let winnerId = null;
    if (sf.winner_side === 'red') {
      winnerId = sideToFighterId[0];
    } else {
      // Fall back to fight-detail page: the fighter with result='W' wins.
      const winIdx = fightDetail.fighters.findIndex(f => /^W$/i.test(String(f.result || '').trim()));
      if (winIdx >= 0) winnerId = sideToFighterId[winIdx];
    }

    // Update fight row.
    await db.run(
      `UPDATE fights
          SET winner_id = COALESCE(?, winner_id),
              method = ?,
              method_detail = COALESCE(NULLIF(?, ''), method_detail),
              round = COALESCE(?, round),
              time = COALESCE(?, time),
              referee = COALESCE(NULLIF(?, ''), referee),
              has_stats = 1,
              ufcstats_hash = COALESCE(?, ufcstats_hash)
        WHERE id = ?`,
      [
        winnerId,
        fightDetail.method_full || sf.method || null,
        fightDetail.method_detail || '',
        fightDetail.round || sf.round || null,
        fightDetail.time || sf.time || null,
        fightDetail.referee || '',
        sf.fight_hash,
        local.id,
      ]
    );

    // Upsert summary fight_stats (one row per fighter).
    for (const fs of (fightDetail.fight_stats || [])) {
      const fid = sideToFighterId[fs.fighter_idx];
      if (fid == null) continue;
      await db.upsertFightStats({
        fight_id: local.id,
        fighter_id: fid,
        sig_str_landed: fs.sig_str_landed,
        sig_str_attempted: fs.sig_str_attempted,
        total_str_landed: fs.total_str_landed,
        total_str_attempted: fs.total_str_attempted,
        takedowns_landed: fs.takedowns_landed,
        takedowns_attempted: fs.takedowns_attempted,
        knockdowns: fs.knockdowns,
        sub_attempts: fs.sub_attempts,
        control_time_sec: fs.control_time_sec,
        // sig-strike target/zone splits live on round_stats; bout-summary
        // doesn't break them out, so leave the totals on fight_stats default.
        head_landed: 0, body_landed: 0, leg_landed: 0,
        distance_landed: 0, clinch_landed: 0, ground_landed: 0,
      });
    }

    // Upsert round_stats (one row per fighter per round).
    for (const rs of (fightDetail.round_stats || [])) {
      const fid = sideToFighterId[rs.fighter_idx];
      if (fid == null) continue;
      await db.run(
        `INSERT INTO round_stats
           (fight_id,fighter_id,round,kd,sig_str_landed,sig_str_attempted,total_str_landed,total_str_attempted,td_landed,td_attempted,sub_att,reversal,ctrl_sec,head_landed,head_attempted,body_landed,body_attempted,leg_landed,leg_attempted,distance_landed,distance_attempted,clinch_landed,clinch_attempted,ground_landed,ground_attempted)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT (fight_id, fighter_id, round) DO UPDATE SET
           kd = EXCLUDED.kd,
           sig_str_landed = EXCLUDED.sig_str_landed,
           sig_str_attempted = EXCLUDED.sig_str_attempted,
           total_str_landed = EXCLUDED.total_str_landed,
           total_str_attempted = EXCLUDED.total_str_attempted,
           td_landed = EXCLUDED.td_landed,
           td_attempted = EXCLUDED.td_attempted,
           sub_att = EXCLUDED.sub_att,
           reversal = EXCLUDED.reversal,
           ctrl_sec = EXCLUDED.ctrl_sec,
           head_landed = EXCLUDED.head_landed,
           head_attempted = EXCLUDED.head_attempted,
           body_landed = EXCLUDED.body_landed,
           body_attempted = EXCLUDED.body_attempted,
           leg_landed = EXCLUDED.leg_landed,
           leg_attempted = EXCLUDED.leg_attempted,
           distance_landed = EXCLUDED.distance_landed,
           distance_attempted = EXCLUDED.distance_attempted,
           clinch_landed = EXCLUDED.clinch_landed,
           clinch_attempted = EXCLUDED.clinch_attempted,
           ground_landed = EXCLUDED.ground_landed,
           ground_attempted = EXCLUDED.ground_attempted`,
        [
          local.id, fid, rs.round, rs.kd || 0,
          rs.sig_str_landed || 0, rs.sig_str_attempted || 0,
          rs.total_str_landed || 0, rs.total_str_attempted || 0,
          rs.td_landed || 0, rs.td_attempted || 0,
          rs.sub_att || 0, rs.reversal || 0, rs.ctrl_sec || 0,
          rs.head_landed || 0, rs.head_attempted || 0,
          rs.body_landed || 0, rs.body_attempted || 0,
          rs.leg_landed || 0, rs.leg_attempted || 0,
          rs.distance_landed || 0, rs.distance_attempted || 0,
          rs.clinch_landed || 0, rs.clinch_attempted || 0,
          rs.ground_landed || 0, rs.ground_attempted || 0,
        ]
      );
    }

    updated++;
    log(`[live-poll] event ${eventId} synced fight ${local.id} (${local.red_name} vs ${local.blue_name}) — ${fightDetail.method_full || sf.method}`);
  }

  return {
    status: 'ok',
    event_id: eventId,
    ufcstats_hash: event.ufcstats_hash,
    scraped_fights: scrapedFights,
    skipped_unmatched: skipped,
    fights_synced: updated,
  };
}

module.exports = { pollLiveEvent };
