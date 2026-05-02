#!/usr/bin/env node
/**
 * scripts/build-world-map-svg.js
 *
 * One-time build step: read a small public-domain world GeoJSON and emit
 * a single SVG with one <path> per country, projected via equirectangular.
 * The output lives at public/img/world-map.svg and is served as a static
 * asset; the Fun Facts page fetches it, then JS shades paths by country
 * name from /api/funfacts.
 *
 * Source: https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson
 *   — derived from Natural Earth (public domain). Cached to ./tmp-world.geojson;
 *   delete that file to force a re-download.
 *
 * Run: node scripts/build-world-map-svg.js
 */
const fs = require('fs');
const path = require('path');

const SRC_URL = 'https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson';
const CACHE = path.join(__dirname, '..', 'tmp-world.geojson');
const OUT = path.join(__dirname, '..', 'public', 'img', 'world-map.svg');

// Output viewBox. Equirectangular: x = (lng+180)/360*W, y = (90-lat)/180*H.
const W = 1000, H = 500;

function project(lng, lat) {
  const x = (lng + 180) / 360 * W;
  const y = (90 - lat) / 180 * H;
  return [x, y];
}

// Convert one polygon ring (array of [lng,lat]) to a single SVG sub-path.
// Round to 1 decimal — keeps the file small without visibly degrading shape.
function ringToPath(ring) {
  if (!ring.length) return '';
  let out = '';
  for (let i = 0; i < ring.length; i++) {
    const [x, y] = project(ring[i][0], ring[i][1]);
    out += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
  }
  return out + 'Z';
}

function geomToPath(geom) {
  if (!geom) return '';
  if (geom.type === 'Polygon') {
    return geom.coordinates.map(ringToPath).join('');
  }
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates.map(poly => poly.map(ringToPath).join('')).join('');
  }
  return '';
}

function escAttr(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

async function fetchIfMissing() {
  if (fs.existsSync(CACHE)) {
    console.log('[cache] using ' + CACHE);
    return;
  }
  console.log('[fetch] ' + SRC_URL);
  const res = await fetch(SRC_URL);
  if (!res.ok) throw new Error('HTTP ' + res.status + ' fetching geojson');
  const text = await res.text();
  fs.writeFileSync(CACHE, text);
  console.log('[fetch] wrote ' + CACHE + ' (' + text.length + ' bytes)');
}

async function main() {
  await fetchIfMissing();
  const geo = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  if (!geo || geo.type !== 'FeatureCollection') throw new Error('not a FeatureCollection');

  const paths = [];
  for (const f of geo.features) {
    const d = geomToPath(f.geometry);
    if (!d) continue;
    const id3 = f.id || '';
    const name = (f.properties && f.properties.name) || '';
    paths.push(
      '<path id="' + escAttr(id3) + '" data-name="' + escAttr(name) + '" d="' + d + '"/>'
    );
  }

  const svg =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">' +
    '<g class="countries" fill="#1a1f2e" stroke="#2a2f3e" stroke-width="0.4" stroke-linejoin="round">' +
    paths.join('') +
    '</g></svg>';

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, svg);
  console.log('[write] ' + OUT + ' (' + svg.length + ' bytes, ' + paths.length + ' countries)');
}

main().catch(e => { console.error(e); process.exit(1); });
