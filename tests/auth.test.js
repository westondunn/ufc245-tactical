#!/usr/bin/env node
/**
 * tests/auth.test.js — Profile system + auth migration tests.
 *
 * Run: node tests/auth.test.js
 *
 * Covers:
 *   - Profile schema v1 migration (fresh DB, pre-migration DB, idempotency)
 *   - users_legacy preservation of pre-existing guest rows
 *   - New auth tables (users, sessions, accounts, verifications, auth_login_attempts)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const initSqlJs = require('sql.js');

let passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}
function assertEq(actual, expected, name) {
  assert(actual === expected, `${name} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

/**
 * Build a sql.js DB seeded with the OLD users schema (pre-migration prod state).
 * Only creates tables relevant to the migration; SCHEMA's IF NOT EXISTS will fill
 * in the rest when the real db module loads it.
 */
async function makePreMigrationDb() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      avatar_key TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      is_guest INTEGER DEFAULT 1
    );
  `);
  db.run("INSERT INTO users (id, display_name, avatar_key, created_at, updated_at, is_guest) VALUES ('guest-aaa', 'Alice', 'a3', '2026-01-01', '2026-01-01', 1)");
  db.run("INSERT INTO users (id, display_name, avatar_key, created_at, updated_at, is_guest) VALUES ('guest-bbb', 'Bob', 'a7', '2026-01-02', '2026-01-02', 1)");
  return db;
}

async function run() {
  console.log('\n━━━ Profile/Auth Migration Tests ━━━\n');

  // ── Case 1: pre-migration DB (existing prod scenario) ──
  console.log('Case 1 — pre-migration DB → migrate:');
  const preDb = await makePreMigrationDb();

  // Save it so we can load it through the real db/sqlite.js init() path
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ufc-auth-mig-'));
  const dbPath = path.join(tmpDir, 'pre.db');
  fs.writeFileSync(dbPath, Buffer.from(preDb.export()));

  // Clear require cache so the singleton db module re-initializes cleanly
  Object.keys(require.cache).forEach(k => { if (k.includes('/db/') || k.endsWith('\\db\\index.js') || k.endsWith('/db/index.js')) delete require.cache[k]; });
  const dbModule = require('../db');
  // Bypass seedFromFile by pointing at a non-existent seed; data is irrelevant for migration assertions
  await dbModule.init({ dbPath, seedPath: '/nonexistent' });

  assert(dbModule.oneRow("SELECT name FROM sqlite_master WHERE type='table' AND name='users_legacy'"),
    'old users renamed to users_legacy');
  assert(dbModule.oneRow("SELECT name FROM sqlite_master WHERE type='table' AND name='users'"),
    'new users table exists');
  assert(dbModule.oneRow("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'"),
    'sessions table exists');
  assert(dbModule.oneRow("SELECT name FROM sqlite_master WHERE type='table' AND name='accounts'"),
    'accounts table exists');
  assert(dbModule.oneRow("SELECT name FROM sqlite_master WHERE type='table' AND name='verifications'"),
    'verifications table exists');
  assert(dbModule.oneRow("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_login_attempts'"),
    'auth_login_attempts table exists');

  const flag = dbModule.oneRow("SELECT value FROM db_meta WHERE key='users_migrated_v1'");
  assertEq(flag && flag.value, '1', 'users_migrated_v1 flag set');

  // Legacy data preserved
  const legacyAlice = dbModule.oneRow("SELECT * FROM users_legacy WHERE id='guest-aaa'");
  assertEq(legacyAlice && legacyAlice.display_name, 'Alice', 'legacy guest Alice preserved');
  assertEq(legacyAlice && legacyAlice.avatar_key, 'a3', 'legacy guest avatar preserved');
  assertEq(legacyAlice && legacyAlice.is_guest, 1, 'legacy guest is_guest preserved');
  assertEq(legacyAlice && legacyAlice.claimed_by, null, 'legacy claimed_by initially null');
  assertEq(legacyAlice && legacyAlice.claimed_at, null, 'legacy claimed_at initially null');

  // New users table starts empty
  const newUsersCount = dbModule.oneRow('SELECT COUNT(*) AS c FROM users');
  assertEq(newUsersCount.c, 0, 'new users table starts empty');

  // New users schema has all the expected columns
  const userCols = dbModule.allRows('PRAGMA table_info(users)').map(r => r.name);
  for (const required of ['id', 'email', 'email_verified', 'name', 'image', 'display_name', 'avatar_key', 'is_guest', 'created_at', 'updated_at']) {
    assert(userCols.includes(required), `new users has column: ${required}`);
  }

  // ── Case 2: idempotency (re-run migration on already-migrated DB) ──
  console.log('\nCase 2 — re-run migration on already-migrated DB:');
  Object.keys(require.cache).forEach(k => { if (k.includes('/db/') || k.endsWith('\\db\\index.js') || k.endsWith('/db/index.js')) delete require.cache[k]; });
  const dbModule2 = require('../db');
  await dbModule2.init({ dbPath, seedPath: '/nonexistent' });

  // users_legacy still has Alice (unchanged)
  const reAlice = dbModule2.oneRow("SELECT * FROM users_legacy WHERE id='guest-aaa'");
  assertEq(reAlice && reAlice.display_name, 'Alice', 'idempotent: legacy data unchanged');
  // No double-rename: there should still be exactly one users_legacy table
  const legacyTables = dbModule2.allRows("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'users%'");
  const names = legacyTables.map(r => r.name).sort();
  assertEq(JSON.stringify(names), JSON.stringify(['users', 'users_legacy']), 'idempotent: only users + users_legacy exist');

  // ── Case 3: fresh DB (no old users table at all) ──
  console.log('\nCase 3 — fresh DB:');
  Object.keys(require.cache).forEach(k => { if (k.includes('/db/') || k.endsWith('\\db\\index.js') || k.endsWith('/db/index.js')) delete require.cache[k]; });
  const dbModule3 = require('../db');
  await dbModule3.init({ seedPath: '/nonexistent' });

  assert(dbModule3.oneRow("SELECT name FROM sqlite_master WHERE type='table' AND name='users'"),
    'fresh DB: users table exists');
  assert(!dbModule3.oneRow("SELECT name FROM sqlite_master WHERE type='table' AND name='users_legacy'"),
    'fresh DB: no users_legacy (nothing to migrate)');
  const freshFlag = dbModule3.oneRow("SELECT value FROM db_meta WHERE key='users_migrated_v1'");
  assertEq(freshFlag && freshFlag.value, '1', 'fresh DB: migration flag set');

  // ── Case 4: createUser still works against new schema ──
  console.log('\nCase 4 — db.createUser() against new schema:');
  const u = await dbModule3.createUser({ display_name: 'TestUser', avatar_key: 'a5' });
  assert(u.id, 'createUser returns id');
  assertEq(u.display_name, 'TestUser', 'createUser display_name');
  assertEq(u.is_guest, 1, 'createUser sets is_guest=1');

  const fetched = await dbModule3.getUser(u.id);
  assertEq(fetched.display_name, 'TestUser', 'getUser round-trip');
  assertEq(fetched.email, null, 'new user has null email by default');
  assertEq(fetched.email_verified, 0, 'new user email_verified=0 by default');

  await dbModule3.deleteUser(u.id);
  assertEq(await dbModule3.getUser(u.id), null, 'deleteUser works');

  // ── Case 5: buildWhere unit tests (adapter helper) ──
  console.log('\nCase 5 — adapter buildWhere helper:');
  const { buildWhere, buildUfcAdapter, KEY_MAP_IN, KEY_MAP_OUT } = require('../auth/adapter');
  // ufcAdapter is now async (better-auth/adapters is ESM-only — see auth/adapter.js).
  const ufcAdapter = await buildUfcAdapter();

  let r = buildWhere([]);
  assertEq(r.sql, '', 'empty where → no SQL');
  assertEq(r.params.length, 0, 'empty where → no params');

  r = buildWhere([{ field: 'email', operator: 'eq', value: 'a@b.com' }]);
  assertEq(r.sql, ' WHERE email = ?', 'eq operator');
  assertEq(r.params[0], 'a@b.com', 'eq param');

  r = buildWhere([{ field: 'email', operator: 'eq', value: null }]);
  assertEq(r.sql, ' WHERE email IS NULL', 'eq null → IS NULL');
  assertEq(r.params.length, 0, 'eq null produces no param');

  r = buildWhere([{ field: 'email_verified', operator: 'ne', value: 0 }]);
  assertEq(r.sql, ' WHERE email_verified != ?', 'ne operator');

  r = buildWhere([{ field: 'created_at', operator: 'gte', value: '2026-01-01' }]);
  assertEq(r.sql, ' WHERE created_at >= ?', 'gte operator');

  r = buildWhere([{ field: 'id', operator: 'in', value: ['a', 'b', 'c'] }]);
  assertEq(r.sql, ' WHERE id IN (?,?,?)', 'in operator');
  assertEq(r.params.length, 3, 'in operator params');

  r = buildWhere([{ field: 'id', operator: 'in', value: [] }]);
  assertEq(r.sql, ' WHERE 1 = 0', 'in [] → false predicate');

  r = buildWhere([{ field: 'id', operator: 'not_in', value: [] }]);
  assertEq(r.sql, ' WHERE 1 = 1', 'not_in [] → true predicate');

  r = buildWhere([{ field: 'name', operator: 'contains', value: 'foo' }]);
  assertEq(r.sql, ' WHERE name LIKE ?', 'contains operator');
  assertEq(r.params[0], '%foo%', 'contains wraps with %');

  r = buildWhere([{ field: 'name', operator: 'starts_with', value: 'foo' }]);
  assertEq(r.params[0], 'foo%', 'starts_with appends %');

  r = buildWhere([{ field: 'name', operator: 'ends_with', value: 'bar' }]);
  assertEq(r.params[0], '%bar', 'ends_with prepends %');

  r = buildWhere([
    { field: 'a', operator: 'eq', value: 1 },
    { field: 'b', operator: 'eq', value: 2, connector: 'AND' },
  ]);
  assertEq(r.sql, ' WHERE a = ? AND b = ?', 'multiple AND clauses');
  assertEq(r.params.length, 2, 'multi-clause param count');

  r = buildWhere([
    { field: 'a', operator: 'eq', value: 1 },
    { field: 'b', operator: 'eq', value: 2, connector: 'OR' },
  ]);
  assertEq(r.sql, ' WHERE a = ? OR b = ?', 'OR connector');

  // Key maps are reciprocal
  for (const [camel, snake] of Object.entries(KEY_MAP_IN)) {
    assertEq(KEY_MAP_OUT[snake], camel, `KEY_MAP reciprocal: ${camel} ↔ ${snake}`);
  }

  // ── Case 6: adapter end-to-end CRUD against the new schema ──
  console.log('\nCase 6 — adapter round-trip CRUD:');
  // ufcAdapter is an AdapterFactory: call it with a minimal BetterAuthOptions.
  // Better-auth's defaults provide the user/session/account/verification schema.
  const adapter = ufcAdapter({});

  // Better-auth generates ids — let it. We capture and use what comes back.
  const created = await adapter.create({
    model: 'user',
    data: {
      email: 'adapter-test@example.com',
      emailVerified: false,
      name: 'Adapter Test',
      createdAt: new Date('2026-04-25T00:00:00Z'),
      updatedAt: new Date('2026-04-25T00:00:00Z'),
    },
  });
  assertTruthy(created, 'adapter create returns a row');
  assertTruthy(created.id, 'created row has generated id');
  assertEq(created.email, 'adapter-test@example.com', 'created email round-trip');
  assertEq(created.emailVerified, false, 'created emailVerified round-trip (false)');
  const userId = created.id;

  const found = await adapter.findOne({
    model: 'user',
    where: [{ field: 'email', operator: 'eq', value: 'adapter-test@example.com' }],
  });
  assertTruthy(found, 'findOne by email returns row');
  assertEq(found.id, userId, 'findOne id matches generated id');

  const updated = await adapter.update({
    model: 'user',
    where: [{ field: 'id', operator: 'eq', value: userId }],
    update: { name: 'Updated Name' },
  });
  assertTruthy(updated, 'update returns row');
  assertEq(updated.name, 'Updated Name', 'update applied');

  const cnt = await adapter.count({
    model: 'user',
    where: [{ field: 'email', operator: 'contains', value: 'adapter-test' }],
  });
  assertEq(cnt, 1, 'count returns 1');

  await adapter.delete({
    model: 'user',
    where: [{ field: 'id', operator: 'eq', value: userId }],
  });
  const afterDel = await adapter.findOne({
    model: 'user',
    where: [{ field: 'id', operator: 'eq', value: userId }],
  });
  assertEq(afterDel, null, 'delete removes row');

  // updateMany returns count
  for (let i = 0; i < 3; i++) {
    await adapter.create({
      model: 'user',
      data: {
        email: `bulk${i}@x.com`,
        emailVerified: false,
        name: `Bulk ${i}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }
  const updMany = await adapter.updateMany({
    model: 'user',
    where: [{ field: 'email', operator: 'contains', value: '@x.com' }],
    update: { name: 'Renamed' },
  });
  assertEq(updMany, 3, 'updateMany returns 3');

  const delMany = await adapter.deleteMany({
    model: 'user',
    where: [{ field: 'email', operator: 'contains', value: '@x.com' }],
  });
  assertEq(delMany, 3, 'deleteMany returns 3');

  // ── Case 7: claim flow — legacy guest pick is rewritten to new account ──
  console.log('\nCase 7 — claim flow:');

  // Fresh seeded DB (so we have real fights to pick on), then manually inject a
  // legacy guest row to simulate a pre-migration user. The migration flag is
  // already set, so users_legacy stays as-is.
  Object.keys(require.cache).forEach(k => { if (k.includes('/db/') || k.endsWith('\\db\\index.js') || k.endsWith('/db/index.js')) delete require.cache[k]; });
  const claimDb = require('../db');
  await claimDb.init();

  // Make sure users_legacy exists (would only exist on a migrated DB).
  // For a fresh DB, the migration flag is set but users_legacy was never created.
  claimDb.run(`
    CREATE TABLE IF NOT EXISTS users_legacy (
      id TEXT PRIMARY KEY, display_name TEXT NOT NULL, avatar_key TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, is_guest INTEGER DEFAULT 1,
      claimed_by TEXT, claimed_at TEXT
    )
  `);
  claimDb.run(
    `INSERT INTO users_legacy (id, display_name, avatar_key, created_at, updated_at, is_guest)
     VALUES (?,?,?,?,?,1)`,
    ['guest-claimer', 'Pre-migration Claimer', 'a4', '2026-01-01', '2026-01-01']
  );

  // Insert a pick under the legacy guest id on a real seeded fight.
  const ufc245 = claimDb.oneRow("SELECT id FROM events WHERE number = 245");
  const fight = claimDb.oneRow('SELECT id, red_fighter_id, event_id FROM fights WHERE event_id = ? LIMIT 1', [ufc245.id]);
  claimDb.run('UPDATE fights SET winner_id = NULL WHERE id = ?', [fight.id]);
  claimDb.run(
    `INSERT INTO user_picks (user_id, event_id, fight_id, picked_fighter_id, confidence, submitted_at, updated_at)
     VALUES (?,?,?,?,?,?,?)`,
    ['guest-claimer', fight.event_id, fight.id, fight.red_fighter_id, 70, '2026-01-02', '2026-01-02']
  );

  // Create a "new" account that will claim the legacy id.
  const newAcct = await claimDb.createUser({ display_name: null, avatar_key: null });
  // (createUser sets is_guest=1 — patch to 0 to simulate a real account.)
  claimDb.run('UPDATE users SET is_guest = 0 WHERE id = ?', [newAcct.id]);

  const before = claimDb.oneRow('SELECT COUNT(*) AS c FROM user_picks WHERE user_id = ?', ['guest-claimer']);
  assertEq(before.c, 1, 'pre-claim: 1 pick under guest id');

  const result = claimDb.claimGuestProfile('guest-claimer', newAcct.id);
  assertEq(result.claimed_picks, 1, 'claim returns claimed_picks=1');
  assertEq(result.display_name, 'Pre-migration Claimer', 'claim returns legacy display_name');
  assertEq(result.avatar_key, 'a4', 'claim returns legacy avatar_key');

  const afterGuest = claimDb.oneRow('SELECT COUNT(*) AS c FROM user_picks WHERE user_id = ?', ['guest-claimer']);
  assertEq(afterGuest.c, 0, 'post-claim: 0 picks under guest id');
  const afterNew = claimDb.oneRow('SELECT COUNT(*) AS c FROM user_picks WHERE user_id = ?', [newAcct.id]);
  assertEq(afterNew.c, 1, 'post-claim: 1 pick under new account id');

  const claimedRow = claimDb.oneRow('SELECT * FROM users_legacy WHERE id = ?', ['guest-claimer']);
  assertEq(claimedRow.claimed_by, newAcct.id, 'users_legacy.claimed_by set to new account');
  assertTruthy(claimedRow.claimed_at, 'users_legacy.claimed_at set');

  // Display name backfilled (new account had null display_name)
  const newAcctAfter = claimDb.oneRow('SELECT display_name, avatar_key FROM users WHERE id = ?', [newAcct.id]);
  assertEq(newAcctAfter.display_name, 'Pre-migration Claimer', 'display_name backfilled from legacy');
  assertEq(newAcctAfter.avatar_key, 'a4', 'avatar_key backfilled from legacy');

  // Re-claim attempt → already_claimed
  let reclaimErr = null;
  try { claimDb.claimGuestProfile('guest-claimer', newAcct.id); }
  catch (e) { reclaimErr = e; }
  assertTruthy(reclaimErr, 're-claim throws');
  assertEq(reclaimErr && reclaimErr.code, 'already_claimed', 're-claim error code = already_claimed');

  // Unknown guest id → guest_not_found
  let notFoundErr = null;
  try { claimDb.claimGuestProfile('nonexistent-id', newAcct.id); }
  catch (e) { notFoundErr = e; }
  assertEq(notFoundErr && notFoundErr.code, 'guest_not_found', 'unknown guest id → guest_not_found');

  // ── Case 7b: claim falls back to `users` table when `users_legacy` is empty ──
  // Repro for the prod bug — guest-count returns "13 picks" because the id
  // exists in `users` (not users_legacy), but claim was throwing
  // guest_not_found because claimGuestProfile only checked users_legacy.
  console.log('\nCase 7b — claim with id in users (not users_legacy):');
  const stranded = await claimDb.createUser({ display_name: 'Stranded Guest', avatar_key: 'b9' });
  // Migrate the stranded id into users_legacy is NOT done — we want it to live only in `users`.
  // Add picks under the stranded id.
  const fight2 = claimDb.oneRow('SELECT id, blue_fighter_id, event_id FROM fights WHERE event_id = ? AND id != ? LIMIT 1', [ufc245.id, fight.id]);
  claimDb.run('UPDATE fights SET winner_id = NULL WHERE id = ?', [fight2.id]);
  claimDb.run(
    `INSERT INTO user_picks (user_id, event_id, fight_id, picked_fighter_id, confidence, submitted_at, updated_at)
     VALUES (?,?,?,?,?,?,?)`,
    [stranded.id, fight2.event_id, fight2.id, fight2.blue_fighter_id, 60, '2026-01-03', '2026-01-03']
  );
  const claimer = await claimDb.createUser({ display_name: null, avatar_key: null });
  claimDb.run('UPDATE users SET is_guest = 0 WHERE id = ?', [claimer.id]);

  const result2 = claimDb.claimGuestProfile(stranded.id, claimer.id);
  assertEq(result2.claimed_picks, 1, 'fallback claim: 1 pick migrated');
  assertEq(result2.claim_source, 'users', 'fallback claim: source=users');
  assertEq(result2.display_name, 'Stranded Guest', 'fallback claim: display_name from users');

  const claimerAfter = claimDb.oneRow('SELECT display_name FROM users WHERE id = ?', [claimer.id]);
  assertEq(claimerAfter.display_name, 'Stranded Guest', 'fallback claim: display_name backfilled');

  // ── Case 7c: orphan-picks fallback (no row anywhere, picks exist) ──
  console.log('\nCase 7c — claim with no row but orphan picks:');
  const fight3 = claimDb.oneRow('SELECT id, red_fighter_id, event_id FROM fights WHERE event_id = ? AND id NOT IN (?, ?) LIMIT 1', [ufc245.id, fight.id, fight2.id]);
  claimDb.run('UPDATE fights SET winner_id = NULL WHERE id = ?', [fight3.id]);
  claimDb.run(
    `INSERT INTO user_picks (user_id, event_id, fight_id, picked_fighter_id, confidence, submitted_at, updated_at)
     VALUES (?,?,?,?,?,?,?)`,
    ['orphan-no-row', fight3.event_id, fight3.id, fight3.red_fighter_id, 50, '2026-01-04', '2026-01-04']
  );
  const claimer2 = await claimDb.createUser({ display_name: null, avatar_key: null });
  claimDb.run('UPDATE users SET is_guest = 0 WHERE id = ?', [claimer2.id]);

  const result3 = claimDb.claimGuestProfile('orphan-no-row', claimer2.id);
  assertEq(result3.claimed_picks, 1, 'orphan claim: 1 pick migrated');
  assertEq(result3.claim_source, 'orphan-picks', 'orphan claim: source=orphan-picks');

  // Truly nonexistent id (no row, no picks) still errors
  let stillNotFoundErr = null;
  try { claimDb.claimGuestProfile('truly-nonexistent', claimer2.id); }
  catch (e) { stillNotFoundErr = e; }
  assertEq(stillNotFoundErr && stillNotFoundErr.code, 'guest_not_found', 'no row + no picks → guest_not_found');

  // ── Cleanup ──
  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log(`\n━━━ Results: ${passed} passed, ${failed} failed ━━━\n`);
  process.exit(failed > 0 ? 1 : 0);
}

function assertTruthy(v, name) { assert(!!v, `${name} (got ${JSON.stringify(v)})`); }

run().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
