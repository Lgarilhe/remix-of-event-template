/**
 * Refonte des séquences, lot 5d-2 : éditeur unique, onglet « Étapes » de
 * /sequences/:id (interrupteur konekt.sequences-v2 allumé).
 *
 * Contrat testé (docs/refonte-mission/lot5-plan.md, 5d-2), partie fil et panneau :
 * - fil en DOM : bloc de départ, délais, fourches « Connecté (1er degré) /
 *   Non connecté » et « Acceptée / Pas acceptée après 10 jours », « Fin de la
 *   séquence », « Ajouter une étape » sous la dernière carte de chaque branche ;
 * - palette à deux onglets ; une entrée impossible reste visible, grisée, avec
 *   sa raison ; types fermés jamais proposés ;
 * - panneau d'étape : versions A et B, « Je rédige » / « L'IA rédige pour
 *   chaque candidat » et sa phrase de relecture, note d'invitation et son
 *   compteur, « Plus d'options » ;
 * - séquence vide : « Commencer par ajouter une étape », palette ouverte ;
 *   invitation puis attente, vérification de la connexion à deux branches ;
 * - rien n'est écrit en base tant que rien n'est enregistré ;
 * - 360 px : fil sans défilement horizontal, panneau plein écran.
 *
 * Partie message, aperçu, vérification et enregistrement :
 * - créer de zéro depuis « Nouvelle séquence » (/sequences/nouvelle), rien
 *   d'écrit avant « Enregistrer » ; invitation puis attente, branches
 *   « Connecté / Non connecté », version B ; variable inconnue bloquante ;
 *   enregistrer puis rouvrir ;
 * - modifier, Ctrl+S, recharger : tout est retrouvé ; brouillon local repris
 *   après un rechargement ; « Quitter sans enregistrer ? » sur un lien ;
 * - aperçu réel (preview_values, fonction servie par la stack locale) : les
 *   inscrits, puis un Retenu de la mission, puis l'exemple ; donnée absente
 *   surlignée ; aucune valeur d'aperçu dans le stockage local ;
 * - refus STEP_HAS_HISTORY et modification concurrente : messages existants ;
 * - panneau de mission, drapeau allumé : « Modifier » et « Créer une
 *   séquence » mènent à l'éditeur unique.
 *
 * Partie création et points d'entrée :
 * - « Partir d'un modèle » depuis le panneau de mission : éditeur rempli, rien
 *   d'écrit ; « Enregistrer » crée la séquence de la mission et son adresse
 *   remplace /sequences/nouvelle (« Retour » revient à la mission) ;
 * - modèle de l'organisation (onglet Modèles de /sequences) ;
 * - formule gratuite : texte de la spécification, séquence créée sans envoi
 *   (« Brouillon ») ;
 * - drapeau éteint : /sequences/nouvelle renvoie vers les missions sans rien
 *   écrire ; « Modifier » du panneau ouvre l'ancien éditeur.
 *
 * Partie tests :
 * - enregistrer puis rouvrir sans perte : six jeux de référence canoniques
 *   (tests/fixtures/sequence-editor-payloads.json : copies et signature,
 *   fourches et replis, versions A/B/C et poids, créneau et condition, seuil
 *   et IA) écrits en base, un texte modifié, Ctrl+S : toutes les autres
 *   colonnes relues à l'identique, puis rouverts sans rien à enregistrer ;
 * - Séquence recommandée (17 étapes, deux fourches imbriquées) lisible à
 *   1 280 et 360 px : cartes dans la fenêtre, sans chevauchement, aucune hors
 *   du parcours, captures jointes ;
 * - drapeau éteint (@smoke) : « Modifier » ouvre l'ancien éditeur (sélecteur
 *   de mode), « Créer une séquence » l'ancien choix de départ.
 *
 * Seule la liste des comptes LinkedIn du prestataire est simulée dans le
 * navigateur ; draft-sequence (preview_values) est la vraie fonction : le bloc
 * drapeau allumé exige E2E_EDGE_FUNCTIONS=1 (stack locale). Le bloc drapeau
 * éteint n'appelle aucune fonction serveur et tourne aussi sur la CI de PR.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import {
  admin,
  seedCandidateRow,
  seedEnrollment,
  seedExecution,
  seedLinkedInAccount,
  seedMission,
  setOrgPlan,
  storageStateForUser,
  type TestUser,
} from '../helpers/supabase-admin';

const EDGE_DEPLOYED = process.env.E2E_EDGE_FUNCTIONS === '1';
const EDGE_SKIP_REASON = 'draft-sequence (aperçu réel) non déployée sur cet environnement (E2E_EDGE_FUNCTIONS=1 pour activer)';
test.describe.configure({ timeout: 180_000 });

const rand = () => Math.random().toString(36).slice(2, 8);

/** Lignes de sequence_steps telles que save_sequence_steps les écrit (jeux de référence de seq-v2-charge-utile). */
type StepRow = Record<string, unknown> & { id: string; action_type: string; message_template: string | null };
const FIXTURES = JSON.parse(readFileSync(new URL('../../tests/fixtures/sequence-editor-payloads.json', import.meta.url), 'utf8')) as {
  sequences: Array<{ name: string; rows: StepRow[]; expected?: unknown }>;
  recommended: { payload: StepRow[] };
};
const STEP_COLUMNS = Object.keys(FIXTURES.recommended.payload[0]);
const REF_COLUMNS = ['if_true_goto_step', 'if_false_goto_step', 'timeout_branch_step_id', 'next_step_id'];

/** Jeu de référence écrit tel quel dans une séquence, identifiants renouvelés (renvois compris). */
async function seedFixtureRows(sequenceId: string, rows: StepRow[]): Promise<StepRow[]> {
  const ids = new Map(rows.map((r) => [r.id, randomUUID()]));
  const mapped = rows.map((r) => {
    const row: StepRow = { ...r, id: ids.get(r.id)! };
    for (const column of REF_COLUMNS) if (typeof r[column] === 'string') row[column] = ids.get(r[column] as string) ?? null;
    return row;
  });
  const { error } = await admin().from('sequence_steps').insert(mapped.map((row) => ({ ...row, sequence_id: sequenceId })));
  if (error) throw new Error(`étapes du jeu : ${error.message}`);
  return mapped;
}

/** Toutes les colonnes lues par l'éditeur, triées par identifiant. */
async function fullRows(sequenceId: string): Promise<StepRow[]> {
  const { data, error } = await admin().from('sequence_steps').select(STEP_COLUMNS.join(', ')).eq('sequence_id', sequenceId);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as StepRow[]).sort((a, b) => a.id.localeCompare(b.id));
}

/** Boîtes des cartes d'étape : dans la largeur de la fenêtre, assez larges pour être lues, sans chevauchement. */
async function expectReadableCards(page: Page, width: number, minWidth: number) {
  const cards = page.getByRole('list', { name: 'Étapes de la séquence' }).getByRole('button', { name: /^Étape \d+ : / });
  const boxes = await cards.evaluateAll((els) => els.map((el) => {
    const r = el.getBoundingClientRect();
    return { name: el.getAttribute('aria-label') ?? '', x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height };
  }));
  for (const b of boxes) {
    expect(b.x, `${b.name} : coupée à gauche à ${width} px`).toBeGreaterThanOrEqual(0);
    expect(b.x + b.w, `${b.name} : coupée à droite à ${width} px`).toBeLessThanOrEqual(width + 0.5);
    expect(b.w, `${b.name} : trop étroite à ${width} px`).toBeGreaterThanOrEqual(minWidth);
  }
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      const overlap = a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
      expect(overlap, `${a.name} et ${b.name} se chevauchent à ${width} px`).toBe(false);
    }
  }
  return boxes;
}
const AI_NOTICE = 'Chaque message sera généré et relu avant l’inscription. Un message non relu ne part pas.';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
});

async function openEditor(browser: Browser, user: TestUser, accountId: string, sequenceId: string, viewport?: { width: number; height: number }): Promise<Page> {
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
      body: JSON.stringify({ success: true, accounts: [{ id: accountId, account_status: 'OK', provider: 'LINKEDIN', name: 'E2E LinkedIn' }] }),
    });
  });
  const page = await context.newPage();
  await page.goto(`/sequences/${sequenceId}?onglet=etapes&sequences-v2=1`, { waitUntil: 'domcontentloaded' });
  return page;
}

async function createSequence(orgId: string, ownerId: string, missionId: string): Promise<{ sequenceId: string; name: string }> {
  const name = `Approche éditeur ${rand()}`;
  const { data, error } = await admin()
    .from('outreach_sequences')
    .insert({ name, organization_id: orgId, created_by: ownerId, is_active: true, project_id: missionId })
    .select('id')
    .single();
  if (error || !data) throw new Error(`séquence : ${error?.message}`);
  return { sequenceId: data.id as string, name };
}

