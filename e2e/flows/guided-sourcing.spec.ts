import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { sourcingReturnHarnessHtml } from '../fixtures/sourcing-return/bundle';
import type { FixtureWindow } from '../fixtures/sourcing-return/types';

test.use({ baseURL: 'http://fixture.local' });
type Call = { name: string; body: {
  action?: string; id?: string; account_id?: string;
  filters?: { location: Array<{ name: string }> };
  job?: { evaluationCriteria: Array<{ weight: number }>; evaluationWeights: typeof weights };
} };
const weights = { technical: 50, soft_skill: 10, culture_fit: 10, motivation: 10, experience: 20 };
const draft = { title: 'Développeur React', location: 'Lyon', skills_must_have: ['React'], experience_min: 3, experience_max: 10,
  salary_min: 60000, salary_max: 80000, context: 'Produit B2B dans une équipe de six personnes', evaluation_weights: weights,
  evaluation_criteria: [{ id: 'react', label: 'React en production', description: 'Concevoir et livrer une application React', category: 'technical', weight: 2, deal_breaker: false }] };
const project = { id: 'mission-a', name: 'Mission React', kind: 'mission', status: 'active', organization_id: 'org-a', created_by: 'user-a', updated_at: '2026-10-13T09:00:00Z', job_details: draft, filters_snapshot: {} };
let html: string;
test.beforeAll(async () => { html = await sourcingReturnHarnessHtml('guided.tsx'); });
async function open(page: Page, options: { linked?: boolean; base?: boolean; plan?: boolean; mission?: boolean; searchEntry?: boolean; deniedBase?: boolean; failedTurn?: boolean; failFirstTurn?: boolean; delay?: number } = {}) {
  const calls: Call[] = [], errors: string[] = [], external: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.addInitScript(({ project, linked, base, plan }) => {
    const w = window as FixtureWindow;
    w.qaProjects = { 'mission-a': project as FixtureWindow['qaProjects'][string] };
    w.qaState = { organizationId: 'org-a', userId: 'user-a', memoryReady: true, accountIds: linked ? ['account-a'] : [], accountsReady: true, baseEnabled: base, basePlanAllows: plan };
    localStorage.removeItem('konekt_search_view_mode');
  }, { project, linked: !!options.linked, base: options.base !== false, plan: options.plan !== false });
  await page.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (request.isNavigationRequest() && url.origin === 'http://fixture.local') return route.fulfill({ contentType: 'text/html', body: html });
    if (url.origin === 'http://fixture.local' && /^\/konekt-(?:mark|logo)(?:-white)?\.png$/.test(url.pathname)) return route.fulfill({ contentType: 'image/png', body: await readFile(new URL('../../public' + url.pathname, import.meta.url)) });
    if (!url.pathname.startsWith('/qa-api/')) { if (!['image', 'font'].includes(request.resourceType())) external.push(url.origin); return route.abort(); }
    const body = request.postDataJSON() ?? {};
    const name = url.pathname.split('/').at(-1)!;
    calls.push({ name, body });
    if (options.delay && name === 'sourcing-interview') await new Promise(resolve => setTimeout(resolve, options.delay));
    if (name === 'sourcing-interview' && (options.failedTurn || options.failFirstTurn && calls.filter(call => call.name === name).length === 1)) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Serveur indisponible. Réessayez.' }) });
    if (options.deniedBase && name === 'coresignal-search') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'La Base Konekt n’est pas accessible pour le moment. Contactez l’assistance pour rétablir l’accès, ou utilisez LinkedIn si votre compte est relié.', errorType: 'PROVIDER_ACCESS_DENIED', retryable: false }) });
    let data: Record<string, unknown> = { success: true };
    if (name === 'ai-credits') data = { success: true, has_credits: true, estimated_credits: 1, remaining: 1000 };
    if (name === 'sourcing-interview') data = { success: true, reply: 'React et Lyon sont notés. Souhaitez-vous modifier leur importance ?', patch: draft };
    if (name === 'generate-search-filters') data = { success: true, filters: { keywords: 'React', role: [{ keywords: 'Développeur React', priority: 'MUST_HAVE', scope: 'CURRENT' }], location_keywords: ['Lyon'], years_of_experience_min: 3, years_of_experience_max: 10, skills_keywords: ['React'] } };
    if (name === 'coresignal-search' && body.action === 'preview' || name === 'unipile-search' && body.action === 'search') data = { success: true, total: 20, cursor: null,
      results: Array.from({ length: 20 }, (_, i) => ({ id: String(1000 + i), name: `Camille ${i + 1}`, headline: 'Développeur React', location: 'Lyon', source: name === 'coresignal-search' ? 'database' : 'linkedin', profile_url: `https://www.linkedin.com/in/camille-${i + 1}`, work_experience: [{ role: 'Développeur', company: 'Produit QA', current: true }] })) };
    if (name === 'unipile-search' && body.action === 'get_parameters') data = { success: true, items: [{ id: '105015875', title: 'Lyon' }] };
    if (name === 'coresignal-search' && body.action === 'collect') data = { success: true, profile: { id: body.id, name: 'Camille 1', headline: 'Développeur React', location: 'Lyon', source: 'database', summary: 'Création d’applications B2B', skills: ['React'], work_experience: [{ role: 'Développeur React', company: 'Produit QA', description: 'Produit B2B', start: '2018-01-01', current: true }] } };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.goto('/guided-sourcing-fixture' + (options.mission ? '?mission=1' : options.searchEntry ? '?entry=searches' : ''));
  return { calls, errors, external, searches: () => calls.filter(c => c.body.action === 'preview' || c.body.action === 'search') };
}
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Assistant · Sourcing', exact: true });
const confirm = (page: Page) => dialog(page).getByRole('button', { name: 'Valider et chercher', exact: true });
async function startDashboard(page: Page) {
  await page.getByRole('textbox', { name: 'Profil à rechercher depuis l’accueil' }).fill('Développeur React à Lyon, 3 à 10 ans');
  await page.getByRole('button', { name: 'Préparer la recherche', exact: true }).click();
  await expect(dialog(page).getByRole('textbox', { name: 'Message à l’assistant', exact: true })).toBeVisible();
  await expect(dialog(page).getByText('React et Lyon sont notés. Souhaitez-vous modifier leur importance ?', { exact: true })).toBeVisible();
  await expect(confirm(page)).toBeEnabled();
}
test.describe('Sourcing guidé @critical', () => {
test('Accueil sans LinkedIn : dialogue, critères validés, 20 résultats avec expérience, puis retour sans nouvelle facturation', async ({ page }) => {
  const audit = await open(page);
  await startDashboard(page);
  expect(audit.searches()).toHaveLength(0);
  await dialog(page).getByRole('button', { name: 'Cadrage', exact: true }).click();
  await dialog(page).getByRole('tab', { name: 'Critères', exact: true }).click();
  await dialog(page).getByRole('group', { name: 'Importance du critère React en production', exact: true }).getByRole('button', { name: 'Indispensable', exact: true }).click();
  await confirm(page).click();
  await test.info().attach('guided-mission-boundaries', { body: JSON.stringify(audit.calls), contentType: 'application/json' });
  await expect(page.getByRole('button', { name: 'Camille 1', exact: true })).toBeVisible();
  expect(audit.searches()).toHaveLength(1);
  expect(audit.searches()[0].name).toBe('coresignal-search');
  expect(audit.searches()[0].body.filters?.location[0].name).toBe('Lyon');
  expect(audit.calls.filter(c => c.name === 'unipile-search')).toHaveLength(0);
  const saved = await page.evaluate(() => (window as FixtureWindow).qaProjects['search-guided'].job_details);
  expect(saved?.evaluation_criteria?.[0].weight).toBe(3);
  expect(audit.calls.find(c => c.name === 'generate-search-filters')?.body.job?.evaluationCriteria[0].weight).toBe(3);
  await page.getByRole('button', { name: 'Basculer Pipeline / Sourcing' }).click();
  await page.getByRole('button', { name: 'Basculer Pipeline / Sourcing' }).click();
  await expect(page.getByRole('button', { name: 'Camille 1', exact: true })).toBeVisible();
  expect(audit.searches()).toHaveLength(1);
  await page.getByRole('button', { name: 'Camille 1', exact: true }).click();
  await expect.poll(() => audit.calls.filter(c => c.name === 'coresignal-search' && c.body.action === 'collect').length).toBe(1);
  expect(audit.calls.filter(c => c.name === 'unipile-search')).toHaveLength(0);
  await page.keyboard.press('Escape');
  expect(audit.errors).toEqual([]); expect(audit.external).toEqual([]);
});
test('Mission : reprend le cadrage sans appeler l’IA, pourcentages invalides refusés, modifications transmises à la recherche', async ({ page }) => {
  const audit = await open(page, { mission: true });
  await page.getByRole('button', { name: 'Préparer la recherche', exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Cadrage', exact: true }).click();
  await expect(dialog(page).getByRole('textbox', { name: 'Lieu et télétravail', exact: true })).toHaveValue('Lyon');
  expect(audit.calls.filter(c => c.name === 'sourcing-interview')).toHaveLength(0);
  await dialog(page).getByRole('tab', { name: 'Critères', exact: true }).click();
  await dialog(page).getByText('Pondération globale', { exact: true }).click();
  await dialog(page).getByRole('spinbutton', { name: 'Poids Technique en pourcentage' }).fill('70');
  await confirm(page).click();
  await expect(dialog(page).getByRole('alert')).toContainText('100 %');
  expect(audit.searches()).toHaveLength(0);
  await dialog(page).getByRole('spinbutton', { name: 'Poids Expérience en pourcentage' }).fill('0');
  await confirm(page).click();
  await expect(page.getByRole('button', { name: 'Camille 1', exact: true })).toBeVisible();
  expect(audit.calls.find(c => c.name === 'generate-search-filters')?.body.job?.evaluationWeights.technical).toBe(70);
  expect(audit.errors).toEqual([]);
});
test('Avec LinkedIn : recherche guidée utilise le compte, et changer de source ne lance aucune recherche', async ({ page }) => {
  const audit = await open(page, { linked: true });
  await startDashboard(page);
  await confirm(page).click();
  await expect(page.getByRole('button', { name: 'Camille 1', exact: true })).toBeVisible();
  expect(audit.searches()[0].name).toBe('unipile-search');
  expect(audit.searches()[0].body.account_id).toBe('account-a');
  await page.getByRole('button', { name: 'Base Konekt', exact: true }).click();
  await page.getByRole('button', { name: 'Basculer Pipeline / Sourcing' }).click();
  await page.getByRole('button', { name: 'Basculer Pipeline / Sourcing' }).click();
  await expect(page.getByRole('button', { name: 'Base Konekt', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(audit.searches()).toHaveLength(1);
  expect(audit.errors).toEqual([]);
});
test('Erreur IA : réponse conservée et aucune recherche ni écriture de brief', async ({ page }) => {
  const audit = await open(page, { failedTurn: true });
  await page.getByRole('textbox', { name: 'Profil à rechercher depuis l’accueil' }).fill('Développeur React à Lyon');
  await page.getByRole('button', { name: 'Préparer la recherche', exact: true }).click();
  await expect(dialog(page).getByRole('alert')).toBeVisible();
  await expect(dialog(page).getByRole('textbox', { name: 'Message à l’assistant' })).toHaveValue('Développeur React à Lyon');
  expect(audit.searches()).toHaveLength(0);
  expect(await page.evaluate(() => Object.keys((window as FixtureWindow).qaProjects))).toEqual(['mission-a']);
});
test('Après un échec : réessai depuis le composer, une seule réponse enregistrée et historique valide', async ({ page }) => {
  const audit = await open(page, { failFirstTurn: true });
  await page.getByRole('textbox', { name: 'Profil à rechercher depuis l’accueil' }).fill('Développeur React à Lyon');
  await page.getByRole('button', { name: 'Préparer la recherche', exact: true }).click();
  await expect(dialog(page).getByRole('alert')).toBeVisible();
  await expect(dialog(page).getByRole('textbox', { name: 'Message à l’assistant' })).toHaveValue('Développeur React à Lyon');
  await dialog(page).getByRole('button', { name: 'Envoyer', exact: true }).click();
  await expect(confirm(page)).toBeEnabled();
  await confirm(page).click();
  await expect(page.getByRole('button', { name: 'Camille 1', exact: true })).toBeVisible();
  expect(audit.calls.filter(call => call.name === 'sourcing-interview')).toHaveLength(2);
  const saved = await page.evaluate(() => (window as FixtureWindow).qaProjects['search-guided'].job_details);
  expect(saved?.raw_brief).toBe('Développeur React à Lyon');
  expect(audit.errors).toEqual([]);
});
test('Sans accès à la base : cadrage possible, lancement bloqué avec lien vers les accès', async ({ page }) => {
  const audit = await open(page, { base: false, mission: true });
  await page.getByRole('button', { name: 'Préparer la recherche', exact: true }).click();
  await expect(confirm(page)).toBeDisabled();
  await dialog(page).getByRole('button', { name: 'Choisir la source de recherche' }).click();
  await expect(page.getByRole('link', { name: 'Vérifier les accès' })).toHaveAttribute('href', '/settings/org/billing#credits');
  expect(audit.searches()).toHaveLength(0);
});
test('Base activée avec forfait incompatible : aucune sauvegarde ni recherche', async ({ page }) => {
  const audit = await open(page, { base: true, plan: false, mission: true });
  await page.getByRole('button', { name: 'Préparer la recherche', exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Choisir la source de recherche' }).click();
  await expect(page.getByRole('status')).toContainText('forfait compatible');
  await expect(confirm(page)).toBeDisabled();
  expect(await page.evaluate(() => (window as FixtureWindow).qaWrites.filter(write => 'job_details' in write))).toEqual([]);
  expect(audit.searches()).toHaveLength(0);
});
test('Cadrage existant : métadonnées conservées après échange, critères et description libre modifiables sans troncature', async ({ page }) => {
  const audit = await open(page, { mission: true });
  await page.evaluate(() => {
    const w = window as FixtureWindow;
    const previous = w.qaProjects['mission-a'];
    const jd = previous.job_details!;
    w.qaSetProject({ ...previous, job_details: { ...jd, raw_brief: 'Contexte initial '.repeat(900),
      client: { name: 'Client existant', hiring_manager: { name: 'Alex', email: 'alex@example.test' } },
      outreach_config: { sender_role: 'recruiter_external' },
      evaluation_criteria: jd.evaluation_criteria!.map(c => ({ ...c, level_10: 'Application livrée', level_1: 'Aucune pratique', interview_stage: 'Technique' })) } });
  });
  await page.getByRole('button', { name: 'Préparer la recherche', exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Cadrage', exact: true }).click();
  await dialog(page).getByRole('combobox', { name: 'Client', exact: true }).focus();
  await expect(dialog(page).getByRole('combobox', { name: 'Client', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole('group', { name: 'Quitter le cadrage' })).toHaveCount(0);
  await dialog(page).getByRole('button', { name: 'Revenir à la conversation' }).click();
  await dialog(page).getByRole('textbox', { name: 'Message à l’assistant' }).fill('Confirmez les critères existants.');
  await dialog(page).getByRole('button', { name: 'Envoyer', exact: true }).click();
  await expect(confirm(page)).toBeEnabled();
  await dialog(page).getByRole('button', { name: 'Cadrage', exact: true }).click();
  await dialog(page).getByRole('tab', { name: 'Critères', exact: true }).click();
  await dialog(page).getByRole('textbox', { name: 'Libellé du critère 1', exact: true }).fill('React livré en production');
  await dialog(page).getByRole('group', { name: 'Importance du critère React livré en production', exact: true }).getByRole('button', { name: 'Indispensable', exact: true }).click();
  await dialog(page).getByRole('checkbox', { name: 'Rédhibitoire : React livré en production', exact: true }).check();
  await dialog(page).getByRole('button', { name: 'Ajouter un critère', exact: true }).click();
  await confirm(page).click();
  await expect(dialog(page).getByRole('alert')).toContainText('libellé');
  expect(audit.searches()).toHaveLength(0);
  await dialog(page).getByRole('textbox', { name: 'Libellé du critère 2', exact: true }).fill('Travail en équipe');
  await dialog(page).getByRole('tab', { name: 'Le poste', exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Plus de détails sur le poste', exact: true }).click();
  const raw = 'Contexte ajusté '.repeat(900) + 'Fin conservée.';
  await dialog(page).getByRole('textbox', { name: 'Description libre', exact: true }).fill(raw);
  await dialog(page).getByRole('textbox', { name: 'Compétences indispensables', exact: true }).fill('Node.js en production');
  await page.keyboard.press('Enter');
  await confirm(page).click();
  await expect(page.getByRole('button', { name: 'Camille 1', exact: true })).toBeVisible();
  const saved = await page.evaluate(() => (window as FixtureWindow).qaProjects['mission-a'].job_details);
  expect(saved?.raw_brief).toBe(raw + '\nConfirmez les critères existants.');
  expect(saved?.client?.hiring_manager?.email).toBe('alex@example.test');
  expect(saved?.outreach_config?.sender_role).toBe('recruiter_external');
  expect(saved?.evaluation_criteria?.[0]).toMatchObject({ label: 'React livré en production', weight: 3, deal_breaker: true, level_10: 'Application livrée', level_1: 'Aucune pratique', interview_stage: 'Technique' });
  expect(saved?.evaluation_criteria?.[1].label).toBe('Travail en équipe');
  expect(saved?.skills_must_have).toEqual(['React', 'Node.js en production']);
  expect(audit.errors).toEqual([]);
});
test('Enregistrement échoué et cadrage modifié ailleurs : garde le dialogue et ne lance rien', async ({ page }) => {
  const audit = await open(page, { mission: true });
  await page.getByRole('button', { name: 'Préparer la recherche', exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Cadrage', exact: true }).click();
  await dialog(page).getByRole('textbox', { name: 'Lieu et télétravail', exact: true }).fill('Paris');
  await page.evaluate(() => (window as FixtureWindow).qaPatch({ failSave: true }));
  await confirm(page).click();
  await expect(dialog(page).getByRole('alert')).toContainText('Enregistrement indisponible');
  await expect(dialog(page).getByRole('textbox', { name: 'Lieu et télétravail', exact: true })).toHaveValue('Paris');
  await page.evaluate(() => { const w = window as FixtureWindow; w.qaPatch({ failSave: false }); w.qaSetProject({ ...w.qaProjects['mission-a'], job_details: { ...w.qaProjects['mission-a'].job_details, location: 'Marseille' } }); });
  await confirm(page).click();
  await expect(dialog(page).getByRole('alert')).toContainText('modifié ailleurs');
  expect(audit.searches()).toHaveLength(0);
});
test('Fermeture pendant l’IA : un seul échange, brouillon protégé à la fermeture', async ({ page }) => {
  const audit = await open(page, { delay: 500 });
  await page.getByRole('textbox', { name: 'Profil à rechercher depuis l’accueil' }).fill('React à Lyon');
  await page.getByRole('button', { name: 'Préparer la recherche', exact: true }).click();
  await expect.poll(() => audit.calls.filter(c => c.name === 'sourcing-interview').length).toBe(1);
  await expect(dialog(page).getByRole('button', { name: 'Fermer l’assistant' })).toBeDisabled();
  await expect(dialog(page)).toBeVisible();
  await expect(confirm(page)).toBeEnabled();
  expect(audit.calls.filter(c => c.name === 'sourcing-interview')).toHaveLength(1);
  await dialog(page).getByRole('button', { name: 'Fermer l’assistant' }).click();
  await expect(dialog(page).getByRole('group', { name: 'Quitter le cadrage' })).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Continuer', exact: true }).click();
  await expect(dialog(page).getByText('React et Lyon sont notés. Souhaitez-vous modifier leur importance ?', { exact: true })).toBeVisible();
});
test('Dialogue 1024x600 : comparaison des sources dépliée, composer et validation accessibles', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  const audit = await open(page);
  await startDashboard(page);
  const composer = dialog(page).getByRole('textbox', { name: 'Message à l’assistant', exact: true });
  const footer = confirm(page).locator('..');
  const composerRect = await composer.boundingBox();
  const footerRect = await footer.boundingBox();
  expect(composerRect!.y + composerRect!.height).toBeLessThanOrEqual(footerRect!.y);
  await expect(composer).toBeInViewport();
  await expect(confirm(page)).toBeInViewport();
  await dialog(page).getByRole('button', { name: 'Choisir la source de recherche' }).click();
  await page.getByText('Quelles différences entre les sources ?', { exact: true }).click();
  await page.getByRole('rowheader', { name: 'Email et téléphone', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('rowheader', { name: 'Email et téléphone', exact: true })).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(confirm(page)).toBeInViewport();
  await test.info().attach('dialogue-1024x600-comparaison', { body: await dialog(page).screenshot(), contentType: 'image/png' });
  expect(audit.errors).toEqual([]); expect(audit.external).toEqual([]);
});
for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 640 }]) {
  for (const dark of [false, true]) {
    test(`Dialogue ${viewport.width}px ${dark ? 'sombre' : 'clair'} : récapitulatif, clavier et accessibilité`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const audit = await open(page);
      await page.evaluate(dark => { document.documentElement.classList.remove('light', 'dark'); document.documentElement.classList.add(dark ? 'dark' : 'light'); }, dark);
      await startDashboard(page);
      await expect(dialog(page)).toBeVisible();
      await expect(dialog(page).getByRole('textbox', { name: 'Intitulé du poste', exact: true })).toHaveCount(0);
      const dialogBox = await dialog(page).boundingBox();
      const composerBox = await dialog(page).getByRole('textbox', { name: 'Message à l’assistant', exact: true }).boundingBox();
      expect(dialogBox!.width).toBe(viewport.width);
      expect(composerBox!.width).toBeGreaterThan(viewport.width * 0.8);
      await page.evaluate(async () => { await document.fonts.load('500 14px "Instrument Sans"'); await document.fonts.ready; });
      expect(await page.evaluate(() => document.fonts.check('500 14px "Instrument Sans"'))).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
      expect(await dialog(page).evaluate(el => el.scrollWidth <= el.clientWidth)).toBeTruthy();
      await expect.poll(() => dialog(page).locator('.animate-fade-in').evaluateAll(elements => elements.every(el => getComputedStyle(el).opacity === '1'))).toBe(true);
      const axe = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(axe.violations).toEqual([]);
      await test.info().attach(`dialogue-${viewport.width}-${dark ? 'sombre' : 'clair'}-assistant`, { body: await dialog(page).screenshot(), contentType: 'image/png' });
      await dialog(page).getByRole('button', { name: 'Cadrage', exact: true }).click();
      await expect(dialog(page).getByRole('tab', { name: 'Le poste', exact: true })).toHaveAttribute('aria-selected', 'true');
      await dialog(page).getByRole('tab', { name: 'Critères', exact: true }).click();
      await expect(dialog(page).getByRole('textbox', { name: 'Libellé du critère 1', exact: true })).toBeVisible();
      const criteriaAxe = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(criteriaAxe.violations).toEqual([]);
      await expect(confirm(page)).toBeInViewport();
      await test.info().attach(`dialogue-${viewport.width}-${dark ? 'sombre' : 'clair'}-criteres`, { body: await dialog(page).screenshot(), contentType: 'image/png' });
      await dialog(page).getByRole('button', { name: 'Revenir à la conversation' }).click();
      await expect(dialog(page).getByText('React et Lyon sont notés. Souhaitez-vous modifier leur importance ?', { exact: true })).toBeVisible();
      expect(audit.errors).toEqual([]); expect(audit.external).toEqual([]);
    });
  }
}

});


test.describe('Entrée sourcing et accès Base @critical', () => {
  test('Mes recherches : exemples, assistant avant création, annulation garde le prompt', async ({ page }) => {
    const audit = await open(page, { searchEntry: true });
    await expect(page.getByRole('heading', { name: 'Qui cherchez-vous ?' })).toBeVisible();
    await page.getByRole('button', { name: 'Head of Sales fintech série B, Paris, a scalé une équipe', exact: true }).click();
    const prompt = page.getByRole('textbox', { name: 'Décrivez le profil recherché' });
    await expect(prompt).toHaveValue('Head of Sales fintech série B, Paris, a scalé une équipe');
    await prompt.press('Enter');
    await expect(dialog(page)).toBeVisible();
    expect(await page.evaluate(() => Object.keys((window as FixtureWindow).qaProjects))).toEqual(['mission-a']);
    expect(audit.searches()).toHaveLength(0);
    await expect(confirm(page)).toBeEnabled();
    await dialog(page).getByRole('button', { name: 'Fermer l’assistant', exact: true }).click();
    await dialog(page).getByRole('button', { name: 'Quitter sans enregistrer', exact: true }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(prompt).toHaveValue('Head of Sales fintech série B, Paris, a scalé une équipe');
    await page.getByRole('button', { name: 'Préparer la recherche', exact: true }).click();
    await expect(confirm(page)).toBeEnabled();
    await confirm(page).click();
    await expect(page.getByRole('button', { name: 'Camille 1', exact: true })).toBeVisible();
    expect(audit.searches()).toHaveLength(1);
    expect(audit.errors).toEqual([]);
  });
  test('Filtres manuels depuis Mes recherches : aucun cadrage IA ni appel fournisseur', async ({ page }) => {
    const audit = await open(page, { searchEntry: true });
    await page.getByRole('button', { name: 'configurer les filtres manuellement', exact: true }).click();
    await expect(page.getByRole('dialog', { name: /Filtres/ })).toBeVisible();
    expect(audit.calls.filter(c => c.name === 'sourcing-interview' || c.name === 'generate-search-filters')).toHaveLength(0);
    expect(audit.searches()).toHaveLength(0);
    expect(audit.errors).toEqual([]);
  });
  test('Accès Base refusé : explication, pas de reprise automatique et LinkedIn utilisable', async ({ page }) => {
    const audit = await open(page, { mission: true, linked: true, deniedBase: true });
    await page.getByRole('button', { name: 'Base Konekt', exact: true }).click();
    await page.getByRole('button', { name: 'Préparer la recherche', exact: true }).click();
    await confirm(page).click();
    await expect(page.getByText(/Contactez l’assistance pour rétablir l’accès/)).toBeVisible();
    expect(audit.searches()).toHaveLength(1);
    expect(audit.searches()[0].name).toBe('coresignal-search');
    await page.getByRole('button', { name: 'LinkedIn', exact: true }).click();
    await page.getByRole('button', { name: 'Préparer la recherche', exact: true }).click();
    await confirm(page).click();
    await expect(page.getByRole('button', { name: 'Camille 1', exact: true })).toBeVisible();
    expect(audit.searches()).toHaveLength(2);
    expect(audit.searches()[1].name).toBe('unipile-search');
    expect(audit.errors).toEqual([]);
  });
});

for (const entry of ['accueil', 'recherches'] as const) for (const width of [1440, 390, 320]) {
  test(`Entrée ${entry} ${width}px : prompt, exemples, filtres, clavier et accessibilité @critical`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const audit = await open(page, { searchEntry: entry === 'recherches' });
    const prompt = page.getByRole('textbox', { name: entry === 'accueil' ? 'Profil à rechercher depuis l’accueil' : 'Décrivez le profil recherché' });
    await expect(prompt).toBeVisible();
    await page.keyboard.press('/');
    await expect(prompt).toBeFocused();
    await expect(page.getByRole('button', { name: 'Préparer la recherche', exact: true })).toBeInViewport();
    await expect(page.getByRole('button', { name: 'configurer les filtres manuellement', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(accessibility.violations).toEqual([]);
    if (width < 500) {
      const targets = await page.getByRole('button').evaluateAll(buttons => buttons.filter(b => /Préparer la recherche|configurer les filtres|Head of Sales/.test(b.textContent ?? '')).map(b => b.getBoundingClientRect().height));
      expect(targets.every(height => height >= 44)).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath(`entree-${entry}-${width}.png`), fullPage: true });
    expect(audit.searches()).toHaveLength(0);
    expect(audit.errors).toEqual([]);
  });
}

for (const mission of [false, true]) test(`Filtres manuels accueil ${mission ? 'mission existante' : 'nouvelle recherche'} @critical`, async ({ page }) => {
  const audit = await open(page);
  if (mission) {
    await page.getByRole('combobox', { name: 'Contexte de la recherche' }).click();
    await page.getByRole('option', { name: 'Mission React', exact: true }).click();
  }
  await page.getByRole('button', { name: 'configurer les filtres manuellement', exact: true }).click();
  await expect(page.getByRole('dialog', { name: /Filtres/ })).toBeVisible();
  expect(audit.calls.filter(c => c.name === 'sourcing-interview' || c.name === 'generate-search-filters')).toHaveLength(0);
  expect(audit.searches()).toHaveLength(0);
  expect(await page.evaluate(() => Object.keys((window as FixtureWindow).qaProjects))).toEqual(mission ? ['mission-a'] : ['mission-a', 'search-guided']);
  expect(audit.errors).toEqual([]);
});
