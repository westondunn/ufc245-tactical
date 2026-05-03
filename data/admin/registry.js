/**
 * data/admin/registry.js
 *
 * Whitelist for local admin manual data edits. This is the only place where
 * table and column names are accepted for dynamic SQL.
 */
const db = require('../../db');
const { logAction } = require('./actions');

function pRun(sql, params) {
  try { return Promise.resolve(db.run(sql, params)); }
  catch (e) { return Promise.reject(e); }
}
function pOneRow(sql, params) {
  try { return Promise.resolve(db.oneRow(sql, params)); }
  catch (e) { return Promise.reject(e); }
}

const FIELD_TYPES = {
  text: v => {
    if (v === '' || v === null || v === undefined) return null;
    return String(v).trim();
  },
  int: v => {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    if (!Number.isInteger(n)) throw new Error('expected integer');
    return n;
  },
  number: v => {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error('expected number');
    return n;
  },
  bool: v => {
    if (v === '' || v === null || v === undefined) return null;
    if (v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true') return 1;
    if (v === false || v === 0 || v === '0' || String(v).toLowerCase() === 'false') return 0;
    throw new Error('expected boolean');
  },
  date: v => {
    if (v === '' || v === null || v === undefined) return null;
    const s = String(v).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('expected YYYY-MM-DD');
    return s;
  },
  datetime: v => {
    if (v === '' || v === null || v === undefined) return null;
    const s = String(v).trim();
    if (Number.isNaN(Date.parse(s))) throw new Error('expected ISO datetime');
    return s;
  },
  time: v => {
    if (v === '' || v === null || v === undefined) return null;
    const s = String(v).trim();
    if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) throw new Error('expected fight clock time');
    return s;
  },
  url: v => {
    if (v === '' || v === null || v === undefined) return null;
    const s = String(v).trim();
    let u;
    try { u = new URL(s); } catch { throw new Error('expected URL'); }
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error('expected http/https URL');
    return s;
  },
  outcomeStatus: v => {
    if (v === '' || v === null || v === undefined) return null;
    const s = String(v).trim();
    if (!['pending', 'official', 'void', 'complete', 'completed', 'final', 'finalized'].includes(s)) {
      throw new Error('invalid outcome status');
    }
    return s;
  },
};

function fields(defs) {
  return Object.fromEntries(defs.map(([name, type]) => [name, { type }]));
}

const intStats = [
  'sig_str_landed', 'sig_str_attempted', 'total_str_landed', 'total_str_attempted',
  'takedowns_landed', 'takedowns_attempted', 'knockdowns', 'sub_attempts',
  'control_time_sec', 'head_landed', 'body_landed', 'leg_landed',
  'distance_landed', 'clinch_landed', 'ground_landed',
];

const roundStats = [
  'kd', 'sig_str_landed', 'sig_str_attempted', 'total_str_landed',
  'total_str_attempted', 'td_landed', 'td_attempted', 'sub_att', 'reversal',
  'ctrl_sec', 'head_landed', 'head_attempted', 'body_landed', 'body_attempted',
  'leg_landed', 'leg_attempted', 'distance_landed', 'distance_attempted',
  'clinch_landed', 'clinch_attempted', 'ground_landed', 'ground_attempted',
];

