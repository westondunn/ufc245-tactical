/**
 * auth/adapter.js — Custom better-auth adapter wrapping db/index.js.
 *
 * Why custom: better-auth's built-in adapters target Postgres (via Kysely+pg),
 * SQLite (via better-sqlite3), Drizzle, Prisma, and MongoDB. This codebase uses
 * sql.js (WASM SQLite) in dev and raw `pg` in prod, behind the db/index.js
 * router. Wrapping that router lets us reuse the same dual-mode story instead
 * of forcing better-sqlite3 on dev (native build, schema split-brain).
 *
 * The factory handles input/output transforms, id generation, and the camelCase
 * ↔ snake_case mapping declared below. We just translate the cleaned where
 * clauses into parameterized SQL.
 */
// better-auth/adapters is ESM-only. We can't require() it on Node <22.12,
// so the adapter is built inside an async factory that does dynamic import().
// auth/index.js's buildAuth() awaits buildUfcAdapter() before constructing
// the better-auth instance.
const db = require('../db');

// Better-auth uses camelCase field names. Our DB columns are snake_case.
const KEY_MAP_IN = {
  emailVerified: 'email_verified',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  expiresAt: 'expires_at',
  ipAddress: 'ip_address',
  userAgent: 'user_agent',
  userId: 'user_id',
  providerId: 'provider_id',
  accountId: 'account_id',
  accessToken: 'access_token',
  refreshToken: 'refresh_token',
  idToken: 'id_token',
  accessTokenExpiresAt: 'access_token_expires_at',
  refreshTokenExpiresAt: 'refresh_token_expires_at',
};
const KEY_MAP_OUT = Object.fromEntries(
  Object.entries(KEY_MAP_IN).map(([k, v]) => [v, k])
);

/**
 * Translate a CleanedWhere[] into a parameterized SQL fragment.
 * Returns { sql: " WHERE ..." (or ""), params: [...] }.
 */
function buildWhere(where) {
  if (!where || !where.length) return { sql: '', params: [] };
  const parts = [];
  const params = [];
  for (let i = 0; i < where.length; i++) {
    const w = where[i];
    const conn = i === 0 ? '' : (w.connector || 'AND');
    const field = w.field;
    let clause;
    switch (w.operator) {
      case 'ne':          clause = `${field} != ?`;     params.push(w.value); break;
      case 'lt':          clause = `${field} < ?`;      params.push(w.value); break;
      case 'lte':         clause = `${field} <= ?`;     params.push(w.value); break;
      case 'gt':          clause = `${field} > ?`;      params.push(w.value); break;
      case 'gte':         clause = `${field} >= ?`;     params.push(w.value); break;
      case 'in': {
        const arr = Array.isArray(w.value) ? w.value : [w.value];
        if (!arr.length) { clause = '1 = 0'; break; }
        clause = `${field} IN (${arr.map(() => '?').join(',')})`;
        params.push(...arr);
        break;
      }
      case 'not_in': {
        const arr = Array.isArray(w.value) ? w.value : [w.value];
        if (!arr.length) { clause = '1 = 1'; break; }
        clause = `${field} NOT IN (${arr.map(() => '?').join(',')})`;
        params.push(...arr);
        break;
      }
      case 'contains':    clause = `${field} LIKE ?`;   params.push(`%${w.value}%`); break;
      case 'starts_with': clause = `${field} LIKE ?`;   params.push(`${w.value}%`);  break;
      case 'ends_with':   clause = `${field} LIKE ?`;   params.push(`%${w.value}`);  break;
      case 'eq':
      default:            clause = w.value === null ? `${field} IS NULL` : `${field} = ?`;
                          if (w.value !== null) params.push(w.value); break;
    }
    parts.push(i === 0 ? clause : `${conn} ${clause}`);
  }
  return { sql: ' WHERE ' + parts.join(' '), params };
}

