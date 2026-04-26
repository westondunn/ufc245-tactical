// @ts-check
const { test, expect } = require('@playwright/test');

async function resolveFutureOpenFight(request) {
  const events = await (await request.get('/api/events')).json();
  const today = new Date().toISOString().slice(0, 10);
  const futureEvents = events
    .filter(e => e.date && e.date > today)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (const event of futureEvents) {
    const cardRes = await request.get(`/api/events/${event.id}/card`);
    if (!cardRes.ok()) continue;
    const { card } = await cardRes.json();
    const fight = (card || []).find(f => f.id && f.red_id && f.blue_id && f.winner_id == null);
    if (fight) return { event, fight };
  }
  throw new Error('No future open fight fixture found');
}

// Use Playwright's request context (no browser needed for API tests)
test.describe('API Endpoints', () => {

  test('GET /healthz returns ok', async ({ request }) => {
    const res = await request.get('/healthz');
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.version).toMatch(/\d+\.\d+\.\d+/);
    expect(body.service).toBe('ufc-tactical');
    expect(body.uptime_s).toBeGreaterThanOrEqual(0);
    expect(body.node).toBeTruthy();
  });

  test('GET /api/version returns semver', async ({ request }) => {
    const res = await request.get('/api/version');
    const body = await res.json();
    expect(body.version).toMatch(/\d+\.\d+\.\d+/);
    expect(body.sha).toBeTruthy();
    expect(body.build).toBeTruthy();
  });

  test('GET /api/events returns 50+ events', async ({ request }) => {
    const res = await request.get('/api/events');
    const events = await res.json();
    expect(events.length).toBeGreaterThan(50);
    expect(events[0]).toHaveProperty('id');
    expect(events[0]).toHaveProperty('number');
    expect(events[0]).toHaveProperty('name');
    expect(events[0]).toHaveProperty('date');
  });

  test('GET /api/events/:id/card returns fight card', async ({ request }) => {
    const evRes = await request.get('/api/events');
    const events = await evRes.json();
    const ufc245 = events.find(e => e.number === 245);
    expect(ufc245).toBeTruthy();

    const cardRes = await request.get(`/api/events/${ufc245.id}/card`);
    const { event, card } = await cardRes.json();
    expect(event.number).toBe(245);
    expect(card.length).toBeGreaterThanOrEqual(10);
    expect(card[0]).toHaveProperty('red_name');
    expect(card[0]).toHaveProperty('blue_name');
    expect(card[0]).toHaveProperty('method');
    expect(card[0]).toHaveProperty('winner_id');
    expect(card[0]).toHaveProperty('red_record_wins');
    expect(card[0]).toHaveProperty('red_record_losses');
    expect(card[0]).toHaveProperty('red_record_draws');
    expect(card[0]).toHaveProperty('red_prior_ufc_fights');
    expect(card[0]).toHaveProperty('red_is_ufc_debut');
    expect(card[0]).toHaveProperty('blue_record_wins');
    expect(card[0]).toHaveProperty('blue_record_losses');
    expect(card[0]).toHaveProperty('blue_record_draws');
    expect(card[0]).toHaveProperty('blue_prior_ufc_fights');
    expect(card[0]).toHaveProperty('blue_is_ufc_debut');
  });

  test('GET /api/events/:id/card returns 400 for non-numeric ID', async ({ request }) => {
    const res = await request.get('/api/events/notanumber/card');
    expect(res.status()).toBe(400);
  });

  test('GET /api/events/:id/card returns 404 for missing event', async ({ request }) => {
    const res = await request.get('/api/events/999999/card');
    expect(res.status()).toBe(404);
  });

  test('GET /api/events/number/245 returns UFC 245', async ({ request }) => {
    const res = await request.get('/api/events/number/245');
    const { event, card } = await res.json();
    expect(event.name).toContain('UFC 245');
    expect(card.length).toBeGreaterThanOrEqual(10);
  });

  test('GET /api/fighters/search finds McGregor', async ({ request }) => {
    const res = await request.get('/api/fighters/search?q=McGregor');
    const fighters = await res.json();
    expect(fighters.length).toBeGreaterThan(0);
    expect(fighters[0].name).toContain('McGregor');
  });

  test('GET /api/fighters/search returns empty for gibberish', async ({ request }) => {
    const res = await request.get('/api/fighters/search?q=xyzzzqqq123');
    const fighters = await res.json();
    expect(fighters).toHaveLength(0);
  });

  test('GET /api/fighters/search returns empty for short query', async ({ request }) => {
    const res = await request.get('/api/fighters/search?q=a');
    const fighters = await res.json();
    expect(fighters).toHaveLength(0);
  });

  test('GET /api/fighters/:id returns fighter profile', async ({ request }) => {
    const searchRes = await request.get('/api/fighters/search?q=McGregor');
    const fighters = await searchRes.json();
    const id = fighters[0].id;

    const res = await request.get(`/api/fighters/${id}`);
    const fighter = await res.json();
    expect(fighter.name).toBe('Conor McGregor');
    expect(fighter).toHaveProperty('height_cm');
    expect(fighter).toHaveProperty('reach_cm');
    expect(fighter).toHaveProperty('stance');
    expect(fighter).toHaveProperty('weight_class');
    expect(fighter).toHaveProperty('nationality');
  });

  test('GET /api/fighters/:id/events returns grouped fight history', async ({ request }) => {
    const searchRes = await request.get('/api/fighters/search?q=McGregor');
    const id = (await searchRes.json())[0].id;

    const res = await request.get(`/api/fighters/${id}/events`);
    const events = await res.json();
    expect(events.length).toBeGreaterThan(3);
    // Server groups by event — each entry has event info + fights array
    expect(events[0]).toHaveProperty('event_id');
    expect(events[0]).toHaveProperty('name');
    expect(events[0]).toHaveProperty('fights');
    expect(events[0].fights.length).toBeGreaterThan(0);
    expect(events[0].fights[0]).toHaveProperty('fight_id');
    expect(events[0].fights[0]).toHaveProperty('method');
  });

  test('GET /api/fighters/:id/career-stats returns nested stats', async ({ request }) => {
    const searchRes = await request.get('/api/fighters/search?q=Usman');
    const id = (await searchRes.json())[0].id;

    const res = await request.get(`/api/fighters/${id}/career-stats`);
    const body = await res.json();
    // Response shape: { fighter, stats, record }
    expect(body).toHaveProperty('fighter');
    expect(body).toHaveProperty('stats');
    expect(body).toHaveProperty('record');
    expect(body.fighter.name).toContain('Usman');
    expect(body.stats.total_fights).toBeGreaterThan(0);
    expect(body.stats.total_sig_landed).toBeGreaterThan(0);
    expect(body.record.wins).toBeGreaterThan(0);
    expect(body.record).toHaveProperty('losses');
    expect(body.record).toHaveProperty('total');
  });

  test('GET /api/fighters/:id1/compare/:id2 returns comparison', async ({ request }) => {
    const usmanRes = await request.get('/api/fighters/search?q=Usman');
    const usmanId = (await usmanRes.json())[0].id;
    const covRes = await request.get('/api/fighters/search?q=Covington');
    const covId = (await covRes.json())[0].id;

    const res = await request.get(`/api/fighters/${usmanId}/compare/${covId}`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.fighters).toHaveLength(2);
    expect(body.fighters[0].name).toContain('Usman');
    expect(body.fighters[1].name).toContain('Covington');
    expect(body.fighters[0]).toHaveProperty('career_stats');
    expect(body.fighters[0]).toHaveProperty('record');
    expect(body.fighters[0]).toHaveProperty('biomechanics');
    expect(body.fighters[0].biomechanics.force_n).toBeGreaterThan(0);
    expect(body).toHaveProperty('head_to_head');
    expect(body.head_to_head.length).toBeGreaterThan(0);
  });

  test('GET /api/fighters/:id1/compare/:id2 returns 404 for invalid fighter', async ({ request }) => {
    const res = await request.get('/api/fighters/1/compare/999999');
    expect(res.status()).toBe(404);
  });

  test('GET /api/fights/:id returns fight with stats', async ({ request }) => {
    const evRes = await request.get('/api/events/number/245');
    const { card } = await evRes.json();
    const mainEvent = card[0];

    const res = await request.get(`/api/fights/${mainEvent.id}`);
    const fight = await res.json();
    expect(fight.event_number).toBe(245);
    expect(fight.red_name).toBe('Kamaru Usman');
    expect(fight.blue_name).toBe('Colby Covington');
    expect(fight.stats.length).toBe(2);
    expect(fight.stats[0].sig_str_landed).toBeGreaterThan(0);
  });

  test('GET /api/fights/:id returns 404 for invalid ID', async ({ request }) => {
    const res = await request.get('/api/fights/999999');
    expect(res.status()).toBe(404);
  });

  test('GET /api/fights/:id/rounds returns fight with round data', async ({ request }) => {
    const evRes = await request.get('/api/events/number/245');
    const { card } = await evRes.json();

    const res = await request.get(`/api/fights/${card[0].id}/rounds`);
    const fight = await res.json();
    expect(fight).toHaveProperty('round_stats');
    expect(fight).toHaveProperty('has_round_stats');
    expect(fight.red_name).toBe('Kamaru Usman');
  });

  test('GET /api/fights/:id/tactical returns tactical breakdown', async ({ request }) => {
    const evRes = await request.get('/api/events/number/245');
    const { card } = await evRes.json();

    const res = await request.get(`/api/fights/${card[0].id}/tactical`);
    const tactical = await res.json();
    expect(tactical).toHaveProperty('fight_id');
    expect(tactical).toHaveProperty('method_class');
    expect(tactical).toHaveProperty('sections');
    expect(tactical.sections.length).toBeGreaterThan(0);
    expect(tactical).toHaveProperty('key_factors');
  });

  test('GET /api/events/:id/tactical returns event tactical breakdowns', async ({ request }) => {
    const evRes = await request.get('/api/events/number/245');
    const { event } = await evRes.json();

    const res = await request.get(`/api/events/${event.id}/tactical`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body).toHaveProperty('event');
    expect(body).toHaveProperty('analyses');
    expect(body.event.number).toBe(245);
    expect(body.analyses.length).toBeGreaterThan(5);
    expect(body.analyses[0]).toHaveProperty('sections');
  });

  test('GET /api/stats/leaders returns leaderboard', async ({ request }) => {
    const res = await request.get('/api/stats/leaders?stat=knockdowns&limit=5');
    const body = await res.json();
    expect(body).toHaveProperty('stat');
    expect(body).toHaveProperty('leaders');
    expect(body.stat).toBe('knockdowns');
    expect(body.leaders.length).toBe(5);
    expect(body.leaders[0]).toHaveProperty('name');
    expect(body.leaders[0]).toHaveProperty('value');
    expect(body.leaders[0].value).toBeGreaterThan(0);
  });

  test('GET /api/fighters returns directory', async ({ request }) => {
    const res = await request.get('/api/fighters');
    const fighters = await res.json();
    expect(fighters.length).toBeGreaterThan(100);
    expect(fighters[0]).toHaveProperty('name');
    expect(fighters[0]).toHaveProperty('id');
  });

  test('GET /api/biomechanics/estimate returns force calculation', async ({ request }) => {
    const res = await request.get('/api/biomechanics/estimate?mass=77&strike=right_cross');
    const bio = await res.json();
    expect(bio.force_n).toBeGreaterThan(1000);
    expect(bio.velocity_ms).toBeGreaterThan(5);
    expect(bio.thresholds.length).toBeGreaterThan(0);
    expect(bio).toHaveProperty('target');
    expect(bio).toHaveProperty('concussion_risk');
  });

  test('GET /api/biomechanics/estimate returns 400 for invalid strike', async ({ request }) => {
    const res = await request.get('/api/biomechanics/estimate?mass=77&strike=nonexistent');
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('available');
  });

  test('GET /api/biomechanics/chain returns kinetic chain', async ({ request }) => {
    const res = await request.get('/api/biomechanics/chain?mass=77&strike=right_cross');
    const chain = await res.json();
    expect(chain.chain.length).toBe(6);
    expect(chain.chain[0].label).toBe('Ground');
    expect(chain.chain[5].label).toBe('Fist');
    expect(chain).toHaveProperty('citation');
  });

  test('GET /api/biomechanics/strikes returns strike types', async ({ request }) => {
    const res = await request.get('/api/biomechanics/strikes');
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body).toHaveProperty('strikes');
    expect(body).toHaveProperty('thresholds');
    expect(body.strikes.length).toBeGreaterThan(8);
    expect(body.strikes[0]).toHaveProperty('type');
    expect(body.strikes[0]).toHaveProperty('reference_force_n');
    expect(body.strikes[0]).toHaveProperty('reference_velocity_ms');
  });

  test('404 for invalid fighter ID', async ({ request }) => {
    const res = await request.get('/api/fighters/999999');
    expect(res.status()).toBe(404);
  });

  test('404 for invalid event number', async ({ request }) => {
    const res = await request.get('/api/events/number/999');
    expect(res.status()).toBe(404);
  });

  test('X-App-Version header present', async ({ request }) => {
    const res = await request.get('/api/version');
    const header = res.headers()['x-app-version'];
    expect(header).toMatch(/\d+\.\d+\.\d+/);
  });

  test('Security headers present', async ({ request }) => {
    const res = await request.get('/healthz');
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
    expect(res.headers()['x-frame-options']).toBe('DENY');
    expect(res.headers()['referrer-policy']).toBeTruthy();
    expect(res.headers()['content-security-policy']).toBeTruthy();
  });

  test('admin endpoints require key', async ({ request }) => {
    const res = await request.get('/api/admin/db-stats');
    // Should be 401 or 503 (no key configured in test)
    expect([401, 503]).toContain(res.status());
  });

  // ── Cache headers & ETag tests ──

  test('API responses include Cache-Control header', async ({ request }) => {
    const res = await request.get('/api/events');
    const cc = res.headers()['cache-control'];
    expect(cc).toContain('public');
    expect(cc).toContain('max-age=');
  });

  test('API responses include ETag header', async ({ request }) => {
    const res = await request.get('/api/events');
    const etag = res.headers()['etag'];
    expect(etag).toBeTruthy();
    expect(etag).toMatch(/^W\//);
  });

  test('Conditional GET returns 304 for matching ETag', async ({ request }) => {
    const res1 = await request.get('/api/events');
    const etag = res1.headers()['etag'];
    expect(etag).toBeTruthy();

    const res2 = await request.get('/api/events', {
      headers: { 'If-None-Match': etag }
    });
    expect(res2.status()).toBe(304);
  });

  test('/healthz has no-cache header', async ({ request }) => {
    const res = await request.get('/healthz');
    expect(res.headers()['cache-control']).toContain('no-cache');
  });

  test('/api/version has no-cache header', async ({ request }) => {
    const res = await request.get('/api/version');
    expect(res.headers()['cache-control']).toContain('no-cache');
  });

  test('biomechanics endpoints have long cache', async ({ request }) => {
    const res = await request.get('/api/biomechanics/strikes');
    expect(res.headers()['cache-control']).toContain('max-age=86400');
  });
});

