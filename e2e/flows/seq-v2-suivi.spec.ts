/**
 * Refonte des séquences, lot 5c-2 (partie 1) : interrupteur konekt.sequences-v2,
 * écran « Séquences » de l'organisation et ses accès.
 *
 * Contrat testé (docs/refonte-mission/lot5-plan.md, 5c-2 ; décision 8) :
 * - drapeau éteint : /sequences renvoie vers /missions, aucune entrée dans la
 *   barre latérale ni dans la palette Ctrl J ;
 * - ?sequences-v2=1 allume : entrée « Séquences » de la rangée basse (lien,
 *   page courante), palette Ctrl J, « G puis S » ;
 * - tableau : interrupteur (pause immédiate avec « Annuler », lot 5b), barre
 *   des inscrits, alerte par cause, taux à partir de 5 contactés ;
 * - « Envoyer les actions du jour » sur les séquences actives de
 *   l'organisation, avec la confirmation actuelle (process-sequences réel) ;
 * - « Supprimer » derrière « Supprimer cette séquence ? » ; onglet Modèles ;
 * - écran lisible à 360 px, sans défilement horizontal (captures jointes) ;
 * - page d'une séquence (partie 2) : en-tête (fil d'Ariane par la mission,
 *   « Renommer la séquence »), onglet Candidats (puces sans zéro, statut et
 *   prochaine action, Parcours, pause et arrêt avec « Annuler »), Journal
 *   (carte « État de l'envoi », file paginée par curseur sur 600 étapes),
 *   Réglages enregistrés, menu « ... » (Dupliquer, Enregistrer comme modèle,
 *   Supprimer, « Envoyer les actions du jour » de cette séquence seulement),
 *   collaborateur limité à ses lignes, captures à 1 280 et 360 px.
 *
 * Exige la stack locale (E2E_EDGE_FUNCTIONS=1) : nudge_sequences et la mise
 * en pause tournent pour de vrai. Seule la liste des comptes LinkedIn du
 * prestataire est simulée dans le navigateur. Les gardes drapeau éteint
 * (premier bloc, @smoke) n'appellent aucune fonction serveur : elles tournent
 * aussi sur la CI de PR, sans E2E_EDGE_FUNCTIONS.
 */
import { randomUUID } from 'node:crypto';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import {
  addMember,
  admin,
  seedEnrollment,
  seedExecution,
  seedLinkedInAccount,
  seedMission,
  seedSequence,
  setOrgPlan,
  storageStateForUser,
  type TestUser,
} from '../helpers/supabase-admin';

const EDGE_DEPLOYED = process.env.E2E_EDGE_FUNCTIONS === '1';
const EDGE_SKIP_REASON = 'process-sequences non déployée sur cet environnement (E2E_EDGE_FUNCTIONS=1 pour activer)';
test.describe.configure({ timeout: 180_000 });

const rand = () => Math.random().toString(36).slice(2, 8);
const HOUR = 3600 * 1000;

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
});

async function openAs(browser: Browser, user: TestUser, accountIds: string[], viewport?: { width: number; height: number }): Promise<Page> {
  const context = await browser.newContext({ storageState: await storageStateForUser(user), ...(viewport ? { viewport } : {}) });
  contexts.push(context);
  await context.route('**/functions/v1/unipile-accounts', async (route) => {
    let action: string | undefined;
    try {
      action = (route.request().postDataJSON() as { action?: string } | null)?.action;
    } catch {
      /* pré-vol CORS */
    }
    if (action !== 'list') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        accounts: accountIds.map((id) => ({ id, account_status: 'OK', provider: 'LINKEDIN', name: 'E2E LinkedIn' })),
      }),
    });
  });
  return context.newPage();
}

const toast = (page: Page, text: string) => page.locator('[data-sonner-toast]').filter({ hasText: text });

/**
 * Séquence de mission avec 7 inscrits : 4 en cours déjà contactés (une étape
 * envoyée), 2 qui ont répondu, 1 en échec ; 4 invitations envoyées, 2
 * acceptées. Contactés = 6 : « Rép. » 33 %, « Accept. » 50 %.
 */
async function seedTrackedSequence(orgId: string, ownerId: string, missionId: string, accountId: string) {
  const name = `Approche suivi ${rand()}`;
  const { sequenceId, steps } = await seedSequence(orgId, ownerId, [
    { action_type: 'message', delay_days: 1 },
    { action_type: 'message', delay_days: 1 },
  ]);
  await admin().from('outreach_sequences').update({ name, project_id: missionId }).eq('id', sequenceId);
  const enroll = (overrides: Record<string, unknown>) => seedEnrollment(orgId, sequenceId, ownerId, {
    account_id: accountId,
    profile_url: `https://www.linkedin.com/in/e2e-${rand()}`,
    user_timezone: 'Europe/Paris',
    ...overrides,
  });
  const active: string[] = [];
  for (const who of ['Alice Martin', 'Bruno Petit', 'Chloé Durand', 'David Moreau']) {
    const id = await enroll({ profile_name: who, current_step_order: 1 });
    await seedExecution(orgId, id, steps[0], { status: 'sent', scheduled_at: new Date(Date.now() - 24 * HOUR).toISOString(), executed_at: new Date(Date.now() - 24 * HOUR).toISOString() });
    // Prochaine étape plus tard aujourd'hui ou demain : jamais échue pendant le test.
    await seedExecution(orgId, id, steps[1], { scheduled_at: new Date(Date.now() + 20 * HOUR).toISOString() });
    active.push(id);
  }
  await enroll({ profile_name: 'Emma Roux', status: 'replied', replied_at: new Date().toISOString() });
  await enroll({ profile_name: 'Fanny Blanc', status: 'replied', replied_at: new Date().toISOString() });
  await enroll({ profile_name: 'Gilles Noir', status: 'paused', pause_reason: 'send_failed' });
  const { error } = await admin().from('sequence_analytics').insert({
    sequence_id: sequenceId,
    organization_id: orgId,
    date: new Date().toISOString().slice(0, 10),
    invites_sent: 4,
    invites_accepted: 2,
  });
  if (error) throw new Error(`sequence_analytics: ${error.message}`);
  return { sequenceId, name, active };
}

