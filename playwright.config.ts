import { defineConfig, devices } from '@playwright/test';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config as loadDotenv } from 'dotenv';

// Load .env from project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
loadDotenv({ path: resolve(__dirname, '.env') });

/**
 * E2E Playwright configuration for Skalr.
 *
 * Required env vars (set in .env or CI):
 *   BASE_URL                – staging / prod URL (e.g. https://staging.skalr.app)
 *   SUPABASE_URL            – Supabase project URL
 *   SUPABASE_ANON_KEY       – Supabase anon/publishable key
 *
 * Test-user credentials (per-test, see tests/e2e/helpers/):
 *   TEST_USER_A_EMAIL / TEST_USER_A_PASSWORD  – org "Konekt"
 *   TEST_USER_B_EMAIL / TEST_USER_B_PASSWORD  – different org
 *   TEST_SIGNUP_EMAIL  / TEST_SIGNUP_PASSWORD  – disposable signup address
 *   TEST_CLIENT_PORTAL_TOKEN                   – valid client-portal token
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'html',
  timeout: 60_000,

  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:8080',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
