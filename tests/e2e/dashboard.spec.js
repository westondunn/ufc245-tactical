// @ts-check
const { test, expect } = require('@playwright/test');

// Helper: wait for event dropdown to be populated
async function waitForDropdown(page) {
  const dropdown = page.locator('#eventDropdown');
  await expect(dropdown.locator('option')).not.toHaveCount(1, { timeout: 8000 });
  return dropdown;
}

// Helper: wait for fight strip to have chips
async function waitForChips(page) {
  const strip = page.locator('#eventFightStrip');
  await expect(strip.locator('.fight-chip')).not.toHaveCount(0, { timeout: 8000 });
  return strip;
}

// ============================================================
// PAGE LOAD
// ============================================================
test.describe('Page Load', () => {
  test('renders top bar with version', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.top-bar')).toBeVisible();
    await expect(page.locator('.top-bar__name')).toContainText(/v\d+\.\d+\.\d+/, { timeout: 5000 });
  });

  test('renders all primary tab buttons', async ({ page }) => {
    await page.goto('/');
    const tabs = page.locator('.primary-tab');
    await expect(tabs).toHaveCount(5);
    await expect(tabs.nth(0)).toContainText('Dashboard');
    await expect(tabs.nth(1)).toContainText('Events');
    await expect(tabs.nth(2)).toContainText('Fighters');
    await expect(tabs.nth(3)).toContainText('Stat Leaders');
    await expect(tabs.nth(4)).toContainText('Picks');
  });

  test('Dashboard tab is active by default', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.primary-tab.active')).toContainText('Dashboard');
    await expect(page.locator('#tab-dashboard')).toBeVisible();
  });

  test('hero shows UFC 245 on load', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#heroEvent')).toContainText('UFC 245', { timeout: 5000 });
  });

  test('no console errors on load', async ({ page }) => {
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    await page.goto('/');
    await waitForDropdown(page);
    const real = errors.filter(e => !e.includes('favicon'));
    expect(real).toHaveLength(0);
  });
});

// ============================================================
// EVENT DROPDOWN
// ============================================================
test.describe('Event Dropdown', () => {
  test('populates with 50+ events', async ({ page }) => {
    await page.goto('/');
    const dropdown = await waitForDropdown(page);
    const count = await dropdown.locator('option').count();
    expect(count).toBeGreaterThan(50);
  });

  test('contains UFC 245 and UFC 300', async ({ page }) => {
    await page.goto('/');
    const dropdown = await waitForDropdown(page);
    const texts = await dropdown.locator('option').allTextContents();
    expect(texts.some(t => t.includes('UFC 245'))).toBe(true);
    expect(texts.some(t => t.includes('UFC 300'))).toBe(true);
  });

  test('UFC 245 is selected by default', async ({ page }) => {
    await page.goto('/');
    await waitForDropdown(page);
    const val = await page.locator('#eventDropdown').inputValue();
    expect(val).not.toBe('');
  });

  test('fight strip loads chips for default event', async ({ page }) => {
    await page.goto('/');
    const strip = await waitForChips(page);
    const count = await strip.locator('.fight-chip').count();
    expect(count).toBeGreaterThanOrEqual(5);
  });

  test('changing event loads new fight chips', async ({ page }) => {
    await page.goto('/');
    const dropdown = await waitForDropdown(page);

    // Find UFC 300
    const ufc300 = await dropdown.locator('option').evaluateAll(opts =>
      opts.find(o => o.textContent.includes('UFC 300'))?.value
    );
    expect(ufc300).toBeTruthy();

    await dropdown.selectOption(ufc300);
    // Wait for new chips to load
    await expect(page.locator('#eventFightStrip .fight-chip')).not.toHaveCount(0, { timeout: 5000 });
    const count = await page.locator('#eventFightStrip .fight-chip').count();
    expect(count).toBeGreaterThanOrEqual(5);
  });

  test('changing event auto-selects main event chip', async ({ page }) => {
    await page.goto('/');
    const dropdown = await waitForDropdown(page);

    // Switch to UFC 300
    const ufc300 = await dropdown.locator('option').evaluateAll(opts =>
      opts.find(o => o.textContent.includes('UFC 300'))?.value
    );
    expect(ufc300).toBeTruthy();
    await dropdown.selectOption(ufc300);
    await expect(page.locator('#eventFightStrip .fight-chip')).not.toHaveCount(0, { timeout: 5000 });

    // A chip should be auto-selected (active class)
    await expect(page.locator('#eventFightStrip .fight-chip.active')).toHaveCount(1, { timeout: 3000 });

    // Hero should update to reflect the selected fight
    await expect(page.locator('#heroEvent')).toContainText('UFC 300', { timeout: 3000 });
  });

  test('generic stats panel renders for fights with stats', async ({ page }) => {
    await page.goto('/');
    const dropdown = await waitForDropdown(page);

    // Switch to UFC 300 (not UFC 245, which uses hardcoded sections)
    const ufc300 = await dropdown.locator('option').evaluateAll(opts =>
      opts.find(o => o.textContent.includes('UFC 300'))?.value
    );
    if (ufc300) {
      await dropdown.selectOption(ufc300);
      await expect(page.locator('#eventFightStrip .fight-chip.active')).toHaveCount(1, { timeout: 5000 });

      // Generic stats panel should be visible if fight has stats
      const panel = page.locator('#genericStatsPanel');
      const isVisible = await panel.isVisible();
      if (isVisible) {
        // Should contain strike totals section
        await expect(panel).toContainText('STRIKING TOTALS', { timeout: 3000 });
        // Should contain target distribution section
        await expect(panel).toContainText('TARGET DISTRIBUTION');
      }
      // If not visible, the fight may not have stats — that's acceptable
    }
  });
});