// Drapeau éteint : rien de visible ne change (critère de fin du 5c-2). Aucune fonction serveur appelée.
test.describe('Séquences v2 — drapeau éteint (lot 5c-2)', () => {
  test('@smoke drapeau éteint : /sequences renvoie vers les missions, aucune entrée dans la barre ni la palette', async ({ browser, org }) => {
    const account = await seedLinkedInAccount(org.orgId, org.owner.userId, `acc_e2e_${rand()}`);
    const page = await openAs(browser, org.owner, [account]);
    await page.goto('/sequences', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/missions(\?|$)/, { timeout: 30_000 });
    await expect(page.getByRole('link', { name: 'Agenda' }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('link', { name: 'Séquences', exact: true })).toHaveCount(0);
    await page.keyboard.press('Control+j');
    const palette = page.getByRole('dialog', { name: 'Aller à' });
    await expect(palette).toBeVisible();
    await expect(palette.getByRole('option', { name: /Tâches/ })).toBeVisible();
    await expect(palette.getByRole('option', { name: /Séquences/ })).toHaveCount(0);
  });

  test('@smoke drapeau éteint : « Diagnostic des envois » de la mission garde ses chiffres à la réouverture', async ({ browser, org }) => {
    const owner = org.owner;
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
    const missionId = await seedMission(org.orgId, owner.userId, { name: 'Mission diagnostic' });
    const { sequenceId } = await seedSequence(org.orgId, owner.userId, [{ action_type: 'message' }]);
    const name = `Séquence diagnostic ${rand()}`;
    await admin().from('outreach_sequences').update({ name, project_id: missionId }).eq('id', sequenceId);
    const page = await openAs(browser, owner, [account]);
    await page.goto(`/missions/${missionId}?tab=outreach`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    // Drapeau éteint : le nom n'est pas un lien vers la page de la séquence.
    await expect(page.locator('a[href^="/sequences"]')).toHaveCount(0);

    const openDiagnostic = async () => {
      await page.getByRole('button', { name: 'Plus d\'actions' }).first().click();
      await page.getByRole('menuitem', { name: 'Diagnostic des envois' }).click();
      return page.getByRole('dialog', { name: 'Diagnostic des envois' });
    };
    let dialog = await openDiagnostic();
    await expect(dialog.getByText('Invitations LinkedIn de la semaine')).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // Réouverture avec une lecture lente : les chiffres déjà lus restent affichés pendant l'actualisation.
    await page.route('**/rest/v1/cron_heartbeat*', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      await route.continue();
    });
    dialog = await openDiagnostic();
    await expect(dialog.getByText('Invitations LinkedIn de la semaine')).toBeVisible({ timeout: 1_000 });
    await expect(dialog.getByRole('status', { name: 'Chargement du diagnostic' })).toHaveCount(0);
  });
});

test.describe('Séquences v2 — écran de l’organisation (lot 5c-2)', () => {
  test.skip(!EDGE_DEPLOYED, EDGE_SKIP_REASON);

  test('drapeau allumé : barre latérale, tableau, pause immédiate avec « Annuler », actions du jour, suppression', async ({ browser, org }) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    await admin().from('profiles').upsert({ user_id: owner.userId, display_name: 'Guillaume Martin' }, { onConflict: 'user_id' });
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
    const missionId = await seedMission(org.orgId, owner.userId, { name: 'Directeur financier', client_name: 'Groupe Hélios' });
    const tracked = await seedTrackedSequence(org.orgId, owner.userId, missionId, account);
    const draft = await seedSequence(org.orgId, owner.userId, [{ action_type: 'message' }]);
    const draftName = `Approche contrôleur ${rand()}`;
    await admin().from('outreach_sequences').update({ name: draftName, is_active: false }).eq('id', draft.sequenceId);

    const page = await openAs(browser, owner, [account]);
    // ?sequences-v2=1 sur une autre page : l'interrupteur s'allume et le paramètre quitte l'adresse.
    await page.goto('/dashboard?sequences-v2=1', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
    const entry = page.getByRole('link', { name: 'Séquences', exact: true });
    await expect(entry).toBeVisible({ timeout: 30_000 });
    await entry.click();
    await expect(page).toHaveURL(/\/sequences$/);
    await expect(entry).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { level: 1, name: 'Séquences' })).toBeVisible();

    // Ligne suivie : mission, barre, alerte, taux.
    const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: tracked.name }) });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.getByText('Directeur financier · Groupe Hélios · Guillaume Martin')).toBeVisible();
    await expect(row.getByRole('img', { name: '4 en cours, 2 ont répondu, 1 en échec' }).filter({ visible: true })).toBeVisible();
    await expect(row.getByText('1 en échec')).toBeVisible();
    await expect(row.getByRole('link', { name: 'Voir les erreurs' })).toHaveAttribute('href', new RegExp(`/sequences/${tracked.sequenceId}\\?onglet=candidats&statut=en-echec`));
    // Une seule colonne visible à cette largeur (la ligne du téléphone est masquée).
    await expect(row.getByText('50 %').filter({ visible: true })).toBeVisible({ timeout: 20_000 });
    await expect(row.getByText('33 %').filter({ visible: true })).toBeVisible();
    // Brouillon : aucun inscrit, aucun taux, aucun zéro.
    const draftRow = page.getByRole('row').filter({ has: page.getByRole('link', { name: draftName }) });
    await expect(draftRow.getByText('Brouillon', { exact: true })).toBeVisible();
    await expect(draftRow.getByText('aucun candidat inscrit').filter({ visible: true })).toBeVisible();
    await expect(draftRow.getByText(/\b0\b/)).toHaveCount(0);
    // Brouillon : pas d'interrupteur (maquette), il s'active depuis sa page.
    await expect(draftRow.getByRole('switch')).toHaveCount(0);
    await expect(page.getByText('Un taux s’affiche à partir de 5 candidats contactés.')).toHaveCount(0);

    // Pause immédiate de la séquence, puis « Annuler » (lot 5b).
    await row.getByRole('switch', { name: `Mettre en pause la séquence ${tracked.name}` }).click();
    const paused = toast(page, 'Séquence mise en pause : 4 candidats en pause.');
    await expect(paused).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await admin().from('outreach_sequences').select('is_active').eq('id', tracked.sequenceId).single()).data?.is_active).toBe(false);
    await paused.getByRole('button', { name: 'Annuler' }).click();
    await expect.poll(async () => (await admin().from('outreach_sequences').select('is_active').eq('id', tracked.sequenceId).single()).data?.is_active, { timeout: 20_000 }).toBe(true);
    await expect.poll(async () => {
      const { data } = await admin().from('sequence_enrollments').select('status').in('id', tracked.active);
      return (data ?? []).filter((r) => r.status === 'active').length;
    }, { timeout: 20_000 }).toBe(4);

    // « Envoyer les actions du jour » : confirmation actuelle, appel réel sur les
    // séquences actives que la personne gère (le brouillon désactivé n'y est pas).
    await page.getByRole('button', { name: 'Envoyer les actions du jour' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Envoyer maintenant les actions du jour ?' });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByText(/votre séquence active/)).toBeVisible();
    const nudgeRequest = page.waitForRequest((r) => r.url().includes('/functions/v1/process-sequences') && r.method() === 'POST');
    await confirm.getByRole('button', { name: 'Envoyer maintenant' }).click();
    const nudgeBody = (await nudgeRequest).postDataJSON() as { action?: string; sequence_ids?: string[] };
    expect(nudgeBody.action).toBe('nudge_sequences');
    expect(nudgeBody.sequence_ids).toEqual([tracked.sequenceId]);
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: /avancée|Rien à avancer pour aujourd’hui\./ }).first()).toBeVisible({ timeout: 20_000 });
    await expect(toast(page, 'Les actions du jour n’ont pas pu être avancées')).toHaveCount(0);

    // Palette Ctrl J et « G puis S ».
    await page.goto('/tasks', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('link', { name: 'Séquences', exact: true })).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press('Control+j');
    const palette = page.getByRole('dialog', { name: 'Aller à' });
    await expect(palette).toBeVisible();
    await palette.getByRole('option', { name: /Séquences/ }).click();
    await expect(page).toHaveURL(/\/sequences$/);
    await page.goto('/tasks', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('link', { name: 'Séquences', exact: true })).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('g');
    await page.keyboard.press('s');
    await expect(page).toHaveURL(/\/sequences$/);

    // Onglet Modèles : les modèles Konekt du code.
    await page.getByRole('tab', { name: 'Modèles' }).click();
    await expect(page).toHaveURL(/onglet=modeles/);
    for (const name of ['Invitation puis message', 'Vérifier la connexion d’abord', 'Séquence longue (17 étapes)']) {
      await expect(page.getByRole('heading', { name })).toBeVisible();
    }
    await page.getByRole('tab', { name: 'Toutes' }).click();

    // Supprimer : menu « ... », puis la confirmation.
    await draftRow.getByRole('button', { name: `Actions de la séquence ${draftName}` }).click();
    await page.getByRole('menuitem', { name: 'Supprimer' }).click();
    const del = page.getByRole('alertdialog', { name: 'Supprimer cette séquence ?' });
    await expect(del).toBeVisible();
    await del.getByRole('button', { name: 'Supprimer définitivement' }).click();
    await expect(toast(page, 'Séquence supprimée')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('link', { name: draftName })).toHaveCount(0);

    // « Dupliquer » depuis l'écran : même nom de copie que la page (« Copie de … »).
    await row.getByRole('button', { name: `Actions de la séquence ${tracked.name}` }).click();
    await page.getByRole('menuitem', { name: 'Dupliquer' }).click();
    await expect.poll(async () => (await admin().from('outreach_sequences').select('id').eq('organization_id', org.orgId).eq('name', `Copie de ${tracked.name}`)).data?.length ?? 0, { timeout: 20_000 }).toBe(1);
    await expect(page.getByRole('link', { name: `Copie de ${tracked.name}` })).toBeVisible({ timeout: 20_000 });

    // Panneau de la mission, drapeau allumé : le nom mène à la page de la séquence, et « Toutes les séquences de l'organisation » à l'écran.
    await page.goto(`/missions/${missionId}?tab=outreach`, { waitUntil: 'domcontentloaded' });
    const nameLink = page.getByRole('link', { name: tracked.name, exact: true });
    await expect(nameLink).toHaveAttribute('href', `/sequences/${tracked.sequenceId}?depuis=mission:${missionId}`, { timeout: 30_000 });
    await expect(page.getByRole('link', { name: /Toutes les séquences de l.organisation/ })).toHaveAttribute('href', '/sequences');
    await nameLink.click();
    await expect(page.getByRole('heading', { level: 1, name: tracked.name })).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(new RegExp(`/sequences/${tracked.sequenceId}\\?depuis=mission`));
  });

  test('téléphone : la rangée basse tient dans la feuille avec Séquences, cibles de 44 px', async ({ browser, org }, testInfo) => {
    const account = await seedLinkedInAccount(org.orgId, org.owner.userId, `acc_e2e_${rand()}`);
    const context = await browser.newContext({
      storageState: await storageStateForUser(org.owner),
      viewport: { width: 360, height: 780 },
      isMobile: true,
      hasTouch: true,
    });
    contexts.push(context);
    await context.route('**/functions/v1/unipile-accounts', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, accounts: [{ id: account, account_status: 'OK', provider: 'LINKEDIN', name: 'E2E LinkedIn' }] }),
    }));
    const page = await context.newPage();
    await page.goto('/dashboard?sequences-v2=1', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Afficher ou masquer la navigation' }).click();
    const sheet = page.getByRole('dialog').filter({ has: page.getByRole('link', { name: 'Paramètres', exact: true }) });
    const entry = sheet.getByRole('link', { name: 'Séquences', exact: true });
    await expect(entry).toBeVisible({ timeout: 30_000 });
    // Fin de l'ouverture de la feuille (elle glisse depuis la gauche) avant de mesurer.
    await expect.poll(async () => Math.round((await sheet.boundingBox())?.x ?? -1)).toBe(0);
    const sheetBox = await sheet.boundingBox();
    // Rangée entière : aucune cible qui déborde (six cibles de 44 px dans le tiroir).
    const bottomRow = entry.locator('xpath=..');
    expect(await bottomRow.evaluate((el) => el.scrollWidth - el.clientWidth), 'rangée sans débordement').toBeLessThanOrEqual(0);
    const rowBox = await bottomRow.boundingBox();
    const targets = bottomRow.locator(':scope > a, :scope > button');
    expect(await targets.count()).toBeGreaterThanOrEqual(5);
    for (const target of await targets.all()) {
      const box = await target.boundingBox();
      expect(box, 'cible mesurable').not.toBeNull();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect((box?.x ?? 0) + (box?.width ?? 0), 'dans la rangée').toBeLessThanOrEqual((rowBox?.x ?? 0) + (rowBox?.width ?? 0) + 0.5);
      expect((box?.x ?? 0) + (box?.width ?? 0), 'dans la feuille').toBeLessThanOrEqual((sheetBox?.x ?? 0) + (sheetBox?.width ?? 0));
    }
    const path = testInfo.outputPath('barre-360.png');
    await page.screenshot({ path });
    await testInfo.attach('barre-360', { path, contentType: 'image/png' });
  });

  test('écran lisible à 1 280 et 360 px, sans défilement horizontal', async ({ browser, org }, testInfo) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    await admin().from('profiles').upsert({ user_id: owner.userId, display_name: 'Guillaume Martin' }, { onConflict: 'user_id' });
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
    const missionId = await seedMission(org.orgId, owner.userId, { name: 'Directeur financier', client_name: 'Groupe Hélios' });
    const tracked = await seedTrackedSequence(org.orgId, owner.userId, missionId, account);
    const shared = await seedSequence(org.orgId, owner.userId, [{ action_type: 'message' }]);
    await admin().from('outreach_sequences').update({ name: 'Relance vivier finance', is_active: false }).eq('id', shared.sequenceId);

    for (const viewport of [{ width: 1280, height: 800 }, { width: 360, height: 780 }]) {
      const page = await openAs(browser, owner, [account], viewport);
      await page.goto('/sequences?sequences-v2=1', { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/\/sequences$/, { timeout: 30_000 });
      await expect(page.getByRole('link', { name: tracked.name })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole('button', { name: 'Créer une séquence' })).toBeVisible();
      if (viewport.width >= 1024) await expect(page.getByText('50 %').filter({ visible: true })).toBeVisible({ timeout: 20_000 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `défilement horizontal à ${viewport.width} px`).toBeLessThanOrEqual(0);
      const path = testInfo.outputPath(`sequences-${viewport.width}.png`);
      await page.screenshot({ path, fullPage: true });
      await testInfo.attach(`sequences-${viewport.width}`, { path, contentType: 'image/png' });
      if (viewport.width < 1024) continue;
      // Autres onglets, pour la relecture visuelle.
      for (const [tab, ready] of [
        ['À venir', page.getByRole('searchbox', { name: 'Rechercher dans le journal' })],
        ['Modèles', page.getByRole('heading', { name: 'Invitation puis message' })],
        ['Statistiques', page.getByRole('combobox', { name: 'Période' })],
      ] as const) {
        await page.getByRole('tab', { name: tab }).click();
        await expect(ready).toBeVisible({ timeout: 20_000 });
        const tabPath = testInfo.outputPath(`sequences-${viewport.width}-${tab.normalize('NFD').replace(/[^a-zA-Z]/g, '')}.png`);
        await page.screenshot({ path: tabPath, fullPage: true });
        await testInfo.attach(`sequences-${viewport.width}-${tab}`, { path: tabPath, contentType: 'image/png' });
      }
    }
  });
});

