/**
 * lib/predictionReview.js — Read-only prediction review overlay.
 *
 * Builds an event-level review payload for QA before / after a card:
 *   - event identity (local vs official date mismatch)
 *   - per-fight matrix: matchup, latest active prediction (pre-fight model only),
 *     fighter profile completeness, career-stat availability, round_stat row count
 *   - per-fight trust grade derived from data completeness, NOT from the model itself
 *   - audit summary (blockers, confidence reducers, future enhancements)
 *   - official source URLs and any captured official outcome snapshots
 *
 * IMPORTANT: this module does not write to the database. It does not generate
 * predictions or modify them. Official outcome snapshots are persisted outside
 * `predictions.*` rows, so model rows stay immutable while live/final fight
 * updates can still be audited.
 */

const FEATURE_PROFILE_FIELDS = ['slpm', 'str_def', 'td_def'];
const SUPPORTING_PROFILE_FIELDS = ['stance', 'height_cm', 'reach_cm'];
const ALL_PROFILE_FIELDS = [...FEATURE_PROFILE_FIELDS, ...SUPPORTING_PROFILE_FIELDS];

const OFFICIAL_SOURCES = [
  'https://www.ufc.com/event/ufc-fight-night-april-25-2026',
  'https://www.ufc.com/news/official-weigh-results-ufc-fight-night-sterling-vs-zalal',
  'https://www.ufc.com/news/updates-ufc-fight-night-sterling-vs-zalal',
  'https://www.ufc.com/news/ufc-fight-night-sterling-vs-zalal-official-scorecards-judges',
  'https://ufcstats.com/fight-details/f524e42c36028de0'
];

const LIVE_CHECKLIST_TEMPLATE = [
  { key: 'weigh_in', label: 'Both fighters made weight (official scale)' },
  { key: 'card_change', label: 'No late opponent or weight-class swap' },
  { key: 'corner_status', label: 'Corner / cornerman changes noted' },
  { key: 'pre_fight_visible', label: 'No visible pre-fight injury / cut indicators' },
  { key: 'round_pace', label: 'Round-by-round: pace vs model expectation' },
  { key: 'round_damage', label: 'Round-by-round: damage accumulation' },
  { key: 'round_control', label: 'Round-by-round: control / position' },
  { key: 'momentum_shift', label: 'Momentum shifts vs predicted lean' },
  { key: 'finish_recorded', label: 'Final method / round / time recorded' }
];

function isPresent(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  if (typeof value === 'number' && Number.isNaN(value)) return false;
  return true;
}

function profileCompleteness(fighter) {
  if (!fighter) {
    return {
      present: [],
      missing: [...ALL_PROFILE_FIELDS],
      missing_core: [...FEATURE_PROFILE_FIELDS],
      score: 0,
      total: ALL_PROFILE_FIELDS.length
    };
  }
  const present = [];
  const missing = [];
  for (const field of ALL_PROFILE_FIELDS) {
    if (isPresent(fighter[field])) present.push(field);
    else missing.push(field);
  }
  const missingCore = missing.filter((f) => FEATURE_PROFILE_FIELDS.includes(f));
  return {
    present,
    missing,
    missing_core: missingCore,
    score: present.length,
    total: ALL_PROFILE_FIELDS.length
  };
}

function summarizeCareerStats(stats) {
  if (!stats) return { available: false, total_fights: 0 };
  const total = Number(stats.total_fights || 0);
  return {
    available: total > 0,
    total_fights: total,
    sig_accuracy_pct: stats.sig_accuracy_pct != null ? stats.sig_accuracy_pct : null,
    td_accuracy_pct: stats.td_accuracy_pct != null ? stats.td_accuracy_pct : null,
    avg_sig_per_fight: stats.avg_sig_per_fight != null ? stats.avg_sig_per_fight : null,
    win_pct_last3: stats.win_pct_last3 != null ? stats.win_pct_last3 : null
  };
}

