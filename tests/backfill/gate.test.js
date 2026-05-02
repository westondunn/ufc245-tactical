const { decide } = require('../../data/backfill/gate');

async function run() {
  const results = { passed: 0, failed: 0 };
  const assert = (cond, name) => {
    if (cond) { results.passed++; console.log(`  ✓ ${name}`); }
    else { results.failed++; console.error(`  ✗ ${name}`); }
  };

  console.log('\nBackfill Gate:');

  let r = decide({ safety: 'cosmetic', current: null, proposed: 'http://x.com/h.jpg', sources: [{name: 'a', value: 'http://x.com/h.jpg'}], verifyPassed: true });
  assert(r.decision === 'auto', 'cosmetic+verify=auto');

  r = decide({ safety: 'cosmetic', current: null, proposed: 'http://x.com/h.jpg', sources: [{name: 'a', value: 'http://x.com/h.jpg'}], verifyPassed: false });
  assert(r.decision === 'review' && /verify/i.test(r.reason), 'cosmetic+!verify=review');

  r = decide({ safety: 'safe', current: null, proposed: 180, sources: [{name: 'ufcstats', value: 180}], verifyPassed: true });
  assert(r.decision === 'auto', 'safe+null+proposed=auto');

  r = decide({ safety: 'safe', current: 178, proposed: 180, sources: [{name: 'ufcstats', value: 180}], verifyPassed: true });
  assert(r.decision === 'review' && /overwrite/i.test(r.reason), 'safe overwrite=review');

  r = decide({ safety: 'risky', current: null, proposed: 4.2, sources: [{name: 'ufcstats', value: 4.2}], verifyPassed: true });
  assert(r.decision === 'review' && /single-source/i.test(r.reason), 'risky single source=review');

  r = decide({ safety: 'risky', current: null, proposed: 4.2, sources: [{name: 'ufcstats', value: 4.2}, {name: 'other', value: 4.2}], verifyPassed: true });
  assert(r.decision === 'auto', 'risky two-source-agree=auto');

  r = decide({ safety: 'risky', current: null, proposed: 4.2, sources: [{name: 'ufcstats', value: 4.2}, {name: 'other', value: 5.0}], verifyPassed: true });
  assert(r.decision === 'review' && /disagree/i.test(r.reason), 'risky disagree=review');

  r = decide({ safety: 'safe', current: null, proposed: 180, sources: [], verifyPassed: true, ambiguousIdentity: true });
  assert(r.decision === 'reject' && /ambiguous/i.test(r.reason), 'ambiguous=reject');

  r = decide({ safety: 'reconcile', current: null, proposed: { winner_id: 42 }, sources: [{name: 'ufcstats', value: { winner_id: 42 }}], verifyPassed: true });
  assert(r.decision === 'review' && /reconcile/i.test(r.reason), 'reconcile defers to outcomes pipeline');

  return results;
}

module.exports = { run };
