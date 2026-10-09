import { test, expect, type Page, type Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { loadingHarnessHtml } from '../fixtures/inbox-loading/bundle';
import type { FixtureWindow, Row } from '../fixtures/inbox-loading/types';
import type { CandidateActionPlan } from '../../supabase/functions/_shared/candidate-actions/types';

const require = createRequire(import.meta.url);
const planTitle = 'Répondre à Camille sur ses disponibilités';
const newDraft = (): CandidateActionPlan => ({
  id: 'preparation-plan', scope: { organization_id: 'org-a', candidate_id: 'ACo_fixture_camille', account_id: 'account', chat_id: 'chat-0' },
  contextVersion: 'context-fixture', revision: 1, intent: 'reply', title: planTitle,
  reason: 'Camille a proposé vendredi pour un premier échange.', status: 'draft', createdBy: 'user-a',
  createdAt: '2026-10-09T10:00:00Z', updatedAt: '2026-10-09T10:00:00Z', sources: [],
  effects: [{ id: 'reply', kind: 'message', label: 'Réponse à Camille', targetId: 'candidate-target', audience: 'candidate', channel: 'email', service: 'outlook', recipient: 'camille@example.test', senderAccountId: 'mail-account', senderAddress: 'laurent@example.test', subject: 'Votre disponibilité vendredi', content: 'Bonjour Camille, merci pour votre retour. Vendredi me convient pour échanger. À bientôt, Laurent', status: 'prepared', dedupeKey: 'reply-fixture' }],
});
const gate = () => { let release: () => void = () => {}; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; };

// Transports contrôlés uniquement : aucun modèle, envoi ou compte réel.
test.describe('Préparation des actions — retour immédiat @critical', () => {
  let html: string;
  test.beforeAll(async () => { html = await loadingHarnessHtml(); });

  async function open(page: Page, options: { holdCredits?: boolean; holdGeneration?: boolean; result?: 'draft' | 'empty' | 'dismissed' | 'completed'; failure?: 'http' | 'credits'; light?: boolean } = {}) {
    const calls: Array<{ name: string; body: Row }> = [];
    const errors: string[] = [];
    const credits = gate(), generation = gate(), list = gate(), listFinished = gate();
    let holdList = false, listCount = 0, failing = !!options.failure;
    let plans: CandidateActionPlan[] = [];
    const payload = () => ({ success: true, plans: structuredClone(plans), messages: [], warnings: [], channels: [{ channel: 'email', service: 'outlook', address: 'laurent@example.test' }], generation: { estimated: 3, level: 'balanced', styleSummary: 'Naturel', model: 'fixture-model' } });
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(light => {
      const w = window as FixtureWindow;
      w.qaState = { authReady: true, orgReady: true, accountsReady: true, accountsLoading: false, mappingsReady: true };
      w.qaTables = { profiles: [{ user_id: 'user-a', active_organization_id: 'org-a' }] };
      document.addEventListener('DOMContentLoaded', () => document.documentElement.classList.toggle('light', !!light));
    }, options.light);
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (route.request().isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: html });
      if (!url.pathname.includes('/qa-api/')) return route.abort();
      const body: Row = route.request().postDataJSON() || {};
      const name = url.pathname.split('/').at(-1)!;
      calls.push({ name, body });
      if (name === 'ai-credits') {
        if (options.holdCredits) await credits.promise;
        return route.fulfill({ json: { success: true, has_credits: !(failing && options.failure === 'credits'), estimated_credits: 3, remaining: failing ? 0 : 100 } });
      }
      if (name !== 'candidate-actions') return route.fulfill({ json: { success: true } });
      if (body.action === 'list') {
        listCount++;
        const snapshot = payload();
        if (holdList && listCount > 1) {
          await list.promise;
          await route.fulfill({ json: snapshot });
          listFinished.release();
          return;
        }
        return route.fulfill({ json: snapshot });
      }
      if (body.action === 'restore' && plans[0]?.status === 'dismissed') {
        plans[0].status = 'draft'; plans[0].revision++;
        return route.fulfill({ json: { success: true, plan: structuredClone(plans[0]) } });
      }
      if (body.action === 'generate') {
        if (options.holdGeneration) await generation.promise;
        if (failing && options.failure === 'http') return route.fulfill({ status: 502, json: { success: false, error: 'La préparation est temporairement indisponible. Réessayez.', error_code: 'ACTION_UNAVAILABLE' } });
        const plan = newDraft();
        if (options.result === 'dismissed') plan.status = 'dismissed';
        if (options.result === 'completed') { plan.status = 'completed'; plan.effects[0].status = 'succeeded'; plan.effects[0].result = { completedAt: '2026-10-09T10:00:00Z', referenceId: 'already-sent' }; }
        plans = options.result === 'empty' ? [] : [plan];
        return route.fulfill({ json: payload() });
      }
      return route.fulfill({ status: 400, json: { success: false, error: 'Mutation imprévue dans le test de préparation.' } });
    });
    await page.goto('/actions-preparation-fixture?actions=1');
    const prepare = page.getByRole('button', { name: 'Préparer les prochaines actions', exact: true });
    await expect(prepare).toBeEnabled();
    return { calls, errors, prepare, credits, generation, list, listFinished, holdBackgroundList: () => { holdList = true; }, recover: () => { failing = false; } };
  }
  const count = (api: Awaited<ReturnType<typeof open>>, action: string) => api.calls.filter(call => call.body.action === action).length;
  function noExecution(api: Awaited<ReturnType<typeof open>>) { expect(api.calls.filter(call => ['approve', 'execute_effect', 'send_message', 'save'].includes(String(call.body.action)))).toEqual([]); expect(api.errors).toEqual([]); }
  const pending = (page: Page) => page.getByRole('dialog', { name: 'Préparation des actions', exact: true });
  const review = (page: Page) => page.getByRole('dialog', { name: planTitle, exact: true });
  async function fits(page: Page, dialog: Locator) {
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    const viewport = page.viewportSize()!;
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }

  test('Guillaume — dialogue immédiat avant préautorisation et double clic sans double préparation', async ({ page }) => {
    const api = await open(page, { holdCredits: true });
    await api.prepare.evaluate(button => { if (!(button instanceof HTMLButtonElement)) throw new Error('Bouton de préparation absent'); button.click(); button.click(); });
    await expect(pending(page)).toBeVisible();
    await expect(pending(page).getByText('Analyse du contexte en cours…', { exact: true })).toBeVisible();
    await expect.poll(() => count(api, 'preauth')).toBe(1); expect(count(api, 'generate')).toBe(0);
    await page.addScriptTag({ content: await readFile(require.resolve('axe-core/axe.min.js'), 'utf8') });
    const axe = await page.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } }));
    await test.info().attach('preparation-axe', { body: JSON.stringify(axe), contentType: 'application/json' }); expect(axe.violations).toEqual([]);
    api.credits.release(); await expect(review(page)).toBeVisible();
    expect(count(api, 'preauth')).toBe(1); expect(count(api, 'generate')).toBe(1); noExecution(api);
  });

  test('Guillaume — relecture lente non bloquante et réponse ancienne sans effacement du brouillon', async ({ page }) => {
    const api = await open(page);
    api.holdBackgroundList();
    await page.getByRole('button', { name: 'Détails et réglages', exact: true }).click();
    await page.getByRole('button', { name: 'Actualiser les actions', exact: true }).click();
    await expect.poll(() => count(api, 'list')).toBe(2);
    await expect(api.prepare).toBeEnabled(); await api.prepare.click();
    await expect(review(page)).toBeVisible();
    api.list.release(); await api.listFinished.promise;
    await expect(review(page)).toBeVisible();
    await expect(page.locator(`article[aria-label="${planTitle}"]`)).toBeAttached();
    expect(count(api, 'generate')).toBe(1); noExecution(api);
  });

  test('Claire — préparation sans proposition avec résultat lisible', async ({ page }) => {
    const api = await open(page, { result: 'empty' }); await api.prepare.click();
    await expect(page.getByRole('dialog').getByText('Aucune nouvelle action à proposer', { exact: true })).toBeVisible();
    expect(count(api, 'generate')).toBe(1); noExecution(api);
  });

  for (const failure of ['http', 'credits'] as const) test(`Théo — ${failure} : erreur expliquée, reprise explicite, aucune exécution`, async ({ page }) => {
    const api = await open(page, { failure }); await api.prepare.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('La préparation n’a pas abouti', { exact: true })).toBeVisible();
    await expect(dialog.getByText(failure === 'credits' ? /Crédits IA insuffisants/ : 'La préparation est temporairement indisponible. Réessayez.')).toBeVisible();
    expect(count(api, 'preauth')).toBe(1); expect(count(api, 'generate')).toBe(failure === 'credits' ? 0 : 1); noExecution(api);
    if (failure === 'credits') {
      await dialog.getByRole('button', { name: 'Revenir à la conversation', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Détails et réglages', exact: true })).toBeFocused();
    }
    api.recover();
    await (failure === 'credits' ? page : dialog).getByRole('button', { name: 'Réessayer la préparation', exact: true }).click();
    await expect(review(page)).toBeVisible();
    expect(count(api, 'preauth')).toBe(2); expect(count(api, 'generate')).toBe(failure === 'credits' ? 1 : 2); noExecution(api);
  });

  test('Claire — proposition déjà ignorée : retour visible et restauration explicite', async ({ page }) => {
    const api = await open(page, { result: 'dismissed' }); await api.prepare.click();
    const dialog = page.getByRole('dialog', { name: 'Une proposition a déjà été ignorée', exact: true });
    await expect(dialog).toBeVisible(); expect(count(api, 'restore')).toBe(0); noExecution(api);
    await dialog.getByRole('button', { name: 'Revoir la suggestion', exact: true }).click();
    await expect(review(page)).toBeVisible(); expect(count(api, 'restore')).toBe(1); expect(count(api, 'generate')).toBe(1); noExecution(api);
  });

  test('Claire — proposition terminée : résultat accessible sans rejouer les envois', async ({ page }) => {
    const api = await open(page, { result: 'completed' }); await api.prepare.click();
    const dialog = page.getByRole('dialog', { name: 'Les actions sont déjà terminées', exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Voir le résultat', exact: true }).click();
    await expect(review(page).getByText('Ces effets sont enregistrés dans le journal.', { exact: true })).toBeVisible();
    await expect(page.locator('[data-component=guided-action-review]')).toHaveCount(0);
    expect(count(api, 'generate')).toBe(1); noExecution(api);
  });

  for (const width of [320, 390]) test(`Sophie — dialogue ${width}px puis relecture sans débordement`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    const api = await open(page, { holdGeneration: true, light: width === 320 }); await api.prepare.click();
    await expect(pending(page)).toBeVisible(); await fits(page, pending(page));
    await expect(pending(page).getByRole('button', { name: 'Continuer dans la conversation', exact: true })).toBeInViewport();
    api.generation.release(); await expect(review(page)).toBeVisible(); await fits(page, review(page));
    await test.info().attach(`preparation-${width}`, { body: await page.screenshot(), contentType: 'image/png' }); noExecution(api);
  });

  test('Sophie — fermeture pendant la préparation sans popup tardive', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const api = await open(page, { holdGeneration: true }); await api.prepare.click();
    await pending(page).getByRole('button', { name: 'Continuer dans la conversation', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Détails et réglages', exact: true })).toBeFocused();
    api.generation.release(); await expect(page.getByRole('article', { name: planTitle, exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0); expect(count(api, 'generate')).toBe(1); noExecution(api);
  });
});
