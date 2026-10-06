/**
 * Lot 5a-2 de la refonte mission, « aucun message rédigé par l'IA ne part
 * sans relecture » (docs/refonte-mission/lot5-plan.md, section 5a-2 ;
 * CLAUDE.md, « Aucun message IA sans relecture »), côté interface :
 *  - préparation de l'inscription (EnrollmentPreviewModal) : « Inscrire N
 *    candidats » grisé tant qu'un candidat n'a pas le texte de chaque étape
 *    rédigée par l'IA, « Générer tous les aperçus », case « J'ai relu les
 *    messages rédigés par l'IA » décochée par toute génération, puis
 *    inscription avec les textes générés dans tracking_data.message_overrides ;
 *  - relecture après l'inscription, dans le suivi (SequenceEnrollmentsPanel)
 *    et dans le Journal (SequenceActivityLog) : raison affichée sur l'étape
 *    reportée par le moteur, « Relire le message » (EditScheduledMessageModal),
 *    « Enregistrer le message » qui n'écrit que final_message, puis raison
 *    retirée ; tracking_data de l'inscription jamais réécrit par le navigateur.
 *
 * Stack locale obligatoire (E2E_EDGE_FUNCTIONS=1, e2e/local-stack) : le
 * moteur (process-sequences), la génération des aperçus
 * (generate-outreach-message) et le solde de crédits (ai-credits) tournent
 * pour de vrai ; l'IA est le faux modèle du faux prestataire, qui répond par
 * marqueur (`ai_markers`) un texte propre à chaque candidat. Seuls sont
 * simulés dans le navigateur : la liste des comptes LinkedIn, le solde
 * InMail, la génération des filtres, la recherche LinkedIn et le scoring.
 * Chaque test a son organisation jetable (fixture `org`), son compte, ses
 * profils et ses marqueurs, remis à zéro à la fin.
 */
import type { Browser, BrowserContext, Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import {
  admin,
  seedLinkedInAccount,
  seedMission,
  setOrgPlan,
  storageStateForUser,
  type TestUser,
} from '../helpers/supabase-admin';
import {
  ENGINE_SKIP_REASON,
  engineAvailable,
  runCycle,
  sentTexts,
  setMockMode,
} from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
// Seeds, chargement de la mission, génération par la stack, cycles du moteur.
test.describe.configure({ timeout: 180_000 });

const HOUR = 3600_000;
const rand = () => Math.random().toString(36).slice(2, 8);
const ms = (iso: string) => new Date(iso).getTime();

/** Raison posée par le moteur (AI_REVIEW_REQUIRED_MESSAGE de _shared/sequence-send-rules.ts). */
const AI_REVIEW_REASON = "Message rédigé par l'IA à relire avant l'envoi.";
/** Libellé affiché pour cette raison (AI_REVIEW_REQUIRED_LABEL de src/lib/sequenceErrorMessages.ts). */
const AI_REVIEW_LABEL = "Message rédigé par l'IA à relire avant l'envoi : il partira après votre relecture.";
const AI_REVIEW_CHECKBOX = "J'ai relu les messages rédigés par l'IA";

// ─── Contextes navigateur et nettoyage ──────────────────────────────────────

const contexts: BrowserContext[] = [];
const cleanups: Array<() => PromiseLike<unknown>> = [];

test.afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close().catch(() => undefined);
  for (const fn of cleanups.splice(0)) await Promise.resolve(fn()).catch(() => undefined);
});

/**
 * Réponse du faux modèle pour tout appel à l'IA dont la requête contient
 * `marker` : le JSON qu'attend generate-outreach-message. Le mode est rangé
 * sous le compte du test et vidé à la fin.
 */
async function scriptAiMarkers(accountId: string, markers: Record<string, string>) {
  const ai_markers = Object.fromEntries(Object.entries(markers).map(([marker, message]) => [
    marker,
    JSON.stringify({ subject: '', message, personalization_points: [] }),
  ]));
  await setMockMode(accountId, { ai_markers });
  cleanups.push(() => setMockMode(accountId, { ai_markers: {} }));
}

interface SearchProfile {
  id: string;
  provider_id: string;
  name: string;
  first_name: string;
  last_name: string;
  headline: string;
  location: string;
  profile_url: string;
  public_identifier: string;
  network_distance: string;
}

