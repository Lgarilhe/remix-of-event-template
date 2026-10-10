import { expect, test, type Locator, type Page } from '@playwright/test';
import { calendarDemoHarnessHtml } from '../fixtures/calendar-demo/bundle';

interface PreviewWindow extends Window {
  calendarQA: { microphone: number; windows: number; recordings: number };
  calendarLiveReads: number;
  calendarWindows: Array<{ url: string; target?: string; features?: string }>;
}

// Composants de production, routes réseau fermées. Aucune identité, aucun
// envoi d'invitation, crédit IA, microphone ou fournisseur de visioconférence.
test.describe('Agenda — aperçu des entretiens et accès réels @critical', () => {
  let html: string;
  test.beforeAll(async () => { html = await calendarDemoHarnessHtml(); });

  async function open(page: Page, path = '/calendar?demo=1') {
    const requests: string[] = [];
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const w = window as PreviewWindow;
      w.calendarQA = { microphone: 0, windows: 0, recordings: 0 };
      w.calendarLiveReads = 0;
      w.calendarWindows = [];
      const blockMicrophone = async () => { w.calendarQA.microphone++; throw new Error('Microphone interdit dans cet aperçu'); };
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: blockMicrophone, getDisplayMedia: blockMicrophone } });
      window.open = (url, target, features) => { w.calendarQA.windows++; w.calendarWindows.push({ url: String(url), target, features }); return null; };
      Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: class { constructor() { w.calendarQA.recordings++; throw new Error('Enregistrement interdit dans cet aperçu'); } } });
    });
    await page.route('**/*', route => {
      if (route.request().isNavigationRequest() && new URL(route.request().url()).pathname === path.split('?')[0]) {
        return route.fulfill({ contentType: 'text/html', body: html });
      }
      requests.push(route.request().url());
      return route.abort();
    });
    await page.goto(path);
    return { requests, errors };
  }

  async function isolated(page: Page, audit: Awaited<ReturnType<typeof open>>, windows = 0) {
    expect(audit.requests).toEqual([]);
    expect(audit.errors).toEqual([]);
    expect(await page.evaluate(() => (window as PreviewWindow).calendarQA)).toEqual({ microphone: 0, windows, recordings: 0 });
  }

  const card = (page: Page, name: string) => page.getByRole('article', { name: `Entretien avec ${name}`, exact: true });
  const sidebarCard = (page: Page, name: string) => page.getByRole('listitem', { name: `Entretien fictif avec ${name}`, exact: true });
  const camilleDialog = (page: Page) => page.getByRole('dialog', { name: 'Camille Durand', exact: true });

  test('Claire — deux rendez-vous et leurs services, rejoindre reste dans l’aperçu', async ({ page }) => {
    const audit = await open(page);
    const camille = card(page, 'Camille Durand');
    const alex = card(page, 'Alex Martin');
    await expect(camille).toBeVisible();
    await expect(alex).toBeVisible();
    await expect(camille.getByText('Outlook', { exact: true })).toBeVisible();
    await expect(camille.getByText('Microsoft Teams', { exact: true })).toBeVisible();
    await expect(alex.getByText('Google Agenda', { exact: true })).toBeVisible();
    await expect(alex.getByText('Google Meet', { exact: true })).toBeVisible();
    await camille.getByRole('button', { name: 'Rejoindre la visio', exact: true }).click();
    await expect(camilleDialog(page).getByRole('heading', { name: 'Aperçu Microsoft Teams', exact: true })).toBeVisible();
    await expect(camilleDialog(page).getByRole('tab', { name: 'Visio', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(camilleDialog(page).getByText('Aucune réunion ouverte. Caméra et micro désactivés.', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as PreviewWindow).calendarLiveReads)).toBe(0);
    await isolated(page, audit);
  });

  test('Guillaume — notes et grille conservées après fermeture, isolées par candidat', async ({ page }) => {
    const audit = await open(page);
    await card(page, 'Camille Durand').getByRole('button', { name: "Grille d'entretien", exact: true }).click();
    const dialog = camilleDialog(page);
    await dialog.getByRole('radiogroup', { name: 'Note : Recherche utilisateur', exact: true }).getByRole('radio', { name: '4 sur 5', exact: true }).click();
    await page.keyboard.press('ArrowRight');
    await expect(dialog.getByRole('radiogroup', { name: 'Note : Recherche utilisateur', exact: true }).getByRole('radio', { name: '5 sur 5', exact: true })).toBeChecked();
    await page.keyboard.press('ArrowLeft');
    await dialog.getByLabel('Commentaire : Recherche utilisateur', { exact: true }).fill('A expliqué les retours des huit utilisateurs.');
    await dialog.getByLabel('Notes de l’entretien', { exact: true }).fill('Revoir ensemble la mesure des abandons.');
    await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect(card(page, 'Camille Durand').getByRole('button', { name: "Grille d'entretien", exact: true })).toBeFocused();
    await card(page, 'Alex Martin').getByRole('button', { name: "Grille d'entretien", exact: true }).click();
    const alex = page.getByRole('dialog', { name: 'Alex Martin', exact: true });
    await expect(alex.getByLabel('Notes de l’entretien', { exact: true })).toHaveValue('');
    await expect(alex.getByRole('radio', { checked: true })).toHaveCount(0);
    await alex.getByLabel('Notes de l’entretien', { exact: true }).fill('Clarifier le montant du contrat.');
    await page.keyboard.press('Escape');
    await expect(card(page, 'Alex Martin').getByRole('button', { name: "Grille d'entretien", exact: true })).toBeFocused();
    await card(page, 'Camille Durand').getByRole('button', { name: "Grille d'entretien", exact: true }).click();
    await expect(dialog.getByRole('radiogroup', { name: 'Note : Recherche utilisateur', exact: true }).getByRole('radio', { name: '4 sur 5', exact: true })).toBeChecked();
    await expect(dialog.getByLabel('Commentaire : Recherche utilisateur', { exact: true })).toHaveValue('A expliqué les retours des huit utilisateurs.');
    await expect(dialog.getByLabel('Notes de l’entretien', { exact: true })).toHaveValue('Revoir ensemble la mesure des abandons.');
    await expect(dialog.getByRole('status')).toHaveText('1/3 critères notés · Moyenne 4/5');
    await isolated(page, audit);
  });

  test('Guillaume — simulation explicite, transcription, compte rendu puis retour à la grille', async ({ page }) => {
    const audit = await open(page);
    await card(page, 'Camille Durand').getByRole('button', { name: "Assistant d'entretien", exact: true }).click();
    const dialog = camilleDialog(page);
    await expect(dialog.getByRole('region', { name: 'Transcription fictive', exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Lancer la simulation', exact: true }).click();
    await expect(dialog.getByRole('region', { name: 'Transcription fictive', exact: true })).toContainText('Les abandons ont baissé de 18 %');
    await expect(dialog.getByRole('region', { name: 'Conseil fictif de l’assistant', exact: true })).toContainText('sur quelle période');
    await dialog.getByRole('button', { name: 'Voir le compte rendu', exact: true }).click();
    await expect(dialog.getByRole('region', { name: 'Compte rendu fictif', exact: true })).toContainText('Exemple pré-écrit');
    await dialog.getByRole('button', { name: 'Compléter ma grille', exact: true }).click();
    await expect(dialog.getByRole('tab', { name: 'Grille', exact: true })).toHaveAttribute('aria-selected', 'true');
    await isolated(page, audit);
  });

  test('Sophie — cartes et dialogue utilisables à 320 px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    const audit = await open(page);
    await expect(card(page, 'Camille Durand')).toBeVisible();
    await fits(page);
    await card(page, 'Camille Durand').getByRole('button', { name: "Grille d'entretien", exact: true }).click();
    const dialog = camilleDialog(page);
    await fits(page, dialog);
    await dialog.getByLabel('Notes de l’entretien', { exact: true }).fill('Note sur mobile.');
    await expect(dialog.getByLabel('Notes de l’entretien', { exact: true })).toHaveValue('Note sur mobile.');
    await dialog.getByRole('tab', { name: 'Assistant', exact: true }).click();
    await dialog.getByRole('button', { name: 'Lancer la simulation', exact: true }).click();
    await dialog.getByRole('button', { name: 'Voir le compte rendu', exact: true }).click();
    await fits(page, dialog);
    await test.info().attach('agenda-demo-mobile-320', { body: await page.screenshot(), contentType: 'image/png' });
    await isolated(page, audit);
  });

  test('Claire — quitter l’aperçu retrouve l’agenda et efface les essais', async ({ page }) => {
    const audit = await open(page);
    await expect(card(page, 'Camille Durand')).toBeVisible();
    expect(await page.evaluate(() => (window as PreviewWindow).calendarLiveReads)).toBe(0);
    await card(page, 'Camille Durand').getByRole('button', { name: "Grille d'entretien", exact: true }).click();
    await camilleDialog(page).getByLabel('Notes de l’entretien', { exact: true }).fill('Cet essai doit rester temporaire.');
    await camilleDialog(page).getByRole('button', { name: 'Fermer', exact: true }).click();
    await page.getByRole('button', { name: 'Quitter la démo', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Agenda', exact: true })).toBeVisible();
    await expect(page.getByRole('article', { name: 'Entretien avec Camille Durand', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => (window as PreviewWindow).calendarLiveReads)).toBeGreaterThan(0);
    await page.getByRole('link', { name: 'Voir un exemple', exact: true }).click();
    await card(page, 'Camille Durand').getByRole('button', { name: "Grille d'entretien", exact: true }).click();
    await expect(camilleDialog(page).getByLabel('Notes de l’entretien', { exact: true })).toHaveValue('');
    await isolated(page, audit);
  });

  test('Claire — les exemples s’ouvrent depuis la barre latérale sans quitter la messagerie', async ({ page }) => {
    const audit = await open(page, '/inbox');
    await expect(page.getByRole('heading', { name: 'Événements à venir', exact: true })).toBeVisible();
    await expect(sidebarCard(page, 'Camille Durand')).toHaveCount(0);
    await page.getByRole('button', { name: 'Voir un exemple', exact: true }).click();
    const camille = sidebarCard(page, 'Camille Durand');
    const alex = sidebarCard(page, 'Alex Martin');
    await expect(camille).toBeVisible();
    await expect(alex).toBeVisible();
    await expect(camille.getByText('Outlook', { exact: true })).toBeVisible();
    await expect(camille.getByText('Microsoft Teams', { exact: true })).toBeVisible();
    await expect(alex.getByText('Google Agenda', { exact: true })).toBeVisible();
    await expect(alex.getByText('Google Meet', { exact: true })).toBeVisible();
    await camille.getByRole('button', { name: 'Rejoindre la visio', exact: true }).click();
    await expect(camilleDialog(page).getByRole('heading', { name: 'Aperçu Microsoft Teams', exact: true })).toBeVisible();
    await camilleDialog(page).getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect(camille.getByRole('button', { name: 'Rejoindre la visio', exact: true })).toBeFocused();
    await expect(page.getByRole('status', { name: 'Page active' })).toHaveText('/inbox');
    await isolated(page, audit);
  });

  test('Guillaume — les essais de la barre latérale suivent la navigation puis sont effacés à l’arrêt', async ({ page }) => {
    const audit = await open(page, '/inbox');
    await page.getByRole('button', { name: 'Voir un exemple', exact: true }).click();
    await sidebarCard(page, 'Camille Durand').getByRole('button', { name: "Grille d'entretien", exact: true }).click();
    await camilleDialog(page).getByLabel('Notes de l’entretien', { exact: true }).fill('Suivi conservé entre les pages.');
    await camilleDialog(page).getByRole('button', { name: 'Fermer', exact: true }).click();
    await page.getByRole('navigation', { name: 'Navigation de l’aperçu' }).getByRole('link', { name: 'Pipeline', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Page active' })).toHaveText('/pipeline');
    await sidebarCard(page, 'Alex Martin').getByRole('button', { name: "Grille d'entretien", exact: true }).click();
    const alex = page.getByRole('dialog', { name: 'Alex Martin', exact: true });
    await expect(alex.getByLabel('Notes de l’entretien', { exact: true })).toHaveValue('');
    await alex.getByLabel('Notes de l’entretien', { exact: true }).fill('Uniquement Alex.');
    await alex.getByRole('button', { name: 'Fermer', exact: true }).click();
    await sidebarCard(page, 'Camille Durand').getByRole('button', { name: "Grille d'entretien", exact: true }).click();
    await expect(camilleDialog(page).getByLabel('Notes de l’entretien', { exact: true })).toHaveValue('Suivi conservé entre les pages.');
    await camilleDialog(page).getByRole('button', { name: 'Fermer', exact: true }).click();
    await page.getByRole('button', { name: 'Quitter les exemples', exact: true }).click();
    await expect(sidebarCard(page, 'Camille Durand')).toHaveCount(0);
    await expect(page.getByRole('status', { name: 'Page active' })).toHaveText('/pipeline');
    await page.getByRole('button', { name: 'Voir un exemple', exact: true }).click();
    await sidebarCard(page, 'Camille Durand').getByRole('button', { name: "Grille d'entretien", exact: true }).click();
    await expect(camilleDialog(page).getByLabel('Notes de l’entretien', { exact: true })).toHaveValue('');
    await isolated(page, audit);
  });

  test('Sophie — à 320 px le dialogue survit à la fermeture du tiroir et rend la page utilisable', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    const audit = await open(page, '/inbox');
    const trigger = page.getByRole('button', { name: 'Afficher ou masquer la navigation', exact: true });
    await trigger.click();
    const drawer = page.getByRole('dialog', { name: 'Barre latérale', exact: true });
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: 'Voir un exemple', exact: true }).click();
    await fits(page);
    await sidebarCard(page, 'Camille Durand').getByRole('button', { name: "Grille d'entretien", exact: true }).click();
    const dialog = camilleDialog(page);
    await expect(dialog).toBeVisible();
    await expect(drawer).toBeHidden();
    await fits(page, dialog);
    await dialog.getByLabel('Notes de l’entretien', { exact: true }).fill('Essai depuis le tiroir mobile.');
    await expect(dialog.getByLabel('Notes de l’entretien', { exact: true })).toBeFocused();
    await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect.poll(() => page.evaluate(() => document.body.style.pointerEvents)).not.toBe('none');
    await expect(page.locator('body')).not.toHaveAttribute('data-scroll-locked');
    await page.getByRole('button', { name: 'Action de la page (0)', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Action de la page (1)', exact: true })).toBeVisible();
    await trigger.click();
    await sidebarCard(page, 'Camille Durand').getByRole('button', { name: "Assistant d'entretien", exact: true }).click();
    await expect(drawer).toBeHidden();
    await dialog.getByRole('button', { name: 'Lancer la simulation', exact: true }).click();
    await dialog.getByRole('button', { name: 'Voir le compte rendu', exact: true }).click();
    await expect(dialog.getByRole('region', { name: 'Compte rendu fictif', exact: true })).toBeVisible();
    await dialog.getByRole('tab', { name: 'Grille', exact: true }).click();
    await expect(dialog.getByLabel('Notes de l’entretien', { exact: true })).toHaveValue('Essai depuis le tiroir mobile.');
    await fits(page, dialog);
    await test.info().attach('sidebar-interview-mobile-320', { body: await page.screenshot(), contentType: 'image/png' });
    await isolated(page, audit);
  });

  test('Claire — les rendez-vous enregistrés restent disponibles à côté des exemples', async ({ page }) => {
    const audit = await open(page, '/inbox?upcoming=1');
    const native = page.getByRole('link', { name: /Samira Legrand/ });
    await expect(native).toBeVisible();
    await page.getByRole('button', { name: 'Voir un exemple', exact: true }).click();
    await expect(sidebarCard(page, 'Camille Durand')).toBeVisible();
    await expect(native).toBeVisible();
    const section = page.locator('[data-sidebar-section="upcoming-events"]');
    await section.getByRole('button', { name: 'Rejoindre la visio', exact: true }).click();
    expect(await page.evaluate(() => (window as PreviewWindow).calendarWindows)).toEqual([
      { url: 'https://meet.google.com/real-fixture', target: '_blank', features: 'noopener,noreferrer' },
    ]);
    await page.getByRole('button', { name: 'Quitter les exemples', exact: true }).click();
    await expect(native).toBeVisible();
    await expect(sidebarCard(page, 'Camille Durand')).toHaveCount(0);
    await isolated(page, audit, 1);
  });

  async function fits(page: Page, dialog?: Locator) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (!dialog) return;
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    const viewport = page.viewportSize()!;
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
  }

  for (const action of ["Grille d'entretien", "Assistant d'entretien"]) {
    test(`Claire — ${action} conserve la mission et la session du rendez-vous`, async ({ page }) => {
      const audit = await open(page, '/native-event');
      const sheet = page.getByRole('dialog', { name: 'Entretien de Camille', exact: true });
      await expect(sheet).toBeVisible();
      await expect(sheet.getByRole('button', { name: 'Rejoindre la visio', exact: true })).toBeVisible();
      await sheet.getByRole('button', { name: action, exact: true }).click();
      const destination = page.getByRole('status', { name: 'Destination' });
      await expect(destination).toHaveText('/pipeline/scorecard/candidate%2Ffixture?mission=mission%2Ffixture&session=session-fixture' + (action === "Assistant d'entretien" ? '&coaching=1' : ''));
      await expect(sheet).toHaveCount(0);
      await isolated(page, audit);
    });
  }

  test('Claire — rejoindre un rendez-vous réel utilise son lien sans activer le micro', async ({ page }) => {
    const audit = await open(page, '/native-event');
    const sheet = page.getByRole('dialog', { name: 'Entretien de Camille', exact: true });
    await sheet.getByRole('button', { name: 'Rejoindre la visio', exact: true }).click();
    expect(await page.evaluate(() => (window as PreviewWindow).calendarWindows)).toEqual([
      { url: 'https://meet.google.com/fixture-preview', target: '_blank', features: 'noopener,noreferrer' },
    ]);
    await expect(sheet).toBeVisible();
    await isolated(page, audit, 1);
  });
});
