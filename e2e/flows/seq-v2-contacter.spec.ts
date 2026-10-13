/**
 * Refonte mission, lot 5f-2c : panneau « Contacter » ouvert depuis la sélection du
 * Pipeline (interrupteur des séquences allumé).
 *
 *  - séquence choisie d'avance : la plus récente de la mission ; les candidats sont
 *    rangés prêts, à compléter ou exclus, chaque raison en toutes lettres ;
 *  - « Inscrire N candidats » : une inscription par candidat prêt, rien pour un
 *    exclu, Retenu à l'inscription, panneau sur « Contactés », toast avec
 *    « Ouvrir la séquence » ;
 *  - dérogation « Inscrire quand même » du propriétaire pour un contact de moins
 *    de 90 jours ;
 *  - case des destinataires dès 5 candidats ;
 *  - séquence à message rédigé par l'IA : « Relire les messages », jamais
 *    d'inscription directe ;
 *  - jauge du plafond ; mission sans séquence ; formule gratuite ;
 *  - interrupteur éteint : l'ancien menu « Séquence », inchangé ;
 *  - avec le moteur : un envoi par candidat inscrit, aucun pour un exclu.
 *
 * Harnais : stack locale (vraie base, vraies gardes, vraies fonctions serveur pour
 * l'aperçu : E2E_EDGE_FUNCTIONS=1). L'appel du navigateur à la fonction des comptes
 * LinkedIn est simulé (liste des comptes).
 */
