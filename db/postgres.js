/**
 * db/postgres.js — PostgreSQL database layer
 *
 * Activated when DATABASE_URL is set.
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { getEventState, hasEventStarted } = require('../lib/eventState');

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
      headshot_url TEXT,
      body_url TEXT,
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
      start_time TEXT,
      end_time TEXT,
      timezone TEXT,
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
      predicted_method TEXT,
      predicted_round INTEGER,
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

  await run(`
    CREATE TABLE IF NOT EXISTS official_fight_outcomes (
      fight_id INTEGER PRIMARY KEY REFERENCES fights(id),
      event_id INTEGER REFERENCES events(id),
      status TEXT NOT NULL DEFAULT 'pending',
      winner_id INTEGER REFERENCES fighters(id),
      method TEXT,
      method_detail TEXT,
      round INTEGER,
      time TEXT,
      source TEXT,
      source_url TEXT,
      captured_at TEXT NOT NULL,
      raw_json TEXT
    )
  `);

  await run('CREATE INDEX IF NOT EXISTS idx_predictions_fight ON predictions(fight_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_predictions_event_date ON predictions(event_date)');
  await run('CREATE INDEX IF NOT EXISTS idx_official_outcomes_event ON official_fight_outcomes(event_id)');
  await run('ALTER TABLE predictions ADD COLUMN IF NOT EXISTS explanation_json TEXT');
  await run('ALTER TABLE predictions ADD COLUMN IF NOT EXISTS predicted_method TEXT');
  await run('ALTER TABLE predictions ADD COLUMN IF NOT EXISTS predicted_round INTEGER');
  await run(`ALTER TABLE predictions ADD COLUMN IF NOT EXISTS enrichment_level TEXT NOT NULL DEFAULT 'lr'`);
  await run('ALTER TABLE predictions ADD COLUMN IF NOT EXISTS narrative_text TEXT');
  await run('ALTER TABLE predictions ADD COLUMN IF NOT EXISTS method_confidence DOUBLE PRECISION');
  await run('ALTER TABLE predictions ADD COLUMN IF NOT EXISTS insights JSONB');
  await run('CREATE INDEX IF NOT EXISTS idx_predictions_enrichment ON predictions(enrichment_level)');
  await run('ALTER TABLE events ADD COLUMN IF NOT EXISTS start_time TEXT');
  await run('ALTER TABLE events ADD COLUMN IF NOT EXISTS end_time TEXT');
  await run('ALTER TABLE events ADD COLUMN IF NOT EXISTS timezone TEXT');
  await run('ALTER TABLE fighters ADD COLUMN IF NOT EXISTS headshot_url TEXT');
  await run('ALTER TABLE fighters ADD COLUMN IF NOT EXISTS body_url TEXT');
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
  // NOTE: `users` table is created/migrated by runProfileSchemaV1() instead of here,
  // so the schema can be extended for better-auth without breaking existing prod rows.
  // NOTE: user_id is a soft reference to users(id) OR users_legacy(id) — no FK
  // constraint, so the claim flow can rewrite legacy guest ids → new account ids
  // without violating constraints during the transition.
  await run(`
    CREATE TABLE IF NOT EXISTS user_picks (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
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

/**
 * Profile system v1 schema migration (Postgres).
 *
 * Mirrors db/sqlite.js runProfileSchemaV1 — handles three states idempotently
 * via db_meta.users_migrated_v1:
 *   1. Fresh DB           → create new users + auth tables
 *   2. Pre-migration DB   → drop user_picks FK, rename users → users_legacy
 *                            (audit cols added), create new users + auth tables
 *   3. Already migrated   → no-op (CREATE IF NOT EXISTS still safe)
 *
 * Postgres-specific: the existing user_picks_user_id_fkey FK must be dropped
 * BEFORE renaming `users`, otherwise Postgres would silently retarget the FK
 * at users_legacy and reject any new picks against the new users table.
 */