function safeParseExplanation(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

function summarizeExplanation(explanation, limit = 3) {
  if (!explanation || typeof explanation !== 'object') return null;
  const factors = Array.isArray(explanation.factors) ? explanation.factors : [];
  const top = factors.slice(0, limit).map((f) => ({
    feature: f.feature || null,
    label: f.label || null,
    fighter: f.fighter || null,
    favors: f.favors || null,
    impact: typeof f.impact === 'number' ? f.impact : null,
    value: typeof f.value === 'number' ? f.value : null
  }));
  return {
    summary: typeof explanation.summary === 'string' ? explanation.summary : null,
    favored_corner: explanation.favored_corner || null,
    favored_name: explanation.favored_name || null,
    confidence: typeof explanation.confidence === 'number' ? explanation.confidence : null,
    top_factors: top
  };
}

function buildModelBlock(prediction, fight) {
  if (!prediction) return { model_status: 'missing', model: null };
  const red = Number(prediction.red_win_prob);
  const blue = Number(prediction.blue_win_prob);
  if (!Number.isFinite(red) || !Number.isFinite(blue)) {
    return { model_status: 'invalid', model: null };
  }
  const leanRed = red >= blue;
  const lean_fighter_id = leanRed ? fight.red_fighter_id : fight.blue_fighter_id;
  const lean_fighter_name = leanRed ? fight.red_name : fight.blue_name;
  const explanation = summarizeExplanation(safeParseExplanation(prediction.explanation_json));
  return {
    model_status: prediction.is_stale ? 'stale' : 'ok',
    model: {
      version: prediction.model_version,
      predicted_at: prediction.predicted_at,
      red_win_prob: red,
      blue_win_prob: blue,
      lean: leanRed ? 'red' : 'blue',
      lean_fighter_id,
      lean_fighter_name,
      confidence: Math.max(red, blue),
      is_stale: !!prediction.is_stale,
      explanation
    }
  };
}

function gradeTrust({ redCompleteness, blueCompleteness, redCareer, blueCareer, roundStatRows, modelStatus }) {
  const reasons = [];
  const missingCore = redCompleteness.missing_core.length + blueCompleteness.missing_core.length;
  const missingAny = redCompleteness.missing.length + blueCompleteness.missing.length;
  if (redCompleteness.missing_core.length) {
    reasons.push(`red missing model field(s): ${redCompleteness.missing_core.join(', ')}`);
  }
  if (blueCompleteness.missing_core.length) {
    reasons.push(`blue missing model field(s): ${blueCompleteness.missing_core.join(', ')}`);
  }
  const supportingMissing = [...redCompleteness.missing, ...blueCompleteness.missing]
    .filter((f) => SUPPORTING_PROFILE_FIELDS.includes(f));
  if (supportingMissing.length) {
    reasons.push(`supporting profile fields missing: ${[...new Set(supportingMissing)].join(', ')}`);
  }
  if (!redCareer.available) reasons.push('red has no historical fight_stats');
  if (!blueCareer.available) reasons.push('blue has no historical fight_stats');
  if (modelStatus === 'missing') reasons.push('no active prediction for this fight');
  if (modelStatus === 'stale') reasons.push('latest prediction is marked stale');

  let grade;
  if (modelStatus === 'missing' || (!redCareer.available && !blueCareer.available)) {
    grade = 'Very Low';
  } else if (missingCore >= 4 || (!redCareer.available || !blueCareer.available)) {
    grade = 'Low';
  } else if (missingCore >= 1 || missingAny >= 3) {
    grade = 'Medium';
  } else {
    grade = 'High';
  }

  let warning = null;
  if (reasons.length) {
    warning = `${grade} trust — ${reasons.join('; ')}`;
  }
  return { grade, reasons, warning };
}

function buildAudit(card) {
  const blockers = [];
  const confidence_reducers = [];
  const future_enhancements = [];

  const missingPredCount = card.filter((c) => c.model_status === 'missing').length;
  if (missingPredCount > 0) {
    blockers.push(`${missingPredCount} of ${card.length} fights have no active prediction`);
  }
  const stalePredCount = card.filter((c) => c.model_status === 'stale').length;
  if (stalePredCount > 0) {
    confidence_reducers.push(`${stalePredCount} prediction(s) marked stale`);
  }

  const fightersMissingCore = new Set();
  let fightersMissingCareer = 0;
  for (const row of card) {
    for (const corner of ['red', 'blue']) {
      if (row[corner].completeness.missing_core.length) {
        fightersMissingCore.add(`${row[corner].id}:${row[corner].name}`);
      }
      if (!row[corner].career_stats.available) fightersMissingCareer++;
    }
  }
  if (fightersMissingCore.size > 0) {
    confidence_reducers.push(`${fightersMissingCore.size} fighter(s) missing core profile field(s) used by the model`);
  }
  if (fightersMissingCareer > 0) {
    confidence_reducers.push(`${fightersMissingCareer} fighter slot(s) without historical fight_stats`);
  }

  const totalRoundStats = card.reduce((acc, c) => acc + c.round_stat_rows, 0);
  if (totalRoundStats === 0) {
    confidence_reducers.push('no current-event round_stats yet — pre-fight model only');
  }

  // Pre-fight model only — explicit non-mutation contract
  future_enhancements.push('official outcomes persist separately — keep model rows immutable post-fight');
  future_enhancements.push('add post-event reconciliation pass once round_stats land');
  future_enhancements.push('train on round-level features once historical coverage broadens');

  return { blockers, confidence_reducers, future_enhancements };
}

async function buildPredictionReview({ db, eventId, officialDate }) {
  const event = await db.getEvent(eventId);
  if (!event) return null;

  const cardRows = await db.getEventCard(eventId);
  const predictions = await db.getPredictions({ upcoming: true });
  const predByFightId = new Map();
  for (const p of predictions) {
    if (!predByFightId.has(p.fight_id)) predByFightId.set(p.fight_id, p);
  }
  // Fall back to latest non-stale row regardless of upcoming filter — covers the
  // case where event_date < today (e.g. weigh-ins moved the card date back).
  const missingFightIds = cardRows.map((r) => r.id).filter((id) => !predByFightId.has(id));
  for (const fightId of missingFightIds) {
    const rows = await db.getPredictions({ fight_id: fightId, limit: 1 });
    if (rows && rows.length) predByFightId.set(fightId, rows[0]);
  }

  const cardMatrix = [];
  for (const bout of cardRows) {
    const fight = await db.getFight(bout.id);
    if (!fight) continue;
    const red = await db.getFighter(fight.red_fighter_id);
    const blue = await db.getFighter(fight.blue_fighter_id);
    const redCareer = summarizeCareerStats(await db.getCareerStats(fight.red_fighter_id, fight.event_date));
    const blueCareer = summarizeCareerStats(await db.getCareerStats(fight.blue_fighter_id, fight.event_date));
    const roundStats = await db.getRoundStats(bout.id);
    const officialOutcome = db.getOfficialOutcome ? await db.getOfficialOutcome(bout.id) : null;

    const redCompleteness = profileCompleteness(red);
    const blueCompleteness = profileCompleteness(blue);

    const prediction = predByFightId.get(bout.id) || null;
    const { model_status, model } = buildModelBlock(prediction, fight);

    const trust = gradeTrust({
      redCompleteness,
      blueCompleteness,
      redCareer,
      blueCareer,
      roundStatRows: roundStats.length,
      modelStatus: model_status
    });

    cardMatrix.push({
      fight_id: bout.id,
      card_position: bout.card_position,
      matchup: `${bout.red_name} vs ${bout.blue_name}`,
      weight_class: bout.weight_class,
      is_main: !!bout.is_main,
      is_title: !!bout.is_title,
      red: {
        id: bout.red_id,
        name: bout.red_name,
        completeness: redCompleteness,
        career_stats: redCareer
      },
      blue: {
        id: bout.blue_id,
        name: bout.blue_name,
        completeness: blueCompleteness,
        career_stats: blueCareer
      },
      round_stat_rows: roundStats.length,
      model_status,
      model,
      official_outcome: officialOutcome ? {
        status: officialOutcome.status,
        winner_id: officialOutcome.winner_id,
        winner_name: officialOutcome.winner_name || null,
        method: officialOutcome.method,
        method_detail: officialOutcome.method_detail,
        round: officialOutcome.round,
        time: officialOutcome.time,
        source: officialOutcome.source,
        source_url: officialOutcome.source_url,
        captured_at: officialOutcome.captured_at
      } : null,
      trust_grade: trust.grade,
      trust_reasons: trust.reasons,
      missing_data_warning: trust.warning,
      live_checklist: LIVE_CHECKLIST_TEMPLATE
    });
  }

  const audit = buildAudit(cardMatrix);

  const localDate = event.date || null;
  const dateMismatch = !!(officialDate && localDate && officialDate !== localDate);

  return {
    event: {
      id: event.id,
      number: event.number,
      name: event.name,
      local_date: localDate,
      official_date: officialDate || null,
      date_mismatch: dateMismatch,
      venue: event.venue,
      city: event.city,
      country: event.country
    },
    card: cardMatrix,
    audit,
    official_sources: OFFICIAL_SOURCES,
    notes: {
      model_kind: 'pre-fight model — career stats + profile only',
      live_observations: 'official outcomes persist separately from immutable model predictions',
      official_date_handling: 'official_date is metadata; seed data is not mutated to match'
    }
  };
}

module.exports = {
  buildPredictionReview,
  // exported for tests
  profileCompleteness,
  gradeTrust,
  summarizeExplanation,
  safeParseExplanation,
  OFFICIAL_SOURCES,
  LIVE_CHECKLIST_TEMPLATE
};
