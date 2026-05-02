/**
 * data/backfill/gate.js — pure decision function.
 *
 * Inputs:
 *   safety: 'cosmetic' | 'safe' | 'risky' | 'reconcile'
 *   current: existing DB value (any) or null
 *   proposed: proposed new value (any), required
 *   sources: [{ name, value }, ...] — what each source returned
 *   verifyPassed: bool — write-time verify rule outcome
 *   ambiguousIdentity: bool — true if fighter/row identity match was ambiguous
 *
 * Output:
 *   { decision: 'auto' | 'review' | 'reject', reason }
 */

const TOLERANCE = {
  numeric: 0.001,
};

function valuesAgree(a, b) {
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) <= TOLERANCE.numeric;
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

function decide({ safety, current, proposed, sources = [], verifyPassed, ambiguousIdentity = false }) {
  if (ambiguousIdentity) {
    return { decision: 'reject', reason: 'ambiguous identity match' };
  }

  if (proposed === null || proposed === undefined) {
    return { decision: 'reject', reason: 'no proposed value' };
  }

  if (safety === 'reconcile') {
    return { decision: 'review', reason: 'reconcile path: defer to outcomes pipeline' };
  }

  if (!verifyPassed) {
    return { decision: 'review', reason: 'verify failed; demoted from auto' };
  }

  if (safety === 'cosmetic') {
    return { decision: 'auto', reason: 'cosmetic write with verify pass' };
  }

  if (safety === 'safe') {
    if (current === null || current === undefined) {
      return { decision: 'auto', reason: 'safe column gap fill' };
    }
    if (valuesAgree(current, proposed)) {
      return { decision: 'auto', reason: 'safe column proposal matches current; no-op' };
    }
    return { decision: 'review', reason: 'overwrite of existing value' };
  }

  if (safety === 'risky') {
    if (sources.length < 2) {
      return { decision: 'review', reason: 'single-source for risky column' };
    }
    const [a, b] = sources.slice(0, 2);
    if (valuesAgree(a.value, b.value)) {
      return { decision: 'auto', reason: 'risky column with two sources agreeing' };
    }
    return { decision: 'review', reason: 'source disagreement on risky column' };
  }

  return { decision: 'review', reason: 'unknown safety class' };
}

module.exports = { decide, valuesAgree };