// ===========================================================================
// Predictions API — public reads + protected ingest/reconcile
// ===========================================================================
test.describe('Predictions API', () => {
  const PREDICTION_KEY = 'test-prediction-key';

  test('GET /api/predictions returns an array', async ({ request }) => {
    const res = await request.get('/api/predictions?limit=10');
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test('GET /api/predictions?fight_id filters by fight', async ({ request }) => {
    const res = await request.get('/api/predictions?fight_id=186');
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    for (const p of body) expect(p.fight_id).toBe(186);
  });

  test('GET /api/predictions?limit clamps to 200', async ({ request }) => {
    const res = await request.get('/api/predictions?limit=9999');
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.length).toBeLessThanOrEqual(200);
  });

  test('GET /api/predictions/accuracy returns stats shape', async ({ request }) => {
    const res = await request.get('/api/predictions/accuracy');
    expect(res.ok()).toBe(true);
    const body = await res.json();
    // Keys present even when no predictions reconciled yet
    expect(body).toHaveProperty('total');
    expect(body).toHaveProperty('correct_count');
    expect(body).toHaveProperty('accuracy_pct');
  });

  test('GET /api/predictions/trends returns trend shape', async ({ request }) => {
    const res = await request.get('/api/predictions/trends?limit=5');
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body).toHaveProperty('summary');
    expect(body.summary).toHaveProperty('event_count');
    expect(body.summary).toHaveProperty('accuracy_pct');
    expect(Array.isArray(body.events)).toBe(true);
  });

  test('GET /api/predictions/models/leaderboard returns model scores', async ({ request }) => {
    const res = await request.get('/api/predictions/models/leaderboard?limit=5');
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body).toHaveProperty('summary');
    expect(body.summary).toHaveProperty('model_count');
    expect(body.summary).toHaveProperty('score');
    expect(Array.isArray(body.leaderboard)).toBe(true);
    for (const row of body.leaderboard) {
      expect(row).toHaveProperty('model_version');
      expect(row).toHaveProperty('record');
      expect(row).toHaveProperty('accuracy_pct');
      expect(row).toHaveProperty('score');
    }
  });

  test('GET /api/predictions/outcomes returns prediction outcome shape', async ({ request }) => {
    const res = await request.get('/api/predictions/outcomes?limit=5');
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body).toHaveProperty('summary');
    expect(body.summary).toHaveProperty('total');
    expect(body.summary).toHaveProperty('method_accuracy_pct');
    expect(body.summary).toHaveProperty('round_accuracy_pct');
    expect(Array.isArray(body.predictions)).toBe(true);
  });

  test('POST /api/events/:id/official-outcomes captures job snapshots', async ({ request }) => {
    const evRes = await request.get('/api/events/number/245');
    const { event, card } = await evRes.json();
    const main = card[0];

    const unauthorized = await request.post(`/api/events/${event.id}/official-outcomes`, {
      data: { outcomes: [] }
    });
    expect(unauthorized.status()).toBe(401);

    const res = await request.post(`/api/events/${event.id}/official-outcomes`, {
      headers: { 'x-prediction-key': PREDICTION_KEY },
      data: {
        outcomes: [{
          fight_id: main.id,
          status: 'official',
          winner_id: main.red_id,
          method: 'KO/TKO',
          method_detail: 'Punches',
          round: 5,
          time: '4:10',
          source: 'e2e'
        }]
      }
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.captured).toBe(1);
    expect(body.outcomes[0].status).toBe('official');
    expect(body.outcomes[0].winner_id).toBe(main.red_id);

    const read = await request.get(`/api/events/${event.id}/official-outcomes`);
    expect(read.ok()).toBe(true);
    const readBody = await read.json();
    expect(readBody.outcomes.some(o => o.fight_id === main.id && o.source === 'e2e')).toBe(true);
  });

  test('POST /api/predictions/ingest without key returns 401', async ({ request }) => {
    const res = await request.post('/api/predictions/ingest', {
      data: { predictions: [] }
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthorized');
  });

  test('POST /api/predictions/ingest with wrong key returns 401', async ({ request }) => {
    const res = await request.post('/api/predictions/ingest', {
      headers: { 'x-prediction-key': 'not-the-right-key' },
      data: { predictions: [] }
    });
    expect(res.status()).toBe(401);
  });

  test('POST /api/predictions/ingest rejects non-array body', async ({ request }) => {
    const res = await request.post('/api/predictions/ingest', {
      headers: { 'x-prediction-key': PREDICTION_KEY },
      data: {}
    });
    expect(res.status()).toBe(400);
  });

  test('POST /api/predictions/ingest upserts by (fight_id, model_version)', async ({ request }) => {
    const { event, fight } = await resolveFutureOpenFight(request);
    const pred = {
      fight_id: fight.id,
      red_fighter_id: fight.red_id,
      blue_fighter_id: fight.blue_id,
      red_win_prob: 0.58,
      blue_win_prob: 0.42,
      model_version: 'e2e.test.ingest',
      feature_hash: 'x',
      predicted_method: 'Decision',
      predicted_round: 3,
      predicted_at: '2026-02-01T00:00:00.000Z',
      event_date: event.date
    };
    // First write
    const r1 = await request.post('/api/predictions/ingest', {
      headers: { 'x-prediction-key': PREDICTION_KEY },
      data: { predictions: [pred] }
    });
    expect(r1.ok()).toBe(true);
    expect((await r1.json()).ingested).toBe(1);
    // Second write with same (fight_id, model_version) should upsert, not dup
    const r2 = await request.post('/api/predictions/ingest', {
      headers: { 'x-prediction-key': PREDICTION_KEY },
      data: { predictions: [{ ...pred, red_win_prob: 0.61, blue_win_prob: 0.39 }] }
    });
    expect(r2.ok()).toBe(true);
    // Verify via GET — should only see one row for this model_version
    const list = await (await request.get(`/api/predictions?fight_id=${fight.id}`)).json();
    const ours = list.filter(p => p.model_version === 'e2e.test.ingest');
    expect(ours.length).toBe(1);
    expect(ours[0].red_win_prob).toBeCloseTo(0.61, 2);
    expect(ours[0].predicted_method).toBe('Decision');
    expect(ours[0].predicted_round).toBe(3);
  });

  test('POST /api/predictions/ingest skips locked started events', async ({ request }) => {
    const modelVersion = `e2e.test.ingest.locked.${Date.now()}`;
    const pred = {
      fight_id: 186,
      red_fighter_id: 31,
      blue_fighter_id: 32,
      red_win_prob: 0.58,
      blue_win_prob: 0.42,
      model_version: modelVersion,
      feature_hash: 'locked',
      predicted_at: '2026-02-01T00:00:00.000Z',
      event_date: '2019-12-14'
    };
    const res = await request.post('/api/predictions/ingest', {
      headers: { 'x-prediction-key': PREDICTION_KEY },
      data: { predictions: [pred] }
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.ingested).toBe(0);
    expect(body.skipped_locked).toBe(1);
    expect(body.locked_indices).toContain(0);
    expect(body.skipped[0].reason).toMatch(/fight_over|event_started/);

    const list = await (await request.get('/api/predictions?fight_id=186')).json();
    expect(list.some(p => p.model_version === modelVersion)).toBe(false);
  });

  test('POST /api/predictions/reconcile without key returns 401', async ({ request }) => {
    const res = await request.post('/api/predictions/reconcile', {
      data: { results: [] }
    });
    expect(res.status()).toBe(401);
  });

  test('POST /api/predictions/reconcile with key sets actual_winner_id', async ({ request }) => {
    const { event, fight } = await resolveFutureOpenFight(request);
    const pred = {
      fight_id: fight.id,
      red_fighter_id: fight.red_id,
      blue_fighter_id: fight.blue_id,
      red_win_prob: 0.9,
      blue_win_prob: 0.1,
      model_version: 'e2e.test.reconcile',
      feature_hash: 'r',
      predicted_method: 'KO/TKO',
      predicted_round: 5,
      predicted_at: '2026-02-01T01:00:00.000Z',
      event_date: event.date
    };
    const ingest = await request.post('/api/predictions/ingest', {
      headers: { 'x-prediction-key': PREDICTION_KEY },
      data: { predictions: [pred] }
    });
    expect(ingest.ok()).toBe(true);
    expect((await ingest.json()).ingested).toBe(1);
    const res = await request.post('/api/predictions/reconcile', {
      headers: { 'x-prediction-key': PREDICTION_KEY },
      data: { results: [{ fight_id: fight.id, actual_winner_id: fight.red_id, method: 'KO/TKO', round: 5, time: '4:10' }] }
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.reconciled).toBeGreaterThanOrEqual(1);
    // Accuracy endpoint should now have at least 1 reconciled row
    const acc = await (await request.get('/api/predictions/accuracy')).json();
    expect(acc.total).toBeGreaterThanOrEqual(1);
    const outcomes = await (await request.get('/api/predictions/outcomes?model_version=e2e.test.reconcile&limit=5')).json();
    expect(outcomes.predictions.length).toBeGreaterThanOrEqual(1);
    expect(outcomes.predictions[0]).toHaveProperty('predicted_fighter_name');
    expect(outcomes.predictions[0].predicted_method).toBe('KO/TKO');
    expect(outcomes.predictions[0].actual_method).toBe('KO/TKO');
    expect(outcomes.predictions[0].method_correct).toBe(1);
    expect(outcomes.predictions[0].round_correct).toBe(1);
  });
});
