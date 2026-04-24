// @ts-check
// E2E tests for the /api/users + /api/picks + /api/leaderboard surface.
// Expects the server to run with ENABLE_PICKS=true and ADMIN_KEY=test-admin-key
// (wired by playwright.config.js).

const { test, expect } = require('@playwright/test');

const ADMIN_KEY = 'test-admin-key';

async function resolveUfc245(request) {
  const evRes = await request.get('/api/events');
  const events = await evRes.json();
  const ufc245 = events.find(e => e.number === 245);
  expect(ufc245, 'UFC 245 must exist in seed data').toBeTruthy();
  const cardRes = await request.get(`/api/events/${ufc245.id}/card`);
  const { card } = await cardRes.json();
  const mainEvent = card.find(f => f.is_main);
  expect(mainEvent, 'UFC 245 main event must exist').toBeTruthy();
  return { ufc245, mainEvent, card };
}

test.describe('Picks API — flag & version', () => {
  test('GET /api/version exposes features.picks flag', async ({ request }) => {
    const res = await request.get('/api/version');
    const body = await res.json();
    expect(body.features).toBeTruthy();
    expect(body.features.picks).toBe(true);
  });

  test('GET /healthz exposes features.picks flag', async ({ request }) => {
    const res = await request.get('/healthz');
    const body = await res.json();
    expect(body.features.picks).toBe(true);
  });
});