import type { Browser, BrowserContext, Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures';
import { pinLegacySequences } from '../helpers/env';
import { engineAvailable, ENGINE_SKIP_REASON, minutesFromNow, runCycle, sentTexts } from '../helpers/sequence-engine';
import {
  admin,
  createOrg,
  deleteOrg,
  seedCandidateRow,
  seedEnrollment,
  seedLinkedInAccount,
  seedMission,
  setOrgPlan,
  storageStateForUser,
  type TestOrg,
} from '../helpers/supabase-admin';

test.describe.configure({ timeout: 180_000 });

const EDGE = process.env.E2E_EDGE_FUNCTIONS === '1';
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

interface Workspace {
  org: TestOrg;
  accountId: string;
  missionId: string;
}

async function workspace(label: string, plan = 'cabinet'): Promise<Workspace> {
  const org = await createOrg('agency', label);
  orgsToDelete.push(org);
  await setOrgPlan(org.orgId, plan);
  const accountId = await seedLinkedInAccount(org.orgId, org.owner.userId, `acc_ctr_${rand()}`, 'OK');
  // Compte mature : plafonds pleins (un compte neuf démarre à 25 %).
  await admin().from('member_linkedin_accounts').update({ linked_at: '2026-01-01T00:00:00Z' }).eq('linkedin_account_id', accountId);
  const missionId = await seedMission(org.orgId, org.owner.userId, { name: `Mission contacter ${rand()}` });
  return { org, accountId, missionId };
}

interface SeqOptions {
  name?: string;
  projectId?: string | null;
  createdAt?: string;
  steps?: Array<Record<string, unknown>>;
}

/** Séquence active avec ses étapes, créée comme le fait l'éditeur (étapes en snake_case, un jour de délai). */
async function sequence(ws: Workspace, options: SeqOptions = {}): Promise<{ id: string; name: string; stepIds: string[] }> {
  const name = options.name ?? `Approche ${rand()}`;
  const { data: seq, error } = await admin()
    .from('outreach_sequences')
    .insert({
      name,
      organization_id: ws.org.orgId,
      created_by: ws.org.owner.userId,
      project_id: options.projectId === undefined ? ws.missionId : options.projectId,
      is_active: true,
      ...(options.createdAt ? { created_at: options.createdAt } : {}),
    })
    .select('id')
    .single();
  if (error || !seq) throw new Error(`sequence: ${error?.message}`);
  const steps = options.steps ?? [{ action_type: 'message', message_template: 'Bonjour {{firstName}}, une mission pour vous.' }];
  const stepIds: string[] = [];
  for (const [index, step] of steps.entries()) {
    const { data, error: stepErr } = await admin()
      .from('sequence_steps')
      .insert({
        sequence_id: seq.id,
        organization_id: ws.org.orgId,
        step_order: index,
        condition_type: 'always',
        delay_days: index === 0 ? 0 : 1,
        ...step,
      })
      .select('id')
      .single();
    if (stepErr || !data) throw new Error(`sequence(étape ${index}): ${stepErr?.message}`);
    stepIds.push(data.id as string);
  }
  return { id: seq.id as string, name, stepIds };
}

interface Cand {
  key: string;
  name: string;
  rowId: string;
}

/** Candidat Retenu de la mission, avec un lien LinkedIn sauf demande contraire. */
async function candidate(
  ws: Workspace,
  key: string,
  name: string,
  opts: { linkedin?: boolean; stage?: 'to_sort' | 'retained' | 'contacted'; extra?: Record<string, unknown> } = {},
): Promise<Cand> {
  const row = await seedCandidateRow({
    orgId: ws.org.orgId,
    createdBy: ws.org.owner.userId,
    missionId: ws.missionId,
    candidateId: key,
    stage: opts.stage ?? 'retained',
    extra: {
      candidate_name: name,
      candidate_headline: `Poste de ${name}`,
      ...(opts.linkedin === false ? {} : { linkedin_profile_url: `https://www.linkedin.com/in/${key.toLowerCase()}` }),
      ...(opts.extra ?? {}),
    },
  });
  return { key, name, rowId: row.id };
}

async function openContext(browser: Browser, ws: Workspace, opts: { legacy?: boolean } = {}): Promise<BrowserContext> {
  const context = await browser.newContext({
    storageState: await storageStateForUser(ws.org.owner, 'v3'),
    timezoneId: 'Europe/Paris',
  });
  contexts.push(context);
  if (opts.legacy) await pinLegacySequences(context);
  await context.addInitScript(() => {
    try {
      localStorage.setItem('konekt:tuto:seen:pipeline', '1');
    } catch {
      // stockage indisponible : le tutoriel s'affichera, sans effet sur le test
    }
  });
  await context.route('**/functions/v1/unipile-accounts', async (route: Route) => {
    let body: { action?: string } | null = null;
    try {
      body = route.request().postDataJSON() as typeof body;
    } catch {
      body = null;
    }
    if (body?.action === 'list') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, accounts: [{ id: ws.accountId, account_status: 'OK', provider: 'LINKEDIN', name: 'E2E LinkedIn' }] }),
      });
    }
    return route.continue();
  });
  return context;
}

async function openPipeline(browser: Browser, ws: Workspace, opts: { legacy?: boolean } = {}): Promise<Page> {
  const context = await openContext(browser, ws, opts);
  const page = await context.newPage();
  await page.goto(`/missions/${ws.missionId}?nouvelle-mission=1`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('mission-v3')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('candidate-list')).toBeVisible({ timeout: 30_000 });
  return page;
}

const check = (page: Page, name: string) => page.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true });
const bar = (page: Page) => page.getByRole('toolbar', { name: 'Actions sur la sélection' });
const panel = (page: Page) => page.getByTestId('mission-panel');
const flow = (page: Page) => page.locator('[data-contact-flow]');
const group = (page: Page, key: 'ready' | 'incomplete' | 'excluded') => page.locator(`[data-contact-group="${key}"]`);
/** Sous-section d'une raison d'exclusion : le libellé de la raison est son sous-titre, les lignes sont dessous. */
const reason = (page: Page, key: string) => group(page, 'excluded').locator(`[data-contact-reason="${key}"]`);
const toast = (page: Page, text: string | RegExp) => page.locator('[data-sonner-toast]').filter({ hasText: text });

