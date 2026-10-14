/**
 * Refonte mission, lot 5f-2d : « Inscrire dans une séquence » de la messagerie (/inbox),
 * interrupteur des séquences allumé (défaut) : une feuille latérale (InboxContactSheet) avec
 * le choix de la mission au-dessus du flux d'inscription du panneau Contacter.
 *
 *  1. avec une mission : le candidat de la conversation est prêt, la séquence de la mission
 *     est choisie d'avance, « Inscrire 1 candidat » écrit l'inscription (poste de la mission,
 *     identifiant du participant, compte de la page), la ligne de Pipeline Retenu, et ferme
 *     la feuille ;
 *  2. « Sans mission » : l'inscription existe sans poste, aucune ligne de Pipeline n'est
 *     créée, aucun texte ne parle de « cette mission » ;
 *  3. distance de réseau inconnue + séquence qui invite : « Relation LinkedIn non vérifiée »
 *     (3b : distance connue, pas d'avertissement) ;
 *  4. conversation sans identifiant de profil : la feuille le dit et ne propose que « Fermer » ;
 *  5. interrupteur éteint : le dialogue « Choisir une séquence » d'avant.
 *
 * Harnais : stack locale (vraie base, vraies gardes, vraies fonctions serveur pour l'aperçu :
 * E2E_EDGE_FUNCTIONS=1). Le faux prestataire ne sert pas de conversations : dans le navigateur
 * sont simulées la liste des comptes LinkedIn (unipile-accounts, action list) et la lecture des
 * conversations et des messages (unipile-search, actions get_chats et get_messages). Les
 * fonctions d'analyse par l'IA de la messagerie sont neutralisées. Modèle :
 * seq-v2-contacter.spec.ts et seq-v2-invitations.spec.ts (les fonctions utiles y sont copiées,
 * aucun helper partagé n'est modifié).
 */
import type { Browser, BrowserContext, Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures';
import { pinLegacySequences } from '../helpers/env';
import {
  admin,
  createOrg,
  deleteOrg,
  seedLinkedInAccount,
  seedMission,
  setOrgPlan,
  storageStateForUser,
  type TestOrg,
} from '../helpers/supabase-admin';

test.describe.configure({ timeout: 180_000 });

const EDGE = process.env.E2E_EDGE_FUNCTIONS === '1';
test.skip(!EDGE, 'draft-sequence (aperçu) absente : E2E_EDGE_FUNCTIONS=1');

const rand = () => Math.random().toString(36).slice(2, 10);

const contexts: BrowserContext[] = [];
const orgsToDelete: TestOrg[] = [];
test.afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close().catch(() => undefined);
  while (orgsToDelete.length) {
    const org = orgsToDelete.pop()!;
    await admin().from('job_candidate_status').delete().eq('organization_id', org.orgId);
    await admin().from('mission_conversations').delete().eq('organization_id', org.orgId);
    await deleteOrg(org);
  }
});

// ─── Données ────────────────────────────────────────────────────────────────

interface Workspace {
  org: TestOrg;
  accountId: string;
  missionId: string;
  missionName: string;
}

async function workspace(label: string): Promise<Workspace> {
  const org = await createOrg('agency', label);
  orgsToDelete.push(org);
  await setOrgPlan(org.orgId, 'cabinet');
  const accountId = await seedLinkedInAccount(org.orgId, org.owner.userId, `acc_msg_${rand()}`, 'OK');
  // Compte mature : plafonds pleins (un compte neuf démarre à 25 %).
  await admin().from('member_linkedin_accounts').update({ linked_at: '2026-01-01T00:00:00Z' }).eq('linkedin_account_id', accountId);
  const missionName = `Mission messagerie ${rand()}`;
  const missionId = await seedMission(org.orgId, org.owner.userId, { name: missionName });
  return { org, accountId, missionId, missionName };
}

interface SeqOptions {
  name?: string;
  projectId?: string | null;
  /** Étapes (snake_case, comme l'éditeur) ; défaut : un message. */
  steps?: Array<Record<string, unknown>>;
}

