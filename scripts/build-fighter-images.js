#!/usr/bin/env node
// Parses data/ufc_athlete_images_all.txt + data/seed.json and emits
// data/fighter_images.json keyed by fighter id:
//   { "<fighter_id>": { "headshot_url": "...", "body_url": "..." } }
// db.init() reads this snapshot on boot and UPSERTs the URLs onto fighters.
// Idempotent — re-run after refreshing the txt file to update URLs.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const TXT = path.join(ROOT, 'data', 'ufc_athlete_images_all.txt');
const SEED = path.join(ROOT, 'data', 'seed.json');
const OUT = path.join(ROOT, 'data', 'fighter_images.json');

function stripAccents(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function fighterLookupKeys(fighter) {
  const name = stripAccents(String(fighter.name || '').trim());
  if (!name) return [];
  const parts = name.split(/\s+/);
  if (parts.length === 0) return [];
  const last = parts[parts.length - 1].toUpperCase();
  const first = parts.length > 1 ? parts[0].toUpperCase() : '';
  const keys = new Set();
  if (first) keys.add(`${last}_${first}`);
  // Multi-token last name: "dos Santos", "St-Pierre", etc. Try last-two tokens.
  if (parts.length >= 3 && first) {
    const lastTwo = `${parts[parts.length - 2]}_${parts[parts.length - 1]}`.toUpperCase();
    keys.add(`${lastTwo}_${first}`);
  }
  // Single-name fighter: just LAST.
  if (!first) keys.add(last);
  return [...keys];
}

function extractKeyFromUrl(url) {
  if (!url || /no-profile-image/i.test(url)) return null;
  const noQuery = url.split('?')[0];
  // The dataset double-encodes some paths (%252F → %2F → /). Decode twice
  // defensively, swallowing malformed sequences.
  let decoded = noQuery;
  for (let i = 0; i < 2; i++) {
    try { decoded = decodeURIComponent(decoded); } catch { break; }
  }
  let filename = decoded.split('/').pop().replace(/\.png$/i, '');
  // Strip leading GUIDs like "8fcbb4f9-d4ad-4144-b4b3-c244d25bad2f/" remnants
  filename = filename.replace(/^[a-f0-9-]{16,}_/, '');

  // Pattern: CamelCase concat (PapyAbedi_Headshot, RicardoAbreu_Headshot)
  let m = filename.match(/^([A-Z][a-z]+)([A-Z][a-z]+)_/);
  if (m) return `${m[2].toUpperCase()}_${m[1].toUpperCase()}`;

  // Pattern: hyphenated lowercase fullbody (ricardo-abreu_477654_RightFullBodyImage)
  m = filename.match(/^([a-z]+)-([a-z]+)_\d+_/);
  if (m) return `${m[2].toUpperCase()}_${m[1].toUpperCase()}`;

  // Pattern: hyphenated TitleCase (Papy-Abedi_205746_RightFullBodyImage)
  m = filename.match(/^([A-Z][a-z]+)-([A-Z][a-z]+)_\d+_/);
  if (m) return `${m[2].toUpperCase()}_${m[1].toUpperCase()}`;

  // Pattern: ALL_CAPS — split by underscore, take the first one or two
  // alphabetic-uppercase tokens (allowing internal hyphens / apostrophes).
  // First token = LAST, second = FIRST. Stop after two name tokens or when
  // we hit something that looks like a date / suffix marker.
  const tokens = filename.split('_');
  const nameTokens = [];
  for (const t of tokens) {
    if (/^[A-Z][A-Z'-]*$/.test(t) && t.length >= 2) {
      nameTokens.push(t);
      if (nameTokens.length === 2) break;
    } else if (nameTokens.length >= 1) {
      // single-name fighter or already past the name portion
      break;
    }
  }
  if (nameTokens.length === 2) return `${nameTokens[0]}_${nameTokens[1]}`;
  if (nameTokens.length === 1) return nameTokens[0];
  return null;
}

function classifyStyle(url) {
  if (/\/teaser\//.test(url)) return 'headshot';
  if (/event_fight_card_upper_body_of_standing_athlete/.test(url)) return 'body';
  return null;
}

function main() {
  const txt = fs.readFileSync(TXT, 'utf8');
  const seed = JSON.parse(fs.readFileSync(SEED, 'utf8'));
  const fighters = seed.fighters || [];

  // Build name → fighter_id map (multiple keys per fighter).
  const nameToId = new Map();
  const collisions = [];
  for (const f of fighters) {
    for (const k of fighterLookupKeys(f)) {
      if (nameToId.has(k) && nameToId.get(k) !== f.id) {
        collisions.push({ key: k, ids: [nameToId.get(k), f.id], name: f.name });
        // Keep the lower-id (older) fighter on collisions; URLs for the
        // newer namesake will fall through to no-match.
        continue;
      }
      nameToId.set(k, f.id);
    }
  }

  const result = {};
  let matched = 0;
  let unmatched = 0;
  const unmatchedSamples = [];

  const lines = txt.split(/\r?\n/).filter(Boolean);
  for (const url of lines) {
    const style = classifyStyle(url);
    if (!style) continue;
    const key = extractKeyFromUrl(url);
    if (!key) {
      unmatched++;
      if (unmatchedSamples.length < 10) unmatchedSamples.push(url);
      continue;
    }
    const id = nameToId.get(key);
    if (!id) {
      unmatched++;
      if (unmatchedSamples.length < 10) unmatchedSamples.push(`${key} ← ${url}`);
      continue;
    }
    if (!result[id]) result[id] = {};
    // Take the latest URL for each style — txt is roughly chronological,
    // so the last one wins.
    result[id][style === 'headshot' ? 'headshot_url' : 'body_url'] = url;
    matched++;
  }

  fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');

  const fightersWithImage = Object.keys(result).length;
  const fightersWithBoth = Object.values(result).filter(v => v.headshot_url && v.body_url).length;
  console.log(`URLs matched:           ${matched}`);
  console.log(`URLs unmatched:         ${unmatched}`);
  console.log(`Fighters with image:    ${fightersWithImage} / ${fighters.length} (${(fightersWithImage / fighters.length * 100).toFixed(1)}%)`);
  console.log(`Fighters with both:     ${fightersWithBoth}`);
  console.log(`Collisions:             ${collisions.length}`);
  if (collisions.length && collisions.length <= 10) {
    console.log('  collisions:', collisions);
  }
  if (unmatchedSamples.length) {
    console.log('\nUnmatched samples:');
    for (const s of unmatchedSamples) console.log('  ' + s);
  }
  console.log(`\nWrote ${OUT}`);
}

main();
