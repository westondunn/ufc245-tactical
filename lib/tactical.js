/**
 * lib/tactical.js — Algorithmic tactical breakdown generator
 *
 * Generates fight analysis from:
 *   - Fight result (method, round, time)
 *   - Fighter profiles (height, reach, stance, weight class)
 *   - Fight stats (sig strikes, TD, control — when available)
 *   - Per-round stats (when available from scraper)
 *
 * All output is factual/analytical — no editorial commentary.
 * Sourced from data patterns, not opinions.
 */

// Method classification
const METHOD_TYPE = {
  'KO': 'striking', 'TKO': 'striking', 'KO/TKO': 'striking',
  'Submission': 'grappling', 'SUB': 'grappling',
  'Decision': 'distance', 'DEC': 'distance',
  'Decision - Unanimous': 'distance', 'Decision - Split': 'distance',
  'Decision - Majority': 'distance',
  'No Contest': 'nc', 'DQ': 'nc', 'Overturned': 'nc'
};

function classifyMethod(method) {
  if (!method) return 'unknown';
  for (const [key, type] of Object.entries(METHOD_TYPE)) {
    if (method.toLowerCase().includes(key.toLowerCase())) return type;
  }
  return 'unknown';
}

// Time to seconds
function timeToSec(time, round) {
  if (!time || !round) return 0;
  const parts = time.split(':');
  const min = parseInt(parts[0]) || 0;
  const sec = parseInt(parts[1]) || 0;
  return (round - 1) * 300 + min * 60 + sec;
}

// Format seconds to M:SS
function fmtTime(sec) {
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}

/**
 * Generate tactical breakdown for a fight
 * @param {Object} fight - fight record with stats
 * @param {Object} red - red fighter profile
 * @param {Object} blue - blue fighter profile
 * @param {Array} roundStats - per-round stats (may be empty)
 * @returns {Object} tactical analysis
 */
function analyzeFight(fight, red, blue, roundStats = []) {
  const analysis = {
    fight_id: fight.id,
    method_class: classifyMethod(fight.method),
    sections: []
  };

  // ── 1. MATCHUP ANALYSIS ──
  const matchup = analyzeMatchup(red, blue);
  analysis.sections.push(matchup);

  // ── 2. RESULT ANALYSIS ──
  const result = analyzeResult(fight, red, blue);
  analysis.sections.push(result);

  // ── 3. PACE & DURATION ──
  const pace = analyzePace(fight, red, blue);
  analysis.sections.push(pace);

  // ── 4. STATS BREAKDOWN (if available) ──
  if (fight.stats && fight.stats.length >= 2) {
    const statsBreakdown = analyzeStats(fight, red, blue);
    analysis.sections.push(statsBreakdown);
  }

  // ── 5. PER-ROUND BREAKDOWN (if available) ──
  if (roundStats.length > 0) {
    const roundBreakdown = analyzeRounds(roundStats, fight, red, blue);
    analysis.sections.push(roundBreakdown);
  }

  // ── 6. STRATEGIC PATTERNS ──
  const strategy = analyzeStrategy(fight, red, blue, roundStats);
  analysis.sections.push(strategy);

  // ── 7. KEY FACTORS ──
  analysis.key_factors = extractKeyFactors(fight, red, blue, matchup, roundStats);

  return analysis;
}

