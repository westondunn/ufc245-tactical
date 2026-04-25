/**
 * db/index.js — SQLite database layer (sql.js / WASM)
 *
 * PERSISTENCE MODEL:
 *   - DB_PATH env var → file-backed SQLite (Railway persistent volume)
 *   - No DB_PATH → in-memory (tests, local dev)
 *   - Seeds from data/seed.json only when the database is empty
 *   - save() writes the in-memory DB to disk after mutations
 */
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

let db = null;
let dbPath = null;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS fighters (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    nickname TEXT,
    height_cm INTEGER,
    reach_cm INTEGER,
    stance TEXT,
    weight_class TEXT,
    nationality TEXT,
    dob TEXT,
    slpm REAL, str_acc REAL, sapm REAL, str_def REAL,
    td_avg REAL, td_acc REAL, td_def REAL, sub_avg REAL,
    ufcstats_hash TEXT
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY,
    number INTEGER,
    name TEXT NOT NULL,
    date TEXT,
    venue TEXT,
    city TEXT,
    country TEXT,
    ufcstats_hash TEXT
  );
  CREATE TABLE IF NOT EXISTS fights (
    id INTEGER PRIMARY KEY,
    event_id INTEGER REFERENCES events(id),
    event_number INTEGER,
    red_fighter_id INTEGER REFERENCES fighters(id),
    blue_fighter_id INTEGER REFERENCES fighters(id),
    red_name TEXT,
    blue_name TEXT,
    weight_class TEXT,
    is_title INTEGER DEFAULT 0,
    is_main INTEGER DEFAULT 0,
    card_position INTEGER,
    method TEXT,
    method_detail TEXT,
    round INTEGER,
    time TEXT,
    winner_id INTEGER REFERENCES fighters(id),
    referee TEXT,
    has_stats INTEGER DEFAULT 0,
    ufcstats_hash TEXT
  );
  CREATE TABLE IF NOT EXISTS fight_stats (
    fight_id INTEGER REFERENCES fights(id),
    fighter_id INTEGER REFERENCES fighters(id),
    sig_str_landed INTEGER DEFAULT 0,
    sig_str_attempted INTEGER DEFAULT 0,
    total_str_landed INTEGER DEFAULT 0,
    total_str_attempted INTEGER DEFAULT 0,
    takedowns_landed INTEGER DEFAULT 0,
    takedowns_attempted INTEGER DEFAULT 0,
    knockdowns INTEGER DEFAULT 0,
    sub_attempts INTEGER DEFAULT 0,
    control_time_sec INTEGER DEFAULT 0,
    head_landed INTEGER DEFAULT 0,
    body_landed INTEGER DEFAULT 0,
    leg_landed INTEGER DEFAULT 0,
    distance_landed INTEGER DEFAULT 0,
    clinch_landed INTEGER DEFAULT 0,
    ground_landed INTEGER DEFAULT 0,
    PRIMARY KEY (fight_id, fighter_id)
  );
  CREATE TABLE IF NOT EXISTS round_stats (
    fight_id INTEGER REFERENCES fights(id),
    fighter_id INTEGER REFERENCES fighters(id),
    round INTEGER NOT NULL,
    kd INTEGER DEFAULT 0,
    sig_str_landed INTEGER DEFAULT 0,
    sig_str_attempted INTEGER DEFAULT 0,
    total_str_landed INTEGER DEFAULT 0,
    total_str_attempted INTEGER DEFAULT 0,
    td_landed INTEGER DEFAULT 0,
    td_attempted INTEGER DEFAULT 0,
    sub_att INTEGER DEFAULT 0,
    reversal INTEGER DEFAULT 0,
    ctrl_sec INTEGER DEFAULT 0,
    head_landed INTEGER DEFAULT 0, head_attempted INTEGER DEFAULT 0,
    body_landed INTEGER DEFAULT 0, body_attempted INTEGER DEFAULT 0,
    leg_landed INTEGER DEFAULT 0, leg_attempted INTEGER DEFAULT 0,
    distance_landed INTEGER DEFAULT 0, distance_attempted INTEGER DEFAULT 0,
    clinch_landed INTEGER DEFAULT 0, clinch_attempted INTEGER DEFAULT 0,
    ground_landed INTEGER DEFAULT 0, ground_attempted INTEGER DEFAULT 0,
    PRIMARY KEY (fight_id, fighter_id, round)
  );
  CREATE TABLE IF NOT EXISTS biomechanics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fight_id INTEGER REFERENCES fights(id),
    fighter_id INTEGER REFERENCES fighters(id),
    strike_type TEXT,
    estimated_force_n REAL,
    fist_velocity_ms REAL,
    target TEXT,
    round INTEGER,
    time_in_round TEXT,
    notes TEXT
  );
  CREATE TABLE IF NOT EXISTS predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fight_id INTEGER REFERENCES fights(id),
    red_fighter_id INTEGER REFERENCES fighters(id),
    blue_fighter_id INTEGER REFERENCES fighters(id),
    red_win_prob REAL NOT NULL,
    blue_win_prob REAL NOT NULL,
    model_version TEXT NOT NULL,
    feature_hash TEXT,
    explanation_json TEXT,
    predicted_at TEXT NOT NULL,
    event_date TEXT,
    is_stale INTEGER DEFAULT 0,
    actual_winner_id INTEGER,
    reconciled_at TEXT,
    correct INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_predictions_fight ON predictions(fight_id);
  CREATE INDEX IF NOT EXISTS idx_predictions_event_date ON predictions(event_date);
  CREATE TABLE IF NOT EXISTS db_meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_fighters_name ON fighters(name);
  CREATE INDEX IF NOT EXISTS idx_events_number ON events(number);
  CREATE INDEX IF NOT EXISTS idx_fights_event ON fights(event_id);
  CREATE INDEX IF NOT EXISTS idx_fights_red ON fights(red_fighter_id);
  CREATE INDEX IF NOT EXISTS idx_fights_blue ON fights(blue_fighter_id);
  CREATE INDEX IF NOT EXISTS idx_fights_event_num ON fights(event_number);
  CREATE INDEX IF NOT EXISTS idx_round_stats_fight ON round_stats(fight_id);
  CREATE INDEX IF NOT EXISTS idx_fights_winner ON fights(winner_id);
  CREATE INDEX IF NOT EXISTS idx_fight_stats_fighter ON fight_stats(fighter_id);

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    avatar_key TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    is_guest INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS user_picks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id INTEGER NOT NULL REFERENCES events(id),
    fight_id INTEGER NOT NULL REFERENCES fights(id),
    picked_fighter_id INTEGER NOT NULL REFERENCES fighters(id),
    confidence INTEGER DEFAULT 50,
    method_pick TEXT,
    round_pick INTEGER,
    notes TEXT,
    submitted_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    locked_at TEXT,
    actual_winner_id INTEGER,
    correct INTEGER,
    method_correct INTEGER,
    round_correct INTEGER,
    points INTEGER DEFAULT 0,
    UNIQUE(user_id, fight_id)
  );
  CREATE TABLE IF NOT EXISTS pick_model_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_pick_id INTEGER NOT NULL REFERENCES user_picks(id) ON DELETE CASCADE,
    prediction_id INTEGER REFERENCES predictions(id),
    model_version TEXT NOT NULL,
    model_picked_fighter_id INTEGER,
    model_confidence REAL,
    user_agreed_with_model INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_user_picks_user ON user_picks(user_id);
  CREATE INDEX IF NOT EXISTS idx_user_picks_event ON user_picks(event_id);
  CREATE INDEX IF NOT EXISTS idx_user_picks_fight ON user_picks(fight_id);
  CREATE INDEX IF NOT EXISTS idx_user_picks_user_event ON user_picks(user_id, event_id);
  CREATE INDEX IF NOT EXISTS idx_pick_snapshots_pick ON pick_model_snapshots(user_pick_id);
