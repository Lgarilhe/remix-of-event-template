/**
 * Refonte mission, lot 5f-2a : un candidat inscrit dans une séquence passe en
 * Retenu (origine user), dans la mission de l'inscription, jamais en arrière.
 *
 * Trois candidats choisis dans les résultats du Sourcing de la mission, inscrits
 * par la fenêtre simple (invitation) puis par la préparation avec aperçu
 * (message) :
 *  - Karim, À trier : passe en Retenu ;
 *  - Hugo et Nina, sans ligne dans la mission : la ligne est créée, Retenu ;
 * puis le moteur envoie la première étape de Karim : « Contacté » est posé par
 * le serveur (origine system), après Retenu.
 *
 * Le refus de reculer un candidat déjà contacté ou plus loin est porté par
 * p_from_stages (set_candidate_stages, audits SQL) et par le test unitaire de la
 * règle (tests/c1/lot5f-inscription.test.mjs) : le Sourcing masque ces
 * candidats, ils ne se choisissent pas dans la liste.
 *
 * Harnais : stack locale (e2e/local-stack), vraie base et vraies gardes. Sont
 * simulés dans le navigateur la liste des comptes LinkedIn, la recherche
 * LinkedIn et la génération des filtres.
 */
import type { Browser, BrowserContext, Locator, Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures';
import { pinLegacySequences } from '../helpers/env';
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
import { engineAvailable, ENGINE_SKIP_REASON, minutesFromNow, runCycle, setMockMode } from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
test.describe.configure({ timeout: 180_000 });

const rand = () => Math.random().toString(36).slice(2, 10);

// ─── Nettoyage ──────────────────────────────────────────────────────────────

const contexts: BrowserContext[] = [];
const orgsToDelete: TestOrg[] = [];
test.afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close().catch(() => undefined);
  while (orgsToDelete.length) {
    const org = orgsToDelete.pop()!;
    await admin().from('job_candidate_status').delete().eq('organization_id', org.orgId);
    await admin().from('mission_process_steps').delete().eq('organization_id', org.orgId);
    await deleteOrg(org);
  }
});

// ─── Données ────────────────────────────────────────────────────────────────

interface Workspace {
  org: TestOrg;
  accountId: string;
  missionId: string;
}

async function workspace(label: string): Promise<Workspace> {
  const org = await createOrg('agency', label);
  orgsToDelete.push(org);
  await setOrgPlan(org.orgId);
  const accountId = await seedLinkedInAccount(org.orgId, org.owner.userId, `acc_retenu_${rand()}`, 'OK');
  const missionId = await seedMission(org.orgId, org.owner.userId, { name: `Mission retenu ${rand()}` });
  return { org, accountId, missionId };
}

interface SeededSeq {
  id: string;
  name: string;
}

/** Séquence de la mission, une étape à un jour : message avec modèle (aperçu) ou invitation sans note (fenêtre simple). */
async function missionSequence(ws: Workspace, kind: 'message' | 'invitation'): Promise<SeededSeq> {
  const name = `Retenu ${kind} ${rand()}`;
  const { data: seq, error } = await admin()
    .from('outreach_sequences')
    .insert({ name, organization_id: ws.org.orgId, created_by: ws.org.owner.userId, project_id: ws.missionId, is_active: true })
    .select('id')
    .single();
  if (error || !seq) throw new Error(`missionSequence: ${error?.message}`);
  const { error: stepErr } = await admin().from('sequence_steps').insert({
    sequence_id: seq.id,
    organization_id: ws.org.orgId,
    step_order: 0,
    condition_type: 'always',
    delay_days: 1,
    action_type: kind === 'message' ? 'message' : 'connection_request',
    message_template: kind === 'message' ? 'Bonjour {{firstName}}' : null,
  });
  if (stepErr) throw new Error(`missionSequence(étape): ${stepErr.message}`);
  return { id: seq.id as string, name };
}