// ─── Partie 2 : page d'une séquence (/sequences/:id) ─────────────────────────

const DAY = 24 * HOUR;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const AI_REVIEW_REASON = "Message rédigé par l'IA à relire avant l'envoi.";

/**
 * Séquence à branches de la maquette (visite, vérification, message A/B,
 * relance ; invitation, attente avec repli InMail) et huit inscrits : quatre
 * en cours (deux messages prévus, une attente d'acceptation, un message IA à
 * relire), deux réponses, un échec d'envoi, un arrêt manuel.
 */
async function seedDetailSequence(orgId: string, ownerId: string, missionId: string, accountId: string) {
  const name = `Approche Directeur financier ${rand()}`;
  const { data: seq, error } = await admin()
    .from('outreach_sequences')
    .insert({ name, organization_id: orgId, created_by: ownerId, is_active: true, project_id: missionId })
    .select('id')
    .single();
  if (error || !seq) throw new Error(`séquence : ${error?.message}`);
  const sequenceId = seq.id as string;
  const id = { visit: randomUUID(), check: randomUUID(), msgA: randomUUID(), msgB: randomUUID(), relance: randomUUID(), invite: randomUUID(), wait: randomUUID(), inmail: randomUUID() };
  // Insertion groupée : toutes les lignes portent les mêmes colonnes (l'API met NULL aux absentes).
  const { error: stepsError } = await admin().from('sequence_steps').insert(([] as Array<Record<string, unknown>>).concat([
    { id: id.visit, sequence_id: sequenceId, step_order: 0, action_type: 'profile_visit' },
    { id: id.check, sequence_id: sequenceId, step_order: 1, action_type: 'check_connection', delay_days: 1, if_true_goto_step: id.msgA, if_false_goto_step: id.invite },
    { id: id.msgA, sequence_id: sequenceId, step_order: 2, action_type: 'message', variant_group: 'A', next_step_id: id.relance, message_template: 'Bonjour {{prenom}}, votre parcours chez {{entreprise_actuelle}} a retenu mon attention.' },
    { id: id.msgB, sequence_id: sequenceId, step_order: 2, action_type: 'message', variant_group: 'B', next_step_id: id.relance, message_template: 'Bonjour {{prenom}}, je recrute un {{poste_recherche}}.' },
    { id: id.relance, sequence_id: sequenceId, step_order: 3, action_type: 'message', delay_days: 5, ends_sequence: true, message_template: 'Je me permets de revenir vers vous.' },
    { id: id.invite, sequence_id: sequenceId, step_order: 4, action_type: 'connection_request', next_step_id: id.wait, message_template: 'Bonjour {{prenom}}, échangeons sur un poste.' },
    { id: id.wait, sequence_id: sequenceId, step_order: 5, action_type: 'wait_connection', timeout_days: 10, wait_for_event: 'connection_accepted', timeout_branch_step_id: id.inmail, next_step_id: id.relance },
    { id: id.inmail, sequence_id: sequenceId, step_order: 6, action_type: 'inmail', ends_sequence: true, subject_template: 'Poste de directeur financier', message_template: 'Bonjour {{prenom}}, un mot sur un poste.' },
  ]).map((row) => ({ delay_days: 0, ends_sequence: false, ...row })));
  if (stepsError) throw new Error(`étapes : ${stepsError.message}`);
  const step = (stepId: string, order: number) => ({ id: stepId, step_order: order, action_type: '' });
  const enroll = (profile_name: string, overrides: Record<string, unknown> = {}) => seedEnrollment(orgId, sequenceId, ownerId, {
    account_id: accountId,
    profile_name,
    profile_headline: 'Directeur administratif et financier',
    profile_url: `https://www.linkedin.com/in/e2e-${rand()}`,
    user_timezone: 'Europe/Paris',
    ...overrides,
  });
  const exec = (enrollmentId: string, stepId: string, order: number, overrides: Record<string, unknown>) =>
    seedExecution(orgId, enrollmentId, step(stepId, order), overrides);
  const sent = (offset: number) => ({ status: 'sent', scheduled_at: iso(offset), executed_at: iso(offset) });

  const alice = await enroll('Alice Martin', { current_step_order: 2 });
  await exec(alice, id.visit, 0, sent(-2 * DAY));
  await exec(alice, id.check, 1, sent(-DAY));
  await exec(alice, id.msgA, 2, { scheduled_at: iso(20 * HOUR) });
  const bruno = await enroll('Bruno Petit', { current_step_order: 2 });
  await exec(bruno, id.visit, 0, sent(-2 * DAY));
  await exec(bruno, id.check, 1, sent(-DAY));
  await exec(bruno, id.msgA, 2, { scheduled_at: iso(22 * HOUR) });
  const chloe = await enroll('Chloé Durand', { current_step_order: 5 });
  await exec(chloe, id.visit, 0, sent(-3 * DAY));
  await exec(chloe, id.check, 1, sent(-2 * DAY));
  await exec(chloe, id.invite, 4, sent(-DAY));
  await exec(chloe, id.wait, 5, { status: 'waiting_event', scheduled_at: iso(-DAY) });
  const david = await enroll('David Moreau', { current_step_order: 2 });
  await exec(david, id.visit, 0, sent(-2 * DAY));
  await exec(david, id.check, 1, sent(-DAY));
  await exec(david, id.msgB, 2, { scheduled_at: iso(HOUR), error_message: AI_REVIEW_REASON });
  await enroll('Emma Roux', { status: 'replied', replied_at: iso(-DAY) });
  await enroll('Fanny Blanc', { status: 'replied', replied_at: iso(-2 * DAY) });
  const gilles = await enroll('Gilles Noir', { status: 'paused', pause_reason: 'send_failed' });
  await exec(gilles, id.visit, 0, { status: 'failed', scheduled_at: iso(-2 * HOUR), executed_at: iso(-HOUR), error_message: 'Profil LinkedIn introuvable' });
  await enroll('Hugo Lefèvre', {
    status: 'completed',
    completed_at: iso(-DAY),
    tracking_data: { completion_reason: 'manual_stop', manual_stop: { by: ownerId, at: iso(-DAY) } },
  });
  return { sequenceId, name, alice, bruno, chloe, david, gilles };
}

