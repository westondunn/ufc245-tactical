/**
 * data/scrapers/ufcstats-event.js
 *
 * Parses an ufcstats.com event-details page into normalized header + fights[].
 */
const cheerio = require('cheerio');
const { fetchPage } = require('./http');

const BASE = 'http://ufcstats.com';

function clean(t) { return (t || '').replace(/\s+/g, ' ').trim(); }
function hashFromUrl(url) {
  const m = (url || '').match(/([a-f0-9]{16})/);
  return m ? m[1] : null;
}

function parseEventPage(html, eventHash) {
  const $ = cheerio.load(html);
  const name = clean($('h2.b-content__title span.b-content__title-highlight').first().text())
            || clean($('h2.b-content__title span').first().text());

  let dateText = null;
  let locationText = null;
  $('li.b-list__box-list-item').each((_, li) => {
    const t = clean($(li).text());
    if (/^Date:/i.test(t)) dateText = clean(t.replace(/^Date:/i, ''));
    else if (/^Location:/i.test(t)) locationText = clean(t.replace(/^Location:/i, ''));
  });

  const fights = [];
  $('tr.b-fight-details__table-row').each((i, row) => {
    const $row = $(row);
    const link = $row.attr('data-link') || $row.find('a').attr('href') || '';
    const fightHash = hashFromUrl(link);
    if (!fightHash) return;

    const fighterAnchors = $row.find('td').eq(1).find('a.b-link');
    const redName = clean(fighterAnchors.eq(0).text());
    const blueName = clean(fighterAnchors.eq(1).text());
    const redHash = hashFromUrl(fighterAnchors.eq(0).attr('href'));
    const blueHash = hashFromUrl(fighterAnchors.eq(1).attr('href'));

    const cells = $row.find('td').toArray().map(td => clean($(td).text()));
    const weightClass = cells[6] || '';
    const method = cells[7] || '';
    const round = parseInt(cells[8], 10) || null;
    const time = cells[9] || null;

    // Winner: ufcstats marks the winner-side via .b-fight-details__person-status_style_green.
    // Approximation by row order: the winning fighter's <i> sits in the first td.
    const winFlags = $row.find('td').eq(0).find('i.b-fight-details__person-status_style_green');
    const winnerSide = winFlags.length > 0 ? 'red' : null;

    fights.push({
      fight_hash: fightHash,
      red_name: redName, red_hash: redHash,
      blue_name: blueName, blue_hash: blueHash,
      weight_class: weightClass,
      method, round, time,
      winner_side: winnerSide,
    });
  });

  return {
    name,
    date: dateText || null,
    location: locationText || null,
    ufcstats_hash: eventHash || null,
    fights,
  };
}

async function fetchEvent(hash, opts = {}) {
  const url = `${BASE}/event-details/${hash}`;
  const html = await fetchPage(url, opts);
  return { ...parseEventPage(html, hash), source_url: url };
}

module.exports = { parseEventPage, fetchEvent };
