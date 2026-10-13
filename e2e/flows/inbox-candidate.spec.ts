import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { inboxCandidateHarnessHtml } from '../fixtures/inbox-candidate/bundle';
import type { CandidateFixtureState, CandidateFixtureWindow, Row } from '../fixtures/inbox-candidate/types';

const require = createRequire(import.meta.url);
const PERSON = 'ACo_fixture_camille';
const LINKEDIN_URL = 'https://www.linkedin.com/in/camille-fixture';
const MISSION_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MISSION_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ready: CandidateFixtureState = { userId: 'user-a', organizationId: 'org-a', organizationType: 'agency', accountId: 'account-a', accountsReady: true, mappingsReady: true };
const detailed = (summary = 'Parcours complet de Camille') => ({ name: 'Camille Durand', provider_id: PERSON, headline: 'Ingénieure logiciel', summary, work_experience: [{ role: 'Développeuse', company: 'Atelier logiciel', description: 'Applications métier', start: { year: 2020, month: 2 } }], education: [{ school: 'Université de Nantes', degree: 'Master' }], skills: [{ name: 'TypeScript' }], languages: [{ name: 'Français' }] });
const missionRow = (id = 'row-a', project = MISSION_A, org = 'org-a') => ({ id, candidate_id: PERSON, candidate_name: 'Camille Durand', candidate_headline: 'Ingénieure logiciel', organization_id: org, linkedin_profile_url: LINKEDIN_URL, linkedin_profile_data: detailed(org === 'org-a' ? 'Parcours organisation A' : 'Parcours organisation B'), project_id: project, job_id: null, mission_name: project === MISSION_A ? 'Mission Alpha' : 'Mission Bêta', status: 'shortlisted', pipeline_stage: 'Pressenti', general_stage: 'retained', score: 84, recommendation: 'go', tags: ['À rencontrer'], updated_at: '2026-10-13T10:00:00Z', created_at: '2026-10-12T10:00:00Z', group_ids: [id], process_step_id: null, contacted_at: null, replied_at: null, first_interview_at: null, hired_at: null, rejected_from_stage: null });

