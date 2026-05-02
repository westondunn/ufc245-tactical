/**
 * data/scrapers/http.js — shared fetch with retries used by all scraper modules.
 */
const DEFAULT_UA = 'UFC-Tactical-Dashboard/2.0 (github.com/westondunn/ufc245-tactical)';
const DEFAULT_DELAY_MS = 1000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchPage(url, { retries = 3, ua = DEFAULT_UA, delayMs = DEFAULT_DELAY_MS, signal = null } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': ua }, signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const text = await res.text();
      if (delayMs) await sleep(delayMs);
      return text;
    } catch (e) {
      lastErr = e;
      if (i < retries - 1) await sleep(2000);
    }
  }
  throw lastErr;
}

async function headOk(url, { ua = DEFAULT_UA } = {}) {
  try {
    const res = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': ua } });
    return res.ok;
  } catch {
    return false;
  }
}

module.exports = { fetchPage, headOk, sleep };
