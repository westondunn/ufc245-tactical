const fs = require('fs');
const path = require('path');
const { parseFightPage } = require('../../data/scrapers/ufcstats-fight');

async function run() {
  const results = { passed: 0, failed: 0 };
  const assert = (cond, name) => {
    if (cond) { results.passed++; console.log(`  ✓ ${name}`); }
    else { results.failed++; console.error(`  ✗ ${name}`); }
  };

  console.log('\nScraper: ufcstats-fight:');

  const html = fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', 'scrapers', 'ufcstats-fight-sample.html'),
    'utf8'
  );
  const result = parseFightPage(html, 'f524e42c36028de0');

  assert(result, 'returns truthy');
  assert(Array.isArray(result.fighters) && result.fighters.length === 2, 'two fighters extracted');
  assert(typeof result.method_full === 'string' && result.method_full.length > 0, 'method_full extracted');
  assert(Array.isArray(result.fight_stats) && result.fight_stats.length === 2, '2 fight_stats rows');
  assert(typeof result.fight_stats[0].sig_str_landed === 'number', 'sig_str_landed numeric');
  assert(result.fight_stats[0].control_time_sec >= 0, 'control_time_sec non-negative');
  assert(Array.isArray(result.round_stats), 'round_stats array present');
  assert(result.round_stats.length === 0 || result.round_stats.length % 2 === 0,
    'round_stats are paired per round');
  if (result.round_stats.length > 0) {
    assert(result.round_stats[0].round === 1, 'first round_stat is round 1');
    assert('head_landed' in result.round_stats[0], 'sig-strike breakdown merged');
  }

  return results;
}

module.exports = { run };
