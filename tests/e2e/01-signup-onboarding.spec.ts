import { test, expect } from '@playwright/test';
import { signupViaUI, env } from './helpers/auth';

/**
 * Test 1 — Inscription + onboarding
 *
 * 1. Create a new account via the /auth signup form.
 * 2. Choose "agency" as org type during onboarding.
 * 3. Walk through every onboarding step.
 * 4. Verify arrival on /dashboard after finishing.
 *
 * Required env:
 *   TEST_SIGNUP_EMAIL    – a disposable email (must not already exist)
 *   TEST_SIGNUP_PASSWORD – password for the new account (min 6 chars)
 */

test.describe('Signup + onboarding flow', () => {
  test('create account, complete agency onboarding, land on dashboard', async ({
    page,
  }) => {
    const email = env('TEST_SIGNUP_EMAIL');
    const password = env('TEST_SIGNUP_PASSWORD');

    // ---- Step 1: Sign up ------------------------------------------------
    await signupViaUI(page, email, password);

    // After signup the user is redirected to /onboarding (or /missions then
    // OrganizationGuard redirects to /onboarding since no org exists yet).
    await page.waitForURL((url) => url.pathname.startsWith('/onboarding'), {
      timeout: 20_000,
    });
    await expect(page).toHaveURL(/\/onboarding/);

    // ---- Step 2: Pick org type = "agency" --------------------------------
    // SceneOrgType shows three cards. The agency card text is
    // "Je suis un cabinet de recrutement".
    await page.getByText('Je suis un cabinet de recrutement').click();

    // ---- Step 3: Org details ---------------------------------------------
    // SceneOrgDetails – pick a team size then click "Suivant"
    await expect(page.getByText('Votre équipe recrutement')).toBeVisible();

    // Select the first team-size option available
    await page.getByText('2 – 5 personnes').click();
    await page.getByRole('button', { name: 'Suivant' }).click();

    // ---- Step 4: Discovery -----------------------------------------------
    // SceneDiscovery – pick any discovery source
    await page.waitForTimeout(500); // transition animation
    const discoveryOption = page.locator('[role="button"], button').filter({
      hasNotText: /Retour|Suivant/,
    });
    // Click the first selectable option (e.g. "LinkedIn", "Google", etc.)
    const discoveryItems = page.locator('button, [role="option"], [data-value]').filter({
      hasNotText: /Retour|Suivant|Rechercher/,
    });
    const count = await discoveryItems.count();
    if (count > 0) {
      await discoveryItems.first().click();
    }
    // Try clicking Suivant if present, otherwise the option auto-advances
    const nextBtn = page.getByRole('button', { name: 'Suivant' });
    if (await nextBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await nextBtn.click();
    }

    // ---- Step 5: Specializations -----------------------------------------
    await page.waitForTimeout(500);
    // Pick at least one specialization if checkboxes/buttons are shown
    const specItems = page.locator(
      'button:not([disabled]), [role="checkbox"], [role="option"]',
    ).filter({ hasNotText: /Retour|Suivant/ });
    const specCount = await specItems.count();
    if (specCount > 0) {
      await specItems.first().click();
    }
    const nextBtnSpec = page.getByRole('button', { name: 'Suivant' });
    if (await nextBtnSpec.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await nextBtnSpec.click();
    }

    // ---- Step 6: Organization (company name) -----------------------------
    await page.waitForTimeout(500);
    const companyInput = page.getByPlaceholder('Le nom de votre société...');
    if (await companyInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await companyInput.fill('Agence Test E2E');
      const searchBtn = page.getByRole('button', { name: 'Rechercher' });
      if (await searchBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await searchBtn.click();
        // Wait for enrichment or skip after timeout
        await page.waitForTimeout(3_000);
      }
      // Continue to next step
      const continueBtn = page.locator('button').filter({ hasText: /Suivant|Continuer|Passer/ });
      if (await continueBtn.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
        await continueBtn.first().click();
      }
    }

    // ---- Step 7: Audit ---------------------------------------------------
    await page.waitForTimeout(500);
    const auditNext = page.getByRole('button', { name: 'Suivant' });
    if (await auditNext.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await auditNext.click();
    }

    // ---- Step 8: Profile -------------------------------------------------
    await page.waitForTimeout(500);
    const profileNext = page.getByRole('button', { name: 'Suivant' });
    if (await profileNext.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await profileNext.click();
    }

    // ---- Step 9: Integrations --------------------------------------------
    await page.waitForTimeout(500);
    const integrationsNext = page.locator('button').filter({ hasText: /Suivant|Passer/ });
    if (await integrationsNext.first().isVisible({ timeout: 3_000 }).catch(() => false)) {
      await integrationsNext.first().click();
    }

    // ---- Step 10: Team ---------------------------------------------------
    await page.waitForTimeout(500);
    const teamSkip = page.locator('button').filter({ hasText: /Suivant|Passer|Continuer/ });
    if (await teamSkip.first().isVisible({ timeout: 3_000 }).catch(() => false)) {
      await teamSkip.first().click();
    }

    // ---- Step 11: Launch -------------------------------------------------
    await page.waitForTimeout(500);
    const launchBtn = page.getByRole('button', { name: 'Lancer Skalr' });
    await expect(launchBtn).toBeVisible({ timeout: 10_000 });
    await launchBtn.click();

    // ---- Verify: we land on /dashboard -----------------------------------
    await page.waitForURL((url) => url.pathname.startsWith('/dashboard'), {
      timeout: 15_000,
    });
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
