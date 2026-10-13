import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { sourcingReturnHarnessHtml } from '../fixtures/sourcing-return/bundle';
import type { FixtureWindow } from '../fixtures/sourcing-return/types';

test.use({ baseURL: 'http://fixture.local' });
const originalBrief = { title: 'Développeur React', location: 'Lyon', skills_must_have: ['React'], experience_min: 3 };
const project = { id: 'mission-a', name: 'Mission React', kind: 'mission', status: 'active', organization_id: 'org-a',
  created_by: 'user-a', updated_at: '2026-10-13T09:00:00Z', job_details: originalBrief, filters_snapshot: {} };
type Call = { name: string; body: { message?: string; history?: Array<{ role: string; content: string }>; action?: string } };
let html: string;
let releasePending: (() => void) | undefined;
test.beforeAll(async () => { html = await sourcingReturnHarnessHtml('guided.tsx'); });
test.afterEach(() => { releasePending?.(); releasePending = undefined; });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function open(page: Page, hold: 'ai-credits' | 'sourcing-interview') {
  const calls: Call[] = [], errors: string[] = [], aborted: string[] = [], external: string[] = [];
  const pending = deferred(), lateDone = deferred();
  let held = false;
  releasePending = pending.resolve;
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => {
    if (request.url().includes('/qa-api/')) aborted.push(new URL(request.url()).pathname.split('/').at(-1)!);
  });
  await page.addInitScript(({ project }) => {
    const w = window as FixtureWindow;
    w.qaProjects = { 'mission-a': project as FixtureWindow['qaProjects'][string] };
    w.qaState = { organizationId: 'org-a', userId: 'user-a', memoryReady: true, accountIds: [], accountsReady: true, baseEnabled: true, basePlanAllows: true };
  }, { project });
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.isNavigationRequest() && url.origin === 'http://fixture.local') return route.fulfill({ contentType: 'text/html', body: html });
    if (url.origin === 'http://fixture.local' && /^\/konekt-(?:mark|logo)(?:-white)?\.png$/.test(url.pathname)) {
      return route.fulfill({ contentType: 'image/png', body: await readFile(new URL('../../public' + url.pathname, import.meta.url)) });
    }
    if (!url.pathname.startsWith('/qa-api/')) {
      if (!['image', 'font'].includes(request.resourceType())) external.push(url.origin);
      return route.abort();
    }
    const name = url.pathname.split('/').at(-1)!;
    const body = request.postDataJSON() as Call['body'];
    calls.push({ name, body });
    const isHeld = name === hold && !held;
    if (isHeld) { held = true; await pending.promise; }
    const data = name === 'ai-credits' ? { success: true, has_credits: true, estimated_credits: 1, remaining: 1000 }
      : name === 'sourcing-interview' ? { success: true, reply: isHeld ? 'Réponse tardive à ignorer.' : 'Paris est retenu.', patch: { location: isHeld ? 'Marseille' : 'Paris' } }
      : { success: true };
    try { await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) }); }
    catch (failure) { if (!isHeld) throw failure; }
    finally { if (isHeld) lateDone.resolve(); }
  });
  await page.goto('/guided-sourcing-fixture?mission=1');
  await page.getByRole('button', { name: 'Préparer la recherche', exact: true }).click();
  return { calls, errors, aborted, external, release: pending.resolve, lateDone: lateDone.promise,
    held: () => held, briefWrites: () => page.evaluate(() => (window as FixtureWindow).qaWrites.filter(write => write.job_details !== undefined)) };
}
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Assistant · Sourcing', exact: true });
const composer = (page: Page) => dialog(page).getByRole('textbox', { name: 'Message à l’assistant', exact: true });
const confirm = (page: Page) => dialog(page).getByRole('button', { name: 'Valider et chercher', exact: true });

