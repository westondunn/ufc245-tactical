const fs = require('fs');
const path = require('path');
const { parseEventPage } = require('../../data/scrapers/ufcstats-event');

async function run() {
  const results = { passed: 0, failed: 0 };
  const assert = (cond, name) => {
    if (cond) { results.passed++; console.log(`  ✓ ${name}`); }
    else { results.failed++; console.error(`  ✗ ${name}`); }
  };

  console.log('\nScraper: ufcstats-event:');

  const html = fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', 'scrapers', 'ufcstats-event-sample.html'),
    'utf8'
  );
  const result = parseEventPage(html, '872b018076f831b0');

  assert(result, 'returns truthy');
  assert(typeof result.name === 'string' && result.name.length > 0, 'event name extracted');
  assert(typeof result.date === 'string' || result.date === null, 'date present (or null)');
  assert(Array.isArray(result.fights), 'fights array');
  assert(result.fights.length >= 1, 'at least one fight parsed');
  const f = result.fights[0];
  assert(typeof f.fight_hash === 'string' && f.fight_hash.length === 16, 'fight_hash present (16 hex)');
  assert(typeof f.red_name === 'string' && f.red_name.length > 0, 'red_name present');
  assert(typeof f.blue_name === 'string' && f.blue_name.length > 0, 'blue_name present');
  assert(typeof f.weight_class === 'string', 'weight_class present');

  return results;
}

module.exports = { run };