function analyzeMatchup(red, blue) {
  const items = [];
  const rh = red?.height_cm || 0;
  const bh = blue?.height_cm || 0;
  const rr = red?.reach_cm || 0;
  const br = blue?.reach_cm || 0;

  if (rh && bh) {
    const diff = rh - bh;
    if (Math.abs(diff) >= 3) {
      const taller = diff > 0 ? red.name : blue.name;
      items.push({ label: 'Height', value: `${taller} +${Math.abs(diff)}cm`, advantage: diff > 0 ? 'red' : 'blue' });
    } else {
      items.push({ label: 'Height', value: 'Similar height', advantage: 'neutral' });
    }
  }

  if (rr && br) {
    const diff = rr - br;
    if (Math.abs(diff) >= 3) {
      const longer = diff > 0 ? red.name : blue.name;
      items.push({ label: 'Reach', value: `${longer} +${Math.abs(diff)}cm`, advantage: diff > 0 ? 'red' : 'blue' });
    } else {
      items.push({ label: 'Reach', value: 'Similar reach', advantage: 'neutral' });
    }
  }

  // Stance matchup
  const rs = (red?.stance || '').toLowerCase();
  const bs = (blue?.stance || '').toLowerCase();
  if (rs && bs) {
    const orthodox_vs_orthodox = rs.includes('ortho') && bs.includes('ortho');
    const southpaw_vs_southpaw = rs.includes('south') && bs.includes('south');
    const mixed = !orthodox_vs_orthodox && !southpaw_vs_southpaw;
    items.push({
      label: 'Stance',
      value: mixed ? `${red.stance} vs ${blue.stance} (open stance)` : `Both ${red.stance} (closed stance)`,
      advantage: 'neutral',
      note: mixed ? 'Open stance favors lead-hand power (straight left for southpaw, straight right for orthodox)' :
                     'Closed stance — standard angles, lead leg exposed for low kicks'
    });
  }

  return { title: 'Matchup Profile', type: 'matchup', items };
}

function analyzeResult(fight, red, blue) {
  const items = [];
  const mc = classifyMethod(fight.method);
  const winnerId = fight.winner_id;
  const winnerName = winnerId === red?.id ? red.name : winnerId === blue?.id ? blue.name : 'No winner';
  const loserName = winnerId === red?.id ? blue.name : winnerId === blue?.id ? red.name : '';
  const isFinish = mc === 'striking' || mc === 'grappling';
  const totalSec = timeToSec(fight.time, fight.round);
  const scheduledRounds = fight.is_title ? 5 : 3;
  const scheduledSec = scheduledRounds * 300;

  items.push({
    label: 'Result',
    value: `${winnerName} def. ${loserName}`,
    detail: `${fight.method}${fight.method_detail ? ' (' + fight.method_detail + ')' : ''} · R${fight.round} ${fight.time}`
  });

  if (isFinish) {
    items.push({
      label: 'Finish Timing',
      value: `${fmtTime(totalSec)} of ${fmtTime(scheduledSec)} (${Math.round(totalSec/scheduledSec*100)}% elapsed)`,
      detail: totalSec < 60 ? 'Flash finish — minimal exchanges before stoppage' :
              totalSec < 300 ? 'First-round finish — early pressure or precision created the opening' :
              fight.round >= 4 ? 'Late finish — accumulated damage or fatigue created the opening' :
              'Mid-fight finish'
    });
  }

  if (mc === 'distance') {
    items.push({
      label: 'Decision Type',
      value: fight.method,
      detail: fight.method.includes('Unanimous') ? 'All judges in agreement' :
              fight.method.includes('Split') ? 'One judge scored differently — competitive fight' :
              fight.method.includes('Majority') ? 'Two judges agreed, one scored draw — very close' :
              fight.method
    });
  }

  return { title: 'Result Analysis', type: 'result', items };
}