async function selectAndContact(page: Page, names: string[], opts: { gate?: boolean } = {}): Promise<void> {
  for (const name of names) await check(page, name).click();
  await expect(bar(page)).toBeVisible();
  await bar(page).getByRole('button', { name: 'Contacter', exact: true }).click();
  await expect(panel(page)).toHaveAttribute('data-panel', 'contact');
  await expect(page).toHaveURL(/contacter=1/);
  // Une porte (formule gratuite) remplace le panneau complet : seul le mode Contacter est posé dans l'adresse.
  if (!opts.gate) await expect(flow(page)).toBeVisible({ timeout: 20_000 });
}

async function enrollmentsOf(sequenceId: string) {
  const { data, error } = await admin()
    .from('sequence_enrollments')
    .select('profile_id, status, account_id')
    .eq('sequence_id', sequenceId);
  if (error) throw new Error(`enrollmentsOf: ${error.message}`);
  return (data ?? []) as Array<{ profile_id: string; status: string; account_id: string }>;
}

async function stageOf(ws: Workspace, key: string) {
  const { data, error } = await admin()
    .from('job_candidate_status')
    .select('general_stage, decision_source')
    .eq('organization_id', ws.org.orgId)
    .eq('candidate_id', key);
  if (error) throw new Error(`stageOf: ${error.message}`);
  return data ?? [];
}

test('Contacter : séquence choisie d\'avance, groupes avec leur raison, inscription, Retenu, toast et panneau sur Contactés', async ({ browser }) => {
  test.skip(!EDGE, 'draft-sequence (aperçu) absente : E2E_EDGE_FUNCTIONS=1');
  const ws = await workspace('E2E contacter');
  // Deux séquences de la mission : la plus récente doit être choisie d'avance.
  await sequence(ws, { name: `Ancienne ${rand()}`, createdAt: '2026-09-01T10:00:00Z' });
  const recent = await sequence(ws, { name: `Récente ${rand()}`, createdAt: '2026-10-01T10:00:00Z' });

  const rita = await candidate(ws, 'cand_rita', 'Rita Retenue');
  const sam = await candidate(ws, 'cand_sam', 'Sam Sans-Lien', { linkedin: false });
  const lea = await candidate(ws, 'cand_lea', 'Léa Déjà-Dedans');
  const paul = await candidate(ws, 'cand_paul', 'Paul Déjà-Contacté');
  // Léa est déjà dans la séquence choisie ; Paul a été contacté par un collègue dans une autre séquence.
  await seedEnrollment(ws.org.orgId, recent.id, ws.org.owner.userId, {
    profile_id: lea.key, profile_name: lea.name, account_id: ws.accountId, job_id: `project:${ws.missionId}`, status: 'active',
  });
  const other = await sequence(ws, { name: `Autre mission ${rand()}`, projectId: null, createdAt: '2026-08-01T10:00:00Z' });
  await seedEnrollment(ws.org.orgId, other.id, ws.org.owner.userId, {
    profile_id: paul.key, profile_name: paul.name, account_id: ws.accountId, job_id: `project:${ws.missionId}`, status: 'completed',
    completed_at: new Date().toISOString(),
  });

  const page = await openPipeline(browser, ws);
  await selectAndContact(page, [rita.name, sam.name, lea.name, paul.name]);

  // La plus récente de la mission est choisie d'avance.
  await expect(page.locator('[data-sequence-picker]')).toContainText(recent.name);

  // Une seule candidate prête ; les autres sont rangés avec leur raison exacte.
  await expect(flow(page)).toContainText('1 prêt');
  await expect(group(page, 'ready').locator(`[data-contact-row="${rita.key}"]`)).toBeVisible({ timeout: 20_000 });
  await expect(group(page, 'incomplete').locator(`[data-contact-row="${sam.key}"]`)).toContainText('Sans profil LinkedIn');
  await expect(reason(page, 'in_sequence')).toContainText('Déjà dans cette séquence');
  await expect(reason(page, 'in_sequence').locator(`[data-contact-row="${lea.key}"]`)).toBeVisible();
  await expect(reason(page, 'recent_contact').locator(`[data-contact-row="${paul.key}"]`)).toContainText('Déjà contacté');

  // Aperçu du premier message (valeurs du serveur) et pied.
  await expect(flow(page).getByText('Bonjour', { exact: false }).first()).toBeVisible({ timeout: 30_000 });
  const enroll = flow(page).getByRole('button', { name: /^Inscrire 1 candidat$/ });
  await expect(enroll).toBeEnabled({ timeout: 20_000 });
  await enroll.click();

  // Une seule inscription, celle de Rita ; rien pour les exclus ni pour le candidat sans lien.
  await expect.poll(async () => (await enrollmentsOf(recent.id)).map((e) => e.profile_id).sort(), { timeout: 30_000 })
    .toEqual([lea.key, rita.key].sort());
  expect((await enrollmentsOf(recent.id)).find((e) => e.profile_id === rita.key)?.account_id).toBe(ws.accountId);
  expect(await enrollmentsOf(other.id)).toHaveLength(1);

  // Retenu à l'inscription (déjà retenue : l'étape reste), jamais « Contacté » avant l'envoi.
  await expect.poll(async () => (await stageOf(ws, rita.key)).map((r) => r.general_stage), { timeout: 20_000 }).toEqual(['retained']);

  // Toast nommé, avec « Ouvrir la séquence » et sans « Annuler ».
  const done = toast(page, /1 candidat inscrit dans la séquence/);
  await expect(done).toBeVisible({ timeout: 20_000 });
  await expect(done).toContainText(recent.name);
  await expect(done.getByRole('button', { name: 'Ouvrir la séquence' })).toBeVisible();
  await expect(done.getByRole('button', { name: 'Annuler' })).toHaveCount(0);

  // Le panneau passe sur « Contactés » et Rita y est ; Sam, Léa et Paul restent sélectionnés.
  await expect(panel(page)).toHaveAttribute('data-panel', 'contact');
  await expect(flow(page)).toHaveCount(0);
  await expect(page).toHaveURL(/outreach=contactes/);
  await expect(page).not.toHaveURL(/contacter=1/);
  await expect(page.locator('[data-contacted-row]').filter({ hasText: rita.name })).toBeVisible({ timeout: 20_000 });

  await done.getByRole('button', { name: 'Ouvrir la séquence' }).click();
  await expect(page).toHaveURL(new RegExp(`/sequences/${recent.id}`));
});

