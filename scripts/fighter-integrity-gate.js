#!/usr/bin/env node
/**
 * Fighter Integrity Gate
 *
 * Checks the production DB for the next imminent UFC event (within 36 hours)
 * and verifies that all fighters on the card have:
 *   - ufcstats_hash set
 *   - core stats fields populated
 *
 * Exits 0 if no imminent event or all fighters pass.
 * Exits 1 if integrity violations are found or if a fatal error occurs.
 *
 * GitHub issues are managed via `gh` CLI. Run this in an environment where
 * DATABASE_URL and GH_TOKEN (or gh auth) are configured.
 *
 * Usage:
 *   node scripts/fighter-integrity-gate.js
 *   DATABASE_URL=postgres://... node scripts/fighter-integrity-gate.js
 */

'use strict';

const { execSync } = require('child_process');
const { Pool } = require('pg');

const REPO = process.env.GH_REPO || 'westondunn/ufc245-tactical';
const HORIZON_HOURS = 36;

const CORE_FIELDS = ['height_cm', 'reach_cm', 'stance', 'slpm', 'str_acc', 'str_def', 'td_avg', 'td_def'];
const ALL_FIELDS  = ['height_cm', 'reach_cm', 'stance', 'slpm', 'str_acc', 'sapm', 'str_def', 'td_avg', 'td_acc', 'td_def', 'sub_avg'];

// ── helpers ──────────────────────────────────────────────────────────────────

function gh(args) {
  return execSync(`gh ${args} --repo ${REPO}`, { encoding: 'utf8' }).trim();
}

function ghJson(args) {
  return JSON.parse(gh(args));
}

function hoursUntil(dateStr) {
  return ((new Date(dateStr) - Date.now()) / 3_600_000).toFixed(1);
}

function formatGaps(fighters) {
  const lines = [
    '| Fighter | hash_missing | core_missing fields | completely_empty |',
    '|---------|:---:|---|:---:|',
  ];
  for (const f of fighters) {
    const missingCore = CORE_FIELDS.filter(k => f[k] == null);
    const missingAll  = ALL_FIELDS.filter(k => f[k] == null);
    lines.push(
      `| ${f.name} ` +
      `| ${f.ufcstats_hash == null ? '✗' : '✓'} ` +
      `| ${missingCore.length ? missingCore.join(', ') : '—'} ` +
      `| ${missingAll.length >= 6 ? `✗ (${missingAll.length}/11)` : '—'} |`
    );
  }
  return lines.join('\n');
}

// ── database ─────────────────────────────────────────────────────────────────

async function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('[integrity-gate] FATAL: DATABASE_URL is not set. Cannot run production integrity check.');
    process.exit(1);
  }
  const sslMode = String(process.env.PGSSLMODE || '').toLowerCase();
  const ssl = sslMode === 'disable' ? false : { rejectUnauthorized: false };
  const pool = new Pool({ connectionString: url, ssl });
  await pool.query('SELECT 1');
  return pool;
}

async function getImminentEvent(pool) {
  const cutoff = new Date(Date.now() + HORIZON_HOURS * 3_600_000).toISOString();
  const now    = new Date().toISOString();
  const { rows } = await pool.query(
    `SELECT id, name, date
       FROM events
      WHERE date >= $1
        AND date <= $2
      ORDER BY date ASC
      LIMIT 1`,
    [now, cutoff]
  );
  return rows[0] || null;
}

