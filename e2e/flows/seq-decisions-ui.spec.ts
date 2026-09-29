/**
 * Décisions produit du lot « ui » (docs/audit-2026-09-25-sequences.md,
 * « Décisions produit en attente »), côté interface :
 *  - 12 : l'inscription d'un profil effacé (RGPD) est refusée par la base
 *    (HINT ENROLLMENT_GDPR_ERASED) ; les fenêtres d'inscription le disent en
 *    français et inscrivent les autres candidats de la sélection ;
 *  - 23 : sous un autre identifiant, une inscription close depuis plus de
 *    90 jours n'empêche pas la réinscription, avec un avertissement ; en deçà,
 *    le candidat n'est pas réinscrit et l'interface l'explique (21) ;
 *  - 29 : le kanban du pipeline d'une mission a une colonne « Répondu » ;
 *  - 31 : la fiche candidat masque à un collaborateur les actions sur les
 *    inscriptions d'un autre membre, comme le suivi des inscrits ;
 *  - 32 : pas d'activation de séquence tant que l'état de l'abonnement n'est
 *    pas lu.
 *
 * Harnais : stack locale (e2e/local-stack), vraie base et vraies actions
 * serveur. Sont simulés dans le navigateur : la liste des comptes LinkedIn du
 * prestataire, la recherche LinkedIn et la génération des filtres ; les refus
 * de la base et les pannes de lecture d'abonnement sont injectés par
 * page.route quand le test porte sur l'affichage. Les étapes seedées ont un
 * jour de délai ou plus : le cycle du moteur lancé par d'autres suites n'a
 * rien à ramasser ici.
 */
import type { Browser, BrowserContext, Locator, Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures';
import {
  addMember,
  admin,
  createOrg,
  deleteOrg,
  seedLinkedInAccount,
  seedMission,
  setOrgPlan,
  storageStateForUser,
  type TestOrg,
  type TestUser,
} from '../helpers/supabase-admin';
import { engineAvailable, ENGINE_SKIP_REASON } from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
test.describe.configure({ mode: 'serial', timeout: 180_000 });

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const rand = () => Math.random().toString(36).slice(2, 10);
const inHours = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
const daysAgo = (d: number) => new Date(Date.now() - d * DAY).toISOString();

// Textes attendus (src/lib/sequenceErrorMessages.ts, enrollmentHelpers.ts, SequencesList.tsx).
const GDPR_ONE = "1 candidat a demandé l'effacement de ses données : il ne peut plus être inscrit dans une séquence.";
const SAME_PERSON_ONE = "1 candidat est déjà dans cette séquence sous un autre identifiant LinkedIn, ou l'a quittée il y a moins de 90 jours : il n'a pas été réinscrit.";
const FORMER_PASSAGE_ONE = '1 candidat était déjà passé par cette séquence il y a plus de 90 jours, sous un autre identifiant LinkedIn : il a été réinscrit et recevra de nouveau ses étapes.';
const ALREADY_PASSED_ONE = '1 candidat est déjà passé par cette séquence (terminée, réponse ou arrêt). Relancez-le depuis le suivi de la séquence.';
const OTHER_MEMBER_RESUME_HINT = 'Candidat inscrit par un autre membre : un administrateur ou ce membre peut reprendre sa séquence.';
const PLAN_LOADING = 'Vérification de votre abonnement en cours : réessayez dans un instant.';
const PLAN_UNREADABLE = 'Votre abonnement n’a pas pu être vérifié : la séquence n’a pas été activée. Réessayez dans un instant.';

// ─── Nettoyage ──────────────────────────────────────────────────────────────

const contexts: BrowserContext[] = [];
const orgsToDelete: Array<{ org: TestOrg; extra: TestUser[] }> = [];
test.afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close().catch(() => undefined);
  while (orgsToDelete.length) {
    const { org, extra } = orgsToDelete.pop()!;
    await admin().from('job_candidate_status').delete().eq('organization_id', org.orgId);
    await admin().from('mission_process_steps').delete().eq('organization_id', org.orgId);
    await deleteOrg(org, extra);
  }
});

// ─── Données ────────────────────────────────────────────────────────────────

interface Workspace {
  org: TestOrg;
  extra: TestUser[];
  accountId: string;
  missionId: string;
}

/** Cabinet sur offre payante, compte LinkedIn du propriétaire, mission. */
async function workspace(label: string): Promise<Workspace> {
  const org = await createOrg('agency', label);
  const extra: TestUser[] = [];
  orgsToDelete.push({ org, extra });
  await setOrgPlan(org.orgId);
  const accountId = await seedLinkedInAccount(org.orgId, org.owner.userId, `acc_decui_${rand()}`, 'OK');
  const missionId = await seedMission(org.orgId, org.owner.userId, { name: `Mission déc-ui ${rand()}` });
  return { org, extra, accountId, missionId };
}

