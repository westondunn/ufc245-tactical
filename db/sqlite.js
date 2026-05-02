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
const { getEventState, hasEventStarted } = require('../lib/eventState');

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
    -- ufc.com athlete image URLs. headshot_url is a square teaser; body_url
    -- is an upper-body / full-body fight-card image. Both backfilled from
    -- data/fighter_images.json on init.
    headshot_url TEXT,
    body_url TEXT,
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
    -- Lifecycle timing. start_time/end_time are UTC ISO-8601 strings; timezone
    -- is an IANA name for the venue (e.g. "America/Las_Vegas") used for
    -- display. NULL means we don't have time-of-day precision yet — falls
    -- back to date-only state detection.
    start_time TEXT,
    end_time TEXT,
    timezone TEXT,
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
    predicted_method TEXT,
    predicted_round INTEGER,
    predicted_at TEXT NOT NULL,
    event_date TEXT,
    is_stale INTEGER DEFAULT 0,
    actual_winner_id INTEGER,
    reconciled_at TEXT,
    correct INTEGER,
    enrichment_level TEXT NOT NULL DEFAULT 'lr',
    narrative_text TEXT,
    method_confidence REAL,
    insights TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_predictions_fight ON predictions(fight_id);
  CREATE INDEX IF NOT EXISTS idx_predictions_event_date ON predictions(event_date);
  CREATE INDEX IF NOT EXISTS idx_predictions_enrichment ON predictions(enrichment_level);
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
  );
  CREATE INDEX IF NOT EXISTS idx_official_outcomes_event ON official_fight_outcomes(event_id);
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

  -- ── Data audit + backfill (additive) ──
  CREATE TABLE IF NOT EXISTS coverage_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    ran_at TEXT NOT NULL,
    table_name TEXT NOT NULL,
    column_name TEXT NOT NULL,
    scope TEXT NOT NULL,
    total_rows INTEGER NOT NULL,
    non_null_rows INTEGER NOT NULL,
    coverage_pct REAL NOT NULL,
    gap_row_ids TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_coverage_run ON coverage_snapshots(run_id);
  CREATE INDEX IF NOT EXISTS idx_coverage_table_col ON coverage_snapshots(table_name, column_name, ran_at DESC);

  CREATE TABLE IF NOT EXISTS audit_runs (
    run_id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    trigger_source TEXT NOT NULL,
    scope_input TEXT,
    summary TEXT,
    error_text TEXT
  );

  CREATE TABLE IF NOT EXISTS pending_backfill (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name TEXT NOT NULL,
    row_id TEXT NOT NULL,
    column_name TEXT NOT NULL,
    current_value TEXT,
    proposed_value TEXT NOT NULL,
    source TEXT NOT NULL,
    source_url TEXT,
    confidence TEXT NOT NULL,
    reason TEXT,
    source_diff_json TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    applied_at TEXT,
    audit_run_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_backfill(status);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_open
    ON pending_backfill(table_name, row_id, column_name)
    WHERE status IN ('pending', 'approved');
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
    ensureEventTimingColumns();
    ensureFighterImageColumns();
    backfillEventTimingFromSeed(options.seedPath);
    backfillFighterImagesFromJson();
    migratePredictionsUniqueness();
    runProfileSchemaV1();
    const c = oneRow('SELECT COUNT(*) as c FROM fighters');
    console.log('[db] loaded from ' + dbPath + ': ' + (c ? c.c : 0) + ' fighters');
    return db;
  }

  // Fresh database — seed from JSON
  db = new SQL.Database();
  db.run(SCHEMA);
  ensurePredictionExplanationColumn();
  ensureEventTimingColumns();
  ensureFighterImageColumns();

  const seedPath = options.seedPath || path.join(__dirname, '..', 'data', 'seed.json');
  if (fs.existsSync(seedPath)) {
    seedFromFile(seedPath);
  }

  backfillEventTimingFromSeed(options.seedPath);
  backfillFighterImagesFromJson();
  migratePredictionsUniqueness();
  runProfileSchemaV1();
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
    insFighter.run([f.id,f.name,f.nickname,f.height_cm,f.reach_cm,f.stance,f.weight_class,f.nationality,f.dob||null,f.slpm??null,f.str_acc??null,f.sapm??null,f.str_def??null,f.td_avg??null,f.td_acc??null,f.td_def??null,f.sub_avg??null,f.ufcstats_hash||null]);
  }
  insFighter.free();

  const insEvent = db.prepare(
    'INSERT OR IGNORE INTO events (id,number,name,date,venue,city,country,start_time,end_time,timezone,ufcstats_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
  );
  for (const e of seed.events || []) {
    insEvent.run([e.id,e.number,e.name,e.date,e.venue||e.location||null,e.city||null,e.country||null,e.start_time||null,e.end_time||null,e.timezone||null,e.ufcstats_hash||null]);
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
  if (!cols.includes('predicted_method')) {
    run('ALTER TABLE predictions ADD COLUMN predicted_method TEXT');
  }
  if (!cols.includes('predicted_round')) {
    run('ALTER TABLE predictions ADD COLUMN predicted_round INTEGER');
  }
  if (!cols.includes('enrichment_level')) {
    run("ALTER TABLE predictions ADD COLUMN enrichment_level TEXT NOT NULL DEFAULT 'lr'");
  }
  if (!cols.includes('narrative_text')) {
    run('ALTER TABLE predictions ADD COLUMN narrative_text TEXT');
  }
  if (!cols.includes('method_confidence')) {
    run('ALTER TABLE predictions ADD COLUMN method_confidence REAL');
  }
  if (!cols.includes('insights')) {
    run('ALTER TABLE predictions ADD COLUMN insights TEXT');
  }
  run('CREATE INDEX IF NOT EXISTS idx_predictions_enrichment ON predictions(enrichment_level)');
}

