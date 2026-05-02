/**
 * data/scrapers/ufcstats-fighter.js
 *
 * Parses an ufcstats.com fighter-details page into a normalized fighter row.
 * Pure function: takes html string, returns object. Tested against fixtures.
 *
 * Plus async fetchFighter(hash) for live scrapes.
 */
const cheerio = require('cheerio');
const { fetchPage } = require('./http');

const BASE = 'http://ufcstats.com';

function clean(text) { return (text || '').replace(/\s+/g, ' ').trim(); }

function parseHeight(text) {
  const m = clean(text).match(/(\d+)'\s*(\d+)"/);
  return m ? Math.round(+m[1] * 30.48 + +m[2] * 2.54) : null;
}

function parseReach(text) {
  const m = clean(text).match(/([\d.]+)"/);
  return m ? Math.round(+m[1] * 2.54) : null;
}

function parseWeight(text) {
  const m = clean(text).match(/([\d.]+)\s*lbs/);
  return m ? Math.round(+m[1]) : null;
}

function parseFloat0(text) {
  const m = clean(text).match(/[-+]?[\d.]+/);
  return m ? parseFloat(m[0]) : null;
}

function parsePctFraction(text) {
  // ufcstats prints percentages like "47%". Return as 0..1 float, or null.
  const m = clean(text).match(/(\d+)%/);
  return m ? +m[1] / 100 : null;
}

function pairValue($, label) {
  // ufcstats fighter pages put labels in <i class="b-list__box-item-title"> and values follow.
  let value = null;
  $('li.b-list__box-list-item').each((i, li) => {
    const t = clean($(li).find('i.b-list__box-item-title').text());
    if (t && t.toLowerCase().startsWith(label.toLowerCase())) {
      const text = clean($(li).text());
      value = clean(text.replace(/^.+?:/, ''));
    }
  });
  return value;
}

function parseFighterPage(html, hash) {
  const $ = cheerio.load(html);

  const name = clean($('span.b-content__title-highlight').first().text());
  const nickname = clean($('p.b-content__Nickname').first().text()) || null;

  const heightTxt   = pairValue($, 'Height');
  const weightTxt   = pairValue($, 'Weight');
  const reachTxt    = pairValue($, 'Reach');
  const stanceTxt   = pairValue($, 'STANCE');
  const dobTxt      = pairValue($, 'DOB');

  const slpmTxt    = pairValue($, 'SLpM');
  const strAccTxt  = pairValue($, 'Str. Acc.');
  const sapmTxt    = pairValue($, 'SApM');
  const strDefTxt  = pairValue($, 'Str. Def');
  const tdAvgTxt   = pairValue($, 'TD Avg.');
  const tdAccTxt   = pairValue($, 'TD Acc.');
  const tdDefTxt   = pairValue($, 'TD Def.');
  const subAvgTxt  = pairValue($, 'Sub. Avg.');

  return {
    ufcstats_hash: hash || null,
    name,
    nickname,
    height_cm: parseHeight(heightTxt),
    weight_lb: parseWeight(weightTxt),
    reach_cm: parseReach(reachTxt),
    stance: stanceTxt ? clean(stanceTxt) : null,
    dob: dobTxt && dobTxt !== '--' ? dobTxt : null,
    slpm: parseFloat0(slpmTxt),
    str_acc: parsePctFraction(strAccTxt),
    sapm: parseFloat0(sapmTxt),
    str_def: parsePctFraction(strDefTxt),
    td_avg: parseFloat0(tdAvgTxt),
    td_acc: parsePctFraction(tdAccTxt),
    td_def: parsePctFraction(tdDefTxt),
    sub_avg: parseFloat0(subAvgTxt),
  };
}

async function fetchFighter(hash, opts = {}) {
  const url = `${BASE}/fighter-details/${hash}`;
  const html = await fetchPage(url, opts);
  return { ...parseFighterPage(html, hash), source_url: url };
}

module.exports = { parseFighterPage, fetchFighter };
