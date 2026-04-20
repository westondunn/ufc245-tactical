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
  await run('CREATE INDEX IF NOT EXISTS idx_fighters_name ON fighters(name)');
  await run('CREATE INDEX IF NOT EXISTS idx_events_number ON events(number)');
  await run('CREATE INDEX IF NOT EXISTS idx_fights_event ON fights(event_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_fights_red ON fights(red_fighter_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_fights_blue ON fights(blue_fighter_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_fights_event_num ON fights(event_number)');
  await run('CREATE INDEX IF NOT EXISTS idx_round_stats_fight ON round_stats(fight_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_fights_winner ON fights(winner_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_fight_stats_fighter ON fight_stats(fighter_id)');
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
  await run(
    `INSERT INTO predictions
     (fight_id, red_fighter_id, blue_fighter_id, red_win_prob, blue_win_prob,
      model_version, feature_hash, predicted_at, event_date, is_stale)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(fight_id, model_version) DO UPDATE SET
       red_fighter_id = EXCLUDED.red_fighter_id,
       blue_fighter_id = EXCLUDED.blue_fighter_id,
       red_win_prob = EXCLUDED.red_win_prob,
       blue_win_prob = EXCLUDED.blue_win_prob,
       feature_hash = EXCLUDED.feature_hash,
       predicted_at = EXCLUDED.predicted_at,
       event_date = EXCLUDED.event_date,
       is_stale = EXCLUDED.is_stale`,
    [
      p.fight_id, p.red_fighter_id, p.blue_fighter_id, p.red_win_prob, p.blue_win_prob,
      p.model_version, p.feature_hash || null, p.predicted_at, p.event_date || null, p.is_stale ? 1 : 0
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