function ensureEventTimingColumns() {
  const cols = allRows('PRAGMA table_info(events)').map(c => c.name);
  if (!cols.includes('start_time')) run('ALTER TABLE events ADD COLUMN start_time TEXT');
  if (!cols.includes('end_time')) run('ALTER TABLE events ADD COLUMN end_time TEXT');
  if (!cols.includes('timezone')) run('ALTER TABLE events ADD COLUMN timezone TEXT');
}

function ensureFighterImageColumns() {
  const cols = allRows('PRAGMA table_info(fighters)').map(c => c.name);
  if (!cols.includes('headshot_url')) run('ALTER TABLE fighters ADD COLUMN headshot_url TEXT');
  if (!cols.includes('body_url')) run('ALTER TABLE fighters ADD COLUMN body_url TEXT');
}

// Re-applies event date / timing metadata from seed.json on every boot.
// The INSERT OR IGNORE seed path only inserts when a row is missing, so
// existing rows from prior boots keep stale date/timing fields forever without
// this UPDATE pass. Idempotent — only touches rows whose value would change.
function backfillEventTimingFromSeed(seedPath) {
  const sp = seedPath || path.join(__dirname, '..', 'data', 'seed.json');
  if (!fs.existsSync(sp)) return { applied: 0 };
  let seed;
  try { seed = JSON.parse(fs.readFileSync(sp, 'utf8')); }
  catch (e) { console.warn('[db] seed.json parse failed for timing backfill:', e.message); return { applied: 0 }; }
  let applied = 0;
  const stmt = db.prepare(
    `UPDATE events SET
       date       = COALESCE(?, date),
       start_time = COALESCE(?, start_time),
       end_time   = COALESCE(?, end_time),
       timezone   = COALESCE(?, timezone)
     WHERE id = ?
       AND (COALESCE(date,'')       != COALESCE(?,'')
         OR COALESCE(start_time,'') != COALESCE(?,'')
         OR COALESCE(end_time,'')   != COALESCE(?,'')
         OR COALESCE(timezone,'')   != COALESCE(?,''))`
  );
  for (const e of seed.events || []) {
    if (!e || !Number.isFinite(+e.id)) continue;
    if (e.date == null && e.start_time == null && e.end_time == null && e.timezone == null) continue;
    stmt.run([e.date || null, e.start_time || null, e.end_time || null, e.timezone || null, e.id,
              e.date || null, e.start_time || null, e.end_time || null, e.timezone || null]);
    if (db.getRowsModified && db.getRowsModified() > 0) applied++;
  }
  stmt.free();
  return { applied };
}