/** Séquence active de la mission (ou partagée si projectId est null), créée comme le fait l'éditeur. */
async function sequence(ws: Workspace, options: SeqOptions = {}): Promise<{ id: string; name: string }> {
  const name = options.name ?? `Approche ${rand()}`;
  const { data: seq, error } = await admin()
    .from('outreach_sequences')
    .insert({
      name,
      organization_id: ws.org.orgId,
      created_by: ws.org.owner.userId,
      project_id: options.projectId === undefined ? ws.missionId : options.projectId,
      is_active: true,
    })
    .select('id')
    .single();
  if (error || !seq) throw new Error(`sequence: ${error?.message}`);
  const steps = options.steps ?? [{ action_type: 'message', message_template: 'Bonjour {{firstName}}, une mission pour vous.' }];
  for (const [index, step] of steps.entries()) {
    const { error: stepErr } = await admin().from('sequence_steps').insert({
      sequence_id: seq.id,
      organization_id: ws.org.orgId,
      step_order: index,
      condition_type: 'always',
      delay_days: index === 0 ? 0 : 1,
      ...step,
    });
    if (stepErr) throw new Error(`sequence(étape ${index}): ${stepErr.message}`);
  }
  return { id: seq.id as string, name };
}

const INVITATION_THEN_MESSAGE = [
  { action_type: 'connection_request', message_template: null },
  { action_type: 'message', message_template: 'Bonjour {{firstName}}, merci pour la mise en relation.' },
];

// ─── Navigateur ─────────────────────────────────────────────────────────────

interface ChatSpec {
  name: string;
  /** Identifiant du participant (provider_id et attendee_provider_id) ; null : aucun identifiant exploitable. */
  participantId: string | null;
  /** Distance de réseau rendue par le fournisseur ; absente : le fournisseur ne la donne pas. */
  distance?: string;
}

function chatOf(ws: Workspace, spec: ChatSpec) {
  const slug = spec.name.toLowerCase().replace(/[^a-z]+/g, '-');
  return {
    id: `chat-${slug}`,
    account_id: ws.accountId,
    account_type: 'LINKEDIN',
    timestamp: '2026-10-09T09:00:00Z',
    attendees: [
      {
        id: `attendee-${slug}`,
        name: spec.name,
        ...(spec.participantId ? { provider_id: spec.participantId, attendee_provider_id: spec.participantId } : {}),
        profile_url: `https://www.linkedin.com/in/${slug}`,
        ...(spec.distance ? { specifics: { network_distance: spec.distance } } : {}),
      },
    ],
    last_message: { text: 'Bonjour, je suis disponible vendredi.', timestamp: '2026-10-09T09:00:00Z', is_sender: false },
  };
}

/** Contexte connecté en propriétaire ; simule la liste des comptes, les conversations et les messages. */
async function openContext(browser: Browser, ws: Workspace, spec: ChatSpec, opts: { legacy?: boolean } = {}): Promise<BrowserContext> {
  const context = await browser.newContext({
    storageState: await storageStateForUser(ws.org.owner, 'v3'),
    timezoneId: 'Europe/Paris',
  });
  contexts.push(context);
  if (opts.legacy) await pinLegacySequences(context);
  const bodyOf = (route: Route): { action?: string } | null => {
    try {
      return route.request().postDataJSON() as { action?: string } | null;
    } catch {
      return null;
    }
  };
  const json = (route: Route, data: unknown) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });

  await context.route('**/functions/v1/unipile-accounts', async (route) => {
    if (bodyOf(route)?.action === 'list') {
      return json(route, { success: true, accounts: [{ id: ws.accountId, account_status: 'OK', provider: 'LINKEDIN', name: 'E2E LinkedIn' }] });
    }
    return route.continue();
  });
  const chat = chatOf(ws, spec);
  await context.route('**/functions/v1/unipile-search', async (route) => {
    const action = bodyOf(route)?.action;
    if (action === 'get_chats') return json(route, { success: true, chats: [chat], cursors: {}, cursor: null });
    if (action === 'get_messages') {
      return json(route, {
        success: true,
        messages: [{ id: 'message-0', text: 'Bonjour, je suis disponible vendredi.', timestamp: '2026-10-09T09:00:00Z', is_sender: false }],
        cursor: null,
      });
    }
    return json(route, { success: true });
  });
  // Analyses par l'IA de la messagerie : hors du sujet, jamais d'appel au modèle.
  for (const fn of ['generate-reply-suggestions', 'analyze-response', 'auto-analyze-message', 'auto-categorize-chats']) {
    await context.route(`**/functions/v1/${fn}`, (route) => json(route, { success: true, suggestions: [], categories: [] }));
  }
  return context;
}