interface SeededSeq {
  id: string;
  name: string;
  stepIds: string[];
}

/**
 * Séquence de la mission : message avec modèle (fenêtre avec aperçu) ou
 * invitation sans note (fenêtre simple), un jour de délai par étape.
 */
async function missionSequence(
  ws: Workspace,
  label: string,
  opts: { kind?: 'message' | 'invitation'; createdBy?: string; isActive?: boolean; steps?: number } = {},
): Promise<SeededSeq> {
  const name = `${label} ${rand()}`;
  const kind = opts.kind ?? 'message';
  const { data: seq, error } = await admin()
    .from('outreach_sequences')
    .insert({
      name,
      organization_id: ws.org.orgId,
      created_by: opts.createdBy ?? ws.org.owner.userId,
      project_id: ws.missionId,
      is_active: opts.isActive ?? true,
    })
    .select('id')
    .single();
  if (error || !seq) throw new Error(`missionSequence: ${error?.message}`);
  const count = opts.steps ?? 1;
  const { data: rows, error: stepErr } = await admin()
    .from('sequence_steps')
    .insert(Array.from({ length: count }, (_, i) => ({
      sequence_id: seq.id,
      organization_id: ws.org.orgId,
      step_order: i,
      condition_type: 'always',
      delay_days: 1,
      action_type: kind === 'message' || i > 0 ? 'message' : 'connection_request',
      message_template: kind === 'message' || i > 0 ? `Bonjour {{firstName}} ${i + 1}` : null,
    })))
    .select('id, step_order');
  if (stepErr || !rows) throw new Error(`missionSequence(étapes): ${stepErr?.message}`);
  const stepIds = (rows as Array<{ id: string; step_order: number }>).sort((a, b) => a.step_order - b.step_order).map((r) => r.id);
  return { id: seq.id as string, name, stepIds };
}

async function seedEnrollment(ws: Workspace, seq: SeededSeq, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await admin().from('sequence_enrollments').insert({
    sequence_id: seq.id,
    organization_id: ws.org.orgId,
    created_by: ws.org.owner.userId,
    account_id: ws.accountId,
    profile_id: `ACoAADUI${rand()}`,
    profile_name: 'Candidat',
    status: 'active',
    current_step_order: 0,
    user_timezone: 'Europe/Paris',
    ...row,
  }).select('id').single();
  if (error || !data) throw new Error(`seedEnrollment: ${error?.message}`);
  return data.id as string;
}

async function seedScheduled(ws: Workspace, enrollmentId: string, stepId: string, hours = 30) {
  const { error } = await admin().from('sequence_step_executions').insert({
    enrollment_id: enrollmentId,
    organization_id: ws.org.orgId,
    step_id: stepId,
    step_order: 0,
    status: 'scheduled',
    scheduled_at: inHours(hours),
  });
  if (error) throw new Error(`seedScheduled: ${error.message}`);
}

/** Inscriptions de la séquence qui désignent ce candidat, sous n'importe lequel de ses identifiants. */
async function rowsForPerson(sequenceId: string, ids: string[]) {
  const list = ids.join(',');
  const { data, error } = await admin()
    .from('sequence_enrollments')
    .select('id, profile_id, provider_id, status')
    .eq('sequence_id', sequenceId)
    .or(`profile_id.in.(${list}),provider_id.in.(${list}),resolved_profile_id.in.(${list})`);
  if (error) throw new Error(`rowsForPerson: ${error.message}`);
  return data ?? [];
}

async function executionsOf(enrollmentId: string) {
  const { data, error } = await admin().from('sequence_step_executions').select('status').eq('enrollment_id', enrollmentId);
  if (error) throw new Error(`executionsOf: ${error.message}`);
  return (data ?? []) as Array<{ status: string }>;
}

async function sequenceActive(id: string) {
  const { data, error } = await admin().from('outreach_sequences').select('is_active').eq('id', id).single();
  if (error) throw new Error(`sequenceActive: ${error.message}`);
  return (data as { is_active: boolean }).is_active;
}

// ─── Navigateur ─────────────────────────────────────────────────────────────

function actionOf(route: Route): string | null {
  try {
    return ((route.request().postDataJSON() as { action?: string } | null)?.action) ?? null;
  } catch {
    return null;
  }
}

/** Page connectée en `user` ; seule l'action `list` de unipile-accounts est simulée. */
async function openAs(browser: Browser, user: TestUser, accountIds: string[]): Promise<Page> {
  const context = await browser.newContext({ storageState: await storageStateForUser(user), timezoneId: 'Europe/Paris' });
  contexts.push(context);
  await context.route('**/functions/v1/unipile-accounts', async (route) => {
    if (actionOf(route) !== 'list') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        accounts: accountIds.map((id) => ({ id, account_status: 'OK', provider: 'LINKEDIN', name: 'E2E LinkedIn' })),
      }),
    });
  });
  const page = await context.newPage();
  // Tutoriel vidéo du pipeline déjà vu : il s'ouvrirait par-dessus le kanban.
  await page.addInitScript(() => { try { localStorage.setItem('konekt:tuto:seen:pipeline', '1'); } catch { /* sans stockage */ } });
  return page;
}

