import { test, expect, type Page } from '@playwright/test';
import { sourcingFiltersHarnessHtml } from '../fixtures/sourcing-filters/bundle';
import type { LinkedInFiltersState, RoleFilter } from '../../src/components/outreach/types';

type FixtureWindow = Window & {
  qaFilters: LinkedInFiltersState;
  qaEditFilters: (patch: Partial<LinkedInFiltersState>) => void;
};
type Call = { name: string; body: Record<string, unknown> };

/** Component QA, isolated from authentication, billing, vendors and real
 * searches. Execute with --no-deps; this spec needs no Supabase setup. */
test.describe('Génération des filtres de sourcing @critical', () => {
  let html: string;
  test.beforeAll(async () => { html = await sourcingFiltersHarnessHtml(); });

  async function open(page: Page, api: string, options: { degraded?: boolean; pending?: boolean } = {}) {
    const calls: Call[] = [];
    const errors: string[] = [];
    const unexpected: string[] = [];
    let release = () => {};
    const generationGate = options.pending ? new Promise<void>(resolve => { release = resolve; }) : Promise.resolve();
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      Object.assign(window, {
        qaState: { orgReady: true },
        qaTables: { profiles: [{ user_id: 'user-a', active_organization_id: 'org-a' }] },
      });
    });
    // Deny all outbound requests; only navigation and explicit QA endpoints
    // receive fixture responses. No call can reach billing, LinkedIn or AI.
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (route.request().isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: html });
      if (!url.pathname.startsWith('/qa-api/')) {
        unexpected.push(url.href);
        return route.abort();
      }
      const name = url.pathname.split('/').at(-1)!;
      const body = route.request().postDataJSON() || {};
      calls.push({ name, body });
      let data: Record<string, unknown>;
      if (name === 'ai-credits') {
        data = { has_credits: true, estimated_credits: 1, remaining: 100 };
      } else if (name === 'generate-search-filters') {
        await generationGate;
        data = {
          success: true, degraded: !!options.degraded,
          filters: {
            keywords: 'Python',
            role: ['Data engineer', 'Analytics engineer'].map(keywords => ({
              keywords, priority: 'CAN_HAVE', scope: api === 'classic' ? 'CURRENT_OR_PAST' : 'CURRENT',
            })),
            years_of_experience_min: 0, years_of_experience_max: 8,
            location_keywords: ['Lyon'], location_within_area: 25,
          },
        };
      } else if (name === 'unipile-search') {
        data = body.action === 'get_parameters'
          ? { success: true, items: [{ id: '103442139', title: 'Lyon' }] }
          : { success: true, profiles: [], cursor: null };
      } else {
        unexpected.push(name);
        return route.abort();
      }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.goto(`/sourcing-filters-fixture?api=${api}`);
    await expect(page.getByRole('heading', { name: 'Filtres de sourcing' })).toBeVisible();
    await page.waitForFunction(() => !!(window as FixtureWindow).qaFilters);
    return { calls, errors, unexpected, release };
  }
  const filters = (page: Page) => page.evaluate(() => (window as FixtureWindow).qaFilters);
  const autoFill = (page: Page) => page.getByRole('button', { name: /^Auto-fill/ });
  const prompt = (page: Page) => page.getByPlaceholder(/^Décris le profil/);
  const searched = (calls: Call[]) => calls.filter(call => call.name === 'unipile-search' && call.body.action === 'search');
  async function generated(page: Page) {
    await expect.poll(async () => (await filters(page)).role.length).toBe(3);
    const current = await filters(page);
    expect(current.role.at(-1)?.priority).toBe('DOESNT_HAVE');
    expect(current.location[0].name).toBe('Paris');
    expect(current.calculated_experience_min).toBe(0);
    expect(current.years_of_experience_min).toBeNull();
  }

  test('Guillaume — Classic conserve les alternatives et l’exclusion manuelle dans la requête', async ({ page }) => {
    const audit = await open(page, 'classic');
    await autoFill(page).click();
    await generated(page);
    await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
    await expect.poll(() => searched(audit.calls).length).toBe(1);
    const request = searched(audit.calls)[0].body;
    const title = (request.advanced_keywords as { title: string }).title;
    expect(title).toContain('"Data engineer"');
    expect(title).toContain('OR');
    expect(title).toContain('"Analytics engineer"');
    expect(title).toContain('NOT ("Consultant")');
    expect(request.role).toBeUndefined();
    expect(audit.calls.filter(call => call.body.action === 'get_parameters')).toHaveLength(0);
    expect(audit.errors).toEqual([]);
    expect(audit.unexpected).toEqual([]);
  });

  test('Claire — Recruiter conserve chaque priorité et période native après génération', async ({ page }) => {
    const audit = await open(page, 'recruiter');
    await prompt(page).fill('Data engineer ou Analytics engineer, pas de Consultant');
    await page.getByRole('button', { name: /^Générer les filtres/ }).click();
    await generated(page);
    await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
    await expect.poll(() => searched(audit.calls).length).toBe(1);
    expect(searched(audit.calls)[0].body.role).toEqual((await filters(page)).role);
    expect(audit.errors).toEqual([]);
    expect(audit.unexpected).toEqual([]);
  });

  test('Théo — analyse incomplète et critère hors limite restent explicites, sans lancer de recherche', async ({ page }) => {
    const audit = await open(page, 'classic', { degraded: true });
    const before = await filters(page);
    await autoFill(page).click();
    await expect(page.getByText(/L’analyse est incomplète/)).toBeVisible();
    expect(await filters(page)).toEqual(before);
    const role: RoleFilter = { keywords: 'Intitulé'.repeat(30), priority: 'MUST_HAVE', scope: 'CURRENT_OR_PAST' };
    await page.evaluate(role => (window as FixtureWindow).qaEditFilters({ role: [role] }), role);
    await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
    await expect(page.getByText(/200 caractères/).first()).toBeVisible();
    expect((await filters(page)).role[0].keywords).toBe(role.keywords);
    expect(searched(audit.calls)).toHaveLength(0);
    expect(audit.errors).toEqual([]);
    expect(audit.unexpected).toEqual([]);
  });

  test('Sophie — Sales Navigator mobile utilise les titres natifs et protège les edits pendant l’IA', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const audit = await open(page, 'sales_navigator', { pending: true });
    await prompt(page).fill('Data engineer ou Analytics engineer');
    await prompt(page).press('Enter');
    await expect.poll(() => audit.calls.filter(call => call.name === 'generate-search-filters').length).toBe(1);
    await page.evaluate(() => (window as FixtureWindow).qaEditFilters({ keywords: 'Terraform' }));
    await expect(page.getByRole('button', { name: /^Générer les filtres/ })).toBeEnabled();
    audit.release();
    await expect(autoFill(page)).toBeEnabled();
    expect((await filters(page)).keywords).toBe('Terraform');
    expect((await filters(page)).role).toHaveLength(1);
    await prompt(page).press('Enter');
    await generated(page);
    await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
    await expect.poll(() => searched(audit.calls).length).toBe(1);
    expect(searched(audit.calls)[0].body.job_title).toEqual([
      { id: 'Data engineer', priority: 'MUST_HAVE' },
      { id: 'Analytics engineer', priority: 'MUST_HAVE' },
      { id: 'Consultant', priority: 'DOESNT_HAVE' },
    ]);
    expect(searched(audit.calls)[0].body.role).toBeUndefined();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(audit.errors).toEqual([]);
    expect(audit.unexpected).toEqual([]);
  });
});