async function runProfileSchemaV1() {
  const flag = await oneRow("SELECT value FROM db_meta WHERE key = 'users_migrated_v1'");
  const alreadyMigrated = !!flag;

  if (!alreadyMigrated) {
    const usersTable = await oneRow(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'users'`
    );
    if (usersTable) {
      const emailCol = await oneRow(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'email'`
      );
      if (!emailCol) {
        // Drop any FK on user_picks.user_id (constraint name follows pg default
        // user_picks_user_id_fkey, but search by column to be safe across renames).
        const fk = await oneRow(`
          SELECT tc.constraint_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
           AND tc.table_schema = kcu.table_schema
          WHERE tc.table_schema = 'public'
            AND tc.table_name = 'user_picks'
            AND tc.constraint_type = 'FOREIGN KEY'
            AND kcu.column_name = 'user_id'
          LIMIT 1
        `);
        if (fk && fk.constraint_name) {
          await run(`ALTER TABLE user_picks DROP CONSTRAINT "${fk.constraint_name}"`);
        }
        await run('ALTER TABLE users RENAME TO users_legacy');
        await run('ALTER TABLE users_legacy ADD COLUMN IF NOT EXISTS claimed_by TEXT');
        await run('ALTER TABLE users_legacy ADD COLUMN IF NOT EXISTS claimed_at TEXT');
      }
    }
  }

  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      email_verified INTEGER DEFAULT 0,
      name TEXT,
      image TEXT,
      display_name TEXT,
      avatar_key TEXT,
      is_guest INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await run('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');

  await run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await run('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)');
  await run('CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)');

  await run(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      password TEXT,
      access_token TEXT,
      refresh_token TEXT,
      id_token TEXT,
      access_token_expires_at TEXT,
      refresh_token_expires_at TEXT,
      scope TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await run('CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_accounts_provider_account ON accounts(provider_id, account_id)');

  await run(`
    CREATE TABLE IF NOT EXISTS verifications (
      id TEXT PRIMARY KEY,
      identifier TEXT NOT NULL,
      value TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await run('CREATE INDEX IF NOT EXISTS idx_verifications_identifier ON verifications(identifier)');
  await run('CREATE INDEX IF NOT EXISTS idx_verifications_expires ON verifications(expires_at)');

  await run(`
    CREATE TABLE IF NOT EXISTS auth_login_attempts (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      ip TEXT,
      success INTEGER NOT NULL DEFAULT 0,
      attempted_at TEXT NOT NULL
    )
  `);
  await run('CREATE INDEX IF NOT EXISTS idx_login_attempts_email_time ON auth_login_attempts(email, attempted_at)');

  if (!alreadyMigrated) {
    await run(`
      INSERT INTO db_meta (key, value) VALUES ('users_migrated_v1', '1')
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `);
  }
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
          f.id, f.name, f.nickname || null, f.height_cm ?? null, f.reach_cm ?? null, f.stance || null,
          f.weight_class || null, f.nationality || null, f.dob || null, f.slpm ?? null, f.str_acc ?? null,
          f.sapm ?? null, f.str_def ?? null, f.td_avg ?? null, f.td_acc ?? null, f.td_def ?? null,
          f.sub_avg ?? null, f.ufcstats_hash || null
        ]
      );
    }

    for (const e of seed.events || []) {
      await client.query(
        `INSERT INTO events (id,number,name,date,venue,city,country,start_time,end_time,timezone,ufcstats_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (id) DO NOTHING`,
        [e.id, e.number || null, e.name, e.date || null, e.venue || e.location || null, e.city || null, e.country || null, e.start_time || null, e.end_time || null, e.timezone || null, e.ufcstats_hash || null]
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
  await runProfileSchemaV1();
  await backfillFighterImagesFromJson();
  await backfillEventTimingFromSeed(options.seedPath);
  return pool;
}

// Re-applies event date / timing metadata from seed.json on every boot.
// The seed-on-init path only INSERTs when the table is empty, so production
// Postgres rows from older deploys keep stale date/timing fields forever
// without an explicit UPDATE pass. Cheap (only touches rows whose value
// would change).
async function backfillEventTimingFromSeed(seedPath) {
  const sp = seedPath || path.join(__dirname, '..', 'data', 'seed.json');
  if (!fs.existsSync(sp)) return { applied: 0 };
  let seed;
  try { seed = JSON.parse(fs.readFileSync(sp, 'utf8')); }
  catch (e) { console.warn('[db] seed.json parse failed for timing backfill:', e.message); return { applied: 0 }; }
  let applied = 0;
  for (const e of seed.events || []) {
    if (!e || !Number.isFinite(+e.id)) continue;
    if (e.date == null && e.start_time == null && e.end_time == null && e.timezone == null) continue;
    const rc = await run(
      `UPDATE events SET
         date       = COALESCE(?, date),
         start_time = COALESCE(?, start_time),
         end_time   = COALESCE(?, end_time),
         timezone   = COALESCE(?, timezone)
       WHERE id = ?
         AND (COALESCE(date,'')       IS DISTINCT FROM COALESCE(?,'')
           OR COALESCE(start_time,'') IS DISTINCT FROM COALESCE(?,'')
           OR COALESCE(end_time,'')   IS DISTINCT FROM COALESCE(?,'')
           OR COALESCE(timezone,'')   IS DISTINCT FROM COALESCE(?,''))`,
      [e.date || null, e.start_time || null, e.end_time || null, e.timezone || null, e.id,
       e.date || null, e.start_time || null, e.end_time || null, e.timezone || null]
    );
    if (typeof rc === 'number') applied += rc;
  }
  if (applied > 0) console.log(`[db] backfilled ${applied} event timing rows`);
  return { applied };
}

// Reads data/fighter_images.json (output of scripts/build-fighter-images.js)
// and applies the URLs onto fighters. Idempotent — only updates rows where
// the URL would change. Cheap on subsequent boots.
async function backfillFighterImagesFromJson() {
  const imgPath = path.join(__dirname, '..', 'data', 'fighter_images.json');
  if (!fs.existsSync(imgPath)) return { applied: 0 };
  let map;
  try { map = JSON.parse(fs.readFileSync(imgPath, 'utf8')); }
  catch (e) { console.warn('[db] fighter_images.json parse failed:', e.message); return { applied: 0 }; }
  let applied = 0;
  for (const [id, urls] of Object.entries(map)) {
    const fighterId = parseInt(id, 10);
    if (!Number.isFinite(fighterId)) continue;
    const head = urls && urls.headshot_url ? String(urls.headshot_url) : null;
    const body = urls && urls.body_url ? String(urls.body_url) : null;
    const rc = await run(
      `UPDATE fighters SET headshot_url = ?, body_url = ?
       WHERE id = ?
         AND (COALESCE(headshot_url,'') IS DISTINCT FROM COALESCE(?,'')
           OR COALESCE(body_url,'') IS DISTINCT FROM COALESCE(?,''))`,
      [head, body, fighterId, head, body]
    );
    if (typeof rc === 'number') applied += rc;
  }
  if (applied > 0) console.log(`[db] backfilled ${applied} fighter images`);
  return { applied };
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
    official_outcomes: (await oneRow('SELECT COUNT(*)::int as c FROM official_fight_outcomes'))?.c || 0,
    persistent: true,
    dbPath: 'postgres',
    seeded,
    last_scrape: (await oneRow("SELECT value FROM db_meta WHERE key = 'last_scrape'"))?.value || null
  };
}

async function searchFighters(queryText) {
  return allRows(
    'SELECT id, name, nickname, weight_class, nationality, stance, height_cm, reach_cm, headshot_url, body_url FROM fighters WHERE name ILIKE ? OR nickname ILIKE ? ORDER BY name LIMIT 20',
    ['%' + queryText + '%', '%' + queryText + '%']
  );
}

async function getFighter(id) {
  return oneRow('SELECT * FROM fighters WHERE id = ?', [id]);
}

async function getFighterEvents(fighterId) {
  return allRows(
    'SELECT DISTINCT e.id, e.number, e.name, e.date, e.venue, e.city, f.id as fight_id, f.card_position, f.method, f.round, f.time, f.winner_id, f.is_title, f.is_main, fr.name as red_name, fr.headshot_url as red_headshot_url, fr.body_url as red_body_url, fb.name as blue_name, fb.headshot_url as blue_headshot_url, fb.body_url as blue_body_url, fr.id as red_id, fb.id as blue_id FROM events e JOIN fights f ON f.event_id = e.id JOIN fighters fr ON f.red_fighter_id = fr.id JOIN fighters fb ON f.blue_fighter_id = fb.id WHERE f.red_fighter_id = ? OR f.blue_fighter_id = ? ORDER BY e.date DESC, f.card_position ASC',
    [fighterId, fighterId]
  );
}

async function getEventCard(eventId) {
  return allRows(
    `WITH selected_event AS (
       SELECT date AS card_date FROM events WHERE id = ?
     ),
     career_fights AS (
       SELECT f.red_fighter_id AS fighter_id, f.winner_id, f.method, e.date AS event_date
       FROM fights f
       LEFT JOIN events e ON e.id = f.event_id
       UNION ALL
       SELECT f.blue_fighter_id AS fighter_id, f.winner_id, f.method, e.date AS event_date
       FROM fights f
       LEFT JOIN events e ON e.id = f.event_id
     ),
     fighter_records AS (
       SELECT fighter_id,
              COUNT(*)::int AS total,
              SUM(CASE WHEN winner_id = fighter_id THEN 1 ELSE 0 END)::int AS wins,
              SUM(CASE WHEN (winner_id IS NULL OR winner_id = 0)
                         AND (method ILIKE '%Draw%' OR method ILIKE '%No Contest%')
                       THEN 1 ELSE 0 END)::int AS draws
       FROM career_fights
       CROSS JOIN selected_event
       WHERE fighter_id IS NOT NULL
         AND ((winner_id IS NOT NULL AND winner_id != 0)
              OR method ILIKE '%Draw%'
              OR method ILIKE '%No Contest%')
         AND (selected_event.card_date IS NULL
              OR career_fights.event_date IS NULL
              OR career_fights.event_date < selected_event.card_date)
       GROUP BY fighter_id
     ),
     fighter_prior_fights AS (
       SELECT fighter_id,
              COUNT(*)::int AS prior_total
       FROM career_fights
       CROSS JOIN selected_event
       WHERE fighter_id IS NOT NULL
         AND selected_event.card_date IS NOT NULL
         AND career_fights.event_date IS NOT NULL
         AND career_fights.event_date < selected_event.card_date
       GROUP BY fighter_id
     )
     SELECT f.id, f.weight_class, f.is_title, f.is_main, f.card_position, f.method, f.method_detail, f.round, f.time, f.winner_id, f.referee,
       fr.id as red_id, fr.name as red_name, fr.nickname as red_nickname,
       fr.headshot_url as red_headshot_url, fr.body_url as red_body_url,
       COALESCE(rr.wins, 0) as red_record_wins,
       COALESCE(rr.total - rr.wins - rr.draws, 0) as red_record_losses,
       COALESCE(rr.draws, 0) as red_record_draws,
       COALESCE(rr.total, 0) as red_record_total,
       COALESCE(rp.prior_total, 0) as red_prior_ufc_fights,
       CASE WHEN se.card_date IS NOT NULL AND COALESCE(rp.prior_total, 0) = 0 THEN 1 ELSE 0 END as red_is_ufc_debut,
       fb.id as blue_id, fb.name as blue_name, fb.nickname as blue_nickname,
       fb.headshot_url as blue_headshot_url, fb.body_url as blue_body_url,
       COALESCE(br.wins, 0) as blue_record_wins,
       COALESCE(br.total - br.wins - br.draws, 0) as blue_record_losses,
       COALESCE(br.draws, 0) as blue_record_draws,
       COALESCE(br.total, 0) as blue_record_total,
       COALESCE(bp.prior_total, 0) as blue_prior_ufc_fights,
       CASE WHEN se.card_date IS NOT NULL AND COALESCE(bp.prior_total, 0) = 0 THEN 1 ELSE 0 END as blue_is_ufc_debut,
       oo.status as official_status, oo.winner_id as official_winner_id, oo.method as official_method,
       oo.method_detail as official_method_detail, oo.round as official_round, oo.time as official_time,
       oo.source as official_source, oo.source_url as official_source_url, oo.captured_at as official_captured_at
     FROM fights f
     CROSS JOIN selected_event se
     JOIN fighters fr ON f.red_fighter_id = fr.id
     JOIN fighters fb ON f.blue_fighter_id = fb.id
     LEFT JOIN fighter_records rr ON rr.fighter_id = fr.id
     LEFT JOIN fighter_records br ON br.fighter_id = fb.id
     LEFT JOIN fighter_prior_fights rp ON rp.fighter_id = fr.id
     LEFT JOIN fighter_prior_fights bp ON bp.fighter_id = fb.id
     LEFT JOIN official_fight_outcomes oo ON oo.fight_id = f.id
     WHERE f.event_id = ?
     ORDER BY f.card_position ASC`,
    [eventId, eventId]
  );
}

function attachState(row, now) {
  if (!row) return row;
  row.state = getEventState(row, now);
  return row;
}

// SELECT augmented with open_fights count so getEventState can fast-path
// reconciled cards into 'history' regardless of the calendar day.
const EVENT_SELECT_SQL = `
  SELECT e.*,
    (SELECT COUNT(*) FROM fights f WHERE f.event_id = e.id AND f.winner_id IS NULL) AS open_fights
  FROM events e
`;

async function getEvent(eventId) {
  const row = await oneRow(EVENT_SELECT_SQL + ' WHERE e.id = ?', [eventId]);
  return attachState(row, Date.now());
}
async function getEventByNumber(num) {
  const row = await oneRow(EVENT_SELECT_SQL + ' WHERE e.number = ?', [num]);
  return attachState(row, Date.now());
}

async function getFight(fightId) {
  const fight = await oneRow(
    `SELECT f.*, fr.name as red_name, fr.nickname as red_nickname, fr.height_cm as red_height, fr.reach_cm as red_reach, fr.stance as red_stance, fr.nationality as red_nationality, fr.headshot_url as red_headshot_url, fr.body_url as red_body_url,
       fb.name as blue_name, fb.nickname as blue_nickname, fb.height_cm as blue_height, fb.reach_cm as blue_reach, fb.stance as blue_stance, fb.nationality as blue_nationality, fb.headshot_url as blue_headshot_url, fb.body_url as blue_body_url,
       e.number as event_number, e.name as event_name, e.date as event_date, e.venue, e.city,
       oo.status as official_status, oo.winner_id as official_winner_id, oo.method as official_method,
       oo.method_detail as official_method_detail, oo.round as official_round, oo.time as official_time,
       oo.source as official_source, oo.source_url as official_source_url, oo.captured_at as official_captured_at
     FROM fights f
     JOIN fighters fr ON f.red_fighter_id = fr.id
     JOIN fighters fb ON f.blue_fighter_id = fb.id
     JOIN events e ON f.event_id = e.id
     LEFT JOIN official_fight_outcomes oo ON oo.fight_id = f.id
     WHERE f.id = ?`,
    [fightId]
  );
  if (fight) {
    fight.stats = await allRows('SELECT * FROM fight_stats WHERE fight_id = ?', [fightId]);
  }
  return fight;
}

async function getAllEvents() {
  const rows = await allRows(EVENT_SELECT_SQL + ' ORDER BY e.date DESC');
  const now = Date.now();
  return rows.map(r => attachState(r, now));
}

function nullableText(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

function nullableInt(value) {
  if (value == null || value === '') return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function outcomeRawJson(input) {
  const raw = input.raw_json != null ? input.raw_json : (input.raw != null ? input.raw : input);
  if (raw == null) return null;
  if (typeof raw === 'string') return raw;
  try { return JSON.stringify(raw); }
  catch { return null; }
}

function normalizeOfficialStatus(status, winnerId, method) {
  const s = nullableText(status);
  if (s) {
    const key = s.toLowerCase().replace(/[\s-]+/g, '_');
    if (['final', 'finalized', 'complete', 'completed'].includes(key)) return 'official';
    if (['draw', 'no_contest', 'nc'].includes(key)) return 'void';
    return key;
  }
  if (winnerId != null) return 'official';
  if (/draw|no contest|\bnc\b/i.test(String(method || ''))) return 'void';
  return 'pending';
}

function isTerminalOfficialOutcome(status, winnerId, method) {
  return winnerId != null ||
    ['official', 'void'].includes(status) ||
    /draw|no contest|\bnc\b/i.test(String(method || ''));
}

async function getOfficialOutcome(fightId) {
  return oneRow(
    `SELECT oo.*, fr.name AS winner_name
     FROM official_fight_outcomes oo
     LEFT JOIN fighters fr ON fr.id = oo.winner_id
     WHERE oo.fight_id = ?`,
    [fightId]
  );
}

async function getOfficialOutcomesForEvent(eventId) {
  return allRows(
    `SELECT oo.*, f.red_name, f.blue_name, fr.name AS winner_name
     FROM official_fight_outcomes oo
     JOIN fights f ON f.id = oo.fight_id
     LEFT JOIN fighters fr ON fr.id = oo.winner_id
     WHERE oo.event_id = ?
     ORDER BY f.card_position ASC, oo.fight_id ASC`,
    [eventId]
  );
}

async function upsertOfficialOutcome(input = {}) {
  const fightId = nullableInt(input.fight_id);
  if (!fightId) return null;
  const fight = await oneRow(
    'SELECT id, event_id, red_fighter_id, blue_fighter_id FROM fights WHERE id = ?',
    [fightId]
  );
  if (!fight) return null;

  const winnerId = nullableInt(input.winner_id != null ? input.winner_id : input.actual_winner_id);
  if (winnerId != null && winnerId !== fight.red_fighter_id && winnerId !== fight.blue_fighter_id) {
    const err = new Error('invalid_winner_id');
    err.code = 'invalid_winner_id';
    err.status = 400;
    throw err;
  }

  const method = nullableText(input.method);
  const methodDetail = nullableText(input.method_detail);
  const round = nullableInt(input.round);
  const time = nullableText(input.time);
  const status = normalizeOfficialStatus(input.status, winnerId, method);
  const capturedAt = nullableText(input.captured_at) || new Date().toISOString();
  const source = nullableText(input.source) || 'job';
  const sourceUrl = nullableText(input.source_url);
  const rawJson = outcomeRawJson(input);

  await run(
    `INSERT INTO official_fight_outcomes
       (fight_id, event_id, status, winner_id, method, method_detail, round, time, source, source_url, captured_at, raw_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(fight_id) DO UPDATE SET
       event_id = EXCLUDED.event_id,
       status = EXCLUDED.status,
       winner_id = EXCLUDED.winner_id,
       method = EXCLUDED.method,
       method_detail = EXCLUDED.method_detail,
       round = EXCLUDED.round,
       time = EXCLUDED.time,
       source = EXCLUDED.source,
       source_url = EXCLUDED.source_url,
       captured_at = EXCLUDED.captured_at,
       raw_json = EXCLUDED.raw_json`,
    [fightId, fight.event_id, status, winnerId, method, methodDetail, round, time, source, sourceUrl, capturedAt, rawJson]
  );

  if (isTerminalOfficialOutcome(status, winnerId, method)) {
    await run(
      `UPDATE fights
       SET winner_id = ?,
           method = COALESCE(?, method),
           method_detail = COALESCE(?, method_detail),
           round = COALESCE(?, round),
           time = COALESCE(?, time)
       WHERE id = ?`,
      [winnerId, method, methodDetail, round, time, fightId]
    );
  }

  return getOfficialOutcome(fightId);
}

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
    'SELECT fs.fighter_id, f.name, f.weight_class, f.nationality, f.headshot_url, f.body_url, COUNT(*)::int as fight_count, ' + expr + ' as value FROM fight_stats fs JOIN fighters f ON fs.fighter_id = f.id GROUP BY fs.fighter_id, f.name, f.weight_class, f.nationality, f.headshot_url, f.body_url ' + minFights + ' ORDER BY value DESC LIMIT ?',
    [limit]
  );
}

async function getAllFighters(limit = 500) { return allRows('SELECT * FROM fighters ORDER BY name LIMIT ?', [limit]); }

async function upsertFighter(f) {
  await run(
    `INSERT INTO fighters
     (id,name,nickname,height_cm,reach_cm,stance,weight_class,nationality,dob,
      slpm,str_acc,sapm,str_def,td_avg,td_acc,td_def,sub_avg,ufcstats_hash)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (id) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, fighters.name),
       nickname = COALESCE(EXCLUDED.nickname, fighters.nickname),
       height_cm = COALESCE(EXCLUDED.height_cm, fighters.height_cm),
       reach_cm = COALESCE(EXCLUDED.reach_cm, fighters.reach_cm),
       stance = COALESCE(EXCLUDED.stance, fighters.stance),
       weight_class = COALESCE(EXCLUDED.weight_class, fighters.weight_class),
       nationality = COALESCE(EXCLUDED.nationality, fighters.nationality),
       dob = COALESCE(EXCLUDED.dob, fighters.dob),
       slpm = COALESCE(EXCLUDED.slpm, fighters.slpm),
       str_acc = COALESCE(EXCLUDED.str_acc, fighters.str_acc),
       sapm = COALESCE(EXCLUDED.sapm, fighters.sapm),
       str_def = COALESCE(EXCLUDED.str_def, fighters.str_def),
       td_avg = COALESCE(EXCLUDED.td_avg, fighters.td_avg),
       td_acc = COALESCE(EXCLUDED.td_acc, fighters.td_acc),
       td_def = COALESCE(EXCLUDED.td_def, fighters.td_def),
       sub_avg = COALESCE(EXCLUDED.sub_avg, fighters.sub_avg),
       ufcstats_hash = COALESCE(EXCLUDED.ufcstats_hash, fighters.ufcstats_hash)`,
    [
      f.id, f.name, f.nickname || null, f.height_cm ?? null, f.reach_cm ?? null, f.stance || null,
      f.weight_class || null, f.nationality || null, f.dob || null, f.slpm ?? null, f.str_acc ?? null,
      f.sapm ?? null, f.str_def ?? null, f.td_avg ?? null, f.td_acc ?? null, f.td_def ?? null,
      f.sub_avg ?? null, f.ufcstats_hash || null
    ]
  );
}

async function upsertEvent(e) {
  await run(
    `INSERT INTO events (id,number,name,date,venue,city,country,start_time,end_time,timezone,ufcstats_hash)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (id) DO UPDATE SET
       number = EXCLUDED.number,
       name = EXCLUDED.name,
       date = EXCLUDED.date,
       venue = EXCLUDED.venue,
       city = EXCLUDED.city,
       country = EXCLUDED.country,
       start_time = COALESCE(EXCLUDED.start_time, events.start_time),
       end_time = COALESCE(EXCLUDED.end_time, events.end_time),
       timezone = COALESCE(EXCLUDED.timezone, events.timezone),
       ufcstats_hash = EXCLUDED.ufcstats_hash`,
    [e.id, e.number || null, e.name, e.date || null, e.venue || null, e.city || null, e.country || null, e.start_time || null, e.end_time || null, e.timezone || null, e.ufcstats_hash || null]
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

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function predictionPredictedMethod(p) {
  const value = firstDefined(
    p.predicted_method,
    p.method_prediction,
    p.method_pick,
    p.predicted && p.predicted.method,
    p.prediction && p.prediction.method
  );
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function predictionPredictedRound(p) {
  const value = firstDefined(
    p.predicted_round,
    p.round_prediction,
    p.round_pick,
    p.predicted && p.predicted.round,
    p.prediction && p.prediction.round
  );
  if (value == null) return null;
  const match = String(value).match(/\d+/);
  const n = match ? parseInt(match[0], 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function getPredictionLockState(input = {}) {
  const fightId = input.fight_id;
  const row = fightId ? await oneRow(
    `SELECT f.id AS fight_id, f.winner_id,
            e.date AS event_date, e.start_time AS event_start_time,
            e.end_time AS event_end_time, e.timezone AS event_timezone
     FROM fights f
     LEFT JOIN events e ON e.id = f.event_id
     WHERE f.id = ?`,
    [fightId]
  ) : null;
  const eventTiming = eventTimingFromRow(row, input);
  const started = hasEventStarted(eventTiming);
  const locked = (row && row.winner_id != null) || started;
  const reason = row && row.winner_id != null ? 'fight_over' : (started ? 'event_started' : null);
  return {
    exists: !!row,
    locked: !!locked,
    reason,
    fight_id: row && row.fight_id != null ? Number(row.fight_id) : (fightId || null),
    event_date: eventTiming.date
  };
}

async function upsertPrediction(p) {
  const explanationJson = p.explanation_json != null
    ? p.explanation_json
    : (p.explanation != null ? JSON.stringify(p.explanation) : null);
  const predictedMethod = predictionPredictedMethod(p);
  const predictedRound = predictionPredictedRound(p);
  const enrichmentLevel = p.enrichment_level || 'lr';
  const insightsJson = p.insights != null ? JSON.stringify(p.insights) : null;

  // Upgrade semantics: an incoming 'lr' is stale-on-arrival if a fresh
  // 'ensemble' already exists for the same fight. The post-insert UPDATE
  // below handles the reverse case (ensemble landing on a fresh lr row
  // marks the lr stale).
  let forceStale = !!p.is_stale;
  if (enrichmentLevel === 'lr') {
    const existing = await oneRow(
      `SELECT id FROM predictions
       WHERE fight_id = ? AND enrichment_level = 'ensemble'
         AND is_stale = 0 AND actual_winner_id IS NULL`,
      [p.fight_id]
    );
    if (existing) forceStale = true;
  }

  await run(
    `INSERT INTO predictions
     (fight_id, red_fighter_id, blue_fighter_id, red_win_prob, blue_win_prob,
      model_version, feature_hash, explanation_json, predicted_method, predicted_round,
      predicted_at, event_date, is_stale,
      enrichment_level, narrative_text, method_confidence, insights)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(fight_id, model_version) DO UPDATE SET
       red_fighter_id = EXCLUDED.red_fighter_id,
       blue_fighter_id = EXCLUDED.blue_fighter_id,
       red_win_prob = EXCLUDED.red_win_prob,
       blue_win_prob = EXCLUDED.blue_win_prob,
       feature_hash = EXCLUDED.feature_hash,
       explanation_json = EXCLUDED.explanation_json,
       predicted_method = EXCLUDED.predicted_method,
       predicted_round = EXCLUDED.predicted_round,
       predicted_at = EXCLUDED.predicted_at,
       event_date = EXCLUDED.event_date,
       is_stale = EXCLUDED.is_stale,
       enrichment_level = EXCLUDED.enrichment_level,
       narrative_text = EXCLUDED.narrative_text,
       method_confidence = EXCLUDED.method_confidence,
       insights = EXCLUDED.insights`,
    [
      p.fight_id, p.red_fighter_id, p.blue_fighter_id, p.red_win_prob, p.blue_win_prob,
      p.model_version, p.feature_hash || null, explanationJson, predictedMethod, predictedRound,
      p.predicted_at, p.event_date || null, forceStale ? 1 : 0,
      enrichmentLevel, p.narrative_text || null, p.method_confidence ?? null, insightsJson
    ]
  );
  if (!forceStale) {
    await run(
      `UPDATE predictions
       SET is_stale = 1
       WHERE fight_id = ?
         AND model_version <> ?
         AND is_stale = 0
         AND actual_winner_id IS NULL`,
      [p.fight_id, p.model_version]
    );
  }
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
      AND (p.event_date IS NULL OR p.event_date >= CURRENT_DATE::text)
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

async function prunePastPredictions({ before, include_concluded = true } = {}) {
  const cutoff = before || new Date().toISOString().slice(0, 10);
  let sql = `UPDATE predictions p
    SET is_stale = 1
    FROM fights f
    WHERE f.id = p.fight_id
      AND p.is_stale = 0
      AND (p.event_date < ?`;
  const params = [cutoff];
  if (include_concluded) sql += ' OR f.winner_id IS NOT NULL';
  sql += ')';
  const pruned = await run(sql, params);
  return { pruned, before: cutoff };
}

function predictionCorrect(pred, actualWinnerId) {
  return (actualWinnerId === pred.red_fighter_id && pred.red_win_prob > 0.5) ||
         (actualWinnerId === pred.blue_fighter_id && pred.blue_win_prob > 0.5) ? 1 : 0;
}

async function reconcilePrediction(fightId, actualWinnerId) {
  const preds = await allRows(
    'SELECT * FROM predictions WHERE fight_id = ? ORDER BY predicted_at DESC, id DESC',
    [fightId]
  );
  if (!preds.length) return null;

  const now = new Date().toISOString();
  const results = [];
  for (const pred of preds) {
    const correct = predictionCorrect(pred, actualWinnerId);
    const reconciledAt = pred.reconciled_at || now;
    await run(
      'UPDATE predictions SET actual_winner_id = ?, reconciled_at = ?, correct = ? WHERE id = ?',
      [actualWinnerId, reconciledAt, correct, pred.id]
    );
    results.push({ ...pred, actual_winner_id: actualWinnerId, reconciled_at: reconciledAt, correct });
  }

  return {
    ...results[0],
    reconciled_count: results.length,
    model_results: results.map(r => ({
      id: r.id,
      model_version: r.model_version,
      actual_winner_id: r.actual_winner_id,
      correct: r.correct
    }))
  };
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

/**
 * Postgres mirror of db/sqlite.js claimGuestProfile. Wraps all mutations in a
 * single client-bound transaction (BEGIN/COMMIT/ROLLBACK) — the standard
 * `query()` helper above acquires a fresh pool connection per call, so it
 * cannot be used for atomicity. Returns / throws the same shape as sqlite.
 */
async function claimGuestProfile(guestId, newUserId) {
  ensurePool();
  const client = await pool.connect();
  const q = (sql, params = []) => client.query(toPgPlaceholders(sql), params);
  const now = new Date().toISOString();
  try {
    await client.query('BEGIN');

    // Look up the source row. Some legacy guests sit in `users_legacy` (the
    // pre-better-auth table); others were left in the new `users` table when
    // the migration didn't relocate them. The /api/picks/guest-count endpoint
    // already checks both — claim has to be symmetric or you get the
    // "13 picks shown, claim returns guest_not_found" inconsistency.
    let source = 'users_legacy';
    let row = (await q('SELECT id, display_name, avatar_key, claimed_by FROM users_legacy WHERE id = ?', [guestId])).rows[0];
    if (!row) {
      row = (await q('SELECT id, display_name, avatar_key, NULL::text AS claimed_by FROM users WHERE id = ?', [guestId])).rows[0];
      if (row) source = 'users';
    }
    // Picks-only fallback: if the id is in neither table but picks exist
    // under it, allow the migration anyway. This handles users whose row
    // was deleted but whose orphaned picks remain referenced by user_id.
    if (!row) {
      const cnt = (await q('SELECT COUNT(*)::int AS c FROM user_picks WHERE user_id = ?', [guestId])).rows[0];
      if (cnt && cnt.c > 0) {
        row = { id: guestId, display_name: null, avatar_key: null, claimed_by: null };
        source = 'orphan-picks';
      }
    }
    if (!row) {
      await client.query('ROLLBACK');
      const err = new Error('guest_not_found'); err.code = 'guest_not_found'; err.status = 404; throw err;
    }

    // claimed_by is only meaningful for users_legacy (other sources don't
    // track it). Race-safe re-check happens in the UPDATE below.
    if (source === 'users_legacy' && row.claimed_by) {
      await client.query('ROLLBACK');
      const err = new Error('already_claimed'); err.code = 'already_claimed'; err.status = 409; throw err;
    }

    if (source === 'users_legacy') {
      const claimRes = await q(
        'UPDATE users_legacy SET claimed_by = ?, claimed_at = ? WHERE id = ? AND claimed_by IS NULL',
        [newUserId, now, guestId]
      );
      if (claimRes.rowCount === 0) {
        await client.query('ROLLBACK');
        const err = new Error('already_claimed'); err.code = 'already_claimed'; err.status = 409; throw err;
      }
    }

    const picksRes = await q('UPDATE user_picks SET user_id = ? WHERE user_id = ?', [newUserId, guestId]);
    const claimedPicks = picksRes.rowCount;

    const newUserRes = await q('SELECT display_name, avatar_key FROM users WHERE id = ?', [newUserId]);
    const newUser = newUserRes.rows[0];
    if (newUser) {
      const patches = []; const params = [];
      if (!newUser.display_name && row.display_name) { patches.push('display_name = ?'); params.push(row.display_name); }
      if (!newUser.avatar_key && row.avatar_key)     { patches.push('avatar_key = ?');   params.push(row.avatar_key); }
      if (patches.length) {
        patches.push('updated_at = ?'); params.push(now);
        params.push(newUserId);
        await q(`UPDATE users SET ${patches.join(', ')} WHERE id = ?`, params);
      }
    }
    await client.query('COMMIT');
    return {
      claimed_picks: claimedPicks,
      display_name: row.display_name,
      avatar_key: row.avatar_key,
      claim_source: source,
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* swallow */ }
    throw err;
  } finally {
    client.release();
  }
}

/* ── PICK LOCK STATE ──
   A pick is locked if: user_picks.locked_at is set, fights.winner_id is set,
   or the event has reached its precise start time. */

function eventTimingFromRow(row = {}, fallback = {}) {
  row = row || {};
  fallback = fallback || {};
  return {
    date: row.event_date || row.date || fallback.event_date || fallback.date || null,
    start_time: row.event_start_time || row.start_time || fallback.event_start_time || fallback.start_time || null,
    end_time: row.event_end_time || row.end_time || fallback.event_end_time || fallback.end_time || null,
    timezone: row.event_timezone || row.timezone || fallback.event_timezone || fallback.timezone || null
  };
}

function annotatePickLockLifecycle(row) {
  const eventStarted = hasEventStarted(eventTimingFromRow(row));
  row.event_started = eventStarted ? 1 : 0;
  row.is_locked = row.locked_at != null || row.winner_id != null || eventStarted ? 1 : 0;
  row.lock_reason = row.locked_at
    ? 'event_locked'
    : (row.winner_id != null ? 'fight_over' : (eventStarted ? 'event_started' : null));
  delete row.event_start_time;
  delete row.event_end_time;
  delete row.event_timezone;
  return row;
}

async function getPickLockState(userId, fightId) {
  const row = await oneRow(
    `SELECT p.id AS pick_id, p.locked_at, f.winner_id,
            e.date AS event_date, e.start_time AS event_start_time,
            e.end_time AS event_end_time, e.timezone AS event_timezone
     FROM fights f
     LEFT JOIN events e ON e.id = f.event_id
     LEFT JOIN user_picks p ON p.fight_id = f.id AND p.user_id = ?
     WHERE f.id = ?`,
    [userId, fightId]
  );
  if (!row) return { exists: false, locked: false, reason: null };
  const started = hasEventStarted(eventTimingFromRow(row));
  const locked = !!row.locked_at || row.winner_id != null || started;
  const reason = row.locked_at ? 'event_locked' : (row.winner_id != null ? 'fight_over' : (started ? 'event_started' : null));
  return { exists: !!row.pick_id, locked, reason, existing_pick_id: row.pick_id || null, event_date: row.event_date || null };
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
      fr.headshot_url AS red_headshot_url, fr.body_url AS red_body_url,
      fb.headshot_url AS blue_headshot_url, fb.body_url AS blue_body_url,
      ev.number AS event_number, ev.name AS event_name, ev.date AS event_date,
      ev.start_time AS event_start_time, ev.end_time AS event_end_time, ev.timezone AS event_timezone,
      fp.name AS picked_fighter_name, fp.headshot_url AS picked_headshot_url, fp.body_url AS picked_body_url,
      s.model_version AS model_version,
      s.model_picked_fighter_id AS model_picked_fighter_id,
      s.model_confidence AS model_confidence,
      s.user_agreed_with_model AS user_agreed_with_model
    FROM user_picks p
    JOIN fights f ON f.id = p.fight_id
    LEFT JOIN fighters fr ON fr.id = f.red_fighter_id
    LEFT JOIN fighters fb ON fb.id = f.blue_fighter_id
    LEFT JOIN events ev ON ev.id = p.event_id
    LEFT JOIN fighters fp ON fp.id = p.picked_fighter_id
    LEFT JOIN pick_model_snapshots s ON s.user_pick_id = p.id
    WHERE p.user_id = ?`;
  if (opts.event_id) { sql += ' AND p.event_id = ?'; params.push(opts.event_id); }
  if (opts.reconciled === true)  sql += ' AND p.correct IS NOT NULL';
  if (opts.reconciled === false) sql += ' AND p.correct IS NULL';
  sql += ' ORDER BY ev.date DESC, p.event_id DESC, p.fight_id ASC';
  return (await allRows(sql, params)).map(annotatePickLockLifecycle);
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

function trendPct(correct, total) {
  return total ? Math.round((correct / total) * 1000) / 10 : null;
}

function trendLimit(rawLimit) {
  const n = parseInt(rawLimit, 10);
  if (!Number.isFinite(n) || n <= 0) return 25;
  return Math.min(n, 100);
}

function eventLabel(row) {
  const prefix = row.event_number ? 'UFC ' + row.event_number : 'Event';
  return row.event_name ? prefix + ' · ' + row.event_name : prefix;
}

function buildPredictionTrendResponse(rows, limit) {
  const visible = rows.slice(-trendLimit(limit));
  let cumulativeTotal = 0;
  let cumulativeCorrect = 0;
  const events = visible.map(row => {
    const total = Number(row.total) || 0;
    const correct = Number(row.correct_count) || 0;
    cumulativeTotal += total;
    cumulativeCorrect += correct;
    return {
      event_id: row.event_id == null ? null : Number(row.event_id),
      event_number: row.event_number == null ? null : Number(row.event_number),
      event_name: row.event_name || null,
      event_label: eventLabel(row),
      event_date: row.event_date || null,
      total,
      correct_count: correct,
      accuracy_pct: trendPct(correct, total),
      cumulative_total: cumulativeTotal,
      cumulative_correct_count: cumulativeCorrect,
      cumulative_accuracy_pct: trendPct(cumulativeCorrect, cumulativeTotal)
    };
  });
  return {
    summary: {
      event_count: events.length,
      total: cumulativeTotal,
      correct_count: cumulativeCorrect,
      accuracy_pct: trendPct(cumulativeCorrect, cumulativeTotal)
    },
    events
  };
}

async function getPredictionTrends(opts = {}) {
  const params = [];
  let sql = `
    SELECT
      COALESCE(ev.id, f.event_id) AS event_id,
      ev.number AS event_number,
      ev.name AS event_name,
      COALESCE(ev.date, p.event_date) AS event_date,
      COUNT(*)::int AS total,
      COALESCE(SUM(CASE WHEN p.correct = 1 THEN 1 ELSE 0 END),0)::int AS correct_count
    FROM predictions p
    LEFT JOIN fights f ON f.id = p.fight_id
    LEFT JOIN events ev ON ev.id = f.event_id
    WHERE p.reconciled_at IS NOT NULL`;
  if (opts.event_date_from) { sql += ' AND COALESCE(ev.date, p.event_date) >= ?'; params.push(opts.event_date_from); }
  if (opts.event_date_to) { sql += ' AND COALESCE(ev.date, p.event_date) <= ?'; params.push(opts.event_date_to); }
  sql += `
    GROUP BY COALESCE(ev.id, f.event_id), ev.number, ev.name, COALESCE(ev.date, p.event_date)
    ORDER BY event_date ASC, event_id ASC`;
  return buildPredictionTrendResponse(await allRows(sql, params), opts.limit);
}

async function getModelLeaderboard(opts = {}) {
  const params = [];
  let sql = `
    SELECT
      p.model_version,
      COUNT(*)::int AS total,
      COALESCE(SUM(CASE WHEN p.correct = 1 THEN 1 ELSE 0 END),0)::int AS correct_count,
      ROUND((COALESCE(SUM(CASE WHEN p.correct = 1 THEN 1 ELSE 0 END),0)::numeric / NULLIF(COUNT(*), 0)) * 100, 1)::double precision AS accuracy_pct,
      COALESCE(SUM(CASE WHEN p.correct = 1
        THEN ROUND((10 * (GREATEST(p.red_win_prob, p.blue_win_prob) * 100.0 / 50.0))::numeric, 0)::int
        ELSE 0 END), 0)::int AS score,
      ROUND((AVG(GREATEST(p.red_win_prob, p.blue_win_prob) * 100.0))::numeric, 1)::double precision AS avg_confidence_pct,
      MAX(p.predicted_at) AS last_predicted_at,
      MAX(COALESCE(ev.date, p.event_date)) AS last_event_date
    FROM predictions p
    LEFT JOIN fights f ON f.id = p.fight_id
    LEFT JOIN events ev ON ev.id = f.event_id
    WHERE p.reconciled_at IS NOT NULL`;
  if (opts.event_date_from) { sql += ' AND COALESCE(ev.date, p.event_date) >= ?'; params.push(opts.event_date_from); }
  if (opts.event_date_to) { sql += ' AND COALESCE(ev.date, p.event_date) <= ?'; params.push(opts.event_date_to); }
  sql += `
    GROUP BY p.model_version
    ORDER BY score DESC, accuracy_pct DESC, correct_count DESC, total DESC, p.model_version ASC
    LIMIT ?`;
  params.push(trendLimit(opts.limit));

  const leaderboard = (await allRows(sql, params)).map((row, index) => {
    const total = Number(row.total) || 0;
    const correct = Number(row.correct_count) || 0;
    const score = Number(row.score) || 0;
    return {
      rank: index + 1,
      model_version: row.model_version,
      total,
      correct_count: correct,
      incorrect_count: Math.max(total - correct, 0),
      record: `${correct}-${Math.max(total - correct, 0)}`,
      accuracy_pct: row.accuracy_pct == null ? null : Number(row.accuracy_pct),
      score,
      points: score,
      avg_confidence_pct: row.avg_confidence_pct == null ? null : Number(row.avg_confidence_pct),
      last_predicted_at: row.last_predicted_at || null,
      last_event_date: row.last_event_date || null
    };
  });
  const totalPredictions = leaderboard.reduce((sum, row) => sum + row.total, 0);
  const totalCorrect = leaderboard.reduce((sum, row) => sum + row.correct_count, 0);
  return {
    summary: {
      model_count: leaderboard.length,
      total_predictions: totalPredictions,
      correct_count: totalCorrect,
      accuracy_pct: trendPct(totalCorrect, totalPredictions),
      score: leaderboard.reduce((sum, row) => sum + row.score, 0)
    },
    leaderboard
  };
}

function outcomeMethodBucket(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  if (text.includes('ko') || text.includes('tko')) return 'ko/tko';
  if (text.includes('submission') || text === 'sub' || text.includes(' sub')) return 'submission';
  if (text.includes('decision')) return 'decision';
  if (text.includes('draw')) return 'draw';
  if (text.includes('no contest') || text === 'nc') return 'no_contest';
  return text.replace(/[^a-z0-9]+/g, ' ').trim();
}

function buildPredictionOutcomeResponse(rows) {
  const predictions = rows.map(row => {
    const redProb = Number(row.red_win_prob) || 0;
    const blueProb = Number(row.blue_win_prob) || 0;
    const predictedSide = redProb >= blueProb ? 'red' : 'blue';
    const predictedProb = predictedSide === 'red' ? redProb : blueProb;
    const predictedFighterId = predictedSide === 'red' ? row.red_fighter_id : row.blue_fighter_id;
    const predictedFighterName = predictedSide === 'red' ? row.red_name : row.blue_name;
    const actualWinnerId = row.actual_winner_id == null ? null : Number(row.actual_winner_id);
    const actualSide = actualWinnerId === Number(row.red_fighter_id) ? 'red'
      : (actualWinnerId === Number(row.blue_fighter_id) ? 'blue' : null);
    const predictedRound = row.predicted_round == null ? null : Number(row.predicted_round);
    const actualRound = row.actual_round == null ? null : Number(row.actual_round);
    const methodBucket = outcomeMethodBucket(row.predicted_method);
    const actualMethodBucket = outcomeMethodBucket(row.actual_method);
    const methodCorrect = methodBucket && actualMethodBucket ? (methodBucket === actualMethodBucket ? 1 : 0) : null;
    const roundCorrect = predictedRound && actualRound ? (predictedRound === actualRound ? 1 : 0) : null;
    return {
      prediction_id: row.prediction_id == null ? null : Number(row.prediction_id),
      fight_id: row.fight_id == null ? null : Number(row.fight_id),
      event_id: row.event_id == null ? null : Number(row.event_id),
      event_number: row.event_number == null ? null : Number(row.event_number),
      event_name: row.event_name || null,
      event_label: eventLabel(row),
      event_date: row.event_date || null,
      model_version: row.model_version || null,
      predicted_at: row.predicted_at || null,
      fight_label: `${row.red_name || 'Red'} vs ${row.blue_name || 'Blue'}`,
      red_fighter_id: row.red_fighter_id == null ? null : Number(row.red_fighter_id),
      blue_fighter_id: row.blue_fighter_id == null ? null : Number(row.blue_fighter_id),
      red_name: row.red_name || null,
      blue_name: row.blue_name || null,
      predicted_fighter_id: predictedFighterId == null ? null : Number(predictedFighterId),
      predicted_fighter_name: predictedFighterName || null,
      predicted_side: predictedSide,
      predicted_confidence_pct: Math.round(predictedProb * 1000) / 10,
      predicted_method: row.predicted_method || null,
      predicted_round: predictedRound || null,
      actual_winner_id: actualWinnerId,
      actual_winner_name: row.actual_winner_name || null,
      actual_side: actualSide,
      actual_method: row.actual_method || null,
      actual_method_detail: row.actual_method_detail || null,
      actual_round: actualRound || null,
      actual_time: row.actual_time || null,
      official_status: row.official_status || null,
      official_captured_at: row.official_captured_at || null,
      official_source: row.official_source || null,
      correct: row.correct == null ? null : Number(row.correct),
      method_correct: methodCorrect,
      round_correct: roundCorrect
    };
  });
  const total = predictions.length;
  const correct = predictions.reduce((sum, row) => sum + (row.correct === 1 ? 1 : 0), 0);
  const methodRows = predictions.filter(row => row.method_correct !== null);
  const methodCorrect = methodRows.reduce((sum, row) => sum + (row.method_correct === 1 ? 1 : 0), 0);
  const roundRows = predictions.filter(row => row.round_correct !== null);
  const roundCorrect = roundRows.reduce((sum, row) => sum + (row.round_correct === 1 ? 1 : 0), 0);
  return {
    summary: {
      total,
      correct_count: correct,
      accuracy_pct: trendPct(correct, total),
      method_total: methodRows.length,
      method_correct_count: methodCorrect,
      method_accuracy_pct: trendPct(methodCorrect, methodRows.length),
      round_total: roundRows.length,
      round_correct_count: roundCorrect,
      round_accuracy_pct: trendPct(roundCorrect, roundRows.length)
    },
    predictions
  };
}

async function getPredictionOutcomeDetails(opts = {}) {
  const params = [];
  let sql = `
    SELECT
      p.id AS prediction_id,
      p.fight_id,
      COALESCE(ev.id, f.event_id) AS event_id,
      ev.number AS event_number,
      ev.name AS event_name,
      COALESCE(ev.date, p.event_date) AS event_date,
      p.model_version,
      p.predicted_at,
      p.red_fighter_id,
      p.blue_fighter_id,
      fr.name AS red_name,
      fb.name AS blue_name,
      p.red_win_prob,
      p.blue_win_prob,
      p.predicted_method,
      p.predicted_round,
      COALESCE(oo.winner_id, p.actual_winner_id, f.winner_id) AS actual_winner_id,
      aw.name AS actual_winner_name,
      COALESCE(oo.method, f.method) AS actual_method,
      COALESCE(oo.method_detail, f.method_detail) AS actual_method_detail,
      COALESCE(oo.round, f.round) AS actual_round,
      COALESCE(oo.time, f.time) AS actual_time,
      COALESCE(oo.status, CASE WHEN p.actual_winner_id IS NOT NULL THEN 'official' ELSE NULL END) AS official_status,
      oo.captured_at AS official_captured_at,
      oo.source AS official_source,
      p.correct
    FROM predictions p
    LEFT JOIN fights f ON f.id = p.fight_id
    LEFT JOIN events ev ON ev.id = f.event_id
    LEFT JOIN fighters fr ON fr.id = p.red_fighter_id
    LEFT JOIN fighters fb ON fb.id = p.blue_fighter_id
    LEFT JOIN official_fight_outcomes oo ON oo.fight_id = p.fight_id
    LEFT JOIN fighters aw ON aw.id = COALESCE(oo.winner_id, p.actual_winner_id, f.winner_id)
    WHERE p.reconciled_at IS NOT NULL`;
  if (opts.event_date_from) { sql += ' AND COALESCE(ev.date, p.event_date) >= ?'; params.push(opts.event_date_from); }
  if (opts.event_date_to) { sql += ' AND COALESCE(ev.date, p.event_date) <= ?'; params.push(opts.event_date_to); }
  if (opts.model_version) { sql += ' AND p.model_version = ?'; params.push(opts.model_version); }
  if (opts.event_id) { sql += ' AND COALESCE(ev.id, f.event_id) = ?'; params.push(opts.event_id); }
  if (opts.fight_id) { sql += ' AND p.fight_id = ?'; params.push(opts.fight_id); }
  sql += `
    ORDER BY COALESCE(ev.date, p.event_date) DESC, p.predicted_at DESC, p.id DESC
    LIMIT ?`;
  params.push(trendLimit(opts.limit));
  return buildPredictionOutcomeResponse(await allRows(sql, params));
}

async function getGlobalPredictionTrendForEvents(eventIds) {
  if (!eventIds.length) return new Map();
  const placeholders = eventIds.map(() => '?').join(',');
  const rows = await allRows(
    `SELECT
       f.event_id AS event_id,
       COUNT(*)::int AS total,
       COALESCE(SUM(CASE WHEN p.correct = 1 THEN 1 ELSE 0 END),0)::int AS correct_count
     FROM predictions p
     JOIN fights f ON f.id = p.fight_id
     WHERE p.reconciled_at IS NOT NULL
       AND f.event_id IN (${placeholders})
     GROUP BY f.event_id`,
    eventIds
  );
  return new Map(rows.map(row => [Number(row.event_id), {
    total: Number(row.total) || 0,
    correct_count: Number(row.correct_count) || 0
  }]));
}

async function getUserTrends(userId, opts = {}) {
  if (!userId) return null;
  const params = [userId];
  let sql = `
    SELECT
      p.event_id AS event_id,
      ev.number AS event_number,
      ev.name AS event_name,
      ev.date AS event_date,
      COUNT(*)::int AS total,
      COALESCE(SUM(CASE WHEN p.correct = 1 THEN 1 ELSE 0 END),0)::int AS correct_count,
      COALESCE(SUM(p.points),0)::int AS points,
      COALESCE(SUM(CASE WHEN p.correct = 1 AND s.user_agreed_with_model = 0 THEN 1 ELSE 0 END),0)::int AS beat_model_count,
      COALESCE(SUM(CASE WHEN s.model_picked_fighter_id IS NOT NULL AND p.actual_winner_id IS NOT NULL THEN 1 ELSE 0 END),0)::int AS model_on_user_total,
      COALESCE(SUM(CASE WHEN s.model_picked_fighter_id IS NOT NULL AND p.actual_winner_id IS NOT NULL AND s.model_picked_fighter_id = p.actual_winner_id THEN 1 ELSE 0 END),0)::int AS model_on_user_correct_count
    FROM user_picks p
    LEFT JOIN events ev ON ev.id = p.event_id
    LEFT JOIN pick_model_snapshots s ON s.user_pick_id = p.id
    WHERE p.user_id = ?
      AND p.correct IS NOT NULL`;
  if (opts.event_date_from) { sql += ' AND ev.date >= ?'; params.push(opts.event_date_from); }
  if (opts.event_date_to) { sql += ' AND ev.date <= ?'; params.push(opts.event_date_to); }
  sql += `
    GROUP BY p.event_id, ev.number, ev.name, ev.date
    ORDER BY ev.date ASC, p.event_id ASC`;

  const visible = (await allRows(sql, params)).slice(-trendLimit(opts.limit));
  const globalByEvent = await getGlobalPredictionTrendForEvents(
    visible.map(row => Number(row.event_id)).filter(Number.isFinite)
  );

  let cumulativeTotal = 0;
  let cumulativeCorrect = 0;
  let cumulativePoints = 0;
  let cumulativeBeatModel = 0;
  let cumulativeModelTotal = 0;
  let cumulativeModelCorrect = 0;
  let cumulativeGlobalTotal = 0;
  let cumulativeGlobalCorrect = 0;

  const events = visible.map(row => {
    const eventId = Number(row.event_id);
    const total = Number(row.total) || 0;
    const correct = Number(row.correct_count) || 0;
    const points = Number(row.points) || 0;
    const beatModel = Number(row.beat_model_count) || 0;
    const modelTotal = Number(row.model_on_user_total) || 0;
    const modelCorrect = Number(row.model_on_user_correct_count) || 0;
    const global = globalByEvent.get(eventId) || { total: 0, correct_count: 0 };

    cumulativeTotal += total;
    cumulativeCorrect += correct;
    cumulativePoints += points;
    cumulativeBeatModel += beatModel;
    cumulativeModelTotal += modelTotal;
    cumulativeModelCorrect += modelCorrect;
    cumulativeGlobalTotal += global.total;
    cumulativeGlobalCorrect += global.correct_count;

    return {
      event_id: eventId,
      event_number: row.event_number == null ? null : Number(row.event_number),
      event_name: row.event_name || null,
      event_label: eventLabel(row),
      event_date: row.event_date || null,
      total,
      correct_count: correct,
      accuracy_pct: trendPct(correct, total),
      points,
      beat_model_count: beatModel,
      model_on_user_total: modelTotal,
      model_on_user_correct_count: modelCorrect,
      model_on_user_accuracy_pct: trendPct(modelCorrect, modelTotal),
      global_model_total: global.total,
      global_model_correct_count: global.correct_count,
      global_model_accuracy_pct: trendPct(global.correct_count, global.total),
      cumulative_total: cumulativeTotal,
      cumulative_correct_count: cumulativeCorrect,
      cumulative_accuracy_pct: trendPct(cumulativeCorrect, cumulativeTotal),
      cumulative_points: cumulativePoints,
      cumulative_beat_model_count: cumulativeBeatModel,
      cumulative_model_on_user_total: cumulativeModelTotal,
      cumulative_model_on_user_correct_count: cumulativeModelCorrect,
      cumulative_model_on_user_accuracy_pct: trendPct(cumulativeModelCorrect, cumulativeModelTotal),
      cumulative_global_model_total: cumulativeGlobalTotal,
      cumulative_global_model_correct_count: cumulativeGlobalCorrect,
      cumulative_global_model_accuracy_pct: trendPct(cumulativeGlobalCorrect, cumulativeGlobalTotal)
    };
  });

  return {
    summary: {
      event_count: events.length,
      total_picks: cumulativeTotal,
      correct_count: cumulativeCorrect,
      accuracy_pct: trendPct(cumulativeCorrect, cumulativeTotal),
      points: cumulativePoints,
      beat_model_count: cumulativeBeatModel,
      model_on_user_picks: {
        total: cumulativeModelTotal,
        correct_count: cumulativeModelCorrect,
        accuracy_pct: trendPct(cumulativeModelCorrect, cumulativeModelTotal)
      },
      global_model: {
        total: cumulativeGlobalTotal,
        correct_count: cumulativeGlobalCorrect,
        accuracy_pct: trendPct(cumulativeGlobalCorrect, cumulativeGlobalTotal)
      }
    },
    events
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
  upsertOfficialOutcome, getOfficialOutcome, getOfficialOutcomesForEvent,
  getRoundStats, getFightWithRounds, getStatLeaders, getAllFighters,
  upsertFighter, upsertEvent, upsertFight, upsertFightStats,
  upsertPrediction, getPredictionLockState, getPredictions, prunePastPredictions, reconcilePrediction, getPredictionAccuracy, getPredictionTrends, getModelLeaderboard, getPredictionOutcomeDetails,
  createUser, getUser, updateUser, deleteUser, claimGuestProfile,
  getPickLockState, upsertPick, deletePick, getPicksForUser,
  lockPicksForEvent, reconcilePicksForEvent, reconcileAllPicks,
  getLeaderboard, getUserStats, getUserTrends, getEventPickComparison,
  nextId, run, allRows, oneRow
};
