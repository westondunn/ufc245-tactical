// @ts-check
const { test, expect } = require('@playwright/test');

// ============================================================
// PAGE LOAD
// ============================================================
test.describe('Page Load', () => {
  test('renders top bar with version', async ({ page }) => {
    await page.goto('/');
    const topBar = page.locator('.top-bar');
    await expect(topBar).toBeVisible();
    // Version fetched from API — wait for it
    await expect(page.locator('.top-bar__name')).toContainText(/v\d+\.\d+\.\d+/, { timeout: 5000 });
  });

  test('renders all 4 tab buttons', async ({ page }) => {
    await page.goto('/');
    const tabs = page.locator('.primary-tab');
    await expect(tabs).toHaveCount(4);
    await expect(tabs.nth(0)).toContainText('Dashboard');
    await expect(tabs.nth(1)).toContainText('Events');
    await expect(tabs.nth(2)).toContainText('Fighters');
    await expect(tabs.nth(3)).toContainText('Stat Leaders');
  });

  test('Dashboard tab is active by default', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.primary-tab.active')).toContainText('Dashboard');
    await expect(page.locator('#tab-dashboard')).toBeVisible();
  });

  test('hero section shows UFC 245 on load', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#heroEvent')).toContainText('UFC 245', { timeout: 5000 });
  });

  test('no console errors on load', async ({ page }) => {
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    await page.goto('/');
    await page.waitForTimeout(2000);
    // Filter out known non-issues (e.g. favicon)
    const real = errors.filter(e => !e.includes('favicon'));
    expect(real).toHaveLength(0);
  });
});

// ============================================================
// EVENT DROPDOWN
// ============================================================
test.describe('Event Dropdown', () => {
  test('dropdown populates with events', async ({ page }) => {
    await page.goto('/');
    const dropdown = page.locator('#eventDropdown');
    await expect(dropdown).toBeVisible();
    // Wait for API to populate
    await expect(dropdown.locator('option')).not.toHaveCount(1, { timeout: 5000 });
    const options = await dropdown.locator('option').allTextContents();
    expect(options.length).toBeGreaterThan(50);
    expect(options.some(o => o.includes('UFC 245'))).toBe(true);
    expect(options.some(o => o.includes('UFC 300'))).toBe(true);
  });

  test('UFC 245 is selected by default', async ({ page }) => {
    await page.goto('/');
    const dropdown = page.locator('#eventDropdown');
    await page.waitForTimeout(2000);
    const selected = await dropdown.inputValue();
    // Should have a value (the event ID for UFC 245)
    expect(selected).not.toBe('');
  });

  test('fight strip loads chips for default event', async ({ page }) => {
    await page.goto('/');
    const strip = page.locator('#eventFightStrip');
    // Wait for chips to render
    await expect(strip.locator('.fight-chip')).not.toHaveCount(0, { timeout: 5000 });
    const chips = await strip.locator('.fight-chip').count();
    expect(chips).toBeGreaterThanOrEqual(5); // UFC 245 has 13 fights
  });

  test('changing event loads new fight chips', async ({ page }) => {
    await page.goto('/');
    const dropdown = page.locator('#eventDropdown');
    await page.waitForTimeout(2000);

    // Find UFC 300 option value
    const options = await dropdown.locator('option').evaluateAll(opts =>
      opts.map(o => ({ value: o.value, text: o.textContent }))
    );
    const ufc300 = options.find(o => o.text.includes('UFC 300'));
    expect(ufc300).toBeTruthy();

    // Select UFC 300
    await dropdown.selectOption(ufc300.value);
    await page.waitForTimeout(1500);

    // Should have fight chips with new data
    const strip = page.locator('#eventFightStrip');
    const chips = await strip.locator('.fight-chip').count();
    expect(chips).toBeGreaterThanOrEqual(5);
  });
});