async function getCardFighters(pool, eventId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT f.id, f.name,
            f.ufcstats_hash,
            f.height_cm, f.reach_cm, f.stance,
            f.slpm, f.str_acc, f.sapm, f.str_def,
            f.td_avg, f.td_acc, f.td_def, f.sub_avg
       FROM fights fi
       JOIN fighters f ON f.id IN (fi.red_fighter_id, fi.blue_fighter_id)
      WHERE fi.event_id = $1
      ORDER BY f.name`,
    [eventId]
  );
  return rows;
}

// ── github ────────────────────────────────────────────────────────────────────

function findExistingIssue(eventName, eventDate) {
  const title = buildTitle(eventName, eventDate);
  try {
    const issues = ghJson(`issue list --state open --json number,title --limit 50`);
    return issues.find(i => i.title === title) || null;
  } catch {
    return null;
  }
}

function buildTitle(eventName, eventDate) {
  const d = eventDate.slice(0, 10);
  return `⚠️ Fighter-integrity gate: ${eventName} on ${d} has incomplete profiles`;
}

function buildBody(event, fighters, severity) {
  const hours = hoursUntil(event.date);
  const table = formatGaps(fighters.filter(f => {
    const missingCore = CORE_FIELDS.some(k => f[k] == null);
    return f.ufcstats_hash == null || missingCore;
  }));

  return `## Fighter Integrity Violation

**Event:** ${event.name} (id: ${event.id})
**Date:** ${event.date.slice(0, 10)}
**Hours until start:** ${hours}h
**Severity:** \`${severity}\`

## Gaps Detected

${table}

## Recommended Remediation

Run the backfill script against this card:

\`\`\`bash
node scripts/link-and-backfill-card-fighters.js --event-id ${event.id}
\`\`\`

## Notes

- \`hash_missing\`: \`ufcstats_hash\` is NULL — fighter is not linked to UFCStats
- \`core_missing\`: ≥1 of the 8 core prediction fields (height, reach, stance, slpm, str_acc, str_def, td_avg, td_def) is NULL
- \`completely_empty\`: ≥6 of 11 stats fields are NULL — severity escalates to \`block\`

This issue was filed automatically by the fighter-integrity-gate routine.`;
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  let pool;
  try {
    pool = await connect();
  } catch (err) {
    console.error('[integrity-gate] DB connection failed:', err.message);
    process.exit(1);
  }

  let event;
  try {
    event = await getImminentEvent(pool);
  } catch (err) {
    console.error('[integrity-gate] Event query failed:', err.message);
    await pool.end();
    process.exit(1);
  }

  if (!event) {
    console.log('[integrity-gate] status=no_imminent_event — nothing to check');
    await pool.end();
    process.exit(0);
  }

  console.log(`[integrity-gate] Checking event: ${event.name} on ${event.date.slice(0, 10)}`);

  let fighters;
  try {
    fighters = await getCardFighters(pool, event.id);
  } catch (err) {
    console.error('[integrity-gate] Fighter query failed:', err.message);
    await pool.end();
    process.exit(1);
  }

  await pool.end();

  if (fighters.length === 0) {
    console.log('[integrity-gate] No fighters found on card — card not yet entered in DB');
    process.exit(0);
  }

  const violations = fighters.filter(f => {
    const hash_missing = f.ufcstats_hash == null;
    const core_missing = CORE_FIELDS.some(k => f[k] == null);
    return hash_missing || core_missing;
  });

  if (violations.length === 0) {
    console.log(`[integrity-gate] status=all_clear — all ${fighters.length} fighters on ${event.name} are complete`);
    process.exit(0);
  }

  const completelyEmpty = violations.filter(f => {
    return ALL_FIELDS.filter(k => f[k] == null).length >= 6;
  });
  const severity = completelyEmpty.length > 0 ? 'block' : 'warn';

  console.log(`[integrity-gate] ${violations.length}/${fighters.length} fighters have gaps — severity=${severity}`);

  const title  = buildTitle(event.name, event.date);
  const body   = buildBody(event, fighters, severity);
  const labels = severity === 'block' ? ['data-integrity', 'urgent'] : ['data-integrity'];

  const existing = findExistingIssue(event.name, event.date);

  if (existing) {
    // Check if gaps have closed (all fighters now passing)
    const stillOpen = violations.length > 0;
    if (!stillOpen) {
      gh(`issue comment ${existing.number} --body "✅ All gaps resolved as of ${new Date().toISOString().slice(0, 10)}. Closing."`);
      gh(`issue close ${existing.number} --reason resolved`);
      console.log(`[integrity-gate] Closed issue #${existing.number} — all gaps resolved`);
    } else {
      const snapshot = `### Gap snapshot — ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC\n\n` + body;
      gh(`issue comment ${existing.number} --body ${JSON.stringify(snapshot)}`);
      console.log(`[integrity-gate] Updated issue #${existing.number} with latest snapshot`);
    }
  } else {
    const labelFlags = labels.map(l => `--label ${JSON.stringify(l)}`).join(' ');
    gh(`issue create --title ${JSON.stringify(title)} --body ${JSON.stringify(body)} ${labelFlags}`);
    console.log(`[integrity-gate] Created new issue: ${title}`);
  }

  process.exit(violations.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('[integrity-gate] Unhandled error:', err);
  process.exit(1);
});
