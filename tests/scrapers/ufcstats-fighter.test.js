const fs = require('fs');
const path = require('path');
const { parseFighterPage } = require('../../data/scrapers/ufcstats-fighter');

async function run() {
  const results = { passed: 0, failed: 0 };
  const assert = (cond, name) => {
    if (cond) { results.passed++; console.log(`  ✓ ${name}`); }
    else { results.failed++; console.error(`  ✗ ${name}`); }
  };

  console.log('\nScraper: ufcstats-fighter:');

  const html = fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', 'scrapers', 'ufcstats-fighter-sample.html'),
    'utf8'
  );
  const result = parseFighterPage(html, 'f4c49976c75c5ab2');

  assert(result, 'parseFighterPage returns truthy');
  assert(typeof result.name === 'string' && result.name.length > 0, 'name extracted');
  assert(result.ufcstats_hash === 'f4c49976c75c5ab2', 'hash preserved');
  assert('slpm' in result, 'slpm present (may be null)');
  assert('reach_cm' in result, 'reach_cm present (may be null)');
  assert('stance' in result, 'stance present (may be null)');

  return results;
}

module.exports = { run };
