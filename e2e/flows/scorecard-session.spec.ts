import { expect, test, type Page } from '@playwright/test';
import { scorecardSessionHarnessHtml } from '../fixtures/scorecard-session/bundle';
import type { ScorecardSessionQA } from '../fixtures/scorecard-session/mocks';

test.describe('Grille préparée du rendez-vous @critical', () => {
  let html: string;
  test.beforeAll(async () => { html = await scorecardSessionHarnessHtml(); });

  async function open(page: Page, scenario: string) {
    const requests: string[] = [];
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (route.request().isNavigationRequest() && new URL(route.request().url()).pathname === '/scorecard-session') {
        return route.fulfill({ contentType: 'text/html', body: html });
      }
      requests.push(route.request().url());
      return route.abort();
    });
    await page.goto(`/scorecard-session?case=${scenario}`);
    return { requests, errors };
  }

  const first = (page: Page) => page.getByRole('heading', { name: 'Recherche du premier entretien', exact: true });
  const second = (page: Page) => page.getByRole('heading', { name: 'Architecture du deuxième entretien', exact: true });
  const audit = (page: Page) => page.evaluate(() => {
    const qa: ScorecardSessionQA = window.scorecardSessionQA;
    return { calls: qa.calls, reads: qa.reads, manualGenerations: qa.manualGenerations };
  });
  async function isolated(page: Page, result: Awaited<ReturnType<typeof open>>) {
    expect(result.requests).toEqual([]);
    expect(result.errors).toEqual([]);
    expect((await audit(page)).manualGenerations).toBe(0);
  }

  test('Claire — ouvre la grille de cet entretien déjà prête, sans génération', async ({ page }) => {
    const result = await open(page, 'ready');
    await expect(first(page)).toBeVisible();
    await expect(second(page)).toHaveCount(0);
    await expect(page.getByRole('radiogroup', { name: 'Votre note', exact: true })).toBeVisible();
    const state = await audit(page);
    expect(state.calls).toEqual([]);
    expect(state.reads.find(read => read.table === 'candidate_evaluations')?.filters).toEqual({
      candidate_id: 'candidate-fixture', created_by: 'recruiter-fixture', organization_id: 'org-fixture',
      project_id: 'mission-fixture', qualification_session_id: 'session-first',
    });
    await isolated(page, result);
  });

  test('Sophie — attend la préparation puis ouvre les critères, sans saisie prématurée', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const result = await open(page, 'preparing');
    await expect(page.getByRole('status').filter({ hasText: "Préparation de la grille d'entretien…" })).toBeVisible();
    await expect(page.getByRole('radiogroup')).toHaveCount(0);
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Réessayer', exact: true })).toHaveCount(0);
    await page.evaluate(() => { window.scorecardSessionQA.ready = true; });
    await expect(first(page)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('radiogroup', { name: 'Votre note', exact: true })).toBeVisible();
    const calls = (await audit(page)).calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.every(call => call.body.qualificationSessionId === 'session-first' && call.body.retry === undefined)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await isolated(page, result);
  });

  test('Guillaume — un échec reste explicite et ne relance que sur Réessayer', async ({ page }) => {
    const result = await open(page, 'failed');
    await expect(page.getByRole('status').filter({ hasText: 'Préparation interrompue. Réessayez.' })).toBeVisible();
    await expect(page.getByRole('radiogroup')).toHaveCount(0);
    expect((await audit(page)).calls).toHaveLength(1);
    await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
    await expect(first(page)).toBeVisible();
    const state = await audit(page);
    expect(state.calls).toHaveLength(2);
    expect(state.calls[0].body.retry).toBeUndefined();
    expect(state.calls[1].body).toMatchObject({ qualificationSessionId: 'session-first', retry: true });
    await isolated(page, result);
  });

  test('Théo — changer d’entretien ignore la préparation précédente arrivée en retard', async ({ page }) => {
    const result = await open(page, 'switch');
    await expect(page.getByRole('status').filter({ hasText: "Préparation de la grille d'entretien…" })).toBeVisible();
    expect(await page.evaluate(() => window.scorecardSessionQA.latePending)).toBe(true);
    await page.getByRole('button', { name: 'Ouvrir le deuxième entretien', exact: true }).click();
    await expect(second(page)).toBeVisible();
    await page.evaluate(async () => {
      window.scorecardSessionQA.releaseLate();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await expect(second(page)).toBeVisible();
    await expect(first(page)).toHaveCount(0);
    await expect(page.getByRole('status', { name: 'Entretien actif', exact: true })).toHaveText('session-second');
    expect((await audit(page)).calls).toHaveLength(1);
    expect(await page.evaluate(() => window.scorecardSessionQA.lateReleased)).toBe(true);
    await isolated(page, result);
  });

  test('Théo — entretien réattribué : aucune grille ni commande de génération', async ({ page }) => {
    const result = await open(page, 'blocked');
    await expect(page.getByRole('status').filter({ hasText: 'Cet entretien est attribué à un autre recruteur.' })).toBeVisible();
    await expect(page.getByRole('radiogroup')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Réessayer|Générer la grille/ })).toHaveCount(0);
    const state = await audit(page);
    expect(state.calls).toEqual([]);
    expect(state.reads.filter(read => read.table === 'candidate_evaluations')).toEqual([]);
    await isolated(page, result);
  });

  test('Théo — une réponse rattachée à un autre entretien ne devient pas éditable', async ({ page }) => {
    const result = await open(page, 'wrong-session');
    await expect(page.getByRole('status').filter({ hasText: "La grille n'a pas pu être rattachée à cet entretien." })).toBeVisible();
    await expect(second(page)).toHaveCount(0);
    await expect(page.getByRole('radiogroup')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Réessayer', exact: true })).toBeVisible();
    await isolated(page, result);
  });
});
