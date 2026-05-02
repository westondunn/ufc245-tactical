/**
 * data/backfill/verify.js
 *
 * Each rule is async (some make HTTP HEAD requests). Returns { passed, reason? }.
 *
 * Rules:
 *   - 'numeric-tolerance:N' — proposed agrees with current within ±N; if current null, bounds-sanity
 *   - 'url-200'             — proposed URL responds 200 to HEAD
 *   - 'completeness'        — fightStats array has 2 rows; round count plausible
 *   - 'cross-check:official_fight_outcomes' — caller must supply officialOutcome; mismatch → fail
 *   - 'second-source-or-review' — pass; gate handles single-source case as 'review'
 *   - default               — pass (covers 'identity' and unknown rules)
 */
const { headOk } = require('../scrapers/http');

function parseVerifyRule(rule) {
  const [kind, argRaw] = (rule || '').split(':');
  const arg = argRaw == null ? null : (isNaN(+argRaw) ? argRaw : +argRaw);
  return { kind, arg };
}

async function runVerify(rule, ctx = {}) {
  const { kind, arg } = parseVerifyRule(rule);

  switch (kind) {
    case 'numeric-tolerance': {
      const tol = typeof arg === 'number' ? arg : 1;
      if (ctx.current === null || ctx.current === undefined) {
        const [lo, hi] = ctx.bounds || [-Infinity, Infinity];
        return ctx.proposed >= lo && ctx.proposed <= hi
          ? { passed: true }
          : { passed: false, reason: 'out of bounds' };
      }
      return Math.abs(ctx.proposed - ctx.current) <= tol
        ? { passed: true }
        : { passed: false, reason: `delta exceeds ±${tol}` };
    }
    case 'url-200': {
      const ok = await headOk(ctx.proposed);
      return ok ? { passed: true } : { passed: false, reason: 'HEAD non-200' };
    }
    case 'completeness': {
      const rows = Array.isArray(ctx.fightStats) ? ctx.fightStats.length : 0;
      const round = ctx.round || 0;
      if (rows !== 2) return { passed: false, reason: 'expected 2 fight_stats rows' };
      if (round < 1 || round > 5) return { passed: false, reason: 'implausible round count' };
      return { passed: true };
    }
    case 'cross-check': {
      if (!ctx.officialOutcome) return { passed: true, reason: 'no outcome to check' };
      const matches = ctx.officialOutcome.winner_id === (ctx.proposed && ctx.proposed.winner_id);
      return matches ? { passed: true } : { passed: false, reason: 'mismatch with official_fight_outcomes' };
    }
    case 'second-source-or-review':
      return { passed: true };
    default:
      return { passed: true, reason: `no rule ${kind}` };
  }
}

module.exports = { runVerify, parseVerifyRule };
