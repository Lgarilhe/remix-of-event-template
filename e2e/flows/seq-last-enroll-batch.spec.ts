/**
 * Inscription de plusieurs candidats face aux gardes de la base (migration
 * 20260928055804) : un profil effacé (HINT ENROLLMENT_GDPR_ERASED, décision
 * 12) ou la même personne déjà dans la séquence sous un autre identifiant
 * (HINT ENROLLMENT_SAME_PERSON_IN_SEQUENCE, décision 21) voit sa ligne
 * refusée. Les autres candidats de la sélection sont inscrits avec leur
 * première étape, et la fenêtre nomme les refusés avec la raison :
 *  - fenêtre simple : l'insertion groupée échoue en entier, elle est reprise
 *    candidat par candidat ;
 *  - préparation avec aperçu : une insertion par candidat, les refus n'arrêtent
 *    pas la boucle.
 *
 * Harnais : stack locale (e2e/local-stack), vraie base et vraies gardes. Sont
 * simulés dans le navigateur la liste des comptes LinkedIn du prestataire, la
 * recherche LinkedIn et la génération des filtres. La même personne est
 * inscrite par un autre onglet entre la vérification du navigateur et
 * l'écriture (insertion en clé de service au passage de la requête) : seule la
 * base la voit. Les étapes seedées ont un jour de délai : le cycle du moteur
 * lancé par d'autres suites n'a rien à ramasser ici.
 */