const toast = (page: Page, text: string | RegExp) => page.locator('[data-sonner-toast]').filter({ hasText: text });

interface SearchProfile {
  id: string;
  name: string;
  provider_id?: string;
  public_identifier?: string;
  profile_url?: string;
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
  const page = await openAs(browser, ws.org.owner, [ws.accountId]);
  await page.context().route('**/functions/v1/unipile-search', async (route) => {
    const body = actionOf(route) === 'search'
      ? { success: true, results: profiles.map(asResult), cursor: null, total: profiles.length }
      : { success: true, items: [] };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.context().route('**/functions/v1/generate-search-filters', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, filters: { keywords: 'Backend Engineer' }, suggestions: null }),
  }));
  await page.context().route('**/functions/v1/score-profile-job', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, scores: [] }),
  }));
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
  return dialog;
}

const enrollAll = (dialog: Locator) =>
  dialog.getByRole('button', { name: /^Inscrire \d+ candidats?$/ }).filter({ visible: true }).first();

const previewOutcome = (dialog: Locator) =>
  dialog.getByRole('heading', { name: /candidats? inscrits?|Aucune nouvelle inscription|Aucun candidat inscrit/ });

/** Refus de la base simulé (403, 42501, HINT) pour toute insertion d'inscription qui contient ce profil. */
async function refuseEnrollmentOf(page: Page, profileId: string, hint: string) {
  await page.route('**/rest/v1/sequence_enrollments*', async (route) => {
    if (route.request().method() !== 'POST' || !(route.request().postData() ?? '').includes(profileId)) return route.continue();
    await route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ code: '42501', details: null, hint, message: 'Inscription refusée' }),
    });
  });
}

// ═══ Décision 12 : profil effacé ════════════════════════════════════════════

test.describe('Décision 12 : inscription d’un profil effacé', () => {
  test('fenêtre simple : le refus de la base pour un profil effacé est dit en français, l’autre candidat de la sélection est inscrit avec sa première étape', async ({ browser }) => {
    const ws = await workspace('E2E déc-ui RGPD simple');
    const other = await missionSequence(ws, 'RGPD simple ancienne');
    const seq = await missionSequence(ws, 'RGPD simple', { kind: 'invitation' });
    const erased = { id: `ACoAADUIGE${rand()}`, name: 'Eva Effacee' };
    const kept = { id: `ACoAADUIGK${rand()}`, name: 'Karim Garde' };
    // Effacement fait dans une autre séquence : marqueur durable sur l'inscription arrêtée.
    await seedEnrollment(ws, other, {
      profile_id: erased.id, profile_name: erased.name, status: 'stopped',
      created_at: daysAgo(200), completed_at: daysAgo(150), tracking_data: { gdpr_erased_at: daysAgo(150) },
    });
    const page = await openSearchResults(browser, ws, [erased, kept]);
    // L'insertion groupée échoue en entier sur le refus de la base : la fenêtre reprend candidat par candidat.
    const enrollmentPosts: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/rest/v1/sequence_enrollments')) enrollmentPosts.push(req.postData() ?? '');
    });
    const dialog = await openEnrollment(page, [erased.name, kept.name], seq.name);
    await enrollAll(dialog).click();

    await expect(dialog.getByText('1 candidat inscrit', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByText(GDPR_ONE)).toBeVisible();
    await expect(toast(page, GDPR_ONE)).toBeVisible();
    await expect(dialog.getByText(/L'inscription n'a pas pu aboutir/)).toHaveCount(0);
    expect(await rowsForPerson(seq.id, [erased.id]), 'profil effacé : aucune inscription').toHaveLength(0);
    expect(enrollmentPosts.length, 'insertion groupée puis une par candidat').toBe(3);
    const [row] = await rowsForPerson(seq.id, [kept.id]);
    expect(row?.status).toBe('active');
    expect((await executionsOf(row!.id)).map((e) => e.status), 'première étape planifiée').toEqual(['scheduled']);
  });

  test('aperçu : un profil effacé dans l’organisation est refusé par la base, le bilan le dit et rien n’est écrit', async ({ browser }) => {
    const ws = await workspace('E2E déc-ui RGPD base');
    const other = await missionSequence(ws, 'RGPD ancienne');
    const seq = await missionSequence(ws, 'RGPD nouvelle');
    const erased = { id: `ACoAADUIGB${rand()}`, name: 'Elise Effacee' };
    // Effacement fait dans une autre séquence : inscription arrêtée, marqueur durable.
    await seedEnrollment(ws, other, {
      profile_id: erased.id, profile_name: erased.name, status: 'stopped',
      created_at: daysAgo(200), completed_at: daysAgo(150), tracking_data: { gdpr_erased_at: daysAgo(150) },
    });
    const page = await openSearchResults(browser, ws, [erased]);
    const dialog = await openEnrollment(page, [erased.name], seq.name);
    await enrollAll(dialog).click();

    await expect(previewOutcome(dialog)).toHaveText('Aucune nouvelle inscription', { timeout: 30_000 });
    await expect(dialog.getByText(GDPR_ONE)).toBeVisible();
    await expect(dialog.getByText(/inscription.* en échec/)).toHaveCount(0);
    expect(await rowsForPerson(seq.id, [erased.id]), 'aucune inscription du profil effacé').toHaveLength(0);
  });
});

