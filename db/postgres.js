/**
 * db/postgres.js — PostgreSQL database layer
 *
 * Activated when DATABASE_URL is set.
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

let pool = null;
let seeded = false;

function pgConfig(connectionString) {
  const sslMode = String(process.env.PGSSLMODE || '').toLowerCase();
  const sslEnv = String(process.env.PGSSL || '').toLowerCase();
  const disableSSL = sslMode === 'disable' || sslEnv === 'false' || /sslmode=disable/i.test(connectionString);
  const requireSSL = sslMode === 'require' || sslEnv === 'true' || /sslmode=require/i.test(connectionString);
  const ssl = disableSSL ? false : (requireSSL ? { rejectUnauthorized: false } : undefined);

  return {
    connectionString,
    ssl,
    max: Math.max(parseInt(process.env.PG_POOL_MAX || '10', 10) || 10, 1)
  };
}

function ensurePool() {
  if (!pool) throw new Error('Database not initialized');
}

function toPgPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function query(sql, params = []) {
  ensurePool();
  return pool.query(toPgPlaceholders(sql), params);
}

async function allRows(sql, params = []) {
  const res = await query(sql, params);
  return res.rows;
}

async function oneRow(sql, params = []) {
  const rows = await allRows(sql, params);
  return rows[0] || null;
}

async function run(sql, params = []) {
  const res = await query(sql, params);
  return res.rowCount;
}

async function ensureSchema() {
  await run(`
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
      slpm DOUBLE PRECISION,
      str_acc DOUBLE PRECISION,
      sapm DOUBLE PRECISION,
      str_def DOUBLE PRECISION,
      td_avg DOUBLE PRECISION,
      td_acc DOUBLE PRECISION,
      td_def DOUBLE PRECISION,
      sub_avg DOUBLE PRECISION,
      ufcstats_hash TEXT
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY,
      number INTEGER,
      name TEXT NOT NULL,
      date TEXT,
      venue TEXT,
      city TEXT,
      country TEXT,
      ufcstats_hash TEXT
    )
  `);

  await run(`
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
    )
  `);

  await run(`
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
    )
  `);

  await run(`
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
      head_landed INTEGER DEFAULT 0,
      head_attempted INTEGER DEFAULT 0,
      body_landed INTEGER DEFAULT 0,
      body_attempted INTEGER DEFAULT 0,
      leg_landed INTEGER DEFAULT 0,
      leg_attempted INTEGER DEFAULT 0,
      distance_landed INTEGER DEFAULT 0,
      distance_attempted INTEGER DEFAULT 0,
      clinch_landed INTEGER DEFAULT 0,
      clinch_attempted INTEGER DEFAULT 0,
      ground_landed INTEGER DEFAULT 0,
      ground_attempted INTEGER DEFAULT 0,
      PRIMARY KEY (fight_id, fighter_id, round)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS biomechanics (
      id BIGSERIAL PRIMARY KEY,
      fight_id INTEGER REFERENCES fights(id),
      fighter_id INTEGER REFERENCES fighters(id),
      strike_type TEXT,
      estimated_force_n DOUBLE PRECISION,
      fist_velocity_ms DOUBLE PRECISION,
      target TEXT,
      round INTEGER,
      time_in_round TEXT,
      notes TEXT
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS predictions (
      id BIGSERIAL PRIMARY KEY,
      fight_id INTEGER REFERENCES fights(id),
      red_fighter_id INTEGER REFERENCES fighters(id),
      blue_fighter_id INTEGER REFERENCES fighters(id),
      red_win_prob DOUBLE PRECISION NOT NULL,
      blue_win_prob DOUBLE PRECISION NOT NULL,
      model_version TEXT NOT NULL,
      feature_hash TEXT,
      explanation_json TEXT,
      predicted_at TEXT NOT NULL,
      event_date TEXT,
      is_stale INTEGER DEFAULT 0,
      actual_winner_id INTEGER,
      reconciled_at TEXT,
      correct INTEGER
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS db_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  await run('CREATE INDEX IF NOT EXISTS idx_predictions_fight ON predictions(fight_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_predictions_event_date ON predictions(event_date)');
  await run('ALTER TABLE predictions ADD COLUMN IF NOT EXISTS explanation_json TEXT');
  await run('CREATE INDEX IF NOT EXISTS idx_fighters_name ON fighters(name)');
  await run('CREATE INDEX IF NOT EXISTS idx_events_number ON events(number)');
  await run('CREATE INDEX IF NOT EXISTS idx_fights_event ON fights(event_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_fights_red ON fights(red_fighter_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_fights_blue ON fights(blue_fighter_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_fights_event_num ON fights(event_number)');
  await run('CREATE INDEX IF NOT EXISTS idx_round_stats_fight ON round_stats(fight_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_fights_winner ON fights(winner_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_fight_stats_fighter ON fight_stats(fighter_id)');

  // ── User picks feature (additive) ──
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      avatar_key TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      is_guest INTEGER DEFAULT 1
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS user_picks (
      id BIGSERIAL PRIMARY KEY,
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
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS pick_model_snapshots (
      id BIGSERIAL PRIMARY KEY,
      user_pick_id BIGINT NOT NULL REFERENCES user_picks(id) ON DELETE CASCADE,
      prediction_id BIGINT REFERENCES predictions(id),
      model_version TEXT NOT NULL,
      model_picked_fighter_id INTEGER,
      model_confidence DOUBLE PRECISION,
      user_agreed_with_model INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  await run('CREATE INDEX IF NOT EXISTS idx_user_picks_user ON user_picks(user_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_user_picks_event ON user_picks(event_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_user_picks_fight ON user_picks(fight_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_user_picks_user_event ON user_picks(user_id, event_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_pick_snapshots_pick ON pick_model_snapshots(user_pick_id)');
}

async function migratePredictionsUniqueness() {
  await run(`
    DELETE FROM predictions p
    USING (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY fight_id, model_version
               ORDER BY predicted_at DESC, id DESC
             ) AS rn
      FROM predictions
    ) d
    WHERE p.id = d.id
      AND d.rn > 1
  `);

  await run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_predictions_fight_model
    ON predictions(fight_id, model_version)
  `);
}

async function seedFromFile(seedPath) {
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const f of seed.fighters || []) {
      await client.query(
        `INSERT INTO fighters
         (id,name,nickname,height_cm,reach_cm,stance,weight_class,nationality,dob,slpm,str_acc,sapm,str_def,td_avg,td_acc,td_def,sub_avg,ufcstats_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (id) DO NOTHING`,
        [
          f.id, f.name, f.nickname || null, f.height_cm || null, f.reach_cm || null, f.stance || null,
          f.weight_class || null, f.nationality || null, f.dob || null, f.slpm || null, f.str_acc || null,
          f.sapm || null, f.str_def || null, f.td_avg || null, f.td_acc || null, f.td_def || null,
          f.sub_avg || null, f.ufcstats_hash || null
        ]
      );
    }

    for (const e of seed.events || []) {
      await client.query(
        `INSERT INTO events (id,number,name,date,venue,city,country,ufcstats_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO NOTHING`,
        [e.id, e.number || null, e.name, e.date || null, e.venue || e.location || null, e.city || null, e.country || null, e.ufcstats_hash || null]
      );
    }

    for (const f of seed.fights || []) {
      await client.query(
        `INSERT INTO fights
         (id,event_id,event_number,red_fighter_id,blue_fighter_id,red_name,blue_name,weight_class,is_title,is_main,card_position,method,method_detail,round,time,winner_id,referee,has_stats,ufcstats_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         ON CONFLICT (id) DO NOTHING`,
        [
          f.id, f.event_id, f.event_number || null, f.red_fighter_id, f.blue_fighter_id,
          f.red_name || null, f.blue_name || null, f.weight_class || null,
          f.is_title ? 1 : 0, f.is_main ? 1 : 0, f.card_position || null,
          f.method || null, f.method_detail || null, f.round || null, f.time || null,
          f.winner_id || null, f.referee || null, f.has_stats ? 1 : 0, f.ufcstats_hash || null
        ]
      );
    }

    for (const s of seed.fight_stats || []) {
      await client.query(
        `INSERT INTO fight_stats
         (fight_id,fighter_id,sig_str_landed,sig_str_attempted,total_str_landed,total_str_attempted,takedowns_landed,takedowns_attempted,knockdowns,sub_attempts,control_time_sec,head_landed,body_landed,leg_landed,distance_landed,clinch_landed,ground_landed)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (fight_id, fighter_id) DO NOTHING`,
        [
          s.fight_id, s.fighter_id, s.sig_str_landed || 0, s.sig_str_attempted || 0,
          s.total_str_landed || 0, s.total_str_attempted || 0, s.takedowns_landed || 0,
          s.takedowns_attempted || 0, s.knockdowns || 0, s.sub_attempts || 0,
          s.control_time_sec || 0, s.head_landed || 0, s.body_landed || 0,
          s.leg_landed || 0, s.distance_landed || 0, s.clinch_landed || 0, s.ground_landed || 0
        ]
      );
    }

    for (const rs of seed.round_stats || []) {
      await client.query(
        `INSERT INTO round_stats
         (fight_id,fighter_id,round,kd,sig_str_landed,sig_str_attempted,total_str_landed,total_str_attempted,td_landed,td_attempted,sub_att,reversal,ctrl_sec,head_landed,head_attempted,body_landed,body_attempted,leg_landed,leg_attempted,distance_landed,distance_attempted,clinch_landed,clinch_attempted,ground_landed,ground_attempted)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
         ON CONFLICT (fight_id, fighter_id, round) DO NOTHING`,
        [
          rs.fight_id, rs.fighter_id, rs.round, rs.kd || 0, rs.sig_str_landed || 0,
          rs.sig_str_attempted || 0, rs.total_str_landed || 0, rs.total_str_attempted || 0,
          rs.td_landed || 0, rs.td_attempted || 0, rs.sub_att || 0, rs.reversal || 0,
          rs.ctrl_sec || 0, rs.head_landed || 0, rs.head_attempted || 0, rs.body_landed || 0,
          rs.body_attempted || 0, rs.leg_landed || 0, rs.leg_attempted || 0,
          rs.distance_landed || 0, rs.distance_attempted || 0, rs.clinch_landed || 0,
          rs.clinch_attempted || 0, rs.ground_landed || 0, rs.ground_attempted || 0
        ]
      );
    }

    await client.query(
      "INSERT INTO db_meta (key, value) VALUES ('seeded_at', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
      [new Date().toISOString()]
    );

    await client.query('COMMIT');

    const rsCount = (seed.round_stats || []).length;
    console.log('[db] seeded postgres: ' + seed.fighters.length + ' fighters, ' + seed.events.length + ' events, ' + seed.fights.length + ' fights' + (rsCount ? ', ' + rsCount + ' round stats' : ''));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function init(options = {}) {
  const connectionString = options.databaseUrl || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for postgres backend');
  }

  if (!pool) {
    pool = new Pool(pgConfig(connectionString));
  }

  await query('SELECT 1');
  await ensureSchema();

  const fightersCount = await oneRow('SELECT COUNT(*)::int AS c FROM fighters');
  if (!fightersCount || !fightersCount.c) {
    const seedPath = options.seedPath || path.join(__dirname, '..', 'data', 'seed.json');
    if (fs.existsSync(seedPath)) {
      await seedFromFile(seedPath);
      seeded = true;
    }
  }

  await migratePredictionsUniqueness();
  return pool;
}

async function save() {
  // Postgres is already persistent; keep this for compatibility.
  return true;
}

async function nextId(table) {
  const allowed = new Set(['fighters', 'events', 'fights', 'predictions', 'biomechanics']);
  if (!allowed.has(table)) throw new Error('invalid_table');
  const row = await oneRow(`SELECT COALESCE(MAX(id), 0)::int AS m FROM ${table}`);
  return (row && row.m ? row.m : 0) + 1;
}

async function getDbStats() {
  return {
    fighters: (await oneRow('SELECT COUNT(*)::int as c FROM fighters'))?.c || 0,
    events: (await oneRow('SELECT COUNT(*)::int as c FROM events'))?.c || 0,
    fights: (await oneRow('SELECT COUNT(*)::int as c FROM fights'))?.c || 0,
    fight_stats: (await oneRow('SELECT COUNT(*)::int as c FROM fight_stats'))?.c || 0,
    persistent: true,
    dbPath: 'postgres',
    seeded,
    last_scrape: (await oneRow("SELECT value FROM db_meta WHERE key = 'last_scrape'"))?.value || null
  };
}

async function searchFighters(queryText) {
  return allRows(
    'SELECT id, name, nickname, weight_class, nationality, stance, height_cm, reach_cm FROM fighters WHERE name ILIKE ? OR nickname ILIKE ? ORDER BY name LIMIT 20',
    ['%' + queryText + '%', '%' + queryText + '%']
  );
}

async function getFighter(id) {
  return oneRow('SELECT * FROM fighters WHERE id = ?', [id]);
}

async function getFighterEvents(fighterId) {
  return allRows(
    'SELECT DISTINCT e.id, e.number, e.name, e.date, e.venue, e.city, f.id as fight_id, f.method, f.round, f.time, f.winner_id, f.is_title, f.is_main, fr.name as red_name, fb.name as blue_name, fr.id as red_id, fb.id as blue_id FROM events e JOIN fights f ON f.event_id = e.id JOIN fighters fr ON f.red_fighter_id = fr.id JOIN fighters fb ON f.blue_fighter_id = fb.id WHERE f.red_fighter_id = ? OR f.blue_fighter_id = ? ORDER BY e.date DESC, f.card_position ASC',
    [fighterId, fighterId]
  );
}

async function getEventCard(eventId) {
  return allRows(
    'SELECT f.id, f.weight_class, f.is_title, f.is_main, f.card_position, f.method, f.method_detail, f.round, f.time, f.winner_id, f.referee, fr.id as red_id, fr.name as red_name, fr.nickname as red_nickname, fb.id as blue_id, fb.name as blue_name, fb.nickname as blue_nickname FROM fights f JOIN fighters fr ON f.red_fighter_id = fr.id JOIN fighters fb ON f.blue_fighter_id = fb.id WHERE f.event_id = ? ORDER BY f.card_position ASC',
    [eventId]
  );
}

async function getEvent(eventId) { return oneRow('SELECT * FROM events WHERE id = ?', [eventId]); }
async function getEventByNumber(num) { return oneRow('SELECT * FROM events WHERE number = ?', [num]); }

async function getFight(fightId) {
  const fight = await oneRow(
    'SELECT f.*, fr.name as red_name, fr.nickname as red_nickname, fr.height_cm as red_height, fr.reach_cm as red_reach, fr.stance as red_stance, fr.nationality as red_nationality, fb.name as blue_name, fb.nickname as blue_nickname, fb.height_cm as blue_height, fb.reach_cm as blue_reach, fb.stance as blue_stance, fb.nationality as blue_nationality, e.number as event_number, e.name as event_name, e.date as event_date, e.venue, e.city FROM fights f JOIN fighters fr ON f.red_fighter_id = fr.id JOIN fighters fb ON f.blue_fighter_id = fb.id JOIN events e ON f.event_id = e.id WHERE f.id = ?',
    [fightId]
  );
  if (fight) {
    fight.stats = await allRows('SELECT * FROM fight_stats WHERE fight_id = ?', [fightId]);
  }
  return fight;
}

async function getAllEvents() { return allRows('SELECT * FROM events ORDER BY date DESC'); }

async function getCareerStats(fighterId, asOf = null) {
  const params = [fighterId];
  let dateFilter = '';
  if (asOf) {
    dateFilter = ' AND e.date < ?';
    params.push(asOf);
  }

  const stats = await oneRow(
    `SELECT
      fs.fighter_id,
      COUNT(*)::int as total_fights,
      COALESCE(SUM(fs.sig_str_landed),0)::int as total_sig_landed,
      COALESCE(SUM(fs.sig_str_attempted),0)::int as total_sig_attempted,
      ROUND((COALESCE(SUM(fs.sig_str_landed),0)::numeric / NULLIF(SUM(fs.sig_str_attempted),0)) * 100, 1)::double precision as sig_accuracy_pct,
      COALESCE(SUM(fs.knockdowns),0)::int as total_knockdowns,
      COALESCE(SUM(fs.takedowns_landed),0)::int as total_td_landed,
      COALESCE(SUM(fs.takedowns_attempted),0)::int as total_td_attempted,
      ROUND((COALESCE(SUM(fs.takedowns_landed),0)::numeric / NULLIF(SUM(fs.takedowns_attempted),0)) * 100, 1)::double precision as td_accuracy_pct,
      COALESCE(SUM(fs.sub_attempts),0)::int as total_sub_attempts,
      COALESCE(SUM(fs.control_time_sec),0)::int as total_control_sec,
      COALESCE(SUM(fs.head_landed),0)::int as total_head,
      COALESCE(SUM(fs.body_landed),0)::int as total_body,
      COALESCE(SUM(fs.leg_landed),0)::int as total_leg,
      COALESCE(SUM(fs.distance_landed),0)::int as total_distance,
      COALESCE(SUM(fs.clinch_landed),0)::int as total_clinch,
      COALESCE(SUM(fs.ground_landed),0)::int as total_ground,
      ROUND((COALESCE(SUM(fs.sig_str_landed),0)::numeric / NULLIF(COUNT(*),0)), 1)::double precision as avg_sig_per_fight,
      ROUND((COALESCE(SUM(fs.knockdowns),0)::numeric / NULLIF(COUNT(*),0)), 2)::double precision as avg_kd_per_fight
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

  const last3 = await allRows(
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

async function getHeadToHead(id1, id2) {
  return allRows(
    'SELECT f.*, e.number as event_number, e.name as event_name, e.date as event_date, fr.name as red_name, fb.name as blue_name FROM fights f JOIN events e ON f.event_id = e.id JOIN fighters fr ON f.red_fighter_id = fr.id JOIN fighters fb ON f.blue_fighter_id = fb.id WHERE (f.red_fighter_id = ? AND f.blue_fighter_id = ?) OR (f.red_fighter_id = ? AND f.blue_fighter_id = ?) ORDER BY e.date DESC',
    [id1, id2, id2, id1]
  );
}

async function getFighterRecord(fighterId) {
  const row = await oneRow(
    `SELECT COUNT(*)::int as total,
       COALESCE(SUM(CASE WHEN winner_id = ? THEN 1 ELSE 0 END),0)::int as wins,
       COALESCE(SUM(CASE WHEN winner_id IS NULL OR winner_id = 0 OR method ILIKE '%Draw%' OR method ILIKE '%No Contest%' THEN 1 ELSE 0 END),0)::int as draws
     FROM fights WHERE red_fighter_id = ? OR blue_fighter_id = ?`,
    [fighterId, fighterId, fighterId]
  );
  if (!row) return { wins: 0, losses: 0, draws: 0, total: 0 };
  return { wins: row.wins, losses: row.total - row.wins - row.draws, draws: row.draws, total: row.total };
}

async function getRoundStats(fightId) {
  return allRows('SELECT rs.*, f.name as fighter_name FROM round_stats rs JOIN fighters f ON rs.fighter_id = f.id WHERE rs.fight_id = ? ORDER BY rs.round, rs.fighter_id', [fightId]);
}

async function getFightWithRounds(fightId) {
  const fight = await getFight(fightId);
  if (fight) {
    fight.round_stats = await getRoundStats(fightId);
    fight.has_round_stats = fight.round_stats.length > 0;
  }
  return fight;
}

async function getStatLeaders(stat, limit = 10) {
  const validStats = {
    knockdowns: 'COALESCE(SUM(knockdowns),0)::int',
    sig_strikes: 'COALESCE(SUM(sig_str_landed),0)::int',
    sig_accuracy: 'ROUND((COALESCE(SUM(sig_str_landed),0)::numeric/NULLIF(SUM(sig_str_attempted),0))*100,1)::double precision',
    takedowns: 'COALESCE(SUM(takedowns_landed),0)::int',
    td_accuracy: 'ROUND((COALESCE(SUM(takedowns_landed),0)::numeric/NULLIF(SUM(takedowns_attempted),0))*100,1)::double precision',
    control_time: 'COALESCE(SUM(control_time_sec),0)::int',
    sub_attempts: 'COALESCE(SUM(sub_attempts),0)::int',
    fights: 'COUNT(*)::int'
  };
  const expr = validStats[stat];
  if (!expr) return [];
  const minFights = ['sig_accuracy', 'td_accuracy'].includes(stat) ? 'HAVING COUNT(*) >= 3' : '';
  return allRows(
    'SELECT fs.fighter_id, f.name, f.weight_class, f.nationality, COUNT(*)::int as fight_count, ' + expr + ' as value FROM fight_stats fs JOIN fighters f ON fs.fighter_id = f.id GROUP BY fs.fighter_id, f.name, f.weight_class, f.nationality ' + minFights + ' ORDER BY value DESC LIMIT ?',
    [limit]
  );
}

async function getAllFighters(limit = 500) { return allRows('SELECT * FROM fighters ORDER BY name LIMIT ?', [limit]); }

async function upsertFighter(f) {
  await run(
    `INSERT INTO fighters (id,name,nickname,height_cm,reach_cm,stance,weight_class,nationality,dob,ufcstats_hash)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       nickname = EXCLUDED.nickname,
       height_cm = EXCLUDED.height_cm,
       reach_cm = EXCLUDED.reach_cm,
       stance = EXCLUDED.stance,
       weight_class = EXCLUDED.weight_class,
       nationality = EXCLUDED.nationality,
       dob = EXCLUDED.dob,
       ufcstats_hash = EXCLUDED.ufcstats_hash`,
    [f.id, f.name, f.nickname || null, f.height_cm || null, f.reach_cm || null, f.stance || null, f.weight_class || null, f.nationality || null, f.dob || null, f.ufcstats_hash || null]
  );
}

async function upsertEvent(e) {
  await run(
    `INSERT INTO events (id,number,name,date,venue,city,country,ufcstats_hash)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT (id) DO UPDATE SET
       number = EXCLUDED.number,
       name = EXCLUDED.name,
       date = EXCLUDED.date,
       venue = EXCLUDED.venue,
       city = EXCLUDED.city,
       country = EXCLUDED.country,
       ufcstats_hash = EXCLUDED.ufcstats_hash`,
    [e.id, e.number || null, e.name, e.date || null, e.venue || null, e.city || null, e.country || null, e.ufcstats_hash || null]
  );
}

async function upsertFight(f) {
  await run(
    `INSERT INTO fights (id,event_id,event_number,red_fighter_id,blue_fighter_id,red_name,blue_name,weight_class,is_title,is_main,card_position,method,method_detail,round,time,winner_id,referee,has_stats,ufcstats_hash)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (id) DO UPDATE SET
       event_id = EXCLUDED.event_id,
       event_number = EXCLUDED.event_number,
       red_fighter_id = EXCLUDED.red_fighter_id,
       blue_fighter_id = EXCLUDED.blue_fighter_id,
       red_name = EXCLUDED.red_name,
       blue_name = EXCLUDED.blue_name,
       weight_class = EXCLUDED.weight_class,
       is_title = EXCLUDED.is_title,
       is_main = EXCLUDED.is_main,
       card_position = EXCLUDED.card_position,
       method = EXCLUDED.method,
       method_detail = EXCLUDED.method_detail,
       round = EXCLUDED.round,
       time = EXCLUDED.time,
       winner_id = EXCLUDED.winner_id,
       referee = EXCLUDED.referee,
       has_stats = EXCLUDED.has_stats,
       ufcstats_hash = EXCLUDED.ufcstats_hash`,
    [f.id, f.event_id, f.event_number || null, f.red_fighter_id, f.blue_fighter_id, f.red_name || null, f.blue_name || null, f.weight_class || null, f.is_title ? 1 : 0, f.is_main ? 1 : 0, f.card_position || null, f.method || null, f.method_detail || null, f.round || null, f.time || null, f.winner_id || null, f.referee || null, f.has_stats ? 1 : 0, f.ufcstats_hash || null]
  );
}

async function upsertFightStats(s) {
  await run(
    `INSERT INTO fight_stats (fight_id,fighter_id,sig_str_landed,sig_str_attempted,total_str_landed,total_str_attempted,takedowns_landed,takedowns_attempted,knockdowns,sub_attempts,control_time_sec,head_landed,body_landed,leg_landed,distance_landed,clinch_landed,ground_landed)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (fight_id, fighter_id) DO UPDATE SET
       sig_str_landed = EXCLUDED.sig_str_landed,
       sig_str_attempted = EXCLUDED.sig_str_attempted,
       total_str_landed = EXCLUDED.total_str_landed,
       total_str_attempted = EXCLUDED.total_str_attempted,
       takedowns_landed = EXCLUDED.takedowns_landed,
       takedowns_attempted = EXCLUDED.takedowns_attempted,
       knockdowns = EXCLUDED.knockdowns,
       sub_attempts = EXCLUDED.sub_attempts,
       control_time_sec = EXCLUDED.control_time_sec,
       head_landed = EXCLUDED.head_landed,
       body_landed = EXCLUDED.body_landed,
       leg_landed = EXCLUDED.leg_landed,
       distance_landed = EXCLUDED.distance_landed,
       clinch_landed = EXCLUDED.clinch_landed,
       ground_landed = EXCLUDED.ground_landed`,
    [
      s.fight_id, s.fighter_id, s.sig_str_landed || 0, s.sig_str_attempted || 0,
      s.total_str_landed || 0, s.total_str_attempted || 0, s.takedowns_landed || 0,
      s.takedowns_attempted || 0, s.knockdowns || 0, s.sub_attempts || 0,
      s.control_time_sec || 0, s.head_landed || 0, s.body_landed || 0,
      s.leg_landed || 0, s.distance_landed || 0, s.clinch_landed || 0, s.ground_landed || 0
    ]
  );
}

async function upsertPrediction(p) {
  const explanationJson = p.explanation_json != null
    ? p.explanation_json
    : (p.explanation != null ? JSON.stringify(p.explanation) : null);
  await run(
    `INSERT INTO predictions
     (fight_id, red_fighter_id, blue_fighter_id, red_win_prob, blue_win_prob,
      model_version, feature_hash, explanation_json, predicted_at, event_date, is_stale)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(fight_id, model_version) DO UPDATE SET
       red_fighter_id = EXCLUDED.red_fighter_id,
       blue_fighter_id = EXCLUDED.blue_fighter_id,
       red_win_prob = EXCLUDED.red_win_prob,
       blue_win_prob = EXCLUDED.blue_win_prob,
       feature_hash = EXCLUDED.feature_hash,
       explanation_json = EXCLUDED.explanation_json,
       predicted_at = EXCLUDED.predicted_at,
       event_date = EXCLUDED.event_date,
       is_stale = EXCLUDED.is_stale`,
    [
      p.fight_id, p.red_fighter_id, p.blue_fighter_id, p.red_win_prob, p.blue_win_prob,
      p.model_version, p.feature_hash || null, explanationJson, p.predicted_at, p.event_date || null, p.is_stale ? 1 : 0
    ]
  );
}

async function getPredictions(opts = {}) {
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

async function reconcilePrediction(fightId, actualWinnerId) {
  let pred = await oneRow(
    'SELECT * FROM predictions WHERE fight_id = ? AND actual_winner_id IS NULL ORDER BY predicted_at DESC, id DESC LIMIT 1',
    [fightId]
  );
  if (!pred) {
    pred = await oneRow(
      'SELECT * FROM predictions WHERE fight_id = ? ORDER BY predicted_at DESC, id DESC LIMIT 1',
      [fightId]
    );
  }
  if (!pred) return null;

  const correct = (actualWinnerId === pred.red_fighter_id && pred.red_win_prob > 0.5) ||
                  (actualWinnerId === pred.blue_fighter_id && pred.blue_win_prob > 0.5) ? 1 : 0;

  await run(
    'UPDATE predictions SET actual_winner_id = ?, reconciled_at = ?, correct = ? WHERE id = ?',
    [actualWinnerId, new Date().toISOString(), correct, pred.id]
  );

  return { ...pred, actual_winner_id: actualWinnerId, correct };
}

async function getPredictionAccuracy() {
  return oneRow(
    `SELECT COUNT(*)::int as total,
       COALESCE(SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END),0)::int as correct_count,
       ROUND((COALESCE(SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END),0)::numeric / NULLIF(COUNT(*), 0)) * 100, 1)::double precision as accuracy_pct
     FROM predictions WHERE reconciled_at IS NOT NULL`
  );
}

/* ── USERS ── */