`;

/* ── INIT ── */
async function init(options = {}) {
  const SQL = await initSqlJs();
  dbPath = options.dbPath || process.env.DB_PATH || null;

  // Load existing DB from persistent volume
  if (dbPath && fs.existsSync(dbPath)) {
    const buf = fs.readFileSync(dbPath);
    db = new SQL.Database(buf);
    db.run(SCHEMA); // safe — IF NOT EXISTS
    ensurePredictionExplanationColumn();
    migratePredictionsUniqueness();
    const c = oneRow('SELECT COUNT(*) as c FROM fighters');
    console.log('[db] loaded from ' + dbPath + ': ' + (c ? c.c : 0) + ' fighters');
    return db;
  }

  // Fresh database — seed from JSON
  db = new SQL.Database();
  db.run(SCHEMA);
  ensurePredictionExplanationColumn();

  const seedPath = options.seedPath || path.join(__dirname, '..', 'data', 'seed.json');
  if (fs.existsSync(seedPath)) {
    seedFromFile(seedPath);
  }

  migratePredictionsUniqueness();
  if (dbPath) { save(); console.log('[db] persisted to ' + dbPath); }
  return db;
}

/* ── SEED ── */
function seedFromFile(seedPath) {
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

  const insFighter = db.prepare(
    'INSERT OR IGNORE INTO fighters (id,name,nickname,height_cm,reach_cm,stance,weight_class,nationality,dob,slpm,str_acc,sapm,str_def,td_avg,td_acc,td_def,sub_avg,ufcstats_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  );
  for (const f of seed.fighters || []) {
    insFighter.run([f.id,f.name,f.nickname,f.height_cm,f.reach_cm,f.stance,f.weight_class,f.nationality,f.dob||null,f.slpm||null,f.str_acc||null,f.sapm||null,f.str_def||null,f.td_avg||null,f.td_acc||null,f.td_def||null,f.sub_avg||null,f.ufcstats_hash||null]);
  }
  insFighter.free();

  const insEvent = db.prepare(
    'INSERT OR IGNORE INTO events (id,number,name,date,venue,city,country,ufcstats_hash) VALUES (?,?,?,?,?,?,?,?)'
  );
  for (const e of seed.events || []) {
    insEvent.run([e.id,e.number,e.name,e.date,e.venue||e.location||null,e.city||null,e.country||null,e.ufcstats_hash||null]);
  }
  insEvent.free();

  const insFight = db.prepare(
    'INSERT OR IGNORE INTO fights (id,event_id,event_number,red_fighter_id,blue_fighter_id,red_name,blue_name,weight_class,is_title,is_main,card_position,method,method_detail,round,time,winner_id,referee,has_stats,ufcstats_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  );
  for (const f of seed.fights || []) {
    insFight.run([f.id,f.event_id,f.event_number||null,f.red_fighter_id,f.blue_fighter_id,f.red_name||null,f.blue_name||null,f.weight_class,f.is_title?1:0,f.is_main?1:0,f.card_position,f.method,f.method_detail,f.round,f.time,f.winner_id,f.referee,f.has_stats?1:0,f.ufcstats_hash||null]);
  }
  insFight.free();

  const insStats = db.prepare(
    'INSERT OR IGNORE INTO fight_stats (fight_id,fighter_id,sig_str_landed,sig_str_attempted,total_str_landed,total_str_attempted,takedowns_landed,takedowns_attempted,knockdowns,sub_attempts,control_time_sec,head_landed,body_landed,leg_landed,distance_landed,clinch_landed,ground_landed) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  );
  for (const s of seed.fight_stats || []) {
    insStats.run([s.fight_id,s.fighter_id,s.sig_str_landed,s.sig_str_attempted,s.total_str_landed,s.total_str_attempted,s.takedowns_landed,s.takedowns_attempted,s.knockdowns,s.sub_attempts,s.control_time_sec,s.head_landed,s.body_landed,s.leg_landed,s.distance_landed,s.clinch_landed,s.ground_landed]);
  }
  insStats.free();

  if (seed.round_stats && seed.round_stats.length) {
    const insRound = db.prepare(
      'INSERT OR IGNORE INTO round_stats (fight_id,fighter_id,round,kd,sig_str_landed,sig_str_attempted,total_str_landed,total_str_attempted,td_landed,td_attempted,sub_att,reversal,ctrl_sec,head_landed,head_attempted,body_landed,body_attempted,leg_landed,leg_attempted,distance_landed,distance_attempted,clinch_landed,clinch_attempted,ground_landed,ground_attempted) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    );
    for (const rs of seed.round_stats) {
      insRound.run([rs.fight_id,rs.fighter_id,rs.round,rs.kd||0,rs.sig_str_landed||0,rs.sig_str_attempted||0,rs.total_str_landed||0,rs.total_str_attempted||0,rs.td_landed||0,rs.td_attempted||0,rs.sub_att||0,rs.reversal||0,rs.ctrl_sec||0,rs.head_landed||0,rs.head_attempted||0,rs.body_landed||0,rs.body_attempted||0,rs.leg_landed||0,rs.leg_attempted||0,rs.distance_landed||0,rs.distance_attempted||0,rs.clinch_landed||0,rs.clinch_attempted||0,rs.ground_landed||0,rs.ground_attempted||0]);
    }
    insRound.free();
  }

  db.run("INSERT OR REPLACE INTO db_meta (key,value) VALUES ('seeded_at','" + new Date().toISOString() + "')");

  const rsCount = (seed.round_stats || []).length;
  console.log('[db] seeded: ' + seed.fighters.length + ' fighters, ' + seed.events.length + ' events, ' + seed.fights.length + ' fights' + (rsCount ? ', ' + rsCount + ' round stats' : ''));
}

/* ── SAVE ── */
function save() {
  if (!db || !dbPath) return false;
  try {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(dbPath, Buffer.from(db.export()));
    return true;
  } catch (e) {
    console.error('[db] save failed:', e.message);
    return false;
  }
}

/* ── QUERY HELPERS ── */
function allRows(sql, params = []) {
  if (!db) throw new Error('Database not initialized');
  const stmt = db.prepare(sql);
  try {
    if (params.length) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally { stmt.free(); }
}

function oneRow(sql, params = []) {
  const rows = allRows(sql, params);
  return rows[0] || null;
}

function run(sql, params = []) {
  if (!db) throw new Error('Database not initialized');
  db.run(sql, params);
}

function migratePredictionsUniqueness() {
  // Keep only the latest row per (fight_id, model_version) before enforcing uniqueness.
  run(`
    DELETE FROM predictions
    WHERE id NOT IN (
      SELECT id FROM (
        SELECT p.id
        FROM predictions p
        WHERE p.id = (
          SELECT p2.id
          FROM predictions p2
          WHERE p2.fight_id = p.fight_id
            AND p2.model_version = p.model_version
          ORDER BY p2.predicted_at DESC, p2.id DESC
          LIMIT 1
        )
      )
    )
  `);
  run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_predictions_fight_model
    ON predictions(fight_id, model_version)
  `);
}