import type { Browser, BrowserContext, Locator, Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures';
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
import { engineAvailable, ENGINE_SKIP_REASON } from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
test.describe.configure({ timeout: 180_000 });

const DAY = 24 * 3600 * 1000;
const rand = () => Math.random().toString(36).slice(2, 10);
const daysAgo = (d: number) => new Date(Date.now() - d * DAY).toISOString();

// Textes attendus (src/lib/sequenceErrorMessages.ts, enrollment-preview/enrollmentHelpers.ts).
const GDPR_ONE = "1 candidat a demandé l'effacement de ses données : il ne peut plus être inscrit dans une séquence.";
const SAME_PERSON_ONE = "1 candidat est déjà dans cette séquence sous un autre identifiant LinkedIn, ou l'a quittée il y a moins de 90 jours : il n'a pas été réinscrit.";

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

/** Cabinet sur offre payante, compte LinkedIn du propriétaire, mission. */
async function workspace(label: string): Promise<Workspace> {
  const org = await createOrg('agency', label);
  orgsToDelete.push(org);
  await setOrgPlan(org.orgId);
  const accountId = await seedLinkedInAccount(org.orgId, org.owner.userId, `acc_lotbatch_${rand()}`, 'OK');
  const missionId = await seedMission(org.orgId, org.owner.userId, { name: `Mission lot ${rand()}` });
  return { org, accountId, missionId };
}

interface SeededSeq {
  id: string;
  name: string;
}

/**
 * Séquence de la mission, une étape à un jour : message avec modèle (fenêtre
 * avec aperçu) ou invitation sans note (fenêtre simple).
 */
async function missionSequence(ws: Workspace, label: string, kind: 'message' | 'invitation'): Promise<SeededSeq> {
  const name = `${label} ${rand()}`;
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

async function seedEnrollment(ws: Workspace, seq: SeededSeq, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await admin().from('sequence_enrollments').insert({
    sequence_id: seq.id,
    organization_id: ws.org.orgId,
    created_by: ws.org.owner.userId,
    account_id: ws.accountId,
    status: 'active',
    current_step_order: 0,
    user_timezone: 'Europe/Paris',
    ...row,
  }).select('id').single();
  if (error || !data) throw new Error(`seedEnrollment: ${error?.message}`);
  return data.id as string;
}

/** Inscriptions de la séquence qui désignent ce candidat, sous n'importe lequel de ses identifiants. */
async function rowsForPerson(sequenceId: string, ids: string[]) {
  const list = ids.join(',');
  const { data, error } = await admin()
    .from('sequence_enrollments')
    .select('id, profile_id, status')
    .eq('sequence_id', sequenceId)
    .or(`profile_id.in.(${list}),provider_id.in.(${list}),resolved_profile_id.in.(${list})`);
  if (error) throw new Error(`rowsForPerson: ${error.message}`);
  return (data ?? []) as Array<{ id: string; profile_id: string; status: string }>;
}

async function executionsOf(enrollmentId: string) {
  const { data, error } = await admin().from('sequence_step_executions').select('status').eq('enrollment_id', enrollmentId);
  if (error) throw new Error(`executionsOf: ${error.message}`);
  return ((data ?? []) as Array<{ status: string }>).map((e) => e.status);
}

/** Candidats de ces identifiants passés « contacté » (la recherche en a posé d'autres en « découvert »). */
async function messagedCandidates(ws: Workspace, candidateIds: string[]) {
  const { data, error } = await admin()
    .from('job_candidate_status')
    .select('candidate_id')
    .eq('organization_id', ws.org.orgId)
    .eq('status', 'messaged')
    .in('candidate_id', candidateIds);
  if (error) throw new Error(`messagedCandidates: ${error.message}`);
  return ((data ?? []) as Array<{ candidate_id: string }>).map((r) => r.candidate_id);
}

// ─── Navigateur ─────────────────────────────────────────────────────────────

function actionOf(route: Route): string | null {
  try {
    return ((route.request().postDataJSON() as { action?: string } | null)?.action) ?? null;
  } catch {
    return null;
  }
}

const toast = (page: Page, text: string | RegExp) => page.locator('[data-sonner-toast]').filter({ hasText: text });

interface SearchProfile {
  id: string;
  name: string;
  provider_id?: string;
}

function asResult(p: SearchProfile) {
  const [first, ...rest] = p.name.split(' ');
  return {
    first_name: first,
    last_name: rest.join(' '),
    headline: 'Ingénieur backend',
    location: 'Paris, France',
    network_distance: 'SECOND_DEGREE',
    ...p,
  };
}

/** Onglet Sourcing de la mission, connecté en propriétaire : la recherche simulée affiche `profiles`. */
async function openSearchResults(browser: Browser, ws: Workspace, profiles: SearchProfile[]): Promise<Page> {
  const context = await browser.newContext({ storageState: await storageStateForUser(ws.org.owner), timezoneId: 'Europe/Paris' });
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
      ? { success: true, results: profiles.map(asResult), cursor: null, total: profiles.length }
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
  for (const p of profiles) {
    await expect(page.getByRole('checkbox', { name: `Sélectionner ${p.name}`, exact: true })).toBeVisible({ timeout: 30_000 });
  }
  return page;
}

/** Sélectionne ces candidats, « Séquence » puis la séquence : fenêtre d'inscription ouverte. */
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

interface Trio {
  erased: SearchProfile & { provider_id: string };
  twin: SearchProfile;
  twinOtherId: string;
  kept: SearchProfile;
}

/**
 * Trois candidats : Eva, effacée dans une autre séquence de l'organisation
 * (marqueur durable sur une inscription de même provider_id) ; Samuel, dont un
 * autre onglet inscrit l'identifiant Recruiter dans la séquence au moment de
 * l'écriture ; Karim, sans antécédent.
 */
async function trio(ws: Workspace): Promise<Trio> {
  const t: Trio = {
    erased: { id: `AEMAALOTE${rand()}`, provider_id: `ACoAALOTE${rand()}`, name: 'Eva Effacee' },
    twin: { id: `ACoAALOTS${rand()}`, name: 'Samuel Double' },
    twinOtherId: `AEMAALOTS${rand()}`,
    kept: { id: `ACoAALOTK${rand()}`, name: 'Karim Garde' },
  };
  const other = await missionSequence(ws, 'Lot ancienne', 'message');
  await seedEnrollment(ws, other, {
    profile_id: `ACoAALOTM${rand()}`, provider_id: t.erased.provider_id, profile_name: t.erased.name, status: 'stopped',
    created_at: daysAgo(200), completed_at: daysAgo(150), tracking_data: { gdpr_erased_at: daysAgo(150) },
  });
  return t;
}

/**
 * Journalise les insertions d'inscription ; à la première qui contient Samuel,
 * l'inscrit d'abord sous son autre identifiant (inscription faite entre-temps
 * ailleurs, invisible pour la vérification du navigateur).
 */
async function raceTwinAndRecordPosts(page: Page, ws: Workspace, seq: SeededSeq, t: Trio): Promise<string[]> {
  const posts: string[] = [];
  let raced = false;
  await page.route('**/rest/v1/sequence_enrollments*', async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.continue();
    const body = req.postData() ?? '';
    posts.push(body);
    if (!raced && body.includes(t.twin.id)) {
      raced = true;
      await seedEnrollment(ws, seq, { profile_id: t.twinOtherId, provider_id: t.twin.id, profile_name: t.twin.name });
    }
    await route.continue();
  });
  return posts;
}

async function expectOnlyKeptEnrolled(ws: Workspace, seq: SeededSeq, t: Trio) {
  expect(await rowsForPerson(seq.id, [t.erased.id, t.erased.provider_id]), 'profil effacé : aucune inscription').toHaveLength(0);
  const twinRows = await rowsForPerson(seq.id, [t.twin.id, t.twinOtherId]);
  expect(twinRows.map((r) => r.profile_id), 'même personne : seule l’inscription faite ailleurs').toEqual([t.twinOtherId]);
  const [kept] = await rowsForPerson(seq.id, [t.kept.id]);
  expect(kept?.status, 'le troisième candidat est inscrit').toBe('active');
  expect(await executionsOf(kept!.id), 'avec sa première étape planifiée').toEqual(['scheduled']);
  expect(await messagedCandidates(ws, [t.erased.id, t.twin.id, t.kept.id]), 'seul l’inscrit passe « contacté »').toEqual([t.kept.id]);
}

// ═══ Fenêtre simple : insertion groupée reprise candidat par candidat ═══════

test('fenêtre simple : sur trois candidats, le profil effacé et la même personne déjà dans la séquence sont refusés par la base et nommés, le troisième est inscrit', async ({ browser }) => {
  const ws = await workspace('E2E lot inscription simple');
  const t = await trio(ws);
  const seq = await missionSequence(ws, 'Lot simple', 'invitation');
  const page = await openSearchResults(browser, ws, [t.erased, t.twin, t.kept]);
  const posts = await raceTwinAndRecordPosts(page, ws, seq, t);
  const dialog = await openEnrollment(page, [t.erased.name, t.twin.name, t.kept.name], seq.name);
  await enrollAll(dialog).click();

  await expect(dialog.getByText('1 candidat inscrit', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByText(GDPR_ONE)).toBeVisible();
  await expect(dialog.getByText('Candidat concerné : Eva Effacee', { exact: true })).toBeVisible();
  await expect(dialog.getByText(SAME_PERSON_ONE)).toBeVisible();
  await expect(dialog.getByText('Candidat concerné : Samuel Double', { exact: true })).toBeVisible();
  await expect(toast(page, GDPR_ONE)).toContainText('Candidat concerné : Eva Effacee');
  await expect(toast(page, SAME_PERSON_ONE)).toContainText('Candidat concerné : Samuel Double');
  await expect(dialog.getByText(/L'inscription n'a pas pu aboutir|en échec|Inscription impossible/)).toHaveCount(0);
  await expect(toast(page, /en échec|Inscription impossible/)).toHaveCount(0);
  expect(posts.length, 'insertion groupée refusée en entier, puis une par candidat').toBe(4);
  const grouped = JSON.parse(posts[0]) as Array<Record<string, unknown>>;
  expect(grouped.map((r) => r.profile_id).sort()).toEqual([t.erased.id, t.twin.id, t.kept.id].sort());
  for (const single of posts.slice(1).map((b) => JSON.parse(b) as Record<string, unknown>)) {
    expect(single, 'même ligne que dans l’insertion groupée').toEqual(grouped.find((r) => r.profile_id === single.profile_id));
  }
  await expectOnlyKeptEnrolled(ws, seq, t);
});

// ═══ Préparation avec aperçu : une insertion par candidat ═══════════════════

test('aperçu : sur trois candidats, le profil effacé et la même personne déjà dans la séquence sont refusés par la base et nommés, le troisième est inscrit', async ({ browser }) => {
  const ws = await workspace('E2E lot inscription aperçu');
  const t = await trio(ws);
  const seq = await missionSequence(ws, 'Lot aperçu', 'message');
  const page = await openSearchResults(browser, ws, [t.erased, t.twin, t.kept]);
  const posts = await raceTwinAndRecordPosts(page, ws, seq, t);
  const dialog = await openEnrollment(page, [t.erased.name, t.twin.name, t.kept.name], seq.name);
  await enrollAll(dialog).click();

  await expect(dialog.getByRole('heading', { name: /candidats? inscrits?|Aucune nouvelle inscription|Aucun candidat inscrit/ }))
    .toHaveText('1 candidat inscrit', { timeout: 30_000 });
  await expect(dialog.getByText(GDPR_ONE)).toBeVisible();
  await expect(dialog.getByText('Candidat concerné : Eva Effacee', { exact: true })).toBeVisible();
  await expect(dialog.getByText(SAME_PERSON_ONE)).toBeVisible();
  await expect(dialog.getByText('Candidat concerné : Samuel Double', { exact: true })).toBeVisible();
  await expect(toast(page, GDPR_ONE)).toContainText('Candidat concerné : Eva Effacee');
  await expect(toast(page, SAME_PERSON_ONE)).toContainText('Candidat concerné : Samuel Double');
  await expect(dialog.getByText(/inscriptions? en échec/)).toHaveCount(0);
  expect(posts.length, 'une insertion par candidat').toBe(3);
  await expectOnlyKeptEnrolled(ws, seq, t);
});