// Reads data/fighter_images.json (output of scripts/build-fighter-images.js)
// and applies the URLs onto fighters. Idempotent — runs every boot, only
// touches rows whose URL would change. Cheap on subsequent boots.
function backfillFighterImagesFromJson() {
  const imgPath = path.join(__dirname, '..', 'data', 'fighter_images.json');
  if (!fs.existsSync(imgPath)) return { applied: 0 };
  let map;
  try { map = JSON.parse(fs.readFileSync(imgPath, 'utf8')); }
  catch (e) { console.warn('[db] fighter_images.json parse failed:', e.message); return { applied: 0 }; }
  let applied = 0;
  const stmt = db.prepare('UPDATE fighters SET headshot_url = ?, body_url = ? WHERE id = ? AND (COALESCE(headshot_url, "") != COALESCE(?, "") OR COALESCE(body_url, "") != COALESCE(?, ""))');
  for (const [id, urls] of Object.entries(map)) {
    const fighterId = parseInt(id, 10);
    if (!Number.isFinite(fighterId)) continue;
    const head = urls && urls.headshot_url ? String(urls.headshot_url) : null;
    const body = urls && urls.body_url ? String(urls.body_url) : null;
    stmt.run([head, body, fighterId, head, body]);
    if (db.getRowsModified && db.getRowsModified() > 0) applied++;
  }
  stmt.free();
  return { applied };
}

/**
 * Profile system v1 schema migration.
 *
 * Handles three states idempotently via db_meta.users_migrated_v1 flag:
 *   1. Fresh DB           → create new users table + auth tables
 *   2. Pre-migration DB   → rename old users → users_legacy (audit columns added),
 *                            create new users table + auth tables
 *   3. Already migrated   → no-op (CREATE IF NOT EXISTS still safe)
 *
 * The new `users` table extends the original (display_name, avatar_key, is_guest)
 * with better-auth fields (email, email_verified, name, image). Legacy guest rows
 * stay in users_legacy until claimed; user_picks.user_id softly references either
 * table (sqlite FK enforcement is off — see db/index.js comment).
 */
