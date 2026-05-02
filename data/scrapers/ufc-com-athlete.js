/**
 * data/scrapers/ufc-com-athlete.js
 *
 * Parses an https://www.ufc.com/athlete/<slug> page for headshot + body images.
 * v1 only extracts images; richer fighter metadata stays with ufcstats parsers.
 */
const cheerio = require('cheerio');
const { fetchPage } = require('./http');

const BASE = 'https://www.ufc.com';
const UA = 'Mozilla/5.0 (compatible; UFC-Tactical-Dashboard/2.0)';

function clean(t) { return (t || '').replace(/\s+/g, ' ').trim(); }

function absolute(url) {
  if (!url) return null;
  try { return new URL(url, BASE).href; }
  catch { return null; }
}

function parseAthletePage(html, slug) {
  const $ = cheerio.load(html);

  const name = clean($('h1.hero-profile__name').first().text())
            || clean($('meta[property="og:title"]').attr('content') || '');

  // hero-profile__image is the upper-body / fight-card image on athlete pages.
  const body = $('img.hero-profile__image').attr('src') || null;

  // Headshot: try a same-page event-results-athlete-headshot whose alt matches
  // the athlete name; fall back to og:image which is the standard headshot.
  let headshot = null;
  $('img.image-style-event-results-athlete-headshot').each((_, el) => {
    if (headshot) return;
    const alt = clean($(el).attr('alt') || '');
    if (name && alt && alt.toLowerCase() === name.toLowerCase()) {
      headshot = $(el).attr('src') || null;
    }
  });
  if (!headshot) {
    const og = clean($('meta[property="og:image"]').attr('content') || '');
    if (og) headshot = og;
  }

  return {
    ufc_slug: slug || null,
    name: name || null,
    headshot_url: absolute(headshot),
    body_url: absolute(body),
  };
}

async function fetchAthlete(slug, opts = {}) {
  const url = `${BASE}/athlete/${slug}`;
  const html = await fetchPage(url, { ua: UA, ...opts });
  return { ...parseAthletePage(html, slug), source_url: url };
}

module.exports = { parseAthletePage, fetchAthlete };