interface Candidate {
  id: string;
  name: string;
}

interface Trio {
  karim: Candidate; // À trier
  hugo: Candidate; // sans ligne dans la mission
  nina: Candidate; // sans ligne dans la mission
}

async function trio(ws: Workspace): Promise<Trio> {
  const t: Trio = {
    karim: { id: `ACoAARETK${rand()}`, name: 'Karim Trie' },
    hugo: { id: `ACoAARETH${rand()}`, name: 'Hugo Neuf' },
    nina: { id: `ACoAARETN${rand()}`, name: 'Nina Neuve' },
  };
  const base = { orgId: ws.org.orgId, createdBy: ws.org.owner.userId, missionId: ws.missionId };
  await seedCandidateRow({ ...base, candidateId: t.karim.id, stage: 'to_sort', extra: { candidate_name: t.karim.name } });
  return t;
}

async function rowsOf(ws: Workspace, ids: string[]) {
  const { data, error } = await admin()
    .from('job_candidate_status')
    .select('candidate_id, general_stage, decision_source, job_id')
    .eq('organization_id', ws.org.orgId)
    .in('candidate_id', ids);
  if (error) throw new Error(`rowsOf: ${error.message}`);
  return (data ?? []) as Array<{ candidate_id: string; general_stage: string; decision_source: string | null; job_id: string }>;
}

async function enrollmentOf(sequenceId: string, candidateId: string) {
  const { data, error } = await admin().from('sequence_enrollments').select('id, status').eq('sequence_id', sequenceId).eq('profile_id', candidateId);
  if (error) throw new Error(`enrollmentOf: ${error.message}`);
  return (data ?? []) as Array<{ id: string; status: string }>;
}

// ─── Navigateur ─────────────────────────────────────────────────────────────

function actionOf(route: Route): string | null {
  try {
    return ((route.request().postDataJSON() as { action?: string } | null)?.action) ?? null;
  } catch {
    return null;
  }
}

function asResult(c: Candidate) {
  const [first, ...rest] = c.name.split(' ');
  return {
    first_name: first,
    last_name: rest.join(' '),
    headline: 'Ingénieur backend',
    location: 'Paris, France',
    network_distance: 'SECOND_DEGREE',
    ...c,
  };
}

async function openSearchResults(browser: Browser, ws: Workspace, candidates: Candidate[]): Promise<Page> {
  const context = await browser.newContext({ storageState: await storageStateForUser(ws.org.owner), timezoneId: 'Europe/Paris' });
  // Lot 5h : ancienne interface des séquences, épinglée sur le secours jusqu'au lot 5j.
  await pinLegacySequences(context);
  contexts.push(context);
  await context.route('**/functions/v1/unipile-accounts', async (route) => {
    if (actionOf(route) !== 'list') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, accounts: [{ id: ws.accountId, account_status: 'OK', provider: 'LINKEDIN', name: 'E2E LinkedIn' }] }),
    });
  });
  await context.route('**/functions/v1/unipile-search', async (route) => {
    const body = actionOf(route) === 'search'
      ? { success: true, results: candidates.map(asResult), cursor: null, total: candidates.length }
      : { success: true, items: [] };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await context.route('**/functions/v1/generate-search-filters', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, filters: { keywords: 'Backend Engineer' }, suggestions: null }),
  }));
  await context.route('**/functions/v1/score-profile-job', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, scores: [] }),
  }));
  const page = await context.newPage();
  await page.goto(`/missions/${ws.missionId}?tab=sourcing`, { waitUntil: 'domcontentloaded' });
  await page.getByText('générer depuis le brief').click({ timeout: 30_000 });
  for (const c of candidates) {
    await expect(page.getByRole('checkbox', { name: `Sélectionner ${c.name}`, exact: true })).toBeVisible({ timeout: 30_000 });
  }
  return page;
}