/** Vérification à deux branches, versions A/B, attente de connexion avec repli InMail, 2 inscrits. */
async function seedBranchedSequence(orgId: string, ownerId: string, missionId: string, accountId: string) {
  const { sequenceId, name } = await createSequence(orgId, ownerId, missionId);
  const id = { visit: randomUUID(), check: randomUUID(), msgA: randomUUID(), msgB: randomUUID(), relance: randomUUID(), invite: randomUUID(), wait: randomUUID(), inmail: randomUUID() };
  const { error } = await admin().from('sequence_steps').insert(([] as Array<Record<string, unknown>>).concat([
    { id: id.visit, sequence_id: sequenceId, step_order: 0, action_type: 'profile_visit' },
    { id: id.check, sequence_id: sequenceId, step_order: 1, action_type: 'check_connection', delay_days: 1, if_true_goto_step: id.msgA, if_false_goto_step: id.invite },
    { id: id.msgA, sequence_id: sequenceId, step_order: 2, action_type: 'message', variant_group: 'A', variant_weight: 50, next_step_id: id.relance, message_template: 'Bonjour {{prenom}}, votre parcours chez {{entreprise_actuelle}} a retenu mon attention.' },
    { id: id.msgB, sequence_id: sequenceId, step_order: 2, action_type: 'message', variant_group: 'B', variant_weight: 50, next_step_id: id.relance, message_template: 'Bonjour {{prenom}}, je recrute un {{poste_recherche}}.' },
    { id: id.relance, sequence_id: sequenceId, step_order: 3, action_type: 'message', delay_days: 5, ends_sequence: true, message_template: 'Je me permets de revenir vers vous.' },
    { id: id.invite, sequence_id: sequenceId, step_order: 4, action_type: 'connection_request', next_step_id: id.wait, message_template: 'Bonjour {{prenom}}, échangeons sur un poste de direction financière.' },
    { id: id.wait, sequence_id: sequenceId, step_order: 5, action_type: 'wait_connection', timeout_days: 10, wait_for_event: 'connection_accepted', timeout_branch_step_id: id.inmail, next_step_id: id.relance },
    { id: id.inmail, sequence_id: sequenceId, step_order: 6, action_type: 'inmail', ends_sequence: true, subject_template: 'Poste de directeur financier', message_template: 'Bonjour {{prenom}}, un mot sur un poste.' },
  ]).map((row) => ({ delay_days: 0, ends_sequence: false, ...row })));
  if (error) throw new Error(`étapes : ${error.message}`);
  for (const who of ['Alice Martin', 'Bruno Petit']) {
    await seedEnrollment(orgId, sequenceId, ownerId, { account_id: accountId, profile_name: who, profile_url: `https://www.linkedin.com/in/e2e-${rand()}`, user_timezone: 'Europe/Paris' });
  }
  return { sequenceId, name, id };
}

const toast = (page: Page, text: string | RegExp) => page.locator('[data-sonner-toast]').filter({ hasText: text });

/** Contexte avec la liste des comptes LinkedIn simulée, sur une adresse quelconque. */
async function openAt(browser: Browser, user: TestUser, accountId: string, path: string, viewport?: { width: number; height: number }): Promise<Page> {
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
      body: JSON.stringify({ success: true, accounts: [{ id: accountId, account_status: 'OK', provider: 'LINKEDIN', name: 'E2E LinkedIn' }] }),
    });
  });
  const page = await context.newPage();
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  return page;
}

const stepRows = async (sequenceId: string) => {
  const { data } = await admin().from('sequence_steps').select('id, step_order, action_type, message_template, variant_group').eq('sequence_id', sequenceId).order('step_order');
  return data ?? [];
};