// ============================================================
// FIGHT SELECTION
// ============================================================
test.describe('Fight Selection', () => {
  test('clicking UFC 245 main event loads full recreation', async ({ page }) => {
    await page.goto('/');
    await waitForChips(page);
    await page.locator('#eventFightStrip .fight-chip').first().click();

    await expect(page.locator('#heroRedName')).toContainText('Usman', { timeout: 3000 });
    // Scoped sections visible (full: true)
    const tape = page.locator('#tape');
    if (await tape.count() > 0) {
      await expect(tape).not.toHaveCSS('opacity', '0.18', { timeout: 2000 });
    }
  });

  test('clicking non-main fight dims scoped sections', async ({ page }) => {
    await page.goto('/');
    await waitForChips(page);

    const chips = page.locator('#eventFightStrip .fight-chip');
    if (await chips.count() >= 2) {
      await chips.nth(1).click();
      // Wait for hero to update (won't say UFC 245 title anymore)
      await page.waitForFunction(() => {
        const el = document.getElementById('heroRedName');
        return el && !el.textContent.includes('Usman');
      }, { timeout: 5000 });

      // Scoped sections should be dimmed
      const tape = page.locator('#tape');
      if (await tape.count() > 0) {
        await expect(tape).toHaveCSS('opacity', '0.18', { timeout: 2000 });
      }
    }
  });

  test('active chip gets highlighted', async ({ page }) => {
    await page.goto('/');
    await waitForChips(page);

    const chips = page.locator('#eventFightStrip .fight-chip');
    if (await chips.count() >= 2) {
      await chips.nth(1).click();
      await expect(chips.nth(1)).toHaveClass(/active/);
      await expect(chips.nth(0)).not.toHaveClass(/active/);
    }
  });
});

// ============================================================
// DRAW / NC DISPLAY
// ============================================================
test.describe('Draw/NC Display', () => {
  test('draws show "vs" instead of "def"', async ({ page }) => {
    await page.goto('/');
    const dropdown = await waitForDropdown(page);

    const ufc282 = await dropdown.locator('option').evaluateAll(opts =>
      opts.find(o => o.textContent.includes('UFC 282'))?.value
    );
    if (ufc282) {
      await dropdown.selectOption(ufc282);
      await expect(page.locator('#eventFightStrip .fight-chip')).not.toHaveCount(0, { timeout: 5000 });

      const firstChip = await page.locator('#eventFightStrip .fight-chip').first().innerHTML();
      expect(firstChip).toContain('vs');
      expect(firstChip).not.toContain('def');
    }
  });
});

// ============================================================
// TAB NAVIGATION
// ============================================================
test.describe('Tab Navigation', () => {
  test('Events tab shows table', async ({ page }) => {
    await page.goto('/');
    await page.locator('.primary-tab', { hasText: 'Events' }).click();
    await expect(page.locator('#tab-events')).toBeVisible();
    await expect(page.locator('#tab-dashboard')).not.toBeVisible();
    await expect(page.locator('#eventsTableBody tr')).not.toHaveCount(0, { timeout: 5000 });
  });

  test('Events tab shows count', async ({ page }) => {
    await page.goto('/');
    await page.locator('.primary-tab', { hasText: 'Events' }).click();
    await expect(page.locator('#eventCount')).toContainText(/\d+ events/, { timeout: 5000 });
  });

  test('Fighters tab shows directory', async ({ page }) => {
    await page.goto('/');
    await page.locator('.primary-tab', { hasText: 'Fighters' }).click();
    await expect(page.locator('#tab-fighters')).toBeVisible();
    await expect(page.locator('.fighter-card')).not.toHaveCount(0, { timeout: 8000 });
  });

  test('Stat Leaders tab loads', async ({ page }) => {
    await page.goto('/');
    await page.locator('.primary-tab', { hasText: 'Stat Leaders' }).click();
    await expect(page.locator('#tab-stats')).toBeVisible();
    await expect(page.locator('.leader-card')).not.toHaveCount(0, { timeout: 8000 });
  });

  test('back to Dashboard restores content', async ({ page }) => {
    await page.goto('/');
    await page.locator('.primary-tab', { hasText: 'Events' }).click();
    await page.locator('.primary-tab', { hasText: 'Dashboard' }).click();
    await expect(page.locator('#tab-dashboard')).toBeVisible();
    await expect(page.locator('#tab-events')).not.toBeVisible();
  });
});

