const { test, expect } = require('@playwright/test');

const ADMIN_KEY = 'test-admin-key';

test.describe('Local admin portal', () => {
  test('requires admin key for data APIs', async ({ request }) => {
    const missing = await request.get('/api/admin/data/overview');
    expect(missing.status()).toBe(401);

    const queryKey = await request.get('/api/admin/data/overview?key=' + encodeURIComponent(ADMIN_KEY));
    expect(queryKey.status()).toBe(401);

    const wrong = await request.get('/api/admin/data/overview', {
      headers: { 'x-admin-key': 'wrong' },
    });
    expect(wrong.status()).toBe(401);

    const ok = await request.get('/api/admin/data/overview', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(ok.status()).toBe(200);
    const body = await ok.json();
    expect(body.db.fighters).toBeGreaterThan(0);
    expect(body.editable.fighters.fields).toContain('reach_cm');
  });

  test('blocks cross-origin admin mutations', async ({ request }) => {
    const res = await request.post('/api/admin/data/audit/run', {
      headers: {
        'x-admin-key': ADMIN_KEY,
        origin: 'https://example.com',
      },
      data: {},
    });
    expect(res.status()).toBe(403);
  });

  test('unlocks and renders overview', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.locator('h1')).toHaveText('Data Operations');
    await expect(page.locator('#lockState')).toHaveText('Locked');

    await page.locator('#adminKey').fill(ADMIN_KEY);
    await page.locator('#saveKeyBtn').click();

    await expect(page.locator('#lockState')).toHaveText('Unlocked');
    await expect(page.locator('.stat').first()).toBeVisible();
    await expect(page.locator('#entityTable')).toContainText('fighters');
  });
});
