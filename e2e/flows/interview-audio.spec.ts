import { expect, test, type Locator, type Page } from '@playwright/test';
import { interviewAudioHarnessHtml } from '../fixtures/interview-audio/bundle';
import type { AudioQA } from '../fixtures/interview-audio/mocks';

type Browser = 'chromium' | 'safari' | 'mobile';
type Capture = 'meeting' | 'mic';
interface OpenOptions { meeting?: string; browser?: Browser; saved?: Capture; guideDismissed?: boolean; workspace?: boolean }
const userAgents: Record<Browser, string> = {
  chromium: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
  safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  mobile: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};

test.describe('Entretien — réglages audio contextualisés @critical', () => {
  let html: string;
  test.beforeAll(async () => { html = await interviewAudioHarnessHtml(); });

  async function open(page: Page, options: OpenOptions = {}) {
    const requests: string[] = [];
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ ua, browser, saved, guideDismissed }) => {
      window.interviewAudioQA = { accesses: [], microphone: 0, display: 0, recordings: 0, sockets: 0 };
      const qa = window.interviewAudioQA;
      Object.defineProperty(navigator, 'userAgent', { configurable: true, value: ua });
      Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: { brands: browser === 'chromium' ? [{ brand: 'Chromium' }] : [], mobile: browser === 'mobile' } });
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
        // Refus simulé : aucun microphone ou partage réel, même lors du test du bouton Démarrer.
        getUserMedia: async () => { qa.microphone++; throw new DOMException('Refus simulé', 'NotAllowedError'); },
        getDisplayMedia: async () => { qa.display++; throw new DOMException('Refus simulé', 'NotAllowedError'); },
        enumerateDevices: async () => [],
      } });
      Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: class { constructor() { qa.recordings++; throw new Error('Enregistrement réel interdit'); } } });
      Object.defineProperty(window, 'WebSocket', { configurable: true, value: class { constructor() { qa.sockets++; throw new Error('Transcription réelle interdite'); } } });
      localStorage.removeItem('konekt.live-capture-mode');
      if (saved) localStorage.setItem('konekt.live-capture-mode', saved);
      sessionStorage.removeItem('audio-guide-dismissed');
      if (guideDismissed) sessionStorage.setItem('audio-guide-dismissed', '1');
    }, { ua: userAgents[options.browser ?? 'chromium'], browser: options.browser ?? 'chromium', saved: options.saved, guideDismissed: options.guideDismissed });
    await page.route('**/*', route => {
      if (route.request().isNavigationRequest() && new URL(route.request().url()).pathname === '/audio-fixture') {
        return route.fulfill({ contentType: 'text/html', body: html });
      }
      requests.push(route.request().url());
      return route.abort();
    });
    await page.goto(`/audio-fixture?meeting=${options.meeting ?? 'teams'}${options.workspace ? '&workspace=1' : ''}`);
    await expect(panel(page)).toBeVisible();
    return { requests, errors };
  }

  const panel = (page: Page) => page.getByRole('region', { name: "Assistant d'entretien", exact: true });
  const mode = (page: Page, value: Capture) => panel(page).getByRole('radiogroup', { name: "Source de l'audio", exact: true })
    .getByRole('radio', { name: value === 'meeting' ? /Visio ou appel/ : /Sur place/ });
  const start = (page: Page) => panel(page).getByRole('button', { name: "Démarrer l'enregistrement", exact: true });
  const preference = (page: Page) => page.evaluate(() => localStorage.getItem('konekt.live-capture-mode'));

  async function isolated(page: Page, audit: Awaited<ReturnType<typeof open>>, expected: Partial<AudioQA> = {}) {
    expect(audit.requests).toEqual([]);
    expect(audit.errors).toEqual([]);
    expect(await page.evaluate(() => window.interviewAudioQA)).toEqual({
      accesses: [], microphone: 0, display: 0, recordings: 0, sockets: 0, ...expected,
    });
  }

  for (const [meeting, label] of [['teams', 'Microsoft Teams'], ['meet', 'Google Meet'], ['zoom', 'Zoom']]) {
    test(`Claire — ${label} propose le bon partage, sans démarrer ni facturer`, async ({ page }) => {
      const audit = await open(page, { meeting, guideDismissed: true });
      await expect(panel(page).getByText(label, { exact: true })).toBeVisible();
      await expect(panel(page).getByText(/partagez son onglet en cochant/)).toBeVisible();
      await expect(mode(page, 'meeting')).toBeChecked();
      await expect(panel(page).getByRole('button', { name: 'Réglages audio détaillés', exact: true })).toHaveAttribute('aria-expanded', 'false');
      await expect(start(page)).toBeEnabled();
      expect(await preference(page)).toBeNull();
      if (meeting !== 'meet') {
        await panel(page).getByText('Application installée', { exact: true }).click();
        await expect(panel(page).getByText(/écran entier uniquement si le navigateur propose/)).toBeVisible();
      }
      if (meeting === 'teams') await test.info().attach('assistant-teams-desktop', { body: await panel(page).screenshot(), contentType: 'image/png' });
      await isolated(page, audit);
    });
  }

  for (const [meeting, expected] of [['phone', /Sur téléphone, activez le haut-parleur/], ['onsite', /Le micro seul convient/]] as const) {
    test(`Claire — ${meeting === 'phone' ? 'téléphone' : 'présentiel'} prépare le micro seul`, async ({ page }) => {
      const audit = await open(page, { meeting });
      await expect(panel(page).getByText(expected)).toBeVisible();
      await expect(mode(page, 'mic')).toBeChecked();
      expect(await preference(page)).toBeNull();
      await isolated(page, audit);
    });
  }

  test('Guillaume — un choix personnel reste conservé, la recommandation est applicable sans enregistrement', async ({ page }) => {
    const audit = await open(page, { meeting: 'teams', saved: 'mic' });
    await expect(mode(page, 'mic')).toBeChecked();
    const apply = panel(page).getByRole('button', { name: 'Utiliser le micro et l’audio partagé', exact: true });
    await expect(apply).toBeVisible();
    expect(await preference(page)).toBe('mic');
    await apply.click();
    await expect(mode(page, 'meeting')).toBeChecked();
    expect(await preference(page)).toBe('meeting');
    await panel(page).getByRole('button', { name: "Fermer l'assistant d'entretien", exact: true }).click();
    await page.getByRole('button', { name: 'Rouvrir l’assistant', exact: true }).click();
    await expect(mode(page, 'meeting')).toBeChecked();
    await page.getByLabel('Rendez-vous du harnais', { exact: true }).selectOption('phone');
    await expect(mode(page, 'meeting')).toBeChecked();
    await panel(page).getByRole('button', { name: 'Utiliser le micro seul', exact: true }).click();
    await expect(mode(page, 'mic')).toBeChecked();
    expect(await preference(page)).toBe('mic');
    await isolated(page, audit);
  });

  test('Théo — lieu inconnu conserve le guide générique sans deviner de service', async ({ page }) => {
    const audit = await open(page, { meeting: 'unknown' });
    await expect(panel(page).getByRole('radiogroup', { name: 'Votre situation', exact: true })).toBeVisible();
    await expect(mode(page, 'meeting')).toBeChecked();
    await expect(panel(page).getByText('Microsoft Teams', { exact: true })).toHaveCount(0);
    await expect(panel(page).getByRole('button', { name: 'Réglages audio détaillés', exact: true })).toHaveCount(0);
    expect(await preference(page)).toBeNull();
    await isolated(page, audit);
  });

  test('Théo — Safari propose le micro sans écraser la préférence visio', async ({ page }) => {
    const audit = await open(page, { browser: 'safari', meeting: 'zoom', saved: 'meeting' });
    await expect(mode(page, 'meeting')).toBeDisabled();
    await expect(mode(page, 'mic')).toBeChecked();
    await expect(panel(page).getByText(/Ici, seul le micro est disponible/)).toBeVisible();
    expect(await preference(page)).toBe('meeting');
    await isolated(page, audit);
  });

  for (const width of [320, 390]) {
    test(`Sophie — réglages mobiles lisibles à ${width} px, micro prêt sans permission`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      const audit = await open(page, { browser: 'mobile', meeting: 'meet' });
      await expect(mode(page, 'meeting')).toBeDisabled();
      await expect(mode(page, 'mic')).toBeChecked();
      await expect(start(page)).toBeInViewport();
      const box = await start(page).boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      await fits(page, panel(page));
      await panel(page).getByRole('button', { name: 'Réglages audio détaillés', exact: true }).click();
      await expect(panel(page).getByRole('radiogroup', { name: 'Votre situation', exact: true })).toBeVisible();
      await fits(page, panel(page));
      await expect(start(page)).toBeInViewport();
      await panel(page).getByRole('button', { name: 'Masquer le guide audio', exact: true }).click();
      await test.info().attach(`assistant-meet-mobile-${width}`, { body: await page.screenshot(), contentType: 'image/png' });
      await isolated(page, audit);
    });
  }

  test('Théo — seul Démarrer demande le partage, un refus ne crée ni séance ni crédit', async ({ page }) => {
    const audit = await open(page);
    await isolated(page, audit);
    await start(page).click();
    await expect(page.getByText('Partage annulé', { exact: true })).toBeVisible();
    await expect(start(page)).toBeEnabled();
    await isolated(page, audit, { display: 1 });
  });

  for (const width of [320, 1440]) {
    test(`Guillaume et Sophie — grille et assistant réels prêts ensemble à ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const audit = await open(page, { meeting: 'teams', browser: width === 320 ? 'mobile' : 'chromium', workspace: true });
      const criterion = page.getByRole('article', { name: 'Recherche utilisateur', exact: true });
      await expect(page.getByRole('region', { name: 'Synthèse de la grille', exact: true })).toBeVisible();
      await expect(start(page)).toBeInViewport();
      const assistantBox = await panel(page).boundingBox();
      const criterionBox = await criterion.boundingBox();
      expect(assistantBox).not.toBeNull();
      expect(criterionBox).not.toBeNull();
      if (width === 320) expect(assistantBox!.y).toBeLessThan(criterionBox!.y);
      else expect(assistantBox!.x).toBeGreaterThan(criterionBox!.x);
      await fits(page, panel(page));
      await test.info().attach(`grille-assistant-pret-${width}`, { body: await page.screenshot(), contentType: 'image/png' });
      await criterion.getByRole('radio', { name: 'Noter 4 sur 5', exact: true }).click();
      await expect(criterion.getByRole('radio', { name: 'Noter 4 sur 5', exact: true })).toBeChecked();
      await isolated(page, audit);
    });
  }

  test('Théo — le refus du micro reste explicite et ne démarre aucune analyse', async ({ page }) => {
    const audit = await open(page, { meeting: 'phone' });
    await start(page).click();
    await expect(page.getByText('Accès au microphone refusé', { exact: true })).toBeVisible();
    await expect(start(page)).toBeEnabled();
    // Le navigateur est retenté avec les contraintes minimales, puis s'arrête.
    await isolated(page, audit, { microphone: 2 });
  });
});

async function fits(page: Page, element: Locator) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  const box = await element.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  expect(await element.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
}