function ensurePredictionExplanationColumn() {
  const cols = allRows('PRAGMA table_info(predictions)').map(c => c.name);
  if (!cols.includes('explanation_json')) {
    run('ALTER TABLE predictions ADD COLUMN explanation_json TEXT');
  }
}

/* ── UPSERT (for scraper) ── */
function upsertFighter(f) {
  run('INSERT OR REPLACE INTO fighters (id,name,nickname,height_cm,reach_cm,stance,weight_class,nationality,dob,ufcstats_hash) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [f.id,f.name,f.nickname||null,f.height_cm||null,f.reach_cm||null,f.stance||null,f.weight_class||null,f.nationality||null,f.dob||null,f.ufcstats_hash||null]);
}

function upsertEvent(e) {
  run('INSERT OR REPLACE INTO events (id,number,name,date,venue,city,country,ufcstats_hash) VALUES (?,?,?,?,?,?,?,?)',
    [e.id,e.number||null,e.name,e.date||null,e.venue||null,e.city||null,e.country||null,e.ufcstats_hash||null]);
}

function upsertFight(f) {
  run('INSERT OR REPLACE INTO fights (id,event_id,event_number,red_fighter_id,blue_fighter_id,red_name,blue_name,weight_class,is_title,is_main,card_position,method,method_detail,round,time,winner_id,referee,has_stats,ufcstats_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [f.id,f.event_id,f.event_number||null,f.red_fighter_id,f.blue_fighter_id,f.red_name||null,f.blue_name||null,f.weight_class,f.is_title?1:0,f.is_main?1:0,f.card_position,f.method,f.method_detail,f.round,f.time,f.winner_id,f.referee,f.has_stats?1:0,f.ufcstats_hash||null]);
}

function upsertFightStats(s) {
  run('INSERT OR REPLACE INTO fight_stats (fight_id,fighter_id,sig_str_landed,sig_str_attempted,total_str_landed,total_str_attempted,takedowns_landed,takedowns_attempted,knockdowns,sub_attempts,control_time_sec,head_landed,body_landed,leg_landed,distance_landed,clinch_landed,ground_landed) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [s.fight_id,s.fighter_id,s.sig_str_landed||0,s.sig_str_attempted||0,s.total_str_landed||0,s.total_str_attempted||0,s.takedowns_landed||0,s.takedowns_attempted||0,s.knockdowns||0,s.sub_attempts||0,s.control_time_sec||0,s.head_landed||0,s.body_landed||0,s.leg_landed||0,s.distance_landed||0,s.clinch_landed||0,s.ground_landed||0]);
}

function nextId(table) {
  const row = oneRow('SELECT MAX(id) as m FROM ' + table);
  return (row && row.m ? row.m : 0) + 1;
}

function getDbStats() {
  return {
    fighters: (oneRow('SELECT COUNT(*) as c FROM fighters') || {}).c || 0,
    events: (oneRow('SELECT COUNT(*) as c FROM events') || {}).c || 0,
    fights: (oneRow('SELECT COUNT(*) as c FROM fights') || {}).c || 0,
    fight_stats: (oneRow('SELECT COUNT(*) as c FROM fight_stats') || {}).c || 0,
    persistent: !!dbPath,
    dbPath: dbPath || ':memory:',
    last_scrape: (oneRow("SELECT value FROM db_meta WHERE key = 'last_scrape'") || {}).value || null
  };
}

/* ── PUBLIC QUERY API (unchanged) ── */

function searchFighters(query) {
  return allRows(
    'SELECT id, name, nickname, weight_class, nationality, stance, height_cm, reach_cm FROM fighters WHERE name LIKE ? OR nickname LIKE ? ORDER BY name LIMIT 20',
    ['%' + query + '%', '%' + query + '%']);
}

function getFighter(id) { return oneRow('SELECT * FROM fighters WHERE id = ?', [id]); }

function getFighterEvents(fighterId) {
  return allRows(
    'SELECT DISTINCT e.id, e.number, e.name, e.date, e.venue, e.city, f.id as fight_id, f.method, f.round, f.time, f.winner_id, f.is_title, f.is_main, fr.name as red_name, fb.name as blue_name, fr.id as red_id, fb.id as blue_id FROM events e JOIN fights f ON f.event_id = e.id JOIN fighters fr ON f.red_fighter_id = fr.id JOIN fighters fb ON f.blue_fighter_id = fb.id WHERE f.red_fighter_id = ? OR f.blue_fighter_id = ? ORDER BY e.date DESC, f.card_position ASC',
    [fighterId, fighterId]);
}

function getEventCard(eventId) {
  return allRows(
    'SELECT f.id, f.weight_class, f.is_title, f.is_main, f.card_position, f.method, f.method_detail, f.round, f.time, f.winner_id, f.referee, fr.id as red_id, fr.name as red_name, fr.nickname as red_nickname, fb.id as blue_id, fb.name as blue_name, fb.nickname as blue_nickname FROM fights f JOIN fighters fr ON f.red_fighter_id = fr.id JOIN fighters fb ON f.blue_fighter_id = fb.id WHERE f.event_id = ? ORDER BY f.card_position ASC',
    [eventId]);
}

function getEvent(eventId) { return oneRow('SELECT * FROM events WHERE id = ?', [eventId]); }
function getEventByNumber(num) { return oneRow('SELECT * FROM events WHERE number = ?', [num]); }

function getFight(fightId) {
  const fight = oneRow(
    'SELECT f.*, fr.name as red_name, fr.nickname as red_nickname, fr.height_cm as red_height, fr.reach_cm as red_reach, fr.stance as red_stance, fr.nationality as red_nationality, fb.name as blue_name, fb.nickname as blue_nickname, fb.height_cm as blue_height, fb.reach_cm as blue_reach, fb.stance as blue_stance, fb.nationality as blue_nationality, e.number as event_number, e.name as event_name, e.date as event_date, e.venue, e.city FROM fights f JOIN fighters fr ON f.red_fighter_id = fr.id JOIN fighters fb ON f.blue_fighter_id = fb.id JOIN events e ON f.event_id = e.id WHERE f.id = ?',
    [fightId]);
  if (fight) { fight.stats = allRows('SELECT * FROM fight_stats WHERE fight_id = ?', [fightId]); }
  return fight;
}

function getAllEvents() { return allRows('SELECT * FROM events ORDER BY date DESC'); }

function getCareerStats(fighterId, asOf = null) {
  const params = [fighterId];
  let dateFilter = '';
  if (asOf) {
    dateFilter = ' AND e.date < ?';
    params.push(asOf);
  }

  const stats = oneRow(
    `SELECT
      fs.fighter_id,
      COUNT(*) as total_fights,
      SUM(fs.sig_str_landed) as total_sig_landed,
      SUM(fs.sig_str_attempted) as total_sig_attempted,
      ROUND(CAST(SUM(fs.sig_str_landed) AS REAL) / NULLIF(SUM(fs.sig_str_attempted),0) * 100, 1) as sig_accuracy_pct,
      SUM(fs.knockdowns) as total_knockdowns,
      SUM(fs.takedowns_landed) as total_td_landed,
      SUM(fs.takedowns_attempted) as total_td_attempted,
      ROUND(CAST(SUM(fs.takedowns_landed) AS REAL) / NULLIF(SUM(fs.takedowns_attempted),0) * 100, 1) as td_accuracy_pct,
      SUM(fs.sub_attempts) as total_sub_attempts,
      SUM(fs.control_time_sec) as total_control_sec,
      SUM(fs.head_landed) as total_head,
      SUM(fs.body_landed) as total_body,
      SUM(fs.leg_landed) as total_leg,
      SUM(fs.distance_landed) as total_distance,
      SUM(fs.clinch_landed) as total_clinch,
      SUM(fs.ground_landed) as total_ground,
      ROUND(CAST(SUM(fs.sig_str_landed) AS REAL) / NULLIF(COUNT(*),0), 1) as avg_sig_per_fight,
      ROUND(CAST(SUM(fs.knockdowns) AS REAL) / NULLIF(COUNT(*),0), 2) as avg_kd_per_fight
    FROM fight_stats fs
    JOIN fights f ON f.id = fs.fight_id
    JOIN events e ON e.id = f.event_id
    WHERE fs.fighter_id = ?${dateFilter}
    GROUP BY fs.fighter_id`,
    params
  );

  if (!stats) return null;

  const recentParams = [fighterId, fighterId];
  let recentDateFilter = '';
  if (asOf) {
    recentDateFilter = ' AND e.date < ?';
    recentParams.push(asOf);
  }

  const last3 = allRows(
    `SELECT f.winner_id
     FROM fights f
     JOIN events e ON e.id = f.event_id
     WHERE (f.red_fighter_id = ? OR f.blue_fighter_id = ?)
       AND f.winner_id IS NOT NULL${recentDateFilter}
     ORDER BY e.date DESC, f.id DESC
     LIMIT 3`,
    recentParams
  );

  if (!last3.length) {
    stats.win_pct_last3 = 0.5;
  } else {
    const wins = last3.filter((r) => Number(r.winner_id) === fighterId).length;
    stats.win_pct_last3 = Number((wins / last3.length).toFixed(2));
  }

  return stats;
}

function getHeadToHead(id1, id2) {
  return allRows(
    'SELECT f.*, e.number as event_number, e.name as event_name, e.date as event_date, fr.name as red_name, fb.name as blue_name FROM fights f JOIN events e ON f.event_id = e.id JOIN fighters fr ON f.red_fighter_id = fr.id JOIN fighters fb ON f.blue_fighter_id = fb.id WHERE (f.red_fighter_id = ? AND f.blue_fighter_id = ?) OR (f.red_fighter_id = ? AND f.blue_fighter_id = ?) ORDER BY e.date DESC',
    [id1, id2, id2, id1]);
}

function getFighterRecord(fighterId) {
  const row = oneRow(
    `SELECT COUNT(*) as total,
       SUM(CASE WHEN winner_id = ? THEN 1 ELSE 0 END) as wins,
       SUM(CASE WHEN winner_id IS NULL OR winner_id = 0 OR method LIKE '%Draw%' OR method LIKE '%No Contest%' THEN 1 ELSE 0 END) as draws
     FROM fights WHERE red_fighter_id = ? OR blue_fighter_id = ?`,
    [fighterId, fighterId, fighterId]
  );
  if (!row) return { wins: 0, losses: 0, draws: 0, total: 0 };
  return { wins: row.wins, losses: row.total - row.wins - row.draws, draws: row.draws, total: row.total };
}

function getRoundStats(fightId) {
  return allRows('SELECT rs.*, f.name as fighter_name FROM round_stats rs JOIN fighters f ON rs.fighter_id = f.id WHERE rs.fight_id = ? ORDER BY rs.round, rs.fighter_id', [fightId]);
}

function getFightWithRounds(fightId) {
  const fight = getFight(fightId);
  if (fight) { fight.round_stats = getRoundStats(fightId); fight.has_round_stats = fight.round_stats.length > 0; }
  return fight;
}

function getStatLeaders(stat, limit = 10) {
  const validStats = { knockdowns:'SUM(knockdowns)', sig_strikes:'SUM(sig_str_landed)', sig_accuracy:'ROUND(CAST(SUM(sig_str_landed) AS REAL)/NULLIF(SUM(sig_str_attempted),0)*100,1)', takedowns:'SUM(takedowns_landed)', td_accuracy:'ROUND(CAST(SUM(takedowns_landed) AS REAL)/NULLIF(SUM(takedowns_attempted),0)*100,1)', control_time:'SUM(control_time_sec)', sub_attempts:'SUM(sub_attempts)', fights:'COUNT(*)' };
  const expr = validStats[stat];
  if (!expr) return [];
  const minFights = ['sig_accuracy','td_accuracy'].includes(stat) ? 'HAVING COUNT(*) >= 3' : '';
  return allRows('SELECT fs.fighter_id, f.name, f.weight_class, f.nationality, COUNT(*) as fight_count, ' + expr + ' as value FROM fight_stats fs JOIN fighters f ON fs.fighter_id = f.id GROUP BY fs.fighter_id ' + minFights + ' ORDER BY value DESC LIMIT ?', [limit]);
}

function getAllFighters(limit = 500) { return allRows('SELECT * FROM fighters ORDER BY name LIMIT ?', [limit]); }

/* ── PREDICTIONS ── */

function upsertPrediction(p) {
  const explanationJson = p.explanation_json != null
    ? p.explanation_json
    : (p.explanation != null ? JSON.stringify(p.explanation) : null);
  run(
    `INSERT INTO predictions
     (fight_id, red_fighter_id, blue_fighter_id, red_win_prob, blue_win_prob,
      model_version, feature_hash, explanation_json, predicted_at, event_date, is_stale)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(fight_id, model_version) DO UPDATE SET
       red_fighter_id = excluded.red_fighter_id,
       blue_fighter_id = excluded.blue_fighter_id,
       red_win_prob = excluded.red_win_prob,
       blue_win_prob = excluded.blue_win_prob,
       feature_hash = excluded.feature_hash,
       explanation_json = excluded.explanation_json,
       predicted_at = excluded.predicted_at,
       event_date = excluded.event_date,
       is_stale = excluded.is_stale`,
    [p.fight_id, p.red_fighter_id, p.blue_fighter_id, p.red_win_prob, p.blue_win_prob,
     p.model_version, p.feature_hash || null, explanationJson, p.predicted_at, p.event_date || null, p.is_stale ? 1 : 0]
  );
}

function getPredictions(opts = {}) {
  let sql = `SELECT p.*, fr.name as red_name, fb.name as blue_name
    FROM predictions p
    LEFT JOIN fighters fr ON p.red_fighter_id = fr.id
    LEFT JOIN fighters fb ON p.blue_fighter_id = fb.id
    WHERE 1=1`;
  const params = [];
  if (opts.fight_id) { sql += ' AND p.fight_id = ?'; params.push(opts.fight_id); }
  if (opts.upcoming) {
    sql += ` AND p.actual_winner_id IS NULL AND p.is_stale = 0
      AND (p.event_date IS NULL OR p.event_date >= date('now'))
      AND p.id = (
        SELECT p2.id
        FROM predictions p2
        WHERE p2.fight_id = p.fight_id
          AND p2.actual_winner_id IS NULL
          AND p2.is_stale = 0
        ORDER BY p2.predicted_at DESC, p2.id DESC
        LIMIT 1
      )`;
  }
  if (opts.event_date_from) { sql += ' AND p.event_date >= ?'; params.push(opts.event_date_from); }
  if (opts.event_date_to) { sql += ' AND p.event_date <= ?'; params.push(opts.event_date_to); }
  sql += ' ORDER BY p.event_date ASC, p.predicted_at DESC';
  if (opts.limit) { sql += ' LIMIT ?'; params.push(opts.limit); }
  return allRows(sql, params);
}

function prunePastPredictions({ before, include_concluded = true } = {}) {
  const cutoff = before || new Date().toISOString().slice(0, 10);
  let sql = `SELECT p.id
    FROM predictions p
    LEFT JOIN fights f ON f.id = p.fight_id
    WHERE p.is_stale = 0
      AND (p.event_date < ?`;
  const params = [cutoff];
  if (include_concluded) sql += ' OR f.winner_id IS NOT NULL';
  sql += ')';
  const ids = allRows(sql, params).map(row => row.id);
  if (!ids.length) return { pruned: 0, before: cutoff };
  const placeholders = ids.map(() => '?').join(',');
  run(`UPDATE predictions SET is_stale = 1 WHERE id IN (${placeholders})`, ids);
  return { pruned: ids.length, before: cutoff };
}

function reconcilePrediction(fightId, actualWinnerId) {
  let pred = oneRow(
    'SELECT * FROM predictions WHERE fight_id = ? AND actual_winner_id IS NULL ORDER BY predicted_at DESC, id DESC LIMIT 1',
    [fightId]
  );
  if (!pred) {
    pred = oneRow(
      'SELECT * FROM predictions WHERE fight_id = ? ORDER BY predicted_at DESC, id DESC LIMIT 1',
      [fightId]
    );
  }
  if (!pred) return null;
  const correct = (actualWinnerId === pred.red_fighter_id && pred.red_win_prob > 0.5) ||
                  (actualWinnerId === pred.blue_fighter_id && pred.blue_win_prob > 0.5) ? 1 : 0;
  run('UPDATE predictions SET actual_winner_id = ?, reconciled_at = ?, correct = ? WHERE id = ?',
    [actualWinnerId, new Date().toISOString(), correct, pred.id]);
  return { ...pred, actual_winner_id: actualWinnerId, correct };
}

function getPredictionAccuracy() {
  return oneRow(
    `SELECT COUNT(*) as total,
       SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END) as correct_count,
       ROUND(CAST(SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END) AS REAL) / NULLIF(COUNT(*), 0) * 100, 1) as accuracy_pct
     FROM predictions WHERE reconciled_at IS NOT NULL`
  );
}

/* ── USERS ── */

const crypto = require('crypto');
const { scorePick, normalizeMethod } = require('../lib/scoring');

function createUser({ display_name, avatar_key }) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  run(
    'INSERT INTO users (id, display_name, avatar_key, created_at, updated_at, is_guest) VALUES (?,?,?,?,?,1)',
    [id, display_name, avatar_key || null, now, now]
  );
  return { id, display_name, avatar_key: avatar_key || null, created_at: now, updated_at: now, is_guest: 1 };
}

function getUser(id) {
  if (!id) return null;
  return oneRow('SELECT * FROM users WHERE id = ?', [id]);
}

function updateUser(id, { display_name, avatar_key }) {
  const user = getUser(id);
  if (!user) return null;
  const fields = [];
  const params = [];
  if (display_name !== undefined) { fields.push('display_name = ?'); params.push(display_name); }
  if (avatar_key !== undefined)   { fields.push('avatar_key = ?');   params.push(avatar_key); }
  if (!fields.length) return user;
  fields.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(id);
  run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params);
  return getUser(id);
}

function deleteUser(id) {
  // Explicit cascade (sqlite FK enforcement isn't enabled globally here).
  run(`DELETE FROM pick_model_snapshots
       WHERE user_pick_id IN (SELECT id FROM user_picks WHERE user_id = ?)`, [id]);
  run('DELETE FROM user_picks WHERE user_id = ?', [id]);
  run('DELETE FROM users WHERE id = ?', [id]);
  return db.getRowsModified() > 0;
}

/* ── PICK LOCK STATE ── */

function getPickLockState(userId, fightId) {
  const row = oneRow(
    `SELECT p.id AS pick_id, p.locked_at, f.winner_id
     FROM fights f
     LEFT JOIN user_picks p ON p.fight_id = f.id AND p.user_id = ?
     WHERE f.id = ?`,
    [userId, fightId]
  );
  if (!row) return { exists: false, locked: false, reason: null };
  const locked = !!row.locked_at || row.winner_id != null;
  const reason = row.locked_at ? 'event_locked' : (row.winner_id != null ? 'fight_over' : null);
  return { exists: !!row.pick_id, locked, reason, existing_pick_id: row.pick_id || null };
}

/* ── USER PICKS ── */

function upsertPick(input) {
  const { user_id, event_id, fight_id, picked_fighter_id, confidence, method_pick, round_pick, notes } = input;
  const lock = getPickLockState(user_id, fight_id);
  if (lock.locked) {
    const err = new Error('pick_locked');
    err.code = 'pick_locked';
    err.reason = lock.reason;
    err.status = 409;
    throw err;
  }
  const now = new Date().toISOString();
  run(
    `INSERT INTO user_picks
       (user_id, event_id, fight_id, picked_fighter_id, confidence, method_pick, round_pick, notes, submitted_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(user_id, fight_id) DO UPDATE SET
       picked_fighter_id = excluded.picked_fighter_id,
       confidence = excluded.confidence,
       method_pick = excluded.method_pick,
       round_pick = excluded.round_pick,
       notes = excluded.notes,
       updated_at = excluded.updated_at`,
    [user_id, event_id, fight_id, picked_fighter_id, confidence != null ? confidence : 50, method_pick || null, round_pick || null, notes || null, now, now]
  );
  const pick = oneRow('SELECT * FROM user_picks WHERE user_id = ? AND fight_id = ?', [user_id, fight_id]);
  if (!pick) return null;
  refreshPickModelSnapshot(pick);
  const snapshot = oneRow(
    'SELECT * FROM pick_model_snapshots WHERE user_pick_id = ? ORDER BY id DESC LIMIT 1',
    [pick.id]
  );
  return { pick, snapshot };
}

function refreshPickModelSnapshot(pick) {
  let pred = oneRow(
    `SELECT * FROM predictions
     WHERE fight_id = ? AND is_stale = 0
     ORDER BY predicted_at DESC, id DESC LIMIT 1`,
    [pick.fight_id]
  );
  if (!pred) {
    pred = oneRow(
      'SELECT * FROM predictions WHERE fight_id = ? ORDER BY predicted_at DESC, id DESC LIMIT 1',
      [pick.fight_id]
    );
  }
  const now = new Date().toISOString();
  run('DELETE FROM pick_model_snapshots WHERE user_pick_id = ?', [pick.id]);
  if (!pred) {
    run(
      `INSERT INTO pick_model_snapshots
         (user_pick_id, prediction_id, model_version, model_picked_fighter_id, model_confidence, user_agreed_with_model, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [pick.id, null, 'none', null, null, null, now]
    );
    return;
  }
  const modelPicked = pred.red_win_prob >= pred.blue_win_prob ? pred.red_fighter_id : pred.blue_fighter_id;
  const modelConf = Math.max(pred.red_win_prob, pred.blue_win_prob);
  const agreed = modelPicked === pick.picked_fighter_id ? 1 : 0;
  run(
    `INSERT INTO pick_model_snapshots
       (user_pick_id, prediction_id, model_version, model_picked_fighter_id, model_confidence, user_agreed_with_model, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [pick.id, pred.id, pred.model_version, modelPicked, modelConf, agreed, now]
  );
}

function deletePick(userId, pickId) {
  const pick = oneRow('SELECT * FROM user_picks WHERE id = ? AND user_id = ?', [pickId, userId]);
  if (!pick) return { deleted: false, reason: 'not_found' };
  const lock = getPickLockState(userId, pick.fight_id);
  if (lock.locked) return { deleted: false, reason: lock.reason || 'locked' };
  run('DELETE FROM user_picks WHERE id = ?', [pickId]);
  return { deleted: true };
}

function getPicksForUser(userId, opts = {}) {
  const params = [userId];
  let sql = `
    SELECT
      p.*,
      f.red_fighter_id, f.blue_fighter_id, f.red_name, f.blue_name, f.winner_id, f.method, f.round AS fight_round,
      f.is_main, f.weight_class,
      ev.number AS event_number, ev.name AS event_name, ev.date AS event_date,
      fp.name AS picked_fighter_name,
      s.model_version AS model_version,
      s.model_picked_fighter_id AS model_picked_fighter_id,
      s.model_confidence AS model_confidence,
      s.user_agreed_with_model AS user_agreed_with_model
    FROM user_picks p
    JOIN fights f ON f.id = p.fight_id
    LEFT JOIN events ev ON ev.id = p.event_id
    LEFT JOIN fighters fp ON fp.id = p.picked_fighter_id
    LEFT JOIN pick_model_snapshots s ON s.user_pick_id = p.id
    WHERE p.user_id = ?`;
  if (opts.event_id) { sql += ' AND p.event_id = ?'; params.push(opts.event_id); }
  if (opts.reconciled === true)  sql += ' AND p.correct IS NOT NULL';
  if (opts.reconciled === false) sql += ' AND p.correct IS NULL';
  sql += ' ORDER BY ev.date DESC, p.event_id DESC, p.fight_id ASC';
  return allRows(sql, params);
}

function lockPicksForEvent(eventId) {
  run('UPDATE user_picks SET locked_at = ? WHERE event_id = ? AND locked_at IS NULL',
    [new Date().toISOString(), eventId]);
  return { locked: db.getRowsModified() };
}

function reconcilePicksForEvent(eventId) {
  const fights = allRows(
    'SELECT id, winner_id, method, round FROM fights WHERE event_id = ?',
    [eventId]
  );
  let reconciledCount = 0;
  let pointsAwarded = 0;
  let voidedCount = 0;
  let fightsSettled = 0;

  for (const fight of fights) {
    const methodStr = String(fight.method || '').toUpperCase();
    const hasWinner = !!fight.winner_id;
    const isVoid = !hasWinner && /DRAW|NO CONTEST|\bNC\b/.test(methodStr);
    if (!hasWinner && !isVoid) continue;
    fightsSettled++;

    const actualMethod = hasWinner ? normalizeMethod(fight.method) : null;
    const actualRound = hasWinner ? (fight.round || null) : null;
    const picks = allRows(
      `SELECT p.*, s.user_agreed_with_model
       FROM user_picks p
       LEFT JOIN pick_model_snapshots s ON s.user_pick_id = p.id
       WHERE p.fight_id = ?`,
      [fight.id]
    );
    for (const pick of picks) {
      const correct = hasWinner ? (pick.picked_fighter_id === fight.winner_id ? 1 : 0) : 0;
      const methodCorrect = hasWinner && pick.method_pick
        ? (actualMethod && pick.method_pick === actualMethod ? 1 : 0)
        : null;
      const roundCorrect = hasWinner && pick.round_pick
        ? (actualRound && pick.round_pick === actualRound ? 1 : 0)
        : null;
      const { points } = scorePick({
        correct,
        confidence: pick.confidence,
        methodCorrect,
        roundCorrect,
        userAgreedWithModel: pick.user_agreed_with_model == null ? null : pick.user_agreed_with_model
      });
      run(
        `UPDATE user_picks
           SET actual_winner_id = ?, correct = ?, method_correct = ?, round_correct = ?, points = ?
         WHERE id = ?`,
        [fight.winner_id || null, correct, methodCorrect, roundCorrect, points, pick.id]
      );
      if (isVoid) voidedCount++;
      else reconciledCount++;
      pointsAwarded += points;
    }
  }

  return {
    reconciled: reconciledCount + voidedCount,
    scored: reconciledCount,
    voided: voidedCount,
    points_awarded: pointsAwarded,
    fights_with_results: fightsSettled
  };
}

function reconcileAllPicks() {
  const events = allRows('SELECT DISTINCT event_id FROM user_picks');
  let totalReconciled = 0;
  let totalPoints = 0;
  let eventsProcessed = 0;
  for (const row of events) {
    const r = reconcilePicksForEvent(row.event_id);
    if (r.reconciled > 0) eventsProcessed++;
    totalReconciled += r.reconciled;
    totalPoints += r.points_awarded;
  }
  return { events_processed: eventsProcessed, reconciled: totalReconciled, points_awarded: totalPoints };
}

/* ── LEADERBOARDS + STATS ── */

function getLeaderboard(opts = {}) {
  const params = [];
  let sql = `
    SELECT
      u.id AS user_id,
      u.display_name,
      u.avatar_key,
      COUNT(p.id) AS picks,
      SUM(CASE WHEN p.correct = 1 THEN 1 ELSE 0 END) AS correct_count,
      COALESCE(SUM(p.points),0) AS points,
      ROUND(
        CAST(SUM(CASE WHEN p.correct = 1 THEN 1 ELSE 0 END) AS REAL)
         / NULLIF(COUNT(p.id), 0) * 100, 1
      ) AS accuracy_pct
    FROM users u
    JOIN user_picks p ON p.user_id = u.id
    WHERE p.correct IS NOT NULL`;
  if (opts.event_id) { sql += ' AND p.event_id = ?'; params.push(opts.event_id); }
  sql += ` GROUP BY u.id, u.display_name, u.avatar_key
           ORDER BY points DESC, correct_count DESC, u.display_name ASC`;
  const limit = Number.isFinite(opts.limit) && opts.limit > 0 ? Math.min(opts.limit, 500) : 50;
  sql += ' LIMIT ?';
  params.push(limit);
  return allRows(sql, params);
}

function getUserStats(userId) {
  if (!userId) return null;
  const base = oneRow(
    `SELECT
        COUNT(*) AS total_picks,
        SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END) AS correct_count,
        COALESCE(SUM(points),0) AS points
     FROM user_picks WHERE user_id = ? AND correct IS NOT NULL`,
    [userId]
  );
  const vsModel = oneRow(
    `SELECT
        COUNT(*) AS snapshots,
        SUM(CASE WHEN s.user_agreed_with_model = 1 THEN 1 ELSE 0 END) AS agreements,
        SUM(CASE WHEN p.correct = 1 AND s.user_agreed_with_model = 0 THEN 1 ELSE 0 END) AS beat_model_count,
        SUM(CASE WHEN p.correct IS NOT NULL AND s.user_agreed_with_model IS NOT NULL THEN 1 ELSE 0 END) AS compared_reconciled
     FROM user_picks p
     LEFT JOIN pick_model_snapshots s ON s.user_pick_id = p.id
     WHERE p.user_id = ?`,
    [userId]
  );
  const total = base ? base.total_picks : 0;
  const correct = base ? (base.correct_count || 0) : 0;
  return {
    total_picks: total,
    correct_count: correct,
    accuracy_pct: total ? Math.round((correct / total) * 1000) / 10 : null,
    points: base ? base.points : 0,
    vs_model: {
      snapshots: vsModel ? vsModel.snapshots : 0,
      agreements: vsModel ? (vsModel.agreements || 0) : 0,
      beat_model_count: vsModel ? (vsModel.beat_model_count || 0) : 0,
      compared_reconciled: vsModel ? (vsModel.compared_reconciled || 0) : 0
    }
  };
}

function getEventPickComparison(eventId) {
  const fights = allRows(
    `SELECT id, red_fighter_id, blue_fighter_id, red_name, blue_name, is_main, card_position
     FROM fights WHERE event_id = ?
     ORDER BY is_main DESC, card_position ASC, id ASC`,
    [eventId]
  );
  const result = [];
  for (const fight of fights) {
    const pred = oneRow(
      `SELECT * FROM predictions WHERE fight_id = ?
       ORDER BY is_stale ASC, predicted_at DESC, id DESC LIMIT 1`,
      [fight.id]
    );
    const agg = oneRow(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN picked_fighter_id = ? THEN 1 ELSE 0 END) AS picked_red,
         SUM(CASE WHEN picked_fighter_id = ? THEN 1 ELSE 0 END) AS picked_blue,
         ROUND(AVG(CASE WHEN picked_fighter_id = ? THEN confidence END)) AS avg_conf_red,
         ROUND(AVG(CASE WHEN picked_fighter_id = ? THEN confidence END)) AS avg_conf_blue
       FROM user_picks WHERE fight_id = ?`,
      [fight.red_fighter_id, fight.blue_fighter_id, fight.red_fighter_id, fight.blue_fighter_id, fight.id]
    );
    result.push({
      fight_id: fight.id,
      red_fighter_id: fight.red_fighter_id,
      blue_fighter_id: fight.blue_fighter_id,
      red_name: fight.red_name,
      blue_name: fight.blue_name,
      is_main: fight.is_main,
      model: pred ? {
        version: pred.model_version,
        red_win_prob: pred.red_win_prob,
        blue_win_prob: pred.blue_win_prob,
        picked_fighter_id: pred.red_win_prob >= pred.blue_win_prob ? fight.red_fighter_id : fight.blue_fighter_id,
        confidence: Math.max(pred.red_win_prob, pred.blue_win_prob),
        explanation: parsePredictionExplanation(pred.explanation_json)
      } : null,
      users: {
        total: agg ? (agg.total || 0) : 0,
        picked_red: agg ? (agg.picked_red || 0) : 0,
        picked_blue: agg ? (agg.picked_blue || 0) : 0,
        avg_confidence_red: agg ? agg.avg_conf_red : null,
        avg_confidence_blue: agg ? agg.avg_conf_blue : null
      }
    });
  }
  return result;
}

function parsePredictionExplanation(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); }
  catch { return null; }
}

module.exports = {
  init, save, getDbStats,
  searchFighters, getFighter, getFighterEvents,
  getEventCard, getEvent, getEventByNumber, getFight, getAllEvents,
  getCareerStats, getHeadToHead, getFighterRecord,
  getRoundStats, getFightWithRounds, getStatLeaders, getAllFighters,
  upsertFighter, upsertEvent, upsertFight, upsertFightStats,
  upsertPrediction, getPredictions, prunePastPredictions, reconcilePrediction, getPredictionAccuracy,
  createUser, getUser, updateUser, deleteUser,
  getPickLockState, upsertPick, deletePick, getPicksForUser,
  lockPicksForEvent, reconcilePicksForEvent, reconcileAllPicks,
  getLeaderboard, getUserStats, getEventPickComparison,
  nextId, run, allRows, oneRow
};
