/**
 * Refonte mission, lot 5f-2d : les entrées de ContactFlow qui partent de la page d'une
 * séquence et de la carte « Maintenant » (interrupteur des séquences allumé, défaut).
 *
 *  1. Page séquence vers Pipeline : « Inscrire des candidats » mène à
 *     /missions/<mission>?sequence=<id> (sans panneau), le Pipeline annonce la séquence
 *     demandée, le panneau Contacter la choisit d'avance (la plus ancienne, pas la plus
 *     récente), l'inscription y va, et le paramètre `sequence` quitte l'adresse ;
 *  2. état vide de l'onglet Candidats : le lien a la même cible que celui de l'en-tête ;
 *  3. séquence demandée en pause : aucune séquence choisie, phrase explicite, pas
 *     d'« Inscrire », l'autre séquence reste choisissable (et inscrit) ;
 *  4. séquence sans mission : le lien mène à /sourcing ;
 *  5. « Contacter les N » de la carte « Maintenant » : le panneau Contacter s'ouvre sur les
 *     retenus cochés, le focus ne va pas à la barre, l'inscription de la sélection est réelle.
 *
 * Harnais : stack locale (vraie base, vraies gardes, vraies fonctions serveur pour l'aperçu :
 * E2E_EDGE_FUNCTIONS=1). Seule la liste des comptes LinkedIn du prestataire est simulée dans le
 * navigateur. Modèle : seq-v2-contacter.spec.ts (les fonctions utiles y sont copiées, aucun
 * helper partagé n'est modifié).
 */
import type { Browser, BrowserContext, Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures';
import {
  admin,
  createOrg,
  deleteOrg,
  seedCandidateRow,
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
}

async function workspace(label: string, plan = 'cabinet'): Promise<Workspace> {
  const org = await createOrg('agency', label);
  orgsToDelete.push(org);
  await setOrgPlan(org.orgId, plan);
  const accountId = await seedLinkedInAccount(org.orgId, org.owner.userId, `acc_ent_${rand()}`, 'OK');
  // Compte mature : plafonds pleins (un compte neuf démarre à 25 %).
  await admin().from('member_linkedin_accounts').update({ linked_at: '2026-01-01T00:00:00Z' }).eq('linkedin_account_id', accountId);
  const missionId = await seedMission(org.orgId, org.owner.userId, { name: `Mission entrées ${rand()}` });
  return { org, accountId, missionId };
}

interface SeqOptions {
  name?: string;
  projectId?: string | null;
  createdAt?: string;
  active?: boolean;
}

/** Séquence avec une étape message, créée comme le fait l'éditeur (étapes en snake_case). */
async function sequence(ws: Workspace, options: SeqOptions = {}): Promise<{ id: string; name: string }> {
  const name = options.name ?? `Approche ${rand()}`;
  const { data: seq, error } = await admin()
    .from('outreach_sequences')
    .insert({
      name,
      organization_id: ws.org.orgId,
      created_by: ws.org.owner.userId,
      project_id: options.projectId === undefined ? ws.missionId : options.projectId,
      is_active: options.active ?? true,
      ...(options.createdAt ? { created_at: options.createdAt } : {}),
    })
    .select('id')
    .single();
  if (error || !seq) throw new Error(`sequence: ${error?.message}`);
  const { error: stepErr } = await admin().from('sequence_steps').insert({
    sequence_id: seq.id,
    organization_id: ws.org.orgId,
    step_order: 0,
    condition_type: 'always',
    delay_days: 0,
    action_type: 'message',
    message_template: 'Bonjour {{firstName}}, une mission pour vous.',
  });
  if (stepErr) throw new Error(`sequence(étape): ${stepErr.message}`);
  return { id: seq.id as string, name };
}

interface Cand {
  key: string;
  name: string;
  rowId: string;
}

/** Candidat de la mission avec un lien LinkedIn (Retenu par défaut). */
async function candidate(
  ws: Workspace,
  key: string,
  name: string,
  stage: 'to_sort' | 'retained' | 'contacted' = 'retained',
): Promise<Cand> {
  const row = await seedCandidateRow({
    orgId: ws.org.orgId,
    createdBy: ws.org.owner.userId,
    missionId: ws.missionId,
    candidateId: key,
    stage,
    extra: {
      candidate_name: name,
      candidate_headline: `Poste de ${name}`,
      linkedin_profile_url: `https://www.linkedin.com/in/${key.toLowerCase()}`,
    },
  });
  return { key, name, rowId: row.id };
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
    .select('general_stage')
    .eq('organization_id', ws.org.orgId)
    .eq('candidate_id', key);
  if (error) throw new Error(`stageOf: ${error.message}`);
  return (data ?? []).map((row) => row.general_stage as string);
}

// ─── Navigateur ─────────────────────────────────────────────────────────────

async function openContext(browser: Browser, ws: Workspace, viewport?: { width: number; height: number }): Promise<BrowserContext> {
  const context = await browser.newContext({
    storageState: await storageStateForUser(ws.org.owner, 'v3'),
    timezoneId: 'Europe/Paris',
    ...(viewport ? { viewport } : {}),
  });
  contexts.push(context);
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
        body: JSON.stringify({
          success: true,
          accounts: [{ id: ws.accountId, status: 'OK', account_status: 'OK', provider: 'LINKEDIN', name: 'E2E LinkedIn' }],
        }),
      });
    }
    return route.continue();
  });
  return context;
}

