// @ts-check
const { test, expect } = require('@playwright/test');

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
});
