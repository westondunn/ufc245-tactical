/**
 * lib/version.js — Single source of truth for app version
 * Read by server.js (API header + healthz), injected into frontend via /api/version
 */
const fs = require('fs');
const path = require('path');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

const VERSION = pkg.version;
const BUILD_TIME = new Date().toISOString();
const BUILD_SHA = process.env.RAILWAY_GIT_COMMIT_SHA
  || process.env.GITHUB_SHA
  || process.env.GIT_SHA
  || 'local';

module.exports = {
  version: VERSION,
  buildTime: BUILD_TIME,
  buildSha: BUILD_SHA.slice(0, 7),
  full: `${VERSION}+${BUILD_SHA.slice(0, 7)}`,
  semver: VERSION.split('.').map(Number),
  userAgent: `ufc-tactical/${VERSION}`
};
