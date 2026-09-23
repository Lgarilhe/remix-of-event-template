/**
 * Barre latérale à onglets (lots 5 et 6) : onglets, premiers pas, second clic,
 * assistant, panne des notifications, messagerie, cibles au téléphone.
 *
 * Les tests de bureau tournent sur une organisation jetable (fixture org) :
 * l'organisation agencyOwner est partagée et reçoit des missions d'autres
 * specs en parallèle.
 *
 * @smoke
 */
import { randomUUID } from 'node:crypto';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { storageStateFor } from '../helpers/registry';
import { signIn, type TestOrg } from '../helpers/supabase-admin';
import { E2E, authStorageKey } from '../helpers/env';

const todoTab = (page: Page) => page.getByRole('tab', { name: /^À traiter/ });
/** Panneau de l'onglet actif (AppSidebar) : le tableau de bord a ses propres boutons homonymes. */
const sidebarPanel = (page: Page) => page.locator('#sidebar-panel');

/**
 * Contexte du propriétaire d'une organisation jetable, session posée comme
 * dans global.setup.ts. `hideFirstSteps` pose, avant tout chargement, la clé
 * FIRST_STEPS_HIDDEN_KEY de src/lib/firstSteps.ts.
 */
async function ownerContext(browser: Browser, org: TestOrg, opts: { hideFirstSteps?: boolean } = {}): Promise<BrowserContext> {
  const session = await signIn(org.owner.email, org.owner.password);
  const origin = new URL(E2E.baseUrl).origin;
  const context = await browser.newContext({
    storageState: {
      cookies: [],
      origins: [{ origin, localStorage: [{ name: authStorageKey(), value: JSON.stringify(session) }] }],
    },
  });
  if (opts.hideFirstSteps) {
    const key = `konekt:nav:first-steps-hidden:${org.orgId}:${org.owner.userId}`;
    await context.addInitScript((k) => {
      try {
        window.localStorage.setItem(k, '1');
      } catch {
        // Document sans stockage (about:blank) : rien à poser.
      }
    }, key);
  }
  return context;
}

/** Notifications en panne : Réponses de candidats et Pour vous en erreur. */
const failNotifications = (page: Page) =>
  page.route('**/rest/v1/notifications*', (route) => route.fulfill({ status: 500, body: '{}' }));