test('Contacter : dérogation « Inscrire quand même » du propriétaire pour un contact récent', async ({ browser }) => {
  test.skip(!EDGE, 'draft-sequence (aperçu) absente : E2E_EDGE_FUNCTIONS=1');
  const ws = await workspace('E2E contacter dérogation');
  const seq = await sequence(ws);
  const nora = await candidate(ws, 'cand_nora', 'Nora Nouvelle');
  const marc = await candidate(ws, 'cand_marc', 'Marc Récent');
  const other = await sequence(ws, { name: `Ailleurs ${rand()}`, projectId: null });
  await seedEnrollment(ws.org.orgId, other.id, ws.org.owner.userId, {
    profile_id: marc.key, profile_name: marc.name, account_id: ws.accountId, job_id: `project:${ws.missionId}`, status: 'active',
  });

  const page = await openPipeline(browser, ws);
  await selectAndContact(page, [nora.name, marc.name]);

  await expect(reason(page, 'recent_contact').locator(`[data-contact-row="${marc.key}"]`)).toContainText('Déjà contacté', { timeout: 20_000 });
  await expect(flow(page).getByRole('button', { name: /^Inscrire 1 candidat$/ })).toBeEnabled({ timeout: 20_000 });

  // Le propriétaire déroge : Marc passe dans les prêts, le bouton compte deux candidats.
  await flow(page).getByRole('button', { name: /^Inscrire quand même/ }).click();
  await expect(group(page, 'ready').locator(`[data-contact-row="${marc.key}"]`)).toBeVisible();
  await expect(group(page, 'ready').locator(`[data-contact-row="${marc.key}"]`)).toContainText('Inscrit quand même');
  await flow(page).getByRole('button', { name: /^Inscrire 2 candidats$/ }).click();

  await expect.poll(async () => (await enrollmentsOf(seq.id)).map((e) => e.profile_id).sort(), { timeout: 30_000 })
    .toEqual([marc.key, nora.key].sort());
});