async function openEnrollment(page: Page, names: string[], sequenceName: string): Promise<Locator> {
  for (const name of names) await page.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true }).click();
  await page.getByRole('button', { name: 'Séquence', exact: true }).click();
  await page.getByRole('menuitem', { name: new RegExp(sequenceName) }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: sequenceName });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Vérification des contacts récents de l\'organisation')).toHaveCount(0, { timeout: 20_000 });
  return dialog;
}

const enrollAll = (dialog: Locator) =>
  dialog.getByRole('button', { name: /^Inscrire 3 candidats$/ }).filter({ visible: true }).first();

// ─── Scénario commun ────────────────────────────────────────────────────────

async function expectRetained(ws: Workspace, seq: SeededSeq, t: Trio, kind: 'message' | 'invitation') {
  // Les trois sont inscrits.
  await expect.poll(async () => (await Promise.all([t.karim, t.hugo, t.nina].map((c) => enrollmentOf(seq.id, c.id)))).flat().length, { timeout: 30_000 }).toBe(3);

  // Retenu s'écrit juste après l'inscription : on relit jusqu'à l'obtenir.
  const stages = async (c: Candidate) => (await rowsOf(ws, [c.id])).map((r) => `${r.general_stage}/${r.decision_source}`);
  await expect.poll(() => stages(t.karim), { message: 'À trier : Retenu, une seule ligne', timeout: 20_000 }).toEqual(['retained/user']);
  await expect.poll(() => stages(t.hugo), { message: 'sans ligne : créée, Retenu', timeout: 20_000 }).toEqual(['retained/user']);
  await expect.poll(() => stages(t.nina), { message: 'sans ligne : créée, Retenu', timeout: 20_000 }).toEqual(['retained/user']);
  const [hugoRow] = await rowsOf(ws, [t.hugo.id]);
  expect(hugoRow.job_id, 'clé du Sourcing de mission').toBe(`project:${ws.missionId}`);

  // Le serveur pose « Contacté » au premier envoi réel, après Retenu.
  if (kind === 'invitation') await setMockMode(ws.accountId, { distance: 'SECOND_DEGREE' });
  const [karimEnrollment] = await enrollmentOf(seq.id, t.karim.id);
  const { error } = await admin()
    .from('sequence_step_executions')
    .update({ scheduled_at: minutesFromNow(-1) })
    .eq('enrollment_id', karimEnrollment.id)
    .eq('status', 'scheduled');
  if (error) throw new Error(`première étape due: ${error.message}`);
  await runCycle();
  const after = await rowsOf(ws, [t.karim.id]);
  expect(after.map((r) => `${r.general_stage}/${r.decision_source}`), 'premier envoi : Contacté, posé par le serveur').toEqual(['contacted/system']);
}

test('fenêtre simple : les inscrits À trier ou sans ligne passent en Retenu, puis Contacté au premier envoi', async ({ browser }) => {
  const ws = await workspace('E2E retenu simple');
  const t = await trio(ws);
  const seq = await missionSequence(ws, 'invitation');
  const page = await openSearchResults(browser, ws, [t.karim, t.hugo, t.nina]);
  const dialog = await openEnrollment(page, [t.karim.name, t.hugo.name, t.nina.name], seq.name);
  await enrollAll(dialog).click();
  await expectRetained(ws, seq, t, 'invitation');
});

test('préparation avec aperçu : les inscrits À trier ou sans ligne passent en Retenu, puis Contacté au premier envoi', async ({ browser }) => {
  const ws = await workspace('E2E retenu aperçu');
  const t = await trio(ws);
  const seq = await missionSequence(ws, 'message');
  const page = await openSearchResults(browser, ws, [t.karim, t.hugo, t.nina]);
  const dialog = await openEnrollment(page, [t.karim.name, t.hugo.name, t.nina.name], seq.name);
  await enrollAll(dialog).click();
  await expectRetained(ws, seq, t, 'message');
});
