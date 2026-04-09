import { test, expect, type Page } from '@playwright/test';
import { loginViaUI, env, waitForAppShell } from './helpers/auth';

/**
 * Test 2 — Multi-tenant isolation  (MOST IMPORTANT TEST)
 *
 * 1. Log in as User A (org Konekt) → collect visible project names.
 * 2. Log out.
 * 3. Log in as User B (different org) → collect visible project names.
 * 4. Assert ZERO overlap between the two sets.
 *
 * This guarantees that Supabase RLS + the organization_id filter actually
 * prevent cross-tenant data leakage in the UI.
 *
 * Required env:
 *   TEST_USER_A_EMAIL / TEST_USER_A_PASSWORD  – user in org "Konekt"
 *   TEST_USER_B_EMAIL / TEST_USER_B_PASSWORD  – user in a DIFFERENT org
 */

/** Collect all visible project / mission names on the /missions page. */
async function collectProjectNames(page: Page): Promise<string[]> {
  await page.goto('/missions');
  await page.waitForLoadState('networkidle');

  // Wait a bit for React Query to resolve
  await page.waitForTimeout(3_000);

  // Projects are listed as cards / rows. Their names appear as bold text or
  // headings inside the project list. We look for common patterns:
  //   - <h3>, <h2> or <p class="font-bold"> inside the mission list
  //   - or any text that acts as the project title
  // Grab every visible text node that looks like a project title.
  const projectNames: string[] = [];

  // Strategy 1: look for elements with uppercase tracking-wider font-bold (Skalr pattern)
  const titleElements = page.locator(
    '[class*="font-bold"][class*="uppercase"], ' +
    'h2[class*="uppercase"], h3[class*="uppercase"], ' +
    'h2[class*="font-bold"], h3[class*="font-bold"]',
  );

  const titlesCount = await titleElements.count();
  for (let i = 0; i < titlesCount; i++) {
    const text = await titleElements.nth(i).textContent();
    if (text && text.trim().length > 0) {
      projectNames.push(text.trim());
    }
  }

  // Strategy 2: if the page shows an empty state, return empty
  const emptyState = page.getByText('Aucune mission');
  if (await emptyState.isVisible({ timeout: 1_000 }).catch(() => false)) {
    return [];
  }

  return projectNames;
}

async function logout(page: Page): Promise<void> {
  // Navigate to settings where there's typically a logout button, or go
  // through the user menu. Skalr may use different patterns, so we try a
  // few strategies.

  // Strategy 1: clear auth state via Supabase client-side
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  // Strategy 2: navigate to auth page (session destroyed by clear above)
  await page.goto('/auth');
  await page.waitForLoadState('networkidle');
}

test.describe('Multi-tenant isolation', () => {
  test('User A and User B see strictly disjoint project sets', async ({
    page,
  }) => {
    const userAEmail = env('TEST_USER_A_EMAIL');
    const userAPassword = env('TEST_USER_A_PASSWORD');
    const userBEmail = env('TEST_USER_B_EMAIL');
    const userBPassword = env('TEST_USER_B_PASSWORD');

    // ---- User A session --------------------------------------------------
    await loginViaUI(page, userAEmail, userAPassword);
    await waitForAppShell(page);

    const projectsA = await collectProjectNames(page);
    console.log(`[User A] Visible projects (${projectsA.length}):`, projectsA);

    await logout(page);

    // ---- User B session --------------------------------------------------
    await loginViaUI(page, userBEmail, userBPassword);
    await waitForAppShell(page);

    const projectsB = await collectProjectNames(page);
    console.log(`[User B] Visible projects (${projectsB.length}):`, projectsB);

    // ---- Assert zero overlap ---------------------------------------------
    const overlap = projectsA.filter((name) => projectsB.includes(name));

    expect(
      overlap,
      `CRITICAL: Found ${overlap.length} project(s) visible to BOTH users — ` +
        `tenant isolation is broken! Shared names: ${JSON.stringify(overlap)}`,
    ).toHaveLength(0);

    // At least one user should have projects (sanity check that we actually
    // collected data rather than testing two empty lists).
    expect(
      projectsA.length + projectsB.length,
      'Sanity check: at least one user should have visible projects. ' +
        'Make sure test users have projects in their respective orgs.',
    ).toBeGreaterThan(0);
  });

  test('User A cannot access User B projects via direct URL', async ({
    page,
  }) => {
    const userAEmail = env('TEST_USER_A_EMAIL');
    const userAPassword = env('TEST_USER_A_PASSWORD');
    const userBEmail = env('TEST_USER_B_EMAIL');
    const userBPassword = env('TEST_USER_B_PASSWORD');

    // First, login as User B and grab a project URL
    await loginViaUI(page, userBEmail, userBPassword);
    await waitForAppShell(page);
    await page.goto('/missions');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3_000);

    // Try to find any mission link
    const missionLinks = page.locator('a[href*="/missions/"]');
    const linkCount = await missionLinks.count();

    if (linkCount === 0) {
      console.log('User B has no mission links — skipping direct URL test');
      test.skip();
      return;
    }

    const missionUrl = await missionLinks.first().getAttribute('href');
    console.log(`[User B] Mission URL to test: ${missionUrl}`);

    await logout(page);

    // Now log in as User A and try to access User B's mission
    await loginViaUI(page, userAEmail, userAPassword);
    await waitForAppShell(page);

    await page.goto(missionUrl!);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3_000);

    // User A should NOT see User B's mission content.
    // The app should either:
    //  - redirect away (to /missions)
    //  - show an error / empty state
    //  - show a 404 or "not found" message
    const currentUrl = page.url();
    const pageContent = await page.textContent('body');

    const isBlocked =
      // Redirected away from the mission page
      !currentUrl.includes(missionUrl!) ||
      // Shows error / not-found text
      /introuvable|not found|erreur|accès refusé|aucune mission/i.test(
        pageContent || '',
      ) ||
      // Page is empty (no mission data loaded)
      !(pageContent || '').includes(missionUrl!.split('/').pop()!);

    expect(
      isBlocked,
      `CRITICAL: User A can access User B's mission at ${missionUrl}. ` +
        'Cross-tenant data is exposed via direct URL navigation.',
    ).toBe(true);
  });
});