function analyzePace(fight, red, blue) {
  const items = [];
  const totalSec = timeToSec(fight.time, fight.round);
  const mc = classifyMethod(fight.method);
  const scheduledRounds = fight.is_title ? 5 : 3;

  if (mc === 'striking') {
    if (fight.round === 1 && totalSec < 120) {
      items.push({ label: 'Pace Classification', value: 'Explosive start — early knockout', detail: 'Fight ended before patterns could establish' });
    } else if (fight.round >= 4) {
      items.push({ label: 'Pace Classification', value: 'Attrition finish', detail: 'Damage accumulated over multiple rounds before stoppage' });
    } else {
      items.push({ label: 'Pace Classification', value: 'Mid-fight stoppage', detail: `Fight lasted ${fight.round} of ${scheduledRounds} scheduled rounds` });
    }
  } else if (mc === 'grappling') {
    if (fight.round === 1) {
      items.push({ label: 'Pace Classification', value: 'Quick submission', detail: 'Grappling dominance established early' });
    } else {
      items.push({ label: 'Pace Classification', value: 'Submission after striking phase', detail: `Ground game became decisive in round ${fight.round}` });
    }
  } else if (mc === 'distance') {
    items.push({ label: 'Pace Classification', value: 'Full distance', detail: `Went all ${scheduledRounds} rounds (${fmtTime(scheduledRounds * 300)})` });
  }

  items.push({
    label: 'Fight Duration',
    value: `${fmtTime(totalSec)} actual`,
    detail: `${fight.round} of ${scheduledRounds} rounds · ${Math.round(totalSec/60)} minutes`
  });

  return { title: 'Pace & Duration', type: 'pace', items };
}

function analyzeStats(fight, red, blue) {
  const items = [];
  const rs = fight.stats.find(s => s.fighter_id === red?.id) || fight.stats[0];
  const bs = fight.stats.find(s => s.fighter_id === blue?.id) || fight.stats[1];

  // Striking differential
  const rSig = rs.sig_str_landed || 0;
  const bSig = bs.sig_str_landed || 0;
  const sigDiff = rSig - bSig;
  items.push({
    label: 'Sig. Strike Differential',
    value: `${red.name} ${rSig} — ${bSig} ${blue.name}`,
    advantage: sigDiff > 10 ? 'red' : sigDiff < -10 ? 'blue' : 'neutral',
    detail: `Net: ${sigDiff > 0 ? '+' : ''}${sigDiff} for ${sigDiff > 0 ? red.name.split(' ').pop() : blue.name.split(' ').pop()}`
  });

  // Accuracy
  const rAcc = rs.sig_str_attempted > 0 ? Math.round(rs.sig_str_landed / rs.sig_str_attempted * 100) : 0;
  const bAcc = bs.sig_str_attempted > 0 ? Math.round(bs.sig_str_landed / bs.sig_str_attempted * 100) : 0;
  items.push({
    label: 'Sig. Strike Accuracy',
    value: `${red.name.split(' ').pop()} ${rAcc}% — ${bAcc}% ${blue.name.split(' ').pop()}`,
    advantage: rAcc > bAcc + 5 ? 'red' : bAcc > rAcc + 5 ? 'blue' : 'neutral'
  });

  // Knockdowns
  const rKd = rs.knockdowns || 0;
  const bKd = bs.knockdowns || 0;
  if (rKd > 0 || bKd > 0) {
    items.push({
      label: 'Knockdowns',
      value: `${red.name.split(' ').pop()} ${rKd} — ${bKd} ${blue.name.split(' ').pop()}`,
      advantage: rKd > bKd ? 'red' : bKd > rKd ? 'blue' : 'neutral'
    });
  }

  // Grappling
  const rTd = rs.takedowns_landed || 0;
  const bTd = bs.takedowns_landed || 0;
  if (rTd > 0 || bTd > 0) {
    items.push({
      label: 'Takedowns',
      value: `${red.name.split(' ').pop()} ${rTd}/${rs.takedowns_attempted||0} — ${bTd}/${bs.takedowns_attempted||0} ${blue.name.split(' ').pop()}`,
      advantage: rTd > bTd ? 'red' : bTd > rTd ? 'blue' : 'neutral'
    });
  }

  // Control time
  const rCtrl = rs.control_time_sec || 0;
  const bCtrl = bs.control_time_sec || 0;
  if (rCtrl > 0 || bCtrl > 0) {
    items.push({
      label: 'Control Time',
      value: `${red.name.split(' ').pop()} ${fmtTime(rCtrl)} — ${fmtTime(bCtrl)} ${blue.name.split(' ').pop()}`,
      advantage: rCtrl > bCtrl + 30 ? 'red' : bCtrl > rCtrl + 30 ? 'blue' : 'neutral'
    });
  }

  // Target distribution
  const rHead = rs.head_landed || 0;
  const rBody = rs.body_landed || 0;
  const rLeg = rs.leg_landed || 0;
  if (rHead + rBody + rLeg > 0) {
    const total = rHead + rBody + rLeg;
    items.push({
      label: `${red.name.split(' ').pop()} Targets`,
      value: `Head ${Math.round(rHead/total*100)}% · Body ${Math.round(rBody/total*100)}% · Leg ${Math.round(rLeg/total*100)}%`,
      advantage: 'neutral'
    });
  }
  const bHead = bs.head_landed || 0;
  const bBody = bs.body_landed || 0;
  const bLeg = bs.leg_landed || 0;
  if (bHead + bBody + bLeg > 0) {
    const total = bHead + bBody + bLeg;
    items.push({
      label: `${blue.name.split(' ').pop()} Targets`,
      value: `Head ${Math.round(bHead/total*100)}% · Body ${Math.round(bBody/total*100)}% · Leg ${Math.round(bLeg/total*100)}%`,
      advantage: 'neutral'
    });
  }

  return { title: 'Statistical Breakdown', type: 'stats', items, source: 'ufcstats.com' };
}