test.describe('Messagerie — vraie fiche candidat commune @critical', () => {
  let html: string;
  test.beforeAll(async () => { html = await inboxCandidateHarnessHtml(); });
  async function open(page: Page, options: {
    state?: Partial<CandidateFixtureState>;
    rows?: Row[];
    snapshot?: Row | null;
    tables?: Record<string, Row[]>;
    failures?: string[];
    delay?: { table: string; org?: string };
    provider?: (body: Row, index: number) => { status?: number; data: Row } | Promise<{ status?: number; data: Row }>;
    linkedMission?: boolean;
    light?: boolean;
  } = {}) {
    const errors: string[] = [];
    const external: string[] = [];
    const blockedImages: string[] = [];
    const calls: Array<{ name: string; body: Row }> = [];
    const blockedLegacyCalls: Array<{ name: string; body: Row }> = [];
    const baselineCalls: Array<{ name: string; body: Row }> = [];
    const baselineNotifications: CandidateFixtureWindow['qaCandidateNotificationWrites'] = [];
    let legacyInboxPhase = true;
    const state = { ...ready, ...options.state };
    const rows = options.rows ?? [missionRow()];
    const profile = options.snapshot === undefined ? detailed() : options.snapshot;
    const tables: Record<string, Row[]> = {
      profiles: [{ user_id: state.userId, active_organization_id: state.organizationId, display_name: 'Laurent' }],
      organization_members: [{ organization_id: 'org-a', user_id: state.userId, role: 'owner', can_enrich_contacts: true }, { organization_id: 'org-b', user_id: state.userId, role: 'owner', can_enrich_contacts: true }],
      mission_candidate_rows: rows,
      job_candidate_status: rows.length ? rows.map(row => ({ ...row, linkedin_profile_data: profile })) : [],
      sourcing_projects: [{ id: MISSION_A, organization_id: 'org-a', name: 'Mission Alpha', job_title: 'Mission Alpha', status: 'active', created_by: state.userId }, { id: MISSION_B, organization_id: 'org-a', name: 'Mission Bêta', job_title: 'Mission Bêta', status: 'active', created_by: state.userId }],
      message_analysis_cache: [{ chat_id: 'chat-a', account_id: state.accountId, updated_at: new Date().toISOString(), analysis: { replySuggestions: [], _messageCount: 1 } }],
      ...options.tables,
    };
    if (options.linkedMission) tables.sequence_enrollments = [{ id: 'enrollment-a', organization_id: state.organizationId, account_id: state.accountId, profile_id: PERSON, profile_name: 'Camille Durand', sequence_id: 'sequence-a', job_id: MISSION_B, project_id: MISSION_B, status: 'paused', current_step: 0, created_at: '2026-10-12T10:00:00Z', outreach_sequences: { name: 'Approche Bêta', project_id: MISSION_B } }];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ state, tables, failures, delay, light }) => {
      const w = window as CandidateFixtureWindow;
      w.qaCandidateState = state; w.qaCandidateTables = tables; w.qaCandidateFailures = failures;
      w.qaCandidateDelayTable = delay?.table; w.qaCandidateDelayOrg = delay?.org;
      document.addEventListener('DOMContentLoaded', () => document.documentElement.classList.toggle('light', light));
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => { throw new Error('Microphone interdit dans le harnais'); }, getDisplayMedia: async () => { throw new Error('Capture interdite dans le harnais'); } } });
    }, { state, tables, failures: options.failures ?? [], delay: options.delay, light: !!options.light });
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: html });
      if (!url.pathname.includes('/qa-candidate-api/')) {
        if (request.resourceType() === 'image' && ['logo.clearbit.com', 'www.google.com'].includes(url.hostname)) blockedImages.push(request.url());
        else external.push(request.url());
        return route.abort();
      }
      const body = (request.postDataJSON() ?? {}) as Row;
      const name = url.pathname.split('/').at(-1)!;
      calls.push({ name, body });
      const allowedRead = name === 'unipile-search' && ['get_chats', 'get_messages', 'get_profile', 'mark_as_read'].includes(String(body.action))
        || name === 'unipile-accounts' && body.action === 'get_attendee_picture'
        || name === 'candidate-actions' && body.action === 'list'
        || name === 'ai-credits' && body.action === 'get_balance';
      if (!allowedRead) {
        const knownLegacy = ['analyze-response', 'generate-reply-suggestions', 'auto-analyze-message'].includes(name) && body.action === undefined
          || name === 'unipile-search' && body.action === 'sync_chat_history';
        if (knownLegacy && legacyInboxPhase) blockedLegacyCalls.push({ name, body });
        else external.push(`${name}:${String(body.action)}`);
        return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Appel interdit dans le harnais' }) });
      }
      let reply: { status?: number; data: Row } = { data: { success: true } };
      if (name === 'ai-credits') reply.data = { success: true, balance: 500, credits: 500, remaining: 500, has_credits: true };
      if (name === 'candidate-actions') reply.data = { success: true, plans: [], messages: [] };
      if (body.action === 'get_chats') reply.data = { success: true, chats: [{ id: 'chat-a', account_id: body.account_id, account_type: 'LINKEDIN', timestamp: '2026-10-13T10:00:00Z', attendees: [{ id: 'internal-attendee-a', provider_id: PERSON, attendee_provider_id: PERSON, name: 'Camille Durand', profile_url: LINKEDIN_URL, headline: 'Ingénieure logiciel' }], last_message: { text: 'Bonjour, disponible vendredi.', timestamp: '2026-10-13T10:00:00Z', is_sender: false } }], cursors: {}, cursor: null };
      if (body.action === 'get_messages') reply.data = { success: true, messages: [{ id: 'message-a', text: 'Bonjour, disponible vendredi.', timestamp: '2026-10-13T10:00:00Z', is_sender: false }], cursor: null };
      if (body.action === 'get_profile') reply = await options.provider?.(body, calls.filter(call => call.body.action === 'get_profile').length - 1) ?? { data: { success: true, profile: body.include_details === true ? detailed('Profil chargé depuis LinkedIn') : { name: 'Camille Durand', provider_id: PERSON, headline: 'Ingénieure logiciel' } } };
      await route.fulfill({ status: reply.status ?? 200, contentType: 'application/json', body: JSON.stringify(reply.data) });
    });
    await page.goto('/inbox-candidate-fixture');
    await page.getByRole('list', { name: 'Conversations', exact: true }).getByText('Camille Durand', { exact: true }).click();
    const finishInboxPhase = async () => {
      await expect(page.getByText('Bonjour, disponible vendredi.', { exact: true }).last()).toBeVisible();
      await page.waitForLoadState('networkidle');
      baselineCalls.splice(0, baselineCalls.length, ...calls);
      const notifications = await page.evaluate(() => (window as CandidateFixtureWindow).qaCandidateNotificationWrites);
      for (const notification of notifications) expect(notification).toEqual({ table: 'notifications', operations: [
        ['update', [{ read_at: expect.any(String) }]], ['eq', ['user_id', state.userId]], ['eq', ['type', 'new_message']],
        ['is', ['read_at', null]], ['eq', ['metadata->>chat_id', 'chat-a']],
      ] });
      baselineNotifications.splice(0, baselineNotifications.length, ...notifications);
      legacyInboxPhase = false;
    };
    await finishInboxPhase();
    return { errors, external, calls, blockedImages, blockedLegacyCalls, baselineCalls, baselineNotifications, beginInboxPhase: () => { legacyInboxPhase = true; }, finishInboxPhase };
  }
  const sheet = (page: Page) => page.getByRole('dialog', { name: 'Camille Durand', exact: true });
  const openSheet = async (page: Page) => { await page.getByRole('button', { name: 'Fiche candidat', exact: true }).click(); await expect(sheet(page)).toBeVisible(); };
  const patch = (page: Page, values: Partial<CandidateFixtureState>) => page.evaluate(values => (window as CandidateFixtureWindow).qaCandidatePatch(values), values);
  async function isolated(page: Page, api: { errors: string[]; external: string[]; calls: Array<{ name: string; body: Row }>; blockedLegacyCalls: Array<{ name: string; body: Row }>; baselineCalls: Array<{ name: string; body: Row }>; baselineNotifications: CandidateFixtureWindow['qaCandidateNotificationWrites'] }, explicitWrites = 0) {
    expect(api.errors).toEqual([]);
    expect(api.external).toEqual([]);
    expect(await page.evaluate(() => (window as CandidateFixtureWindow).qaCandidateWrites)).toHaveLength(explicitWrites);
    expect(await page.evaluate(() => (window as CandidateFixtureWindow).qaCandidateNotificationWrites)).toEqual(api.baselineNotifications);
    expect(api.calls.filter(call => ['send_message', 'create_chat', 'send_invitation', 'generate', 'score', 'consume', 'enrich'].includes(String(call.body.action)))).toEqual([]);
    expect(api.calls.filter(call => ['get_profile', 'get_chats', 'get_messages'].includes(String(call.body.action))).every(call => call.body.account_id !== 'account-colleague')).toBe(true);
    await test.info().attach('transport-isolation', { body: JSON.stringify({ calls: api.calls, baselineCalls: api.baselineCalls, blockedLegacyCalls: api.blockedLegacyCalls, queries: await page.evaluate(() => (window as CandidateFixtureWindow).qaCandidateQueries), writes: await page.evaluate(() => (window as CandidateFixtureWindow).qaCandidateWrites), notifications: await page.evaluate(() => (window as CandidateFixtureWindow).qaCandidateNotificationWrites), external: api.external }), contentType: 'application/json' });
  }
  async function audit(page: Page, label: string) {
    await page.addScriptTag({ content: await readFile(require.resolve('axe-core/axe.min.js'), 'utf8') });
    const result = await page.evaluate(async () => (window as CandidateFixtureWindow).axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } }));
    await test.info().attach(label + '-axe', { body: JSON.stringify(result), contentType: 'application/json' });
    expect(result.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) }))).toEqual([]);
  }

  test('Guillaume — fiche commune, vrais onglets et brouillon conservé après fermeture', async ({ page }) => {
    const api = await open(page);
    const message = page.getByRole('textbox', { name: 'Message', exact: true });
    await message.fill('Merci Camille, rendez-vous vendredi.');
    await openSheet(page);
    await expect(sheet(page).getByRole('tab', { name: 'Profil', exact: true })).toHaveAttribute('aria-selected', 'true');
    for (const name of ['Aperçu', 'Évaluation', 'CV', 'Séquences', 'Notes']) await expect(sheet(page).getByRole('tab', { name, exact: true })).toBeAttached();
    await expect(sheet(page).getByText('Parcours complet de Camille', { exact: true })).toBeVisible();
    await test.info().attach('shared-candidate-desktop', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
    await sheet(page).getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect(message).toHaveValue('Merci Camille, rendez-vous vendredi.');
    await expect(page.getByRole('button', { name: 'Fiche candidat', exact: true })).toBeFocused();
    expect(await page.evaluate(() => (window as CandidateFixtureWindow).qaCandidateAddress)).toBe('/inbox');
    await isolated(page, api);
  });

  test('Claire — le nom cliquable ouvre la même fiche et Escape rend le focus', async ({ page }) => {
    const api = await open(page, { state: { organizationType: 'enterprise' } });
    const opener = page.getByRole('button', { name: 'Ouvrir la fiche de Camille Durand', exact: true });
    await opener.click();
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page).getByText('Parcours complet de Camille', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();
    await isolated(page, api);
  });

  test('Claire — prospect non enregistré, dossier commun et aucune création automatique', async ({ page }) => {
    const api = await open(page, { rows: [], snapshot: null, provider: (_body, index) => ({ data: { success: true, profile: index === 0 ? { name: 'Camille Durand', headline: 'Ingénieure logiciel', location: 'Nantes', throttled_sections: ['experience'] } : { ...detailed('Profil chargé depuis LinkedIn'), throttled_sections: ['education'] } } }) });
    await openSheet(page);
    await expect(sheet(page).getByText('Hors pipeline', { exact: true })).toBeVisible();
    await expect(sheet(page).getByRole('combobox', { name: 'Étape du candidat', exact: true })).toHaveCount(0);
    await expect(sheet(page).getByText('LinkedIn limite temporairement l’accès au détail de ce profil. Réessayez plus tard.', { exact: true })).toBeVisible();
    await expect(sheet(page).getByText('Profil LinkedIn non disponible', { exact: true })).toHaveCount(0);
    expect(api.calls.filter(call => call.body.action === 'get_profile')).toHaveLength(1);
    expect(api.calls.find(call => call.body.action === 'get_profile')?.body).toMatchObject({ account_id: 'account-a', include_details: true, organization_id: 'org-a' });
    await sheet(page).getByRole('button', { name: 'Actualiser depuis LinkedIn', exact: true }).click();
    await expect(sheet(page).getByText('Profil chargé depuis LinkedIn', { exact: true })).toBeVisible();
    await expect(sheet(page).getByText('Certaines rubriques LinkedIn sont temporairement limitées. Les informations disponibles restent affichées.', { exact: true })).toBeVisible();
    await expect(sheet(page).getByText('Profil LinkedIn non disponible', { exact: true })).toHaveCount(0);
    await isolated(page, api);
  });

  test('Théo — plusieurs missions demandent un choix et ouvrent la candidature choisie', async ({ page }) => {
    const api = await open(page, { rows: [missionRow(), { ...missionRow('row-b', MISSION_B), score: 91 }] });
    await page.getByRole('button', { name: 'Fiche candidat', exact: true }).click();
    const chooser = page.getByRole('dialog', { name: 'Fiche de Camille Durand', exact: true });
    await expect(chooser.getByText('Choisissez la candidature à consulter.', { exact: true })).toBeVisible();
    await expect(chooser.getByRole('button', { name: /Mission Alpha/ })).toHaveCount(1);
    await expect(chooser.getByRole('button', { name: /Mission Bêta/ })).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Fiche candidat', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Fiche candidat', exact: true }).click();
    await expect(chooser).toBeVisible();
    await chooser.getByRole('button', { name: /Mission Bêta/ }).click();
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page).getByRole('tab', { name: 'Profil', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(sheet(page).getByRole('button', { name: "Note 91 sur 100, voir l'évaluation", exact: true })).toBeVisible();
    await sheet(page).getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Fiche candidat', exact: true })).toBeFocused();
    await isolated(page, api);
  });

  test('Guillaume — une mission déjà liée choisit sa candidature parmi deux', async ({ page }) => {
    const api = await open(page, { rows: [missionRow(), { ...missionRow('row-b', MISSION_B), score: 91 }], linkedMission: true });
    await openSheet(page);
    await expect(page.getByRole('dialog', { name: 'Fiche de Camille Durand', exact: true })).toHaveCount(0);
    await expect(sheet(page).getByRole('button', { name: "Note 91 sur 100, voir l'évaluation", exact: true })).toBeVisible();
    await isolated(page, api);
  });

  test('Théo — erreur du rattachement puis Réessayer sans créer de prospect par erreur', async ({ page }) => {
    const api = await open(page, { failures: ['mission_candidate_rows'] });
    await page.getByRole('button', { name: 'Fiche candidat', exact: true }).click();
    await expect(page.getByText('Impossible de retrouver la fiche pour le moment.', { exact: true })).toBeVisible();
    await expect(page.getByText('Hors pipeline', { exact: true })).toHaveCount(0);
    await page.evaluate(() => { (window as CandidateFixtureWindow).qaCandidateFailures = []; });
    await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
    await expect(sheet(page)).toBeVisible();
    await isolated(page, api);
  });

  test('Guillaume — actualisation LinkedIn en panne conserve le profil déjà chargé', async ({ page }) => {
    const api = await open(page, { provider: () => ({ status: 503, data: { success: false } }) });
    await openSheet(page);
    await sheet(page).getByRole('button', { name: 'Actualiser depuis LinkedIn', exact: true }).click();
    await expect(sheet(page).getByText(/LinkedIn ne répond pas pour le moment/)).toBeVisible();
    await expect(sheet(page).getByText('Parcours complet de Camille', { exact: true })).toBeVisible();
    await isolated(page, api);
  });

  test('Guillaume — ajouter une note dans le vrai dossier écrit uniquement après le geste', async ({ page }) => {
    const api = await open(page);
    await openSheet(page);
    expect(await page.evaluate(() => (window as CandidateFixtureWindow).qaCandidateWrites)).toEqual([]);
    await sheet(page).getByRole('tab', { name: 'Notes', exact: true }).click();
    await sheet(page).getByRole('button', { name: 'Perso', exact: true }).click();
    await sheet(page).getByRole('textbox', { name: 'Nouvelle note personnelle', exact: true }).fill('Motivation confirmée pendant notre échange.');
    expect(await page.evaluate(() => (window as CandidateFixtureWindow).qaCandidateWrites)).toEqual([]);
    await page.evaluate(() => { (window as CandidateFixtureWindow).qaCandidateAllowedWrites = ['candidate_notes']; });
    await sheet(page).getByRole('button', { name: 'Ajouter la note', exact: true }).click();
    await expect(sheet(page).getByText('Motivation confirmée pendant notre échange.', { exact: true })).toBeVisible();
    const writes = await page.evaluate(() => (window as CandidateFixtureWindow).qaCandidateWrites);
    expect(writes).toHaveLength(1);
    expect(writes[0].table).toBe('candidate_notes');
    expect(writes[0].operations.find(([method]) => method === 'insert')?.[1][0]).toMatchObject({ candidate_id: PERSON, organization_id: 'org-a', created_by: 'user-a', content: 'Motivation confirmée pendant notre échange.' });
    await test.info().attach('explicit-note-write', { body: JSON.stringify(writes), contentType: 'application/json' });
    await isolated(page, api, 1);
  });

  test('Sophie — contexte puis dossier commun et fermeture rendent le focus à la conversation', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const api = await open(page);
    const opener = page.getByRole('button', { name: 'Afficher le contexte candidat', exact: true });
    await opener.click();
    const context = page.getByRole('dialog', { name: 'Contexte candidat', exact: true });
    await expect(context).toBeVisible();
    await audit(page, 'context-before-shared');
    await context.getByRole('button', { name: 'Ouvrir la fiche candidat', exact: true }).click();
    await expect(sheet(page)).toBeVisible();
    await expect(context).toBeHidden();
    await sheet(page).getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect(opener).toBeFocused();
    await isolated(page, api);
  });

  test('Théo — même personne dans deux organisations, notes et appels restent dans leur contexte', async ({ page }) => {
    const tables: Record<string, Row[]> = {
      candidate_contacts: ['org-a', 'org-b'].map((organization_id, index) => ({ organization_id, candidate_id: PERSON, phone: '+33600000001', email: index ? 'camille-beta@example.test' : 'camille-alpha@example.test' })),
      airtable_candidates: ['org-a', 'org-b'].map((organization_id, index) => ({ organization_id, airtable_id: index ? 'airtable-b' : 'airtable-a', linkedin_url: LINKEDIN_URL, full_name: 'Camille Durand' })),
      airtable_notes: ['org-a', 'org-b'].map((organization_id, index) => ({ organization_id, id: `history-${index}`, candidate_airtable_id: index ? 'airtable-b' : 'airtable-a', title: index ? 'Historique Bêta' : 'Historique Alpha', detail: index ? 'Note historique Bêta' : 'Note historique Alpha', note_date: '2026-10-13T10:00:00Z' })),
      phone_calls: ['org-a', 'org-b'].map((organization_id, index) => ({ organization_id, id: `call-${index}`, provider: 'fixture', direction: 'inbound', started_at: '2026-10-13T10:00:00Z', answered_at: '2026-10-13T10:00:01Z', talk_seconds: 120, contact_number_e164: '+33600000001', contact_name: 'Camille Durand', notes: index ? 'Appel uniquement Bêta' : 'Appel uniquement Alpha', tags: [] })),
    };
    const api = await open(page, { rows: [missionRow(), missionRow('row-b', MISSION_A, 'org-b')], tables, delay: { table: 'airtable_notes', org: 'org-a' } });
    await openSheet(page);
    await expect.poll(() => page.evaluate(() => typeof (window as CandidateFixtureWindow).qaCandidateRelease)).toBe('function');
    api.beginInboxPhase();
    await patch(page, { organizationId: 'org-b' });
    await expect(sheet(page)).toBeHidden();
    await page.getByRole('list', { name: 'Conversations', exact: true }).getByText('Camille Durand', { exact: true }).click();
    await api.finishInboxPhase();
    await openSheet(page);
    await expect(sheet(page).getByText('camille-beta@example.test', { exact: true })).toBeVisible();
    await expect(sheet(page).getByText('camille-alpha@example.test', { exact: true })).toHaveCount(0);
    await page.evaluate(() => { const w = window as CandidateFixtureWindow; w.qaCandidateDelayTable = undefined; w.qaCandidateRelease?.(); });
    await sheet(page).getByRole('tab', { name: /^Activité(?:\s+\d+)?$/ }).click();
    await expect(sheet(page).getByText('Note historique Bêta', { exact: true })).toBeVisible();
    await expect(sheet(page).getByText('Appel uniquement Bêta', { exact: true })).toBeVisible();
    await expect(sheet(page).getByText('Note historique Alpha', { exact: true })).toHaveCount(0);
    await expect(sheet(page).getByText('Appel uniquement Alpha', { exact: true })).toHaveCount(0);
    const reads = await page.evaluate(() => (window as CandidateFixtureWindow).qaCandidateQueries.filter(query => ['candidate_contacts', 'airtable_candidates', 'airtable_notes', 'phone_calls'].includes(query.table)));
    expect(reads.some(query => query.table === 'phone_calls')).toBe(true);
    expect(reads.every(query => query.operations.some(([method, args]) => method === 'eq' && args[0] === 'organization_id'))).toBe(true);
    await isolated(page, api);
  });

  for (const width of [320, 390]) test(`Sophie — vrai dossier commun, profil et retour au brouillon mobile ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    const api = await open(page, { light: width === 320, state: { organizationType: 'freelance' } });
    const message = page.getByRole('textbox', { name: 'Message', exact: true });
    await message.fill('Brouillon mobile conservé.');
    await openSheet(page);
    await expect(sheet(page).getByText('Parcours complet de Camille', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(await sheet(page).evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await audit(page, `shared-candidate-${width}`);
    await test.info().attach(`shared-candidate-${width}`, { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
    await sheet(page).getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect(message).toHaveValue('Brouillon mobile conservé.');
    await expect(page.getByRole('button', { name: 'Fiche candidat', exact: true })).toBeFocused();
    await isolated(page, api);
  });
});
