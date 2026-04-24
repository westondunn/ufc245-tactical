/**
 * lib/scoring.js — Deterministic scoring for user picks.
 *
 * Pure function, no DB dependency. Called from the reconcile path after
 * a fight has an actual winner. Idempotent: same inputs → same points.
 *
 * Formula (max 35 points per pick, never negative):
 *   winner_points    = correct ? round(10 * confidence / 50) : 0    // 0..20
 *   method_bonus     = (correct && method matches) ? 5 : 0
 *   round_bonus      = (correct && round matches)  ? 5 : 0
 *   model_upset_bonus = (correct && user disagreed with model) ? 5 : 0
 */

function scorePick({
  correct,                 // 0 | 1 | null (null = not reconciled)
  confidence,              // 0..100
  methodCorrect,           // 0 | 1 | null (null = user didn't pick method)
  roundCorrect,            // 0 | 1 | null (null = user didn't pick round)
  userAgreedWithModel      // 0 | 1 | null (null = no model snapshot)
} = {}) {
  const zero = {
    points: 0,
    winnerPoints: 0,
    methodBonus: 0,
    roundBonus: 0,
    modelUpsetBonus: 0
  };
  if (correct !== 1) return zero;

  const conf = Math.max(0, Math.min(100, Number(confidence) || 0));
  const winnerPoints = Math.round(10 * (conf / 50));       // conf=0 → 0, conf=50 → 10, conf=100 → 20
  const methodBonus = methodCorrect === 1 ? 5 : 0;
  const roundBonus = roundCorrect === 1 ? 5 : 0;
  const modelUpsetBonus = userAgreedWithModel === 0 ? 5 : 0;

  return {
    points: winnerPoints + methodBonus + roundBonus + modelUpsetBonus,
    winnerPoints,
    methodBonus,
    roundBonus,
    modelUpsetBonus
  };
}

/**
 * Normalize a fights.method value to the pick-method enum.
 * Accepts UFCStats values like "KO/TKO", "Submission", "Decision - Unanimous",
 * "Decision - Split", "DQ", "No Contest". Returns one of:
 *   'KO/TKO' | 'SUB' | 'DEC' | null
 */
function normalizeMethod(raw) {
  if (!raw) return null;
  const s = String(raw).toUpperCase();
  if (s.includes('KO') || s.includes('TKO')) return 'KO/TKO';
  if (s.includes('SUB')) return 'SUB';
  if (s.includes('DEC')) return 'DEC';
  return null;
}

module.exports = { scorePick, normalizeMethod };
