/**
 * db/index.js — SQLite database layer (sql.js / WASM)
 * Seeds from data/seed.json on init. In-memory for Railway (no persistent disk needed).
 * Swap to PostgreSQL by changing this file only — API contract stays identical.
 */
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

let db = null;

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
    red_fighter_id INTEGER REFERENCES fighters(id),
    blue_fighter_id INTEGER REFERENCES fighters(id),
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

  -- Indexes
  CREATE INDEX IF NOT EXISTS idx_fighters_name ON fighters(name);
  CREATE INDEX IF NOT EXISTS idx_events_number ON events(number);
  CREATE INDEX IF NOT EXISTS idx_fights_event ON fights(event_id);
  CREATE INDEX IF NOT EXISTS idx_fights_red ON fights(red_fighter_id);
  CREATE INDEX IF NOT EXISTS idx_fights_blue ON fights(blue_fighter_id);
  CREATE INDEX IF NOT EXISTS idx_round_stats_fight ON round_stats(fight_id);
`;

async function init() {
  const SQL = await initSqlJs();
  db = new SQL.Database();

  // Create schema
  db.run(SCHEMA);

  // Seed from JSON
  const seedPath = path.join(__dirname, '..', 'data', 'seed.json');
  if (fs.existsSync(seedPath)) {
    const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

    const insertFighter = db.prepare(
      'INSERT OR IGNORE INTO fighters (id,name,nickname,height_cm,reach_cm,stance,weight_class,nationality,dob,slpm,str_acc,sapm,str_def,td_avg,td_acc,td_def,sub_avg,ufcstats_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    );
    for (const f of seed.fighters || []) {
      insertFighter.run([f.id, f.name, f.nickname, f.height_cm, f.reach_cm, f.stance, f.weight_class, f.nationality, f.dob||null, f.slpm||null, f.str_acc||null, f.sapm||null, f.str_def||null, f.td_avg||null, f.td_acc||null, f.td_def||null, f.sub_avg||null, f.ufcstats_hash||null]);
    }
    insertFighter.free();

    const insertEvent = db.prepare(
      'INSERT OR IGNORE INTO events (id,number,name,date,venue,city,country,ufcstats_hash) VALUES (?,?,?,?,?,?,?,?)'
    );
    for (const e of seed.events || []) {
      insertEvent.run([e.id, e.number, e.name, e.date, e.venue||e.location||null, e.city||null, e.country||null, e.ufcstats_hash||null]);
    }
    insertEvent.free();

    const insertFight = db.prepare(
      'INSERT OR IGNORE INTO fights (id,event_id,red_fighter_id,blue_fighter_id,weight_class,is_title,is_main,card_position,method,method_detail,round,time,winner_id,referee,has_stats,ufcstats_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    );
    for (const f of seed.fights || []) {
      insertFight.run([f.id, f.event_id, f.red_fighter_id, f.blue_fighter_id, f.weight_class, f.is_title?1:0, f.is_main?1:0, f.card_position, f.method, f.method_detail, f.round, f.time, f.winner_id, f.referee, f.has_stats?1:0, f.ufcstats_hash||null]);
    }
    insertFight.free();

    const insertStats = db.prepare(
      'INSERT OR IGNORE INTO fight_stats (fight_id,fighter_id,sig_str_landed,sig_str_attempted,total_str_landed,total_str_attempted,takedowns_landed,takedowns_attempted,knockdowns,sub_attempts,control_time_sec,head_landed,body_landed,leg_landed,distance_landed,clinch_landed,ground_landed) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    );
    for (const s of seed.fight_stats || []) {
      insertStats.run([s.fight_id, s.fighter_id, s.sig_str_landed, s.sig_str_attempted, s.total_str_landed, s.total_str_attempted, s.takedowns_landed, s.takedowns_attempted, s.knockdowns, s.sub_attempts, s.control_time_sec, s.head_landed, s.body_landed, s.leg_landed, s.distance_landed, s.clinch_landed, s.ground_landed]);
    }
    insertStats.free();

    // Per-round stats (from scraper)
    if (seed.round_stats && seed.round_stats.length) {
      const insertRound = db.prepare(
        'INSERT OR IGNORE INTO round_stats (fight_id,fighter_id,round,kd,sig_str_landed,sig_str_attempted,total_str_landed,total_str_attempted,td_landed,td_attempted,sub_att,reversal,ctrl_sec,head_landed,head_attempted,body_landed,body_attempted,leg_landed,leg_attempted,distance_landed,distance_attempted,clinch_landed,clinch_attempted,ground_landed,ground_attempted) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
      );
      for (const rs of seed.round_stats) {
        insertRound.run([rs.fight_id, rs.fighter_id, rs.round, rs.kd||0, rs.sig_str_landed||0, rs.sig_str_attempted||0, rs.total_str_landed||0, rs.total_str_attempted||0, rs.td_landed||0, rs.td_attempted||0, rs.sub_att||0, rs.reversal||0, rs.ctrl_sec||0, rs.head_landed||0, rs.head_attempted||0, rs.body_landed||0, rs.body_attempted||0, rs.leg_landed||0, rs.leg_attempted||0, rs.distance_landed||0, rs.distance_attempted||0, rs.clinch_landed||0, rs.clinch_attempted||0, rs.ground_landed||0, rs.ground_attempted||0]);
      }
      insertRound.free();
    }

    const rsCount = (seed.round_stats || []).length;
    console.log(`[db] seeded: ${seed.fighters.length} fighters, ${seed.events.length} events, ${seed.fights.length} fights` + (rsCount ? `, ${rsCount} round stats` : ''));
  }

  return db;
}

// --- Query helpers (return plain JS objects) ---

function allRows(sql, params = []) {
  if (!db) throw new Error('Database not initialized');
  const stmt = db.prepare(sql);
  try {
    if (params.length) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

function oneRow(sql, params = []) {
  const rows = allRows(sql, params);
  return rows[0] || null;
}

// --- Public API ---

function searchFighters(query) {
  return allRows(
    `SELECT id, name, nickname, weight_class, nationality, stance, height_cm, reach_cm
     FROM fighters WHERE name LIKE ? OR nickname LIKE ? ORDER BY name LIMIT 20`,
    [`%${query}%`, `%${query}%`]
  );
}

function getFighter(id) {
  return oneRow('SELECT * FROM fighters WHERE id = ?', [id]);
}

function getFighterEvents(fighterId) {
  return allRows(
    `SELECT DISTINCT e.id, e.number, e.name, e.date, e.venue, e.city,
       f.id as fight_id, f.method, f.round, f.time, f.winner_id, f.is_title, f.is_main,
       fr.name as red_name, fb.name as blue_name, fr.id as red_id, fb.id as blue_id
     FROM events e
     JOIN fights f ON f.event_id = e.id
     JOIN fighters fr ON f.red_fighter_id = fr.id
     JOIN fighters fb ON f.blue_fighter_id = fb.id
     WHERE f.red_fighter_id = ? OR f.blue_fighter_id = ?
     ORDER BY e.date DESC, f.card_position ASC`,
    [fighterId, fighterId]
  );
}

function getEventCard(eventId) {
  return allRows(
    `SELECT f.id, f.weight_class, f.is_title, f.is_main, f.card_position,
       f.method, f.method_detail, f.round, f.time, f.winner_id, f.referee,
       fr.id as red_id, fr.name as red_name, fr.nickname as red_nickname,
       fb.id as blue_id, fb.name as blue_name, fb.nickname as blue_nickname
     FROM fights f
     JOIN fighters fr ON f.red_fighter_id = fr.id
     JOIN fighters fb ON f.blue_fighter_id = fb.id
     WHERE f.event_id = ?
     ORDER BY f.card_position ASC`,
    [eventId]
  );
}

function getEvent(eventId) {
  return oneRow('SELECT * FROM events WHERE id = ?', [eventId]);
}

function getEventByNumber(num) {
  return oneRow('SELECT * FROM events WHERE number = ?', [num]);
}

function getFight(fightId) {
  const fight = oneRow(
    `SELECT f.*,
       fr.name as red_name, fr.nickname as red_nickname, fr.height_cm as red_height, fr.reach_cm as red_reach, fr.stance as red_stance, fr.nationality as red_nationality,
       fb.name as blue_name, fb.nickname as blue_nickname, fb.height_cm as blue_height, fb.reach_cm as blue_reach, fb.stance as blue_stance, fb.nationality as blue_nationality,
       e.number as event_number, e.name as event_name, e.date as event_date, e.venue, e.city
     FROM fights f
     JOIN fighters fr ON f.red_fighter_id = fr.id
     JOIN fighters fb ON f.blue_fighter_id = fb.id
     JOIN events e ON f.event_id = e.id
     WHERE f.id = ?`,
    [fightId]
  );
  if (fight) {
    fight.stats = allRows('SELECT * FROM fight_stats WHERE fight_id = ?', [fightId]);
  }
  return fight;
}

function getAllEvents() {
  return allRows('SELECT * FROM events ORDER BY date DESC');
}

function getCareerStats(fighterId) {
  return oneRow(
    `SELECT
       fighter_id,
       COUNT(*) as total_fights,
       SUM(sig_str_landed) as total_sig_landed,
       SUM(sig_str_attempted) as total_sig_attempted,
       ROUND(CAST(SUM(sig_str_landed) AS REAL) / NULLIF(SUM(sig_str_attempted),0) * 100, 1) as sig_accuracy_pct,
       SUM(knockdowns) as total_knockdowns,
       SUM(takedowns_landed) as total_td_landed,
       SUM(takedowns_attempted) as total_td_attempted,
       ROUND(CAST(SUM(takedowns_landed) AS REAL) / NULLIF(SUM(takedowns_attempted),0) * 100, 1) as td_accuracy_pct,
       SUM(sub_attempts) as total_sub_attempts,
       SUM(control_time_sec) as total_control_sec,
       SUM(head_landed) as total_head,
       SUM(body_landed) as total_body,
       SUM(leg_landed) as total_leg,
       SUM(distance_landed) as total_distance,
       SUM(clinch_landed) as total_clinch,
       SUM(ground_landed) as total_ground,
       ROUND(CAST(SUM(sig_str_landed) AS REAL) / NULLIF(COUNT(*),0), 1) as avg_sig_per_fight,
       ROUND(CAST(SUM(knockdowns) AS REAL) / NULLIF(COUNT(*),0), 2) as avg_kd_per_fight
     FROM fight_stats WHERE fighter_id = ?`,
    [fighterId]
  );
}

function getHeadToHead(id1, id2) {
  return allRows(
    `SELECT f.*, e.number as event_number, e.name as event_name, e.date as event_date,
       fr.name as red_name, fb.name as blue_name
     FROM fights f
     JOIN events e ON f.event_id = e.id
     JOIN fighters fr ON f.red_fighter_id = fr.id
     JOIN fighters fb ON f.blue_fighter_id = fb.id
     WHERE (f.red_fighter_id = ? AND f.blue_fighter_id = ?)
        OR (f.red_fighter_id = ? AND f.blue_fighter_id = ?)
     ORDER BY e.date DESC`,
    [id1, id2, id2, id1]
  );
}

function getFighterRecord(fighterId) {
  const wins = allRows(
    'SELECT COUNT(*) as c FROM fights WHERE winner_id = ?', [fighterId]
  )[0]?.c || 0;
  const total = allRows(
    'SELECT COUNT(*) as c FROM fights WHERE red_fighter_id = ? OR blue_fighter_id = ?',
    [fighterId, fighterId]
  )[0]?.c || 0;
  // Draws/NC: fights where winner_id is null or 0 and the fighter was involved
  const draws = allRows(
    `SELECT COUNT(*) as c FROM fights
     WHERE (red_fighter_id = ? OR blue_fighter_id = ?)
       AND (winner_id IS NULL OR winner_id = 0
            OR method LIKE '%Draw%' OR method LIKE '%No Contest%')`,
    [fighterId, fighterId]
  )[0]?.c || 0;
  return { wins, losses: total - wins - draws, draws, total };
}

function getRoundStats(fightId) {
  return allRows(
    `SELECT rs.*, f.name as fighter_name
     FROM round_stats rs
     JOIN fighters f ON rs.fighter_id = f.id
     WHERE rs.fight_id = ?
     ORDER BY rs.round, rs.fighter_id`,
    [fightId]
  );
}

function getFightWithRounds(fightId) {
  const fight = getFight(fightId);
  if (fight) {
    fight.round_stats = getRoundStats(fightId);
    fight.has_round_stats = fight.round_stats.length > 0;
  }
  return fight;
}

function getStatLeaders(stat, limit = 10) {
  const validStats = {
    'knockdowns': 'SUM(knockdowns)',
    'sig_strikes': 'SUM(sig_str_landed)',
    'sig_accuracy': 'ROUND(CAST(SUM(sig_str_landed) AS REAL)/NULLIF(SUM(sig_str_attempted),0)*100,1)',
    'takedowns': 'SUM(takedowns_landed)',
    'td_accuracy': 'ROUND(CAST(SUM(takedowns_landed) AS REAL)/NULLIF(SUM(takedowns_attempted),0)*100,1)',
    'control_time': 'SUM(control_time_sec)',
    'sub_attempts': 'SUM(sub_attempts)',
    'fights': 'COUNT(*)'
  };
  const expr = validStats[stat];
  if (!expr) return [];
  const minFights = ['sig_accuracy','td_accuracy'].includes(stat) ? 'HAVING COUNT(*) >= 3' : '';
  return allRows(
    `SELECT fs.fighter_id, f.name, f.weight_class, f.nationality,
       COUNT(*) as fight_count, ${expr} as value
     FROM fight_stats fs JOIN fighters f ON fs.fighter_id = f.id
     GROUP BY fs.fighter_id ${minFights}
     ORDER BY value DESC LIMIT ?`,
    [limit]
  );
}

function getAllFighters(limit = 500) {
  return allRows('SELECT * FROM fighters ORDER BY name LIMIT ?', [limit]);
}

module.exports = {
  init, searchFighters, getFighter, getFighterEvents,
  getEventCard, getEvent, getEventByNumber, getFight, getAllEvents,
  getCareerStats, getHeadToHead, getFighterRecord,
  getRoundStats, getFightWithRounds, getStatLeaders, getAllFighters
};