/** Profil LinkedIn simulé ; `marker` dans le titre, lu par le faux modèle. */
function makeProfile(first: string, last: string, marker: string): SearchProfile {
  const pid = `${rand()}${rand()}`;
  const slug = `${first}-${last}-${pid}`.toLowerCase();
  const id = `ACoAAIA2${pid}`;
  return {
    id,
    provider_id: id,
    name: `${first} ${last}`,
    first_name: first,
    last_name: last,
    headline: `Ingénieur backend ${marker}`,
    location: 'Lyon',
    profile_url: `https://www.linkedin.com/in/${slug}`,
    public_identifier: slug,
    network_distance: 'FIRST_DEGREE',
  };
}

interface Opened {
  page: Page;
  /** Corps des appels du navigateur à generate-outreach-message (non simulés : la stack répond). */
  generateCalls: Array<Record<string, unknown>>;
  /** Écritures du navigateur sur sequence_enrollments (méthode et URL). */
  enrollmentWrites: string[];
}

/**
 * Page connectée en `user`. Simulé : liste des comptes LinkedIn, solde InMail,
 * génération des filtres, recherche LinkedIn et scoring. Tout le reste
 * (generate-outreach-message, ai-credits, process-sequences, REST) part vers
 * la stack.
 */
async function openAs(browser: Browser, user: TestUser, accountId: string, profiles: SearchProfile[] = []): Promise<Opened> {
  const context = await browser.newContext({ storageState: await storageStateForUser(user) });
  contexts.push(context);
  await context.route('**/functions/v1/**', async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.continue();
    const fn = new URL(req.url()).pathname.split('/functions/v1/')[1] ?? '';
    let body: Record<string, unknown> = {};
    try { body = (req.postDataJSON() ?? {}) as Record<string, unknown>; } catch { /* pas de JSON */ }
    const reply = (payload: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });

    if (fn === 'unipile-accounts' && body.action === 'list') {
      return reply({
        success: true,
        accounts: [{ id: accountId, status: 'OK', account_status: 'OK', provider: 'LINKEDIN', type: 'LINKEDIN', name: 'Camille Recruteuse' }],
      });
    }
    if (fn === 'unipile-accounts' && body.action === 'inmail_balance') {
      return reply({ success: true, balance: { premium: 0, recruiter: 100, sales_navigator: 0 } });
    }
    if (fn === 'generate-search-filters') {
      return reply({ success: true, filters: { keywords: 'Ingénieur backend' }, suggestions: null });
    }
    if (fn === 'unipile-search') {
      if (body.action === 'search') return reply({ success: true, results: profiles, cursor: null, total: profiles.length });
      if (body.action === 'get_profile') {
        const wanted = String(body.profile_id ?? body.identifier ?? '');
        return reply({ success: true, profile: profiles.find((p) => p.id === wanted) ?? profiles[0] ?? null });
      }
      return reply({ success: true });
    }
    if (fn === 'score-profile-job') return reply({ success: true, scores: [] });
    return route.continue();
  });
  const page = await context.newPage();
  // Quitter une page avec des changements non enregistrés : confirmation acceptée.
  page.on('dialog', (dialog) => { void dialog.accept().catch(() => undefined); });
  const generateCalls: Array<Record<string, unknown>> = [];
  const enrollmentWrites: string[] = [];
  page.on('request', (req) => {
    const url = req.url();
    if (req.method() === 'POST' && url.includes('/functions/v1/generate-outreach-message')) {
      try { generateCalls.push((req.postDataJSON() ?? {}) as Record<string, unknown>); } catch { generateCalls.push({}); }
    }
    if (url.includes('/rest/v1/sequence_enrollments') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method())) {
      enrollmentWrites.push(`${req.method()} ${url}`);
    }
  });
  return { page, generateCalls, enrollmentWrites };
}

const toast = (page: Page, text: string | RegExp) => page.locator('[data-sonner-toast]').filter({ hasText: text });