test.describe('Séquences v2 — éditeur unique (lot 5d-2)', () => {
  test.skip(!EDGE_DEPLOYED, EDGE_SKIP_REASON);

  test('fil éditable : fourches, palette grisée avec sa raison, ajout dans une branche, version B, rédaction par l’IA, rien d’écrit', async ({ browser, org }) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
    const missionId = await seedMission(org.orgId, owner.userId, { name: 'Directeur financier' });
    const seeded = await seedBranchedSequence(org.orgId, owner.userId, missionId, account);
    const before = await stepRows(seeded.sequenceId);

    const page = await openEditor(browser, owner, account, seeded.sequenceId);
    const flow = page.getByRole('list', { name: 'Étapes de la séquence' });
    await expect(flow).toBeVisible({ timeout: 30_000 });
    // Fil : départ, fourches, versions, délais, fin ; bandeau des inscrits ; aucun mode d'éditeur.
    await expect(page.getByText('Dès l’inscription, au premier créneau')).toBeVisible();
    await expect(flow.getByRole('region', { name: 'Branche : Connecté (1er degré)' })).toBeVisible();
    await expect(flow.getByRole('region', { name: 'Branche : Non connecté' })).toBeVisible();
    await expect(flow.getByRole('region', { name: 'Branche : Acceptée' })).toBeVisible();
    await expect(flow.getByRole('region', { name: 'Branche : Pas acceptée après 10 jours' })).toBeVisible();
    await expect(flow.getByText('A/B · 2 versions')).toBeVisible();
    await expect(flow.getByText('avec note')).toBeVisible();
    await expect(flow.getByRole('button', { name: 'Délai de l’étape 4 : Attendre 5 jours. Modifier' })).toBeVisible();
    await expect(flow.getByText('Fin de la séquence').first()).toBeVisible();
    await expect(page.getByText('2 candidats sont inscrits. Vos changements de texte et de délai valent pour les étapes pas encore envoyées. Une étape déjà envoyée ne peut pas être supprimée.')).toBeVisible();
    for (const mode of ['Guidé', 'Expert', 'Visuel']) await expect(page.getByText(mode, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Modifier les étapes' })).toHaveCount(0);

    // Palette de la branche Connecté : l'invitation reste visible, grisée, avec sa raison ; types fermés absents.
    await flow.getByRole('button', { name: 'Ajouter une étape dans la branche Connecté (1er degré)' }).click();
    const palette = page.getByRole('dialog', { name: 'Ajouter une étape' });
    await expect(palette.getByRole('tab', { name: 'Actions LinkedIn' })).toHaveAttribute('data-state', 'active');
    const invite = palette.getByRole('button', { name: 'Invitation LinkedIn : Le candidat est déjà en relation à cet endroit.' });
    await expect(invite).toHaveAttribute('aria-disabled', 'true');
    await expect(invite.getByText('Le candidat est déjà en relation à cet endroit.')).toBeVisible();
    await expect(palette.getByRole('button', { name: 'Message LinkedIn', exact: true })).not.toHaveAttribute('aria-disabled', 'true');
    for (const closed of ['E-mail', 'WhatsApp', 'Branchement', 'Attendre une visite']) await expect(palette.getByText(closed, { exact: true })).toHaveCount(0);
    await palette.getByRole('tab', { name: 'Conditions et attentes' }).click();
    await expect(palette.getByRole('button', { name: 'Vérifier la connexion : La relation est déjà connue dans cette branche.' })).toHaveAttribute('aria-disabled', 'true');
    // Une entrée grisée ne fait rien (clic forcé : elle est annoncée indisponible).
    await palette.getByRole('button', { name: /^Attendre la connexion :/ }).click({ force: true });
    await expect(palette).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();

    // Ajout dans la branche « Pas acceptée » : un InMail, ouvert dans le panneau.
    await flow.getByRole('button', { name: 'Ajouter une étape dans la branche Pas acceptée après 10 jours' }).click();
    await expect(palette.getByRole('button', { name: 'Message LinkedIn : Pas en relation dans cette branche : choisissez une invitation ou un InMail.' })).toHaveAttribute('aria-disabled', 'true');
    await palette.getByRole('button', { name: 'InMail', exact: true }).click();
    const panel = page.getByRole('complementary', { name: 'Réglages de l’étape 8' });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Étape 8 · InMail' })).toBeVisible();
    await expect(panel.getByText('Branche « Pas acceptée après 10 jours », aussitôt après l’étape 7')).toBeVisible();
    await expect(panel.getByText('Objet requis.')).toBeVisible();
    await panel.locator('#subject').fill('Poste à Lyon');
    await panel.locator('#message').fill('Bonjour {{prenom}}, je reviens vers vous.');
    await expect(flow.getByRole('button', { name: /^Étape 8 : InMail\. Modifier$/ })).toBeVisible();

    // Version B : ajoutée depuis le panneau, rédigée par l'IA, avec la phrase de relecture.
    await panel.getByRole('button', { name: 'Ajouter une version' }).click();
    const versions = panel.getByRole('group', { name: 'Versions de l’étape' });
    await expect(versions.getByRole('button', { name: 'Version B' })).toHaveAttribute('aria-pressed', 'true');
    await expect(flow.getByText('A/B · 2 versions')).toHaveCount(2);
    await panel.getByRole('group', { name: 'Rédaction' }).getByRole('button', { name: 'L’IA rédige pour chaque candidat' }).click();
    await expect(panel.getByText(AI_NOTICE, { exact: true })).toBeVisible();
    await versions.getByRole('button', { name: 'Version A' }).click();
    await expect(panel.getByText(AI_NOTICE, { exact: true })).toHaveCount(0);
    await expect(panel.locator('#message')).toHaveValue('Bonjour {{prenom}}, je reviens vers vous.');
    // Répartition A/B et réglages communs sous « Plus d'options ».
    await panel.getByRole('button', { name: 'Plus d’options' }).click();
    await expect(panel.getByRole('heading', { name: 'Répartition A/B' })).toBeVisible();
    await expect(panel.getByText('Total : 100 %')).toBeVisible();
    for (const label of ['Délai', 'Créneau d’envoi']) await expect(panel.getByRole('heading', { name: label })).toBeVisible();
    await expect(panel.getByLabel('Faire cette étape seulement si')).toBeVisible();
    await expect(panel.getByLabel('Après cette étape')).toBeVisible();

    // Invitation : note et compteur de 300 caractères ; jamais d'option IA.
    await flow.getByRole('button', { name: /^Étape 5 : Invitation LinkedIn/ }).click();
    const invitePanel = page.getByRole('complementary', { name: 'Réglages de l’étape 5' });
    await expect(invitePanel.getByLabel('Note d’invitation')).toHaveValue('Bonjour {{prenom}}, échangeons sur un poste de direction financière.');
    await expect(invitePanel.getByText(/^\d+ sur 300 caractères$/)).toBeVisible();
    await expect(invitePanel.getByRole('group', { name: 'Rédaction' })).toHaveCount(0);

    // Délai d'une étape modifié depuis le fil.
    await flow.getByRole('button', { name: 'Délai de l’étape 4 : Attendre 5 jours. Modifier' }).click();
    await page.getByRole('dialog', { name: 'Délai de l’étape 4' }).getByRole('button', { name: '3 jours' }).click();
    await expect(flow.getByRole('button', { name: 'Délai de l’étape 4 : Attendre 3 jours. Modifier' })).toBeVisible();
    await page.keyboard.press('Escape');

    // Rien n'est écrit tant que rien n'est enregistré.
    expect(await stepRows(seeded.sequenceId)).toEqual(before);
  });

  test('séquence vide : palette ouverte, invitation puis attente, vérification de la connexion à deux branches', async ({ browser, org }) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
    const missionId = await seedMission(org.orgId, owner.userId, { name: 'Contrôleur de gestion' });
    const { sequenceId } = await createSequence(org.orgId, owner.userId, missionId);

    const page = await openEditor(browser, owner, account, sequenceId);
    await expect(page.getByRole('heading', { name: 'Commencer par ajouter une étape' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('La plupart des séquences de recrutement commencent par une visite de profil ou une invitation.')).toBeVisible();
    // Rien de touché : ni erreur dans une barre, ni point rouge sur l'onglet (l'état vide dit déjà quoi faire).
    await expect(page.getByRole('region', { name: 'Vérification de la séquence' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /Étapes/ })).not.toContainText('point à corriger');
    // Palette ouverte : l'attente de connexion attend une invitation.
    await page.getByRole('tab', { name: 'Conditions et attentes' }).click();
    await expect(page.getByRole('button', { name: 'Attendre la connexion : Ajoutez d’abord une invitation.' })).toHaveAttribute('aria-disabled', 'true');
    await page.getByRole('tab', { name: 'Actions LinkedIn' }).click();
    await page.getByRole('button', { name: 'Visite de profil', exact: true }).click();

    const flow = page.getByRole('list', { name: 'Étapes de la séquence' });
    await expect(flow.getByRole('button', { name: /^Étape 1 : Visite de profil/ })).toBeVisible();
    const addRoot = async (tab: 'Actions LinkedIn' | 'Conditions et attentes', entry: string) => {
      await flow.getByRole('button', { name: 'Ajouter une étape', exact: true }).click();
      const palette = page.getByRole('dialog', { name: 'Ajouter une étape' });
      await palette.getByRole('tab', { name: tab }).click();
      await palette.getByRole('button', { name: entry, exact: true }).click();
    };
    await addRoot('Conditions et attentes', 'Vérifier la connexion');
    const check = flow.getByRole('group', { name: 'Branches de l’étape 2' });
    await expect(check.getByRole('region', { name: 'Branche : Connecté (1er degré)' })).toBeVisible();
    await expect(check.getByRole('region', { name: 'Branche : Non connecté' })).toBeVisible();
    await expect(flow.getByRole('button', { name: 'Ajouter une étape', exact: true })).toHaveCount(0);

    // Branche Non connecté : invitation, puis attente (possible seulement après l'invitation).
    await check.getByRole('button', { name: 'Ajouter une étape dans la branche Non connecté' }).click();
    let palette = page.getByRole('dialog', { name: 'Ajouter une étape' });
    await palette.getByRole('button', { name: 'Invitation LinkedIn', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Étape 3 · Invitation LinkedIn' })).toBeVisible();
    await check.getByRole('button', { name: 'Ajouter une étape dans la branche Non connecté' }).click();
    palette = page.getByRole('dialog', { name: 'Ajouter une étape' });
    await palette.getByRole('tab', { name: 'Conditions et attentes' }).click();
    await palette.getByRole('button', { name: 'Attendre la connexion', exact: true }).click();
    await expect(flow.getByText('Sans acceptation après 3 jours, la séquence passe à l’étape suivante.')).toBeVisible();

    // Branche Connecté : un message, qui y prend place.
    await check.getByRole('button', { name: 'Ajouter une étape dans la branche Connecté (1er degré)' }).click();
    palette = page.getByRole('dialog', { name: 'Ajouter une étape' });
    await palette.getByRole('button', { name: 'Message LinkedIn', exact: true }).click();
    await expect(check.getByRole('region', { name: 'Branche : Connecté (1er degré)' }).getByRole('button', { name: /^Étape 5 : Message LinkedIn, point à corriger\. Modifier$/ })).toBeVisible();
    await expect(check.getByRole('region', { name: 'Branche : Connecté (1er degré)' }).getByText('Message à rédiger.')).toBeVisible();

    // Suppression d'une étape pas encore enregistrée : aussitôt retirée du fil.
    await flow.getByRole('button', { name: 'Actions de l’étape 5' }).click();
    await page.getByRole('menuitem', { name: 'Supprimer l’étape 5' }).click();
    await expect(flow.getByRole('button', { name: /^Étape 5 :/ })).toHaveCount(0);
    expect(await stepRows(sequenceId)).toEqual([]);
  });

  test('à 360 px : fil sans défilement horizontal, panneau d’étape plein écran', async ({ browser, org }) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
    const missionId = await seedMission(org.orgId, owner.userId, { name: 'Responsable paie' });
    const seeded = await seedBranchedSequence(org.orgId, owner.userId, missionId, account);

    const page = await openEditor(browser, owner, account, seeded.sequenceId, { width: 360, height: 780 });
    const flow = page.getByRole('list', { name: 'Étapes de la séquence' });
    await expect(flow).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    // Menu de carte visible au toucher, cible de 44 px.
    const menu = flow.getByRole('button', { name: 'Actions de l’étape 3' });
    await expect(menu).toBeVisible();
    expect((await menu.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await flow.getByRole('button', { name: /^Étape 3 : Message LinkedIn/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Étape 3 · Message LinkedIn' });
    await expect(sheet).toBeVisible();
    await expect.poll(async () => Math.round((await sheet.boundingBox())?.width ?? 0)).toBe(360);
    expect(await sheet.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  });

  test('créer de zéro : rien d’écrit avant « Enregistrer », variable inconnue bloquante, branches, version B, enregistrer puis rouvrir', async ({ browser, org }) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
    const page = await openAt(browser, owner, account, '/sequences?sequences-v2=1');
    const name = `Approche créée ${rand()}`;

    // « Créer une séquence » : « Nouvelle séquence », trois départs, puis l'éditeur sur /sequences/nouvelle.
    await page.getByRole('button', { name: 'Créer une séquence' }).click({ timeout: 30_000 });
    const dialog = page.getByRole('dialog', { name: 'Nouvelle séquence' });
    await expect(dialog.getByRole('button', { name: /Partir d’un modèle/ })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Copier une séquence/ })).toBeVisible();
    await dialog.getByRole('button', { name: /Partir de zéro/ }).click();
    await expect(page).toHaveURL(/\/sequences\/nouvelle\?depart=zero/);
    await expect(page.getByRole('heading', { name: 'Commencer par ajouter une étape' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Nouvelle séquence' })).toBeVisible();
    await expect(page.getByText('Modifications non enregistrées')).toBeVisible();
    // Création : onglets Étapes et Réglages seulement.
    await expect(page.getByRole('tab', { name: 'Réglages' })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Candidats/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Renommer la séquence' }).click();
    await page.getByRole('textbox', { name: 'Nom de la séquence' }).fill(name);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

    // Vérification de la connexion, puis Non connecté : invitation et attente ; Connecté : un message.
    await page.getByRole('tab', { name: 'Conditions et attentes' }).click();
    await page.getByRole('button', { name: 'Vérifier la connexion', exact: true }).click();
    const flow = page.getByRole('list', { name: 'Étapes de la séquence' });
    const check = flow.getByRole('group', { name: 'Branches de l’étape 1' });
    await check.getByRole('button', { name: 'Ajouter une étape dans la branche Non connecté' }).click();
    let palette = page.getByRole('dialog', { name: 'Ajouter une étape' });
    await palette.getByRole('button', { name: 'Invitation LinkedIn', exact: true }).click();
    await check.getByRole('button', { name: 'Ajouter une étape dans la branche Non connecté' }).click();
    palette = page.getByRole('dialog', { name: 'Ajouter une étape' });
    await palette.getByRole('tab', { name: 'Conditions et attentes' }).click();
    await palette.getByRole('button', { name: 'Attendre la connexion', exact: true }).click();
    await check.getByRole('button', { name: 'Ajouter une étape dans la branche Connecté (1er degré)' }).click();
    palette = page.getByRole('dialog', { name: 'Ajouter une étape' });
    await palette.getByRole('button', { name: 'Message LinkedIn', exact: true }).click();
    const panel = page.getByRole('complementary', { name: 'Réglages de l’étape 4' });
    await expect(panel.getByRole('heading', { name: 'Étape 4 · Message LinkedIn' })).toBeVisible();

    // Variable inconnue : soulignée, bloquante dans la barre de vérification, enregistrement refusé.
    await panel.locator('#message').fill('Bonjour {{prenom}}, un poste chez {{societe}} pourrait vous plaire.');
    const bar = page.getByRole('region', { name: 'Vérification de la séquence' });
    await expect(bar.getByText('1 point à corriger avant d’enregistrer')).toBeVisible();
    await expect(bar.getByText(/\{\{societe\}\} n’est pas une variable connue/)).toBeVisible();
    await expect(page.getByRole('tab', { name: /Étapes/ })).toContainText('point à corriger');
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(toast(page, '1 point à corriger avant d’enregistrer')).toBeVisible();
    expect((await admin().from('outreach_sequences').select('id').eq('organization_id', org.orgId).eq('name', name)).data ?? []).toHaveLength(0);

    // Corrigée par une puce : « + Variable » écrit la clé du moteur.
    await panel.locator('#message').fill('Bonjour {{prenom}}, un poste de ');
    await panel.getByRole('button', { name: 'Insérer une variable' }).click();
    await page.getByRole('menuitem', { name: /^Poste recherché/ }).click();
    await expect(panel.locator('#message')).toHaveValue('Bonjour {{prenom}}, un poste de {{poste_recherche}}');
    await expect(bar.getByText('Prête à recevoir des candidats')).toBeVisible();
    // Texte de secours : écrit dans la syntaxe du moteur.
    await panel.getByLabel('Texte de secours pour Prénom').fill('Madame, Monsieur');
    await expect(panel.locator('#message')).toHaveValue('Bonjour {{prenom | fallback:"Madame, Monsieur"}}, un poste de {{poste_recherche}}');

    // Version B, rédigée à la main.
    await panel.getByRole('button', { name: 'Ajouter une version' }).click();
    await panel.locator('#message').fill('Bonjour {{prenom}}, échangeons ?');
    await expect(flow.getByText('A/B · 2 versions')).toBeVisible();

    // Ctrl+S : la séquence est créée, la page passe sur son adresse.
    await page.keyboard.press('Control+s');
    await expect(page).toHaveURL(/\/sequences\/[0-9a-f-]{36}\?onglet=etapes/, { timeout: 30_000 });
    const created = (await admin().from('outreach_sequences').select('id, project_id, is_active').eq('organization_id', org.orgId).eq('name', name)).data ?? [];
    expect(created).toHaveLength(1);
    const rows = (await admin().from('sequence_steps').select('id, step_order, action_type, message_template, variant_group, variant_weight, if_true_goto_step, if_false_goto_step, timeout_days').eq('sequence_id', created[0].id).order('step_order')).data ?? [];
    expect(rows.map((r) => r.action_type).sort()).toEqual(['check_connection', 'connection_request', 'message', 'message', 'wait_connection'].sort());
    const checkRow = rows.find((r) => r.action_type === 'check_connection');
    const messages = rows.filter((r) => r.action_type === 'message');
    expect(messages.map((m) => [m.variant_group, m.variant_weight]).sort()).toEqual([['A', 50], ['B', 50]]);
    expect(checkRow?.if_true_goto_step).toBe(messages.find((m) => m.variant_group === 'A')?.id);
    expect(checkRow?.if_false_goto_step).toBe(rows.find((r) => r.action_type === 'connection_request')?.id);
    expect(messages.find((m) => m.variant_group === 'A')?.message_template).toBe('Bonjour {{prenom | fallback:"Madame, Monsieur"}}, un poste de {{poste_recherche}}');
    expect(rows.find((r) => r.action_type === 'wait_connection')?.timeout_days).toBe(3);

    // Rouverte : même fil, même texte.
    await page.reload({ waitUntil: 'domcontentloaded' });
    const reopened = page.getByRole('list', { name: 'Étapes de la séquence' });
    await expect(reopened.getByRole('region', { name: 'Branche : Connecté (1er degré)' })).toBeVisible({ timeout: 30_000 });
    await expect(reopened.getByText('A/B · 2 versions')).toBeVisible();
    await reopened.getByRole('button', { name: /^Étape \d+ : Message LinkedIn/ }).click();
    await expect(page.locator('#message')).toHaveValue('Bonjour {{prenom | fallback:"Madame, Monsieur"}}, un poste de {{poste_recherche}}');
    await expect(page.getByRole('button', { name: 'Enregistrer', exact: true })).toHaveCount(0);
  });

  test('modifier, recharger (brouillon repris), « Quitter sans enregistrer ? », Ctrl+S puis rouvrir', async ({ browser, org }) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
    const missionId = await seedMission(org.orgId, owner.userId, { name: 'Directeur administratif' });
    const seeded = await seedBranchedSequence(org.orgId, owner.userId, missionId, account);

    const page = await openEditor(browser, owner, account, seeded.sequenceId);
    page.on('dialog', (d) => { void d.accept(); });
    const flow = page.getByRole('list', { name: 'Étapes de la séquence' });
    await expect(flow).toBeVisible({ timeout: 30_000 });
    await flow.getByRole('button', { name: /^Étape 4 : Message LinkedIn/ }).click();
    await page.locator('#message').fill('Je reviens vers vous, {{prenom}}.');

    // Un seul bouton plein : « Enregistrer » ; « Inscrire des candidats » passe en contour.
    const save = page.getByRole('button', { name: 'Enregistrer', exact: true });
    await expect(save).toBeVisible();
    await expect(page.getByText('Modifications non enregistrées')).toBeVisible();
    // Lien de l'application : « Quitter sans enregistrer ? », « Rester » garde tout.
    await page.getByRole('link', { name: 'Inscrire des candidats' }).click();
    const leave = page.getByRole('alertdialog', { name: 'Quitter sans enregistrer ?' });
    await expect(leave).toBeVisible();
    await leave.getByRole('button', { name: 'Rester' }).click();
    await expect(page).toHaveURL(new RegExp(`/sequences/${seeded.sequenceId}`));
    await expect(page.locator('#message')).toHaveValue('Je reviens vers vous, {{prenom}}.');
    // Changement d'onglet vers Candidats : même fenêtre.
    await page.getByRole('tab', { name: /Candidats/ }).click();
    await expect(leave).toBeVisible();
    await leave.getByRole('button', { name: 'Rester' }).click();

    // Rechargement : le brouillon local reprend la modification, rien n'est écrit.
    await page.waitForTimeout(1500);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(toast(page, 'Modifications non enregistrées reprises')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Enregistrer', exact: true })).toBeVisible();
    expect((await stepRows(seeded.sequenceId)).find((r) => r.id === seeded.id.relance)?.message_template).toBe('Je me permets de revenir vers vous.');
    await flow.getByRole('button', { name: /^Étape 4 : Message LinkedIn/ }).click();
    await expect(page.locator('#message')).toHaveValue('Je reviens vers vous, {{prenom}}.');

    // Ctrl+S : enregistré, état de l'en-tête, rien à confirmer.
    await page.keyboard.press('Control+s');
    await expect(toast(page, 'Séquence mise à jour')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/^Enregistré à \d{1,2} h \d{2}$/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enregistrer', exact: true })).toHaveCount(0);
    await expect.poll(async () => (await stepRows(seeded.sequenceId)).find((r) => r.id === seeded.id.relance)?.message_template).toBe('Je reviens vers vous, {{prenom}}.');
    // Les autres étapes, versions et branches sont intactes.
    const after = await stepRows(seeded.sequenceId);
    expect(after.map((r) => r.id).sort()).toEqual(Object.values(seeded.id).sort());

    // Rouverte : texte retrouvé, aucun brouillon à reprendre.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await flow.getByRole('button', { name: /^Étape 4 : Message LinkedIn/ }).click({ timeout: 30_000 });
    await expect(page.locator('#message')).toHaveValue('Je reviens vers vous, {{prenom}}.');
    await expect(toast(page, 'Modifications non enregistrées reprises')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Enregistrer', exact: true })).toHaveCount(0);
  });

  test('aperçu réel : inscrit, puis Retenu de la mission, puis l’exemple ; donnée absente surlignée ; rien dans le stockage local', async ({ browser, org }) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
    const missionId = await seedMission(org.orgId, owner.userId, { name: 'Directeur financier', job_details: { title: 'Directeur financier' } });
    await seedCandidateRow({
      orgId: org.orgId,
      createdBy: owner.userId,
      candidateId: `cand_${randomUUID()}`,
      missionId,
      stage: 'retained',
      extra: { candidate_name: 'Claire Retenue', candidate_headline: 'Directrice financière chez Somfy', linkedin_profile_url: `https://www.linkedin.com/in/claire-${rand()}` },
    });
    const { sequenceId } = await createSequence(org.orgId, owner.userId, missionId);
    const msgId = randomUUID();
    const { error } = await admin().from('sequence_steps').insert([
      { id: randomUUID(), sequence_id: sequenceId, step_order: 0, action_type: 'profile_visit', delay_days: 0 },
      { id: msgId, sequence_id: sequenceId, step_order: 1, action_type: 'message', delay_days: 1, message_template: 'Bonjour {{prenom}}, votre parcours chez {{entreprise_actuelle}} pour un poste de {{poste_recherche}} à {{lieu_poste}}.' },
    ]);
    if (error) throw new Error(error.message);
    await seedEnrollment(org.orgId, sequenceId, owner.userId, { account_id: account, profile_name: 'Alice Martin', profile_headline: 'Contrôleuse de gestion chez Adeo', profile_url: `https://www.linkedin.com/in/alice-${rand()}`, user_timezone: 'Europe/Paris' });

    const page = await openEditor(browser, owner, account, sequenceId);
    const flow = page.getByRole('list', { name: 'Étapes de la séquence' });
    await expect(flow).toBeVisible({ timeout: 30_000 });
    await flow.getByRole('button', { name: /^Étape 2 : Message LinkedIn/ }).click();
    const preview = page.getByRole('region', { name: 'Aperçu du message' });
    // Inscrit d'abord.
    await expect(preview.getByRole('heading', { name: 'Aperçu pour Alice Martin' })).toBeVisible({ timeout: 30_000 });
    await expect(preview.getByText('Inscrit à la séquence')).toBeVisible();
    // Valeurs de l'inscription, comme le moteur : sans mission ni poste écrits sur l'inscription, le poste manque.
    await expect(preview.getByText(/Bonjour Alice, votre parcours chez Adeo pour un poste de/)).toBeVisible();
    // Données absentes : surlignées là où la variable sera retirée du texte envoyé.
    await expect(preview.locator('mark')).toHaveText([/\[Poste recherché\]/, /\[Lieu du poste\]/]);
    await expect(preview.getByText('Donnée absente surlignée : la variable sera retirée du message envoyé.')).toBeVisible();
    // Puis le Retenu de la mission.
    await preview.getByRole('button', { name: 'Candidat suivant' }).click();
    await expect(preview.getByRole('heading', { name: 'Aperçu pour Claire Retenue' })).toBeVisible();
    await expect(preview.getByText('Retenu dans la mission')).toBeVisible();
    await expect(preview.getByText(/Bonjour Claire, votre parcours chez Somfy pour un poste de Directeur financier/)).toBeVisible();
    await expect(preview.locator('mark')).toHaveText([/\[Lieu du poste\]/]);
    // Puis l'exemple.
    await preview.getByRole('button', { name: 'Candidat suivant' }).click();
    await expect(preview.getByRole('heading', { name: 'Aperçu pour Claire Dubois' })).toBeVisible();
    await expect(preview.getByText('Exemple fictif')).toBeVisible();
    await expect(preview.getByText('3 / 3')).toBeVisible();
    // Aucune valeur d'aperçu dans le stockage du navigateur.
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    for (const value of ['Somfy', 'Adeo', 'Claire Retenue', 'Alice Martin']) expect(stored).not.toContain(value);
  });

  test('refus STEP_HAS_HISTORY et modification concurrente : messages existants, rien d’écrit', async ({ browser, org }) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
    const missionId = await seedMission(org.orgId, owner.userId, { name: 'Responsable comptable' });
    const seeded = await seedBranchedSequence(org.orgId, owner.userId, missionId, account);

    // Étape supprimée dans l'éditeur, envoyée entre-temps : le serveur refuse (STEP_HAS_HISTORY).
    let page = await openEditor(browser, owner, account, seeded.sequenceId);
    let flow = page.getByRole('list', { name: 'Étapes de la séquence' });
    await expect(flow).toBeVisible({ timeout: 30_000 });
    await flow.getByRole('button', { name: /^Étape 3 : Message LinkedIn/ }).click();
    const panel = page.getByRole('complementary', { name: 'Réglages de l’étape 3' });
    await panel.getByRole('group', { name: 'Versions de l’étape' }).getByRole('button', { name: 'Version B' }).click();
    await panel.getByRole('button', { name: 'Retirer la version B' }).click();
    await expect(flow.getByText('A/B · 2 versions')).toHaveCount(0);
    const { data: enrollments } = await admin().from('sequence_enrollments').select('id').eq('sequence_id', seeded.sequenceId).limit(1);
    await seedExecution(org.orgId, enrollments![0].id as string, { id: seeded.id.msgB, step_order: 2, action_type: 'message' }, { status: 'sent', executed_at: new Date().toISOString() });
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    const removal = page.getByRole('alertdialog', { name: 'Supprimer cette étape ?' });
    await expect(removal).toBeVisible();
    await removal.getByRole('button', { name: 'Supprimer et enregistrer' }).click();
    const confirmWarnings = page.getByRole('alertdialog', { name: 'Enregistrer malgré ces points ?' });
    if (await confirmWarnings.isVisible().catch(() => false)) await confirmWarnings.getByRole('button', { name: 'Enregistrer quand même' }).click();
    await expect(toast(page, /Cette étape a déjà été envoyée à des candidats : elle ne peut pas être supprimée\./)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Échec de l’enregistrement').first()).toBeVisible();
    expect((await stepRows(seeded.sequenceId)).some((r) => r.id === seeded.id.msgB)).toBe(true);

    // Étape ajoutée par un collègue depuis l'ouverture : refus avant toute écriture.
    page = await openEditor(browser, owner, account, seeded.sequenceId);
    flow = page.getByRole('list', { name: 'Étapes de la séquence' });
    await expect(flow).toBeVisible({ timeout: 30_000 });
    const added = randomUUID();
    const { error } = await admin().from('sequence_steps').insert({ id: added, sequence_id: seeded.sequenceId, step_order: 7, action_type: 'profile_visit', delay_days: 1 });
    if (error) throw new Error(error.message);
    await flow.getByRole('button', { name: /^Étape 4 : Message LinkedIn/ }).click();
    await page.locator('#message').fill('Texte modifié pendant la modification d’un collègue.');
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(toast(page, 'Cette séquence a été modifiée par un collègue depuis son ouverture. Rouvrez-la avant d’enregistrer.')).toBeVisible({ timeout: 30_000 });
    const rows = await stepRows(seeded.sequenceId);
    expect(rows.find((r) => r.id === seeded.id.relance)?.message_template).toBe('Je me permets de revenir vers vous.');
    expect(rows.some((r) => r.id === added)).toBe(true);
  });

  test('panneau de mission, drapeau allumé : « Modifier » et « Créer une séquence » mènent à l’éditeur unique', async ({ browser, org }) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
    const missionId = await seedMission(org.orgId, owner.userId, { name: 'Acheteur industriel' });
    const seeded = await seedBranchedSequence(org.orgId, owner.userId, missionId, account);

    const page = await openAt(browser, owner, account, `/missions/${missionId}?tab=outreach&sequences-v2=1`);
    await page.getByRole('button', { name: `Actions de la séquence ${seeded.name}` }).click({ timeout: 30_000 });
    await page.getByRole('menuitem', { name: 'Modifier' }).click();
    await expect(page).toHaveURL(new RegExp(`/sequences/${seeded.sequenceId}\\?depuis=mission:${missionId}&onglet=etapes`));
    await expect(page.getByRole('list', { name: 'Étapes de la séquence' })).toBeVisible({ timeout: 30_000 });

    await page.goto(`/missions/${missionId}?tab=outreach`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Créer une séquence' }).click({ timeout: 30_000 });
    const dialog = page.getByRole('dialog', { name: 'Nouvelle séquence' });
    await expect(dialog.getByText('Rien n’est enregistré avant « Enregistrer ».')).toBeVisible();
    await dialog.getByRole('button', { name: /Copier une séquence/ }).click();
    await page.getByRole('button', { name: new RegExp(seeded.name) }).click();
    await expect(page).toHaveURL(new RegExp(`/sequences/nouvelle\\?mission=${missionId}&depart=copie:${seeded.sequenceId}`));
    await expect(page.getByRole('heading', { level: 1, name: `Copie de ${seeded.name}` })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('navigation', { name: 'Fil d’Ariane' }).getByRole('link', { name: 'Acheteur industriel' })).toBeVisible();
    // Copie complète, rien d'écrit.
    await expect(page.getByRole('list', { name: 'Étapes de la séquence' }).getByRole('region', { name: 'Branche : Pas acceptée après 10 jours' })).toBeVisible();
    expect((await admin().from('outreach_sequences').select('id').eq('organization_id', org.orgId).eq('name', `Copie de ${seeded.name}`)).data ?? []).toHaveLength(0);
  });

  test('partir d’un modèle depuis le panneau de mission : rien d’écrit, puis la séquence de la mission remplace /sequences/nouvelle', async ({ browser, org }) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
    const missionId = await seedMission(org.orgId, owner.userId, { name: 'Contrôleur de gestion' });
    const page = await openAt(browser, owner, account, `/missions/${missionId}?tab=outreach&sequences-v2=1`);

    // Mission sans séquence : l'état vide du panneau porte les départs (lot 5e), « Depuis un modèle » ouvre la galerie.
    await expect(page.getByText('Cette mission n’a pas encore de séquence.')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Partir de zéro' })).toBeVisible();
    await page.getByRole('button', { name: 'Depuis un modèle' }).click();
    const gallery = page.getByRole('dialog', { name: 'Choisir un modèle' });
    await gallery.getByRole('button', { name: 'Utiliser ce modèle : Invitation puis message' }).click();
    await expect(page).toHaveURL(new RegExp(`/sequences/nouvelle\\?mission=${missionId}&depart=modele:invitation-message$`));

    // Éditeur rempli, non enregistré : quatre étapes, mission dans le fil d'Ariane.
    await expect(page.getByRole('heading', { level: 1, name: 'Invitation puis message' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('navigation', { name: 'Fil d’Ariane' }).getByRole('link', { name: 'Contrôleur de gestion' })).toBeVisible();
    const flow = page.getByRole('list', { name: 'Étapes de la séquence' });
    await expect(flow.getByRole('button', { name: /^Étape \d+ : / })).toHaveCount(4);
    await expect(page.getByText('Modifications non enregistrées')).toBeVisible();
    expect((await admin().from('outreach_sequences').select('id').eq('organization_id', org.orgId)).data ?? []).toHaveLength(0);

    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/sequences/[0-9a-f-]{36}\\?depuis=mission:${missionId}&onglet=etapes$`), { timeout: 30_000 });
    await expect(toast(page, 'Séquence créée')).toBeVisible();
    const created = (await admin().from('outreach_sequences').select('id, project_id, is_active, name').eq('organization_id', org.orgId)).data ?? [];
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ project_id: missionId, is_active: true, name: 'Invitation puis message' });
    expect(page.url()).toContain(created[0].id);
    expect((await stepRows(created[0].id)).map((r) => r.action_type)).toEqual(['profile_visit', 'connection_request', 'wait_connection', 'message']);
    // La page de la séquence : enregistrée, « Inscrire des candidats » seul bouton plein.
    await expect(page.getByRole('button', { name: 'Enregistrer', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Inscrire des candidats' })).toBeVisible();

    // Pas d'entrée d'historique en double : « Retour » revient à la mission, pas à /sequences/nouvelle.
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/missions/${missionId}`), { timeout: 30_000 });
    expect((await admin().from('outreach_sequences').select('id').eq('organization_id', org.orgId)).data ?? []).toHaveLength(1);
  });

  test('modèle de l’organisation (onglet Modèles) : l’éditeur s’ouvre rempli, rien d’écrit avant « Enregistrer »', async ({ browser, org }) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
    const templateName = `Modèle maison ${rand()}`;
    const { data: template, error } = await admin().from('sequence_templates').insert({
      name: templateName,
      organization_id: org.orgId,
      created_by: owner.userId,
      is_system: false,
      steps_config: [
        { id: 'v', step_order: 0, action_type: 'profile_visit', delay_days: 0 },
        { id: 'm', step_order: 1, action_type: 'message', delay_days: 2, message_template: 'Bonjour {{prenom}}, un poste pourrait vous intéresser.' },
      ],
    }).select('id').single();
    if (error || !template) throw new Error(`modèle : ${error?.message}`);

    const page = await openAt(browser, owner, account, '/sequences?onglet=modeles&sequences-v2=1');
    await page.getByRole('button', { name: `Utiliser ce modèle : ${templateName}` }).click({ timeout: 30_000 });
    await expect(page).toHaveURL(new RegExp(`/sequences/nouvelle\\?depart=modele:${template.id}$`));
    await expect(page.getByRole('heading', { level: 1, name: templateName })).toBeVisible({ timeout: 30_000 });
    const flow = page.getByRole('list', { name: 'Étapes de la séquence' });
    await flow.getByRole('button', { name: /^Étape 2 : Message LinkedIn/ }).click();
    await expect(page.locator('#message')).toHaveValue('Bonjour {{prenom}}, un poste pourrait vous intéresser.');
    expect((await admin().from('outreach_sequences').select('id').eq('organization_id', org.orgId)).data ?? []).toHaveLength(0);
  });

  test('formule gratuite : texte de la spécification avant d’enregistrer, séquence créée sans envoi', async ({ browser, org }) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId, 'free');
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
    const page = await openAt(browser, owner, account, '/sequences/nouvelle?depart=modele:verifier-connexion&sequences-v2=1');
    await expect(page.getByRole('heading', { level: 1, name: 'Vérifier la connexion d’abord' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Votre formule permet de préparer des séquences et d’écrire aux candidats un par un. L’envoi automatique, avec les relances, fait partie des formules payantes.', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('link', { name: 'Voir les offres' })).toHaveAttribute('href', '/pricing');
    // Une fois par personne : « Compris » ferme l'avis, qui ne revient pas au rechargement.
    await page.getByRole('button', { name: 'Compris', exact: true }).click();
    await expect(page.getByText('L’envoi automatique, avec les relances, fait partie des formules payantes.', { exact: false })).toHaveCount(0);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Vérifier la connexion d’abord' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('list', { name: 'Étapes de la séquence' })).toBeVisible();
    await expect(page.getByText('L’envoi automatique, avec les relances, fait partie des formules payantes.', { exact: false })).toHaveCount(0);

    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(page).toHaveURL(/\/sequences\/[0-9a-f-]{36}\?onglet=etapes$/, { timeout: 30_000 });
    // L'avis a donné la raison avant d'enregistrer : le toast dit seulement ce qui a été fait.
    await expect(toast(page, 'Séquence enregistrée sans envoi automatique')).toBeVisible();
    await expect(toast(page, 'Séquence enregistrée sans envoi automatique')).not.toContainText('formules payantes');
    // Jamais activée : « Brouillon ».
    await expect(page.getByRole('button', { name: /Brouillon/ })).toBeVisible();
    const created = (await admin().from('outreach_sequences').select('id, is_active, project_id').eq('organization_id', org.orgId)).data ?? [];
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ is_active: false, project_id: null });
    expect(await stepRows(created[0].id)).toHaveLength(5);
  });

  test('enregistrer puis rouvrir sans perte : chaque colonne relue en base (copies, signature, replis, versions, créneau, seuil)', async ({ browser, org }) => {
    test.setTimeout(300_000);
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
    const missionId = await seedMission(org.orgId, owner.userId, { name: 'Responsable trésorerie' });
    // Jeux canoniques (une charge de save_sequence_steps) : un enregistrement n'y change que ce qui est modifié.
    const cases: Array<{ fixture: string; card: RegExp; type: string }> = [
      { fixture: 'E-mail (type fermé) : copies, désinscription et signature', card: /^Étape 1 : E-mail/, type: 'email' },
      { fixture: 'Vérifier la connexion à deux branches, attente avec repli InMail', card: /^Étape \d+ : Message LinkedIn/, type: 'message' },
      { fixture: 'Versions A, B et C d’une invitation avec note', card: /^Étape 1 : Invitation LinkedIn/, type: 'connection_request' },
      { fixture: 'Version B d’un message (60 / 40)', card: /^Étape 2 : Message LinkedIn/, type: 'message' },
      { fixture: 'Message LinkedIn : délai, créneau d’envoi et condition', card: /^Étape 2 : Message LinkedIn/, type: 'message' },
      { fixture: 'Seuil de note et InMail rédigé par l’IA', card: /^Étape 1 : InMail/, type: 'inmail' },
    ];
    let page: Page | null = null;
    for (const c of cases) {
      const fixture = FIXTURES.sequences.find((f) => f.name === c.fixture);
      expect(fixture, c.fixture).toBeTruthy();
      expect(fixture!.expected, `${c.fixture} : jeu canonique`).toBeUndefined();
      const { sequenceId } = await createSequence(org.orgId, owner.userId, missionId);
      const seeded = await seedFixtureRows(sequenceId, fixture!.rows);
      const before = await fullRows(sequenceId);
      expect(before).toEqual([...seeded].sort((a, b) => a.id.localeCompare(b.id)));

      if (!page) page = await openEditor(browser, owner, account, sequenceId);
      else await page.goto(`/sequences/${sequenceId}?onglet=etapes&sequences-v2=1`, { waitUntil: 'domcontentloaded' });
      const flow = page.getByRole('list', { name: 'Étapes de la séquence' });
      await flow.getByRole('button', { name: c.card }).first().click({ timeout: 30_000 });
      const text = `Texte relu ${rand()}, {{prenom}}.`;
      await page.locator('#message').fill(text);
      await page.keyboard.press('Control+s');
      const confirmWarnings = page.getByRole('alertdialog', { name: 'Enregistrer malgré ces points ?' });
      const saved = toast(page, 'Séquence mise à jour');
      await expect(saved.or(confirmWarnings)).toBeVisible({ timeout: 30_000 });
      if (await confirmWarnings.isVisible()) await confirmWarnings.getByRole('button', { name: 'Enregistrer quand même' }).click();
      await expect(saved).toBeVisible({ timeout: 30_000 });

      // Relecture en base : une seule colonne d'une seule ligne a changé, le texte saisi.
      await expect.poll(async () => (await fullRows(sequenceId)).some((r) => r.message_template === text), { timeout: 20_000 }).toBe(true);
      const after = await fullRows(sequenceId);
      const edited = after.find((r) => r.message_template === text)!;
      expect(edited.action_type, c.fixture).toBe(c.type);
      expect(after, `${c.fixture} : rien d’autre n’a bougé`).toEqual(before.map((r) => (r.id === edited.id ? { ...r, message_template: text } : r)));

      // Rouverte : même texte, rien à enregistrer.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await flow.getByRole('button', { name: c.card }).first().click({ timeout: 30_000 });
      await expect(page.locator('#message')).toHaveValue(text);
      await expect(page.getByRole('button', { name: 'Enregistrer', exact: true })).toHaveCount(0);
      await expect(toast(page, 'Modifications non enregistrées reprises')).toHaveCount(0);
    }
  });

  test('une séquence de 17 étapes reste lisible à 1 280 et 360 px (captures jointes)', async ({ browser, org }, testInfo) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
    const missionId = await seedMission(org.orgId, owner.userId, { name: 'Directeur commercial' });
    const { sequenceId } = await createSequence(org.orgId, owner.userId, missionId);
    // Séquence recommandée de l'ancien éditeur (modèle « sequence-longue ») : deux fourches imbriquées.
    await seedFixtureRows(sequenceId, FIXTURES.recommended.payload);

    for (const viewport of [{ width: 1280, height: 900 }, { width: 360, height: 780 }]) {
      const page = await openEditor(browser, owner, account, sequenceId, viewport);
      const flow = page.getByRole('list', { name: 'Étapes de la séquence' });
      await expect(flow).toBeVisible({ timeout: 30_000 });
      await expect(flow.getByRole('button', { name: /^Étape \d+ : / })).toHaveCount(17);
      for (let n = 1; n <= 17; n += 1) await expect(flow.getByRole('button', { name: new RegExp(`^Étape ${n} : `) })).toHaveCount(1);
      for (const branch of ['Connecté (1er degré)', 'Non connecté', 'Acceptée', 'Pas acceptée après 3 jours']) {
        await expect(flow.getByRole('region', { name: `Branche : ${branch}` })).toBeVisible();
      }
      await expect(flow.getByText('Fin de la séquence').first()).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `défilement horizontal à ${viewport.width} px`).toBeLessThanOrEqual(0);
      await expectReadableCards(page, viewport.width, viewport.width >= 768 ? 200 : 240);
      // Aucun « Hors du parcours » : chaque étape est dans le fil.
      await expect(page.getByText('Hors du parcours')).toHaveCount(0);
      // Barre de vérification collée en bas de la fenêtre, page tout en haut, et bulle de l'assistant effacée.
      await page.evaluate(() => window.scrollTo(0, 0));
      const bar = page.getByRole('region', { name: 'Vérification de la séquence' });
      await expect.poll(async () => { const box = await bar.boundingBox(); return box ? Math.round(box.y + box.height) : -1; }).toBeLessThanOrEqual(viewport.height);
      const bubble = page.locator(`button[aria-label="Ouvrir l'assistant"]`);
      await expect(bubble).toHaveCount(1);
      await expect(bubble).toBeHidden();
      if (viewport.width >= 768) {
        // Carte 14, bas du fil : le panneau s'ouvre dans la fenêtre, et la barre reste collée.
        const card14 = flow.getByRole('button', { name: /^Étape 14 : / });
        await card14.scrollIntoViewIfNeeded();
        await card14.click();
        const panel = page.getByRole('complementary', { name: 'Réglages de l’étape 14' });
        await expect(panel.getByRole('heading', { name: /^Étape 14 · / })).toBeVisible();
        const box = await panel.boundingBox();
        expect(box?.y ?? -1, 'panneau au-dessus de la fenêtre').toBeGreaterThanOrEqual(0);
        expect((box?.y ?? 0) + Math.min(box?.height ?? 0, 200), 'panneau sous la fenêtre').toBeLessThanOrEqual(viewport.height);
        await expect(panel.getByRole('heading', { name: /^Étape 14 · / })).toBeInViewport();
        const barBox = await bar.boundingBox();
        expect(Math.round((barBox?.y ?? 0) + (barBox?.height ?? 0))).toBeLessThanOrEqual(viewport.height);
        await panel.getByRole('button', { name: 'Fermer le panneau de l’étape' }).click();
      }
      const path = testInfo.outputPath(`editeur-17-etapes-${viewport.width}.png`);
      await page.screenshot({ path, fullPage: true });
      await testInfo.attach(`editeur-17-etapes-${viewport.width}`, { path, contentType: 'image/png' });
    }
  });
});

// Corrections après relecture (sous-lot 5d-2) : comportements trouvés en revue, épinglés ici.
test.describe('Séquences v2 — éditeur unique, corrections de relecture (lot 5d-2)', () => {
  test.skip(!EDGE_DEPLOYED, EDGE_SKIP_REASON);

  /** Visite, vérification sans branche choisie (ajoutée dans l'ancienne liste), puis deux messages. */
  async function seedUnchosenCheck(orgId: string, ownerId: string, missionId: string) {
    const { sequenceId } = await createSequence(orgId, ownerId, missionId);
    const id = { visit: randomUUID(), check: randomUUID(), hello: randomUUID(), relance: randomUUID() };
    const { error } = await admin().from('sequence_steps').insert([
      { id: id.visit, step_order: 0, action_type: 'profile_visit' },
      { id: id.check, step_order: 1, action_type: 'check_connection', delay_days: 1 },
      { id: id.hello, step_order: 2, action_type: 'message', delay_days: 1, message_template: 'Bonjour {{prenom}}' },
      { id: id.relance, step_order: 3, action_type: 'message', delay_days: 4, message_template: 'Je relance' },
    ].map((row) => ({ delay_days: 0, ends_sequence: false, ...row, sequence_id: sequenceId })));
    if (error) throw new Error(`étapes : ${error.message}`);
    return { sequenceId, id };
  }

  const draftEntries = (page: Page) => page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.includes('sequence-editor')).map(([, v]) => v));
  /** « Plus d'options » ouvert (le panneau garde son état d'une étape à l'autre). */
  const openMoreOptions = async (panel: ReturnType<Page['getByRole']>) => {
    const more = panel.getByRole('button', { name: 'Plus d’options' });
    if ((await more.getAttribute('aria-expanded')) !== 'true') await more.click();
  };

  test('ajout dans « Non connecté » d’une vérification sans branche choisie : la suite de « Connecté » reste dans le fil ; « Après cette étape » dit ce que fait le moteur', async ({ browser, org }) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
    const missionId = await seedMission(org.orgId, owner.userId, { name: 'Directeur financier' });
    const { sequenceId, id } = await seedUnchosenCheck(org.orgId, owner.userId, missionId);

    const page = await openEditor(browser, owner, account, sequenceId);
    const flow = page.getByRole('list', { name: 'Étapes de la séquence' });
    await expect(flow).toBeVisible({ timeout: 30_000 });
    const connected = flow.getByRole('region', { name: 'Branche : Connecté (1er degré)' });
    await expect(connected.getByRole('button', { name: /^Étape 4 : Message LinkedIn/ })).toBeVisible();

    await flow.getByRole('button', { name: 'Ajouter une étape dans la branche Non connecté' }).click();
    await page.getByRole('dialog', { name: 'Ajouter une étape' }).getByRole('button', { name: 'InMail', exact: true }).click();
    // Ce que reçoivent les candidats déjà en relation ne change pas : les deux messages restent dans la branche.
    await expect(connected.getByRole('button', { name: /^Étape 3 : Message LinkedIn/ })).toBeVisible();
    await expect(connected.getByRole('button', { name: /^Étape 4 : Message LinkedIn/ })).toBeVisible();
    await expect(page.getByText('Hors du parcours')).toHaveCount(0);
    await expect(flow.getByRole('region', { name: 'Branche : Non connecté' }).getByRole('button', { name: /^Étape 5 : InMail/ })).toBeVisible();

    // Première étape d'une branche : le moteur s'arrête après elle, jamais « Continuer ».
    const panel = page.getByRole('complementary', { name: 'Réglages de l’étape 5' });
    await openMoreOptions(panel);
    await expect(panel.getByLabel('Après cette étape')).toHaveText('Terminer la séquence');
    await panel.getByLabel('Après cette étape').click();
    await expect(page.getByRole('option', { name: /^Continuer/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    // Étape 3, désormais visée par la vérification : sa suite est écrite.
    await flow.getByRole('button', { name: /^Étape 3 : Message LinkedIn/ }).click();
    const panel3 = page.getByRole('complementary', { name: 'Réglages de l’étape 3' });
    await openMoreOptions(panel3);
    await expect(panel3.getByLabel('Après cette étape')).toHaveText('Aller à l’étape 4 : Message LinkedIn');
    // Étape 1 du fil principal : « Continuer » nomme l'étape qui suit.
    await flow.getByRole('button', { name: /^Étape 1 : Visite de profil/ }).click();
    const panel1 = page.getByRole('complementary', { name: 'Réglages de l’étape 1' });
    await openMoreOptions(panel1);
    await expect(panel1.getByLabel('Après cette étape')).toHaveText('Continuer vers l’étape 2');

    await flow.getByRole('button', { name: /^Étape 5 : InMail/ }).click();
    await page.getByRole('complementary', { name: 'Réglages de l’étape 5' }).locator('#subject').fill('Poste de directeur financier');
    await page.getByRole('complementary', { name: 'Réglages de l’étape 5' }).locator('#message').fill('Bonjour {{prenom}}, un mot sur un poste.');
    await page.keyboard.press('Control+s');
    await expect(toast(page, 'Séquence mise à jour')).toBeVisible({ timeout: 30_000 });
    const { data } = await admin().from('sequence_steps').select('id, if_true_goto_step, if_false_goto_step, next_step_id').eq('sequence_id', sequenceId);
    const byId = new Map((data ?? []).map((r) => [r.id as string, r]));
    expect(byId.get(id.check)?.if_true_goto_step).toBe(id.hello);
    expect(byId.get(id.hello)?.next_step_id, 'la suite de « Connecté » est écrite').toBe(id.relance);
  });

  test('saisie pendant l’enregistrement : fil et panneau figés, rien de tapé n’est remplacé sans bruit par la version enregistrée', async ({ browser, org }) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
    const missionId = await seedMission(org.orgId, owner.userId, { name: 'Directeur financier' });
    const { sequenceId, id } = await seedUnchosenCheck(org.orgId, owner.userId, missionId);

    const page = await openEditor(browser, owner, account, sequenceId);
    // Enregistrement lent : 3 s avant d'écrire les étapes.
    await page.route('**/rest/v1/rpc/save_sequence_steps', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await route.continue();
    });
    const flow = page.getByRole('list', { name: 'Étapes de la séquence' });
    await expect(flow).toBeVisible({ timeout: 30_000 });
    await flow.getByRole('button', { name: /^Étape 4 : Message LinkedIn/ }).click();
    const message = page.locator('#message');
    await message.fill('Version 1');
    await message.press('Control+s');
    await expect(page.getByText('Enregistrement…').first()).toBeVisible();
    // Figé pendant l'enregistrement : la zone d'édition est inerte, la frappe n'entre pas dans le message.
    await expect(page.locator('[inert]').filter({ has: page.locator('#message') })).toHaveCount(1);
    // Texte sans « g » : la touche G ouvre les raccourcis de navigation de l'application quand le focus est sur la page.
    await page.keyboard.type(' encore du texte');
    await expect(message).toHaveValue('Version 1');
    await expect(toast(page, 'Séquence mise à jour')).toBeVisible({ timeout: 30_000 });
    // Après l'enregistrement : le message rend la main, au même endroit, et rien ne reste à enregistrer.
    await expect(page.locator('[inert]')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('message');
    await expect(message).toHaveValue('Version 1');
    await expect(page.getByText(/^Enregistré à \d{1,2} h \d{2}$/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enregistrer', exact: true })).toHaveCount(0);
    expect((await stepRows(sequenceId)).find((r) => r.id === id.relance)?.message_template).toBe('Version 1');
    // La saisie reprend normalement.
    await page.keyboard.type(' et la suite');
    await expect(message).toHaveValue('Version 1 et la suite');
    await expect(page.getByText('Modifications non enregistrées', { exact: true })).toBeVisible();
  });

  test('brouillon : retour du navigateur dans la seconde, réglages modifiés sans ouvrir Étapes, « Dupliquer » demande avant de quitter', async ({ browser, org }) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
    const missionId = await seedMission(org.orgId, owner.userId, { name: 'Directeur financier' });
    const { sequenceId, name } = await createSequence(org.orgId, owner.userId, missionId);
    const msgId = randomUUID();
    await admin().from('sequence_steps').insert([
      { id: randomUUID(), sequence_id: sequenceId, step_order: 0, action_type: 'profile_visit', delay_days: 0 },
      { id: msgId, sequence_id: sequenceId, step_order: 1, action_type: 'message', delay_days: 1, message_template: 'Texte initial' },
    ]);

    // 1. Modification puis retour du navigateur avant la seconde du brouillon : écrit au départ de l'éditeur.
    const page = await openAt(browser, owner, account, '/sequences?sequences-v2=1');
    await page.getByRole('link', { name }).first().click({ timeout: 30_000 });
    const flow = page.getByRole('list', { name: 'Étapes de la séquence' });
    await expect(flow).toBeVisible({ timeout: 30_000 });
    await flow.getByRole('button', { name: /^Étape 2 : Message LinkedIn/ }).click();
    await page.locator('#message').fill('Texte modifié puis retour');
    await page.goBack();
    await expect(page).toHaveURL(/\/sequences(\?|$)/);
    expect((await draftEntries(page)).some((v) => v.includes('Texte modifié puis retour'))).toBe(true);
    await page.goForward();
    await expect(toast(page, 'Modifications non enregistrées reprises')).toBeVisible({ timeout: 30_000 });
    await flow.getByRole('button', { name: /^Étape 2 : Message LinkedIn/ }).click();
    await expect(page.locator('#message')).toHaveValue('Texte modifié puis retour');
    await page.getByRole('button', { name: 'Revenir à la version enregistrée' }).click();
    await expect(page.getByRole('button', { name: 'Enregistrer', exact: true })).toHaveCount(0);

    // 2. Réglages modifiés sans avoir ouvert Étapes : brouillon écrit, repris au rechargement.
    await page.goto(`/sequences/${sequenceId}?onglet=reglages&sequences-v2=1`, { waitUntil: 'domcontentloaded' });
    const meeting = page.getByRole('switch', { name: /rendez-vous/ });
    await expect(meeting).toBeVisible({ timeout: 30_000 });
    const before = await meeting.getAttribute('aria-checked');
    await meeting.click();
    await expect(page.getByText('Modifications non enregistrées', { exact: true })).toBeVisible();
    await expect.poll(async () => (await draftEntries(page)).some((v) => v.includes('on_meeting_booked'))).toBe(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(toast(page, 'Modifications non enregistrées reprises')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('switch', { name: /rendez-vous/ })).not.toHaveAttribute('aria-checked', before ?? 'false');

    // 3. « Dupliquer » quitte la page : « Quitter sans enregistrer ? » d'abord ; « Rester » ne copie rien.
    await page.getByRole('button', { name: 'Plus d’actions sur la séquence' }).click();
    await page.getByRole('menuitem', { name: 'Dupliquer' }).click();
    const leave = page.getByRole('alertdialog', { name: 'Quitter sans enregistrer ?' });
    await expect(leave).toBeVisible();
    await leave.getByRole('button', { name: 'Rester' }).click();
    await expect(page).toHaveURL(new RegExp(`/sequences/${sequenceId}`));
    expect((await admin().from('outreach_sequences').select('id').eq('organization_id', org.orgId)).data ?? []).toHaveLength(1);
    await expect(page.getByText('Modifications non enregistrées', { exact: true })).toBeVisible();
  });

  test('« {{ » au clavier : suggestions sans prendre le focus, la frappe continue ; Entrée écrit la variable', async ({ browser, org }) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
    const missionId = await seedMission(org.orgId, owner.userId, { name: 'Directeur financier' });
    const { sequenceId } = await seedUnchosenCheck(org.orgId, owner.userId, missionId);

    const page = await openEditor(browser, owner, account, sequenceId);
    const flow = page.getByRole('list', { name: 'Étapes de la séquence' });
    await expect(flow).toBeVisible({ timeout: 30_000 });
    await flow.getByRole('button', { name: /^Étape 4 : Message LinkedIn/ }).click();
    const message = page.locator('#message');
    await message.click();
    await message.press('Control+End');
    // Clé tapée en entier : gardée telle quelle, rien n'est perdu.
    await page.keyboard.type(' {{prenom}} merci');
    await expect(message).toHaveValue('Je relance {{prenom}} merci');
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('message');
    await expect(page.getByRole('listbox', { name: 'Variables' })).toHaveCount(0);
    // Début de clé : la liste se filtre, Entrée écrit la clé du moteur, la frappe continue.
    await page.keyboard.type(', {{entre');
    const list = page.getByRole('listbox', { name: 'Variables' });
    await expect(list.getByRole('option', { name: /^Entreprise actuelle/ })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('message');
    await page.keyboard.press('Enter');
    await page.keyboard.type(' ?');
    await expect(message).toHaveValue('Je relance {{prenom}} merci, {{entreprise_actuelle}} ?');
    // Échap ferme la liste sans rien changer.
    await page.keyboard.type(' {{');
    await expect(list).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(list).toHaveCount(0);
    await expect(message).toHaveValue('Je relance {{prenom}} merci, {{entreprise_actuelle}} ? {{');
    await expect(page.getByRole('complementary', { name: 'Réglages de l’étape 4' })).toBeVisible();
  });
});

// Drapeau éteint (défaut) : rien de visible ne change ; l'ancien éditeur reste le seul chemin.
// Aucune fonction serveur appelée : ce bloc tourne aussi sur la CI de PR (@smoke), sans E2E_EDGE_FUNCTIONS.
test.describe('Séquences v2 — éditeur unique, drapeau éteint (lot 5d-2)', () => {
  test('@smoke drapeau éteint : /sequences/nouvelle renvoie vers les missions sans rien écrire ; « Modifier » et « Créer une séquence » du panneau ouvrent l’ancien éditeur', async ({ browser, org }) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
    const missionId = await seedMission(org.orgId, owner.userId, { name: 'Responsable paie' });
    const seeded = await seedBranchedSequence(org.orgId, owner.userId, missionId, account);

    const page = await openAt(browser, owner, account, `/sequences/nouvelle?mission=${missionId}&depart=modele:invitation-message`);
    await expect(page).toHaveURL(/\/missions(\?|$)/, { timeout: 30_000 });
    expect((await admin().from('outreach_sequences').select('id').eq('organization_id', org.orgId)).data ?? []).toHaveLength(1);

    await page.goto(`/missions/${missionId}?tab=outreach`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: `Actions de la séquence ${seeded.name}` }).click({ timeout: 30_000 });
    await page.getByRole('menuitem', { name: 'Modifier' }).click();
    // Ancien éditeur, dans une fenêtre, sur la même adresse : son sélecteur de mode, aucun fil de l'éditeur unique.
    const legacy = page.getByRole('dialog', { name: 'Modifier' });
    await expect(legacy).toBeVisible({ timeout: 30_000 });
    await expect(legacy.getByLabel("Mode d'édition")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/missions/${missionId}`));
    await expect(page.getByRole('list', { name: 'Étapes de la séquence' })).toHaveCount(0);
    await legacy.getByRole('button', { name: 'Retour à la liste' }).click();
    await expect(legacy).toBeHidden();

    // « Créer une séquence » : l'ancien choix de départ, jamais « Nouvelle séquence » de l'éditeur unique ni /sequences/nouvelle.
    await page.getByRole('button', { name: 'Créer une séquence' }).click();
    const chooser = page.getByRole('dialog', { name: 'Nouvelle séquence' });
    await expect(chooser).toBeVisible();
    await expect(chooser.getByText('Dupliquer une existante')).toBeVisible();
    await expect(chooser.getByText('Copier une séquence')).toHaveCount(0);
    await expect(chooser.getByText('Rien n’est enregistré avant « Enregistrer ».')).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/missions/${missionId}`));
    expect((await admin().from('outreach_sequences').select('id').eq('organization_id', org.orgId)).data ?? []).toHaveLength(1);
  });
});