test.describe('@smoke Barre latérale à onglets', () => {
  test('onglets, premiers pas, Missions et Assistant', async ({ org, browser }) => {
    const context = await ownerContext(browser, org);
    try {
      const page = await context.newPage();
      const panel = sidebarPanel(page);
      await page.goto('/dashboard');
      await expect(page).not.toHaveURL(/\/auth/);

      // 1. Trois onglets, À traiter sélectionné ; ni cloche ni bulle.
      await expect(todoTab(page)).toBeVisible();
      await expect(todoTab(page)).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('tab', { name: 'Missions' })).toBeVisible();
      await expect(page.getByRole('tab', { name: /^Assistant/ })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Notifications' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Ouvrir l\'agent IA' })).toHaveCount(0);

      // 2. Premiers pas d'une organisation neuve : l'étape à faire est un lien
      // (une étape faite garde son libellé, mais n'est plus un lien).
      await expect(panel.getByRole('heading', { name: 'Premiers pas', exact: true })).toBeVisible();
      await expect(panel.getByRole('link', { name: 'Créer une première mission' })).toHaveAttribute(
        'href',
        '/missions?create=brief',
      );

      // 3. Missions : « Nouvelle mission », puis un second clic ouvre la page.
      const missionsTab = page.getByRole('tab', { name: 'Missions' });
      await missionsTab.click();
      await expect(missionsTab).toHaveAttribute('aria-selected', 'true');
      await expect(panel.getByRole('button', { name: 'Nouvelle mission' })).toBeVisible();
      await missionsTab.click();
      await expect(page).toHaveURL(/\/missions$/);

      // 4. Assistant : « Nouvelle conversation » ouvre le tiroir.
      await page.getByRole('tab', { name: /^Assistant/ }).click();
      await panel.getByRole('button', { name: 'Nouvelle conversation' }).click();
      await expect(page.getByRole('dialog', { name: 'Assistant IA' })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('notifications en panne : pas de « rien à traiter », messagerie accessible', async ({ org, browser }) => {
    const context = await ownerContext(browser, org, { hideFirstSteps: true });
    try {
      const page = await context.newPage();
      const panel = sidebarPanel(page);

      // 5. Contrôle : organisation neuve, Premiers pas masqués, tout chargé et vide.
      await page.goto('/dashboard');
      await expect(page).not.toHaveURL(/\/auth/);
      await expect(panel.getByText('Rien à traiter pour le moment.')).toBeVisible();

      // 6. Panne : Réponses et Pour vous proposent chacune « Réessayer » ; la
      // phrase disparaît, la ligne de la messagerie reste.
      await failNotifications(page);
      await page.reload();
      await expect(panel.getByRole('button', { name: 'Réessayer' })).toHaveCount(2);
      await expect(panel.getByText('Rien à traiter pour le moment.')).toHaveCount(0);
      const inboxLink = panel.getByRole('link', { name: 'Ouvrir la messagerie' });
      await expect(inboxLink).toBeVisible();

      // 7. La ligne mène à la messagerie.
      await inboxLink.click();
      await expect(page).toHaveURL(/\/inbox/);
    } finally {
      await context.close();
    }
  });

  test('notifications en panne : aucun chiffre inventé sur À traiter', async ({ org, browser }) => {
    const context = await ownerContext(browser, org, { hideFirstSteps: true });
    try {
      const page = await context.newPage();
      const panel = sidebarPanel(page);

      // Un plan de recherche proposé, au format lu par useAgentSignals : il
      // compte 1 dans le chiffre d'À traiter.
      const plan = {
        id: randomUUID(),
        title: 'Plan e2e',
        job_title: null,
        project_id: null,
        status: 'plan_proposed',
        updated_at: new Date().toISOString(),
        created_by: org.owner.userId,
        organization_id: org.orgId,
        archived_at: null,
      };
      await page.route('**/rest/v1/agent_conversations*', async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        // .single() demande un objet, sinon PostgREST répond un tableau.
        const single = (route.request().headers()['accept'] ?? '').includes('application/vnd.pgrst.object+json');
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(single ? plan : [plan]),
        });
      });

      // 8. Contrôle : sans panne, le plan est compté.
      await page.goto('/dashboard');
      await expect(page).not.toHaveURL(/\/auth/);
      await expect(panel.getByRole('button', { name: 'Retirer ce plan' })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'À traiter, 1 élément', exact: true })).toBeVisible();

      // 9. Panne : le plan est toujours là, mais le chiffre est inconnu.
      // Attendre les deux erreurs et le plan d'abord : le nom vaut aussi
      // « À traiter » pendant le chargement.
      await failNotifications(page);
      await page.reload();
      await expect(panel.getByRole('button', { name: 'Réessayer' })).toHaveCount(2);
      await expect(panel.getByRole('button', { name: 'Retirer ce plan' })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'À traiter', exact: true })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  // 10. Téléphone. Le projet mobile-safari ne joue que mobile.spec.ts, et asRole
  // ouvre un contexte de bureau : le contexte est donc créé ici, à la taille
  // d'un iPhone 13 (390 × 844, tactile), sur le navigateur du projet.
  test('téléphone : cibles d\'au moins 44 px dans la feuille', async ({ browser, browserName }) => {
    test.skip(browserName === 'firefox', 'isMobile non pris en charge');
    const context = await browser.newContext({
      storageState: storageStateFor('agencyOwner'),
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    try {
      const page = await context.newPage();
      await page.goto('/dashboard');
      await expect(page).not.toHaveURL(/\/auth/);

      await page.getByRole('button', { name: 'Toggle Sidebar' }).click();

      const targets = [
        page.getByRole('tab', { name: 'Missions' }),
        page.getByRole('link', { name: 'Ouvrir la messagerie' }),
        page.getByRole('link', { name: 'Paramètres', exact: true }),
      ];
      for (const target of targets) {
        await expect(target).toBeVisible();
        const box = await target.boundingBox();
        expect(box, 'cible mesurable').not.toBeNull();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
    } finally {
      await context.close();
    }
  });
});
