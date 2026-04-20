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
    migratePredictionsUniqueness();
    const c = oneRow('SELECT COUNT(*) as c FROM fighters');
    console.log('[db] loaded from ' + dbPath + ': ' + (c ? c.c : 0) + ' fighters');
    return db;
  }

  // Fresh database — seed from JSON
  db = new SQL.Database();
  db.run(SCHEMA);

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
  run(
    `INSERT INTO predictions
     (fight_id, red_fighter_id, blue_fighter_id, red_win_prob, blue_win_prob,
      model_version, feature_hash, predicted_at, event_date, is_stale)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(fight_id, model_version) DO UPDATE SET
       red_fighter_id = excluded.red_fighter_id,
       blue_fighter_id = excluded.blue_fighter_id,
       red_win_prob = excluded.red_win_prob,
       blue_win_prob = excluded.blue_win_prob,
       feature_hash = excluded.feature_hash,
       predicted_at = excluded.predicted_at,
       event_date = excluded.event_date,
       is_stale = excluded.is_stale`,
    [p.fight_id, p.red_fighter_id, p.blue_fighter_id, p.red_win_prob, p.blue_win_prob,
     p.model_version, p.feature_hash || null, p.predicted_at, p.event_date || null, p.is_stale ? 1 : 0]
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

module.exports = {
  init, save, getDbStats,
  searchFighters, getFighter, getFighterEvents,
  getEventCard, getEvent, getEventByNumber, getFight, getAllEvents,
  getCareerStats, getHeadToHead, getFighterRecord,
  getRoundStats, getFightWithRounds, getStatLeaders, getAllFighters,
  upsertFighter, upsertEvent, upsertFight, upsertFightStats,
  upsertPrediction, getPredictions, reconcilePrediction, getPredictionAccuracy,
  nextId, run, allRows, oneRow
};
