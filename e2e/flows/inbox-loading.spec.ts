import { test, expect, type Page } from '@playwright/test';
import { loadingHarnessHtml } from '../fixtures/inbox-loading/bundle';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { FixtureWindow, FixtureState } from '../fixtures/inbox-loading/types';
const require = createRequire(import.meta.url);
// @critical : exécuté sur chaque PR. Aucun compte réel, modèle ou envoi fournisseur.
test.describe('Messagerie — chargement et interactions @critical', () => {
    let html: string;
    test.beforeAll(async () => { html = await loadingHarnessHtml(); });
    const ready = { authReady: true, orgReady: true, accountsReady: true, accountsLoading: false, mappingsReady: true };
    const chat = { id: 'chat-0', account_id: 'account', account_type: 'LINKEDIN', timestamp: '2026-10-09T09:00:00Z', attendees: [{ id: 'attendee-0', name: 'Camille Durand', provider_id: 'ACo_fixture_camille', attendee_provider_id: 'ACo_fixture_camille', profile_url: 'https://linkedin.com/in/camille-fixture' }], last_message: { text: 'Bonjour, je suis disponible vendredi.', timestamp: '2026-10-09T09:00:00Z', is_sender: false } };
    const email = { id: 'email-0', organization_id: 'org-a', candidate_id: 'candidate-email', project_id: null, account_id: 'mail-account', owner_user_id: 'user-a', provider_message_id: 'mail-provider-0', channel: 'email', service: 'gmail', direction: 'inbound', audience: 'candidate', counterpart: 'Camille Email', sender: 'camille@example.test', recipient: 'laurent@example.test', content: 'Bonjour depuis Gmail.', subject: 'Disponibilités', occurred_at: '2026-10-09T10:00:00Z' };
    async function open(page: Page, options: {
        state?: FixtureState;
        email?: boolean;
        empty?: boolean;
        failHistory?: boolean;
        thread?: boolean;
        light?: boolean;
        pages?: boolean;
        pendingChats?: boolean;
    } = {}) {
        const calls: Array<{
            name: string;
            body: Record<string, unknown>;
        }> = [];
        const errors: string[] = [];
        let failHistory = !!options.failHistory;
        let releaseChats: () => void = () => { };
        const chatGate = options.pendingChats ? new Promise<void>(resolve => { releaseChats = resolve; }) : Promise.resolve();
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(({ state, hasEmail, email, light }) => {
            const w = window as FixtureWindow;
            w.qaState = state;
            w.qaTables = {
                profiles: [{ user_id: 'user-a', active_organization_id: 'org-a' }],
                candidate_action_messages: hasEmail ? [email] : [],
                message_analysis_cache: [{ chat_id: 'chat-0', account_id: 'account', updated_at: new Date().toISOString(), analysis: { replySuggestions: [{ text: 'Bonjour Camille, merci pour votre retour.', type: 'short' }], _messageCount: 1 } }],
            };
            document.addEventListener('DOMContentLoaded', () => document.documentElement.classList.toggle('light', !!light));
        }, { state: { ...ready, ...options.state }, hasEmail: !!options.email, email, light: !!options.light });
        // Intercepter TOUT le réseau : les routes API sont des fixtures et aucune
        // destination externe ne peut être contactée par ce harnais.
        await page.route('**/*', async (route) => {
            const url = new URL(route.request().url());
            if (route.request().isNavigationRequest())
                return route.fulfill({ contentType: 'text/html', body: html });
            if (!url.pathname.includes('/qa-api/'))
                return route.abort();
            const body = route.request().postDataJSON() || {};
            const name = url.pathname.split('/').at(-1)!;
            calls.push({ name, body });
            let data: Record<string, unknown> = { success: true };
            if (name === 'candidate-actions')
                data = { success: true, plans: [], messages: [], channels: [], warnings: [], generation: { estimated: 3, level: 'Standard', styleSummary: 'Naturel', model: 'fixture' } };
            if (body.action === 'get_chats') {
                await chatGate;
                data = failHistory ? { success: false, error: 'Lecture indisponible' } : { success: true, chats: options.empty ? [] : body.cursors ? [{ ...chat, id: 'chat-older', timestamp: '2026-10-08T09:00:00Z', attendees: [{ ...chat.attendees[0], id: 'attendee-older', provider_id: 'ACo_fixture_older', attendee_provider_id: 'ACo_fixture_older', profile_url: 'https://linkedin.com/in/older-fixture', name: 'Candidat ancien' }], last_message: { ...chat.last_message, timestamp: '2026-10-08T09:00:00Z' } }] : [chat], cursors: options.pages && !body.cursors ? { classic: 'page-2' } : {}, cursor: null };
            }
            if (body.action === 'get_messages')
                data = { success: true, messages: [{ id: 'message-0', text: 'Bonjour, je suis disponible vendredi.', timestamp: '2026-10-09T09:00:00Z', is_sender: false }], cursor: null };
            if (body.action === 'get_profile')
                data = { success: true, profile: { id: 'ACo_fixture_camille', provider_id: 'ACo_fixture_camille', name: 'Camille Durand' } };
            if (body.action === 'send_message')
                data = { success: true, message: { id: 'sent-fixture' } };
            await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
        });
        await page.goto(`/inbox-loading-fixture${options.thread ? '?thread=1' : ''}`);
        return { calls, errors, releaseChats, recover: () => { failHistory = false; } };
    }
    const state = (page: Page, patch: FixtureState) => page.evaluate(patch => (window as FixtureWindow).qaSetState(patch), patch);
    const list = (page: Page) => page.getByRole('list', { name: 'Conversations', exact: true });
    const loading = (page: Page) => page.getByRole('status', { name: 'Chargement des conversations' });
    async function audit(page: Page, label: string) {
        await page.addScriptTag({ content: await readFile(require.resolve('axe-core/axe.min.js'), 'utf8') });
        const result = await page.evaluate(async () => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } }));
        await test.info().attach(label + '-axe', { body: JSON.stringify(result), contentType: 'application/json' });
        expect(result.violations.map((item) => ({ id: item.id, nodes: item.nodes.map((node) => node.target) }))).toEqual([]);
    }
    const noFalseEmpty = async (page: Page) => { await expect(page.getByText("Aucune conversation pour l'instant", { exact: true })).toHaveCount(0); await expect(page.getByRole('link', { name: 'Connecter un canal' })).toHaveCount(0); };
    test('Claire — comptes, liaison et session résolus dans un ordre variable', async ({ page }) => {
        const api = await open(page, { state: { authReady: false, accountsReady: false, accountsLoading: true, mappingsReady: false } });
        await expect(loading(page)).toBeVisible();
        await noFalseEmpty(page);
        await audit(page, 'loading');
        await state(page, { accountsReady: true, accountsLoading: false });
        await noFalseEmpty(page);
        await state(page, { authReady: true });
        await expect(loading(page)).toBeVisible();
        await noFalseEmpty(page);
        await state(page, { mappingsReady: true });
        await expect(list(page).getByText('Camille Durand')).toBeVisible();
        expect(api.calls.filter(call => call.body.action === 'get_chats')).toHaveLength(1);
        expect(api.calls.find(call => call.body.action === 'get_chats')?.body.limit).toBe(25);
        expect(api.errors).toEqual([]);
    });
    test('Théo — erreurs de comptes explicites et vrai vide seulement après résolution', async ({ page }) => {
        await open(page, { empty: true, state: { accountsReady: false, accountsError: true, accountsLoading: false } });
        await expect(page.getByText('Impossible de charger vos conversations', { exact: true })).toBeVisible();
        await noFalseEmpty(page);
        await audit(page, 'account-error');
        await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
        await expect(page.getByText("Aucune conversation pour l'instant", { exact: true })).toBeVisible();
    });
    test('Guillaume — une recherche sans résultat permet de charger les anciennes conversations', async ({ page }) => {
        const api = await open(page, { pages: true });
        await expect(list(page).getByText('Camille Durand')).toBeVisible();
        await page.getByPlaceholder('Rechercher', { exact: true }).fill('Candidat ancien');
        await expect(page.getByText('Aucune conversation dans la liste chargée')).toBeVisible();
        await page.getByRole('button', { name: 'Chercher dans toutes les conversations', exact: true }).click();
        await expect(list(page).getByText('Candidat ancien')).toBeVisible();
        expect(api.calls.filter(call => call.body.action === 'get_chats')).toHaveLength(2);
        expect(api.errors).toEqual([]);
    });
    test('Sophie — e-mail utilisable pendant LinkedIn lent, sélection conservée après résolution', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const api = await open(page, { email: true, state: { accountsReady: false, accountsLoading: true, mappingsReady: false }, pendingChats: true });
        await expect(list(page).getByText('Camille Email')).toBeVisible();
        await list(page).getByRole('button', { name: /^Camille Email/ }).click();
        await expect(page.locator('[data-component="multichannel-conversation"]')).toBeVisible();
        await page.locator('[data-component="multichannel-conversation"]').getByRole('button', { name: 'Fiche candidat', exact: true }).click();
        const sheet = page.getByRole('dialog', { name: 'Fiche de Camille Email' });
        await expect(sheet).toBeVisible();
        await state(page, { accountsReady: true, accountsLoading: false, mappingsReady: true });
        await expect.poll(() => api.calls.filter(call => call.body.action === 'get_chats').length).toBe(1);
        await expect(page.locator('[data-component="multichannel-conversation"]')).toBeVisible();
        await expect(sheet).toBeVisible();
        api.releaseChats();
        await expect(page.locator('[aria-label="Conversations"]').getByText('Camille Durand', { exact: true })).toBeAttached();
        await expect(sheet).toBeVisible();
        await sheet.getByRole('button', { name: 'Fermer', exact: true }).click();
        await page.getByRole('button', { name: 'Retour aux conversations', exact: true }).click();
        await expect(list(page).getByText('Camille Durand')).toBeVisible();
        expect(api.errors).toEqual([]);
    });
    for (const width of [390, 320])
        test(`Sophie — réponse mobile ${width}px et aide repliée`, async ({ page }) => {
            await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
            const api = await open(page, { light: width === 320 });
            await list(page).getByText('Camille Durand').click();
            const composer = page.locator('[data-component="message-composer"]');
            await expect(composer).toBeVisible();
            await composer.getByRole('textbox', { name: 'Message', exact: true }).fill('Merci Camille, à vendredi.');
            await composer.getByRole('button', { name: 'Envoyer le message', exact: true }).click();
            await expect.poll(() => api.calls.filter(call => call.body.action === 'send_message').length).toBe(1);
            await expect(composer.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('');
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
            await test.info().attach(`mobile-${width}`, { body: await page.screenshot(), contentType: 'image/png' });
            expect(api.errors).toEqual([]);
        });
    test('Claire — candidat jamais contacté : état vide confirmé, sans erreur LinkedIn', async ({ page }) => {
        const api = await open(page, { thread: true, empty: true });
        await expect(page.getByText('Aucune interaction enregistrée avec ce candidat.', { exact: true })).toBeVisible();
        await expect(page.getByText('Les messages LinkedIn sont temporairement indisponibles.', { exact: true })).toHaveCount(0);
        expect(api.calls.filter(call => call.body.action === 'get_messages')).toHaveLength(0);
        expect(api.errors).toEqual([]);
    });
    test('Théo — interactions candidat : échec réel, nouvelle lecture et messages retrouvés', async ({ page }) => {
        const api = await open(page, { thread: true, failHistory: true });
        await expect(page.getByText('Les messages LinkedIn sont temporairement indisponibles.', { exact: true })).toBeVisible();
        await expect(page.getByText('Aucune interaction enregistrée avec ce candidat.', { exact: true })).toHaveCount(0);
        api.recover();
        await page.getByRole('button', { name: 'Réessayer les messages', exact: true }).click();
        await expect(page.getByText('Bonjour, je suis disponible vendredi.', { exact: true })).toBeVisible();
        await expect(page.getByRole('textbox', { name: 'Répondre à Camille Durand sur LinkedIn', exact: true })).toBeVisible();
        expect(api.errors).toEqual([]);
    });
});