function analyzeRounds(roundStats, fight, red, blue) {
  // Group by round
  const rounds = {};
  roundStats.forEach(rs => {
    if (!rounds[rs.round]) rounds[rs.round] = {};
    if (rs.fighter_id === red?.id) rounds[rs.round].red = rs;
    else rounds[rs.round].blue = rs;
  });

  const items = [];
  const rNums = Object.keys(rounds).map(Number).sort();

  for (const rn of rNums) {
    const r = rounds[rn];
    const rSig = r.red?.sig_str_landed || 0;
    const bSig = r.blue?.sig_str_landed || 0;
    const rKd = r.red?.kd || 0;
    const bKd = r.blue?.kd || 0;
    const rCtrl = r.red?.ctrl_sec || 0;
    const bCtrl = r.blue?.ctrl_sec || 0;

    let roundWinner = 'neutral';
    let factors = [];
    if (rSig > bSig + 5) { roundWinner = 'red'; factors.push(`sig strikes ${rSig}-${bSig}`); }
    else if (bSig > rSig + 5) { roundWinner = 'blue'; factors.push(`sig strikes ${bSig}-${rSig}`); }
    if (rKd > 0) { roundWinner = 'red'; factors.push(`${rKd} knockdown(s)`); }
    if (bKd > 0) { roundWinner = 'blue'; factors.push(`${bKd} knockdown(s)`); }
    if (rCtrl > bCtrl + 60) { if (roundWinner === 'neutral') roundWinner = 'red'; factors.push(`control ${fmtTime(rCtrl)}`); }
    if (bCtrl > rCtrl + 60) { if (roundWinner === 'neutral') roundWinner = 'blue'; factors.push(`control ${fmtTime(bCtrl)}`); }

    items.push({
      label: `Round ${rn}`,
      value: roundWinner === 'red' ? red.name.split(' ').pop() :
             roundWinner === 'blue' ? blue.name.split(' ').pop() : 'Even',
      advantage: roundWinner,
      detail: factors.length ? factors.join(' · ') : `Sig: ${rSig}-${bSig}`
    });
  }

  return { title: 'Round-by-Round Analysis', type: 'rounds', items, source: 'ufcstats.com' };
}