async function openInbox(browser: Browser, ws: Workspace, spec: ChatSpec, opts: { legacy?: boolean } = {}): Promise<Page> {
  const context = await openContext(browser, ws, spec, opts);
  const page = await context.newPage();
  await page.goto('/inbox', { waitUntil: 'domcontentloaded' });
  const row = page.getByRole('list', { name: 'Conversations', exact: true }).getByText(spec.name);
  await expect(row).toBeVisible({ timeout: 30_000 });
  return page;
}

/** Ouvre la conversation, puis « Plus d'actions » > « Inscrire dans une séquence ». */
async function startEnrollment(page: Page, spec: ChatSpec): Promise<void> {
  await page.getByRole('list', { name: 'Conversations', exact: true }).getByText(spec.name).click();
  await page.getByRole('button', { name: "Plus d'actions", exact: true }).click();
  await page.getByRole('menuitem', { name: 'Inscrire dans une séquence' }).click();
}

const SHEET_TITLE = 'Inscrire dans une séquence';
const sheet = (page: Page) => page.getByRole('dialog', { name: SHEET_TITLE });
const flow = (page: Page) => page.locator('[data-contact-flow]');
const missionSelect = (page: Page) => page.locator('#inbox-enroll-mission');
const toast = (page: Page, text: string | RegExp) => page.locator('[data-sonner-toast]').filter({ hasText: text });
const NOTICE = "Relation LinkedIn non vérifiée : si vous êtes déjà en relation, l'invitation sera sautée.";

async function chooseMission(page: Page, ws: Workspace): Promise<void> {
  await missionSelect(page).click();
  await page.getByRole('option', { name: ws.missionName, exact: true }).click();
  await expect(missionSelect(page)).toContainText(ws.missionName);
}

async function enrollmentsOf(sequenceId: string) {
  const { data, error } = await admin()
    .from('sequence_enrollments')
    .select('profile_id, status, account_id, job_id')
    .eq('sequence_id', sequenceId);
  if (error) throw new Error(`enrollmentsOf: ${error.message}`);
  return (data ?? []) as Array<{ profile_id: string; status: string; account_id: string; job_id: string | null }>;
}

async function pipelineRows(ws: Workspace, candidateId: string) {
  const { data, error } = await admin()
    .from('job_candidate_status')
    .select('general_stage, decision_source, job_id')
    .eq('organization_id', ws.org.orgId)
    .eq('candidate_id', candidateId);
  if (error) throw new Error(`pipelineRows: ${error.message}`);
  return (data ?? []) as Array<{ general_stage: string; decision_source: string | null; job_id: string }>;
}

// ─── Cas ────────────────────────────────────────────────────────────────────

test('messagerie : avec une mission, le candidat est prêt, la séquence de la mission est choisie d\'avance, l\'inscription et Retenu sont écrits, la feuille se ferme', async ({ browser }) => {
  const ws = await workspace('E2E messagerie mission');
  const seq = await sequence(ws);
  // Une séquence plus récente mais partagée : la séquence de la mission passe avant.
  await sequence(ws, { name: `Partagée ${rand()}`, projectId: null });
  const spec: ChatSpec = { name: 'Camille Durand', participantId: `ACoAAMSG${rand()}`, distance: 'SECOND_DEGREE' };

  const page = await openInbox(browser, ws, spec);
  await startEnrollment(page, spec);

  // La feuille : choix de la mission au-dessus du flux. Sans mission, rien n'est présélectionné.
  await expect(sheet(page)).toBeVisible({ timeout: 20_000 });
  await expect(missionSelect(page)).toBeVisible();
  await expect(missionSelect(page)).toContainText('Sans mission');
  await expect(flow(page)).toBeVisible({ timeout: 20_000 });

  // Mission choisie : sa séquence est choisie d'avance et le candidat est prêt.
  await chooseMission(page, ws);
  await expect(page.locator('[data-sequence-picker]')).toContainText(seq.name, { timeout: 20_000 });
  await expect(flow(page)).toContainText('1 prêt');
  await expect(flow(page).locator('[data-contact-group="ready"]').locator(`[data-contact-row="${spec.participantId}"]`)).toBeVisible({ timeout: 20_000 });
  // Distance connue : pas d'avertissement de relation.
  await expect(flow(page).getByText(NOTICE)).toHaveCount(0);

  const enroll = flow(page).getByRole('button', { name: /^Inscrire 1 candidat$/ });
  await expect(enroll).toBeEnabled({ timeout: 30_000 });
  await enroll.click();

  // Une inscription : poste de la mission, identifiant du participant, compte de la page.
  await expect.poll(async () => (await enrollmentsOf(seq.id)).length, { timeout: 30_000 }).toBe(1);
  const [enrollment] = await enrollmentsOf(seq.id);
  expect(enrollment.profile_id).toBe(spec.participantId);
  expect(enrollment.account_id).toBe(ws.accountId);
  expect(enrollment.status).toBe('active');
  // Le moteur retrouve la mission par son identifiant : « project:<uuid> » devient <uuid> (normalizedJobIdOf).
  expect(enrollment.job_id, 'poste de la mission, identifiant nu').toBe(ws.missionId);

  // Ligne de Pipeline Retenu, posée par l'origine « user », avec la clé de la mission.
  await expect.poll(async () => (await pipelineRows(ws, spec.participantId!)).map((r) => `${r.general_stage}/${r.decision_source}`), { timeout: 20_000 })
    .toEqual(['retained/user']);
  expect((await pipelineRows(ws, spec.participantId!))[0].job_id).toBe(`project:${ws.missionId}`);

  // La feuille est fermée, l'inscription annoncée.
  await expect(sheet(page)).toHaveCount(0, { timeout: 20_000 });
  await expect(flow(page)).toHaveCount(0);
  await expect(toast(page, /1 candidat inscrit dans la séquence/)).toBeVisible({ timeout: 20_000 });
});

