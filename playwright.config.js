// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: 1,
  workers: 1, // sequential — single server instance
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3737',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    // Enable the picks feature + an admin key so E2E can exercise both.
    // Use `env` (cross-platform) instead of shell-style `set`/prefix.
    command: 'node server.js',
    env: {
      PORT: '3737',
      NODE_ENV: 'test',
      BETTER_AUTH_SECRET: 'test-better-auth-secret',
      ENABLE_PICKS: 'true',
      ADMIN_KEY: 'test-admin-key',
      PREDICTION_SERVICE_KEY: 'test-prediction-key',
      // Relax rate limits for test traffic (many profiles created in quick succession)
      PICKS_RATE_LIMIT_CREATE_USER: '200',
      PICKS_RATE_LIMIT_PER_MIN: '600'
    },
    port: 3737,
    timeout: 15_000,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