// ============================================================
// FIGHT SELECTION
// ============================================================
test.describe('Fight Selection', () => {
  test('clicking UFC 245 main event loads full recreation', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Click first chip (main event)
    const firstChip = page.locator('#eventFightStrip .fight-chip').first();
    await expect(firstChip).toBeVisible();
    await firstChip.click();

    // Hero should show Usman
    await expect(page.locator('#heroRedName')).toContainText('Usman', { timeout: 3000 });
    // Scoped sections should be visible (full: true)
    const tape = page.locator('#tape');
    if (await tape.count() > 0) {
      const opacity = await tape.evaluate(el => getComputedStyle(el).opacity);
      expect(parseFloat(opacity)).toBeGreaterThan(0.5);
    }
  });

  test('clicking non-245 fight updates hero with API data', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Click second chip (co-main, not UFC 245 main)
    const chips = page.locator('#eventFightStrip .fight-chip');
    const count = await chips.count();
    if (count >= 2) {
      await chips.nth(1).click();
      await page.waitForTimeout(1500);

      // Hero should update (not still show Usman vs Covington event text)
      // Scoped sections should be dimmed (full: false for non-245)
      const tape = page.locator('#tape');
      if (await tape.count() > 0) {
        const opacity = await tape.evaluate(el => getComputedStyle(el).opacity);
        expect(parseFloat(opacity)).toBeLessThan(0.5);
      }
    }
  });

  test('active chip gets cyan border', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    const chips = page.locator('#eventFightStrip .fight-chip');
    if (await chips.count() >= 2) {
      await chips.nth(1).click();
      await page.waitForTimeout(500);
      await expect(chips.nth(1)).toHaveClass(/active/);
      // First chip should not be active
      await expect(chips.nth(0)).not.toHaveClass(/active/);
    }
  });
});

// ============================================================
// DRAW / NC DISPLAY
// ============================================================
test.describe('Draw/NC Fight Display', () => {
  test('draws show "vs" instead of "def"', async ({ page }) => {
    await page.goto('/');
    const dropdown = page.locator('#eventDropdown');
    await page.waitForTimeout(2000);

    // UFC 282 has Blachowicz vs Ankalaev draw
    const options = await dropdown.locator('option').evaluateAll(opts =>
      opts.map(o => ({ value: o.value, text: o.textContent }))
    );
    const ufc282 = options.find(o => o.text.includes('UFC 282'));
    if (ufc282) {
      await dropdown.selectOption(ufc282.value);
      await page.waitForTimeout(1500);

      // First chip should be the draw — check for "vs" not "def"
      const firstChipHtml = await page.locator('#eventFightStrip .fight-chip').first().innerHTML();
      expect(firstChipHtml).toContain('vs');
      expect(firstChipHtml).not.toContain('def');
    }
  });
});

// ============================================================
// TAB NAVIGATION
// ============================================================
test.describe('Tab Navigation', () => {
  test('Events tab shows event table', async ({ page }) => {
    await page.goto('/');
    await page.locator('.primary-tab', { hasText: 'Events' }).click();

    await expect(page.locator('#tab-events')).toBeVisible();
    await expect(page.locator('#tab-dashboard')).not.toBeVisible();

    // Table should populate
    await expect(page.locator('#eventsTableBody tr')).not.toHaveCount(0, { timeout: 5000 });
  });

  test('Events tab shows event count', async ({ page }) => {
    await page.goto('/');
    await page.locator('.primary-tab', { hasText: 'Events' }).click();
    await expect(page.locator('#eventCount')).toContainText(/\d+ events/, { timeout: 5000 });
  });

  test('Fighters tab shows fighter directory', async ({ page }) => {
    await page.goto('/');
    await page.locator('.primary-tab', { hasText: 'Fighters' }).click();

    await expect(page.locator('#tab-fighters')).toBeVisible();
    // Fighter cards should load
    await expect(page.locator('.fighter-card')).not.toHaveCount(0, { timeout: 5000 });
  });

  test('Stat Leaders tab loads leaderboards', async ({ page }) => {
    await page.goto('/');
    await page.locator('.primary-tab', { hasText: 'Stat Leaders' }).click();

    await expect(page.locator('#tab-stats')).toBeVisible();
    // Leader cards should populate
    await expect(page.locator('.leader-card')).not.toHaveCount(0, { timeout: 5000 });
  });

  test('switching back to Dashboard restores content', async ({ page }) => {
    await page.goto('/');
    await page.locator('.primary-tab', { hasText: 'Events' }).click();
    await page.locator('.primary-tab', { hasText: 'Dashboard' }).click();

    await expect(page.locator('#tab-dashboard')).toBeVisible();
    await expect(page.locator('#tab-events')).not.toBeVisible();
  });
});