test('messagerie : « Sans mission », l\'inscription existe sans poste, aucune ligne de Pipeline, aucun texte sur « cette mission »', async ({ browser }) => {
  const ws = await workspace('E2E messagerie sans mission');
  const seq = await sequence(ws);
  const spec: ChatSpec = { name: 'Nadia Sansmission', participantId: `ACoAAMSN${rand()}`, distance: 'SECOND_DEGREE' };

  const page = await openInbox(browser, ws, spec);
  await startEnrollment(page, spec);
  await expect(sheet(page)).toBeVisible({ timeout: 20_000 });
  await expect(missionSelect(page)).toContainText('Sans mission');
  await expect(flow(page)).toBeVisible({ timeout: 20_000 });

  // Sans mission, aucune séquence n'est présélectionnée : la personne choisit dans le menu de l'organisation.
  const picker = page.locator('[data-sequence-picker="ready"]');
  await expect(picker).toBeVisible({ timeout: 20_000 });
  await expect(picker).not.toContainText(seq.name);
  await picker.getByRole('button').click();
  await expect(page.getByRole('menu').getByText("Séquences de l'organisation", { exact: true })).toBeVisible();
  // Ni porte « Rédiger une séquence pour cette mission », ni libellé sur « cette mission », menu ouvert comme fermé.
  await expect(page.getByRole('menu')).not.toContainText(/cette mission/i);
  await page.getByRole('menuitem', { name: new RegExp(seq.name) }).click();
  await expect(picker).toContainText(seq.name);

  await expect(flow(page).locator('[data-contact-group="ready"]').locator(`[data-contact-row="${spec.participantId}"]`)).toBeVisible({ timeout: 20_000 });
  await expect(sheet(page)).not.toContainText(/cette mission/i);
  const enroll = flow(page).getByRole('button', { name: /^Inscrire 1 candidat$/ });
  await expect(enroll).toBeEnabled({ timeout: 30_000 });
  await enroll.click();

  await expect.poll(async () => (await enrollmentsOf(seq.id)).length, { timeout: 30_000 }).toBe(1);
  const [enrollment] = await enrollmentsOf(seq.id);
  expect(enrollment.profile_id).toBe(spec.participantId);
  expect(enrollment.job_id, 'sans mission, sans poste').toBeNull();
  await expect(sheet(page)).toHaveCount(0, { timeout: 20_000 });
  await expect(toast(page, /1 candidat inscrit dans la séquence/)).toBeVisible({ timeout: 20_000 });
  await expect(toast(page, /cette mission/i)).toHaveCount(0);

  // Rien dans le Pipeline : la règle Retenu ne s'applique qu'à une mission.
  expect(await pipelineRows(ws, spec.participantId!)).toEqual([]);
});

