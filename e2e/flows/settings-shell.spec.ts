/**
 * Paramètres, lots 2 et 3 — coquille à deux portes (ordinateur).
 *
 * Vérifie : page d'arrivée et navigation par porte, anciennes adresses ?tab=
 * redirigées sans double message de paiement ni retour sur ?tab=, navigation
 * jamais remontée, Équipe fermée à un indépendant, « gérés par » pour un
 * membre, carte de l'extension masquée sans jeton sauf demande explicite.
 *
 * Les trois premiers tests portent @smoke : ils tournent sur les PR.
 * Le téléphone est couvert par e2e/mobile.spec.ts.
 */
import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import { addMember, signIn } from '../helpers/supabase-admin';
import { E2E, authStorageKey } from '../helpers/env';

const NAV = 'Rubriques des paramètres';
const settingsNav = (page: Page) => page.getByRole('navigation', { name: NAV });

/** Un message affiché une seule fois : un lecteur monté deux fois en afficherait un second juste après. */
async function expectShownOnce(page: Page, text: string) {
  const message = page.getByText(text, { exact: true });
  await expect(message.first()).toBeVisible();
  await page.waitForTimeout(1_000);
  await expect(message).toHaveCount(1);
}

test('@smoke /settings mène à Connexions, avec les deux portes et 7 rubriques', async ({ asRole }) => {
  const page = await asRole('agencyOwner');
  await page.goto('/settings');

  await expect(page).toHaveURL(/\/settings\/account\/connections$/);
  const nav = settingsNav(page);
  await expect(nav.getByRole('heading', { name: 'Mon compte', exact: true })).toBeVisible();
  await expect(nav.getByRole('heading', { name: 'Mon organisation', exact: true })).toBeVisible();
  await expect(nav.getByRole('link')).toHaveCount(7);
  await expect(nav.getByRole('link', { name: 'Connexions', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('@smoke anciens retours de paiement : bonne rubrique, un seul message, adresse nettoyée', async ({ asRole }) => {
  const page = await asRole('agencyOwner');

  await page.goto('/settings?tab=credits&checkout=cancel&kind=pack');
  await expectShownOnce(page, 'Achat annulé.');
  // setSearchParams retire aussi le hash : on ne le teste pas.
  await expect(page).toHaveURL(/\/settings\/org\/billing(?:#[a-z-]*)?$/);
  expect(page.url()).not.toMatch(/checkout=|kind=|[?&]tab=/);

  // Retour d'abonnement ouvert avant le lot 1, sans kind : la redirection le déduit de l'onglet.
  await page.goto('/settings?tab=billing&checkout=cancel');
  await expectShownOnce(page, 'Paiement annulé, votre plan reste inchangé.');
  await expect(page).toHaveURL(/\/settings\/org\/billing(?:#[a-z-]*)?$/);
  expect(page.url()).not.toMatch(/checkout=|kind=|[?&]tab=/);
});

test('@smoke le bouton Retour ne revient jamais sur ?tab=', async ({ asRole }) => {
  const page = await asRole('agencyOwner');
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto('/settings?tab=billing');
  await expect(page).toHaveURL(/\/settings\/org\/billing$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('la navigation n’est pas remontée quand on change de rubrique', async ({ asRole }) => {
  const page = await asRole('agencyOwner');
  await page.goto('/settings/account/connections');
  const nav = settingsNav(page);
  await expect(nav).toBeVisible();
  await nav.evaluate((el) => el.setAttribute('data-e2e-marker', 'monte-une-fois'));

  await nav.getByRole('link', { name: 'Équipe', exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/org\/team$/);
  await expect(page.getByRole('heading', { level: 2, name: 'Équipe', exact: true })).toBeFocused();
  await expect(page.locator(`nav[aria-label="${NAV}"][data-e2e-marker="monte-une-fois"]`)).toHaveCount(1);
});

test('indépendant : pas de rubrique Équipe, et une phrase à la place', async ({ asRole }) => {
  const page = await asRole('freelance');
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/settings\/account\/connections$/);
  const nav = settingsNav(page);
  await expect(nav.getByRole('link')).toHaveCount(6);
  await expect(nav.getByRole('link', { name: 'Équipe', exact: true })).toHaveCount(0);

  await page.goto('/settings/org/team');
  await expect(page).toHaveURL(/\/settings\/org\/team$/);
  const notice = page.getByRole('note');
  await expect(notice.getByText('Équipe n’est proposée qu’aux organisations Entreprise et Cabinet.')).toBeVisible();
  await expect(notice.getByRole('link', { name: 'Général', exact: true })).toHaveAttribute('href', '/settings/org/general');
});

test('membre : trois rubriques, et les réglages de l’organisation « gérés par »', async ({ org, browser }) => {
  const member = await addMember(org.orgId, 'member');
  org.addExtraUser(member);
  // Session posée comme dans global.setup.ts.
  const session = await signIn(member.email, member.password);
  const origin = new URL(E2E.baseUrl).origin;
  const context = await browser.newContext({
    storageState: {
      cookies: [],
      origins: [{ origin, localStorage: [{ name: authStorageKey(), value: JSON.stringify(session) }] }],
    },
  });
  try {
    const page = await context.newPage();
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/settings\/account\/connections$/);

    // display_name posé par le déclencheur d'inscription : la partie locale de l'e-mail.
    const expected = `Les réglages de l’organisation sont gérés par ${org.owner.email.split('@')[0]}.`;
    const nav = settingsNav(page);
    await expect(nav.getByRole('link')).toHaveCount(3);
    const orgGroup = nav.locator('section').filter({ has: page.getByRole('heading', { name: 'Mon organisation' }) });
    await expect(orgGroup.getByText(expected, { exact: true })).toBeVisible();
    await expect(orgGroup.getByRole('link')).toHaveCount(0);

    await page.goto('/settings/org/billing');
    await expect(page).toHaveURL(/\/settings\/org\/billing$/);
    const notice = page.getByRole('note');
    await expect(notice.getByText(expected, { exact: true })).toBeVisible();
    await expect(notice.getByText('Seul un administrateur peut ajouter des crédits ou changer de formule.', { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});

test('extension : carte masquée sans jeton, révélée par #extension ou l’ancien ?tab=account', async ({ asRole }) => {
  const page = await asRole('agencyOwner');
  await page.route('**/functions/v1/extension-token', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, tokens: [] }),
    });
  });
  const title = page.getByRole('heading', { name: 'Extension Chrome Konekt' });
  const sectionTitle = page.getByRole('heading', { level: 2, name: 'Connexions', exact: true });

  // Sans jeton actif : rien, même une fois la liste reçue.
  let listed = page.waitForResponse('**/functions/v1/extension-token');
  await page.goto('/settings/account/connections');
  await listed;
  await expect(sectionTitle).toBeVisible();
  await expect(title).toHaveCount(0);

  // Ancienne adresse de l'extension installée.
  await page.goto('/settings?tab=account');
  await expect(page).toHaveURL(/\/settings\/account\/connections$/);
  await expect(title).toBeVisible();

  // Mémo consommé : une nouvelle visite ne la révèle plus. (goto et non reload :
  // un rechargement garderait l'état de navigation revealExtension de l'entrée.)
  listed = page.waitForResponse('**/functions/v1/extension-token');
  await page.goto('/settings/account/connections');
  await listed;
  await expect(sectionTitle).toBeVisible();
  await expect(title).toHaveCount(0);

  // Lien du front vers la carte. Détour par une autre page : un goto qui ne change
  // que le hash reste dans le même document et ne remonte pas la rubrique.
  await page.goto('/dashboard');
  await page.goto('/settings/account/connections#extension');
  await expect(title).toBeVisible();
});
