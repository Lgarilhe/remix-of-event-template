import { test, expect } from '@playwright/test';
import { env, supabaseRestGet, SUPABASE_URL, SUPABASE_ANON_KEY } from './helpers/auth';

/**
 * Test 3 — Client portal
 *
 * 3a. Open /client/{valid_token}  → portal data renders (client name visible).
 * 3b. Open /client/token_bidon    → "Lien invalide ou expiré" shown (404 state).
 * 3c. Call Supabase REST API on sourcing_projects WITHOUT auth →
 *     verify that no rows are returned (RLS blocks anonymous access).
 *     Exception: hunt_mode projects may be visible (by design).
 *
 * Required env:
 *   TEST_CLIENT_PORTAL_TOKEN  – a valid client-portal token
 *   SUPABASE_URL              – Supabase project URL
 *   SUPABASE_ANON_KEY         – Supabase anon/publishable key
 */

test.describe('Client portal', () => {
  test('3a — valid token shows portal data', async ({ page }) => {
    const token = env('TEST_CLIENT_PORTAL_TOKEN');

    await page.goto(`/client/${token}`);
    await page.waitForLoadState('networkidle');

    // The portal header shows "Bienvenue, {client_name}" — wait for it
    const welcomeText = page.getByText(/Bienvenue,/);
    await expect(welcomeText).toBeVisible({ timeout: 15_000 });

    // The page should show at least the org name or "Portail client" header
    const header = page.locator('header h1');
    await expect(header).toBeVisible();

    // Footer branding
    await expect(page.getByText('Portail propulsé par Skalr')).toBeVisible();

    // Should show mission count and candidate count in the header bar
    const statsArea = page.locator('header');
    const statsText = await statsArea.textContent();
    expect(statsText).toMatch(/mission|candidat/i);
  });

  test('3b — invalid token shows 404 / expired state', async ({ page }) => {
    await page.goto('/client/token_bidon_invalide_12345');
    await page.waitForLoadState('networkidle');

    // The ClientPortal component shows "Lien invalide ou expiré" when notFound
    const errorMsg = page.getByText('Lien invalide ou expiré');
    await expect(errorMsg).toBeVisible({ timeout: 10_000 });

    // Should also show the lock emoji
    await expect(page.getByText('🔒')).toBeVisible();

    // Should show the contact-recruiter message
    await expect(
      page.getByText(/Contactez votre recruteur/),
    ).toBeVisible();

    // Should NOT show the portal header with Bienvenue
    await expect(page.getByText(/Bienvenue,/)).not.toBeVisible();
  });

  test('3c — anonymous Supabase REST call returns no sourcing_projects', async () => {
    // Direct API call to Supabase REST endpoint for sourcing_projects
    // Using only the anon key (no user session) — RLS should block everything
    // except potentially hunt_mode=true projects.

    const response = await supabaseRestGet(
      'sourcing_projects',
      'select=id,name,organization_id,hunt_mode',
    );

    expect(response.ok).toBe(true); // Supabase returns 200 even with empty results

    const data = await response.json();

    // Filter out hunt_mode projects (those are intentionally public)
    const nonHuntProjects = Array.isArray(data)
      ? data.filter((row: any) => !row.hunt_mode)
      : [];

    expect(
      nonHuntProjects.length,
      `CRITICAL: Anonymous API call returned ${nonHuntProjects.length} non-hunt ` +
        `sourcing_projects. RLS policies are not blocking anonymous access! ` +
        `Leaked project IDs: ${nonHuntProjects.map((p: any) => p.id).join(', ')}`,
    ).toBe(0);
  });

  test('3c-bis — anonymous REST call cannot read organization_members', async () => {
    // Double-check that the org membership table is also locked down
    const response = await supabaseRestGet(
      'organization_members',
      'select=id,organization_id,user_id,role',
    );

    const data = await response.json();
    const rows = Array.isArray(data) ? data : [];

    expect(
      rows.length,
      `CRITICAL: Anonymous API returned ${rows.length} organization_members rows. ` +
        'This table should be fully protected by RLS.',
    ).toBe(0);
  });

  test('3c-ter — anonymous REST call cannot read profiles', async () => {
    const response = await supabaseRestGet(
      'profiles',
      'select=id,email,full_name',
    );

    const data = await response.json();
    const rows = Array.isArray(data) ? data : [];

    expect(
      rows.length,
      `CRITICAL: Anonymous API returned ${rows.length} profiles rows. ` +
        'User profiles should be fully protected by RLS.',
    ).toBe(0);
  });
});
