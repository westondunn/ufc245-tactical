const fs = require('fs');
const path = require('path');
const { parseAthletePage } = require('../../data/scrapers/ufc-com-athlete');

async function run() {
  const results = { passed: 0, failed: 0 };
  const assert = (cond, name) => {
    if (cond) { results.passed++; console.log(`  ✓ ${name}`); }
    else { results.failed++; console.error(`  ✗ ${name}`); }
  };

  console.log('\nScraper: ufc-com-athlete:');

  const html = fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', 'scrapers', 'ufc-com-athlete-sample.html'),
    'utf8'
  );
  const result = parseAthletePage(html, 'conor-mcgregor');

  assert(result, 'returns truthy');
  assert(typeof result.name === 'string' && result.name.length > 0, 'name extracted');
  assert(result.headshot_url === null || /^https?:\/\//.test(result.headshot_url),
    'headshot_url is URL or null');
  assert(result.body_url === null || /^https?:\/\//.test(result.body_url),
    'body_url is URL or null');
  assert(result.ufc_slug === 'conor-mcgregor', 'ufc_slug preserved');

  return results;
}

module.exports = { run };