/** Page d'une séquence (interrupteur des séquences par défaut, allumé). */
async function openSequencePage(browser: Browser, ws: Workspace, seq: { id: string; name: string }, rest: string): Promise<Page> {
  const context = await openContext(browser, ws);
  const page = await context.newPage();
  await page.goto(`/sequences/${seq.id}${rest}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: seq.name })).toBeVisible({ timeout: 30_000 });
  return page;
}

/** Pipeline de la mission, ouvert directement sur une adresse (avec ou sans `?sequence=`). */
async function openPipelineAt(browser: Browser, ws: Workspace, rest: string): Promise<Page> {
  const context = await openContext(browser, ws);
  const page = await context.newPage();
  await page.goto(`/missions/${ws.missionId}${rest}`, { waitUntil: 'domcontentloaded' });
  await waitPipeline(page);
  return page;
}

async function waitPipeline(page: Page): Promise<void> {
  await expect(page.getByTestId('mission-v3')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('candidate-list')).toBeVisible({ timeout: 30_000 });
}

const check = (page: Page, name: string) => page.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true });
const bar = (page: Page) => page.getByRole('toolbar', { name: 'Actions sur la sélection' });
const panel = (page: Page) => page.getByTestId('mission-panel');
const flow = (page: Page) => page.locator('[data-contact-flow]');
const picker = (page: Page) => page.locator('[data-sequence-picker]');
const toast = (page: Page, text: string | RegExp) => page.locator('[data-sonner-toast]').filter({ hasText: text });

const SEQUENCE_HINT = 'Cochez les candidats à inscrire, puis « Contacter » : la séquence demandée sera proposée d\'avance.';
const PREFERRED_MISSING = "La séquence demandée n'est pas disponible";

/** Coche des candidats puis « Contacter » dans la barre : le panneau s'ouvre en mode Contacter. */
async function selectAndContact(page: Page, names: string[]): Promise<void> {
  for (const name of names) await check(page, name).click();
  await expect(bar(page)).toBeVisible();
  await bar(page).getByRole('button', { name: 'Contacter', exact: true }).click();
  await expect(panel(page)).toHaveAttribute('data-panel', 'contact');
  await expect(page).toHaveURL(/contacter=1/);
  await expect(flow(page)).toBeVisible({ timeout: 20_000 });
}

const searchOf = (page: Page) => new URL(page.url()).searchParams;

// ─── 1. Page séquence vers Pipeline ─────────────────────────────────────────

test('Page séquence vers Pipeline : la séquence demandée (la plus ancienne) est proposée d\'avance et reçoit l\'inscription, puis le paramètre disparaît', async ({ browser }) => {
  const ws = await workspace('E2E entrées page séquence');
  // Deux séquences actives de la mission : on demande la plus ancienne (la plus récente serait le choix par défaut).
  const old = await sequence(ws, { name: `Ancienne ${rand()}`, createdAt: '2026-09-01T10:00:00Z' });
  const recent = await sequence(ws, { name: `Récente ${rand()}`, createdAt: '2026-10-01T10:00:00Z' });
  const people = await Promise.all(
    ['Alix', 'Basile', 'Clara', 'Denis', 'Elsa'].map((first, i) => candidate(ws, `cand_ent_${i}`, `${first} Retenue`)),
  );

  const page = await openSequencePage(browser, ws, old, `?depuis=mission:${ws.missionId}`);

  // « Inscrire des candidats » de l'en-tête : le Pipeline de la mission, séquence demandée dans l'adresse.
  const enroll = page.getByRole('link', { name: 'Inscrire des candidats' });
  await expect(enroll).toHaveAttribute('href', `/missions/${ws.missionId}?sequence=${old.id}`);
  await enroll.click();

  await expect(page).toHaveURL((url) => url.pathname === `/missions/${ws.missionId}` && url.searchParams.get('sequence') === old.id, { timeout: 30_000 });
  expect(searchOf(page).has('panneau'), 'aucun panneau ouvert par le lien').toBe(false);
  expect(searchOf(page).has('contacter'), 'pas encore en mode Contacter').toBe(false);
  await waitPipeline(page);
  await expect(panel(page)).toHaveCount(0);

  // Le Pipeline annonce la séquence demandée tant que rien n'est coché.
  const hint = page.getByText(SEQUENCE_HINT, { exact: true });
  await expect(hint).toBeVisible({ timeout: 20_000 });

  // Deux cases cochées : la phrase disparaît ; « Contacter » ouvre le panneau avec la séquence demandée.
  await check(page, people[0].name).click();
  await check(page, people[1].name).click();
  await expect(hint).toHaveCount(0);
  await expect(bar(page)).toBeVisible();
  await bar(page).getByRole('button', { name: 'Contacter', exact: true }).click();
  await expect(panel(page)).toHaveAttribute('data-panel', 'contact');
  await expect(page).toHaveURL(/contacter=1/);
  await expect(flow(page)).toBeVisible({ timeout: 20_000 });
  await expect(picker(page)).toContainText(old.name, { timeout: 20_000 });
  await expect(picker(page)).not.toContainText(recent.name);
  await expect(flow(page).getByText(PREFERRED_MISSING)).toHaveCount(0);
  // Le paramètre reste dans l'adresse tant que le mode Contacter est ouvert.
  expect(searchOf(page).get('sequence')).toBe(old.id);

  // « Inscrire 2 candidats » : dans l'ancienne séquence, aucune dans la récente.
  const submit = flow(page).getByRole('button', { name: /^Inscrire 2 candidats$/ });
  await expect(submit).toBeEnabled({ timeout: 30_000 });
  await submit.click();
  await expect.poll(async () => (await enrollmentsOf(old.id)).map((e) => e.profile_id).sort(), { timeout: 30_000 })
    .toEqual([people[0].key, people[1].key].sort());
  expect(await enrollmentsOf(recent.id)).toHaveLength(0);
  await expect.poll(async () => (await enrollmentsOf(old.id)).map((e) => e.account_id), { timeout: 10_000 })
    .toEqual([ws.accountId, ws.accountId]);

  // Fin d'inscription : le panneau passe sur « Contactés », le paramètre de la séquence demandée est retiré.
  await expect(toast(page, /2 candidats inscrits dans la séquence/)).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(/outreach=contactes/, { timeout: 20_000 });
  await expect(page).not.toHaveURL(/[?&]sequence=/);
  await expect(page).not.toHaveURL(/contacter=1/);
  await expect(page.getByText(SEQUENCE_HINT, { exact: true })).toHaveCount(0);
});

// ─── 2. État vide de l'onglet Candidats ─────────────────────────────────────

test('État vide de l\'onglet Candidats : le lien « Inscrire des candidats » a la même cible que celui de l\'en-tête', async ({ browser }) => {
  const ws = await workspace('E2E entrées état vide');
  const seq = await sequence(ws, { name: `Vide ${rand()}` });
  const target = `/missions/${ws.missionId}?sequence=${seq.id}`;

  const page = await openSequencePage(browser, ws, seq, `?onglet=candidats&depuis=mission:${ws.missionId}`);
  await expect(page.getByRole('tab', { name: /Candidats/ })).toHaveAttribute('data-state', 'active');
  const emptyState = page.getByRole('tabpanel').filter({ hasText: 'Aucun candidat inscrit.' });
  await expect(emptyState).toBeVisible({ timeout: 20_000 });
  const emptyLink = emptyState.getByRole('link', { name: 'Inscrire des candidats' });
  await expect(emptyLink).toHaveAttribute('href', target);
  // Même cible que le lien de l'en-tête (deux liens de même nom sur la page).
  const links = page.getByRole('link', { name: 'Inscrire des candidats' });
  await expect(links).toHaveCount(2);
  for (const href of await links.evaluateAll((els) => els.map((el) => el.getAttribute('href')))) expect(href).toBe(target);

  await emptyLink.click();
  await expect(page).toHaveURL((url) => url.pathname === `/missions/${ws.missionId}` && url.searchParams.get('sequence') === seq.id, { timeout: 30_000 });
  await waitPipeline(page);
  await expect(page.getByText(SEQUENCE_HINT, { exact: true })).toBeVisible({ timeout: 20_000 });
});

// ─── 3. Séquence demandée en pause ──────────────────────────────────────────

test('Séquence demandée en pause : aucune séquence choisie, phrase explicite, pas d\'« Inscrire », l\'autre séquence reste choisissable', async ({ browser }) => {
  const ws = await workspace('E2E entrées séquence en pause');
  const paused = await sequence(ws, { name: `En pause ${rand()}`, createdAt: '2026-09-01T10:00:00Z', active: false });
  const other = await sequence(ws, { name: `Autre active ${rand()}`, createdAt: '2026-10-01T10:00:00Z' });
  const lena = await candidate(ws, 'cand_ent_pause', 'Léna Pause');

  const page = await openPipelineAt(browser, ws, `?sequence=${paused.id}`);
  await expect(page.getByText(SEQUENCE_HINT, { exact: true })).toBeVisible({ timeout: 20_000 });
  await selectAndContact(page, [lena.name]);

  // La séquence demandée n'est jamais remplacée en silence par l'autre : rien n'est choisi.
  await expect(picker(page)).toBeVisible({ timeout: 20_000 });
  await expect(picker(page).getByRole('button', { name: /Choisir une séquence/ })).toBeVisible();
  await expect(picker(page)).not.toContainText(other.name);
  await expect(flow(page).getByText(PREFERRED_MISSING)).toBeVisible();
  await expect(flow(page).getByRole('note')).toContainText('en pause, sans étape ou hors de votre vue');
  await expect(flow(page).getByRole('button', { name: /^Inscrire/ })).toHaveCount(0);

  // Le menu ne propose que l'autre séquence ; la choisir lève l'avertissement et permet l'inscription.
  await picker(page).getByRole('button', { name: /Choisir une séquence/ }).click();
  await expect(page.locator(`[data-sequence-id="${paused.id}"]`)).toHaveCount(0);
  await page.locator(`[data-sequence-id="${other.id}"]`).click();
  await expect(picker(page)).toContainText(other.name);
  await expect(flow(page).getByText(PREFERRED_MISSING)).toHaveCount(0);
  const submit = flow(page).getByRole('button', { name: /^Inscrire 1 candidat$/ });
  await expect(submit).toBeEnabled({ timeout: 30_000 });
  await submit.click();
  await expect.poll(async () => (await enrollmentsOf(other.id)).map((e) => e.profile_id), { timeout: 30_000 }).toEqual([lena.key]);
  expect(await enrollmentsOf(paused.id)).toHaveLength(0);
});

// ─── 4. Séquence sans mission ───────────────────────────────────────────────

test('Séquence sans mission : « Inscrire des candidats » mène à /sourcing', async ({ browser }) => {
  const ws = await workspace('E2E entrées sans mission');
  const seq = await sequence(ws, { name: `Hors mission ${rand()}`, projectId: null });

  const page = await openSequencePage(browser, ws, seq, '');
  const link = page.getByRole('link', { name: 'Inscrire des candidats' });
  await expect(link).toHaveAttribute('href', '/sourcing');
  await link.click();
  await expect(page).toHaveURL((url) => url.pathname === '/sourcing', { timeout: 30_000 });
  expect(searchOf(page).has('sequence')).toBe(false);
});

// ─── 5. « Contacter les N » de la carte Maintenant ──────────────────────────

test('Carte « Maintenant » : « Contacter les N » ouvre le panneau Contacter sur les retenus cochés, sans focus sur la barre, et l\'inscription de la sélection est réelle', async ({ browser }) => {
  const ws = await workspace('E2E entrées maintenant');
  const seq = await sequence(ws, { name: `Maintenant ${rand()}` });
  const rita = await candidate(ws, 'cand_now_rita', 'Rita Retenue');
  const remi = await candidate(ws, 'cand_now_remi', 'Remi Retenu');
  const carl = await candidate(ws, 'cand_now_carl', 'Carl Contacte', 'contacted');

  const context = await openContext(browser, ws, { width: 2400, height: 1100 });
  const page = await context.newPage();
  await page.goto(`/missions/${ws.missionId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('mission-v3')).toBeVisible({ timeout: 30_000 });
  const card = page.getByTestId('now-card');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('now-card-loading')).toHaveCount(0, { timeout: 30_000 });

  await expect(card).toContainText('2 candidats retenus attendent un premier message.');
  const button = card.getByRole('button', { name: 'Contacter les 2', exact: true });
  await expect(button).toBeVisible();
  await button.click();

  // Liste filtrée sur Retenu, retenus cochés, panneau en mode Contacter.
  await expect(page).toHaveURL(/[?&]panneau=contact(&|$)/, { timeout: 30_000 });
  await expect(page).toHaveURL(/[?&]contacter=1(&|$)/);
  await expect(page).toHaveURL(/[?&]etape=retained(&|$)/);
  await expect(panel(page)).toHaveAttribute('data-panel', 'contact');
  await expect(flow(page)).toBeVisible({ timeout: 30_000 });
  await expect(panel(page).getByRole('heading', { name: 'Contacter 2 candidats' })).toBeVisible();
  await expect(panel(page)).toContainText(rita.name);
  await expect(panel(page)).toContainText(remi.name);
  await expect(panel(page)).not.toContainText(carl.name);
  await expect(check(page, rita.name)).toBeChecked();
  await expect(check(page, remi.name)).toBeChecked();
  await expect(bar(page)).toContainText('2 candidats sélectionnés');

  // L'ancien geste donnait le focus au « Contacter » de la barre (attente d'au plus 4 s) : il ne doit plus arriver.
  const contactInBar = bar(page).getByRole('button', { name: /^Contacter/ }).first();
  await expect(contactInBar).toBeVisible();
  await expect(contactInBar).not.toBeFocused();
  await expect(picker(page)).toContainText(seq.name, { timeout: 20_000 });

  // L'inscription de la sélection est réelle : les deux retenus, pas le contacté.
  const submit = flow(page).getByRole('button', { name: /^Inscrire 2 candidats$/ });
  await expect(submit).toBeEnabled({ timeout: 30_000 });
  await expect(contactInBar).not.toBeFocused();
  await submit.click();
  await expect.poll(async () => (await enrollmentsOf(seq.id)).map((e) => e.profile_id).sort(), { timeout: 30_000 })
    .toEqual([rita.key, remi.key].sort());
  await expect(toast(page, /2 candidats inscrits dans la séquence/)).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(/outreach=contactes/, { timeout: 20_000 });
  await expect.poll(async () => (await stageOf(ws, rita.key)), { timeout: 20_000 }).toEqual(['retained']);
  expect(await stageOf(ws, carl.key)).toEqual(['contacted']);
});
