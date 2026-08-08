/**
 * scripts/_db.js
 *
 * Shared prod-DB pool for one-shot scripts. Honors PGSSLMODE=disable (and
 * sslmode=disable in the URL) like db/postgres.js pgConfig(), so scripts can
 * also run against non-SSL targets (local rehearsal, railway-internal host).
 * rejectUnauthorized stays false for Railway's self-signed public-proxy certs.
 */
'use strict';
const { Pool } = require('pg');

function getPool() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('ERROR: DATABASE_URL required.');
    process.exit(2);
  }
  const sslMode = String(process.env.PGSSLMODE || '').toLowerCase();
  const disableSSL = sslMode === 'disable' || /sslmode=disable/i.test(url);
  return new Pool({
    connectionString: url,
    ssl: disableSSL ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
}

module.exports = { getPool };