const crypto = require('crypto');
const { scorePick, normalizeMethod } = require('../lib/scoring');

async function createUser({ display_name, avatar_key }) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await run(
    'INSERT INTO users (id, display_name, avatar_key, created_at, updated_at, is_guest) VALUES (?,?,?,?,?,1)',
    [id, display_name, avatar_key || null, now, now]
  );
  return { id, display_name, avatar_key: avatar_key || null, created_at: now, updated_at: now, is_guest: 1 };
}

async function getUser(id) {
  if (!id) return null;
  return oneRow('SELECT * FROM users WHERE id = ?', [id]);
}

async function updateUser(id, { display_name, avatar_key }) {
  const user = await getUser(id);
  if (!user) return null;
  const fields = [];
  const params = [];
  if (display_name !== undefined) { fields.push('display_name = ?'); params.push(display_name); }
  if (avatar_key !== undefined)   { fields.push('avatar_key = ?');   params.push(avatar_key); }
  if (!fields.length) return user;
  fields.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(id);
  await run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params);
  return getUser(id);
}

async function deleteUser(id) {
  // Explicit cascade for parity with sqlite path (postgres FKs also handle it via ON DELETE CASCADE).
  await run(`DELETE FROM pick_model_snapshots
             WHERE user_pick_id IN (SELECT id FROM user_picks WHERE user_id = ?)`, [id]);
  await run('DELETE FROM user_picks WHERE user_id = ?', [id]);
  const res = await run('DELETE FROM users WHERE id = ?', [id]);
  return res > 0;
}