test('messagerie : distance inconnue et séquence qui invite, « Relation LinkedIn non vérifiée » est annoncée', async ({ browser }) => {
  const ws = await workspace('E2E messagerie distance');
  const seq = await sequence(ws, { steps: INVITATION_THEN_MESSAGE });
  // Le fournisseur ne donne pas la distance de réseau.
  const spec: ChatSpec = { name: 'Dina Distance', participantId: `ACoAAMDI${rand()}` };

  const page = await openInbox(browser, ws, spec);
  await startEnrollment(page, spec);
  await expect(sheet(page)).toBeVisible({ timeout: 20_000 });
  await chooseMission(page, ws);
  await expect(page.locator('[data-sequence-picker]')).toContainText(seq.name, { timeout: 20_000 });

  const notice = flow(page).getByRole('note').filter({ hasText: NOTICE });
  await expect(notice).toBeVisible({ timeout: 20_000 });
  await expect(notice).toHaveText(NOTICE);
  // L'avertissement ne bloque pas : le candidat reste prêt.
  await expect(flow(page).locator('[data-contact-group="ready"]').locator(`[data-contact-row="${spec.participantId}"]`)).toBeVisible({ timeout: 20_000 });
});

test('messagerie : distance connue et séquence qui invite, aucun avertissement de relation', async ({ browser }) => {
  const ws = await workspace('E2E messagerie distance connue');
  const seq = await sequence(ws, { steps: INVITATION_THEN_MESSAGE });
  const spec: ChatSpec = { name: 'Dora Connue', participantId: `ACoAAMDC${rand()}`, distance: 'SECOND_DEGREE' };

  const page = await openInbox(browser, ws, spec);
  await startEnrollment(page, spec);
  await expect(sheet(page)).toBeVisible({ timeout: 20_000 });
  await chooseMission(page, ws);
  await expect(page.locator('[data-sequence-picker]')).toContainText(seq.name, { timeout: 20_000 });
  await expect(flow(page).locator('[data-contact-group="ready"]').locator(`[data-contact-row="${spec.participantId}"]`)).toBeVisible({ timeout: 20_000 });
  await expect(flow(page).getByText(NOTICE)).toHaveCount(0);
});

test('messagerie : conversation sans identifiant de profil, la feuille le dit et ne propose que « Fermer »', async ({ browser }) => {
  const ws = await workspace('E2E messagerie sans identifiant');
  const seq = await sequence(ws);
  const spec: ChatSpec = { name: 'Ivan Sansid', participantId: null };

  const page = await openInbox(browser, ws, spec);
  await startEnrollment(page, spec);

  const dialog = sheet(page);
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await expect(dialog).toContainText("Cette conversation ne permet pas d'identifier le profil LinkedIn du candidat : il ne peut pas être inscrit dans une séquence.");
  // Plus d'impasse silencieuse : ni flux, ni choix de mission, ni bouton d'inscription.
  await expect(flow(page)).toHaveCount(0);
  await expect(missionSelect(page)).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: /^Inscrire/ })).toHaveCount(0);
  const close = dialog.getByRole('button', { name: 'Fermer', exact: true });
  await expect(close).toBeVisible();
  await close.click();
  await expect(sheet(page)).toHaveCount(0);
  expect(await enrollmentsOf(seq.id)).toEqual([]);
});

test('messagerie : interrupteur éteint, le dialogue « Choisir une séquence » d\'avant s\'ouvre', async ({ browser }) => {
  const ws = await workspace('E2E messagerie ancien dialogue');
  const seq = await sequence(ws);
  const spec: ChatSpec = { name: 'Lise Ancienne', participantId: `ACoAAMLE${rand()}`, distance: 'SECOND_DEGREE' };

  const page = await openInbox(browser, ws, spec, { legacy: true });
  await startEnrollment(page, spec);

  const dialog = page.getByRole('dialog', { name: 'Choisir une séquence' });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await expect(dialog.getByRole('button', { name: new RegExp(seq.name) })).toBeVisible({ timeout: 20_000 });
  await expect(dialog.locator('#inbox-enroll-mission')).toBeVisible();
  // Ni la feuille du lot, ni le flux du panneau Contacter.
  await expect(sheet(page)).toHaveCount(0);
  await expect(flow(page)).toHaveCount(0);
  expect(await enrollmentsOf(seq.id)).toEqual([]);
});
