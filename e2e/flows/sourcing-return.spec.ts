import { test, expect, type Page } from '@playwright/test';
import { sourcingReturnHarnessHtml } from '../fixtures/sourcing-return/bundle';
import type { FixtureState, FixtureWindow } from '../fixtures/sourcing-return/types';
import AxeBuilder from '@axe-core/playwright';
import { buildScoringInputVersionKey } from '../../src/lib/sourcingScoringContext';

interface SearchReply {
  count?: number;
  offset?: number;
  total?: number;
  cursor?: string | null;
  error?: string;
  delayMs?: number;
  experienced?: boolean;
}

test.use({ baseURL: 'http://fixture.local' });
test.describe('Sourcing — quitter et revenir @critical', () => {
  let html: string;
  let observed: { calls: Array<Record<string, unknown>>; errors: string[]; blockedExternalRequests: Array<{ origin: string; resourceType: string }> } | undefined;
  test.beforeAll(async () => { html = await sourcingReturnHarnessHtml(); });
  test.afterEach(async ({ page }) => {
    if (!observed) return;
    await test.info().attach('mock-boundary-observations', { body: JSON.stringify(observed), contentType: 'application/json' });
    await test.info().attach('production-source-hashes', { body: JSON.stringify(await page.evaluate(() => (window as FixtureWindow).qaSourceHashes) ?? {}), contentType: 'application/json' });
    expect(observed.errors).toEqual([]);
    // Old cards request remote company icons. They are blocked like every
    // other external URL; no API/model request may escape the mock boundary.
    expect(observed.blockedExternalRequests.filter(request => request.resourceType !== 'image' && request.resourceType !== 'font')).toEqual([]);
  });
  const initialProject = (id: string, keywords: string) => ({
    id, name: id === 'mission-a' ? 'Mission DevOps' : 'Mission Data', kind: 'mission',
    organization_id: 'org-a', created_by: 'user-a', created_at: '2026-10-12T09:00:00Z',
    job_details: { title: id === 'mission-a' ? 'Backend Engineer' : 'Data Engineer', client: { name: 'Client QA' }, skills_must_have: [keywords] },
    filters_snapshot: { api: 'recruiter', keywords, last_manual_edit: 'fixture-original' },
  });
  async function open(page: Page, options: { configure?: boolean; state?: FixtureState; empty?: boolean; legacy?: boolean; grouped?: boolean; profileCount?: number; searchReplies?: SearchReply[]; locallyFiltered?: boolean } = {}) {
    const calls: Array<Record<string, unknown>> = [];
    const errors: string[] = [];
    const external: Array<{ origin: string; resourceType: string }> = [];
    observed = { calls, errors, blockedExternalRequests: external };
    page.on('pageerror', error => { errors.push(error.message); console.error('Sourcing fixture JS:', error.message); });
    await page.addInitScript(({ projects, state, grouped }) => {
      const w = window as FixtureWindow;
      w.qaProjects = projects;
      w.qaState = state;
      w.qaWrites = [];
      w.qaScoreWrites = [];
      w.qaStatuses = grouped ? {
        'a-0': { candidate_id: 'a-0', candidate_name: 'Profil A 01', status: 'shortlisted' },
        'a-1': { candidate_id: 'a-1', candidate_name: 'Profil A 02', status: 'dismissed' },
      } : {};
    }, { projects: { 'mission-a': {
      ...initialProject('mission-a', 'Python'),
      filters_snapshot: { ...initialProject('mission-a', 'Python').filters_snapshot, ...(options.locallyFiltered ? { calculated_experience_min: 20 } : {}) },
    }, 'mission-b': initialProject('mission-b', 'SQL') }, state: { memoryReady: true, accountsReady: true, ...options.state }, grouped: !!options.grouped });
    // Every request is intercepted: no real provider, model, contact or DB write.
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.isNavigationRequest() && url.origin === 'http://fixture.local') return route.fulfill({ contentType: 'text/html', body: html });
      if (!url.pathname.startsWith('/qa-api/')) {
        if (url.origin !== 'http://fixture.local') external.push({ origin: url.origin, resourceType: request.resourceType() });
        return route.abort();
      }
      const body = request.postDataJSON() ?? {};
      calls.push(body);
      const reply = body.action === 'search' ? options.searchReplies?.[calls.filter(call => call.action === 'search').length - 1] : undefined;
      if (reply?.delayMs) await new Promise(resolve => setTimeout(resolve, reply.delayMs));
      const offset = reply?.offset ?? (body.cursor ? 25 : 0);
      const count = reply?.count ?? options.profileCount ?? 25;
      const profiles = Array.from({ length: count }, (_, index) => ({
        id: `${body.account_id === 'account-b' ? 'b' : 'a'}-${offset + index}`, provider_id: `${body.account_id === 'account-b' ? 'b' : 'a'}-${offset + index}`,
        name: `Profil ${body.account_id === 'account-b' ? 'B' : 'A'} ${String(offset + index + 1).padStart(2, '0')}`,
        headline: 'Backend Engineer Python', location: 'Paris',
        work_experience: [{ position: 'Backend Engineer', company: 'Entreprise QA', start: reply?.experienced ? '1998-01-01' : '2018-01-01', end: '2026-01-01' }],
      }));
      let data: Record<string, unknown> = { success: true };
      if (body.action === 'search') data = { success: true, results: options.empty ? [] : profiles, total: options.empty ? 0 : options.profileCount ?? 50, cursor: options.empty || body.cursor || options.profileCount ? null : 'page-two' };
      if (body.action === 'search' && reply) data = reply.error
        ? { success: false, error: reply.error }
        : { success: true, results: profiles, total: reply.total ?? 75, cursor: reply.cursor ?? null };
      if (body.action === 'get_parameters') data = { success: true, items: [] };
      if (body.action === 'get_profile') data = { success: true, profile: profiles.find(profile => profile.id === body.profile_id) ?? profiles[0] };
      const functionName = url.pathname.split('/').at(-1);
      if (functionName === 'ai-credits') data = { success: true, has_credits: true, estimated_credits: 2, remaining: 10000, model: body.model };
      if (functionName === 'score-profile-job') {
        const memoryVersionKey = String(body.expected_memory_version_key);
        const context = {
          fingerprint: '1'.repeat(64),
          inputVersionKey: buildScoringInputVersionKey(body.job, body.customScoringInstructions, {
            organizationId: body.organization_id, projectId: body.project_id, requestModel: body._ai_model, memoryVersionKey,
          }),
          memory: { fingerprint: '2'.repeat(64), versionKey: memoryVersionKey, provenance: [] },
        };
        data = { success: true, results: body.profiles.map((profile: { id: string; name?: string }) => ({
          profile_id: profile.id, name: profile.name, score: 71 + Number(profile.id.split('-').at(-1)),
          recommendation: 'go', summary: 'Compétences Python et expérience vérifiées dans le profil de test.',
          hardFilterPassed: true, skippedLLM: false, confidenceScore: 95,
          scoringContext: context,
        })) };
      }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    });
    const query = new URLSearchParams();
    if (options.configure) query.set('configure', '1');
    if (options.legacy) query.set('legacy', '1');
    await page.goto('/sourcing-return-fixture?' + query);
    return { calls, errors, external, searches: () => calls.filter(call => call.action === 'search'),
      scores: () => calls.filter(call => call._ai_action === 'scoring' && Array.isArray(call.profiles)) };
  }
  const patch = (page: Page, state: FixtureState) => page.evaluate(state => (window as FixtureWindow).qaPatch(state), state);
  const panel = (page: Page) => page.getByRole('dialog', { name: 'Filtres de recherche', exact: true });
  const topbar = (page: Page) => page.getByRole('textbox', { name: 'Affiner la recherche en langage naturel' });
  async function closeFilters(page: Page) {
    await panel(page).getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect(panel(page)).toBeHidden();
  }
  async function changeKeywords(page: Page, value: string) {
    const dialog = panel(page);
    await dialog.getByRole('button', { name: 'Options avancées', exact: false }).click();
    await dialog.getByRole('button', { name: /Python|Rust|SQL/, exact: false }).first().click();
    const editor = page.getByRole('dialog', { name: 'Mots-clés de recherche', exact: true });
    await editor.getByRole('textbox', { name: 'Requête de recherche' }).fill(value);
    await editor.getByRole('button', { name: 'Appliquer', exact: true }).click();
  }
  async function leaveAndReturn(page: Page) {
    await page.getByRole('button', { name: 'Pipeline', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Pipeline de/ })).toBeVisible();
    await page.getByRole('button', { name: 'Sourcing', exact: true }).click();
  }
  async function launch(page: Page) {
    await panel(page).getByRole('button', { name: 'Rechercher', exact: true }).click();
    await expect(page.getByText('Profil A 01', { exact: true })).toBeVisible();
  }
  test('Claire — filtres préparés, fenêtre fermée, retour sans nouvelle configuration', async ({ page }) => {
    const api = await open(page, { configure: true, state: { orgType: 'enterprise' } });
    await expect(panel(page)).toBeVisible();
    await changeKeywords(page, 'Rust');
    await closeFilters(page);
    await expect(topbar(page)).toBeVisible();
    await leaveAndReturn(page);
    await expect(topbar(page)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Qui cherchez-vous ?' })).toHaveCount(0);
    await page.getByRole('button', { name: /^Filtres(?: \(\d+\))?$/ }).click();
    await expect(page.getByText('Rust', { exact: true })).toBeVisible();
    expect(api.searches()).toHaveLength(0);
    expect(api.errors).toEqual([]);
  });
  test('Guillaume — résultats conservés pendant deux retours, sans recherche supplémentaire', async ({ page }) => {
    const api = await open(page, { configure: true });
    await launch(page);
    for (let round = 0; round < 2; round++) {
      await leaveAndReturn(page);
      await expect(page.getByText('Profil A 01', { exact: true })).toBeVisible();
      await expect(topbar(page)).toBeVisible();
      expect(api.searches()).toHaveLength(1);
    }
    expect(api.errors).toEqual([]);
  });
  test('Guillaume — noter 30 profils en deux lots, conserver notes et sélection après deux retours', async ({ page }) => {
    const api = await open(page, { configure: true, profileCount: 30 });
    await launch(page);
    await page.getByRole('button', { name: 'Noter les 20 premiers', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Noter les 10 profils non notés', exact: true })).toBeVisible();
    expect(api.scores()).toHaveLength(2);
    await page.getByRole('button', { name: 'Noter les 10 profils non notés', exact: true }).click();
    await expect.poll(() => page.locator('[aria-label^="Note "]').count()).toBe(30);
    const verifyScores = async () => {
      for (let index = 0; index < 30; index++) {
        const row = page.getByRole('row').filter({ has: page.getByText(`Profil A ${String(index + 1).padStart(2, '0')}`, { exact: true }) });
        await expect(row.getByLabel(`Note ${71 + index}`, { exact: true })).toHaveCount(1);
      }
    };
    await verifyScores();
    const selections = ['Profil A 01', 'Profil A 30'];
    for (const name of selections) await page.getByRole('checkbox', { name: 'Sélectionner ' + name, exact: true }).click();
    const scoredIds = api.scores().flatMap(call => (call.profiles as Array<{ id: string }>).map(profile => profile.id));
    expect(api.scores().map(call => (call.profiles as unknown[]).length)).toEqual([10, 10, 10]);
    expect(new Set(scoredIds).size).toBe(30);
    expect(scoredIds.slice(0, 20).sort()).toEqual(Array.from({ length: 20 }, (_, index) => 'a-' + index).sort());
    expect(scoredIds.slice(20).sort()).toEqual(Array.from({ length: 10 }, (_, index) => 'a-' + (20 + index)).sort());
    const writes = await page.evaluate(() => (window as FixtureWindow).qaScoreWrites);
    expect(writes?.map(rows => rows.length)).toEqual([20, 10]);
    for (let round = 0; round < 2; round++) {
      await leaveAndReturn(page);
      await verifyScores();
      for (const name of selections) await expect(page.getByRole('checkbox', { name: 'Sélectionner ' + name, exact: true })).toBeChecked();
      expect(api.searches()).toHaveLength(1);
      expect(api.scores()).toHaveLength(3);
    }
  });
  test('Guillaume — compte autorisé choisi conservé au retour', async ({ page }) => {
    const api = await open(page, { configure: true });
    await panel(page).getByRole('combobox').first().click();
    await page.getByRole('option', { name: /^Compte Béatrice\b/ }).click();
    await panel(page).getByRole('button', { name: 'Rechercher', exact: true }).click();
    await expect(page.getByText('Profil B 01', { exact: true })).toBeVisible();
    await leaveAndReturn(page);
    await expect(page.getByText('Profil B 01', { exact: true })).toBeVisible();
    expect(api.searches()).toHaveLength(1);
    expect(api.searches()[0].account_id).toBe('account-b');
    expect(api.errors).toEqual([]);
  });
  test('Théo — mémoire encore en chargement au retour puis résolue, cache intact', async ({ page }) => {
    const api = await open(page, { configure: true });
    await launch(page);
    await page.getByRole('button', { name: 'Pipeline', exact: true }).click();
    await patch(page, { memoryReady: false });
    await page.getByRole('button', { name: 'Sourcing', exact: true }).click();
    await expect(page.getByLabel('Chargement des mémoires', { exact: true })).toBeVisible();
    await patch(page, { memoryReady: true });
    await expect(page.getByText('Profil A 01', { exact: true })).toBeVisible();
    await leaveAndReturn(page);
    await expect(page.getByText('Profil A 01', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /^Filtres(?: \(\d+\))?$/ }).click();
    await expect(page.getByText('Python', { exact: true })).toBeVisible();
    expect(api.searches()).toHaveLength(1);
    expect(api.errors).toEqual([]);
  });
  test('Claire — préparation conservée pendant le chargement des mémoires au retour', async ({ page }) => {
    const api = await open(page, { configure: true, state: { orgType: 'enterprise' } });
    await changeKeywords(page, 'Rust');
    await closeFilters(page);
    await page.getByRole('button', { name: 'Pipeline', exact: true }).click();
    await patch(page, { memoryReady: false });
    await page.getByRole('button', { name: 'Sourcing', exact: true }).click();
    await expect(page.getByLabel('Chargement des mémoires', { exact: true })).toBeVisible();
    await patch(page, { memoryReady: true });
    await expect(topbar(page)).toBeVisible();
    await page.getByRole('button', { name: /^Filtres(?: \(\d+\))?$/ }).click();
    await expect(page.getByText('Rust', { exact: true })).toBeVisible();
    expect(api.searches()).toHaveLength(0);
  });
  test('Guillaume — une recherche terminée sans profil reste configurée au retour', async ({ page }) => {
    const api = await open(page, { configure: true, empty: true });
    await panel(page).getByRole('button', { name: 'Rechercher', exact: true }).click();
    await expect(topbar(page)).toBeVisible();
    await expect.poll(() => api.searches().length).toBe(1);
    await leaveAndReturn(page);
    await expect(topbar(page)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Qui cherchez-vous ?' })).toHaveCount(0);
    expect(api.searches()).toHaveLength(1);
  });
  test('Théo — changer de mission, organisation et utilisateur ne mélange pas les résultats', async ({ page }) => {
    const api = await open(page, { configure: true });
    await launch(page);
    await page.getByRole('button', { name: 'Pipeline', exact: true }).click();
    await patch(page, { projectId: 'mission-b' });
    await page.getByRole('button', { name: 'Sourcing', exact: true }).click();
    await expect(page.getByText('Profil A 01', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Pipeline', exact: true }).click();
    await patch(page, { projectId: 'mission-a', organizationId: 'org-b', userId: 'user-b' });
    await page.getByRole('button', { name: 'Sourcing', exact: true }).click();
    await expect(page.getByText('Profil A 01', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Pipeline', exact: true }).click();
    await patch(page, { organizationId: 'org-a', userId: 'user-a' });
    await page.getByRole('button', { name: 'Sourcing', exact: true }).click();
    await expect(page.getByText('Profil A 01', { exact: true })).toBeVisible();
    expect(api.searches()).toHaveLength(1);
  });
  for (const revision of ['brief', 'memory'] as const) test(`Théo — changement réel du ${revision} invalide les résultats anciens`, async ({ page }) => {
    const api = await open(page, { configure: true });
    await launch(page);
    await page.getByRole('button', { name: 'Pipeline', exact: true }).click();
    if (revision === 'memory') await patch(page, { memoryRevision: 1 });
    else await page.evaluate(() => {
      const w = window as FixtureWindow;
      const project = w.qaProjects['mission-a'];
      w.qaSetProject({ ...project, job_details: { ...project.job_details, title: 'Data Engineer', skills_must_have: ['SQL'] } });
    });
    await page.getByRole('button', { name: 'Sourcing', exact: true }).click();
    await expect(page.getByText('Profil A 01', { exact: true })).toHaveCount(0);
    expect(api.searches()).toHaveLength(1);
  });
  test('Théo — compte précédemment choisi retiré, aucune restauration de ses profils', async ({ page }) => {
    const api = await open(page, { configure: true });
    await panel(page).getByRole('combobox', { name: 'Compte LinkedIn' }).click();
    await page.getByRole('option', { name: /^Compte Béatrice\b/ }).click();
    await panel(page).getByRole('button', { name: 'Rechercher', exact: true }).click();
    await expect(page.getByText('Profil B 01', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Pipeline', exact: true }).click();
    await patch(page, { accountIds: ['account-a'] });
    await page.getByRole('button', { name: 'Sourcing', exact: true }).click();
    await expect(page.getByText('Profil B 01', { exact: true })).toHaveCount(0);
    expect(api.searches()).toHaveLength(1);
  });
  test('Théo — modification avant sauvegarde, retour puis ancien état serveur ne remplacent pas le brouillon', async ({ page }) => {
    const api = await open(page, { configure: true, state: { holdWrites: true } });
    await launch(page);
    await page.getByRole('button', { name: 'Nouvelle recherche', exact: true }).click();
    await changeKeywords(page, 'Rust');
    await closeFilters(page);
    await leaveAndReturn(page);
    await expect(page.getByText('Profil A 01', { exact: true })).toBeVisible();
    await expect(page.getByText('Les filtres ont changé. Les profils affichés correspondent à la recherche précédente.', { exact: true })).toBeVisible();
    await page.evaluate(() => (window as FixtureWindow).qaReleaseWrites());
    await leaveAndReturn(page);
    await expect(page.getByText('Profil A 01', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /^Filtres(?: \(\d+\))?$/ }).click();
    await expect(page.getByText('Rust', { exact: true })).toBeVisible();
    expect(api.searches()).toHaveLength(1);
    expect(api.errors).toEqual([]);
  });
  test('Guillaume — groupe Retenus puis Écartés conservé avec ses profils au retour', async ({ page }) => {
    const api = await open(page, { configure: true, grouped: true });
    await panel(page).getByRole('button', { name: 'Rechercher', exact: true }).click();
    await expect(page.getByText('Profil A 03', { exact: true })).toBeVisible();
    for (const [label, name] of [['Retenus', 'Profil A 01'], ['Écartés', 'Profil A 02']]) {
      const tab = page.getByRole('tab', { name: new RegExp('^' + label + '\\b') });
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByText(name, { exact: true })).toBeVisible();
      await leaveAndReturn(page);
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByText(name, { exact: true })).toBeVisible();
      await expect(page.getByText('Profil A 03', { exact: true })).toHaveCount(0);
    }
    expect(api.searches()).toHaveLength(1);
  });
  test('Guillaume — ancien écran, Shortlist conservée au retour et au chargement du lot suivant', async ({ page }) => {
    const api = await open(page, { legacy: true, grouped: true });
    await page.getByRole('button', { name: 'Lancer la recherche avec les filtres du brief', exact: true }).click();
    await expect(page.getByText('Profil A 03', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /Shortlist/ }).first().click();
    await expect(page.getByText('Profil A 01', { exact: true })).toBeVisible();
    await expect(page.getByText('Profil A 03', { exact: true })).toHaveCount(0);
    await leaveAndReturn(page);
    await expect(page.getByText('Profil A 01', { exact: true })).toBeVisible();
    await expect(page.getByText('Profil A 03', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Charger le lot suivant (25 profils)', exact: true }).click();
    await expect(page.getByText('Fin des résultats LinkedIn', { exact: true })).toBeVisible();
    await expect(page.getByText('Profil A 01', { exact: true })).toBeVisible();
    await expect(page.getByText('Profil A 26', { exact: true })).toHaveCount(0);
    await leaveAndReturn(page);
    await expect(page.getByText('Profil A 01', { exact: true })).toBeVisible();
    await expect(page.getByText('Profil A 26', { exact: true })).toHaveCount(0);
    expect(api.searches()).toHaveLength(2);
    expect(api.searches()[1].cursor).toBe('page-two');
  });
  test('Claire — la suite est visible près du compteur sans défiler, puis chaque lot utilise sa suite', async ({ page }) => {
    const api = await open(page, { configure: true, state: { orgType: 'enterprise' }, searchReplies: [
      { count: 25, offset: 0, total: 75, cursor: 'suite-a' },
      { count: 25, offset: 25, total: 75, cursor: 'suite-b' },
      { count: 25, offset: 50, total: 75, cursor: null },
    ] });
    await launch(page);
    const next = page.getByRole('button', { name: 'Voir la suite', exact: true });
    await expect(next).toHaveCount(1);
    const buttonBounds = await next.boundingBox();
    const viewport = page.viewportSize()!;
    expect(buttonBounds!.y).toBeGreaterThanOrEqual(0);
    expect(buttonBounds!.y + buttonBounds!.height).toBeLessThanOrEqual(viewport.height);
    await expect(page.getByText(/25 profils chargés sur 75/).first()).toBeVisible();
    expect(await page.evaluate(() => scrollY)).toBe(0);
    await next.click();
    await expect(page.getByText('Profil A 26', { exact: true })).toBeVisible();
    await expect(page.getByText(/50 profils chargés sur 75/).first()).toBeVisible();
    await next.click();
    await expect(page.getByText('Profil A 51', { exact: true })).toBeVisible();
    await expect(next).toHaveCount(0);
    await expect(page.getByText(/^75 profils chargés\.$/).first()).toBeVisible();
    expect(api.searches().map(call => call.cursor ?? null)).toEqual([null, 'suite-a', 'suite-b']);
  });
  test('Théo — zéro profil après filtre local garde un accès à la suite LinkedIn', async ({ page }) => {
    const api = await open(page, { configure: true, locallyFiltered: true, searchReplies: [
      ...Array.from({ length: 10 }, (_, index) => ({ count: 25, offset: index * 25, total: 275, cursor: `suite-locale-${index + 1}` })),
      { count: 25, offset: 250, total: 275, cursor: null, experienced: true },
    ] });
    await panel(page).getByRole('button', { name: 'Rechercher', exact: true }).click();
    await expect.poll(() => api.searches().length).toBe(10);
    await expect(page.getByText('Profil A 01', { exact: true })).toHaveCount(0);
    const next = page.getByRole('button', { name: 'Voir la suite', exact: true });
    await expect(next).toBeVisible();
    await expect(page.getByText('Aucun profil trouvé', { exact: true })).toHaveCount(0);
    await next.click();
    await expect(page.getByText('Profil A 251', { exact: true })).toBeVisible();
    expect(api.searches()).toHaveLength(11);
    expect(api.searches()[10].cursor).toBe('suite-locale-10');
    await expect(page.getByText(/Tous les profils de cette recherche sont chargés/)).toHaveCount(0);
  });
  for (const group of ['Retenus', 'Écartés']) test(`Guillaume — Voir la suite depuis ${group} ouvre les profils à trier`, async ({ page }) => {
    const api = await open(page, { configure: true, grouped: true });
    await panel(page).getByRole('button', { name: 'Rechercher', exact: true }).click();
    await expect(page.getByText('Profil A 03', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: new RegExp('^' + group + '\\b') }).click();
    await page.getByRole('button', { name: 'Voir la suite', exact: true }).click();
    await expect(page.getByRole('tab', { name: /^À trier\b/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Profil A 26', { exact: true })).toBeVisible();
    expect(api.searches().map(call => call.cursor ?? null)).toEqual([null, 'page-two']);
  });
  test('Guillaume — une nouvelle recherche réussie ouvre À trier et le retour garde le groupe choisi', async ({ page }) => {
    const api = await open(page, { configure: true, grouped: true });
    await panel(page).getByRole('button', { name: 'Rechercher', exact: true }).click();
    await expect(page.getByText('Profil A 03', { exact: true })).toBeVisible();
    const retained = page.getByRole('tab', { name: /^Retenus\b/ });
    await retained.click();
    await leaveAndReturn(page);
    await expect(retained).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: 'Nouvelle recherche', exact: true }).click();
    await panel(page).getByRole('button', { name: 'Rechercher', exact: true }).click();
    await expect(page.getByRole('tab', { name: /^À trier\b/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Profil A 03', { exact: true })).toBeVisible();
    expect(api.searches()).toHaveLength(2);
  });
  test('Théo — nouvelle recherche en échec garde le groupe et les profils déjà chargés', async ({ page }) => {
    const api = await open(page, { configure: true, grouped: true, searchReplies: [
      { count: 25, cursor: 'suite-a' }, { error: 'Recherche indisponible pour le test' },
    ] });
    await panel(page).getByRole('button', { name: 'Rechercher', exact: true }).click();
    await expect(page.getByText('Profil A 03', { exact: true })).toBeVisible();
    const retained = page.getByRole('tab', { name: /^Retenus\b/ });
    await retained.click();
    await page.getByRole('button', { name: 'Nouvelle recherche', exact: true }).click();
    await panel(page).getByRole('button', { name: 'Rechercher', exact: true }).click();
    await expect(page.getByText('Recherche indisponible pour le test', { exact: true })).toBeVisible();
    await expect(retained).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Profil A 01', { exact: true })).toBeVisible();
    expect(api.searches()).toHaveLength(2);
  });
  test('Théo — un nouveau lot partiellement réussi ouvre À trier si le tour suivant échoue', async ({ page }) => {
    const api = await open(page, { configure: true, grouped: true, searchReplies: [
      { count: 25, cursor: 'suite-a' },
      { count: 5, offset: 25, cursor: 'suite-partielle' },
      { error: 'Tour suivant indisponible pour le test' },
    ] });
    await panel(page).getByRole('button', { name: 'Rechercher', exact: true }).click();
    await expect(page.getByText('Profil A 03', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: /^Écartés\b/ }).click();
    await page.getByRole('button', { name: 'Nouvelle recherche', exact: true }).click();
    await panel(page).getByRole('button', { name: 'Rechercher', exact: true }).click();
    await expect(page.getByText('Profil A 26', { exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: /^À trier\b/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Profil A 03', { exact: true })).toHaveCount(0);
    expect(api.searches().map(call => call.cursor ?? null)).toEqual([null, null, 'suite-partielle']);
  });
  test('Théo — filtres édités remplacent Voir la suite par une relance de recherche', async ({ page }) => {
    const api = await open(page, { configure: true });
    await launch(page);
    await page.getByRole('button', { name: 'Nouvelle recherche', exact: true }).click();
    await changeKeywords(page, 'Rust');
    await closeFilters(page);
    await expect(page.getByRole('button', { name: 'Voir la suite', exact: true })).toHaveCount(0);
    const rerun = page.getByRole('button', { name: 'Relancer la recherche', exact: true });
    await expect(rerun).toBeVisible();
    await rerun.click();
    await expect.poll(() => api.searches().length).toBe(2);
    expect(api.searches()[1].cursor).toBeUndefined();
    expect(api.searches()[1].keywords).toBe('Rust');
  });
  test('Théo — double clic sur Voir la suite lance un seul lot et conserve le focus', async ({ page }) => {
    const api = await open(page, { configure: true, searchReplies: [
      { count: 25, cursor: 'suite-a' }, { count: 25, offset: 25, cursor: 'suite-b', delayMs: 400 },
    ] });
    await launch(page);
    const next = page.getByRole('button', { name: 'Voir la suite', exact: true });
    await next.focus();
    await next.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    const loading = page.getByRole('button', { name: 'Chargement de la suite', exact: true });
    await expect(loading).toHaveAttribute('aria-disabled', 'true');
    await expect(loading).toBeFocused();
    await expect(page.getByText('Profil A 26', { exact: true })).toBeVisible();
    await expect(next).toBeFocused();
    expect(api.searches().map(call => call.cursor ?? null)).toEqual([null, 'suite-a']);
  });
  test('Théo — une erreur sur la suite garde le premier lot et permet de réessayer cette même suite', async ({ page }) => {
    const api = await open(page, { configure: true, searchReplies: [
      { count: 25, cursor: 'suite-a' }, { error: 'Suite indisponible pour le test' },
      { count: 25, offset: 25, cursor: null },
    ] });
    await launch(page);
    const next = page.getByRole('button', { name: 'Voir la suite', exact: true });
    await next.click();
    await expect(page.getByText('Suite indisponible pour le test', { exact: true })).toBeVisible();
    await expect(page.getByText('Profil A 01', { exact: true })).toBeVisible();
    await expect(next).toBeEnabled();
    await next.click();
    await expect(page.getByText('Profil A 26', { exact: true })).toBeVisible();
    expect(api.searches().map(call => call.cursor ?? null)).toEqual([null, 'suite-a', 'suite-a']);
  });
  test('Théo — quota atteint explique le clic sur la suite sans nouvelle requête', async ({ page }) => {
    const api = await open(page, { configure: true });
    await launch(page);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('quota:record', {
      detail: { type: 'searchResultsFetched', count: 999999, accountId: 'account-a' },
    })));
    await page.getByRole('button', { name: 'Voir la suite', exact: true }).click();
    await expect(page.getByText('Quota de recherche journalier atteint. Réessayez demain.', { exact: true })).toBeVisible();
    await expect(page.getByText('Profil A 01', { exact: true })).toBeVisible();
    expect(api.searches()).toHaveLength(1);
  });
  test('Claire — fin des lots disponibles ne promet pas que tous les profils annoncés sont chargés', async ({ page }) => {
    const api = await open(page, { configure: true, state: { orgType: 'enterprise' }, searchReplies: [
      { count: 25, total: 400, cursor: null },
    ] });
    await launch(page);
    await expect(page.getByRole('button', { name: 'Voir la suite', exact: true })).toHaveCount(0);
    await expect(page.getByText(/Tous les profils de cette recherche sont chargés/)).toHaveCount(0);
    await expect(page.getByText(/25 profils chargés sur 400/).first()).toBeVisible();
    expect(api.searches()).toHaveLength(1);
  });
  for (const width of [390, 320]) test(`Sophie — suite visible sans défiler et accessible mobile ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 568 });
    const api = await open(page, { configure: true, state: { orgType: 'freelance', collaborator: true }, searchReplies: [
      { count: 25, cursor: 'suite-a' }, { count: 25, offset: 25, cursor: 'suite-b', delayMs: 400 },
    ] });
    await launch(page);
    const next = page.getByRole('button', { name: 'Voir la suite', exact: true });
    const bounds = await next.boundingBox();
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    await next.focus();
    await next.press('Enter');
    await expect(page.getByRole('button', { name: 'Chargement de la suite', exact: true })).toBeFocused();
    await expect(page.getByText('Profil A 26', { exact: true })).toBeVisible();
    await expect(next).toBeFocused();
    expect(api.searches().map(call => call.cursor ?? null)).toEqual([null, 'suite-a']);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(accessibility.violations.map(item => ({ id: item.id, targets: item.nodes.map(node => node.target) }))).toEqual([]);
    await test.info().attach(`mobile-suite-${width}`, { body: await page.screenshot(), contentType: 'image/png' });
  });
  for (const width of [390, 320]) test(`Sophie — filtres et retour mobile ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 568 });
    const api = await open(page, { configure: true, state: { orgType: 'freelance', collaborator: true } });
    await expect(panel(page)).toBeVisible();
    await changeKeywords(page, 'Rust');
    await closeFilters(page);
    await leaveAndReturn(page);
    await expect(topbar(page)).toBeVisible();
    const newSearch = page.getByRole('button', { name: 'Nouvelle recherche', exact: true });
    await newSearch.focus();
    await expect(newSearch).toBeFocused();
    await newSearch.press('Enter');
    await expect(panel(page)).toBeVisible();
    await closeFilters(page);
    await expect(newSearch).toBeFocused();
    const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(accessibility.violations.map(item => ({ id: item.id, targets: item.nodes.map(node => node.target) }))).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const bounds = await newSearch.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
    expect(api.searches()).toHaveLength(0);
    expect(api.errors).toEqual([]);
    await test.info().attach(`mobile-${width}`, { body: await page.screenshot(), contentType: 'image/png' });
  });
});