const TABLES = {
  fighters: {
    keyColumns: ['id'],
    fields: fields([
      ['name', 'text'], ['nickname', 'text'], ['height_cm', 'int'], ['reach_cm', 'int'],
      ['stance', 'text'], ['weight_class', 'text'], ['nationality', 'text'], ['dob', 'date'],
      ['slpm', 'number'], ['str_acc', 'number'], ['sapm', 'number'], ['str_def', 'number'],
      ['td_avg', 'number'], ['td_acc', 'number'], ['td_def', 'number'], ['sub_avg', 'number'],
      ['headshot_url', 'url'], ['body_url', 'url'], ['ufcstats_hash', 'text'],
    ]),
  },
  events: {
    keyColumns: ['id'],
    fields: fields([
      ['number', 'int'], ['name', 'text'], ['date', 'date'], ['venue', 'text'],
      ['city', 'text'], ['country', 'text'], ['start_time', 'datetime'],
      ['end_time', 'datetime'], ['timezone', 'text'], ['ufcstats_hash', 'text'],
    ]),
  },
  fights: {
    keyColumns: ['id'],
    fields: fields([
      ['event_id', 'int'], ['event_number', 'int'], ['red_fighter_id', 'int'],
      ['blue_fighter_id', 'int'], ['red_name', 'text'], ['blue_name', 'text'],
      ['weight_class', 'text'], ['is_title', 'bool'], ['is_main', 'bool'],
      ['card_position', 'int'], ['method', 'text'], ['method_detail', 'text'],
      ['round', 'int'], ['time', 'time'], ['winner_id', 'int'], ['referee', 'text'],
      ['has_stats', 'bool'], ['ufcstats_hash', 'text'],
    ]),
  },
  official_fight_outcomes: {
    keyColumns: ['fight_id'],
    fields: fields([
      ['event_id', 'int'], ['status', 'outcomeStatus'], ['winner_id', 'int'],
      ['method', 'text'], ['method_detail', 'text'], ['round', 'int'],
      ['time', 'time'], ['source', 'text'], ['source_url', 'url'],
      ['captured_at', 'datetime'], ['raw_json', 'text'],
    ]),
  },
  fight_stats: {
    keyColumns: ['fight_id', 'fighter_id'],
    fields: fields(intStats.map(name => [name, 'int'])),
  },
  round_stats: {
    keyColumns: ['fight_id', 'fighter_id', 'round'],
    fields: fields(roundStats.map(name => [name, 'int'])),
  },
};

function getTableDef(table) {
  const def = TABLES[table];
  if (!def) throw Object.assign(new Error('table is not editable'), { status: 400, code: 'invalid_table' });
  return def;
}

function parseKey(table, id) {
  const def = getTableDef(table);
  const parts = String(id || '').split(':');
  if (parts.length !== def.keyColumns.length) {
    throw Object.assign(new Error(`expected key ${def.keyColumns.join(':')}`), { status: 400, code: 'invalid_key' });
  }
  const values = parts.map(v => {
    const n = Number(v);
    if (!Number.isInteger(n)) throw Object.assign(new Error('key values must be integers'), { status: 400, code: 'invalid_key' });
    return n;
  });
  return { columns: def.keyColumns, values };
}

function whereForKey(parsed) {
  return {
    sql: parsed.columns.map(c => `${c} = ?`).join(' AND '),
    params: parsed.values,
  };
}

function validateField(table, column, value) {
  const def = getTableDef(table);
  const field = def.fields[column];
  if (!field) throw Object.assign(new Error('column is not editable'), { status: 400, code: 'invalid_column' });
  return FIELD_TYPES[field.type](value);
}

function editableTables() {
  return Object.fromEntries(Object.entries(TABLES).map(([name, def]) => [
    name,
    { keyColumns: def.keyColumns, fields: Object.keys(def.fields) },
  ]));
}

async function getEntity(table, id) {
  const parsed = parseKey(table, id);
  const where = whereForKey(parsed);
  return pOneRow(`SELECT * FROM ${table} WHERE ${where.sql}`, where.params);
}

async function updateEntity({ table, id, changes, reason, actor = 'local-admin', ip = null }) {
  if (!reason || !String(reason).trim()) {
    throw Object.assign(new Error('reason required'), { status: 400, code: 'reason_required' });
  }
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    throw Object.assign(new Error('changes object required'), { status: 400, code: 'invalid_changes' });
  }
  const parsed = parseKey(table, id);
  const before = await getEntity(table, id);
  if (!before) throw Object.assign(new Error('entity not found'), { status: 404, code: 'not_found' });

  const entries = Object.entries(changes).filter(([, v]) => v !== undefined);
  if (!entries.length) throw Object.assign(new Error('no changes supplied'), { status: 400, code: 'no_changes' });

  const afterPatch = {};
  for (const [column, value] of entries) afterPatch[column] = validateField(table, column, value);

  const setSql = Object.keys(afterPatch).map(c => `${c} = ?`).join(', ');
  const where = whereForKey(parsed);
  await pRun(`UPDATE ${table} SET ${setSql} WHERE ${where.sql}`, [
    ...Object.values(afterPatch),
    ...where.params,
  ]);
  const after = await getEntity(table, id);
  await logAction({
    action: 'manual_edit',
    targetTable: table,
    targetKey: id,
    before,
    after,
    status: 'ok',
    reason: String(reason).trim(),
    metadata: { changed_columns: Object.keys(afterPatch) },
    actor,
    ip,
  });
  return { before, after, changed: Object.keys(afterPatch) };
}

module.exports = {
  TABLES,
  editableTables,
  getEntity,
  updateEntity,
  validateField,
  parseKey,
};