// ═══ Décisions 21 et 23 : même personne sous un autre identifiant ═══════════

test.describe('Décision 23 : réinscription sous un autre identifiant', () => {
  test('fenêtre simple : sortie il y a plus de 90 jours = réinscrit avec un avertissement ; arrêtée il y a 10 jours = pas réinscrit, expliqué', async ({ browser }) => {
    const ws = await workspace('E2E déc-ui 90 jours simple');
    const seq = await missionSequence(ws, 'Réinscription simple', { kind: 'invitation' });
    const old = { classic: `ACoAADUIO${rand()}`, recruiter: `AEMAADUIO${rand()}` };
    const recent = { classic: `ACoAADUIR${rand()}`, recruiter: `AEMAADUIR${rand()}` };
    await seedEnrollment(ws, seq, {
      profile_id: old.recruiter, provider_id: old.classic, profile_name: 'Paul Ancien', status: 'completed',
      created_at: daysAgo(130), completed_at: daysAgo(100),
    });
    await seedEnrollment(ws, seq, {
      profile_id: recent.recruiter, provider_id: recent.classic, profile_name: 'Jean Recent', status: 'stopped',
      created_at: daysAgo(40), completed_at: daysAgo(10),
    });
    const page = await openSearchResults(browser, ws, [
      { id: old.classic, name: 'Paul Ancien' },
      { id: recent.classic, name: 'Jean Recent' },
    ]);
    const dialog = await openEnrollment(page, ['Paul Ancien', 'Jean Recent'], seq.name);
    await enrollAll(dialog).click();

    await expect(dialog.getByText('1 candidat inscrit', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByRole('note').filter({ hasText: FORMER_PASSAGE_ONE })).toBeVisible();
    await expect(toast(page, FORMER_PASSAGE_ONE)).toBeVisible();
    await expect(dialog.getByText(ALREADY_PASSED_ONE)).toBeVisible();
    const oldRows = await rowsForPerson(seq.id, [old.classic, old.recruiter]);
    expect(oldRows.map((r) => r.status).sort(), 'sortie depuis plus de 90 jours : seconde ligne active').toEqual(['active', 'completed']);
    expect(await rowsForPerson(seq.id, [recent.classic, recent.recruiter]), 'arrêtée il y a 10 jours : pas de seconde ligne').toHaveLength(1);
  });

  test('aperçu : le refus de la base « même personne dans la séquence » (inscription invisible pour le navigateur) est expliqué, sans échec affiché', async ({ browser }) => {
    const ws = await workspace('E2E déc-ui même personne');
    const seq = await missionSequence(ws, 'Même personne');
    const cand = { id: `ACoAADUIS${rand()}`, name: 'Sarah Double' };
    const page = await openSearchResults(browser, ws, [cand]);
    await refuseEnrollmentOf(page, cand.id, 'ENROLLMENT_SAME_PERSON_IN_SEQUENCE');
    const dialog = await openEnrollment(page, [cand.name], seq.name);
    await enrollAll(dialog).click();

    await expect(previewOutcome(dialog)).toHaveText('Aucune nouvelle inscription', { timeout: 30_000 });
    await expect(dialog.getByText(SAME_PERSON_ONE)).toBeVisible();
    await expect(dialog.getByText(/inscription.* en échec/)).toHaveCount(0);
    expect(await rowsForPerson(seq.id, [cand.id])).toHaveLength(0);
  });
});

// ═══ Décision 29 : colonne « Répondu » du kanban de mission ═════════════════

/** Colonne du kanban de la mission (aria-label « Colonne <libellé>, N candidat(s) »). */
const column = (page: Page, label: string) => page.locator(`[aria-label^="Colonne ${label},"]`);

async function openMissionKanban(page: Page, missionId: string, anyName: string) {
  await page.goto(`/missions/${missionId}?tab=pipeline`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Kanban', exact: true }).click({ timeout: 30_000 });
  await expect(page.getByText(anyName, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
}

async function columnLabels(page: Page): Promise<string[]> {
  const labels = await page.locator('[aria-label^="Colonne "]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
  return labels.map((l) => l.replace(/^Colonne /, '').replace(/, \d+ candidats?$/, ''));
}

/** Glisse la carte `name` dans la colonne `label` (capteur de pointeur, 5 px d'amorce). */
async function dragCard(page: Page, name: string, label: string) {
  const card = page.getByText(name, { exact: true }).first();
  const target = column(page, label);
  await target.scrollIntoViewIfNeeded();
  const from = (await card.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + Math.min(120, to.height / 2), { steps: 15 });
  await page.mouse.up();
}

async function pipelineRow(id: string) {
  const { data, error } = await admin().from('job_candidate_status').select('status, pipeline_stage, general_stage').eq('id', id).single();
  if (error) throw new Error(`pipelineRow: ${error.message}`);
  return data as { status: string; pipeline_stage: string | null; general_stage: string };
}

async function seedPipelineRows(ws: Workspace, rows: Array<{ name: string; status: string; pipeline_stage: string | null }>) {
  const { data, error } = await admin().from('job_candidate_status').insert(rows.map((r) => ({
    job_id: `project:${ws.missionId}`,
    project_id: ws.missionId,
    candidate_id: `ACoAADUIK${rand()}`,
    candidate_name: r.name,
    status: r.status,
    pipeline_stage: r.pipeline_stage,
    created_by: ws.org.owner.userId,
    organization_id: ws.org.orgId,
  }))).select('id, candidate_name');
  if (error || !data) throw new Error(`seedPipelineRows: ${error?.message}`);
  return new Map((data as Array<{ id: string; candidate_name: string }>).map((d) => [d.candidate_name, d.id]));
}

test.describe('Décision 29 : colonne « Répondu » du pipeline de mission', () => {
  test('board générique : « Répondu » après « Contacté » reçoit l’étape « Répondu » et les réponses restées à une étape de départ ; glisser vers « Répondu » et en sortir écrit étape et statut', async ({ browser }) => {
    const ws = await workspace('E2E déc-ui kanban');
    const ids = await seedPipelineRows(ws, [
      { name: 'Alice Etape', status: 'replied', pipeline_stage: 'Répondu' },
      { name: 'Bruno Statut', status: 'replied', pipeline_stage: null },
      { name: 'Chloe Contactee', status: 'replied', pipeline_stage: 'messaged' },
      { name: 'David Attente', status: 'messaged', pipeline_stage: 'messaged' },
      { name: 'Emma Source', status: 'untreated', pipeline_stage: null },
      { name: 'Farid Shortlist', status: 'replied', pipeline_stage: 'shortlisted' },
    ]);
    const page = await openAs(browser, ws.org.owner, [ws.accountId]);
    await openMissionKanban(page, ws.missionId, 'Alice Etape');

    expect(await columnLabels(page)).toEqual(['Sourcé', 'Contacté', 'Répondu', 'Shortlisté', 'Écarté']);
    // Lot 0b-4 : le kanban range par l'étape générale. Un candidat qui a répondu
    // reste « Répondu » même avec l'ancien libellé « shortlisted » (Retenu vient
    // avant Contacté dans le modèle du lot 0a).
    await expect(column(page, 'Répondu')).toHaveAttribute('aria-label', 'Colonne Répondu, 4 candidats');
    for (const name of ['Alice Etape', 'Bruno Statut', 'Chloe Contactee', 'Farid Shortlist']) {
      await expect(column(page, 'Répondu').getByText(name, { exact: true })).toBeVisible();
    }
    await expect(column(page, 'Contacté')).toHaveAttribute('aria-label', 'Colonne Contacté, 1 candidat');
    await expect(column(page, 'Contacté').getByText('David Attente', { exact: true })).toBeVisible();
    await expect(column(page, 'Sourcé').getByText('Emma Source', { exact: true })).toBeVisible();
    await expect(column(page, 'Shortlisté').getByText('Farid Shortlist', { exact: true })).toHaveCount(0);

    await dragCard(page, 'David Attente', 'Répondu');
    await expect(toast(page, 'David Attente déplacé vers « Répondu »')).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => pipelineRow(ids.get('David Attente')!), { timeout: 15_000 }).toMatchObject({ status: 'replied', general_stage: 'replied' });
    await expect(column(page, 'Répondu').getByText('David Attente', { exact: true })).toBeVisible({ timeout: 15_000 });

    await dragCard(page, 'Alice Etape', 'Contacté');
    await expect(toast(page, 'Alice Etape déplacé vers « Contacté »')).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => pipelineRow(ids.get('Alice Etape')!), { timeout: 15_000 }).toMatchObject({ status: 'messaged', general_stage: 'contacted' });
    await expect(column(page, 'Contacté').getByText('Alice Etape', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(column(page, 'Répondu')).toHaveAttribute('aria-label', 'Colonne Répondu, 4 candidats');
  });

  test('avec des étapes d’entretien : « Répondu » suit « Contacté », un candidat en entretien qui a répondu reste dans son étape', async ({ browser }) => {
    const ws = await workspace('E2E déc-ui kanban process');
    const { data: steps, error } = await admin().from('mission_process_steps').insert([
      { project_id: ws.missionId, organization_id: ws.org.orgId, step_order: 0, name: 'Préqualif', duration_minutes: 30 },
      { project_id: ws.missionId, organization_id: ws.org.orgId, step_order: 1, name: 'Entretien client', duration_minutes: 45 },
    ]).select('id, name');
    if (error || !steps) throw new Error(`mission_process_steps: ${error?.message}`);
    const interview = (steps as Array<{ id: string; name: string }>).find((s) => s.name === 'Entretien client')!;
    await seedPipelineRows(ws, [
      { name: 'Gaelle Entretien', status: 'replied', pipeline_stage: interview.id },
      { name: 'Hugo Source', status: 'replied', pipeline_stage: 'sourced' },
      { name: 'Ines Contactee', status: 'messaged', pipeline_stage: 'messaged' },
    ]);
    const page = await openAs(browser, ws.org.owner, [ws.accountId]);
    await openMissionKanban(page, ws.missionId, 'Gaelle Entretien');

    expect(await columnLabels(page)).toEqual(['Sourcé', 'Contacté', 'Répondu', 'Préqualif', 'Entretien client', 'Embauché', 'Écarté']);
    await expect(column(page, 'Entretien client').getByText('Gaelle Entretien', { exact: true })).toBeVisible();
    await expect(column(page, 'Répondu').getByText('Hugo Source', { exact: true })).toBeVisible();
    await expect(column(page, 'Contacté').getByText('Ines Contactee', { exact: true })).toBeVisible();
    await expect(column(page, 'Répondu')).toHaveAttribute('aria-label', 'Colonne Répondu, 1 candidat');
  });

  test('de bout en bout : un candidat de la colonne « Contacté » marqué « a répondu » depuis sa fiche passe dans « Répondu »', async ({ browser }) => {
    const ws = await workspace('E2E déc-ui kanban réponse');
    const seq = await missionSequence(ws, 'Kanban réponse', { steps: 2 });
    const profileId = `ACoAADUIKR${rand()}`;
    const name = 'Julie Reponse';
    const enrollmentId = await seedEnrollment(ws, seq, { profile_id: profileId, profile_name: name, job_id: `project:${ws.missionId}` });
    await seedScheduled(ws, enrollmentId, seq.stepIds[1]);
    const { data: jcs, error: jcsErr } = await admin().from('job_candidate_status').insert({
      job_id: `project:${ws.missionId}`, project_id: ws.missionId, candidate_id: profileId, candidate_name: name,
      status: 'messaged', pipeline_stage: 'messaged', created_by: ws.org.owner.userId, organization_id: ws.org.orgId,
    }).select('id').single();
    expect(jcsErr, jcsErr?.message).toBeNull();
    const page = await openAs(browser, ws.org.owner, [ws.accountId]);
    await openMissionKanban(page, ws.missionId, name);
    await expect(column(page, 'Contacté').getByText(name, { exact: true })).toBeVisible();

    await page.getByText(name, { exact: true }).first().click();
    await page.getByRole('tab', { name: /^Séquences/ }).or(page.getByRole('button', { name: /^Séquences/ })).first().click({ timeout: 20_000 });
    const card = page.locator('[id$="-content-sequences"] div.rounded-xl').filter({ has: page.getByRole('heading', { name: seq.name, exact: true }) });
    await card.getByRole('button', { name: 'Actions de l\'inscription' }).click();
    await page.getByRole('menuitem', { name: 'Marquer comme ayant répondu' }).click();
    await page.getByRole('alertdialog', { name: `Marquer ${name} comme ayant répondu ?` }).getByRole('button', { name: 'Marquer comme ayant répondu' }).click();
    await expect(toast(page, `Réponse enregistrée pour ${name}`)).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => pipelineRow(jcs!.id as string), { timeout: 15_000 }).toMatchObject({ status: 'replied' });

    await openMissionKanban(page, ws.missionId, name);
    await expect(column(page, 'Répondu').getByText(name, { exact: true })).toBeVisible();
    await expect(column(page, 'Contacté').getByText(name, { exact: true })).toHaveCount(0);
  });
});

// ═══ Décision 31 : fiche candidat d'un collaborateur ════════════════════════

test.describe('Décision 31 : fiche candidat, inscriptions d’un autre membre', () => {
  test('un collaborateur ne voit ni pause, ni reprise, ni « Marquer comme ayant répondu » sur les inscriptions d’un collègue, et les garde sur les siennes', async ({ browser }) => {
    const ws = await workspace('E2E déc-ui fiche collab');
    const collab = await addMember(ws.org.orgId, 'collaborator', 'collab');
    ws.extra.push(collab);
    const collabAccount = await seedLinkedInAccount(ws.org.orgId, collab.userId, `acc_decui_c_${rand()}`, 'OK');
    await admin().from('mission_team').insert({ project_id: ws.missionId, user_id: collab.userId, role: 'sourcer' });
    const profileId = `ACoAADUIF${rand()}`;
    const name = 'Lina Fiche';
    const { error: jcsErr } = await admin().from('job_candidate_status').insert({
      job_id: `project:${ws.missionId}`, project_id: ws.missionId, candidate_id: profileId, candidate_name: name,
      status: 'messaged', pipeline_stage: 'messaged', created_by: collab.userId, organization_id: ws.org.orgId,
    });
    expect(jcsErr, jcsErr?.message).toBeNull();
    // Inscriptions du propriétaire dans des séquences du collaborateur : il les
    // voit (ses séquences), sans pouvoir agir dessus. Depuis le lot C1 (R7), il
    // ne lit plus du tout une séquence du propriétaire, même dans l'équipe de la
    // mission (ownerOnly).
    const ownerActive = await missionSequence(ws, 'Fiche propriétaire active', { createdBy: collab.userId });
    const ownerPaused = await missionSequence(ws, 'Fiche propriétaire en pause', { createdBy: collab.userId });
    const mine = await missionSequence(ws, 'Fiche collaborateur', { createdBy: collab.userId });
    const ownerOnly = await missionSequence(ws, 'Fiche séquence du propriétaire');
    const e1 = await seedEnrollment(ws, ownerActive, { profile_id: profileId, profile_name: name });
    const e2 = await seedEnrollment(ws, ownerPaused, { profile_id: profileId, profile_name: name, status: 'paused', pause_reason: 'manual' });
    const e3 = await seedEnrollment(ws, mine, { profile_id: profileId, profile_name: name, created_by: collab.userId, account_id: collabAccount });
    const e4 = await seedEnrollment(ws, ownerOnly, { profile_id: profileId, profile_name: name });
    await seedScheduled(ws, e1, ownerActive.stepIds[0]);
    await seedScheduled(ws, e2, ownerPaused.stepIds[0]);
    await seedScheduled(ws, e3, mine.stepIds[0]);
    await seedScheduled(ws, e4, ownerOnly.stepIds[0]);

    const page = await openAs(browser, collab, [collabAccount]);
    await openMissionKanban(page, ws.missionId, name);
    await page.getByText(name, { exact: true }).first().click();
    await page.getByRole('tab', { name: /^Séquences/ }).or(page.getByRole('button', { name: /^Séquences/ })).first().click({ timeout: 20_000 });
    const card = (seqName: string) => page.locator('[id$="-content-sequences"] div.rounded-xl').filter({ has: page.getByRole('heading', { name: seqName, exact: true }) });
    await expect(card(ownerActive.name)).toBeVisible({ timeout: 20_000 });
    await expect(card(ownerPaused.name)).toBeVisible();
    await expect(card(mine.name)).toBeVisible();
    await expect(card(ownerOnly.name)).toHaveCount(0);

    // Inscription active d'un collègue : consultation seule.
    await expect(card(ownerActive.name).getByRole('button', { name: 'Mettre en pause', exact: true })).toHaveCount(0);
    await card(ownerActive.name).getByRole('button', { name: 'Actions de l\'inscription' }).click();
    await expect(page.getByRole('menuitem', { name: /Voir l'historique/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Marquer comme ayant répondu' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem')).toHaveCount(0);

    // Inscription en pause d'un collègue : pas de « Reprendre », et on dit qui peut.
    await expect(card(ownerPaused.name).getByText(OTHER_MEMBER_RESUME_HINT)).toBeVisible();
    await expect(card(ownerPaused.name).getByRole('button', { name: 'Reprendre', exact: true })).toHaveCount(0);
    await card(ownerPaused.name).getByRole('button', { name: 'Actions de l\'inscription' }).click();
    await expect(page.getByRole('menuitem', { name: /Reprendre la séquence|Marquer comme ayant répondu/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem')).toHaveCount(0);

    // Sa propre inscription : actions présentes.
    await expect(card(mine.name).getByRole('button', { name: 'Mettre en pause', exact: true })).toBeVisible();
    await card(mine.name).getByRole('button', { name: 'Actions de l\'inscription' }).click();
    await expect(page.getByRole('menuitem', { name: 'Marquer comme ayant répondu' })).toBeVisible();
  });
});

// ═══ Décision 32 : activation et état de l'abonnement ═══════════════════════

async function openOutreach(page: Page, missionId: string, sequenceName: string) {
  await page.goto(`/missions/${missionId}?tab=outreach`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(sequenceName, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
}

/** Retient les lectures d'abonnement jusqu'à `release()`. */
async function holdSubscriptionState(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/rest/v1/rpc/get_subscription_state*', async (route) => {
    await gate;
    await route.continue().catch(() => undefined);
  });
  return () => release();
}

test.describe('Décision 32 : activation tant que l’abonnement n’est pas lu', () => {
  test('abonnement en cours de lecture : l’interrupteur d’une séquence désactivée est grisé, la désactivation reste possible ; une fois lu, l’activation passe', async ({ browser }) => {
    const ws = await workspace('E2E déc-ui plan chargement');
    const inactive = await missionSequence(ws, 'Plan inactive', { isActive: false });
    const active = await missionSequence(ws, 'Plan active');
    const page = await openAs(browser, ws.org.owner, [ws.accountId]);
    const release = await holdSubscriptionState(page);
    await openOutreach(page, ws.missionId, inactive.name);

    const activate = page.getByRole('switch', { name: `Activer la séquence ${inactive.name}`, exact: true });
    await expect(activate).toBeDisabled();
    await expect(activate).toHaveAttribute('title', PLAN_LOADING);
    await expect(page.getByRole('switch', { name: `Mettre en pause la séquence ${active.name}`, exact: true })).toBeEnabled();
    expect(await sequenceActive(inactive.id)).toBe(false);

    const planRead = page.waitForResponse((r) => r.url().includes('/rpc/get_subscription_state') && r.ok(), { timeout: 30_000 });
    release();
    await planRead;
    await expect(activate).toBeEnabled({ timeout: 15_000 });
    await activate.click();
    await expect(toast(page, 'Séquence réactivée')).toBeVisible({ timeout: 15_000 });
    expect(await sequenceActive(inactive.id)).toBe(true);
  });

  test('lecture de l’abonnement en échec : activer est refusé sans écriture, avec un nouvel essai de lecture', async ({ browser }) => {
    const ws = await workspace('E2E déc-ui plan échec');
    const inactive = await missionSequence(ws, 'Plan illisible', { isActive: false });
    const page = await openAs(browser, ws.org.owner, [ws.accountId]);
    await page.route('**/rest/v1/rpc/get_subscription_state*', (route) => route.fulfill({
      status: 403, contentType: 'application/json', body: JSON.stringify({ code: '42501', message: 'forbidden' }),
    }));
    const patches: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'PATCH' && req.url().includes('/rest/v1/outreach_sequences')) patches.push(req.url());
    });
    const firstRead = page.waitForResponse((r) => r.url().includes('/rpc/get_subscription_state'), { timeout: 30_000 });
    await openOutreach(page, ws.missionId, inactive.name);
    await firstRead;

    const activate = page.getByRole('switch', { name: `Activer la séquence ${inactive.name}`, exact: true });
    await expect(activate).toBeEnabled();
    const retry = page.waitForRequest((r) => r.url().includes('/rpc/get_subscription_state'), { timeout: 15_000 });
    await activate.click();
    await expect(toast(page, PLAN_UNREADABLE)).toBeVisible({ timeout: 15_000 });
    await retry;
    await expect(toast(page, "L'envoi de séquences nécessite un abonnement")).toHaveCount(0);
    expect(patches, 'aucune écriture de la séquence').toEqual([]);
    expect(await sequenceActive(inactive.id)).toBe(false);
  });

  test('abonnement en cours de lecture : une séquence créée active est enregistrée désactivée, et c’est annoncé', async ({ browser }) => {
    const ws = await workspace('E2E déc-ui plan création');
    const name = `Création plan ${rand()}`;
    const page = await openAs(browser, ws.org.owner, [ws.accountId]);
    const release = await holdSubscriptionState(page);
    await page.goto(`/missions/${ws.missionId}?tab=outreach`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Créer une séquence', exact: true }).click({ timeout: 30_000 });
    await page.getByRole('dialog', { name: 'Nouvelle séquence' }).getByRole('button', { name: /Partir de zéro/ }).click();
    await page.getByRole('button', { name: 'Expert', exact: true }).click();
    // L'offre n'est pas encore connue : l'éditeur n'annonce pas l'offre gratuite.
    await expect(page.getByText('L\'envoi de séquences nécessite un abonnement : la séquence sera enregistrée désactivée.')).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Nom de la séquence *' }).fill(name);
    await page.getByRole('button', { name: /^Message LinkedIn/ }).first().click();
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Bonjour, une mission pourrait vous intéresser.');
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).first().click();

    await expect(toast(page, 'Séquence créée désactivée')).toBeVisible({ timeout: 20_000 });
    await expect(toast(page, 'Sélectionnez ensuite vos candidats'), 'pas de « Séquence créée »').toHaveCount(0);
    await expect(page.getByRole('switch', { name: `Activer la séquence ${name}`, exact: true })).toBeDisabled();
    const { data: rows } = await admin().from('outreach_sequences').select('id, is_active').eq('organization_id', ws.org.orgId).eq('name', name);
    expect(rows ?? []).toHaveLength(1);
    expect(rows![0].is_active, 'créée désactivée').toBe(false);
    release();
  });
});