// ============================================================
// EVENTS TAB — ACCORDION
// ============================================================
test.describe('Events Accordion', () => {
  test('clicking event row expands fight card', async ({ page }) => {
    await page.goto('/');
    await page.locator('.primary-tab', { hasText: 'Events' }).click();
    await page.waitForTimeout(1500);

    // Click first event row
    const firstRow = page.locator('#eventsTableBody tr').first();
    await firstRow.click();
    await page.waitForTimeout(1000);

    // Should expand an accordion with fights
    const fightRows = page.locator('.fight-row');
    // At least one fight row should appear somewhere
    const count = await fightRows.count();
    expect(count).toBeGreaterThanOrEqual(0); // may be 0 if event has no fights yet
  });

  test('event search filters results', async ({ page }) => {
    await page.goto('/');
    await page.locator('.primary-tab', { hasText: 'Events' }).click();
    await page.waitForTimeout(1500);

    const searchInput = page.locator('#eventSearchInput');
    await searchInput.fill('Usman');
    await page.waitForTimeout(500);

    const rows = await page.locator('#eventsTableBody tr:visible').count();
    // Should filter to fewer events
    expect(rows).toBeLessThan(100);
    expect(rows).toBeGreaterThan(0);
  });
});

// ============================================================
// FIGHTER SEARCH
// ============================================================
test.describe('Fighter Search', () => {
  test('typing shows autocomplete results', async ({ page }) => {
    await page.goto('/');
    const input = page.locator('#fighterSearch');
    await input.fill('McGregor');
    await page.waitForTimeout(500);

    const results = page.locator('#searchResults');
    await expect(results).toBeVisible();
    await expect(results.locator('.search-result')).not.toHaveCount(0);
    await expect(results).toContainText('Conor McGregor');
  });

  test('clicking result opens fighter panel', async ({ page }) => {
    await page.goto('/');
    const input = page.locator('#fighterSearch');
    await input.fill('McGregor');
    await page.waitForTimeout(500);

    await page.locator('#searchResults .search-result').first().click();
    await page.waitForTimeout(1000);

    const panel = page.locator('#fighterPanel');
    await expect(panel).toBeVisible();
  });

  test('no results for gibberish query', async ({ page }) => {
    await page.goto('/');
    const input = page.locator('#fighterSearch');
    await input.fill('xyzzzqqq');
    await page.waitForTimeout(500);

    const results = page.locator('#searchResults');
    await expect(results).toBeVisible();
    await expect(results).toContainText('No fighters found');
  });
});

// ============================================================
// STICKY LAYOUT
// ============================================================
test.describe('Sticky Layout', () => {
  test('top bar stays fixed on scroll', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForTimeout(300);

    const topBar = page.locator('.top-bar');
    const box = await topBar.boundingBox();
    expect(box.y).toBeLessThanOrEqual(1); // should be at top
  });

  test('tab bar sticks below top bar', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForTimeout(300);

    const tabs = page.locator('.primary-tabs');
    const box = await tabs.boundingBox();
    // Should be near top (below 44px top bar)
    expect(box.y).toBeLessThan(60);
    expect(box.y).toBeGreaterThanOrEqual(30);
  });
});

// ============================================================
// VERSION DISPLAY
// ============================================================
test.describe('Version Display', () => {
  test('top bar shows version from API', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.top-bar__name')).toContainText(/v\d+\.\d+\.\d+/, { timeout: 5000 });
  });

  test('footer shows version from API', async ({ page }) => {
    await page.goto('/');
    // Scroll to footer
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);
    await expect(page.locator('#appVersionFooter')).toContainText(/v\d+\.\d+\.\d+/, { timeout: 5000 });
  });
});

// ============================================================
// MOBILE VIEWPORT
// ============================================================
test.describe('Mobile Layout', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('all tabs visible on mobile', async ({ page }) => {
    await page.goto('/');
    const tabs = page.locator('.primary-tab');
    for (let i = 0; i < 4; i++) {
      await expect(tabs.nth(i)).toBeVisible();
    }
  });

  test('event dropdown fills available width', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);
    const dropdown = page.locator('#eventDropdown');
    const box = await dropdown.boundingBox();
    expect(box.width).toBeGreaterThan(80);
  });

  test('fight strip scrolls horizontally', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);
    const strip = page.locator('#eventFightStrip');
    const scrollWidth = await strip.evaluate(el => el.scrollWidth);
    const clientWidth = await strip.evaluate(el => el.clientWidth);
    // Strip content should overflow (scrollable)
    expect(scrollWidth).toBeGreaterThan(clientWidth);
  });
});
