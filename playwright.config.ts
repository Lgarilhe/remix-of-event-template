import { defineConfig, devices } from '@playwright/test';

/**
 * Konekt e2e — config multi-projets.
 *
 * Cibles (toutes via env, JAMAIS la prod en dur) :
 *   E2E_BASE_URL                  URL du front à tester (def: http://localhost:8080)
 *   E2E_SUPABASE_URL              URL Supabase de TEST (staging ou `supabase start` local)
 *   E2E_SUPABASE_ANON_KEY         clé anon de test
 *   E2E_SUPABASE_SERVICE_ROLE_KEY service-role de test (seed/téardown, admin createUser)
 *   E2E_SUPABASE_PROJECT_REF      ref projet (clé localStorage `sb-<ref>-auth-token`)
 *
 * Garde-fou : globalSetup REFUSE de tourner si E2E_SUPABASE_URL pointe vers la
 * prod (crckfywoyjxkawathdff). Voir e2e/helpers/guard-prod.ts.
 */

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 8080);
const baseURL = process.env.E2E_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

// Suite live (tags @live) : tape les vrais vendors. Exclue du CI bloquant.
const RUN_LIVE = process.env.E2E_RUN_LIVE === '1';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }], ['blob'], ['github']]
    : [['list'], ['html', { open: 'never' }]],
  // Exclut la suite live sauf demande explicite (E2E_RUN_LIVE=1).
  grepInvert: RUN_LIVE ? undefined : /@live/,
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    // 1. Auth + seed de référence → produit les storageState par rôle.
    { name: 'setup', testMatch: /global\.setup\.ts/ },

    // 2. UI desktop (par défaut, dépend du setup).
    {
      name: 'chromium-desktop',
      testIgnore: [/global\.setup\.ts/, /e2e\/api\//],
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },

    // 3. Mobile (persona Sophie) — uniquement les specs taguées @mobile.
    {
      name: 'mobile-safari',
      testMatch: /mobile\.spec\.ts/,
      use: { ...devices['iPhone 13'] },
      dependencies: ['setup'],
    },

    // 4. API directe sur les edge functions / RLS — pas de navigateur.
    {
      name: 'api',
      testMatch: /e2e\/api\/.*\.spec\.ts/,
      use: { baseURL },
      dependencies: ['setup'],
    },
  ],
  webServer: process.env.E2E_BASE_URL || process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `npm run dev -- --port ${PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
