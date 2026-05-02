const { runVerify, parseVerifyRule } = require('../../data/backfill/verify');

async function run() {
  const results = { passed: 0, failed: 0 };
  const assert = (cond, name) => {
    if (cond) { results.passed++; console.log(`  ✓ ${name}`); }
    else { results.failed++; console.error(`  ✗ ${name}`); }
  };

  console.log('\nBackfill Verify:');

  let r = await runVerify('numeric-tolerance:1', { current: 180, proposed: 181 });
  assert(r.passed, 'numeric-tolerance:1 within → pass');

  r = await runVerify('numeric-tolerance:1', { current: 180, proposed: 200 });
  assert(!r.passed, 'numeric-tolerance:1 exceeds → fail');

  r = await runVerify('numeric-tolerance:1', { current: null, proposed: 175, bounds: [140, 230] });
  assert(r.passed, 'numeric-tolerance bounds-sanity in range → pass');
  r = await runVerify('numeric-tolerance:1', { current: null, proposed: 999, bounds: [140, 230] });
  assert(!r.passed, 'numeric-tolerance bounds-sanity out of range → fail');

  r = await runVerify('completeness', { fightStats: [{a: 1}, {a: 2}], round: 3 });
  assert(r.passed, 'completeness with 2 rows + plausible round → pass');
  r = await runVerify('completeness', { fightStats: [{a: 1}], round: 3 });
  assert(!r.passed, 'completeness with 1 row → fail');

  const p = parseVerifyRule('numeric-tolerance:5');
  assert(p.kind === 'numeric-tolerance' && p.arg === 5, 'parseVerifyRule splits name and arg');

  r = await runVerify('identity', { current: null, proposed: 'Southpaw' });
  assert(r.passed, 'identity rule defaults to pass');

  return results;
}

module.exports = { run };