function runProfileSchemaV1() {
  const flag = oneRow("SELECT value FROM db_meta WHERE key = 'users_migrated_v1'");
  const alreadyMigrated = !!flag;

  if (!alreadyMigrated) {
    const oldUsers = oneRow("SELECT name FROM sqlite_master WHERE type='table' AND name='users'");
    if (oldUsers) {
      const cols = allRows('PRAGMA table_info(users)').map(c => c.name);
      const isLegacySchema = !cols.includes('email');
      if (isLegacySchema) {
        run('ALTER TABLE users RENAME TO users_legacy');
        run('ALTER TABLE users_legacy ADD COLUMN claimed_by TEXT');
        run('ALTER TABLE users_legacy ADD COLUMN claimed_at TEXT');
      }
    }
  }

  run(`
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
  run('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');

  run(`
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
  run('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)');
  run('CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)');
  run('CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)');

  run(`
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
  run('CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id)');
  run('CREATE INDEX IF NOT EXISTS idx_accounts_provider_account ON accounts(provider_id, account_id)');

  run(`
    CREATE TABLE IF NOT EXISTS verifications (
      id TEXT PRIMARY KEY,
      identifier TEXT NOT NULL,
      value TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  run('CREATE INDEX IF NOT EXISTS idx_verifications_identifier ON verifications(identifier)');
  run('CREATE INDEX IF NOT EXISTS idx_verifications_expires ON verifications(expires_at)');

  run(`
    CREATE TABLE IF NOT EXISTS auth_login_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      ip TEXT,
      success INTEGER NOT NULL DEFAULT 0,
      attempted_at TEXT NOT NULL
    )
  `);
  run('CREATE INDEX IF NOT EXISTS idx_login_attempts_email_time ON auth_login_attempts(email, attempted_at)');

  if (!alreadyMigrated) {
    run("INSERT OR REPLACE INTO db_meta (key, value) VALUES ('users_migrated_v1', '1')");
  }
}

/* ── UPSERT (for scraper) ── */
function upsertFighter(f) {
  run(
    `INSERT INTO fighters
     (id,name,nickname,height_cm,reach_cm,stance,weight_class,nationality,dob,
      slpm,str_acc,sapm,str_def,td_avg,td_acc,td_def,sub_avg,ufcstats_hash)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       name = COALESCE(excluded.name, fighters.name),
       nickname = COALESCE(excluded.nickname, fighters.nickname),
       height_cm = COALESCE(excluded.height_cm, fighters.height_cm),
       reach_cm = COALESCE(excluded.reach_cm, fighters.reach_cm),
       stance = COALESCE(excluded.stance, fighters.stance),
       weight_class = COALESCE(excluded.weight_class, fighters.weight_class),
       nationality = COALESCE(excluded.nationality, fighters.nationality),
       dob = COALESCE(excluded.dob, fighters.dob),
       slpm = COALESCE(excluded.slpm, fighters.slpm),
       str_acc = COALESCE(excluded.str_acc, fighters.str_acc),
       sapm = COALESCE(excluded.sapm, fighters.sapm),
       str_def = COALESCE(excluded.str_def, fighters.str_def),
       td_avg = COALESCE(excluded.td_avg, fighters.td_avg),
       td_acc = COALESCE(excluded.td_acc, fighters.td_acc),
       td_def = COALESCE(excluded.td_def, fighters.td_def),
       sub_avg = COALESCE(excluded.sub_avg, fighters.sub_avg),
       ufcstats_hash = COALESCE(excluded.ufcstats_hash, fighters.ufcstats_hash)`,
    [f.id,f.name,f.nickname||null,f.height_cm??null,f.reach_cm??null,f.stance||null,f.weight_class||null,f.nationality||null,f.dob||null,
     f.slpm??null,f.str_acc??null,f.sapm??null,f.str_def??null,f.td_avg??null,f.td_acc??null,f.td_def??null,f.sub_avg??null,f.ufcstats_hash||null]
  );
}

function upsertEvent(e) {
  run('INSERT OR REPLACE INTO events (id,number,name,date,venue,city,country,start_time,end_time,timezone,ufcstats_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [e.id,e.number||null,e.name,e.date||null,e.venue||null,e.city||null,e.country||null,e.start_time||null,e.end_time||null,e.timezone||null,e.ufcstats_hash||null]);
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
    official_outcomes: (oneRow('SELECT COUNT(*) as c FROM official_fight_outcomes') || {}).c || 0,
    persistent: !!dbPath,
    dbPath: dbPath || ':memory:',
    last_scrape: (oneRow("SELECT value FROM db_meta WHERE key = 'last_scrape'") || {}).value || null
  };
}

/* ── PUBLIC QUERY API (unchanged) ── */

function searchFighters(query) {
  return allRows(
    'SELECT id, name, nickname, weight_class, nationality, stance, height_cm, reach_cm, headshot_url, body_url FROM fighters WHERE name LIKE ? OR nickname LIKE ? ORDER BY name LIMIT 20',
    ['%' + query + '%', '%' + query + '%']);
}

function getFighter(id) { return oneRow('SELECT * FROM fighters WHERE id = ?', [id]); }

function getFighterEvents(fighterId) {
  return allRows(
    'SELECT DISTINCT e.id, e.number, e.name, e.date, e.venue, e.city, f.id as fight_id, f.card_position, f.method, f.round, f.time, f.winner_id, f.is_title, f.is_main, fr.name as red_name, fr.headshot_url as red_headshot_url, fr.body_url as red_body_url, fb.name as blue_name, fb.headshot_url as blue_headshot_url, fb.body_url as blue_body_url, fr.id as red_id, fb.id as blue_id FROM events e JOIN fights f ON f.event_id = e.id JOIN fighters fr ON f.red_fighter_id = fr.id JOIN fighters fb ON f.blue_fighter_id = fb.id WHERE f.red_fighter_id = ? OR f.blue_fighter_id = ? ORDER BY e.date DESC, f.card_position ASC',
    [fighterId, fighterId]);
}

function getEventCard(eventId) {
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
              COUNT(*) AS total,
              SUM(CASE WHEN winner_id = fighter_id THEN 1 ELSE 0 END) AS wins,
              SUM(CASE WHEN (winner_id IS NULL OR winner_id = 0)
                         AND (method LIKE '%Draw%' OR method LIKE '%No Contest%')
                       THEN 1 ELSE 0 END) AS draws
       FROM career_fights
       CROSS JOIN selected_event
       WHERE fighter_id IS NOT NULL
         AND ((winner_id IS NOT NULL AND winner_id != 0)
              OR method LIKE '%Draw%'
              OR method LIKE '%No Contest%')
         AND (selected_event.card_date IS NULL
              OR career_fights.event_date IS NULL
              OR career_fights.event_date < selected_event.card_date)
       GROUP BY fighter_id
     ),
     fighter_prior_fights AS (
       SELECT fighter_id,
              COUNT(*) AS prior_total
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
    [eventId, eventId]);
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

function getEvent(eventId) {
  const now = Date.now();
  return attachState(oneRow(EVENT_SELECT_SQL + ' WHERE e.id = ?', [eventId]), now);
}
function getEventByNumber(num) {
  const now = Date.now();
  return attachState(oneRow(EVENT_SELECT_SQL + ' WHERE e.number = ?', [num]), now);
}

function getFight(fightId) {
  const fight = oneRow(
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
    [fightId]);
  if (fight) { fight.stats = allRows('SELECT * FROM fight_stats WHERE fight_id = ?', [fightId]); }
  return fight;
}

function getAllEvents() {
  const now = Date.now();
  return allRows(EVENT_SELECT_SQL + ' ORDER BY e.date DESC').map(r => attachState(r, now));
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

function getOfficialOutcome(fightId) {
  return oneRow(
    `SELECT oo.*, fr.name AS winner_name
     FROM official_fight_outcomes oo
     LEFT JOIN fighters fr ON fr.id = oo.winner_id
     WHERE oo.fight_id = ?`,
    [fightId]
  );
}

function getOfficialOutcomesForEvent(eventId) {
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

function upsertOfficialOutcome(input = {}) {
  const fightId = nullableInt(input.fight_id);
  if (!fightId) return null;
  const fight = oneRow(
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

  run(
    `INSERT INTO official_fight_outcomes
       (fight_id, event_id, status, winner_id, method, method_detail, round, time, source, source_url, captured_at, raw_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(fight_id) DO UPDATE SET
       event_id = excluded.event_id,
       status = excluded.status,
       winner_id = excluded.winner_id,
       method = excluded.method,
       method_detail = excluded.method_detail,
       round = excluded.round,
       time = excluded.time,
       source = excluded.source,
       source_url = excluded.source_url,
       captured_at = excluded.captured_at,
       raw_json = excluded.raw_json`,
    [fightId, fight.event_id, status, winnerId, method, methodDetail, round, time, source, sourceUrl, capturedAt, rawJson]
  );

  if (isTerminalOfficialOutcome(status, winnerId, method)) {
    run(
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
  return allRows('SELECT fs.fighter_id, f.name, f.weight_class, f.nationality, f.headshot_url, f.body_url, COUNT(*) as fight_count, ' + expr + ' as value FROM fight_stats fs JOIN fighters f ON fs.fighter_id = f.id GROUP BY fs.fighter_id ' + minFights + ' ORDER BY value DESC LIMIT ?', [limit]);
}

function getAllFighters(limit = 500) { return allRows('SELECT * FROM fighters ORDER BY name LIMIT ?', [limit]); }

/* ── PREDICTIONS ── */

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

function getPredictionLockState(input = {}) {
  const fightId = input.fight_id;
  const row = fightId ? oneRow(
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

function upsertPrediction(p) {
  const explanationJson = p.explanation_json != null
    ? p.explanation_json
    : (p.explanation != null ? JSON.stringify(p.explanation) : null);
  const predictedMethod = predictionPredictedMethod(p);
  const predictedRound = predictionPredictedRound(p);
  const enrichmentLevel = p.enrichment_level || 'lr';
  const insightsJson = p.insights != null ? JSON.stringify(p.insights) : null;

  // Upgrade/freshness semantics: an incoming 'lr' is stale-on-arrival if a fresh
  // 'ensemble' already exists for the same fight. Same-level arrivals only
  // supersede older fresh rows; older reruns are stored stale for evaluation.
  let forceStale = !!p.is_stale;
  const activeFresh = oneRow(
    `SELECT id, model_version, enrichment_level, predicted_at FROM predictions
     WHERE fight_id = ? AND is_stale = 0 AND actual_winner_id IS NULL
     ORDER BY predicted_at DESC, id DESC
     LIMIT 1`,
    [p.fight_id]
  );
  if (activeFresh && activeFresh.model_version !== p.model_version) {
    if (enrichmentLevel === 'lr' && activeFresh.enrichment_level === 'ensemble') {
      forceStale = true;
    } else if (activeFresh.enrichment_level === enrichmentLevel) {
      const incomingTime = Date.parse(p.predicted_at || '');
      const activeTime = Date.parse(activeFresh.predicted_at || '');
      if (Number.isFinite(incomingTime) && Number.isFinite(activeTime) && activeTime > incomingTime) {
        forceStale = true;
      }
    }
  }

  run(
    `INSERT INTO predictions
     (fight_id, red_fighter_id, blue_fighter_id, red_win_prob, blue_win_prob,
      model_version, feature_hash, explanation_json, predicted_method, predicted_round,
      predicted_at, event_date, is_stale,
      enrichment_level, narrative_text, method_confidence, insights)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(fight_id, model_version) DO UPDATE SET
       red_fighter_id = excluded.red_fighter_id,
       blue_fighter_id = excluded.blue_fighter_id,
       red_win_prob = excluded.red_win_prob,
       blue_win_prob = excluded.blue_win_prob,
       feature_hash = excluded.feature_hash,
       explanation_json = excluded.explanation_json,
       predicted_method = excluded.predicted_method,
       predicted_round = excluded.predicted_round,
       predicted_at = excluded.predicted_at,
       event_date = excluded.event_date,
       is_stale = excluded.is_stale,
       enrichment_level = excluded.enrichment_level,
       narrative_text = excluded.narrative_text,
       method_confidence = excluded.method_confidence,
       insights = excluded.insights`,
	    [p.fight_id, p.red_fighter_id, p.blue_fighter_id, p.red_win_prob, p.blue_win_prob,
	     p.model_version, p.feature_hash || null, explanationJson, predictedMethod, predictedRound,
       p.predicted_at, p.event_date || null, forceStale ? 1 : 0,
       enrichmentLevel, p.narrative_text || null, p.method_confidence ?? null, insightsJson]
	  );
  if (!forceStale) {
    run(
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

function predictionCorrect(pred, actualWinnerId) {
  return (actualWinnerId === pred.red_fighter_id && pred.red_win_prob > 0.5) ||
         (actualWinnerId === pred.blue_fighter_id && pred.blue_win_prob > 0.5) ? 1 : 0;
}

function reconcilePrediction(fightId, actualWinnerId) {
  const preds = allRows(
    'SELECT * FROM predictions WHERE fight_id = ? ORDER BY predicted_at DESC, id DESC',
    [fightId]
  );
  if (!preds.length) return null;
  const now = new Date().toISOString();
  const results = preds.map(pred => {
    const correct = predictionCorrect(pred, actualWinnerId);
    const reconciledAt = pred.reconciled_at || now;
    run(
      'UPDATE predictions SET actual_winner_id = ?, reconciled_at = ?, correct = ? WHERE id = ?',
      [actualWinnerId, reconciledAt, correct, pred.id]
    );
    return { ...pred, actual_winner_id: actualWinnerId, reconciled_at: reconciledAt, correct };
  });
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

function getPredictionAccuracy(opts = {}) {
  if (opts && opts.breakdown === 'enrichment_level') {
    const rows = allRows(
      `SELECT enrichment_level,
              COUNT(*) AS n,
              SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END) AS correct
       FROM predictions
       WHERE reconciled_at IS NOT NULL
       GROUP BY enrichment_level`
    );
    const out = {};
    for (const r of rows) {
      const level = r.enrichment_level || 'lr';
      const n = Number(r.n);
      const correct = Number(r.correct || 0);
      out[level] = {
        n,
        correct,
        accuracy: n > 0 ? correct / n : 0
      };
    }
    return out;
  }
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

/**
 * Claim a legacy guest profile under a new authenticated account.
 *
 * Atomically:
 *   1. Marks users_legacy.claimed_by/claimed_at (only if not already claimed).
 *   2. Rewrites user_picks.user_id from the guest id to the new account id.
 *   3. Backfills users.display_name/avatar_key from the legacy row when the
 *      new account doesn't have its own values yet.
 *
 * Returns { claimed_picks, display_name, avatar_key } on success, or throws
 * with err.code = 'guest_not_found' | 'already_claimed'.
 */
function claimGuestProfile(guestId, newUserId) {
  // See db/postgres.js for the same logic with comments. Some legacy guests
  // are in users_legacy; others got left in the new users table; some have
  // no row at all but picks still exist under their id. Mirror what
  // /api/picks/guest-count already does so claim is symmetric.
  let source = 'users_legacy';
  let row = oneRow('SELECT id, display_name, avatar_key, claimed_by FROM users_legacy WHERE id = ?', [guestId]);
  if (!row) {
    row = oneRow('SELECT id, display_name, avatar_key FROM users WHERE id = ?', [guestId]);
    if (row) { row.claimed_by = null; source = 'users'; }
  }
  if (!row) {
    const cnt = oneRow('SELECT COUNT(*) AS c FROM user_picks WHERE user_id = ?', [guestId]);
    if (cnt && cnt.c > 0) {
      row = { id: guestId, display_name: null, avatar_key: null, claimed_by: null };
      source = 'orphan-picks';
    }
  }
  if (!row) {
    const err = new Error('guest_not_found'); err.code = 'guest_not_found'; err.status = 404; throw err;
  }
  if (source === 'users_legacy' && row.claimed_by) {
    const err = new Error('already_claimed'); err.code = 'already_claimed'; err.status = 409; throw err;
  }
  run('BEGIN');
  try {
    const now = new Date().toISOString();
    if (source === 'users_legacy') {
      run('UPDATE users_legacy SET claimed_by = ?, claimed_at = ? WHERE id = ? AND claimed_by IS NULL',
        [newUserId, now, guestId]);
      if (db.getRowsModified() === 0) {
        // Race: another claim won between the check and the update.
        run('ROLLBACK');
        const err = new Error('already_claimed'); err.code = 'already_claimed'; err.status = 409; throw err;
      }
    }
    run('UPDATE user_picks SET user_id = ? WHERE user_id = ?', [newUserId, guestId]);
    const claimedPicks = db.getRowsModified();
    // Only backfill if the new account doesn't already have its own values.
    const newUser = oneRow('SELECT display_name, avatar_key FROM users WHERE id = ?', [newUserId]);
    if (newUser) {
      const patches = [];
      const params = [];
      if (!newUser.display_name && row.display_name) { patches.push('display_name = ?'); params.push(row.display_name); }
      if (!newUser.avatar_key && row.avatar_key)     { patches.push('avatar_key = ?');   params.push(row.avatar_key); }
      if (patches.length) {
        patches.push('updated_at = ?'); params.push(now);
        params.push(newUserId);
        run(`UPDATE users SET ${patches.join(', ')} WHERE id = ?`, params);
      }
    }
    run('COMMIT');
    return {
      claimed_picks: claimedPicks,
      display_name: row.display_name,
      avatar_key: row.avatar_key,
      claim_source: source,
    };
  } catch (err) {
    try { run('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  }
}

/* ── PICK LOCK STATE ── */

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

function getPickLockState(userId, fightId) {
  const row = oneRow(
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
  return allRows(sql, params).map(annotatePickLockLifecycle);
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

function getPredictionTrends(opts = {}) {
  const params = [];
  let sql = `
    SELECT
      COALESCE(ev.id, f.event_id) AS event_id,
      ev.number AS event_number,
      ev.name AS event_name,
      COALESCE(ev.date, p.event_date) AS event_date,
      COUNT(*) AS total,
      SUM(CASE WHEN p.correct = 1 THEN 1 ELSE 0 END) AS correct_count
    FROM predictions p
    LEFT JOIN fights f ON f.id = p.fight_id
    LEFT JOIN events ev ON ev.id = f.event_id
    WHERE p.reconciled_at IS NOT NULL`;
  if (opts.event_date_from) { sql += ' AND COALESCE(ev.date, p.event_date) >= ?'; params.push(opts.event_date_from); }
  if (opts.event_date_to) { sql += ' AND COALESCE(ev.date, p.event_date) <= ?'; params.push(opts.event_date_to); }
  sql += `
    GROUP BY COALESCE(ev.id, f.event_id), ev.number, ev.name, COALESCE(ev.date, p.event_date)
    ORDER BY event_date ASC, event_id ASC`;
  return buildPredictionTrendResponse(allRows(sql, params), opts.limit);
}

function getModelLeaderboard(opts = {}) {
  const params = [];
  let sql = `
    SELECT
      p.model_version,
      COUNT(*) AS total,
      SUM(CASE WHEN p.correct = 1 THEN 1 ELSE 0 END) AS correct_count,
      ROUND(CAST(SUM(CASE WHEN p.correct = 1 THEN 1 ELSE 0 END) AS REAL) / NULLIF(COUNT(*), 0) * 100, 1) AS accuracy_pct,
      COALESCE(SUM(CASE WHEN p.correct = 1
        THEN CAST(ROUND(10 * ((CASE WHEN p.red_win_prob >= p.blue_win_prob THEN p.red_win_prob ELSE p.blue_win_prob END) * 100.0 / 50.0)) AS INTEGER)
        ELSE 0 END), 0) AS score,
      ROUND(AVG((CASE WHEN p.red_win_prob >= p.blue_win_prob THEN p.red_win_prob ELSE p.blue_win_prob END) * 100.0), 1) AS avg_confidence_pct,
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

  const leaderboard = allRows(sql, params).map((row, index) => {
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
  const roundRows = predictions.filter(row => row.round_correct !== null);
  return {
    summary: {
      total,
      correct_count: correct,
      accuracy_pct: trendPct(correct, total),
      method_total: methodRows.length,
      method_correct_count: methodRows.reduce((sum, row) => sum + (row.method_correct === 1 ? 1 : 0), 0),
      method_accuracy_pct: trendPct(methodRows.reduce((sum, row) => sum + (row.method_correct === 1 ? 1 : 0), 0), methodRows.length),
      round_total: roundRows.length,
      round_correct_count: roundRows.reduce((sum, row) => sum + (row.round_correct === 1 ? 1 : 0), 0),
      round_accuracy_pct: trendPct(roundRows.reduce((sum, row) => sum + (row.round_correct === 1 ? 1 : 0), 0), roundRows.length)
    },
    predictions
  };
}

function getPredictionOutcomeDetails(opts = {}) {
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
  return buildPredictionOutcomeResponse(allRows(sql, params));
}

function getGlobalPredictionTrendForEvents(eventIds) {
  if (!eventIds.length) return new Map();
  const placeholders = eventIds.map(() => '?').join(',');
  const rows = allRows(
    `SELECT
       f.event_id AS event_id,
       COUNT(*) AS total,
       SUM(CASE WHEN p.correct = 1 THEN 1 ELSE 0 END) AS correct_count
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

function getUserTrends(userId, opts = {}) {
  if (!userId) return null;
  const params = [userId];
  let sql = `
    SELECT
      p.event_id AS event_id,
      ev.number AS event_number,
      ev.name AS event_name,
      ev.date AS event_date,
      COUNT(*) AS total,
      SUM(CASE WHEN p.correct = 1 THEN 1 ELSE 0 END) AS correct_count,
      COALESCE(SUM(p.points),0) AS points,
      SUM(CASE WHEN p.correct = 1 AND s.user_agreed_with_model = 0 THEN 1 ELSE 0 END) AS beat_model_count,
      SUM(CASE WHEN s.model_picked_fighter_id IS NOT NULL AND p.actual_winner_id IS NOT NULL THEN 1 ELSE 0 END) AS model_on_user_total,
      SUM(CASE WHEN s.model_picked_fighter_id IS NOT NULL AND p.actual_winner_id IS NOT NULL AND s.model_picked_fighter_id = p.actual_winner_id THEN 1 ELSE 0 END) AS model_on_user_correct_count
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

  const visible = allRows(sql, params).slice(-trendLimit(opts.limit));
  const globalByEvent = getGlobalPredictionTrendForEvents(
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
        explanation: parsePredictionExplanation(pred.explanation_json),
        // New fields from LLM ensemble pipeline (default-safe — null when LR-only):
        enrichment_level: pred.enrichment_level || 'lr',
        narrative_text: pred.narrative_text || null,
        method_confidence: pred.method_confidence != null ? Number(pred.method_confidence) : null,
        predicted_method: pred.predicted_method || null,
        predicted_round: pred.predicted_round != null ? Number(pred.predicted_round) : null,
        insights: parsePredictionInsights(pred.insights)
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

function parsePredictionInsights(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
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