async function openOutreach(page: Page, missionId: string, sequenceName: string) {
  await page.goto(`/missions/${missionId}?tab=outreach`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(sequenceName, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
}

async function openEnrollmentsPanel(page: Page, sequenceName: string) {
  await page.getByRole('button', { name: `Voir les candidats inscrits à la séquence ${sequenceName}` }).click();
  const panel = page.getByRole('dialog', { name: new RegExp(sequenceName, 'i') });
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Chargement des inscriptions…')).toHaveCount(0, { timeout: 15_000 });
  return panel;
}

/** Parcours d'un candidat du panneau, déplié (le déclencheur commence par son nom). */
async function expandEnrollment(panel: Locator, name: string) {
  const trigger = panel.getByRole('button', { name: new RegExp(`^${name}`) });
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.getByText('Parcours', { exact: true }).first()).toBeVisible();
}

async function openJournal(page: Page) {
  await page.getByRole('button', { name: 'Journal', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: /Journal d.activité/ });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText('Chargement…')).toHaveCount(0, { timeout: 15_000 });
  return sheet;
}

/** Ligne du Journal (bloc bordé) d'un candidat, dépliée. */
async function journalRow(sheet: Locator, name: string) {
  const trigger = sheet.getByRole('button', { name: new RegExp(`^${name}`) });
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  const box = trigger.locator('xpath=..');
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(box.getByText(/^Prévu :/)).toBeVisible();
  return box;
}

// ─── Données ────────────────────────────────────────────────────────────────

interface StepSeed {
  action_type: string;
  message_template?: string | null;
  delay_days?: number;
  use_ai_personalization?: boolean;
}

/** Espace de travail : offre payante (crédits IA compris), mission, compte LinkedIn relié au propriétaire. */
async function workspace(org: { orgId: string; owner: TestUser }) {
  await setOrgPlan(org.orgId, 'cabinet');
  const missionId = await seedMission(org.orgId, org.owner.userId, { name: `Mission relecture IA ${rand()}` });
  const accountId = await seedLinkedInAccount(org.orgId, org.owner.userId, `acc_ia_${rand()}`);
  await admin().from('member_linkedin_accounts').update({ linkedin_account_name: 'Camille Recruteuse' }).eq('linkedin_account_id', accountId);
  return { missionId, accountId };
}

/** Séquence de la mission et ses étapes (ordre = index). */
async function seedSeq(orgId: string, createdBy: string, projectId: string, steps: StepSeed[]) {
  const name = `Relecture IA ${rand()}`;
  const { data: seq, error } = await admin()
    .from('outreach_sequences')
    .insert({ name, organization_id: orgId, created_by: createdBy, project_id: projectId, is_active: true })
    .select('id')
    .single();
  if (error || !seq) throw new Error(`seedSeq: ${error?.message}`);
  const { data: rows, error: stepErr } = await admin()
    .from('sequence_steps')
    .insert(steps.map((s, i) => ({
      sequence_id: seq.id,
      organization_id: orgId,
      step_order: i,
      condition_type: 'always',
      delay_days: 1,
      use_ai_personalization: false,
      ends_sequence: false,
      variant_group: null,
      variant_weight: null,
      subject_template: null,
      ...s,
    })))
    .select('id, step_order');
  if (stepErr || !rows) throw new Error(`seedSeq(étapes): ${stepErr?.message}`);
  const stepIds = (rows as Array<{ id: string; step_order: number }>)
    .sort((a, b) => a.step_order - b.step_order)
    .map((r) => r.id);
  return { id: seq.id as string, name, stepIds };
}