test.describe('Annulation du sourcing guidé @critical', () => {
  for (const phase of ['ai-credits', 'sourcing-interview'] as const) {
    test(`Arrêter pendant ${phase} : réponse restaurée, retour tardif ignoré et nouvel échange possible`, async ({ page }) => {
      const audit = await open(page, phase);
      const cancelledAnswer = 'Déplacez la recherche à Marseille.';
      await composer(page).fill(cancelledAnswer);
      await dialog(page).getByRole('button', { name: 'Envoyer', exact: true }).click();
      await expect.poll(audit.held).toBe(true);
      await expect(confirm(page)).toBeDisabled();
      await dialog(page).getByRole('button', { name: 'Arrêter', exact: true }).click();
      await expect(composer(page)).toHaveValue(cancelledAnswer);
      await expect(dialog(page).getByRole('button', { name: 'Envoyer', exact: true })).toBeEnabled();
      await expect(confirm(page)).toBeDisabled();
      audit.release();
      await audit.lateDone;
      await expect.poll(() => audit.aborted).toContain(phase);
      await expect(dialog(page).getByRole('alert')).toHaveCount(0);
      await expect(dialog(page).getByText('Réponse tardive à ignorer.', { exact: true })).toHaveCount(0);
      await dialog(page).getByRole('button', { name: 'Cadrage', exact: true }).click();
      await expect(dialog(page).getByRole('textbox', { name: 'Lieu et télétravail', exact: true })).toHaveValue('Lyon');
      expect(await audit.briefWrites()).toEqual([]);
      if (phase === 'ai-credits') expect(audit.calls.filter(call => call.name === 'sourcing-interview')).toHaveLength(0);
      await dialog(page).getByRole('button', { name: 'Revenir à la conversation', exact: true }).click();
      await composer(page).fill('Retenez Paris.');
      await dialog(page).getByRole('button', { name: 'Envoyer', exact: true }).click();
      await expect(dialog(page).getByText('Paris est retenu.', { exact: true })).toBeVisible();
      const retry = audit.calls.filter(call => call.name === 'sourcing-interview').at(-1)!;
      expect(retry.body.message).toBe('Retenez Paris.');
      expect(retry.body.history?.some(message => message.content === cancelledAnswer)).toBe(false);
      await dialog(page).getByRole('button', { name: 'Cadrage', exact: true }).click();
      await expect(dialog(page).getByRole('textbox', { name: 'Lieu et télétravail', exact: true })).toHaveValue('Paris');
      expect(await audit.briefWrites()).toEqual([]);
      expect(await page.evaluate(() => (window as FixtureWindow).qaProjects['mission-a'].job_details?.location)).toBe('Lyon');
      expect(audit.calls.some(call => call.name === 'generate-search-filters' || call.body.action === 'preview' || call.body.action === 'search')).toBe(false);
      expect(audit.errors).toEqual([]);
      expect(audit.external).toEqual([]);
    });
  }

  test('Arrêter conserve la nouvelle saisie déjà commencée pendant la réponse', async ({ page }) => {
    const audit = await open(page, 'sourcing-interview');
    await composer(page).fill('Déplacez la recherche à Marseille.');
    await dialog(page).getByRole('button', { name: 'Envoyer', exact: true }).click();
    await expect.poll(audit.held).toBe(true);
    const nextDraft = 'Avant cela, confirmez les compétences indispensables.';
    await composer(page).fill(nextDraft);
    await dialog(page).getByRole('button', { name: 'Arrêter', exact: true }).click();
    await expect(dialog(page).getByRole('button', { name: 'Envoyer', exact: true })).toBeEnabled();
    await expect(composer(page)).toHaveValue(nextDraft);
    audit.release();
    await audit.lateDone;
    await expect(composer(page)).toHaveValue(nextDraft);
    await expect(dialog(page).getByRole('alert')).toHaveCount(0);
    expect(await audit.briefWrites()).toEqual([]);
    expect(audit.errors).toEqual([]);
  });
});