function analyzeStrategy(fight, red, blue, roundStats) {
  const items = [];
  const mc = classifyMethod(fight.method);

  // Winner's path to victory
  const winnerId = fight.winner_id;
  const winnerName = winnerId === red?.id ? red.name : winnerId === blue?.id ? blue.name : null;

  if (winnerName && mc === 'striking') {
    items.push({
      label: 'Path to Victory',
      value: 'Striking finish',
      detail: fight.method_detail ?
        `${winnerName} earned the stoppage via ${fight.method_detail}` :
        `${winnerName} earned a ${fight.method} stoppage in round ${fight.round}`
    });
  } else if (winnerName && mc === 'grappling') {
    items.push({
      label: 'Path to Victory',
      value: 'Submission finish',
      detail: fight.method_detail ?
        `${winnerName} secured the ${fight.method_detail}` :
        `${winnerName} earned a submission in round ${fight.round}`
    });
  } else if (winnerName && mc === 'distance') {
    items.push({
      label: 'Path to Victory',
      value: 'Points/distance management',
      detail: `${winnerName} earned the ${fight.method}`
    });
  }

  // Fight classification
  if (fight.stats && fight.stats.length >= 2) {
    const totalTd = fight.stats.reduce((sum, s) => sum + (s.takedowns_landed || 0), 0);
    const totalSig = fight.stats.reduce((sum, s) => sum + (s.sig_str_landed || 0), 0);
    const totalCtrl = fight.stats.reduce((sum, s) => sum + (s.control_time_sec || 0), 0);

    if (totalTd >= 5 && totalCtrl > 180) {
      items.push({ label: 'Fight Style', value: 'Grappling-heavy', detail: `${totalTd} total takedowns, ${fmtTime(totalCtrl)} control time` });
    } else if (totalSig > 200) {
      items.push({ label: 'Fight Style', value: 'High-volume striking', detail: `${totalSig} total significant strikes` });
    } else if (totalSig > 100) {
      items.push({ label: 'Fight Style', value: 'Moderate striking exchange', detail: `${totalSig} total significant strikes` });
    }
  }

  return { title: 'Strategic Analysis', type: 'strategy', items };
}

function extractKeyFactors(fight, red, blue, matchup, roundStats) {
  const factors = [];
  const mc = classifyMethod(fight.method);
  const totalSec = timeToSec(fight.time, fight.round);

  // Reach advantage + striking finish
  const reachItem = matchup.items.find(i => i.label === 'Reach');
  if (reachItem && reachItem.advantage !== 'neutral' && mc === 'striking') {
    const reachWinner = reachItem.advantage;
    const fightWinner = fight.winner_id === red?.id ? 'red' : 'blue';
    if (reachWinner === fightWinner) {
      factors.push('Reach advantage aligned with striking finish');
    } else {
      factors.push('Winner overcame reach disadvantage for striking finish');
    }
  }

  // Quick finish
  if (totalSec < 60 && mc !== 'distance') {
    factors.push(`Fight ended in ${totalSec} seconds — minimal data for pattern analysis`);
  }

  // Late finish
  if (fight.round >= 4 && mc !== 'distance') {
    factors.push(`Late-round finish (R${fight.round}) — likely accumulated damage was a factor`);
  }

  // Title fight context
  if (fight.is_title) {
    factors.push('Title fight — 5-round championship bout');
  }

  return factors;
}

/**
 * Generate analysis for all fights in the database
 */
function generateAllAnalyses(db) {
  const events = db.getAllEvents();
  const analyses = [];

  for (const event of events) {
    const card = db.getEventCard(event.id);
    for (const bout of card) {
      const fight = db.getFight(bout.id);
      if (!fight) continue;

      const red = db.getFighter(fight.red_fighter_id);
      const blue = db.getFighter(fight.blue_fighter_id);
      const roundStats = db.getRoundStats ? db.getRoundStats(bout.id) : [];

      try {
        const analysis = analyzeFight(fight, red, blue, roundStats);
        analyses.push(analysis);
      } catch (e) {
        console.warn(`[tactical] Failed for fight ${bout.id}: ${e.message}`);
      }
    }
  }

  return analyses;
}

module.exports = { analyzeFight, generateAllAnalyses, classifyMethod, timeToSec };