/** Inscription active (profil unique au format ACo…), rattachée à la mission, sans exécution. */
async function seedEnrollment(orgId: string, sequenceId: string, createdBy: string, accountId: string, overrides: Record<string, unknown> = {}) {
  const { data, error } = await admin()
    .from('sequence_enrollments')
    .insert({
      sequence_id: sequenceId,
      organization_id: orgId,
      created_by: createdBy,
      profile_id: `ACoAAIA2${rand()}${rand()}`,
      profile_name: 'Camille Martin',
      account_id: accountId,
      status: 'active',
      current_step_order: 0,
      user_timezone: 'Europe/Paris',
      ...overrides,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seedEnrollment: ${error?.message}`);
  return data.id as string;
}

async function seedExecution(orgId: string, enrollmentId: string, stepId: string, stepOrder: number, overrides: Record<string, unknown> = {}) {
  const { data, error } = await admin()
    .from('sequence_step_executions')
    .insert({
      enrollment_id: enrollmentId,
      organization_id: orgId,
      step_id: stepId,
      step_order: stepOrder,
      status: 'scheduled',
      scheduled_at: new Date(Date.now() + 2 * HOUR).toISOString(),
      ...overrides,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seedExecution: ${error?.message}`);
  return data.id as string;
}

interface ExecutionState {
  status: string;
  scheduled_at: string;
  final_message: string | null;
  final_subject: string | null;
  error_message: string | null;
}

async function executionRow(id: string): Promise<ExecutionState> {
  const { data, error } = await admin()
    .from('sequence_step_executions')
    .select('status, scheduled_at, final_message, final_subject, error_message')
    .eq('id', id)
    .single();
  if (error) throw new Error(`executionRow: ${error.message}`);
  return data as ExecutionState;
}

interface EnrollmentState {
  status: string;
  pause_reason: string | null;
  tracking_data: Record<string, unknown> | null;
}

async function enrollmentState(id: string): Promise<EnrollmentState> {
  const { data, error } = await admin()
    .from('sequence_enrollments')
    .select('status, pause_reason, tracking_data')
    .eq('id', id)
    .single();
  if (error) throw new Error(`enrollmentState: ${error.message}`);
  return data as EnrollmentState;
}

type MessageOverrides = Record<string, { message?: string; subject?: string; isEdited?: boolean }>;

// ═══════════════════════════════════════════════════════════════════════════
// Préparation de l'inscription
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Relire les messages avant l\'inscription', () => {
  test('@critical « Inscrire » reste grisé tant qu\'un message IA manque ; « Générer tous les aperçus » (faux modèle), case de relecture décochée par une régénération, puis inscription avec le texte généré dans message_overrides', async ({ browser, org }) => {
    const { missionId, accountId } = await workspace(org);
    // Étape 1 rédigée par l'IA, étape 2 sur modèle : seule la première exige une relecture.
    const seq = await seedSeq(org.orgId, org.owner.userId, missionId, [
      { action_type: 'message', message_template: 'Bonjour {{prenom}}', delay_days: 1, use_ai_personalization: true },
      { action_type: 'message', message_template: 'Relance {{prenom}}', delay_days: 3 },
    ]);
    const [aiStepId] = seq.stepIds;
    const tag = rand();
    const jeanne = makeProfile('Jeanne', 'Relecture', `MKJ${tag}${rand()}`);
    const paul = makeProfile('Paul', 'Relecture', `MKP${tag}${rand()}`);
    const textByProfile: Record<string, string> = {
      [jeanne.id]: `Bonjour Jeanne, une mission backend à Lyon pourrait vous parler. Je vous en dis plus ? (aperçu ${tag} J)`,
      [paul.id]: `Bonjour Paul, une mission backend à Lyon pourrait vous parler. Je vous en dis plus ? (aperçu ${tag} P)`,
    };
    const markerOf = (p: SearchProfile) => p.headline.split(' ').pop() as string;
    await scriptAiMarkers(accountId, {
      [markerOf(jeanne)]: textByProfile[jeanne.id],
      [markerOf(paul)]: textByProfile[paul.id],
    });

    const { page, generateCalls } = await openAs(browser, org.owner, accountId, [jeanne, paul]);

    // Sourcing de la mission, recherche simulée, sélection des deux profils.
    await page.goto(`/missions/${missionId}?tab=sourcing`, { waitUntil: 'domcontentloaded' });
    await page.getByPlaceholder(/Décris le profil idéal/).fill('Ingénieur backend à Lyon', { timeout: 30_000 });
    await page.getByRole('button', { name: /Générer & chercher/ }).click();
    for (const p of [jeanne, paul]) {
      await expect(page.getByRole('checkbox', { name: `Sélectionner ${p.name}` })).toBeVisible({ timeout: 30_000 });
    }
    for (const p of [jeanne, paul]) await page.getByRole('checkbox', { name: `Sélectionner ${p.name}` }).click();
    await page.getByRole('button', { name: /^Séquence/ }).first().click();
    await page.getByRole('menuitem', { name: new RegExp(seq.name) }).click();
    const dialog = page.getByRole('dialog', { name: seq.name });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText('Vérification des contacts récents de l\'organisation')).toHaveCount(0, { timeout: 15_000 });

    const enroll = dialog.getByRole('button', { name: 'Inscrire 2 candidats' });
    const review = dialog.getByRole('checkbox', { name: AI_REVIEW_CHECKBOX });
    const missingNotice = (missing: string) =>
      dialog.getByText(`Générez et relisez les messages rédigés par l'IA avant d'inscrire : ${missing}`, { exact: true });

    // 1. Aucun texte IA : bouton et case grisés, raison chiffrée.
    await expect(missingNotice("2 candidats sur 2 n'en ont pas encore.")).toBeVisible();
    await expect(enroll).toBeDisabled();
    await expect(review).toBeDisabled();
    expect(generateCalls, 'aucune génération sans clic').toHaveLength(0);

    // 2. Aperçus du seul candidat affiché : l'autre n'a toujours pas son texte.
    await dialog.getByRole('button', { name: /^Générer (les \d+ aperçus|l'aperçu)$/ }).click();
    await expect.poll(() => generateCalls.length, { timeout: 30_000 }).toBe(1);
    const firstName = String((generateCalls[0].profile as { name?: string } | undefined)?.name ?? '');
    const first = [jeanne, paul].find((p) => p.name === firstName);
    expect(first, `génération pour un des deux candidats (reçu : ${firstName})`).toBeTruthy();
    await expect(dialog.getByText(textByProfile[first!.id], { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(missingNotice("1 candidat sur 2 n'en a pas encore.")).toBeVisible();
    await expect(enroll, 'un candidat sans texte IA : toujours grisé').toBeDisabled();
    await expect(review).toBeDisabled();

    // 3. « Générer tous les aperçus » : le faux modèle répond pour l'autre candidat.
    await dialog.getByRole('button', { name: 'Générer tous les aperçus' }).click();
    await expect.poll(() => generateCalls.length, { timeout: 30_000 }).toBe(2);
    await expect(dialog.getByText('Les aperçus de tous les candidats à inscrire sont prêts.')).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByText("Générez et relisez les messages rédigés par l'IA avant d'inscrire", { exact: false })).toHaveCount(0);
    await expect(review).toBeEnabled();
    await expect(review).not.toBeChecked();
    await expect(enroll, 'textes prêts, case pas encore cochée').toBeDisabled();

    // 4. Case cochée, puis régénération d'un message IA : grisé pendant la
    // génération (réponse retenue), puis la case se décoche.
    await review.check();
    await expect(enroll).toBeEnabled();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/functions/v1/generate-outreach-message', async (route) => {
      await held;
      await route.fallback();
    });
    await dialog.getByRole('article', { name: /^Étape 1 :/ }).getByRole('button', { name: /^Régénérer ce message/ }).click();
    await expect.poll(() => generateCalls.length, { timeout: 30_000 }).toBe(3);
    await expect(missingNotice("1 candidat sur 2 n'en a pas encore.")).toBeVisible();
    expect(await enroll.isDisabled(), 'grisé tant que la régénération n\'a pas répondu').toBe(true);
    release();
    await expect(review, 'une régénération décoche la case de relecture').not.toBeChecked({ timeout: 30_000 });
    await expect(enroll).toBeDisabled();
    await page.unroute('**/functions/v1/generate-outreach-message');

    // 5. Relu une seconde fois : inscription.
    await expect(review).toBeEnabled({ timeout: 30_000 });
    await review.check();
    await expect(enroll).toBeEnabled();
    await enroll.click();
    await expect(toast(page, '2 candidats inscrits dans la séquence')).toBeVisible({ timeout: 30_000 });

    // Les textes générés par le faux modèle sont ceux que le moteur enverra.
    const { data: rows, error } = await admin()
      .from('sequence_enrollments')
      .select('profile_id, status, tracking_data')
      .eq('sequence_id', seq.id);
    if (error) throw new Error(`inscriptions: ${error.message}`);
    expect(rows ?? []).toHaveLength(2);
    for (const p of [jeanne, paul]) {
      const row = (rows ?? []).find((r) => r.profile_id === p.id);
      expect(row, `${p.name} inscrit`).toBeTruthy();
      expect(row!.status).toBe('active');
      const overrides = ((row!.tracking_data as { message_overrides?: MessageOverrides } | null)?.message_overrides) ?? {};
      expect(overrides[aiStepId]?.message, `texte IA de ${p.name} dans message_overrides`).toBe(textByProfile[p.id]);
      expect(overrides[aiStepId]?.isEdited, 'texte généré, non modifié à la main').toBeFalsy();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Relecture après l'inscription
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Relire le message d\'une étape IA reportée', () => {
  test('@critical suivi : le moteur reporte l\'étape IA avec sa raison ; « Relire le message » puis « Enregistrer » écrit final_message seul, la raison disparaît et le texte relu part au passage suivant', async ({ browser, org }) => {
    const { missionId, accountId } = await workspace(org);
    const tag = rand();
    const template = `Bonjour {{prenom}}, modèle de l'étape ${tag}`;
    const seq = await seedSeq(org.orgId, org.owner.userId, missionId, [
      { action_type: 'message', message_template: template, delay_days: 0, use_ai_personalization: true },
      { action_type: 'message', message_template: 'Relance {{prenom}}', delay_days: 3 },
    ]);
    const name = 'Camille Suivi';
    const enrollmentId = await seedEnrollment(org.orgId, seq.id, org.owner.userId, accountId, {
      profile_name: name,
      job_id: missionId,
      tracking_data: { e2e_tag: tag },
    });
    // Échue maintenant, insérée en dernier ; un cycle du moteur la reporte.
    const execId = await seedExecution(org.orgId, enrollmentId, seq.stepIds[0], 0, {
      scheduled_at: new Date(Date.now() - 60_000).toISOString(),
    });
    await runCycle({ force: true });
    await expect.poll(async () => (await executionRow(execId)).error_message, { timeout: 30_000 }).toBe(AI_REVIEW_REASON);
    const deferred = await executionRow(execId);
    expect(deferred.status).toBe('scheduled');
    expect(deferred.final_message).toBeNull();
    expect(ms(deferred.scheduled_at), 'reportée d\'environ une heure').toBeGreaterThan(Date.now() + 50 * 60_000);
    expect(await sentTexts(accountId), 'rien n\'est parti').toEqual([]);
    const before = await enrollmentState(enrollmentId);
    expect(before.status).toBe('active');

    const { page, enrollmentWrites } = await openAs(browser, org.owner, accountId);
    await openOutreach(page, missionId, seq.name);
    const panel = await openEnrollmentsPanel(page, seq.name);
    await expandEnrollment(panel, name);
    await expect(panel.getByText(AI_REVIEW_LABEL, { exact: true })).toBeVisible();

    await panel.getByRole('button', { name: 'Relire le message' }).click();
    const reviewDialog = page.getByRole('dialog', { name: 'Relire le message' });
    await expect(reviewDialog).toBeVisible();
    await expect(reviewDialog.getByRole('button', { name: "Proposer avec l'IA" })).toBeVisible();
    // Prérempli avec le modèle de l'étape.
    await expect(reviewDialog.getByLabel('Message')).toHaveValue(template);
    const reviewed = `Bonjour Camille, texte relu dans le suivi ${tag}`;
    await reviewDialog.getByLabel('Message').fill(reviewed);
    await reviewDialog.getByRole('button', { name: 'Enregistrer le message' }).click();
    await expect(toast(page, 'Message relu')).toBeVisible();
    await expect(reviewDialog).toBeHidden();

    // Le panneau relu : même étape, toujours programmée, sans raison ni « Relire le message ».
    await expect(panel.getByText('Chargement des inscriptions…')).toHaveCount(0, { timeout: 15_000 });
    await expandEnrollment(panel, name);
    await expect(panel.getByText(/^Prévu :/).first()).toBeVisible();
    await expect(panel.getByText(AI_REVIEW_LABEL, { exact: true })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Relire le message' })).toHaveCount(0);

    const saved = await executionRow(execId);
    expect(saved).toMatchObject({ status: 'scheduled', final_message: reviewed });
    expect(ms(saved.scheduled_at), 'date de report inchangée').toBe(ms(deferred.scheduled_at));
    const after = await enrollmentState(enrollmentId);
    expect(after.tracking_data, 'tracking_data inchangé').toEqual(before.tracking_data);
    expect(after.status).toBe('active');
    expect(enrollmentWrites, 'aucune écriture du navigateur sur l\'inscription').toEqual([]);

    // Échue maintenant (en dernier) : le texte relu part tel quel au passage suivant.
    await admin().from('sequence_step_executions').update({ scheduled_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', execId);
    await runCycle({ force: true });
    await expect.poll(() => sentTexts(accountId), { timeout: 30_000 }).toContain(reviewed);
    expect((await executionRow(execId)).status).toBe('sent');
  });

  test('@critical Journal : raison sur l\'étape reportée, « Relire le message », « Proposer avec l\'IA » (faux modèle), texte modifié puis enregistré dans final_message seul, et la raison disparaît', async ({ browser, org }) => {
    const { missionId, accountId } = await workspace(org);
    const tag = rand();
    const marker = `MKL${tag}${rand()}`;
    const proposal = `Bonjour Lucie, une mission backend à Lyon pourrait vous parler. Je vous en dis plus ? (proposition ${tag})`;
    await scriptAiMarkers(accountId, { [marker]: proposal });
    const template = `Bonjour {{prenom}}, modèle du Journal ${tag}`;
    const seq = await seedSeq(org.orgId, org.owner.userId, missionId, [
      { action_type: 'message', message_template: template, delay_days: 0, use_ai_personalization: true },
    ]);
    const name = 'Lucie Journal';
    const enrollmentId = await seedEnrollment(org.orgId, seq.id, org.owner.userId, accountId, {
      profile_name: name,
      profile_headline: `Ingénieure backend ${marker}`,
      job_id: missionId,
      tracking_data: { e2e_tag: tag },
    });
    // État laissé par la garde du moteur : programmée dans l'heure, raison posée, aucun texte relu.
    const execId = await seedExecution(org.orgId, enrollmentId, seq.stepIds[0], 0, {
      scheduled_at: new Date(Date.now() + 55 * 60_000).toISOString(),
      error_message: AI_REVIEW_REASON,
      final_message: null,
    });
    const before = await enrollmentState(enrollmentId);

    const { page, generateCalls, enrollmentWrites } = await openAs(browser, org.owner, accountId);
    await openOutreach(page, missionId, seq.name);
    const sheet = await openJournal(page);
    let row = await journalRow(sheet, name);
    await expect(row.getByText(AI_REVIEW_LABEL, { exact: true })).toBeVisible();
    await expect(row.getByText("Modèle de l'étape, à relire avant l'envoi", { exact: true })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Modifier', exact: true }), 'pas de « Modifier » sur une étape à relire').toHaveCount(0);

    await row.getByRole('button', { name: 'Relire le message' }).click();
    const reviewDialog = page.getByRole('dialog', { name: 'Relire le message' });
    await expect(reviewDialog).toBeVisible();
    await expect(reviewDialog.getByLabel('Message')).toHaveValue(template);

    // Proposition de l'IA (generate-outreach-message sur la stack) : modifiable, rien d'écrit.
    await reviewDialog.getByRole('button', { name: "Proposer avec l'IA" }).click();
    await expect(reviewDialog.getByLabel('Message')).toHaveValue(proposal, { timeout: 30_000 });
    expect(generateCalls).toHaveLength(1);
    expect((await executionRow(execId)).final_message, 'rien d\'écrit avant « Enregistrer »').toBeNull();
    const reviewed = `${proposal} Bonne journée.`;
    await reviewDialog.getByLabel('Message').fill(reviewed);
    await reviewDialog.getByRole('button', { name: 'Enregistrer le message' }).click();
    await expect(toast(page, 'Message relu')).toBeVisible();
    await expect(reviewDialog).toBeHidden();

    // Le Journal relu : texte relu affiché, plus de raison ni de « Relire le message ».
    await expect(sheet.getByText('Chargement…')).toHaveCount(0, { timeout: 15_000 });
    row = await journalRow(sheet, name);
    await expect(row.getByText('Message modifié', { exact: true })).toBeVisible();
    await expect(row.getByText(reviewed)).toBeVisible();
    await expect(row.getByText(AI_REVIEW_LABEL, { exact: true })).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'Relire le message' })).toHaveCount(0);

    expect(await executionRow(execId)).toMatchObject({ status: 'scheduled', final_message: reviewed });
    const after = await enrollmentState(enrollmentId);
    expect(after.tracking_data, 'tracking_data inchangé').toEqual(before.tracking_data);
    expect(after.status).toBe('active');
    expect(enrollmentWrites, 'aucune écriture du navigateur sur l\'inscription').toEqual([]);
  });
});
