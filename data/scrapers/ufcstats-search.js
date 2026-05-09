/**
 * data/scrapers/ufcstats-search.js
 *
 * Searches ufcstats.com for a fighter by name. Returns an array of
 * { hash, name } candidates parsed from the results table.
 *
 * The ufcstats search endpoint only matches a single token, so we query by
 * the last whitespace-delimited token (surname) and return all candidates for
 * the caller to filter by full normalized-name match.
 */
const cheerio = require('cheerio');
const { fetchPage } = require('./http');

const BASE = 'http://ufcstats.com';

function clean(text) { return (text || '').replace(/\s+/g, ' ').trim(); }

async function searchFighter(name, opts = {}) {
  const tokens = String(name || '').split(/\s+/).filter(Boolean);
  const lastToken = tokens[tokens.length - 1] || name;
  const url = `${BASE}/statistics/fighters/search?query=${encodeURIComponent(lastToken)}`;
  const html = await fetchPage(url, opts);
  const $ = cheerio.load(html);
  const candidates = [];

  $('tr.b-statistics__table-row').each((_, row) => {
    const cells = $(row).find('td.b-statistics__table-col');
    if (cells.length < 2) return;
    const linkEl = $(row).find('a.b-link').first();
    const href = linkEl.attr('href') || '';
    const m = href.match(/fighter-details\/([a-f0-9]{16})/);
    if (!m) return;
    const hash = m[1];
    const first = clean($(cells[0]).text());
    const last = clean($(cells[1]).text());
    const fullName = `${first} ${last}`.replace(/\s+/g, ' ').trim();
    if (fullName.length < 2) return;
    candidates.push({ hash, name: fullName });
  });

  const seen = new Set();
  return {
    candidates: candidates.filter(c => seen.has(c.hash) ? false : (seen.add(c.hash), true)),
    source_url: url,
  };
}

module.exports = { searchFighter };