/* ── PICK LOCK STATE ──
   A pick is locked if: user_picks.locked_at is set, OR fights.winner_id is set. */

async function getPickLockState(userId, fightId) {
  const row = await oneRow(
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

async function upsertPick(input) {
  const { user_id, event_id, fight_id, picked_fighter_id, confidence, method_pick, round_pick, notes } = input;
  const lock = await getPickLockState(user_id, fight_id);
  if (lock.locked) {
    const err = new Error('pick_locked');
    err.code = 'pick_locked';
    err.reason = lock.reason;
    err.status = 409;
    throw err;
  }
  const now = new Date().toISOString();
  await run(
    `INSERT INTO user_picks
       (user_id, event_id, fight_id, picked_fighter_id, confidence, method_pick, round_pick, notes, submitted_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(user_id, fight_id) DO UPDATE SET
       picked_fighter_id = EXCLUDED.picked_fighter_id,
       confidence = EXCLUDED.confidence,
       method_pick = EXCLUDED.method_pick,
       round_pick = EXCLUDED.round_pick,
       notes = EXCLUDED.notes,
       updated_at = EXCLUDED.updated_at`,
    [user_id, event_id, fight_id, picked_fighter_id, confidence ?? 50, method_pick || null, round_pick || null, notes || null, now, now]
  );
  const pick = await oneRow('SELECT * FROM user_picks WHERE user_id = ? AND fight_id = ?', [user_id, fight_id]);
  if (!pick) return null;
  await refreshPickModelSnapshot(pick);
  const snapshot = await oneRow(
    'SELECT * FROM pick_model_snapshots WHERE user_pick_id = ? ORDER BY id DESC LIMIT 1',
    [pick.id]
  );
  return { pick, snapshot };
}

async function refreshPickModelSnapshot(pick) {
  // Find current prediction for the fight (latest non-stale unreconciled, else latest).
  let pred = await oneRow(
    `SELECT * FROM predictions
     WHERE fight_id = ? AND is_stale = 0
     ORDER BY predicted_at DESC, id DESC LIMIT 1`,
    [pick.fight_id]
  );
  if (!pred) {
    pred = await oneRow(
      'SELECT * FROM predictions WHERE fight_id = ? ORDER BY predicted_at DESC, id DESC LIMIT 1',
      [pick.fight_id]
    );
  }
  const now = new Date().toISOString();
  // Remove old snapshot (one-to-one semantics; history can be layered later)
  await run('DELETE FROM pick_model_snapshots WHERE user_pick_id = ?', [pick.id]);
  if (!pred) {
    await run(
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
  await run(
    `INSERT INTO pick_model_snapshots
       (user_pick_id, prediction_id, model_version, model_picked_fighter_id, model_confidence, user_agreed_with_model, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [pick.id, pred.id, pred.model_version, modelPicked, modelConf, agreed, now]
  );
}

async function deletePick(userId, pickId) {
  const pick = await oneRow('SELECT * FROM user_picks WHERE id = ? AND user_id = ?', [pickId, userId]);
  if (!pick) return { deleted: false, reason: 'not_found' };
  const lock = await getPickLockState(userId, pick.fight_id);
  if (lock.locked) return { deleted: false, reason: lock.reason || 'locked' };
  await run('DELETE FROM user_picks WHERE id = ?', [pickId]);
  return { deleted: true };
}

async function getPicksForUser(userId, opts = {}) {
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

async function lockPicksForEvent(eventId) {
  const res = await run(
    'UPDATE user_picks SET locked_at = ? WHERE event_id = ? AND locked_at IS NULL',
    [new Date().toISOString(), eventId]
  );
  return { locked: res || 0 };
}

/**
 * Reconcile all picks for an event.
 * - Fights with winner_id → picks score normally via scorePick.
 * - Fights with method matching /DRAW|NO CONTEST|NC/ and NO winner_id
 *   → all picks voided (correct=0, points=0, method/round_correct NULL).
 * - Fights with neither winner_id nor a terminal method (cancellations /
 *   not-yet-run) → skipped; picks stay unreconciled.
 *
 * Idempotent.
 */
async function reconcilePicksForEvent(eventId) {
  const fights = await allRows(
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
    const picks = await allRows(
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
      await run(
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

/**
 * Backfill: reconcile all picks across all events that have any settled fights.
 * Idempotent — safe to re-run. Useful when the predictions microservice
 * belatedly ingests winner_ids, or after a scoring formula change.
 */
async function reconcileAllPicks() {
  const events = await allRows('SELECT DISTINCT event_id FROM user_picks');
  let totalReconciled = 0;
  let totalPoints = 0;
  let eventsProcessed = 0;
  for (const row of events) {
    const r = await reconcilePicksForEvent(row.event_id);
    if (r.reconciled > 0) eventsProcessed++;
    totalReconciled += r.reconciled;
    totalPoints += r.points_awarded;
  }
  return { events_processed: eventsProcessed, reconciled: totalReconciled, points_awarded: totalPoints };
}

/* ── LEADERBOARDS + STATS ── */

async function getLeaderboard(opts = {}) {
  const params = [];
  let sql = `
    SELECT
      u.id AS user_id,
      u.display_name,
      u.avatar_key,
      COUNT(p.id)::int AS picks,
      COALESCE(SUM(CASE WHEN p.correct = 1 THEN 1 ELSE 0 END),0)::int AS correct_count,
      COALESCE(SUM(p.points),0)::int AS points,
      ROUND(
        (COALESCE(SUM(CASE WHEN p.correct = 1 THEN 1 ELSE 0 END),0)::numeric
         / NULLIF(COUNT(p.id), 0)) * 100, 1
      )::double precision AS accuracy_pct
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

async function getUserStats(userId) {
  if (!userId) return null;
  const base = await oneRow(
    `SELECT
        COUNT(*)::int AS total_picks,
        COALESCE(SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END),0)::int AS correct_count,
        COALESCE(SUM(points),0)::int AS points
     FROM user_picks WHERE user_id = ? AND correct IS NOT NULL`,
    [userId]
  );
  const vsModel = await oneRow(
    `SELECT
        COUNT(*)::int AS snapshots,
        COALESCE(SUM(CASE WHEN s.user_agreed_with_model = 1 THEN 1 ELSE 0 END),0)::int AS agreements,
        COALESCE(SUM(CASE WHEN p.correct = 1 AND s.user_agreed_with_model = 0 THEN 1 ELSE 0 END),0)::int AS beat_model_count,
        COALESCE(SUM(CASE WHEN p.correct IS NOT NULL AND s.user_agreed_with_model IS NOT NULL THEN 1 ELSE 0 END),0)::int AS compared_reconciled
     FROM user_picks p
     LEFT JOIN pick_model_snapshots s ON s.user_pick_id = p.id
     WHERE p.user_id = ?`,
    [userId]
  );
  const total = base ? base.total_picks : 0;
  const correct = base ? base.correct_count : 0;
  return {
    total_picks: total,
    correct_count: correct,
    accuracy_pct: total ? Math.round((correct / total) * 1000) / 10 : null,
    points: base ? base.points : 0,
    vs_model: {
      snapshots: vsModel ? vsModel.snapshots : 0,
      agreements: vsModel ? vsModel.agreements : 0,
      beat_model_count: vsModel ? vsModel.beat_model_count : 0,
      compared_reconciled: vsModel ? vsModel.compared_reconciled : 0
    }
  };
}

/**
 * Per-fight user-pick vs model aggregation for an event.
 * Returns an array with one entry per fight on the card.
 */
async function getEventPickComparison(eventId) {
  const fights = await allRows(
    `SELECT id, red_fighter_id, blue_fighter_id, red_name, blue_name, is_main, card_position
     FROM fights WHERE event_id = ?
     ORDER BY is_main DESC, card_position ASC, id ASC`,
    [eventId]
  );
  const result = [];
  for (const fight of fights) {
    const pred = await oneRow(
      `SELECT * FROM predictions WHERE fight_id = ?
       ORDER BY is_stale ASC, predicted_at DESC, id DESC LIMIT 1`,
      [fight.id]
    );
    const agg = await oneRow(
      `SELECT
         COUNT(*)::int AS total,
         COALESCE(SUM(CASE WHEN picked_fighter_id = ? THEN 1 ELSE 0 END),0)::int AS picked_red,
         COALESCE(SUM(CASE WHEN picked_fighter_id = ? THEN 1 ELSE 0 END),0)::int AS picked_blue,
         ROUND(AVG(CASE WHEN picked_fighter_id = ? THEN confidence END))::int AS avg_conf_red,
         ROUND(AVG(CASE WHEN picked_fighter_id = ? THEN confidence END))::int AS avg_conf_blue
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
        total: agg ? agg.total : 0,
        picked_red: agg ? agg.picked_red : 0,
        picked_blue: agg ? agg.picked_blue : 0,
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
  upsertPrediction, getPredictions, reconcilePrediction, getPredictionAccuracy,
  createUser, getUser, updateUser, deleteUser,
  getPickLockState, upsertPick, deletePick, getPicksForUser,
  lockPicksForEvent, reconcilePicksForEvent, reconcileAllPicks,
  getLeaderboard, getUserStats, getEventPickComparison,
  nextId, run, allRows, oneRow
};
