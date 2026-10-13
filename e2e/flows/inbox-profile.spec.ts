import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { profileHarnessHtml } from '../fixtures/inbox-profile/bundle';
import { loadingHarnessHtml } from '../fixtures/inbox-loading/bundle';
import type { FixtureWindow } from '../fixtures/inbox-loading/types';
import type { ProfileFixtureState, ProfileFixtureWindow, Row } from '../fixtures/inbox-profile/types';

const require = createRequire(import.meta.url);
const ready: ProfileFixtureState = { userId: 'user-a', organizationId: 'org-a', accountId: 'account-a', accountsReady: true, mappingsReady: true, profileId: 'candidate-a', profileUrl: 'https://www.linkedin.com/in/camille-a', profileName: 'Camille Durand', aliases: [] };
const detailed = (summary: string) => ({ summary, work_experience: [{ role: 'Ingénieure logiciel', company: 'Équipe produit', start: '2021-01-01' }], education: [{ school: 'Université de Nantes', degree: 'Master' }], skills: [{ name: 'Python' }], languages: [{ name: 'Français' }] });
const row = (organization_id = 'org-a', summary = 'Profil enregistré complet', candidate_id = 'candidate-a', linkedin_profile_url = ready.profileUrl) => ({ organization_id, candidate_id, linkedin_profile_url, linkedin_profile_data: detailed(summary), updated_at: '2026-10-13T10:00:00Z', created_at: '2026-10-12T10:00:00Z' });
const partial = { provider_id: 'candidate-a', first_name: 'Camille', last_name: 'Durand', headline: 'Sales Engineer chez Dataiku', location: 'Paris et périphérie', profile_picture_url: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="40" height="40"%3E%3Crect width="40" height="40" fill="%23888"/%3E%3C/svg%3E' };

test.describe('Messagerie — profil candidat @critical', () => {
  let html: string;
  test.beforeAll(async () => { html = await profileHarnessHtml(); });
  async function open(page: Page, options: {
    state?: Partial<ProfileFixtureState>;
    rows?: Row[];
    tableErrors?: string[];
    missingColumns?: string[];
    queryDelay?: number;
    light?: boolean;
    provider?: (body: Row, index: number) => Promise<{ status?: number; data: Row }> | { status?: number; data: Row };
  } = {}) {
    const calls: Row[] = [];
    const errors: string[] = [];
    const external: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ state, rows, tableErrors, missingColumns, queryDelay, light }) => {
      const w = window as ProfileFixtureWindow;
      w.qaProfileState = state;
      w.qaProfileTables = { job_candidate_status: rows };
      w.qaProfileQueryErrors = tableErrors;
      w.qaProfileMissingColumns = missingColumns;
      w.qaProfileQueryDelay = queryDelay;
      document.addEventListener('DOMContentLoaded', () => document.documentElement.classList.toggle('light', light));
    }, { state: { ...ready, ...options.state }, rows: options.rows ?? [], tableErrors: options.tableErrors ?? [], missingColumns: options.missingColumns ?? [], queryDelay: options.queryDelay ?? 0, light: !!options.light });
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: html });
      if (url.pathname !== '/qa-profile-api') { external.push(request.url()); return route.abort(); }
      const body = request.postDataJSON() as Row;
      calls.push(body);
      const reply = await options.provider?.(body, calls.length - 1) ?? { data: { success: true, profile: detailed('Profil LinkedIn consulté') } };
      // Le lecteur fournisseur renvoie une identité réduite si les rubriques
      // détaillées ne sont pas demandées. Le test doit exercer ce contrat.
      if (body.action === 'get_profile' && body.include_details !== true && reply.data.success && reply.data.profile) {
        const value = reply.data.profile as Row;
        reply.data.profile = Object.fromEntries(['id', 'provider_id', 'name', 'first_name', 'last_name', 'headline', 'location', 'profile_picture_url'].filter(key => value[key] !== undefined).map(key => [key, value[key]]));
      }
      await route.fulfill({ status: reply.status ?? 200, contentType: 'application/json', body: JSON.stringify(reply.data) });
    });
    await page.goto('/inbox-profile-fixture');
    await page.getByRole('button', { name: 'Afficher le contexte candidat', exact: true }).click();
    await page.getByRole('tab', { name: 'Profil', exact: true }).click();
    return { calls, errors, external };
  }
  const patch = (page: Page, value: Partial<ProfileFixtureState>) => page.evaluate(value => (window as ProfileFixtureWindow).qaProfilePatch(value), value);
  const profile = (page: Page) => page.locator('[data-component="candidate-profile"]');
  async function audit(page: Page, label: string) {
    await page.addScriptTag({ content: await readFile(require.resolve('axe-core/axe.min.js'), 'utf8') });
    const result = await page.evaluate(async () => (window as ProfileFixtureWindow).axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } }));
    await test.info().attach(label + '-axe', { body: JSON.stringify(result), contentType: 'application/json' });
    expect(result.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) }))).toEqual([]);
  }
  const clean = (api: { errors: string[]; external: string[] }) => { expect(api.errors).toEqual([]); expect(api.external).toEqual([]); };

  test('Guillaume — profil enregistré complet sans visite LinkedIn', async ({ page }) => {
    const api = await open(page, { rows: [row('org-b', 'Profil hors organisation'), { ...row(), linkedin_profile_data: { headline: 'Instantané récent' } }, row()] });
    await expect(profile(page).getByText('Profil enregistré complet', { exact: true })).toBeVisible();
    await expect(profile(page).getByText('Ingénieure logiciel', { exact: true })).toBeVisible();
    await expect(profile(page).getByText('Université de Nantes', { exact: true })).toBeVisible();
    expect(api.calls).toHaveLength(0);
    expect(await page.evaluate(() => (window as ProfileFixtureWindow).qaProfileQuota)).toEqual([]);
    clean(api);
  });

  test('Guillaume — un instantané identité et photo seuls laisse charger les détails LinkedIn', async ({ page }) => {
    const api = await open(page, { rows: [{ ...row(), linkedin_profile_data: { name: 'Camille Durand', provider_id: 'candidate-a', profile_picture_url: partial.profile_picture_url } }], provider: () => ({ data: { success: true, profile: detailed('Détails retrouvés malgré l’instantané d’identité') } }) });
    await expect(profile(page).getByText('Détails retrouvés malgré l’instantané d’identité', { exact: true })).toBeVisible();
    await expect(page.getByText('Profil LinkedIn non disponible', { exact: true })).toHaveCount(0);
    expect(api.calls).toHaveLength(1);
    clean(api);
  });

  test('Guillaume — un instantané avec seulement intitulé et lieu ne bloque pas le profil détaillé', async ({ page }) => {
    const api = await open(page, { rows: [{ ...row(), linkedin_profile_data: partial }], provider: () => ({ data: { success: true, profile: { ...partial, ...detailed('Parcours détaillé récupéré') } } }) });
    await expect(profile(page).getByText('Parcours détaillé récupéré', { exact: true })).toBeVisible();
    expect(api.calls).toHaveLength(1);
    clean(api);
  });

  test('Claire — succès LinkedIn partiel présente les informations disponibles sans déclarer le profil absent', async ({ page }) => {
    const api = await open(page, { provider: () => ({ data: { success: true, profile: partial } }) });
    await expect(profile(page).getByText(partial.headline, { exact: true })).toBeVisible();
    await expect(profile(page).getByText(partial.location, { exact: true })).toBeVisible();
    await expect(page.getByText('Profil LinkedIn non disponible', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Impossible de charger le profil|Ce profil est introuvable/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Actualiser depuis LinkedIn', exact: true })).toBeVisible();
    await expect(page.getByText('Le parcours détaillé n’est pas disponible pour le moment.', { exact: true })).toBeVisible();
    expect(api.calls).toHaveLength(1);
    await audit(page, 'partial-profile');
    clean(api);
  });

  test('Claire — rubriques limitées par LinkedIn expliquées sans profil déclaré absent', async ({ page }) => {
    const api = await open(page, { provider: () => ({ data: { success: true, profile: { ...partial, throttled_sections: ['experience', 'education'] } } }) });
    await expect(profile(page).getByText(partial.headline, { exact: true })).toBeVisible();
    await expect(page.getByText('LinkedIn limite temporairement l’accès au détail de ce profil. Réessayez plus tard.', { exact: true })).toBeVisible();
    await expect(page.getByText('Profil LinkedIn non disponible', { exact: true })).toHaveCount(0);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].include_details).toBe(true);
    clean(api);
  });

  test('Guillaume — rubriques limitées n’occultent pas les détails effectivement reçus', async ({ page }) => {
    const api = await open(page, { provider: () => ({ data: { success: true, profile: { ...partial, ...detailed('Parcours reçu malgré une rubrique limitée'), throttled_sections: ['education'] } } }) });
    await expect(profile(page).getByText('Parcours reçu malgré une rubrique limitée', { exact: true })).toBeVisible();
    await expect(profile(page).getByText('Ingénieure logiciel', { exact: true })).toBeVisible();
    await expect(page.getByText('Certaines rubriques LinkedIn sont temporairement limitées. Les informations disponibles restent affichées.', { exact: true })).toBeVisible();
    expect(api.calls).toHaveLength(1);
    clean(api);
  });

  test('Claire — fiche partielle enregistrée sans compte conserve intitulé et lieu lisibles', async ({ page }) => {
    const api = await open(page, { state: { accountId: null }, rows: [{ ...row(), linkedin_profile_data: partial }] });
    await expect(profile(page).getByText(partial.headline, { exact: true })).toBeVisible();
    await expect(profile(page).getByText(partial.location, { exact: true })).toBeVisible();
    await expect(page.getByText('Profil LinkedIn non disponible', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Actualiser depuis LinkedIn', exact: true })).toHaveCount(0);
    expect(api.calls).toHaveLength(0);
    clean(api);
  });

  test('Guillaume — actualiser une réponse partielle remplace le contenu par les détails reçus', async ({ page }) => {
    const api = await open(page, { provider: (_body, index) => ({ data: { success: true, profile: index === 0 ? partial : { ...partial, ...detailed('Parcours obtenu après actualisation') } } }) });
    await expect(profile(page).getByText(partial.headline, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Actualiser depuis LinkedIn', exact: true }).click();
    await expect(profile(page).getByText('Parcours obtenu après actualisation', { exact: true })).toBeVisible();
    await expect(profile(page).getByText('Ingénieure logiciel', { exact: true })).toBeVisible();
    expect(api.calls).toHaveLength(2);
    clean(api);
  });

  test('Théo — une actualisation partielle ne supprime pas un résumé déjà chargé', async ({ page }) => {
    const api = await open(page, { rows: [row()], provider: () => ({ data: { success: true, profile: partial } }) });
    await expect(profile(page).getByText('Profil enregistré complet', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Actualiser depuis LinkedIn', exact: true }).click();
    await expect.poll(() => api.calls.length).toBe(1);
    await expect(page.getByRole('button', { name: 'Actualiser depuis LinkedIn', exact: true })).toBeEnabled();
    await expect(profile(page).getByText('Profil enregistré complet', { exact: true })).toBeVisible();
    await expect(profile(page).getByText('Ingénieure logiciel', { exact: true })).toBeVisible();
    clean(api);
  });

  test('Théo — relecture automatique partielle conserve chaque rubrique déjà chargée', async ({ page }) => {
    const api = await open(page, { provider: (_body, index) => ({ data: { success: true, profile: index === 0 ? { ...partial, ...detailed('Parcours complet conservé après relecture') } : { ...partial, throttled_sections: ['experience', 'education'] } } }) });
    await expect(profile(page).getByText('Parcours complet conservé après relecture', { exact: true })).toBeVisible();
    await page.evaluate(() => (window as ProfileFixtureWindow).qaProfileInvalidate());
    await expect(page.getByText('Certaines rubriques LinkedIn sont temporairement limitées. Les informations disponibles restent affichées.', { exact: true })).toBeVisible();
    await expect(profile(page).getByText('Parcours complet conservé après relecture', { exact: true })).toBeVisible();
    await expect(profile(page).getByText('Ingénieure logiciel', { exact: true })).toBeVisible();
    await expect(profile(page).getByText('Université de Nantes', { exact: true })).toBeVisible();
    await expect(profile(page).getByText('Python', { exact: true })).toBeVisible();
    await expect(profile(page).getByText('Français', { exact: true })).toBeVisible();
    expect(api.calls).toHaveLength(2);
    expect(api.calls.every(call => call.include_details === true)).toBe(true);
    clean(api);
  });

  test('Théo — une langue seule enregistrée est un contenu consultable sans fausse indisponibilité', async ({ page }) => {
    const api = await open(page, { rows: [{ ...row(), linkedin_profile_data: { name: 'Camille Durand', headline: partial.headline } }, { ...row(), linkedin_profile_data: { name: 'Camille Durand', languages: [{ name: 'Français', proficiency: 'Langue maternelle' }] } }] });
    await expect(profile(page).getByText('Français · Langue maternelle', { exact: true })).toBeVisible();
    await expect(page.getByText('Profil LinkedIn non disponible', { exact: true })).toHaveCount(0);
    expect(api.calls).toHaveLength(0);
    clean(api);
  });

  test('Guillaume — les formats natifs position et dates puis positions historiques restent complets', async ({ page }) => {
    const native = { ...partial, about: 'À propos natif', work_experience: [{ position: 'Sales Engineer', company: 'Dataiku', start: '2020-09', end: null, current: true }], education: [{ school: 'Université de Nantes', degree: 'Master', start: '2014-09', end: '2016-06' }], skills: ['Avant-vente', 'Python'] };
    const api = await open(page, { provider: () => ({ data: { success: true, profile: native } }) });
    await expect(profile(page).getByText('À propos natif', { exact: true })).toBeVisible();
    await expect(profile(page).getByText('Sales Engineer', { exact: true })).toBeVisible();
    await expect(profile(page).getByText('Dataiku', { exact: true })).toBeVisible();
    await expect(profile(page).getByText('Avant-vente', { exact: true })).toBeVisible();
    await patch(page, { profileId: 'candidate-b', profileUrl: 'https://linkedin.com/in/camille-b', profileName: 'Camille Bernard' });
    await page.evaluate(() => { (window as ProfileFixtureWindow).qaProfileTables.job_candidate_status.push({ organization_id: 'org-a', candidate_id: 'candidate-b', linkedin_profile_url: 'https://linkedin.com/in/camille-b', linkedin_profile_data: { about: 'Résumé historique', positions: [{ title: 'Architecte solutions', company: { name: 'Équipe client' }, start_date: { year: 2018, month: 4 } }], educations: [{ school_name: 'École de Lyon', degree_name: 'Master' }], skills: ['Cloud'] } }); });
    await page.getByRole('tab', { name: 'Profil', exact: true }).click();
    await expect(profile(page).getByText('Résumé historique', { exact: true })).toBeVisible();
    await expect(profile(page).getByText('Architecte solutions', { exact: true })).toBeVisible();
    await expect(profile(page).getByText('École de Lyon', { exact: true })).toBeVisible();
    expect(api.calls).toHaveLength(1);
    clean(api);
  });

  for (const width of [320, 390]) test(`Sophie — réponse partielle et actualisation détaillée mobile ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    const api = await open(page, { light: width === 320, provider: (_body, index) => ({ data: { success: true, profile: index === 0 ? partial : { ...partial, ...detailed('Détails lisibles sur mobile') } } }) });
    await expect(profile(page).getByText(partial.headline, { exact: true })).toBeVisible();
    await expect(profile(page).getByText(partial.location, { exact: true })).toBeVisible();
    await expect(page.getByText('Profil LinkedIn non disponible', { exact: true })).toHaveCount(0);
    const refresh = page.getByRole('button', { name: 'Actualiser depuis LinkedIn', exact: true });
    expect((await refresh.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const dialog = page.getByRole('dialog', { name: 'Contexte candidat', exact: true });
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await audit(page, `partial-mobile-${width}`);
    await test.info().attach(`partial-profile-${width}`, { body: await page.screenshot(), contentType: 'image/png' });
    await refresh.click();
    await expect(profile(page).getByText('Détails lisibles sur mobile', { exact: true })).toBeVisible();
    await audit(page, `partial-refreshed-${width}`);
    await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Afficher le contexte candidat', exact: true })).toBeFocused();
    expect(api.calls).toHaveLength(2);
    clean(api);
  });

  test('Guillaume — profil retrouvé par URL exacte et pas un homonyme', async ({ page }) => {
    const api = await open(page, { state: { profileId: 'chat-provider-id' }, rows: [row('org-a', 'Homonyme exclu', 'other', 'https://linkedin.com/in/camille-a-autre'), row()] });
    await expect(profile(page).getByText('Profil enregistré complet', { exact: true })).toBeVisible();
    await expect(page.getByText('Homonyme exclu', { exact: true })).toHaveCount(0);
    expect(api.calls).toHaveLength(0);
    clean(api);
  });

  test('Claire — sans fiche enregistrée le compte personnel charge LinkedIn', async ({ page }) => {
    const api = await open(page);
    await expect(profile(page).getByText('Profil LinkedIn consulté', { exact: true })).toBeVisible();
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({ action: 'get_profile', organization_id: 'org-a', account_id: 'account-a', profile_id: 'candidate-a', include_details: true });
    expect(await page.evaluate(() => (window as ProfileFixtureWindow).qaProfileQuota)).toEqual([{ type: 'profileVisits', count: 1, accountId: 'account-a' }]);
    await audit(page, 'provider-profile');
    clean(api);
  });

  test('Guillaume — identifiant principal reconnu sans échec lié au slug public', async ({ page }) => {
    const api = await open(page, { state: { profileId: 'ACo_provider_camille', aliases: ['candidate-internal', 'attendee-a'] }, provider: body => body.profile_id === 'ACo_provider_camille' ? { data: { success: true, profile: detailed('Profil par identifiant principal') } } : { status: 404, data: { success: false, error: 'Profil non trouvé' } } });
    await expect(profile(page).getByText('Profil par identifiant principal', { exact: true })).toBeVisible();
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].profile_id).toBe('ACo_provider_camille');
    clean(api);
  });

  test('Guillaume — sans URL les alias triés ne remplacent pas l’identifiant principal', async ({ page }) => {
    const api = await open(page, { state: { profileId: 'Z_provider_camille', profileUrl: null, aliases: ['A_internal', 'B_attendee'] }, provider: body => body.profile_id === 'Z_provider_camille' ? { data: { success: true, profile: detailed('Profil principal sans URL') } } : { status: 404, data: { success: false, error: 'Profil non trouvé' } } });
    await expect(profile(page).getByText('Profil principal sans URL', { exact: true })).toBeVisible();
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].profile_id).toBe('Z_provider_camille');
    clean(api);
  });

  test('Claire — identifiant interne UUID introuvable permet un seul repli sur l’URL LinkedIn', async ({ page }) => {
    const internalId = '11111111-2222-4333-8444-555555555555';
    const api = await open(page, { state: { profileId: internalId }, provider: body => body.profile_id === 'camille-a' ? { data: { success: true, profile: detailed('Profil retrouvé par URL') } } : { status: 404, data: { success: false, errorType: 'PROFILE_NOT_FOUND', error: 'Profil non trouvé' } } });
    await expect(profile(page).getByText('Profil retrouvé par URL', { exact: true })).toBeVisible();
    expect(api.calls.map(call => call.profile_id)).toEqual([internalId, 'camille-a']);
    clean(api);
  });

  test('Théo — ancienne erreur 502 ne prouve pas une absence et ne lance aucun repli', async ({ page }) => {
    const api = await open(page, { provider: body => body.profile_id === 'camille-a' ? { data: { success: true, profile: detailed('Profil retrouvé après réponse historique') } } : { status: 502, data: { success: false, error: 'Profil non trouvé' } } });
    await expect(page.getByText('LinkedIn ne répond pas pour le moment. Réessayez dans quelques instants.', { exact: true })).toBeVisible();
    expect(api.calls.map(call => call.profile_id)).toEqual(['candidate-a']);
    clean(api);
  });

  const failures = [
    { status: 401, text: 'Votre session a expiré. Reconnectez-vous pour consulter ce profil.' },
    { status: 403, text: 'Votre compte ne permet pas de consulter ce profil LinkedIn. Vérifiez votre connexion dans les paramètres.' },
    { status: 429, text: 'La limite de consultation des profils LinkedIn est atteinte. Réessayez plus tard.' },
    { status: 503, text: 'LinkedIn ne répond pas pour le moment. Réessayez dans quelques instants.' },
  ];
  for (const failure of failures) test(`Théo — refus ${failure.status} explicite et aucun repli sur une autre identité`, async ({ page }) => {
    const api = await open(page, { provider: () => ({ status: failure.status, data: { success: false, error: 'INTERNAL PROVIDER details must never appear' } }) });
    await expect(page.getByText(failure.text, { exact: true })).toBeVisible();
    await expect(page.getByText(/INTERNAL PROVIDER/)).toHaveCount(0);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].profile_id).toBe('candidate-a');
    expect(await page.evaluate(() => (window as ProfileFixtureWindow).qaProfileQuota)).toEqual([]);
    clean(api);
  });

  test('Claire — vrai profil introuvable après les deux identités reste explicite', async ({ page }) => {
    const api = await open(page, { provider: () => ({ status: 404, data: { success: false, errorType: 'PROFILE_NOT_FOUND', error: 'Profil non trouvé' } }) });
    await expect(page.getByText('Ce profil est introuvable sur LinkedIn. Vérifiez le lien du candidat.', { exact: true })).toBeVisible();
    expect(api.calls.map(call => call.profile_id)).toEqual(['candidate-a', 'camille-a']);
    clean(api);
  });

  test('Claire — absence de compte et de fiche explicite sans erreur', async ({ page }) => {
    const api = await open(page, { state: { accountId: null } });
    await expect(page.getByText(/Aucun profil détaillé enregistré/)).toBeVisible();
    await expect(page.getByText('Impossible de charger le profil pour le moment.', { exact: true })).toHaveCount(0);
    expect(api.calls).toHaveLength(0);
    await audit(page, 'no-profile');
    clean(api);
  });

  test('Claire — panne LinkedIn puis Réessayer charge le profil', async ({ page }) => {
    const api = await open(page, { provider: (_body, index) => index === 0 ? { status: 503, data: { success: false, error: 'Lecture temporairement indisponible' } } : { data: { success: true, profile: detailed('Profil après reprise') } } });
    await expect(page.getByText('LinkedIn ne répond pas pour le moment. Réessayez dans quelques instants.', { exact: true })).toBeVisible();
    await audit(page, 'profile-error');
    await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
    await expect(profile(page).getByText('Profil après reprise', { exact: true })).toBeVisible();
    expect(api.calls).toHaveLength(2);
    expect(await page.evaluate(() => (window as ProfileFixtureWindow).qaProfileQuota)).toHaveLength(1);
    clean(api);
  });

  test('Guillaume — actualisation en panne conserve la fiche enregistrée', async ({ page }) => {
    const api = await open(page, { rows: [row()], provider: () => ({ status: 503, data: { success: false } }) });
    await expect(profile(page).getByText('Profil enregistré complet', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Actualiser depuis LinkedIn', exact: true }).click();
    await expect(page.getByText('LinkedIn ne répond pas pour le moment. Réessayez dans quelques instants. Le profil précédent reste affiché.', { exact: true })).toBeVisible();
    await expect(profile(page).getByText('Profil enregistré complet', { exact: true })).toBeVisible();
    expect(api.calls).toHaveLength(1);
    expect(await page.evaluate(() => (window as ProfileFixtureWindow).qaProfileQuota)).toEqual([]);
    clean(api);
  });

  test('Guillaume — relecture automatique en panne conserve la fiche chargée et permet une reprise', async ({ page }) => {
    const api = await open(page, { provider: (_body, index) => index === 1 ? { status: 503, data: { success: false } } : { data: { success: true, profile: detailed(index === 0 ? 'Profil chargé conservé' : 'Profil repris') } } });
    await expect(profile(page).getByText('Profil chargé conservé', { exact: true })).toBeVisible();
    await page.evaluate(() => (window as ProfileFixtureWindow).qaProfileInvalidate());
    await expect(page.getByText('LinkedIn ne répond pas pour le moment. Réessayez dans quelques instants. Le profil précédent reste affiché.', { exact: true })).toBeVisible();
    await expect(profile(page).getByText('Profil chargé conservé', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
    await expect(profile(page).getByText('Profil repris', { exact: true })).toBeVisible();
    expect(api.calls).toHaveLength(3);
    clean(api);
  });

  test('Théo — Réessayer attend une réponse et ignore le double clic', async ({ page }) => {
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const api = await open(page, { provider: async (_body, index) => {
      if (index === 0) return { status: 503, data: { success: false } };
      await gate;
      return { data: { success: true, profile: detailed('Reprise après attente') } };
    } });
    const retry = page.getByRole('button', { name: 'Réessayer', exact: true });
    await expect(retry).toBeVisible();
    await retry.click();
    const busy = page.getByRole('button', { name: 'Chargement…', exact: true });
    await expect(busy).toHaveAttribute('aria-disabled', 'true');
    await expect(busy).toBeFocused();
    await busy.click({ force: true });
    expect(api.calls).toHaveLength(2);
    release();
    await expect(profile(page).getByText('Reprise après attente', { exact: true })).toBeVisible();
    clean(api);
  });

  test('Théo — erreurs de lecture en base avec compte personnel passent par LinkedIn', async ({ page }) => {
    const api = await open(page, { tableErrors: ['job_candidate_status'] });
    await expect(profile(page).getByText('Profil LinkedIn consulté', { exact: true })).toBeVisible();
    expect(api.calls).toHaveLength(1);
    clean(api);
  });

  test('Théo — panne en base sans compte reste une erreur et peut être retentée', async ({ page }) => {
    const api = await open(page, { state: { accountId: null }, tableErrors: ['job_candidate_status'], rows: [row()] });
    await expect(page.getByText('Le profil enregistré est temporairement indisponible. Réessayez dans quelques instants.', { exact: true })).toBeVisible();
    await page.evaluate(() => { (window as ProfileFixtureWindow).qaProfileQueryErrors = []; });
    await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
    await expect(profile(page).getByText('Profil enregistré complet', { exact: true })).toBeVisible();
    expect(api.calls).toHaveLength(0);
    clean(api);
  });

  test('Théo — organisation différente avec même personne ne réutilise pas la fiche A', async ({ page }) => {
    const api = await open(page, { rows: [row('org-a', 'Fiche organisation A'), row('org-b', 'Fiche organisation B')] });
    await expect(profile(page).getByText('Fiche organisation A', { exact: true })).toBeVisible();
    await patch(page, { organizationId: 'org-b' });
    await expect(profile(page).getByText('Fiche organisation B', { exact: true })).toBeVisible();
    await expect(page.getByText('Fiche organisation A', { exact: true })).toHaveCount(0);
    const queries = await page.evaluate(() => (window as ProfileFixtureWindow).qaProfileQueries);
    expect(queries.length).toBeGreaterThan(1);
    expect(queries.every(query => query.operations.some(([method, args]) => method === 'eq' && args[0] === 'organization_id' && ['org-a', 'org-b'].includes(String(args[1]))))).toBe(true);
    expect(api.calls).toHaveLength(0);
    clean(api);
  });

  test('Théo — compte et utilisateur différents avec même personne ne réutilisent pas le profil', async ({ page }) => {
    const api = await open(page, { provider: body => ({ data: { success: true, profile: detailed(`Profil compte ${body.account_id}`) } }) });
    await expect(profile(page).getByText('Profil compte account-a', { exact: true })).toBeVisible();
    await patch(page, { accountId: 'account-b' });
    await expect(profile(page).getByText('Profil compte account-b', { exact: true })).toBeVisible();
    await expect(page.getByText('Profil compte account-a', { exact: true })).toHaveCount(0);
    await patch(page, { userId: 'user-b' });
    await expect.poll(() => api.calls.length).toBe(3);
    await expect(profile(page).getByText('Profil compte account-b', { exact: true })).toBeVisible();
    clean(api);
  });

  test('Théo — réponse tardive du candidat A ne remplace pas le candidat B', async ({ page }) => {
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const api = await open(page, { provider: async body => {
      if (body.profile_id === 'candidate-a') await gate;
      return { data: { success: true, profile: detailed(body.profile_id === 'candidate-a' ? 'Ancien candidat A' : 'Candidat B confirmé') } };
    } });
    await expect.poll(() => api.calls.length).toBe(1);
    await expect(page.getByText('Chargement du profil…', { exact: true })).toBeVisible();
    await patch(page, { profileId: 'candidate-b', profileUrl: 'https://linkedin.com/in/camille-b', profileName: 'Camille Bernard' });
    await page.getByRole('tab', { name: 'Profil', exact: true }).click();
    await expect(profile(page).getByText('Candidat B confirmé', { exact: true })).toBeVisible();
    release();
    await expect.poll(() => page.evaluate(() => (window as ProfileFixtureWindow).qaProfileQuota.length)).toBe(2);
    await expect(profile(page).getByText('Candidat B confirmé', { exact: true })).toBeVisible();
    await expect(page.getByText('Ancien candidat A', { exact: true })).toHaveCount(0);
    clean(api);
  });

  test('Théo — actualisation tardive organisation A ne remplace pas la fiche B', async ({ page }) => {
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const api = await open(page, { rows: [row('org-a', 'Fiche A conservée'), row('org-b', 'Fiche B actuelle')], provider: async () => { await gate; return { data: { success: true, profile: detailed('Actualisation A tardive') } }; } });
    await expect(profile(page).getByText('Fiche A conservée', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Actualiser depuis LinkedIn', exact: true }).click();
    await expect.poll(() => api.calls.length).toBe(1);
    await patch(page, { organizationId: 'org-b' });
    await expect(profile(page).getByText('Fiche B actuelle', { exact: true })).toBeVisible();
    release();
    await expect.poll(() => page.evaluate(() => (window as ProfileFixtureWindow).qaProfileQuota.length)).toBe(1);
    await expect(profile(page).getByText('Fiche B actuelle', { exact: true })).toBeVisible();
    await expect(page.getByText('Actualisation A tardive', { exact: true })).toHaveCount(0);
    clean(api);
  });

  for (const width of [320, 390]) test(`Sophie — profil, erreur et retour focus mobile ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    const api = await open(page, { light: width === 320, provider: (_body, index) => index === 0 ? { status: 503, data: { success: false } } : { data: { success: true, profile: detailed('Profil mobile chargé') } } });
    await expect(page.getByText('LinkedIn ne répond pas pour le moment. Réessayez dans quelques instants.', { exact: true })).toBeVisible();
    const retry = page.getByRole('button', { name: 'Réessayer', exact: true });
    expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await audit(page, `mobile-${width}-error`);
    await retry.click();
    await expect(profile(page).getByText('Profil mobile chargé', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const dialog = page.getByRole('dialog', { name: 'Contexte candidat', exact: true });
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await audit(page, `mobile-${width}-profile`);
    await test.info().attach(`mobile-profile-${width}`, { body: await page.screenshot(), contentType: 'image/png' });
    await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Afficher le contexte candidat', exact: true })).toBeFocused();
    clean(api);
  });
});

test.describe('Messagerie — contexte du vrai écran inbox @critical', () => {
  let html: string;
  test.beforeAll(async () => { html = await loadingHarnessHtml(); });
  for (const width of [920, 390]) test(`Guillaume et Sophie — ouvrir le vrai profil inbox et revenir au contexte ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 764 });
    const calls: Row[] = [];
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const w = window as FixtureWindow;
      w.qaState = { authReady: true, orgReady: true, accountsReady: true, accountsLoading: false, mappingsReady: true };
      w.qaTables = { profiles: [{ user_id: 'user-a', active_organization_id: 'org-a' }], message_analysis_cache: [{ chat_id: 'chat-profile', account_id: 'account', updated_at: new Date().toISOString(), analysis: { replySuggestions: [], _messageCount: 1 } }] };
    });
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: html });
      if (!url.pathname.includes('/qa-api/')) return route.abort();
      const body = request.postDataJSON() as Row;
      calls.push(body);
      let data: Row = { success: true };
      if (body.action === 'get_chats') data = { success: true, chats: [{ id: 'chat-profile', account_id: 'account', account_type: 'LINKEDIN', timestamp: '2026-10-13T10:00:00Z', attendees: [{ id: 'A_internal_attendee', name: 'Camille Durand', provider_id: 'Z_provider_camille', attendee_provider_id: 'Z_provider_camille', profile_url: 'https://linkedin.com/in/camille-a' }], last_message: { text: 'À bientôt.', timestamp: '2026-10-13T10:00:00Z', is_sender: false } }], cursors: {}, cursor: null };
      if (body.action === 'get_messages') data = { success: true, messages: [{ id: 'message-profile', text: 'À bientôt.', timestamp: '2026-10-13T10:00:00Z', is_sender: false }], cursor: null };
      if (body.action === 'get_profile') data = body.profile_id === 'Z_provider_camille' ? { success: true, profile: body.include_details === true ? detailed('Profil réel de la conversation') : partial } : { success: false, error: 'Profil non trouvé' };
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.goto('/inbox-profile-integration-fixture');
    await page.getByRole('list', { name: 'Conversations', exact: true }).getByText('Camille Durand', { exact: true }).click();
    const opener = page.getByRole('button', { name: 'Afficher le contexte candidat', exact: true });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Contexte candidat', exact: true });
    await dialog.getByRole('tab', { name: 'Profil', exact: true }).click();
    await expect(dialog.getByText('Profil réel de la conversation', { exact: true })).toBeVisible();
    const profileCalls = calls.filter(call => call.action === 'get_profile');
    expect(profileCalls).toHaveLength(1);
    expect(profileCalls[0]).toMatchObject({ profile_id: 'Z_provider_camille', account_id: 'account', organization_id: 'org-a', include_details: true });
    await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect(opener).toBeFocused();
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
});