test('Contacter : profil effacé exclu sans dérogation (connu avant le clic par l\'aperçu)', async ({ browser }) => {
  test.skip(!EDGE, 'draft-sequence (aperçu) absente : E2E_EDGE_FUNCTIONS=1');
  const ws = await workspace('E2E contacter effacé');
  const seq = await sequence(ws);
  const ana = await candidate(ws, 'cand_ana', 'Ana Active');
  const eli = await candidate(ws, 'cand_eli', 'Eli Effacé');
  const other = await sequence(ws, { name: `Effacement ${rand()}`, projectId: null });
  await seedEnrollment(ws.org.orgId, other.id, ws.org.owner.userId, {
    profile_id: eli.key, profile_name: eli.name, account_id: ws.accountId, job_id: `project:${ws.missionId}`, status: 'completed',
    completed_at: new Date().toISOString(), tracking_data: { gdpr_erased_at: '2026-09-21T10:00:00.000Z' },
  });

  const page = await openPipeline(browser, ws);
  await selectAndContact(page, [ana.name, eli.name]);

  // Le balayage des aperçus apprend l'effacement : la raison devient celle de l'effacement, sans dérogation.
  const erased = reason(page, 'erased');
  await expect(erased).toContainText("A demandé l'effacement de ses données", { timeout: 40_000 });
  await expect(erased.locator(`[data-contact-row="${eli.key}"]`)).toBeVisible();
  await expect(erased.getByRole('button', { name: /quand même/ })).toHaveCount(0);
  await expect(flow(page).getByRole('button', { name: /^Inscrire 1 candidat$/ })).toBeEnabled();
  await flow(page).getByRole('button', { name: /^Inscrire 1 candidat$/ }).click();
  await expect.poll(async () => (await enrollmentsOf(seq.id)).map((e) => e.profile_id), { timeout: 30_000 }).toEqual([ana.key]);
});

test('Contacter : case des destinataires dès 5 candidats, absente à 4', async ({ browser }) => {
  test.skip(!EDGE, 'draft-sequence (aperçu) absente : E2E_EDGE_FUNCTIONS=1');
  const ws = await workspace('E2E contacter seuil');
  const seq = await sequence(ws);
  const names = ['Alix', 'Basile', 'Clara', 'Denis', 'Elsa'].map((first) => `${first} Cinq`);
  for (const [i, name] of names.entries()) await candidate(ws, `cand_five_${i}`, name);

  const page = await openPipeline(browser, ws);
  await selectAndContact(page, names.slice(0, 4));
  const four = flow(page).getByRole('button', { name: /^Inscrire 4 candidats$/ });
  await expect(four).toBeEnabled({ timeout: 20_000 });
  await expect(flow(page).getByRole('checkbox', { name: /destinataires/ })).toHaveCount(0);

  // Un cinquième candidat coché à côté (grand écran : la liste reste active) : la case devient obligatoire.
  await check(page, names[4]).click();
  const five = flow(page).getByRole('button', { name: /^Inscrire 5 candidats$/ });
  await expect(five).toBeDisabled({ timeout: 20_000 });
  await flow(page).getByRole('checkbox', { name: /destinataires/ }).check();
  await expect(five).toBeEnabled();
  await five.click();
  await expect.poll(async () => (await enrollmentsOf(seq.id)).length, { timeout: 30_000 }).toBe(5);
});