async function buildUfcAdapter() {
  const adaptersMod = await import('better-auth/adapters');
  const createAdapterFactory = adaptersMod.createAdapterFactory;
  if (typeof createAdapterFactory !== 'function') {
    throw new TypeError(
      `better-auth/adapters did not export 'createAdapterFactory' as a function. ` +
      `Got: ${typeof createAdapterFactory}.`
    );
  }
  return createAdapterFactory({
  config: {
    adapterId: 'ufc-tactical-sql',
    adapterName: 'UFC Tactical SQL Adapter',
    usePlural: true,
    supportsBooleans: false,
    supportsDates: false,
    supportsJSON: false,
    supportsNumericIds: false,
    mapKeysTransformInput: KEY_MAP_IN,
    mapKeysTransformOutput: KEY_MAP_OUT,
  },
  adapter: ({ getModelName, getFieldName }) => {
    // The factory's mapKeysTransformInput covers `data` and `where` field
    // names, but `sortBy.field` and `select` come through unmapped. getFieldName
    // only translates fields that have an explicit `fieldName` override in the
    // schema — which we don't declare — so we fall through to KEY_MAP_IN to
    // handle the global camelCase ↔ snake_case mapping.
    const fname = (model, field) => {
      const mapped = getFieldName({ model, field });
      return mapped === field && KEY_MAP_IN[field] ? KEY_MAP_IN[field] : mapped;
    };
    const selectCols = (model, select) =>
      select && select.length ? select.map((f) => fname(model, f)).join(',') : '*';

    return {
    async create({ model, data }) {
      const table = getModelName(model);
      const cols = Object.keys(data);
      const values = cols.map((k) => data[k]);
      const placeholders = cols.map(() => '?').join(',');
      await db.run(
        `INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`,
        values
      );
      return db.oneRow(`SELECT * FROM ${table} WHERE id = ?`, [data.id]);
    },

    async findOne({ model, where, select }) {
      const table = getModelName(model);
      const { sql, params } = buildWhere(where);
      return db.oneRow(`SELECT ${selectCols(model, select)} FROM ${table}${sql} LIMIT 1`, params);
    },

    async findMany({ model, where, limit, sortBy, offset, select }) {
      const table = getModelName(model);
      const { sql, params } = buildWhere(where);
      let q = `SELECT ${selectCols(model, select)} FROM ${table}${sql}`;
      if (sortBy) {
        const dir = String(sortBy.direction || 'asc').toUpperCase();
        q += ` ORDER BY ${fname(model, sortBy.field)} ${dir === 'DESC' ? 'DESC' : 'ASC'}`;
      }
      if (limit != null) q += ` LIMIT ${parseInt(limit, 10)}`;
      if (offset != null) q += ` OFFSET ${parseInt(offset, 10)}`;
      return db.allRows(q, params);
    },

    async update({ model, where, update }) {
      const table = getModelName(model);
      const { sql: whereSql, params: whereParams } = buildWhere(where);
      const updateCols = Object.keys(update);
      if (!updateCols.length) {
        return db.oneRow(`SELECT * FROM ${table}${whereSql} LIMIT 1`, whereParams);
      }
      const setSql = updateCols.map((c) => `${c} = ?`).join(', ');
      const setParams = updateCols.map((c) => update[c]);
      await db.run(
        `UPDATE ${table} SET ${setSql}${whereSql}`,
        [...setParams, ...whereParams]
      );
      return db.oneRow(`SELECT * FROM ${table}${whereSql} LIMIT 1`, whereParams);
    },

    async updateMany({ model, where, update }) {
      const table = getModelName(model);
      const { sql: whereSql, params: whereParams } = buildWhere(where);
      const updateCols = Object.keys(update);
      if (!updateCols.length) return 0;
      const before = await db.oneRow(
        `SELECT COUNT(*) AS c FROM ${table}${whereSql}`, whereParams
      );
      const setSql = updateCols.map((c) => `${c} = ?`).join(', ');
      const setParams = updateCols.map((c) => update[c]);
      await db.run(
        `UPDATE ${table} SET ${setSql}${whereSql}`,
        [...setParams, ...whereParams]
      );
      return before ? Number(before.c) : 0;
    },

    async delete({ model, where }) {
      const table = getModelName(model);
      const { sql, params } = buildWhere(where);
      await db.run(`DELETE FROM ${table}${sql}`, params);
    },

    async deleteMany({ model, where }) {
      const table = getModelName(model);
      const { sql, params } = buildWhere(where);
      const before = await db.oneRow(
        `SELECT COUNT(*) AS c FROM ${table}${sql}`, params
      );
      await db.run(`DELETE FROM ${table}${sql}`, params);
      return before ? Number(before.c) : 0;
    },

    async count({ model, where }) {
      const table = getModelName(model);
      const { sql, params } = buildWhere(where);
      const row = await db.oneRow(`SELECT COUNT(*) AS c FROM ${table}${sql}`, params);
      return row ? Number(row.c) : 0;
    },
    };
  },
  });
}

module.exports = { buildUfcAdapter, buildWhere, KEY_MAP_IN, KEY_MAP_OUT };