test.describe('Picks API — users', () => {
  test('POST /api/users creates profile with UUID id', async ({ request }) => {
    const res = await request.post('/api/users', {
      data: { display_name: 'E2E Tester', avatar_key: 'a3' }
    });
    expect(res.status()).toBe(200);
    const { user } = await res.json();
    expect(user.display_name).toBe('E2E Tester');
    expect(user.avatar_key).toBe('a3');
    expect(user.is_guest).toBe(1);
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('POST /api/users rejects empty display_name', async ({ request }) => {
    const res = await request.post('/api/users', { data: { display_name: '' } });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('display_name_empty');
  });

  test('POST /api/users rejects bad avatar_key', async ({ request }) => {
    const res = await request.post('/api/users', {
      data: { display_name: 'ok', avatar_key: 'zz' }
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('avatar_key_invalid');
  });

  test('GET /api/users/:id returns profile', async ({ request }) => {
    const created = await request.post('/api/users', { data: { display_name: 'LookupMe' } });
    const { user } = await created.json();
    const res = await request.get(`/api/users/${user.id}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.user.id).toBe(user.id);
  });

  test('GET /api/users/:id returns 404 for unknown', async ({ request }) => {
    const res = await request.get('/api/users/00000000-0000-0000-0000-000000000000');
    expect(res.status()).toBe(404);
  });

  test('PATCH /api/users/:id requires X-User-Id', async ({ request }) => {
    const res = await request.patch('/api/users/anything', { data: { display_name: 'x' } });
    expect(res.status()).toBe(401);
  });

  test('PATCH /api/users/:id rejects cross-user modification', async ({ request }) => {
    const a = (await (await request.post('/api/users', { data: { display_name: 'A' } })).json()).user;
    const b = (await (await request.post('/api/users', { data: { display_name: 'B' } })).json()).user;
    const res = await request.patch(`/api/users/${a.id}`, {
      headers: { 'x-user-id': b.id },
      data: { display_name: 'hijack' }
    });
    expect(res.status()).toBe(403);
  });

  test('PATCH /api/users/:id updates own profile', async ({ request }) => {
    const a = (await (await request.post('/api/users', { data: { display_name: 'Before' } })).json()).user;
    const res = await request.patch(`/api/users/${a.id}`, {
      headers: { 'x-user-id': a.id },
      data: { display_name: 'After', avatar_key: 'a5' }
    });
    expect(res.status()).toBe(200);
    const { user } = await res.json();
    expect(user.display_name).toBe('After');
    expect(user.avatar_key).toBe('a5');
  });
});

test.describe('Picks API — submissions & lock', () => {
  // These tests write real rows and depend on UFC 245's main event being unlocked
  // (no seed winner would be ideal, but seed HAS winners so we rely on the pick
  // endpoint to reject them). We'll verify rejection, then use a different event
  // pattern where winner_id IS set to verify the lock path.

  test('POST /api/picks requires X-User-Id', async ({ request }) => {
    const res = await request.post('/api/picks', {
      data: { event_id: 1, fight_id: 1, picked_fighter_id: 1 }
    });
    expect(res.status()).toBe(401);
  });

  test('POST /api/picks rejects picks on fights that already have a winner', async ({ request }) => {
    const { ufc245, mainEvent } = await resolveUfc245(request);
    const user = (await (await request.post('/api/users', { data: { display_name: 'PickTester' } })).json()).user;
    const res = await request.post('/api/picks', {
      headers: { 'x-user-id': user.id },
      data: {
        event_id: ufc245.id,
        fight_id: mainEvent.id,
        picked_fighter_id: mainEvent.red_id,
        confidence: 70
      }
    });
    // UFC 245 main event has winner_id set in seed → pick should be locked
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('pick_locked');
    expect(body.reason).toBe('fight_over');
  });

  test('POST /api/picks validates body', async ({ request }) => {
    const user = (await (await request.post('/api/users', { data: { display_name: 'ValidatorTester' } })).json()).user;
    const res = await request.post('/api/picks', {
      headers: { 'x-user-id': user.id },
      data: { event_id: 'abc' }
    });
    expect(res.status()).toBe(400);
  });
});

test.describe('Picks API — leaderboard + comparison', () => {
  test('GET /api/leaderboard returns a list (possibly empty)', async ({ request }) => {
    const res = await request.get('/api/leaderboard');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.leaderboard)).toBe(true);
  });

  test('GET /api/events/:id/picks/leaderboard validates id', async ({ request }) => {
    const res = await request.get('/api/events/notanumber/picks/leaderboard');
    expect(res.status()).toBe(400);
  });

  test('GET /api/events/:id/picks/model-comparison returns fight breakdown', async ({ request }) => {
    const { ufc245 } = await resolveUfc245(request);
    const res = await request.get(`/api/events/${ufc245.id}/picks/model-comparison`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.event_id).toBe(ufc245.id);
    expect(Array.isArray(body.fights)).toBe(true);
    expect(body.fights.length).toBeGreaterThan(0);
    const fight = body.fights[0];
    expect(fight).toHaveProperty('fight_id');
    expect(fight).toHaveProperty('users');
    expect(fight.users).toHaveProperty('total');
  });
});

test.describe('Picks API — admin', () => {
  test('POST /api/admin/events/:id/lock-picks requires key', async ({ request }) => {
    const res = await request.post('/api/admin/events/1/lock-picks');
    expect([401, 503]).toContain(res.status());
  });

  test('POST /api/admin/events/:id/lock-picks succeeds with key', async ({ request }) => {
    const { ufc245 } = await resolveUfc245(request);
    const res = await request.post(`/api/admin/events/${ufc245.id}/lock-picks`, {
      headers: { 'x-admin-key': ADMIN_KEY }
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.event_id).toBe(ufc245.id);
    expect(typeof body.locked).toBe('number');
  });

  test('POST /api/admin/events/:id/reconcile-picks is idempotent', async ({ request }) => {
    const { ufc245 } = await resolveUfc245(request);
    const headers = { 'x-admin-key': ADMIN_KEY };
    const first = await request.post(`/api/admin/events/${ufc245.id}/reconcile-picks`, { headers });
    expect(first.status()).toBe(200);
    const a = await first.json();
    const second = await request.post(`/api/admin/events/${ufc245.id}/reconcile-picks`, { headers });
    const b = await second.json();
    expect(a.reconciled).toBe(b.reconciled);
    expect(a.points_awarded).toBe(b.points_awarded);
  });

  test('POST /api/admin/reconcile-all-picks requires key', async ({ request }) => {
    const res = await request.post('/api/admin/reconcile-all-picks');
    expect([401, 503]).toContain(res.status());
  });

  test('POST /api/admin/import-seed requires key', async ({ request }) => {
    const res = await request.post('/api/admin/import-seed');
    expect([401, 503]).toContain(res.status());
  });

  test('POST /api/admin/import-seed is idempotent (second run adds zero)', async ({ request }) => {
    const headers = { 'x-admin-key': ADMIN_KEY };
    // First call may add new rows if seed has entries not in DB. Second call
    // must add zero of each kind — the endpoint is append-only.
    const first = await request.post('/api/admin/import-seed', { headers });
    expect(first.ok()).toBe(true);
    const a = await first.json();
    expect(a.status).toBe('ok');
    expect(a.added).toHaveProperty('fighters');
    expect(a.added).toHaveProperty('events');
    expect(a.added).toHaveProperty('fights');
    const second = await request.post('/api/admin/import-seed', { headers });
    const b = await second.json();
    expect(b.added.fighters).toBe(0);
    expect(b.added.events).toBe(0);
    expect(b.added.fights).toBe(0);
  });

  test('POST /api/admin/reconcile-all-picks backfills and is idempotent', async ({ request }) => {
    const headers = { 'x-admin-key': ADMIN_KEY };
    const first = await request.post('/api/admin/reconcile-all-picks', { headers });
    expect(first.status()).toBe(200);
    const a = await first.json();
    expect(a.status).toBe('ok');
    expect(typeof a.events_processed).toBe('number');
    expect(typeof a.reconciled).toBe('number');
    const second = await request.post('/api/admin/reconcile-all-picks', { headers });
    const b = await second.json();
    expect(b.reconciled).toBe(a.reconciled);
    expect(b.points_awarded).toBe(a.points_awarded);
  });
});

test.describe('Picks UI — widget rendering', () => {
  test('Picks tab renders the Upcoming view after profile creation', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const picksBtn = page.locator('#picksTabBtn');
    await expect(picksBtn).toBeVisible();
    await picksBtn.click();

    // Modal auto-opens on first Picks visit without a profile
    await expect(page.locator('#profileModal')).toBeVisible();
    await page.locator('#profileDisplayName').fill('UI Tester');
    await page.locator('.avatar-pick[data-avatar-key="a4"]').click();
    await page.locator('#profileSubmitBtn').click();

    // Chip appears + upcoming view is active
    await expect(page.locator('#profileChipBtn')).toBeVisible();
    await expect(page.locator('#picksViewUpcoming')).toBeVisible();

    // Default event is the nearest upcoming (or most recent if none). Either
    // a .pick-fight widget or the empty placeholder must render.
    const widgetOrEmpty = page.locator('.pick-fight, .picks-fights .picks-placeholder').first();
    await expect(widgetOrEmpty).toBeVisible({ timeout: 8000 });

    // Hint line reflects open vs concluded counts (always populated after load)
    await expect(page.locator('#picksEventHint')).not.toBeEmpty();
  });

  test('Upcoming view hides concluded fights (only open fights get widgets)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('#picksTabBtn').click();
    await expect(page.locator('#profileModal')).toBeVisible();
    await page.locator('#profileDisplayName').fill('Filter Tester');
    await page.locator('#profileSubmitBtn').click();
    await expect(page.locator('#profileChipBtn')).toBeVisible();

    // Switch to UFC 245 via dropdown — all fights concluded in the seed
    const sel = page.locator('#picksEventSelect');
    await expect(sel).toBeVisible();
    const ufc245Option = sel.locator('option', { hasText: 'UFC 245' });
    const ufc245Value = await ufc245Option.getAttribute('value');
    await sel.selectOption(ufc245Value);

    // Expect the empty-state placeholder, NOT any .pick-fight widgets
    await expect(page.locator('.picks-fights .picks-placeholder')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.pick-fight')).toHaveCount(0);
    await expect(page.locator('#picksEventHint')).toContainText(/concluded/i);
  });

  test('subnav switches between views', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('#picksTabBtn').click();
    // Modal auto-opens on first Picks visit
    await expect(page.locator('#profileModal')).toBeVisible();
    await page.locator('#profileDisplayName').fill('Subnav Tester');
    await page.locator('#profileSubmitBtn').click();

    // Leaderboard
    await page.locator('.picks-subnav__btn[data-picks-view="leaderboard"]').click();
    await expect(page.locator('#picksViewLeaderboard')).toBeVisible();
    await expect(page.locator('.picks-lb-tab.active')).toHaveText(/THIS EVENT/i);

    // History
    await page.locator('.picks-subnav__btn[data-picks-view="history"]').click();
    await expect(page.locator('#picksViewHistory')).toBeVisible();

    // Back to Upcoming
    await page.locator('.picks-subnav__btn[data-picks-view="upcoming"]').click();
    await expect(page.locator('#picksViewUpcoming')).toBeVisible();
  });
});