test('Contacter : séquence à message rédigé par l\'IA, « Relire les messages » et jamais d\'inscription directe', async ({ browser }) => {
  test.skip(!EDGE, 'draft-sequence (aperçu) absente : E2E_EDGE_FUNCTIONS=1');
  const ws = await workspace('E2E contacter IA');
  const seq = await sequence(ws, { steps: [{ action_type: 'message', message_template: '', use_ai_personalization: true }] });
  const iris = await candidate(ws, 'cand_iris', 'Iris Rédigée');

  const page = await openPipeline(browser, ws);
  await selectAndContact(page, [iris.name]);

  await expect(group(page, 'incomplete').locator(`[data-contact-row="${iris.key}"]`)).toContainText("Message rédigé par l'IA", { timeout: 20_000 });
  await expect(flow(page).getByRole('button', { name: /^Inscrire/ })).toHaveCount(0);
  await flow(page).getByRole('button', { name: /^Relire les messages \(1\)$/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 20_000 });
  expect(await enrollmentsOf(seq.id)).toHaveLength(0);
});

test('Contacter : jauge du plafond d\'invitations, sans « 0 / N »', async ({ browser }) => {
  test.skip(!EDGE, 'draft-sequence (aperçu) absente : E2E_EDGE_FUNCTIONS=1');
  const ws = await workspace('E2E contacter jauge');
  await sequence(ws, { steps: [{ action_type: 'connection_request', message_template: 'Bonjour {{firstName}}' }] });
  const pia = await candidate(ws, 'cand_pia', 'Pia Plafond');
  // 30 invitations déjà parties sur la semaine : il en reste 70 sur 100 (compte mature).
  const now = new Date().toISOString();
  const { error } = await admin().from('linkedin_action_log').insert(
    Array.from({ length: 30 }, () => ({ account_id: ws.accountId, action_type: 'connection_request', organization_id: ws.org.orgId, source: 'e2e', created_at: now })),
  );
  expect(error).toBeNull();

  const page = await openPipeline(browser, ws);
  await selectAndContact(page, [pia.name]);
  const gauge = page.locator('[data-quota-gauge="invitations"]');
  await expect(gauge).toContainText('70 invitations possibles cette semaine', { timeout: 30_000 });
  await expect(gauge).not.toContainText(/\d+\s*\/\s*\d+/);
});

test('Contacter : mission sans séquence, la porte « Rédiger » s\'ouvre dans un nouvel onglet', async ({ browser }) => {
  const ws = await workspace('E2E contacter sans séquence');
  const tom = await candidate(ws, 'cand_tom', 'Tom Sansséquence');
  const page = await openPipeline(browser, ws);
  await selectAndContact(page, [tom.name]);

  await expect(page.locator('[data-sequence-picker="empty"]')).toContainText("Cette mission n'a pas de séquence prête à l'emploi.");
  await expect(flow(page).getByRole('button', { name: /^Inscrire/ })).toHaveCount(0);
  const door = flow(page).getByRole('link', { name: /Rédiger une séquence pour cette mission/ });
  await expect(door).toHaveAttribute('target', '_blank');
  await expect(door).toHaveAttribute('href', new RegExp(`/sequences/nouvelle\\?mission=${ws.missionId}&depart=ia`));
});

test('Contacter : formule gratuite, invitation à passer à un plan payant', async ({ browser }) => {
  const ws = await workspace('E2E contacter gratuit', 'free');
  await sequence(ws);
  const gus = await candidate(ws, 'cand_gus', 'Gus Gratuit');
  const page = await openPipeline(browser, ws);
  await selectAndContact(page, [gus.name], { gate: true });
  await expect(panel(page).getByRole('button', { name: 'Voir les plans' })).toBeVisible({ timeout: 20_000 });
  await expect(panel(page).getByRole('button', { name: 'Voir les contactés' })).toBeVisible();
});