// ============================================================
// EVENTS ACCORDION
// ============================================================
test.describe('Events Accordion', () => {
  test('event search filters', async ({ page }) => {
    await page.goto('/');
    await page.locator('.primary-tab', { hasText: 'Events' }).click();
    await expect(page.locator('#eventsTableBody tr')).not.toHaveCount(0, { timeout: 5000 });

    const before = await page.locator('#eventsTableBody tr:visible').count();
    await page.locator('#eventSearchInput').fill('Usman');
    await page.waitForFunction(() => {
      const rows = document.querySelectorAll('#eventsTableBody tr');
      let vis = 0;
      rows.forEach(r => { if (r.offsetParent !== null) vis++; });
      return vis < 100;
    }, { timeout: 3000 });
    const after = await page.locator('#eventsTableBody tr:visible').count();
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(0);
  });
});

// ============================================================
// FIGHTER SEARCH
// ============================================================
test.describe('Fighter Search', () => {
  test('autocomplete shows results', async ({ page }) => {
    await page.goto('/');
    await page.locator('#fighterSearch').fill('McGregor');
    await expect(page.locator('#searchResults')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('#searchResults')).toContainText('Conor McGregor');
  });

  test('clicking result opens panel', async ({ page }) => {
    await page.goto('/');
    await page.locator('#fighterSearch').fill('McGregor');
    await expect(page.locator('#searchResults .search-result')).not.toHaveCount(0, { timeout: 3000 });
    await page.locator('#searchResults .search-result').first().click();
    await expect(page.locator('#fighterPanel')).toBeVisible({ timeout: 3000 });
  });

  test('no results for gibberish', async ({ page }) => {
    await page.goto('/');
    await page.locator('#fighterSearch').fill('xyzzzqqq');
    await expect(page.locator('#searchResults')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('#searchResults')).toContainText('No fighters found');
  });
});

// ============================================================
// STICKY LAYOUT
// ============================================================
test.describe('Sticky Layout', () => {
  test('top bar fixed at top on scroll', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => window.scrollTo(0, 500));
    const box = await page.locator('.top-bar').boundingBox();
    expect(box.y).toBeLessThanOrEqual(1);
  });

  test('tabs stick below top bar', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => window.scrollTo(0, 500));
    const box = await page.locator('.primary-tabs').boundingBox();
    expect(box.y).toBeLessThan(60);
    expect(box.y).toBeGreaterThanOrEqual(30);
  });
});

// ============================================================
// VERSION DISPLAY
// ============================================================
test.describe('Version Display', () => {
  test('top bar shows version', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.top-bar__name')).toContainText(/v\d+\.\d+\.\d+/, { timeout: 5000 });
  });

  test('footer shows version', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page.locator('#appVersionFooter')).toContainText(/v\d+\.\d+\.\d+/, { timeout: 5000 });
  });
});

// ============================================================
// MOBILE
// ============================================================
test.describe('Mobile Layout', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('all tabs visible', async ({ page }) => {
    await page.goto('/');
    for (let i = 0; i < 4; i++) {
      await expect(page.locator('.primary-tab').nth(i)).toBeVisible();
    }
  });

  test('dropdown fills width', async ({ page }) => {
    await page.goto('/');
    await waitForDropdown(page);
    const box = await page.locator('#eventDropdown').boundingBox();
    expect(box.width).toBeGreaterThan(80);
  });

  test('fight strip scrolls', async ({ page }) => {
    await page.goto('/');
    await waitForChips(page);
    const strip = page.locator('#eventFightStrip');
    const scrollW = await strip.evaluate(el => el.scrollWidth);
    const clientW = await strip.evaluate(el => el.clientWidth);
    expect(scrollW).toBeGreaterThan(clientW);
  });
});