async function openDetail(browser: Browser, user: TestUser, account: string, path: string, viewport?: { width: number; height: number }) {
  const page = await openAs(browser, user, [account], viewport);
  await page.goto(`${path}${path.includes('?') ? '&' : '?'}sequences-v2=1`, { waitUntil: 'domcontentloaded' });
  return page;
}

test.describe('Séquences v2 — page d’une séquence (lot 5c-2)', () => {
  test.skip(!EDGE_DEPLOYED, EDGE_SKIP_REASON);
  test('en-tête, puces sans zéro, statuts, Parcours, pause et arrêt avec « Annuler », renommer', async ({ browser, org }) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    await admin().from('profiles').upsert({ user_id: owner.userId, display_name: 'Guillaume Martin' }, { onConflict: 'user_id' });
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
    const missionId = await seedMission(org.orgId, owner.userId, { name: 'Directeur financier', client_name: 'Groupe Hélios' });
    const seeded = await seedDetailSequence(org.orgId, owner.userId, missionId, account);

    const page = await openDetail(browser, owner, account, `/sequences/${seeded.sequenceId}?depuis=mission:${missionId}`);
    await expect(page.getByRole('heading', { level: 1, name: seeded.name })).toBeVisible({ timeout: 30_000 });
    // Fil d'Ariane par la mission d'origine ; le paramètre de l'interrupteur quitte l'adresse.
    const crumbs = page.getByRole('navigation', { name: 'Fil d’Ariane' });
    await expect(crumbs.getByRole('link', { name: 'Directeur financier' })).toHaveAttribute('href', `/missions/${missionId}?panneau=contact`);
    await expect(page).not.toHaveURL(/sequences-v2/);
    // Inscrits : onglet Candidats par défaut ; un seul bouton plein.
    await expect(page.getByRole('tab', { name: /Candidats/ })).toHaveAttribute('data-state', 'active');
    await expect(page.getByRole('link', { name: 'Inscrire des candidats' })).toHaveAttribute('href', `/missions/${missionId}?tab=pipeline`);
    await expect(page.getByText(/Depuis le compte LinkedIn de la personne qui inscrit/)).toBeVisible();

    // Puces : nombres de toute la séquence, aucune puce à zéro (« En pause » absente).
    const chips = page.getByRole('group', { name: 'Filtrer les candidats' });
    await expect(chips.getByRole('button', { name: 'Tous 8' })).toHaveAttribute('aria-pressed', 'true');
    await expect(chips.getByRole('button', { name: 'En cours 4' })).toBeVisible();
    await expect(chips.getByRole('button', { name: 'A répondu 2' })).toBeVisible();
    await expect(chips.getByRole('button', { name: 'En échec 1' })).toBeVisible();
    await expect(chips.getByRole('button', { name: 'Terminées 1' })).toBeVisible();
    await expect(chips.getByRole('button', { name: /^En pause/ })).toHaveCount(0);

    // Statut et prochaine action, une règle (enrollmentStatusLine).
    const row = (name: string) => page.getByRole('row').filter({ has: page.getByText(name, { exact: true }) });
    await expect(row('Alice Martin').getByText('En cours').filter({ visible: true })).toBeVisible();
    await expect(row('Alice Martin').getByText(/^Message LinkedIn (aujourd’hui|demain) à/).filter({ visible: true })).toBeVisible();
    await expect(row('Chloé Durand').getByText(/^En attente de l’acceptation, jusqu’au \d{2}\/\d{2}$/).filter({ visible: true })).toBeVisible();
    await expect(row('David Moreau').getByText('Message rédigé par l’IA à relire').filter({ visible: true })).toBeVisible();
    await expect(row('David Moreau').getByRole('button', { name: 'Relire le message' }).filter({ visible: true })).toBeVisible();
    await expect(row('Gilles Noir').getByText(/^En échec : /).filter({ visible: true })).toBeVisible();
    await expect(row('Hugo Lefèvre').getByText(/^Arrêtée par Guillaume Martin le \d{2}\/\d{2}$/).filter({ visible: true })).toBeVisible();
    await expect(row('Emma Roux').getByText(/^A répondu le \d{2}\/\d{2}$/).filter({ visible: true })).toBeVisible();

    // Filtre par puce, dans l'adresse.
    await chips.getByRole('button', { name: 'En échec 1' }).click();
    await expect(page).toHaveURL(/statut=en-echec/);
    await expect(row('Gilles Noir')).toBeVisible();
    await expect(row('Alice Martin')).toHaveCount(0);
    await chips.getByRole('button', { name: /^Tous/ }).click();
    await expect(row('Alice Martin')).toBeVisible();

    // Pause immédiate d'un candidat, puis « Annuler » (resume_enrollments).
    await row('Alice Martin').getByRole('button', { name: 'Mettre en pause' }).filter({ visible: true }).click();
    const paused = toast(page, 'Séquence mise en pause pour Alice Martin.');
    await expect(paused).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await admin().from('sequence_enrollments').select('status').eq('id', seeded.alice).single()).data?.status).toBe('paused');
    await paused.getByRole('button', { name: 'Annuler' }).click();
    await expect.poll(async () => (await admin().from('sequence_enrollments').select('status').eq('id', seeded.alice).single()).data?.status, { timeout: 20_000 }).toBe('active');

    // « Arrêter pour ce candidat » depuis le menu, puis « Annuler » (undo_stop_enrollments).
    await row('Bruno Petit').getByRole('button', { name: 'Actions pour Bruno Petit' }).click();
    await page.getByRole('menuitem', { name: 'Arrêter pour ce candidat' }).click();
    const stopped = toast(page, 'Séquence arrêtée pour Bruno Petit.');
    await expect(stopped).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await admin().from('sequence_enrollments').select('status').eq('id', seeded.bruno).single()).data?.status).toBe('completed');
    await stopped.getByRole('button', { name: 'Annuler' }).click();
    await expect.poll(async () => (await admin().from('sequence_enrollments').select('status').eq('id', seeded.bruno).single()).data?.status, { timeout: 20_000 }).toBe('active');

    // Barre groupée : une ligne en cours et une qui a répondu ; seule la première est mise en pause, « Annuler » la reprend.
    await row('Alice Martin').getByRole('checkbox', { name: 'Sélectionner Alice Martin' }).click();
    await row('Emma Roux').getByRole('checkbox', { name: 'Sélectionner Emma Roux' }).click();
    await page.getByRole('toolbar', { name: 'Actions sur la sélection' }).getByRole('button', { name: 'Mettre en pause' }).click();
    const bulkPaused = toast(page, 'Séquence mise en pause pour Alice Martin.');
    await expect(bulkPaused).toBeVisible({ timeout: 20_000 });
    await expect(bulkPaused).toContainText('1 candidat n’était pas en cours.');
    await expect.poll(async () => (await admin().from('sequence_enrollments').select('status').eq('id', seeded.alice).single()).data?.status).toBe('paused');
    expect((await admin().from('sequence_enrollments').select('status').eq('profile_name', 'Emma Roux').eq('sequence_id', seeded.sequenceId).single()).data?.status).toBe('replied');
    await bulkPaused.getByRole('button', { name: 'Annuler' }).click();
    await expect.poll(async () => (await admin().from('sequence_enrollments').select('status').eq('id', seeded.alice).single()).data?.status, { timeout: 20_000 }).toBe('active');

    // Parcours : étapes faites, attente en cours, branche non prise, à venir.
    await row('Chloé Durand').getByText('Chloé Durand', { exact: true }).click();
    const journey = page.getByRole('dialog', { name: 'Parcours de Chloé Durand' });
    await expect(journey).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`parcours=${seeded.chloe}`));
    await expect(journey.getByText('Inscrit par Guillaume Martin, depuis son compte LinkedIn').or(journey.getByText('Inscrit par vous, depuis votre compte LinkedIn'))).toBeVisible();
    await expect(journey.getByText(/^Envoyé le \d{2}\/\d{2} à/).first()).toBeVisible();
    await expect(journey.getByText('Branche non prise').first()).toBeVisible();
    await expect(journey.getByText('En attente', { exact: true })).toBeVisible();
    // Parcours sur le graphe : les deux issues de l'attente, le délai de l'issue, jamais l'autre branche « à venir ».
    await expect(journey.getByText('Si acceptée', { exact: true })).toBeVisible();
    await expect(journey.getByText('Si pas acceptée après 10 jours', { exact: true })).toBeVisible();
    await expect(journey.getByText(/^À venir · à partir du \d{2}\/\d{2}, sans acceptation$/)).toBeVisible();
    await expect(journey.getByText('Branche non prise : Connecté (1er degré)')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(journey).toBeHidden();

    // Renommer la séquence.
    await page.getByRole('button', { name: 'Renommer la séquence' }).click();
    const nameInput = page.getByRole('textbox', { name: 'Nom de la séquence' });
    await nameInput.fill(`${seeded.name} (relance)`);
    await nameInput.press('Enter');
    await expect(toast(page, 'Séquence renommée')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { level: 1, name: `${seeded.name} (relance)` })).toBeVisible();
    await expect.poll(async () => (await admin().from('outreach_sequences').select('name').eq('id', seeded.sequenceId).single()).data?.name).toBe(`${seeded.name} (relance)`);

    // Menu « ... » : « Envoyer les actions du jour » de cette séquence seulement, après la confirmation actuelle.
    await page.getByRole('button', { name: 'Plus d’actions sur la séquence' }).click();
    await page.getByRole('menuitem', { name: 'Envoyer les actions du jour' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Envoyer maintenant les actions du jour ?' });
    await expect(confirm).toBeVisible();
    const nudgeRequest = page.waitForRequest((r) => r.url().includes('/functions/v1/process-sequences') && r.method() === 'POST');
    await confirm.getByRole('button', { name: 'Envoyer maintenant' }).click();
    const nudgeBody = (await nudgeRequest).postDataJSON() as { action?: string; sequence_ids?: string[] };
    expect(nudgeBody.action).toBe('nudge_sequences');
    expect(nudgeBody.sequence_ids).toEqual([seeded.sequenceId]);
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: /avancée|Rien à avancer pour aujourd’hui\./ }).first()).toBeVisible({ timeout: 20_000 });
    await expect(toast(page, 'Les actions du jour n’ont pas pu être avancées')).toHaveCount(0);
  });

  test('Étapes en lecture, Journal et « État de l’envoi », Réglages, menu « ... » (Dupliquer, modèle, Supprimer)', async ({ browser, org }) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
    const missionId = await seedMission(org.orgId, owner.userId, { name: 'Directeur financier', client_name: 'Groupe Hélios' });
    const seeded = await seedDetailSequence(org.orgId, owner.userId, missionId, account);
    const page = await openDetail(browser, owner, account, `/sequences/${seeded.sequenceId}?depuis=mission:${missionId}`);
    await expect(page.getByRole('heading', { level: 1, name: seeded.name })).toBeVisible({ timeout: 30_000 });

    // Étapes : fil en DOM, fourches, versions A/B, délais, fin de séquence.
    await page.getByRole('tab', { name: 'Étapes' }).click();
    await expect(page).toHaveURL(/onglet=etapes/);
    const flow = page.getByRole('list', { name: 'Étapes de la séquence' });
    await expect(flow).toBeVisible();
    await expect(page.getByText('Dès l’inscription, au premier créneau')).toBeVisible();
    await expect(flow.getByRole('region', { name: 'Branche : Connecté (1er degré)' })).toBeVisible();
    await expect(flow.getByRole('region', { name: 'Branche : Non connecté' })).toBeVisible();
    await expect(flow.getByRole('region', { name: 'Branche : Pas acceptée après 10 jours' })).toBeVisible();
    await expect(flow.getByText('A/B · 2 versions')).toBeVisible();
    await expect(flow.getByText('Attendre 5 jours').first()).toBeVisible();
    await expect(flow.getByText('Fin de la séquence').first()).toBeVisible();
    await expect(flow.getByText(/Bonjour \[Prénom\], votre parcours chez \[Entreprise actuelle\]/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Modifier les étapes' })).toBeVisible();

    // « Diagnostic des envois » : carte « État de l'envoi » du Journal, échec nommé.
    await page.getByRole('button', { name: 'Plus d’actions sur la séquence' }).click();
    await page.getByRole('menuitem', { name: 'Diagnostic des envois' }).click();
    await expect(page).toHaveURL(/onglet=journal/);
    const health = page.getByRole('region', { name: 'État de l’envoi' });
    await expect(health).toBeVisible({ timeout: 20_000 });
    await expect(health.getByText(/Gilles Noir/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('searchbox', { name: 'Rechercher dans le journal' })).toBeVisible({ timeout: 20_000 });
    await health.getByRole('button', { name: 'Voir le parcours' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Parcours de Gilles Noir' })).toBeVisible();
    await page.keyboard.press('Escape');

    // Réglages : « Enregistrer » devient le bouton plein de l'en-tête, puis enregistré en base.
    await page.getByRole('tab', { name: 'Réglages' }).click();
    await page.getByRole('switch', { name: 'Arrêter si un rendez-vous est pris' }).click();
    const save = page.getByRole('button', { name: 'Enregistrer', exact: true });
    await expect(save).toBeVisible();
    await expect(page.getByText('Modifications non enregistrées')).toBeVisible();
    await save.click();
    await expect(toast(page, 'Réglages enregistrés')).toBeVisible({ timeout: 20_000 });
    await expect(save).toHaveCount(0);
    await expect.poll(async () => {
      const { data } = await admin().from('outreach_sequences').select('stop_conditions').eq('id', seeded.sequenceId).single();
      return (data?.stop_conditions as { on_meeting_booked?: boolean } | null)?.on_meeting_booked;
    }).toBe(true);

    // Enregistrer comme modèle.
    await page.getByRole('button', { name: 'Plus d’actions sur la séquence' }).click();
    await page.getByRole('menuitem', { name: 'Enregistrer comme modèle' }).click();
    const templateDialog = page.getByRole('dialog', { name: 'Enregistrer comme modèle' });
    await expect(templateDialog).toBeVisible();
    const templateName = `Modèle e2e ${rand()}`;
    await templateDialog.getByLabel('Nom du modèle *').fill(templateName);
    await templateDialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(toast(page, 'Modèle enregistré')).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await admin().from('sequence_templates').select('id').eq('name', templateName)).data?.length ?? 0).toBe(1);

    // Dupliquer : « Copie de … », la page de la copie s'ouvre, mission gardée.
    await page.getByRole('button', { name: 'Plus d’actions sur la séquence' }).click();
    await page.getByRole('menuitem', { name: 'Dupliquer' }).click();
    await expect(page.getByRole('heading', { level: 1, name: `Copie de ${seeded.name}` })).toBeVisible({ timeout: 20_000 });
    const { data: copy } = await admin().from('outreach_sequences').select('id, project_id, is_active').eq('name', `Copie de ${seeded.name}`).single();
    expect(copy?.project_id).toBe(missionId);
    expect(copy?.is_active).toBe(false);
    await expect(page).toHaveURL(new RegExp(`/sequences/${copy?.id}\\?depuis=mission`));

    // Supprimer la copie : confirmation actuelle, retour au panneau de la mission.
    await page.getByRole('button', { name: 'Plus d’actions sur la séquence' }).click();
    await page.getByRole('menuitem', { name: 'Supprimer' }).click();
    const del = page.getByRole('alertdialog', { name: 'Supprimer cette séquence ?' });
    await expect(del).toBeVisible();
    await del.getByRole('button', { name: 'Supprimer définitivement' }).click();
    await expect(toast(page, 'Séquence supprimée')).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(new RegExp(`/missions/${missionId}`));
    await expect.poll(async () => (await admin().from('outreach_sequences').select('id').eq('id', copy?.id ?? '')).data?.length ?? 0).toBe(0);
  });

  test('collaborateur : sur sa séquence, il n’agit que sur ses lignes et ne met pas la séquence en pause', async ({ browser, org }) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    const collab = await addMember(org.orgId, 'collaborator', 'collab');
    org.addExtraUser(collab);
    const ownerAccount = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
    const collabAccount = await seedLinkedInAccount(org.orgId, collab.userId, `acc_e2e_${rand()}`);
    // Un collaborateur ne lit que ses séquences (RLS) ; un collègue peut y inscrire des candidats.
    const { sequenceId } = await seedSequence(org.orgId, collab.userId, [{ action_type: 'message' }, { action_type: 'message' }]);
    const name = `Séquence du collaborateur ${rand()}`;
    await admin().from('outreach_sequences').update({ name }).eq('id', sequenceId);
    await seedEnrollment(org.orgId, sequenceId, collab.userId, { account_id: collabAccount, profile_name: 'Inès Collab', user_timezone: 'Europe/Paris' });
    await seedEnrollment(org.orgId, sequenceId, owner.userId, { account_id: ownerAccount, profile_name: 'Omar Owner', user_timezone: 'Europe/Paris' });

    const page = await openDetail(browser, collab, collabAccount, `/sequences/${sequenceId}?onglet=candidats`);
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible({ timeout: 30_000 });
    const own = page.getByRole('row').filter({ has: page.getByText('Inès Collab', { exact: true }) });
    const other = page.getByRole('row').filter({ has: page.getByText('Omar Owner', { exact: true }) });
    await expect(own).toBeVisible({ timeout: 20_000 });
    await expect(other).toBeVisible();
    // Ses lignes : gestes proposés ; celles d'un collègue : consultation seulement.
    await expect(own.getByRole('checkbox', { name: 'Sélectionner Inès Collab' })).toBeEnabled();
    await expect(other.getByRole('checkbox', { name: 'Sélectionner Omar Owner' })).toBeDisabled();
    await expect(other.getByRole('button', { name: 'Mettre en pause' })).toHaveCount(0);
    await own.getByRole('button', { name: 'Actions pour Inès Collab' }).click();
    const ownMenu = page.getByRole('menu', { name: 'Actions pour Inès Collab' });
    await expect(ownMenu.getByRole('menuitem', { name: 'Mettre en pause pour ce candidat' })).toBeVisible();
    await expect(ownMenu.getByRole('menuitem', { name: 'Arrêter pour ce candidat' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(ownMenu).toBeHidden();
    await other.getByRole('button', { name: 'Actions pour Omar Owner' }).click();
    const otherMenu = page.getByRole('menu', { name: 'Actions pour Omar Owner' });
    await expect(otherMenu.getByRole('menuitem', { name: 'Voir le parcours' })).toBeVisible();
    await expect(otherMenu.getByRole('menuitem', { name: 'Mettre en pause pour ce candidat' })).toHaveCount(0);
    await expect(otherMenu.getByRole('menuitem', { name: 'Arrêter pour ce candidat' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(otherMenu).toBeHidden();
    // Mise en pause de toute la séquence réservée (D3) : l'élément dit pourquoi, rien n'est écrit.
    await page.getByRole('button', { name: /^Statut de la séquence/ }).click();
    await expect(page.getByRole('menuitem', { name: /Mettre en pause la séquence/ })).toContainText('réservée aux membres qui gèrent toutes les inscriptions');
    await page.getByRole('menuitem', { name: /Mettre en pause la séquence/ }).click();
    await expect(toast(page, 'Mise en pause réservée')).toBeVisible({ timeout: 20_000 });
    expect((await admin().from('outreach_sequences').select('is_active').eq('id', sequenceId).single()).data?.is_active).toBe(true);
  });

  test('Candidats : « Afficher la suite » après une pause ne saute personne ; Parcours d’une autre séquence refusé', async ({ browser, org }) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
    const missionId = await seedMission(org.orgId, owner.userId, { name: 'Mission pagination' });
    const { data: seq } = await admin().from('outreach_sequences')
      .insert({ name: `Volume ${rand()}`, organization_id: org.orgId, created_by: owner.userId, is_active: true, project_id: missionId })
      .select('id').single();
    const sequenceId = seq?.id as string;
    await admin().from('sequence_steps').insert({ id: randomUUID(), sequence_id: sequenceId, step_order: 0, action_type: 'message', message_template: 'Bonjour', delay_days: 0, ends_sequence: false });
    const base = Date.now() - 10 * DAY;
    const rows = Array.from({ length: 130 }, (_, i) => ({
      sequence_id: sequenceId, organization_id: org.orgId, created_by: owner.userId,
      profile_id: `p_${i}_${rand()}`, profile_name: `Candidat ${String(i).padStart(3, '0')}`,
      profile_url: `https://www.linkedin.com/in/pag-${i}-${rand()}`,
      account_id: account, status: 'active', current_step_order: 0, user_timezone: 'Europe/Paris',
      created_at: new Date(base + i * 60_000).toISOString(),
    }));
    const { error } = await admin().from('sequence_enrollments').insert(rows);
    if (error) throw new Error(`inscriptions : ${error.message}`);

    const page = await openDetail(browser, owner, account, `/sequences/${sequenceId}?statut=en-cours`);
    const names = page.locator('tbody tr p.truncate.text-md');
    await expect(names).toHaveCount(100, { timeout: 30_000 });
    // Plus récentes d'abord : Candidat 129 à Candidat 030. Pause de la première, qui sort du filtre « En cours » en base.
    const first = page.getByRole('row').filter({ has: page.getByText('Candidat 129', { exact: true }) });
    await first.getByRole('button', { name: 'Mettre en pause' }).filter({ visible: true }).click();
    await expect(toast(page, 'Séquence mise en pause pour Candidat 129.')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Afficher la suite' }).click();
    await expect(names).toHaveCount(130, { timeout: 20_000 });
    const shown = new Set(await names.allTextContents());
    expect(rows.map((r) => r.profile_name).filter((n) => !shown.has(n))).toEqual([]);
    await expect(page.getByRole('button', { name: 'Afficher la suite' })).toHaveCount(0);

    // ?parcours= d'une inscription d'une autre séquence (lien recopié) : rien n'est ouvert, aucun geste proposé.
    const { data: other } = await admin().from('outreach_sequences')
      .insert({ name: `Autre ${rand()}`, organization_id: org.orgId, created_by: owner.userId, is_active: false })
      .select('id').single();
    const { data: foreign } = await admin().from('sequence_enrollments').insert({
      sequence_id: other?.id, organization_id: org.orgId, created_by: owner.userId, profile_id: `pb_${rand()}`,
      profile_name: 'Inscrit ailleurs', account_id: account, status: 'paused', pause_reason: 'sequence_inactive', user_timezone: 'Europe/Paris',
    }).select('id').single();
    await page.goto(`/sequences/${sequenceId}?parcours=${foreign?.id}&sequences-v2=1`, { waitUntil: 'domcontentloaded' });
    const panel = page.getByRole('dialog', { name: 'Parcours du candidat' });
    await expect(panel.getByText('Parcours indisponible.')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('dialog', { name: 'Parcours de Inscrit ailleurs' })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Réactiver la séquence' })).toHaveCount(0);
  });

  test('« À venir » de l’organisation : les étapes les plus proches d’abord, au-delà de 500', async ({ browser, org }) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
    const { data: seq } = await admin().from('outreach_sequences')
      .insert({ name: `Volume à venir ${rand()}`, organization_id: org.orgId, created_by: owner.userId, is_active: true })
      .select('id').single();
    const sequenceId = seq?.id as string;
    const stepId = randomUUID();
    await admin().from('sequence_steps').insert({ id: stepId, sequence_id: sequenceId, step_order: 0, action_type: 'message', message_template: 'Bonjour', delay_days: 0, ends_sequence: false });
    const people = [
      ...Array.from({ length: 5 }, (_, i) => ({ name: `Proche ${i}`, at: Date.now() + (i + 1) * HOUR })),
      ...Array.from({ length: 505 }, (_, i) => ({ name: `Loin ${i}`, at: Date.now() + 3 * DAY + i * 60_000 })),
    ];
    const enrollRows = people.map((p, i) => ({
      id: randomUUID(), sequence_id: sequenceId, organization_id: org.orgId, created_by: owner.userId,
      profile_id: `v_${i}_${rand()}`, profile_name: p.name, account_id: account, status: 'active', current_step_order: 0, user_timezone: 'Europe/Paris',
    }));
    for (let i = 0; i < enrollRows.length; i += 200) {
      const { error } = await admin().from('sequence_enrollments').insert(enrollRows.slice(i, i + 200));
      if (error) throw new Error(`inscriptions : ${error.message}`);
    }
    const execRows = people.map((p, i) => ({ enrollment_id: enrollRows[i].id, organization_id: org.orgId, step_id: stepId, step_order: 0, status: 'scheduled', scheduled_at: new Date(p.at).toISOString() }));
    for (let i = 0; i < execRows.length; i += 200) {
      const { error } = await admin().from('sequence_step_executions').insert(execRows.slice(i, i + 200));
      if (error) throw new Error(`exécutions : ${error.message}`);
    }
    const page = await openAs(browser, owner, [account]);
    await page.goto('/sequences?onglet=a-venir&sequences-v2=1', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('510 à venir')).toBeVisible({ timeout: 30_000 });
    // Première page : les 5 proches puis les plus proches des lointaines, dans l'ordre.
    await expect(page.getByText(/^Proche \d$/)).toHaveCount(5, { timeout: 30_000 });
    const firstNames = await page.locator('section[aria-labelledby^="journal-2"] li span.truncate').allTextContents();
    expect(firstNames.slice(0, 6)).toEqual(['Proche 0', 'Proche 1', 'Proche 2', 'Proche 3', 'Proche 4', 'Loin 0']);
    await expect(page.locator('section[aria-labelledby^="journal-2"] li')).toHaveCount(100);
    await expect(page.getByRole('button', { name: 'Afficher la suite' })).toBeVisible();
  });

  test('Journal : pagination par curseur sur 600 étapes, sans perte ni doublon', async ({ browser, org }) => {
    const owner = org.owner;
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
    const { sequenceId, steps } = await seedSequence(org.orgId, owner.userId, [{ action_type: 'message' }, { action_type: 'message' }]);
    // 300 inscrits, deux étapes envoyées chacun ; dix dates seulement, pour
    // que le curseur départage les ex aequo par identifiant.
    const enrollments = Array.from({ length: 300 }, (_, i) => ({
      sequence_id: sequenceId,
      organization_id: org.orgId,
      created_by: owner.userId,
      profile_id: `e2e_profile_${rand()}_${i}`,
      profile_name: `Candidat ${String(i).padStart(3, '0')}`,
      account_id: account,
      status: 'completed',
      current_step_order: 1,
      user_timezone: 'Europe/Paris',
    }));
    const { data: rows, error } = await admin().from('sequence_enrollments').insert(enrollments).select('id');
    if (error || !rows) throw new Error(`inscriptions : ${error?.message}`);
    const stamps = Array.from({ length: 10 }, (_, k) => iso(-(k + 1) * DAY));
    const executions = rows.flatMap((r, i) => steps.map((s, j) => ({
      enrollment_id: r.id,
      organization_id: org.orgId,
      step_id: s.id,
      step_order: s.step_order,
      status: 'sent',
      scheduled_at: stamps[(i * 2 + j) % 10],
      executed_at: stamps[(i * 2 + j) % 10],
    })));
    const { error: execError } = await admin().from('sequence_step_executions').insert(executions);
    if (execError) throw new Error(`exécutions : ${execError.message}`);

    const page = await openDetail(browser, owner, account, `/sequences/${sequenceId}?onglet=journal`);
    await expect(page.getByText('600 envoyées')).toBeVisible({ timeout: 30_000 });
    const items = page.locator('section[aria-labelledby^="journal-2"] li');
    await expect(items).toHaveCount(100, { timeout: 20_000 });
    const more = page.getByRole('button', { name: 'Afficher la suite' });
    for (let pageNo = 2; pageNo <= 6; pageNo += 1) {
      await more.click();
      await expect(items).toHaveCount(pageNo * 100, { timeout: 20_000 });
    }
    // Sixième page pleine : un dernier appel ne rapporte rien, le bouton disparaît.
    await more.click();
    await expect(more).toHaveCount(0, { timeout: 20_000 });
    await expect(items).toHaveCount(600);
  });

  test('captures à 1 280 et 360 px : chaque onglet et le Parcours, sans défilement horizontal', async ({ browser, org }, testInfo) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    await admin().from('profiles').upsert({ user_id: owner.userId, display_name: 'Guillaume Martin' }, { onConflict: 'user_id' });
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
    const missionId = await seedMission(org.orgId, owner.userId, { name: 'Directeur financier', client_name: 'Groupe Hélios' });
    const seeded = await seedDetailSequence(org.orgId, owner.userId, missionId, account);
    for (const viewport of [{ width: 1280, height: 800 }, { width: 360, height: 780 }]) {
      const page = await openDetail(browser, owner, account, `/sequences/${seeded.sequenceId}?depuis=mission:${missionId}`, viewport);
      await expect(page.getByRole('heading', { level: 1, name: seeded.name })).toBeVisible({ timeout: 30_000 });
      for (const [tab, ready] of [
        ['candidats', page.getByText('Alice Martin', { exact: true }).first()],
        ['etapes', page.getByRole('list', { name: 'Étapes de la séquence' })],
        ['statistiques', page.getByRole('combobox', { name: 'Période' })],
        ['journal', page.getByRole('region', { name: 'État de l’envoi' })],
        ['reglages', page.getByRole('switch', { name: 'Arrêter si un rendez-vous est pris' })],
      ] as const) {
        await page.getByRole('tab', { name: new RegExp(`^${{ candidats: 'Candidats', etapes: 'Étapes', statistiques: 'Statistiques', journal: 'Journal', reglages: 'Réglages' }[tab]}`) }).click();
        await expect(ready).toBeVisible({ timeout: 20_000 });
        await page.waitForTimeout(300);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `défilement horizontal à ${viewport.width} px, onglet ${tab}`).toBeLessThanOrEqual(0);
        // Rien de coupé par un conteneur qui masque le débordement (tableau, onglets, titre).
        const clipped = await page.evaluate(() => [...document.querySelectorAll('table, [role="tablist"], h1')]
          .some((el) => el.getBoundingClientRect().right > window.innerWidth + 1));
        expect(clipped, `contenu coupé à ${viewport.width} px, onglet ${tab}`).toBe(false);
        const path = testInfo.outputPath(`sequence-${viewport.width}-${tab}.png`);
        await page.screenshot({ path, fullPage: true });
        await testInfo.attach(`sequence-${viewport.width}-${tab}`, { path, contentType: 'image/png' });
      }
      await page.getByRole('tab', { name: /^Candidats/ }).click();
      await page.getByText('Chloé Durand', { exact: true }).first().click();
      await expect(page.getByRole('dialog', { name: 'Parcours de Chloé Durand' })).toBeVisible();
      await page.waitForTimeout(400);
      const path = testInfo.outputPath(`sequence-${viewport.width}-parcours.png`);
      await page.screenshot({ path });
      await testInfo.attach(`sequence-${viewport.width}-parcours`, { path, contentType: 'image/png' });
    }
  });
});