test('Contacter : « Voir les contactés » quitte le mode sans rien inscrire, et recharger sans sélection ouvre Contactés', async ({ browser }) => {
  const ws = await workspace('E2E contacter retour');
  const seq = await sequence(ws);
  const zoe = await candidate(ws, 'cand_zoe', 'Zoé Retour');
  const page = await openPipeline(browser, ws);
  await selectAndContact(page, [zoe.name]);
  await flow(page).getByRole('button', { name: 'Voir les contactés' }).first().click();
  await expect(flow(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/contacter=1/);
  expect(await enrollmentsOf(seq.id)).toHaveLength(0);

  // La sélection n'est qu'en mémoire : une adresse ?contacter=1 rechargée ouvre « Contactés ».
  await page.goto(`/missions/${ws.missionId}?nouvelle-mission=1&panneau=contact&contacter=1`, { waitUntil: 'domcontentloaded' });
  await expect(panel(page)).toHaveAttribute('data-panel', 'contact', { timeout: 30_000 });
  await expect(flow(page)).toHaveCount(0);
  await expect(page).toHaveURL(/outreach=(contactes|sequences)/);
  await expect(page).not.toHaveURL(/contacter=1/);
});

test('Contacter : interrupteur éteint, l\'ancien menu « Séquence » est inchangé', async ({ browser }) => {
  const ws = await workspace('E2E contacter ancien menu');
  const seq = await sequence(ws);
  const lia = await candidate(ws, 'cand_lia', 'Lia Ancienne');
  const page = await openPipeline(browser, ws, { legacy: true });
  await check(page, lia.name).click();
  await bar(page).getByRole('button', { name: 'Contacter', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: new RegExp(seq.name) })).toBeVisible({ timeout: 20_000 });
  await expect(flow(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/contacter=1/);
});

test('Contacter avec le moteur : un envoi par candidat inscrit, aucun pour un exclu', async ({ browser }) => {
  test.skip(!engineAvailable, ENGINE_SKIP_REASON);
  const ws = await workspace('E2E contacter moteur');
  const seq = await sequence(ws, { steps: [{ action_type: 'message', message_template: 'Bonjour {{firstName}}, message du moteur.' }] });
  const eva = await candidate(ws, 'cand_eva_m', 'Eva Moteur');
  const ugo = await candidate(ws, 'cand_ugo_m', 'Ugo Moteur');
  const dan = await candidate(ws, 'cand_dan_m', 'Dan Déjà');
  await seedEnrollment(ws.org.orgId, seq.id, ws.org.owner.userId, {
    profile_id: dan.key, profile_name: dan.name, account_id: ws.accountId, job_id: `project:${ws.missionId}`, status: 'active',
  });

  const page = await openPipeline(browser, ws);
  await selectAndContact(page, [eva.name, ugo.name, dan.name]);
  await flow(page).getByRole('button', { name: /^Inscrire 2 candidats$/ }).click();
  await expect.poll(async () => (await enrollmentsOf(seq.id)).map((e) => e.profile_id).sort(), { timeout: 30_000 })
    .toEqual([dan.key, eva.key, ugo.key].sort());

  // Premières exécutions dues, puis un cycle du moteur : un message par candidat inscrit.
  const { error } = await admin()
    .from('sequence_step_executions')
    .update({ scheduled_at: minutesFromNow(-1) })
    .eq('status', 'scheduled')
    .in('enrollment_id', (await admin().from('sequence_enrollments').select('id').eq('sequence_id', seq.id).in('profile_id', [eva.key, ugo.key])).data?.map((e) => e.id as string) ?? []);
  expect(error).toBeNull();
  await runCycle();
  await expect.poll(async () => (await sentTexts(ws.accountId)).length, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
  const texts = await sentTexts(ws.accountId);
  expect(texts.filter((text) => text.includes('message du moteur'))).toHaveLength(2);

  // « Contacté » posé par le serveur à l'envoi réel ; Dan, exclu, n'a rien reçu.
  await expect.poll(async () => (await stageOf(ws, eva.key)).map((r) => r.general_stage), { timeout: 30_000 }).toEqual(['contacted']);
  expect((await stageOf(ws, dan.key)).map((r) => r.general_stage)).toEqual(['retained']);
});
