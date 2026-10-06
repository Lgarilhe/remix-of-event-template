/**
 * Lot « ui-1 » du module séquences, côté interface : éditeur (vérification
 * bloquante, suppression d'étape), modèles, préparation d'inscription depuis le
 * sourcing (aperçu modifié, compte d'envoi, anti-doublon), InMail groupé,
 * panneau des inscrits, Journal et liste des séquences (désactivation,
 * réactivation, plan gratuit, collaborateur, suppression, alertes).
 *
 * Contrat : CLAUDE.md, « Séquences : règles du moteur et de l'interface », et
 * docs/audit-2026-09-25-sequences.md (décisions D1 à D6, registre SEQ-xxx).
 *
 * Stack locale obligatoire (E2E_EDGE_FUNCTIONS=1, e2e/local-stack) : les
 * actions membres de process-sequences, process-inmail-queue et le cycle du
 * moteur tournent pour de vrai. Seuls sont simulés dans le navigateur : la
 * liste des comptes LinkedIn (unipile-accounts list), la recherche LinkedIn
 * (unipile-search), la génération de filtres et de messages par l'IA et le
 * solde de crédits. Chaque test a son organisation jetable (fixture `org`),
 * ses propres identifiants de compte et de profil ; les exécutions échues
 * sont insérées en dernier.
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
  type TestUser,
} from '../helpers/supabase-admin';
import { ENGINE_SKIP_REASON, engineAvailable, runCycle, sentTexts } from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
// Seeds, chargement de la mission, appels au moteur : bien au-delà des 30 s.
test.describe.configure({ timeout: 180_000 });

const HOUR = 3600_000;
const rand = () => Math.random().toString(36).slice(2, 8);
const ms = (iso: string) => new Date(iso).getTime();

// ─── Contextes navigateur et nettoyage ──────────────────────────────────────

const contexts: BrowserContext[] = [];
const cleanups: Array<() => PromiseLike<unknown>> = [];

test.afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close().catch(() => undefined);
  for (const fn of cleanups.splice(0)) await Promise.resolve(fn()).catch(() => undefined);
});

// Quitter l'éditeur avec des changements non enregistrés ouvre la
// confirmation du navigateur (beforeunload) : acceptée.
function acceptDialogs(page: Page) {
  page.on('dialog', (dialog) => { void dialog.accept().catch(() => undefined); });
}

interface MockAccount {
  id: string;
  /** Statut renvoyé par la liste ; null : aucun statut (état inconnu). */
  status?: string | null;
  name?: string;
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

function makeProfile(first: string, last: string, opts: Partial<SearchProfile> = {}): SearchProfile {
  const pid = `${rand()}${rand()}`;
  const slug = opts.public_identifier ?? `${first}-${last}-${pid}`.toLowerCase();
  const id = opts.id ?? `ACoAAUI1${pid}`;
  return {
    id,
    provider_id: opts.provider_id ?? id,
    name: `${first} ${last}`,
    first_name: first,
    last_name: last,
    headline: 'Backend engineer',
    location: 'Paris',
    profile_url: `https://www.linkedin.com/in/${slug}`,
    public_identifier: slug,
    network_distance: 'FIRST_DEGREE',
    ...opts,
  };
}

interface OpenOptions {
  /** Profils renvoyés par la recherche LinkedIn simulée. */
  profiles?: SearchProfile[];
  /** Messages renvoyés par la génération IA simulée (generate-outreach-message). */
  aiMessage?: (body: Record<string, unknown>) => { subject: string; message: string };
}

/**
 * Page connectée en `user`. Simulé : liste des comptes LinkedIn, solde InMail,
 * crédits IA, recherche LinkedIn, génération de filtres et de messages. Tout
 * le reste (process-sequences, process-inmail-queue…) part vers la stack.
 */
async function openAs(browser: Browser, user: TestUser, accounts: MockAccount[], opts: OpenOptions = {}) {
  const context = await browser.newContext({ storageState: await storageStateForUser(user) });
  contexts.push(context);
  const aiCalls: Array<Record<string, unknown>> = [];
  await context.route('**/functions/v1/**', async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.continue();
    const fn = new URL(req.url()).pathname.split('/functions/v1/')[1] ?? '';
    let body: Record<string, unknown> = {};
    try { body = (req.postDataJSON() ?? {}) as Record<string, unknown>; } catch { /* pas de JSON */ }
    const reply = (payload: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });

    if (fn === 'unipile-accounts' && body.action === 'list') {
      return reply({
        success: true,
        accounts: accounts.map((a) => ({
          id: a.id,
          ...(a.status === null ? {} : { status: a.status ?? 'OK', account_status: a.status ?? 'OK' }),
          provider: 'LINKEDIN',
          type: 'LINKEDIN',
          name: a.name ?? 'Compte E2E',
        })),
      });
    }
    if (fn === 'unipile-accounts' && body.action === 'inmail_balance') {
      return reply({ success: true, balance: { premium: 0, recruiter: 100, sales_navigator: 0 } });
    }
    if (fn === 'ai-credits') {
      return reply({ success: true, has_credits: true, estimated_credits: 1, remaining: 1000, balance: 1000, model: 'claude-sonnet-4-6' });
    }
    if (opts.profiles) {
      if (fn === 'generate-search-filters') {
        return reply({ success: true, filters: { keywords: 'Backend engineer' }, suggestions: null });
      }
      if (fn === 'unipile-search') {
        if (body.action === 'search') return reply({ success: true, results: opts.profiles, cursor: null, total: opts.profiles.length });
        if (body.action === 'get_profile') {
          const wanted = String(body.profile_id ?? body.identifier ?? '');
          return reply({ success: true, profile: opts.profiles.find((p) => p.id === wanted) ?? opts.profiles[0] });
        }
        return reply({ success: true });
      }
      if (fn === 'score-profile-job') return reply({ success: true, scores: [] });
    }
    if (opts.aiMessage && fn === 'generate-outreach-message') {
      aiCalls.push(body);
      return reply({ success: true, ...opts.aiMessage(body) });
    }
    return route.continue();
  });
  const page = await context.newPage();
  acceptDialogs(page);
  return { context, page, aiCalls };
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

async function openJournal(page: Page) {
  await page.getByRole('button', { name: 'Journal', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: /Journal d.activité/ });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText('Chargement…')).toHaveCount(0, { timeout: 15_000 });
  return sheet;
}

/** Ligne du Journal (bloc bordé) d'un candidat, dépliée ; `hasText` départage plusieurs étapes du même candidat. */
async function journalRow(sheet: Locator, name: string, hasText?: string) {
  let trigger = sheet.getByRole('button', { name: new RegExp(`^${name}`) });
  if (hasText) trigger = trigger.filter({ hasText });
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  const box = trigger.locator('xpath=..');
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  await expect(box.getByText(/^Prévu :/)).toBeVisible();
  return box;
}

// ─── Données ────────────────────────────────────────────────────────────────

interface StepSeed {
  action_type: string;
  message_template?: string | null;
  subject_template?: string | null;
  delay_days?: number;
  use_ai_personalization?: boolean;
  variant_group?: string | null;
  variant_weight?: number | null;
  condition_type?: string;
  ends_sequence?: boolean;
  step_order?: number;
}

type Link = 'if_true_goto_step' | 'if_false_goto_step' | 'next_step_id' | 'timeout_branch_step_id';

/** Séquence et étapes (ordre = index sauf step_order explicite). `links` relie des étapes par index. */
async function seedSeq(
  orgId: string,
  createdBy: string,
  opts: {
    name?: string;
    projectId?: string | null;
    isActive?: boolean;
    steps?: StepSeed[];
    links?: Array<[number, Partial<Record<Link, number>>]>;
    extra?: Record<string, unknown>;
  } = {},
) {
  const name = opts.name ?? `Séquence ui-1 ${rand()}`;
  const { data: seq, error } = await admin()
    .from('outreach_sequences')
    .insert({
      name,
      organization_id: orgId,
      created_by: createdBy,
      project_id: opts.projectId ?? null,
      is_active: opts.isActive ?? true,
      ...(opts.extra ?? {}),
    })
    .select('id')
    .single();
  if (error || !seq) throw new Error(`seedSeq: ${error?.message}`);
  const steps = opts.steps ?? [
    { action_type: 'message', message_template: 'Bonjour {{prenom}}', delay_days: 1 },
    { action_type: 'message', message_template: 'Relance {{prenom}}', delay_days: 1 },
  ];
  let ids: string[] = [];
  if (steps.length > 0) {
    const { data: rows, error: stepErr } = await admin()
      .from('sequence_steps')
      .insert(steps.map((s, i) => ({
        sequence_id: seq.id,
        organization_id: orgId,
        step_order: s.step_order ?? i,
        condition_type: 'always',
        delay_days: 1,
        use_ai_personalization: false,
        ends_sequence: false,
        variant_group: null,
        variant_weight: null,
        subject_template: null,
        ...s,
      })))
      .select('id');
    if (stepErr || !rows) throw new Error(`seedSeq(étapes): ${stepErr?.message}`);
    ids = (rows as Array<{ id: string }>).map((r) => r.id);
    for (const [from, patch] of opts.links ?? []) {
      const update: Record<string, string> = {};
      for (const [col, to] of Object.entries(patch)) update[col] = ids[to as number];
      const { error: linkErr } = await admin().from('sequence_steps').update(update).eq('id', ids[from]);
      if (linkErr) throw new Error(`seedSeq(renvois): ${linkErr.message}`);
    }
  }
  return { id: seq.id as string, name, stepIds: ids };
}

/** Inscription (profil unique au format ACo…), sans exécution. */
async function seedEnrollment(orgId: string, sequenceId: string, createdBy: string, accountId: string, overrides: Record<string, unknown> = {}) {
  const profileId = (overrides.profile_id as string | undefined) ?? `ACoAAUI1${rand()}${rand()}`;
  const { data, error } = await admin()
    .from('sequence_enrollments')
    .insert({
      sequence_id: sequenceId,
      organization_id: orgId,
      created_by: createdBy,
      profile_id: profileId,
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
  return { enrollmentId: data.id as string, profileId };
}

/** Exécution d'étape, dans 2 h par défaut (jamais échue : aucun cycle concurrent ne la prend). */
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

async function enrollmentState(id: string) {
  const { data, error } = await admin()
    .from('sequence_enrollments')
    .select('status, pause_reason, current_step_order, tracking_data, created_by')
    .eq('id', id)
    .single();
  if (error) throw new Error(`enrollmentState: ${error.message}`);
  return data as { status: string; pause_reason: string | null; current_step_order: number; tracking_data: Record<string, unknown> | null; created_by: string };
}

async function executionRows(enrollmentId: string) {
  const { data, error } = await admin()
    .from('sequence_step_executions')
    .select('id, step_id, step_order, status, scheduled_at, final_message, final_subject')
    .eq('enrollment_id', enrollmentId)
    .order('created_at');
  if (error) throw new Error(`executionRows: ${error.message}`);
  return (data ?? []) as Array<{ id: string; step_id: string; step_order: number; status: string; scheduled_at: string; final_message: string | null; final_subject: string | null }>;
}

async function executionRow(id: string) {
  const { data, error } = await admin()
    .from('sequence_step_executions')
    .select('status, scheduled_at, final_message, final_subject')
    .eq('id', id)
    .single();
  if (error) throw new Error(`executionRow: ${error.message}`);
  return data as { status: string; scheduled_at: string; final_message: string | null; final_subject: string | null };
}

async function sequenceActive(id: string) {
  const { data } = await admin().from('outreach_sequences').select('is_active').eq('id', id).maybeSingle();
  return data?.is_active as boolean | undefined;
}

interface StepRow {
  id: string;
  step_order: number;
  action_type: string;
  message_template: string | null;
  variant_group: string | null;
  variant_weight: number | null;
  ends_sequence: boolean | null;
  if_true_goto_step: string | null;
  if_false_goto_step: string | null;
  next_step_id: string | null;
  timeout_branch_step_id: string | null;
}

async function stepsOf(sequenceId: string): Promise<StepRow[]> {
  const { data, error } = await admin()
    .from('sequence_steps')
    .select('id, step_order, action_type, message_template, variant_group, variant_weight, ends_sequence, if_true_goto_step, if_false_goto_step, next_step_id, timeout_branch_step_id')
    .eq('sequence_id', sequenceId)
    .order('step_order')
    .order('variant_group', { nullsFirst: true });
  if (error) throw new Error(`stepsOf: ${error.message}`);
  return (data ?? []) as StepRow[];
}

async function sequencesNamed(orgId: string, name: string) {
  const { data, error } = await admin().from('outreach_sequences').select('*').eq('organization_id', orgId).eq('name', name);
  if (error) throw new Error(`sequencesNamed: ${error.message}`);
  return data ?? [];
}

/** Espace de travail : offre payante, mission, compte LinkedIn relié au propriétaire. */
async function workspace(org: { orgId: string; owner: TestUser }, plan = 'cabinet', accountName = 'Camille Recruteuse') {
  await setOrgPlan(org.orgId, plan);
  const missionId = await seedMission(org.orgId, org.owner.userId, { name: `Mission ui-1 ${rand()}` });
  const accountId = await seedLinkedInAccount(org.orgId, org.owner.userId, `acc_ui1_${rand()}`);
  await admin().from('member_linkedin_accounts').update({ linkedin_account_name: accountName }).eq('linkedin_account_id', accountId);
  return { missionId, accountId };
}

/** Membre de l'organisation (rôle donné), avec compte relié et nom affiché. */
async function seedTeammate(org: { orgId: string; addExtraUser: (u: TestUser) => void }, role: 'member' | 'collaborator' | 'admin', name: string) {
  const user = await addMember(org.orgId, role, role);
  org.addExtraUser(user);
  const accountId = await seedLinkedInAccount(org.orgId, user.userId, `acc_ui1_${rand()}`);
  await admin().from('member_linkedin_accounts').update({ linkedin_account_name: name }).eq('linkedin_account_id', accountId);
  await admin().from('profiles').update({ display_name: name }).eq('user_id', user.userId);
  return { user, accountId };
}

// ─── Sourcing → préparation d'inscription ──────────────────────────────────

async function searchProfiles(page: Page, missionId: string, profiles: SearchProfile[]) {
  await page.goto(`/missions/${missionId}?tab=sourcing`, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder(/Décris le profil idéal/).fill('Backend engineer à Paris', { timeout: 30_000 });
  await page.getByRole('button', { name: /Générer & chercher/ }).click();
  for (const p of profiles) {
    await expect(page.getByRole('checkbox', { name: `Sélectionner ${p.name}` })).toBeVisible({ timeout: 30_000 });
  }
}

async function selectProfiles(page: Page, profiles: SearchProfile[]) {
  for (const p of profiles) await page.getByRole('checkbox', { name: `Sélectionner ${p.name}` }).click();
}

/** Préparation d'inscription (EnrollmentPreviewModal) des profils sélectionnés dans `sequenceName`. */
async function openEnrollPreview(page: Page, profiles: SearchProfile[], sequenceName: string) {
  await selectProfiles(page, profiles);
  await page.getByRole('button', { name: /^Séquence/ }).first().click();
  await page.getByRole('menuitem', { name: new RegExp(sequenceName) }).click();
  const dialog = page.getByRole('dialog', { name: sequenceName });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByText('Vérification des contacts récents de l\'organisation')).toHaveCount(0, { timeout: 15_000 });
  return dialog;
}

// ═══════════════════════════════════════════════════════════════════════════
// Éditeur
// ═══════════════════════════════════════════════════════════════════════════

async function openNewExpert(page: Page, missionId: string, name: string) {
  await page.goto(`/missions/${missionId}?tab=outreach`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Créer une séquence', exact: true }).click({ timeout: 30_000 });
  await page.getByRole('dialog', { name: 'Nouvelle séquence' }).getByRole('button', { name: /Partir de zéro/ }).click();
  await page.getByRole('button', { name: 'Expert', exact: true }).click();
  await page.getByRole('textbox', { name: 'Nom de la séquence *' }).fill(name);
}

async function openExisting(page: Page, missionId: string, name: string) {
  await page.goto(`/missions/${missionId}?tab=outreach`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: `Actions de la séquence ${name}`, exact: true }).click({ timeout: 30_000 });
  await page.getByRole('menuitem', { name: 'Modifier' }).click();
  await expect(page.getByRole('textbox', { name: 'Nom de la séquence *' })).toHaveValue(name);
}

async function addStep(page: Page, label: RegExp) {
  const opener = page.getByRole('button', { name: 'Ajouter une étape', exact: true });
  if (await opener.isVisible()) await opener.click();
  await page.getByRole('button', { name: label }).first().click();
}

async function choose(page: Page, combobox: string, option: string) {
  await page.getByRole('combobox', { name: combobox }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function expand(headerButton: Locator) {
  if ((await headerButton.getAttribute('aria-expanded')) !== 'true') await headerButton.click();
  await expect(headerButton).toHaveAttribute('aria-expanded', 'true');
}

const stepHeader = (page: Page, order: number, kind: 'Action' | 'Condition' | 'Attente', label: string) =>
  page.getByRole('button', { name: new RegExp(`Étape ${order}\\s*${kind}\\s*${label}`) });

async function saveEditor(page: Page) {
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).first().click();
}

test.describe('Éditeur de séquences', () => {
  // editeur-verification-bloque-enregistrement (bloquant : branche vide)
  test('@critical une branche « Non connecté » vide bloque l\'enregistrement sans écriture, avec le même point dans la liste de vérification', async ({ browser, org }) => {
    const { missionId, accountId } = await workspace(org);
    const { page } = await openAs(browser, org.owner, [{ id: accountId }]);
    const name = `Branche vide ui-1 ${rand()}`;
    await openNewExpert(page, missionId, name);
    await addStep(page, /^Vérifier la connexion/);
    await addStep(page, /^Message LinkedIn/);
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Merci pour la connexion.');
    await addStep(page, /^Invitation LinkedIn/);
    await page.getByRole('textbox', { name: "Note d'invitation" }).fill('Bonjour, une mission pourrait vous intéresser.');
    await expand(stepHeader(page, 1, 'Condition', 'Vérifier la connexion'));
    await choose(page, 'Si connecté (1er degré), aller à', 'Étape 2 : Message LinkedIn');

    const expected = 'Étape 1 : la branche Non connecté est vide. Ajoutez une étape ou choisissez Étape suivante pour les deux cas.';
    // Liste de vérification (colonne de gauche du mode Expert) : même bloquant.
    const checklist = page.getByText('1 point à corriger avant d\'enregistrer');
    await expect(checklist).toBeVisible();
    await expect(page.getByText(expected, { exact: true }).first()).toBeVisible();

    const writes: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && /\/rest\/v1\/(outreach_sequences|rpc\/save_sequence_steps)/.test(req.url())) writes.push(req.url());
    });
    await saveEditor(page);
    const blocked = toast(page, '1 point à corriger');
    await expect(blocked).toBeVisible();
    await expect(blocked).toContainText(expected);
    expect(writes, 'aucune écriture envoyée').toEqual([]);
    expect(await sequencesNamed(org.orgId, name), 'aucune séquence créée').toHaveLength(0);
  });

  // editeur-verification-bloque-enregistrement (avertissement : variable inconnue)
  test('@critical une variable inconnue demande « Enregistrer malgré ces points ? » : revenir n\'écrit rien, confirmer enregistre', async ({ browser, org }) => {
    const { missionId, accountId } = await workspace(org);
    const { page } = await openAs(browser, org.owner, [{ id: accountId }]);
    const name = `Variable inconnue ui-1 ${rand()}`;
    const message = 'Bonjour {{inconnue}}, une mission pourrait vous intéresser.';
    await openNewExpert(page, missionId, name);
    await addStep(page, /^Message LinkedIn/);
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill(message);

    await saveEditor(page);
    const warnings = page.getByRole('alertdialog', { name: 'Enregistrer malgré ces points ?' });
    await expect(warnings).toBeVisible();
    await expect(warnings).toContainText("Étape 1 : {{inconnue}} ne sera pas remplacée à l'envoi et sera retirée du message.");
    await warnings.getByRole('button', { name: 'Revenir à la séquence' }).click();
    await expect(warnings).toBeHidden();
    expect(await sequencesNamed(org.orgId, name), 'rien d\'écrit après « Revenir à la séquence »').toHaveLength(0);

    await saveEditor(page);
    await page.getByRole('alertdialog', { name: 'Enregistrer malgré ces points ?' }).getByRole('button', { name: 'Enregistrer quand même' }).click();
    await expect(page.getByText('Séquence créée', { exact: true })).toBeVisible({ timeout: 15_000 });
    const rows = await sequencesNamed(org.orgId, name);
    expect(rows).toHaveLength(1);
    const steps = await stepsOf(rows[0].id);
    expect(steps.map((s) => s.message_template)).toEqual([message]);
  });

  // editeur-suppression-etape-garde-le-graphe
  test('@critical supprimer une étape relie son prédécesseur à la suivante et garde les variantes A/B ensemble ; supprimer l\'étape A retire aussi sa variante B', async ({ browser, org }) => {
    const { missionId, accountId } = await workspace(org);
    const name = `Suppression ui-1 ${rand()}`;
    // Un → Deux (A/B 50/50) → Trois → Quatre, chaîne explicite.
    const seeded = await seedSeq(org.orgId, org.owner.userId, {
      name,
      projectId: missionId,
      steps: [
        { step_order: 0, action_type: 'message', message_template: 'Un', delay_days: 0 },
        { step_order: 1, action_type: 'message', message_template: 'Deux A', variant_group: 'A', variant_weight: 50 },
        { step_order: 1, action_type: 'message', message_template: 'Deux B', variant_group: 'B', variant_weight: 50 },
        { step_order: 2, action_type: 'message', message_template: 'Trois' },
        { step_order: 3, action_type: 'message', message_template: 'Quatre' },
      ],
      links: [[0, { next_step_id: 1 }], [1, { next_step_id: 3 }], [2, { next_step_id: 3 }], [3, { next_step_id: 4 }]],
    });
    const [un, deuxA, deuxB, , quatre] = seeded.stepIds;
    const { page } = await openAs(browser, org.owner, [{ id: accountId }]);

    await openExisting(page, missionId, name);
    await page.getByRole('button', { name: "Supprimer l'étape 3", exact: true }).click();
    await expect(page.getByText('4 étape(s) configurée(s)')).toBeVisible();
    await saveEditor(page);
    await expect(page.getByText('Séquence mise à jour', { exact: true })).toBeVisible({ timeout: 15_000 });

    let steps = await stepsOf(seeded.id);
    expect(steps.map((s) => s.message_template)).toEqual(['Un', 'Deux A', 'Deux B', 'Quatre']);
    expect(steps.map((s) => s.step_order), 'pas de renumérotation par position : variantes sur un ordre commun').toEqual([0, 1, 1, 2]);
    const byId = new Map(steps.map((s) => [s.id, s]));
    expect(byId.get(deuxA)?.variant_group).toBe('A');
    expect(byId.get(deuxB)?.variant_group, 'la variante B reste une variante').toBe('B');
    expect(byId.get(deuxA)?.next_step_id, 'variante A reliée à l\'ancienne étape 4').toBe(quatre);
    expect(byId.get(deuxB)?.next_step_id, 'variante B reliée à l\'ancienne étape 4').toBe(quatre);
    expect(byId.get(un)?.next_step_id).toBe(deuxA);

    // Réouverture : 3 étapes, la variante B sous l'étape 2.
    await openExisting(page, missionId, name);
    await expect(page.getByText('4 étape(s) configurée(s)')).toBeVisible();
    await expect(stepHeader(page, 3, 'Action', 'Message LinkedIn')).toBeVisible();
    await expect(stepHeader(page, 4, 'Action', 'Message LinkedIn')).toHaveCount(0);
    await expand(stepHeader(page, 2, 'Action', 'Message LinkedIn'));
    await expect(page.getByRole('tab', { name: /Variante B/ })).toBeVisible();

    // Supprimer l'étape 2 (variante A) emporte sa variante B : aucune étape isolée.
    await page.getByRole('button', { name: "Supprimer l'étape 2", exact: true }).click();
    await expect(page.getByText('2 étape(s) configurée(s)')).toBeVisible();
    await saveEditor(page);
    await expect(page.getByText('Séquence mise à jour', { exact: true })).toBeVisible({ timeout: 15_000 });
    steps = await stepsOf(seeded.id);
    expect(steps.map((s) => s.message_template), 'aucune variante devenue étape indépendante').toEqual(['Un', 'Quatre']);
    expect(steps.map((s) => s.step_order)).toEqual([0, 1]);
    expect(steps.every((s) => s.variant_group === null)).toBe(true);
    expect(steps[0].next_step_id, 'le prédécesseur mène à l\'étape qui suivait').toBe(quatre);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Modèles et duplication à la création
// ═══════════════════════════════════════════════════════════════════════════

/** Séquence source complète : vérification à deux branches, variantes A/B en fin de séquence, deux expéditeurs reliés. */
async function seedBranchedSource(org: { orgId: string; owner: TestUser; addExtraUser: (u: TestUser) => void }, missionId: string) {
  const theo = await seedTeammate(org, 'member', 'Théo Expéditeur');
  const claire = await seedTeammate(org, 'member', 'Claire Expéditrice');
  const senders = [
    { account_id: theo.accountId, daily_limit: 40, label: 'Théo Expéditeur', channel: 'linkedin' },
    { account_id: claire.accountId, daily_limit: 30, label: 'Claire Expéditrice', channel: 'linkedin' },
  ];
  const stopConditions = { on_reply: true, on_click: true, on_unsubscribe: true, on_meeting_booked: false };
  const source = await seedSeq(org.orgId, org.owner.userId, {
    name: `Source ui-1 ${rand()}`,
    projectId: missionId,
    extra: { stop_conditions: stopConditions, sender_accounts: senders, multi_sender_enabled: true, rotation_mode: 'least_used' },
    steps: [
      { step_order: 0, action_type: 'check_connection', delay_days: 0 },
      { step_order: 1, action_type: 'message', message_template: 'Connecté A', variant_group: 'A', variant_weight: 50, condition_type: 'if_connected', ends_sequence: true },
      { step_order: 1, action_type: 'message', message_template: 'Connecté B', variant_group: 'B', variant_weight: 50, condition_type: 'if_connected', ends_sequence: true },
      { step_order: 2, action_type: 'connection_request', message_template: 'Invitation', condition_type: 'if_not_connected' },
    ],
    links: [[0, { if_true_goto_step: 1, if_false_goto_step: 3 }]],
  });
  return { source, senders, stopConditions };
}

test.describe('Modèles', () => {
  // modeles-dupliquer-existante-et-enregistrer (dupliquer une existante)
  test('@critical « Dupliquer une existante » crée « Copie de X » avec branches remappées, variantes, fin de séquence, conditions d\'arrêt et expéditeurs de mon organisation', async ({ browser, org }) => {
    const { missionId, accountId } = await workspace(org);
    const { source, senders, stopConditions } = await seedBranchedSource(org, missionId);
    const { page } = await openAs(browser, org.owner, [{ id: accountId }]);

    await page.goto(`/missions/${missionId}?tab=outreach`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Créer une séquence', exact: true }).click({ timeout: 30_000 });
    await page.getByRole('dialog', { name: 'Nouvelle séquence' }).getByRole('button', { name: /Dupliquer une existante/ }).click();
    await page.getByRole('dialog', { name: 'Dupliquer une séquence' }).getByRole('button', { name: new RegExp(source.name) }).click();
    const copyName = `Copie de ${source.name}`;
    await expect(page.getByRole('textbox', { name: 'Nom de la séquence *' })).toHaveValue(copyName);
    await saveEditor(page);
    const warnings = page.getByRole('alertdialog', { name: 'Enregistrer malgré ces points ?' });
    if (await warnings.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await warnings.getByRole('button', { name: 'Enregistrer quand même' }).click();
    }
    await expect(page.getByText('Séquence créée', { exact: true })).toBeVisible({ timeout: 15_000 });

    const [copy] = await sequencesNamed(org.orgId, copyName);
    expect(copy, 'copie créée').toBeTruthy();
    expect(copy.stop_conditions).toEqual(stopConditions);
    const pick = (list: unknown) => (list as Array<Record<string, unknown>>).map(({ account_id, daily_limit, label, channel }) => ({ account_id, daily_limit, label, channel }));
    expect(pick(copy.sender_accounts), 'expéditeurs d\'une séquence de mon organisation repris').toEqual(senders);
    expect(copy.multi_sender_enabled).toBe(true);
    const sourceSteps = await stepsOf(source.id);
    const copySteps = await stepsOf(copy.id);
    const shape = (s: StepRow) => [s.step_order, s.action_type, s.variant_group, s.variant_group ? s.variant_weight : null, s.message_template || null, !!s.ends_sequence];
    expect(copySteps.map(shape), 'mêmes étapes, variantes sur le même ordre, fin de séquence gardée').toEqual(sourceSteps.map(shape));
    const copyIds = new Set(copySteps.map((s) => s.id));
    const sourceIds = new Set(sourceSteps.map((s) => s.id));
    const check = copySteps[0];
    expect(copyIds.has(check.if_true_goto_step ?? ''), 'branche Connecté remappée dans la copie').toBe(true);
    expect(copyIds.has(check.if_false_goto_step ?? ''), 'branche Non connecté remappée dans la copie').toBe(true);
    expect(sourceIds.has(check.if_true_goto_step ?? '')).toBe(false);
    expect(copySteps.find((s) => s.id === check.if_true_goto_step)?.message_template).toBe('Connecté A');
    expect(copySteps.find((s) => s.id === check.if_false_goto_step)?.action_type).toBe('connection_request');
  });

  // modeles-dupliquer-existante-et-enregistrer (séquence d'une autre organisation)
  // Avant le lot C1, un membre de l'équipe de la mission d'une autre
  // organisation lisait ses séquences et pouvait les dupliquer ; ce test
  // vérifiait que la copie ne reprenait ni expéditeurs ni rotation. Depuis C1
  // (20260927233806, R7), aucune policy ne passe plus par l'équipe de mission :
  // la séquence ne lui est ni affichée ni proposée.
  test('@critical « Dupliquer une existante » ne propose pas la séquence d\'une autre organisation, même à un membre de l\'équipe de sa mission', async ({ browser, org }) => {
    // Organisation A (fixture) : l'utilisateur, avec son compte relié. Organisation B : la mission et sa séquence.
    await setOrgPlan(org.orgId);
    const ownAccount = await seedLinkedInAccount(org.orgId, org.owner.userId, `acc_ui1_${rand()}`);
    const other = await createOrg('agency', 'E2E ui-1 autre org');
    const otherExtra: TestUser[] = [];
    cleanups.push(() => deleteOrg(other, otherExtra));
    await setOrgPlan(other.orgId);
    const otherMission = await seedMission(other.orgId, other.owner.userId, { name: `Mission autre org ui-1 ${rand()}` });
    const sender = await seedTeammate({ orgId: other.orgId, addExtraUser: (u) => otherExtra.push(u) }, 'member', 'Zoé Autre Org');
    const foreign = await seedSeq(other.orgId, other.owner.userId, {
      name: `Séquence autre org ui-1 ${rand()}`,
      projectId: otherMission,
      extra: {
        sender_accounts: [{ account_id: sender.accountId, daily_limit: 40, label: 'Zoé Autre Org', channel: 'linkedin' }],
        multi_sender_enabled: true,
        rotation_mode: 'least_used',
      },
    });
    await admin().from('mission_team').insert({ project_id: otherMission, user_id: org.owner.userId, role: 'sourcer' });

    const { page } = await openAs(browser, org.owner, [{ id: ownAccount }]);
    await page.goto(`/missions/${otherMission}?tab=outreach`, { waitUntil: 'domcontentloaded' });
    const create = page.getByRole('button', { name: 'Créer une séquence', exact: true }).first();
    await expect(create).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(foreign.name, { exact: true }), 'séquence de l\'autre organisation non affichée').toHaveCount(0);
    await create.click();
    await page.getByRole('dialog', { name: 'Nouvelle séquence' }).getByRole('button', { name: /Dupliquer une existante/ }).click();
    const duplicate = page.getByRole('dialog', { name: 'Dupliquer une séquence' });
    await expect(duplicate).toBeVisible();
    await expect(duplicate.getByRole('button', { name: new RegExp(foreign.name) }), 'non proposée à la duplication').toHaveCount(0);
  });

  // modeles-dupliquer-existante-et-enregistrer (enregistrer comme modèle)
  test('@critical « Enregistrer comme modèle » écrit organization_id, is_system=false et les étapes relues en base (ordre des variantes, fin de séquence)', async ({ browser, org }) => {
    const { missionId, accountId } = await workspace(org);
    cleanups.push(() => admin().from('sequence_templates').delete().eq('organization_id', org.orgId));
    const { source } = await seedBranchedSource(org, missionId);
    const { page } = await openAs(browser, org.owner, [{ id: accountId }]);
    await openOutreach(page, missionId, source.name);
    const inserts: Array<{ status: number; body: string }> = [];
    page.on('response', async (res) => {
      if (res.request().method() === 'POST' && res.url().includes('/rest/v1/sequence_templates')) {
        inserts.push({ status: res.status(), body: await res.text().catch(() => '') });
      }
    });

    await page.getByRole('button', { name: `Actions de la séquence ${source.name}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Enregistrer comme modèle' }).click();
    const saveTpl = page.getByRole('dialog', { name: 'Enregistrer comme modèle' });
    const templateName = `Modèle ui-1 ${rand()}`;
    await saveTpl.getByLabel('Nom du modèle *').fill(templateName);
    await saveTpl.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect.poll(() => inserts.length, { timeout: 15_000 }).toBeGreaterThan(0);
    // DÉFAUT seq-templates-created-by-fk : sequence_templates.created_by référence profiles(id) mais le front écrit l'id auth.users, l'insertion est refusée (23503) sur toute base construite depuis les migrations
    expect(inserts[0], `insertion du modèle : ${inserts[0]?.body}`).toMatchObject({ status: 201 });
    await expect(toast(page, 'Modèle enregistré')).toBeVisible({ timeout: 15_000 });
    const { data: templates } = await admin().from('sequence_templates').select('*').eq('organization_id', org.orgId);
    expect(templates ?? []).toHaveLength(1);
    const tpl = templates![0];
    expect(tpl.name).toBe(templateName);
    expect(tpl.is_system).toBe(false);
    const config = tpl.steps_config as Array<{ step_order: number; ends_sequence: boolean; variant_group: string | null }>;
    expect(config.map((s) => s.step_order), 'ordre enregistré, variantes comprises').toEqual([0, 1, 1, 2]);
    expect(config.map((s) => s.ends_sequence)).toEqual([false, true, true, false]);
  });

  // modeles-dupliquer-existante-et-enregistrer (modèle vide, échec de chargement)
  test('@critical un modèle sans étape est refusé sans écriture, et un échec de chargement des modèles propose « Réessayer », distinct de « Aucun modèle disponible »', async ({ browser, org }) => {
    const { missionId, accountId } = await workspace(org);
    cleanups.push(() => admin().from('sequence_templates').delete().eq('organization_id', org.orgId));
    const emptySeq = await seedSeq(org.orgId, org.owner.userId, { name: `Vide ui-1 ${rand()}`, projectId: missionId, steps: [] });
    // Modèle existant de l'organisation (écrit par le service), pour le rechargement.
    const templateName = `Modèle existant ui-1 ${rand()}`;
    const { error: tplErr } = await admin().from('sequence_templates').insert({
      organization_id: org.orgId, name: templateName, category: 'custom', is_system: false,
      steps_config: [{ id: 'x1', step_order: 0, action_type: 'message', message_template: 'Bonjour' }],
    });
    if (tplErr) throw new Error(`modèle: ${tplErr.message}`);
    const { page } = await openAs(browser, org.owner, [{ id: accountId }]);
    await openOutreach(page, missionId, emptySeq.name);

    // Séquence sans étape : refus, rien d'écrit.
    const writes: string[] = [];
    page.on('request', (req) => { if (req.method() === 'POST' && req.url().includes('/rest/v1/sequence_templates')) writes.push(req.url()); });
    await page.getByRole('button', { name: `Actions de la séquence ${emptySeq.name}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Enregistrer comme modèle' }).click();
    await page.getByRole('dialog', { name: 'Enregistrer comme modèle' }).getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(toast(page, /Le modèle n.a pas été enregistré/)).toBeVisible({ timeout: 15_000 });
    expect(writes, 'aucune insertion').toEqual([]);
    const { count } = await admin().from('sequence_templates').select('id', { count: 'exact', head: true }).eq('organization_id', org.orgId);
    expect(count, 'aucun modèle vide enregistré').toBe(1);
    await page.keyboard.press('Escape');

    // Échec de chargement des modèles : « Réessayer », distinct d'une liste vide.
    let failTemplates = true;
    await page.route('**/rest/v1/sequence_templates**', async (route: Route) => {
      if (route.request().method() === 'GET' && failTemplates) {
        return route.fulfill({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ message: 'boom' }) });
      }
      return route.fallback();
    });
    await page.getByRole('button', { name: 'Créer une séquence', exact: true }).click();
    await page.getByRole('dialog', { name: 'Nouvelle séquence' }).getByRole('button', { name: /Depuis un modèle/ }).click();
    const templatesDialog = page.getByRole('dialog', { name: 'Choisir un modèle' });
    await expect(templatesDialog.getByText('Impossible de charger les modèles.')).toBeVisible();
    await expect(templatesDialog.getByText('Aucun modèle disponible')).toHaveCount(0);
    failTemplates = false;
    await templatesDialog.getByRole('button', { name: 'Réessayer' }).click();
    await expect(templatesDialog.getByText(templateName)).toBeVisible();
    await expect(templatesDialog.getByText('Impossible de charger les modèles.')).toHaveCount(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Préparation d'inscription (sourcing)
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Préparation d\'inscription', () => {
  // inscription-apercu-modifie-part-tel-quel
  test('@critical un aperçu modifié à la main n\'est jamais remplacé (générer tout, Ctrl+Entrée, régénérer refusé), il est enregistré dans message_overrides et c\'est lui qui part', async ({ browser, org }) => {
    const { missionId, accountId } = await workspace(org);
    const seq = await seedSeq(org.orgId, org.owner.userId, {
      name: `Aperçus ui-1 ${rand()}`,
      projectId: missionId,
      steps: [
        { action_type: 'message', message_template: 'Bonjour {{prenom}}', delay_days: 0, use_ai_personalization: true },
        { action_type: 'message', message_template: 'Relance {{prenom}}', delay_days: 3, use_ai_personalization: true },
      ],
    });
    const jeanne = makeProfile('Jeanne', 'Aperçu');
    const paul = makeProfile('Paul', 'Aperçu');
    const { page, aiCalls } = await openAs(browser, org.owner, [{ id: accountId, name: 'Camille Recruteuse' }], {
      profiles: [jeanne, paul],
      aiMessage: (body) => {
        const profile = body.profile as { name?: string } | undefined;
        const ctx = body.sequenceContext as { prevSentSteps?: unknown[] } | undefined;
        return { subject: 'Objet IA', message: `Message IA pour ${profile?.name} n°${(ctx?.prevSentSteps?.length ?? 0) + 1}` };
      },
    });
    await searchProfiles(page, missionId, [jeanne, paul]);
    const dialog = await openEnrollPreview(page, [jeanne, paul], seq.name);

    await dialog.getByRole('button', { name: 'Générer tous les aperçus' }).click();
    await expect(dialog.getByText(`Message IA pour ${jeanne.name} n°1`)).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => aiCalls.length, { timeout: 20_000 }).toBe(4);

    const edited = `Message écrit à la main pour Jeanne ${rand()}`;
    await dialog.getByRole('button', { name: 'Modifier le message' }).first().click();
    const editor = dialog.getByRole('textbox').filter({ hasText: /Message IA pour Jeanne/ }).first();
    await editor.fill(edited);
    await dialog.getByRole('button', { name: 'Voir le message' }).first().click();
    await expect(dialog.getByText(edited)).toBeVisible();
    await expect(dialog.getByText('Modifié', { exact: true })).toBeVisible();

    // « Générer tous les aperçus » : rien n'est régénéré, la modification reste.
    await dialog.getByRole('button', { name: 'Générer tous les aperçus' }).click();
    await page.waitForTimeout(1_500);
    expect(aiCalls.length, 'aucune génération pour des aperçus déjà générés ou modifiés').toBe(4);
    await expect(dialog.getByText(edited)).toBeVisible();

    // Ctrl+Entrée sur la liste des candidats : rien de régénéré non plus.
    await dialog.locator('[data-candidate-id]').first().focus();
    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(1_000);
    expect(aiCalls.length, 'Ctrl+Entrée ne remplace pas un message généré ou modifié').toBe(4);

    // « Régénérer » sur le message modifié : confirmation, « Garder ma version ».
    await dialog.getByRole('button', { name: 'Régénérer ce message' }).first().click();
    const confirm = page.getByRole('alertdialog', { name: 'Remplacer votre modification ?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Garder ma version' }).click();
    await expect(dialog.getByText(edited)).toBeVisible();
    expect(aiCalls.length).toBe(4);

    await dialog.getByRole('button', { name: 'Inscrire 2 candidats' }).click();
    await expect(toast(page, '2 candidats inscrits dans la séquence')).toBeVisible({ timeout: 30_000 });

    const { data: rows } = await admin()
      .from('sequence_enrollments')
      .select('id, profile_id, tracking_data, account_id')
      .eq('sequence_id', seq.id);
    const jeanneRow = (rows ?? []).find((r) => r.profile_id === jeanne.id);
    expect(jeanneRow, 'Jeanne inscrite').toBeTruthy();
    const overrides = (jeanneRow!.tracking_data as { message_overrides?: Record<string, { message?: string; isEdited?: boolean }> }).message_overrides ?? {};
    expect(overrides[seq.stepIds[0]]?.message, 'aperçu modifié enregistré').toBe(edited);
    expect(overrides[seq.stepIds[0]]?.isEdited).toBe(true);

    // Le moteur envoie le texte modifié, tel quel.
    await runCycle({ force: true });
    await expect.poll(() => sentTexts(accountId), { timeout: 30_000 }).toContain(edited);
  });

  // inscription-compte-envoi-affiche-et-bloquant (compte déconnecté)
  test('@critical un compte d\'envoi déconnecté est affiché « Déconnecté » et désactive « Inscrire » avec la raison et « Ouvrir mes connexions »', async ({ browser, org }) => {
    const { missionId, accountId } = await workspace(org);
    await admin().from('member_linkedin_accounts').update({ account_status: 'CREDENTIALS' }).eq('linkedin_account_id', accountId);
    const seq = await seedSeq(org.orgId, org.owner.userId, { name: `Compte ui-1 ${rand()}`, projectId: missionId });
    const jeanne = makeProfile('Jeanne', 'Compte');
    const { page } = await openAs(browser, org.owner, [{ id: accountId, status: 'CREDENTIALS', name: 'Camille Recruteuse' }], { profiles: [jeanne] });
    await searchProfiles(page, missionId, [jeanne]);
    const dialog = await openEnrollPreview(page, [jeanne], seq.name);
    const notice = dialog.getByRole('alert').filter({ hasText: 'Envoyé depuis le compte LinkedIn de' });
    await expect(notice).toContainText('Camille Recruteuse');
    await expect(notice).toContainText('Déconnecté');
    await expect(notice).toContainText("Votre compte LinkedIn est déconnecté. Reconnectez-le avant d'inscrire des candidats.");
    await expect(notice.getByRole('link', { name: 'Ouvrir mes connexions' })).toHaveAttribute('href', '/settings/account/connections');
    await expect(dialog.getByRole('button', { name: /^Inscrire 1 candidat/ })).toBeDisabled();
  });

  // inscription-compte-envoi-affiche-et-bloquant (compte d'un collègue, état inconnu, refus de la base)
  test('@critical le compte d\'un collègue bloque l\'inscription, un état inconnu ne bloque pas, et le refus ENROLL_ACCOUNT_OF_OTHER_MEMBER arrête tout sans « réessayez »', async ({ browser, org }) => {
    await setOrgPlan(org.orgId);
    const missionId = await seedMission(org.orgId, org.owner.userId, { name: `Mission ui-1 ${rand()}` });
    const colleague = await seedTeammate(org, 'member', 'Marc Collègue');
    const seq = await seedSeq(org.orgId, org.owner.userId, { name: `Compte collègue ui-1 ${rand()}`, projectId: missionId });
    const jeanne = makeProfile('Jeanne', 'Collegue');

    // 1. Seul compte listé : celui du collègue (le propriétaire n'a pas de compte relié).
    const first = await openAs(browser, org.owner, [{ id: colleague.accountId, name: 'Marc Collègue' }], { profiles: [jeanne] });
    await searchProfiles(first.page, missionId, [jeanne]);
    const dialog = await openEnrollPreview(first.page, [jeanne], seq.name);
    const notice = dialog.getByRole('alert').filter({ hasText: 'Envoyé depuis le compte LinkedIn de' });
    await expect(notice).toContainText("Ce compte LinkedIn est relié à un autre membre de l'équipe. Inscrivez les candidats depuis votre propre compte.");
    await expect(notice.getByRole('link', { name: 'Ouvrir mes connexions' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Inscrire 1 candidat/ })).toBeDisabled();
    await first.context.close();

    // 2. Compte sans statut et sans liaison connue : état inconnu, pas de blocage.
    const unknownAccount = `acc_ui1_unknown_${rand()}`;
    const second = await openAs(browser, org.owner, [{ id: unknownAccount, status: null, name: 'Compte inconnu' }], { profiles: [jeanne] });
    await searchProfiles(second.page, missionId, [jeanne]);
    const dialog2 = await openEnrollPreview(second.page, [jeanne], seq.name);
    await expect(dialog2.getByText('Envoyé depuis le compte LinkedIn de')).toBeVisible();
    await expect(dialog2.getByRole('alert').filter({ hasText: 'Envoyé depuis le compte LinkedIn de' })).toHaveCount(0);
    await expect(dialog2.getByRole('button', { name: /^Inscrire 1 candidat/ })).toBeEnabled();
    await second.context.close();

    // 3. Bouton contourné : l'inscription part avec le compte du collègue, la base refuse.
    const ownAccount = await seedLinkedInAccount(org.orgId, org.owner.userId, `acc_ui1_${rand()}`);
    const paul = makeProfile('Paul', 'Collegue');
    const third = await openAs(browser, org.owner, [{ id: ownAccount, name: 'Camille Recruteuse' }], { profiles: [jeanne, paul] });
    let upserts = 0;
    await third.page.route('**/rest/v1/sequence_enrollments**', async (route) => {
      const req = route.request();
      if (req.method() !== 'POST') return route.fallback();
      upserts += 1;
      const payload = req.postDataJSON() as Record<string, unknown> | Array<Record<string, unknown>>;
      const forced = Array.isArray(payload)
        ? payload.map((row) => ({ ...row, account_id: colleague.accountId }))
        : { ...payload, account_id: colleague.accountId };
      return route.continue({ postData: JSON.stringify(forced) });
    });
    await searchProfiles(third.page, missionId, [jeanne, paul]);
    const dialog3 = await openEnrollPreview(third.page, [jeanne, paul], seq.name);
    await dialog3.getByRole('button', { name: 'Inscrire 2 candidats', exact: true }).click();
    const refusal = toast(third.page, 'Inscription impossible');
    await expect(refusal).toBeVisible({ timeout: 20_000 });
    await expect(refusal).toContainText("Ce compte LinkedIn est relié à un autre membre de l'équipe. Inscrivez les candidats depuis votre propre compte.");
    await expect(refusal).not.toContainText(/réessayez/i);
    const { count } = await admin().from('sequence_enrollments').select('id', { count: 'exact', head: true }).eq('sequence_id', seq.id);
    expect(count, 'aucune inscription créée').toBe(0);
    expect(upserts, 'la boucle s\'arrête au premier refus').toBe(1);
  });

  // inscription-doublons-toute-organisation
  test('@critical un candidat déjà inscrit par un autre membre (autre identifiant LinkedIn) est signalé et exclu pour un collaborateur ; « Inscrire quand même » est réservé au propriétaire ; un slug voisin n\'est pas signalé ; un échec de vérification bloque avec « Réessayer »', async ({ browser, org }) => {
    const { missionId, accountId } = await workspace(org);
    const collab = await seedTeammate(org, 'collaborator', 'Chloé Collaboratrice');
    await admin().from('mission_team').insert({ project_id: missionId, user_id: collab.user.userId, role: 'sourcer' });
    await admin().from('profiles').update({ display_name: 'Camille Propriétaire' }).eq('user_id', org.owner.userId);

    // Inscription vivante du propriétaire, sous l'identifiant classique (ACo…).
    const providerId = `ACoAAUI1dup${rand()}${rand()}`;
    const slug = `jeanne-doublon-${rand()}`;
    const older = await seedSeq(org.orgId, org.owner.userId, { name: `Ancienne ui-1 ${rand()}`, projectId: missionId });
    await seedEnrollment(org.orgId, older.id, org.owner.userId, accountId, {
      profile_id: providerId,
      provider_id: providerId,
      profile_name: 'Jeanne Doublon',
      profile_url: `https://www.linkedin.com/in/${slug}`,
      created_at: new Date(Date.now() - 200 * 24 * HOUR).toISOString(),
    });
    // Séquence cible du collaborateur : depuis le lot C1 (R7), il ne lit plus
    // celle d'un collègue, même dans l'équipe de la mission.
    const target = await seedSeq(org.orgId, collab.user.userId, { name: `Cible ui-1 ${rand()}`, projectId: missionId });

    // Même candidate vue depuis Recruiter (identifiant AE…, même provider_id), et une voisine au slug préfixé.
    const jeanne = makeProfile('Jeanne', 'Doublon', { id: `AEMAAUI1${rand()}${rand()}`, provider_id: providerId, public_identifier: slug });
    const voisine = makeProfile('Jeanne', 'Voisine', { public_identifier: `${slug}-42` });

    // ── Collaborateur ──
    const asCollab = await openAs(browser, collab.user, [{ id: collab.accountId, name: 'Chloé Collaboratrice' }], { profiles: [jeanne, voisine] });
    await searchProfiles(asCollab.page, missionId, [jeanne, voisine]);
    const dialog = await openEnrollPreview(asCollab.page, [jeanne, voisine], target.name);
    await expect(dialog.getByText(/1 candidat déjà contacté par votre organisation/)).toBeVisible();
    await expect(dialog.getByText('Jeanne Doublon', { exact: true }).last()).toBeVisible();
    await expect(dialog.getByText(/Seuls les propriétaires et administrateurs peuvent les inscrire quand même/)).toBeVisible();
    await expect(dialog.getByText(/Inscrire quand même/)).toHaveCount(0);
    await expect(dialog.getByText(/sur 2 sera inscrit/)).toBeVisible();
    await expect(dialog.getByText(/Déjà contacté par Camille le/)).toBeVisible();
    // La voisine (slug préfixé) n'est pas un doublon : seule elle serait inscrite.
    await expect(dialog.getByRole('button', { name: 'Inscrire 1 candidat', exact: true })).toBeEnabled();
    await asCollab.context.close();

    // ── Propriétaire : dérogation, puis échec de vérification ──
    const asOwner = await openAs(browser, org.owner, [{ id: accountId, name: 'Camille Recruteuse' }], { profiles: [jeanne, voisine] });
    let failCheck = true;
    await asOwner.page.route('**/rest/v1/rpc/find_recent_org_contacts**', async (route) => {
      if (failCheck && route.request().method() === 'POST') {
        return route.fulfill({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ message: 'boom' }) });
      }
      return route.fallback();
    });
    await searchProfiles(asOwner.page, missionId, [jeanne, voisine]);
    const ownerDialog = await openEnrollPreview(asOwner.page, [jeanne, voisine], target.name);
    const failure = ownerDialog.getByRole('alert').filter({ hasText: 'Impossible de vérifier les contacts récents de votre organisation' });
    await expect(failure).toBeVisible();
    await expect(ownerDialog.getByRole('button', { name: /^Inscrire \d+ candidat/ })).toBeDisabled();
    failCheck = false;
    await failure.getByRole('button', { name: 'Réessayer' }).click();
    await expect(failure).toBeHidden({ timeout: 15_000 });
    await expect(ownerDialog.getByText(/1 candidat déjà contacté par votre organisation/)).toBeVisible();
    await ownerDialog.getByText('Inscrire quand même (1)').click();
    await ownerDialog.getByRole('button', { name: 'Inscrire 2 candidats', exact: true }).click();
    await expect(toast(asOwner.page, '2 candidats inscrits dans la séquence')).toBeVisible({ timeout: 30_000 });
    const { data: enrolled } = await admin().from('sequence_enrollments').select('profile_id').eq('sequence_id', target.id);
    expect((enrolled ?? []).map((r) => r.profile_id).sort()).toEqual([jeanne.id, voisine.id].sort());
  });

  // lot5a-case-destinataires (décision 4 du lot 5)
  test('@critical lot 5a : dès 5 candidats, « Inscrire N candidats » reste grisé jusqu\'à la case « Je confirme les destinataires », avec le premier message ; un retrait décoche la case', async ({ browser, org }) => {
    const { missionId, accountId } = await workspace(org);
    const seq = await seedSeq(org.orgId, org.owner.userId, {
      name: `Destinataires ui-1 ${rand()}`,
      projectId: missionId,
      steps: [{ action_type: 'message', message_template: 'Bonjour {{first_name}}, un poste pourrait vous plaire.', delay_days: 0 }],
    });
    const people = ['Alice', 'Bruno', 'Chloe', 'David', 'Emma', 'Fanny'].map((first) => makeProfile(first, 'Destinataire'));
    const { page } = await openAs(browser, org.owner, [{ id: accountId, name: 'Camille Recruteuse' }], { profiles: people });
    await searchProfiles(page, missionId, people);
    const dialog = await openEnrollPreview(page, people, seq.name);

    const box = dialog.getByRole('checkbox', { name: 'Je confirme les destinataires' });
    await expect(box).toBeVisible();
    await expect(box).not.toBeChecked();
    await expect(box).toHaveAccessibleDescription('Obligatoire à partir de 5 candidats.');
    // Premier message en entier, au-dessus de la case.
    const firstMessage = dialog.getByRole('region', { name: /^Premier message, pour / });
    await expect(firstMessage).toContainText('Bonjour Alice, un poste pourrait vous plaire.');
    await expect(dialog.getByRole('button', { name: 'Inscrire 6 candidats', exact: true })).toBeDisabled();
    await box.check();
    await expect(dialog.getByRole('button', { name: 'Inscrire 6 candidats', exact: true })).toBeEnabled();

    // Un candidat retiré : la liste change, la case se décoche.
    await dialog.getByRole('button', { name: 'Actions pour Fanny Destinataire' }).click();
    await page.getByRole('menuitem', { name: 'Retirer de la sélection' }).click();
    await expect(box).not.toBeChecked();
    await expect(dialog.getByRole('button', { name: 'Inscrire 5 candidats', exact: true })).toBeDisabled();
    await box.check();
    await dialog.getByRole('button', { name: 'Inscrire 5 candidats', exact: true }).click();
    await expect(toast(page, '5 candidats inscrits dans la séquence')).toBeVisible({ timeout: 30_000 });
    const { count } = await admin().from('sequence_enrollments').select('id', { count: 'exact', head: true }).eq('sequence_id', seq.id);
    expect(count).toBe(5);
  });

  // lot5a-case-destinataires : message rédigé par l'IA sans modèle (l'éditeur l'accepte)
  test('lot 5a : séquence IA sans modèle, 5 candidats : préparation avec aperçu, premier message annoncé comme rédigé par l\'IA, jamais « Aucun message écrit »', async ({ browser, org }) => {
    const { missionId, accountId } = await workspace(org);
    const seq = await seedSeq(org.orgId, org.owner.userId, {
      name: `IA sans modèle ui-1 ${rand()}`,
      projectId: missionId,
      steps: [
        { action_type: 'profile_visit', delay_days: 0 },
        { action_type: 'message', message_template: null, use_ai_personalization: true, delay_days: 1 },
        { action_type: 'message', message_template: 'Relance {{first_name}}', delay_days: 3 },
      ],
    });
    const people = ['Alice', 'Bruno', 'Chloe', 'David', 'Emma'].map((first) => makeProfile(first, 'Redaction'));
    const { page } = await openAs(browser, org.owner, [{ id: accountId, name: 'Camille Recruteuse' }], { profiles: people });
    await searchProfiles(page, missionId, people);
    const dialog = await openEnrollPreview(page, people, seq.name);

    const firstMessage = dialog.getByRole('region', { name: /^Premier message, pour / });
    await expect(firstMessage).toContainText("Message rédigé par l'IA Konekt pour ce candidat : générez-le pour le relire.");
    await expect(firstMessage.getByRole('button', { name: "Générer l'aperçu" })).toBeVisible();
    // La relance écrite n'est pas présentée comme premier message.
    await expect(firstMessage).not.toContainText('Relance Alice');
    await expect(dialog.getByText('Aucun message écrit', { exact: false })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Inscrire 5 candidats', exact: true })).toBeDisabled();
    await dialog.getByRole('checkbox', { name: 'Je confirme les destinataires' }).check();
    await expect(dialog.getByRole('button', { name: 'Inscrire 5 candidats', exact: true })).toBeEnabled();
  });

  // lot5a-case-destinataires : sous le seuil
  test('lot 5a : 4 candidats, pas de case, « Inscrire 4 candidats » actif', async ({ browser, org }) => {
    const { missionId, accountId } = await workspace(org);
    const seq = await seedSeq(org.orgId, org.owner.userId, {
      name: `Quatre ui-1 ${rand()}`,
      projectId: missionId,
      steps: [{ action_type: 'message', message_template: 'Bonjour {{first_name}}', delay_days: 0 }],
    });
    const people = ['Alice', 'Bruno', 'Chloe', 'David'].map((first) => makeProfile(first, 'Quatre'));
    const { page } = await openAs(browser, org.owner, [{ id: accountId, name: 'Camille Recruteuse' }], { profiles: people });
    await searchProfiles(page, missionId, people);
    const dialog = await openEnrollPreview(page, people, seq.name);
    await expect(dialog.getByRole('checkbox', { name: 'Je confirme les destinataires' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Inscrire 4 candidats', exact: true })).toBeEnabled();
  });

  // lot5a-recapitulatif-apercu (plus de 10 candidats)
  test('lot 5a : 11 candidats, le Récapitulatif montre « Aperçu du premier message » avec ‹ ›, et la case est obligatoire', async ({ browser, org }) => {
    const { missionId, accountId } = await workspace(org);
    const seq = await seedSeq(org.orgId, org.owner.userId, {
      name: `Récapitulatif ui-1 ${rand()}`,
      projectId: missionId,
      steps: [{ action_type: 'message', message_template: 'Bonjour {{first_name}}, êtes-vous ouvert à un échange ?', delay_days: 0 }],
    });
    const firsts = ['Alice', 'Bruno', 'Chloe', 'David', 'Emma', 'Fanny', 'Gaspard', 'Hugo', 'Ines', 'Jules', 'Karim'];
    const people = firsts.map((first) => makeProfile(first, 'Recap'));
    const { page } = await openAs(browser, org.owner, [{ id: accountId, name: 'Camille Recruteuse' }], { profiles: people });
    await searchProfiles(page, missionId, people);
    const dialog = await openEnrollPreview(page, people, seq.name);

    const block = dialog.getByRole('region', { name: 'Aperçu du premier message' });
    await expect(block).toBeVisible();
    await expect(block).toContainText('1 sur 11');
    await expect(block).toContainText('Bonjour Alice, êtes-vous ouvert à un échange ?');
    await expect(block.getByRole('button', { name: 'Candidat précédent' })).toBeDisabled();
    await block.getByRole('button', { name: 'Candidat suivant' }).click();
    await expect(block).toContainText('2 sur 11');
    await expect(block).toContainText('Bonjour Bruno, êtes-vous ouvert à un échange ?');

    const enrollButton = dialog.getByRole('button', { name: 'Inscrire 11 candidats', exact: true });
    await expect(enrollButton).toBeDisabled();
    await dialog.getByRole('checkbox', { name: 'Je confirme les destinataires' }).check();
    await expect(enrollButton).toBeEnabled();
  });

  // inmail-groupe-texte-corrige-planifie
  test('@critical InMail groupé : le texte corrigé à l\'écran sans « Sauvegarder » est celui planifié, la confirmation le dit, et fermer avec une saisie non reportée demande confirmation', async ({ browser, org }) => {
    const { missionId, accountId } = await workspace(org);
    cleanups.push(() => admin().from('inmail_queue').delete().eq('organization_id', org.orgId));
    const jeanne = makeProfile('Jeanne', 'Inmail', { network_distance: 'SECOND_DEGREE' });
    const paul = makeProfile('Paul', 'Inmail', { network_distance: 'SECOND_DEGREE' });
    const { page } = await openAs(browser, org.owner, [{ id: accountId, name: 'Camille Recruteuse' }], {
      profiles: [jeanne, paul],
      aiMessage: (body) => {
        const profile = body.profile as { name?: string } | undefined;
        return { subject: `Objet IA ${profile?.name}`, message: `Message IA ${profile?.name}` };
      },
    });
    await searchProfiles(page, missionId, [jeanne, paul]);
    await selectProfiles(page, [jeanne, paul]);
    await page.getByTitle('Envoyer un InMail groupé').click();
    const modal = page.getByRole('dialog', { name: 'InMails personnalisés' });
    await expect(modal).toBeVisible({ timeout: 15_000 });
    await modal.getByRole('button', { name: /^Générer 2 messages/ }).click();
    await expect(toast(page, /2 messages générés/)).toBeVisible({ timeout: 20_000 });
    await expect(modal.locator('#subject')).toHaveValue(`Objet IA ${jeanne.name}`);

    const subject = `Objet corrigé ${rand()}`;
    const message = `Message corrigé pour Jeanne ${rand()}`;
    await modal.locator('#subject').fill(subject);
    const editor = modal.locator('#message');
    await editor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(message);
    await expect(editor).toContainText(message);

    // Fermer avec la saisie non reportée : confirmation, on continue.
    await modal.getByRole('button', { name: 'Fermer', exact: true }).first().click();
    const closeConfirm = page.getByRole('alertdialog', { name: 'Vos modifications ne sont pas enregistrées' });
    await expect(closeConfirm).toBeVisible();
    await closeConfirm.getByRole('button', { name: 'Continuer la modification' }).click();
    await expect(modal.locator('#subject')).toHaveValue(subject);

    // Planifier sans « Sauvegarder » : la confirmation annonce la prise en compte.
    await modal.getByRole('button', { name: 'Planifier 2 InMails' }).click();
    const queueConfirm = page.getByRole('alertdialog', { name: 'Planifier 2 InMails ?' });
    await expect(queueConfirm).toContainText('La modification en cours du message affiché sera prise en compte.');
    await queueConfirm.getByRole('button', { name: 'Planifier', exact: true }).click();
    await expect(toast(page, '2 InMails planifiés pour envoi')).toBeVisible({ timeout: 30_000 });

    const { data: queued } = await admin()
      .from('inmail_queue')
      .select('recipient_profile_id, subject, message, account_id')
      .eq('organization_id', org.orgId);
    const rowJeanne = (queued ?? []).find((r) => r.recipient_profile_id === jeanne.id);
    const rowPaul = (queued ?? []).find((r) => r.recipient_profile_id === paul.id);
    expect(rowJeanne?.subject, 'objet corrigé planifié').toBe(subject);
    expect(rowJeanne?.message, 'message corrigé planifié').toContain(message);
    expect(rowJeanne?.message).not.toContain('Message IA');
    expect(rowPaul?.subject).toBe(`Objet IA ${paul.name}`);
    expect(rowJeanne?.account_id).toBe(accountId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Panneau des inscrits
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Panneau des inscrits', () => {
  // panneau-reprendre-candidat
  test('@critical « Reprendre la séquence » passe par le serveur et garde la date ; « Réessayer l\'étape en échec » pour un échec d\'envoi ; ni reprise pour un compte déconnecté ni après un effacement RGPD ; refus serveur si la séquence est désactivée', async ({ browser, org }) => {
    const { missionId, accountId } = await workspace(org);
    const seq = await seedSeq(org.orgId, org.owner.userId, { name: `Panneau ui-1 ${rand()}`, projectId: missionId });
    const [s0] = seq.stepIds;
    const add = async (name: string, enrollment: Record<string, unknown>, exec?: Record<string, unknown>) => {
      const e = await seedEnrollment(org.orgId, seq.id, org.owner.userId, accountId, { profile_name: name, ...enrollment });
      const execId = exec ? await seedExecution(org.orgId, e.enrollmentId, s0, 0, exec) : null;
      return { ...e, execId };
    };
    const in3h = new Date(Date.now() + 3 * HOUR).toISOString();
    const alice = await add('Alice Reprise', { status: 'paused', pause_reason: 'manual' }, { scheduled_at: in3h });
    await add('Bruno Echec', { status: 'paused', pause_reason: 'send_failed' }, {
      status: 'failed', error_message: 'Erreur LinkedIn 422 : destinataire invalide', scheduled_at: new Date(Date.now() - HOUR).toISOString(),
    });
    await add('Chloé Deconnectee', { status: 'paused', pause_reason: 'account_disconnected' }, { scheduled_at: in3h });
    const denis = await add('Denis Efface', { status: 'paused', pause_reason: 'manual', tracking_data: { gdpr_erased_at: new Date().toISOString() } }, { scheduled_at: in3h });
    const emma = await add('Emma Pause', { status: 'paused', pause_reason: 'manual' }, { scheduled_at: in3h });
    await add('Fanny Abonnement', { status: 'paused', pause_reason: 'subscription_required' }, { scheduled_at: in3h });
    const gaston = await add('Gaston Delie', { status: 'paused', pause_reason: 'manual', account_id: `acc_ui1_delie_${rand()}` }, { scheduled_at: in3h });
    // Hugo : toutes les étapes déjà envoyées, rien à reprendre.
    const hugo = await seedEnrollment(org.orgId, seq.id, org.owner.userId, accountId, { profile_name: 'Hugo Termine', status: 'paused', pause_reason: 'manual', current_step_order: 2 });
    const sentAt = new Date(Date.now() - 48 * HOUR).toISOString();
    await seedExecution(org.orgId, hugo.enrollmentId, seq.stepIds[0], 0, { status: 'sent', scheduled_at: sentAt, executed_at: sentAt });
    await seedExecution(org.orgId, hugo.enrollmentId, seq.stepIds[1], 1, { status: 'sent', scheduled_at: sentAt, executed_at: sentAt });

    const { page } = await openAs(browser, org.owner, [{ id: accountId }]);
    await openOutreach(page, missionId, seq.name);
    const panel = await openEnrollmentsPanel(page, seq.name);

    // A : reprise serveur, bilan réel, date gardée.
    const resumeCalls: Array<Record<string, unknown>> = [];
    page.on('request', (req) => {
      if (req.url().includes('/functions/v1/process-sequences') && req.method() === 'POST') resumeCalls.push(req.postDataJSON() as Record<string, unknown>);
    });
    await panel.getByRole('button', { name: 'Actions pour Alice Reprise' }).click();
    await page.getByRole('menuitem', { name: 'Reprendre la séquence' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Reprendre la séquence pour Alice Reprise ?' });
    await confirm.getByRole('button', { name: 'Reprendre', exact: true }).click();
    await expect(toast(page, 'Séquence reprise pour Alice Reprise')).toBeVisible({ timeout: 20_000 });
    expect(resumeCalls.some((b) => b.action === 'resume_enrollments' && JSON.stringify(b.enrollment_ids) === JSON.stringify([alice.enrollmentId])), 'action serveur resume_enrollments').toBe(true);
    expect(await enrollmentState(alice.enrollmentId)).toMatchObject({ status: 'active', pause_reason: null });
    const aliceExec = await executionRow(alice.execId!);
    expect(aliceExec.status).toBe('scheduled');
    expect(ms(aliceExec.scheduled_at), 'l\'étape en attente garde sa date').toBe(ms(in3h));

    // B : échec d'envoi non incertain, sans étape en attente.
    await panel.getByRole('button', { name: 'Actions pour Bruno Echec' }).click();
    await expect(page.getByRole('menuitem', { name: 'Réessayer l’étape en échec' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Reprendre la séquence' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // C : compte déconnecté, seulement le lien dédié.
    await panel.getByRole('button', { name: 'Actions pour Chloé Deconnectee' }).click();
    await expect(page.getByRole('menuitem', { name: 'Reconnecter le compte' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Reprendre la séquence|Réessayer/ })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // D : effacement RGPD, pas de reprise, l'aide le dit.
    await expect(panel.getByText('Ce candidat a demandé l’effacement de ses données : il ne peut plus être relancé.')).toBeVisible();
    await panel.getByRole('button', { name: 'Actions pour Denis Efface' }).click();
    await expect(page.getByRole('menuitem', { name: /Reprendre la séquence|Réessayer|Relancer/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    expect((await enrollmentState(denis.enrollmentId)).status).toBe('paused');

    // F : abonnement requis, seulement le lien vers les offres.
    await panel.getByRole('button', { name: 'Actions pour Fanny Abonnement' }).click();
    await expect(page.getByRole('menuitem', { name: 'Voir les offres' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Reprendre la séquence|Réessayer/ })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // G : compte d'envoi qui n'est plus relié, le bilan le dit et rien ne reprend.
    await panel.getByRole('button', { name: 'Actions pour Gaston Delie' }).click();
    await page.getByRole('menuitem', { name: 'Reprendre la séquence' }).click();
    await page.getByRole('alertdialog', { name: 'Reprendre la séquence pour Gaston Delie ?' }).getByRole('button', { name: 'Reprendre', exact: true }).click();
    await expect(toast(page, "Ce compte LinkedIn n'est plus relié. Reliez-le avant de reprendre la séquence.")).toBeVisible({ timeout: 20_000 });
    expect(await enrollmentState(gaston.enrollmentId)).toMatchObject({ status: 'paused', pause_reason: 'manual' });

    // H : plus aucune étape à envoyer, « Rien à reprendre ».
    await panel.getByRole('button', { name: 'Actions pour Hugo Termine' }).click();
    await page.getByRole('menuitem', { name: 'Reprendre la séquence' }).click();
    await page.getByRole('alertdialog', { name: 'Reprendre la séquence pour Hugo Termine ?' }).getByRole('button', { name: 'Reprendre', exact: true }).click();
    await expect(toast(page, 'Rien à reprendre : cette séquence est terminée pour Hugo Termine')).toBeVisible({ timeout: 20_000 });
    expect((await executionRows(hugo.enrollmentId)).filter((e) => e.status === 'scheduled'), 'aucune étape replanifiée').toEqual([]);

    // Séquence désactivée entre-temps : la reprise d'Emma est refusée par le serveur.
    await admin().from('outreach_sequences').update({ is_active: false }).eq('id', seq.id);
    await panel.getByRole('button', { name: 'Actions pour Emma Pause' }).click();
    await page.getByRole('menuitem', { name: 'Reprendre la séquence' }).click();
    await page.getByRole('alertdialog', { name: 'Reprendre la séquence pour Emma Pause ?' }).getByRole('button', { name: 'Reprendre', exact: true }).click();
    await expect(toast(page, 'La séquence est désactivée : réactivez-la pour reprendre ce candidat.')).toBeVisible({ timeout: 20_000 });
    expect(await enrollmentState(emma.enrollmentId)).toMatchObject({ status: 'paused', pause_reason: 'manual' });
  });

  // panneau-reprendre-candidat (D3 : candidat d'un collègue)
  test('@critical un collaborateur ne se voit pas proposer la reprise du candidat d\'un collègue', async ({ browser, org }) => {
    const { missionId, accountId } = await workspace(org);
    const collab = await seedTeammate(org, 'collaborator', 'Chloé Collaboratrice');
    await admin().from('mission_team').insert({ project_id: missionId, user_id: collab.user.userId, role: 'sourcer' });
    const seq = await seedSeq(org.orgId, collab.user.userId, { name: `Panneau collab ui-1 ${rand()}`, projectId: missionId });
    const theirs = await seedEnrollment(org.orgId, seq.id, org.owner.userId, accountId, { profile_name: 'Alice Collegue', status: 'paused', pause_reason: 'manual' });
    await seedExecution(org.orgId, theirs.enrollmentId, seq.stepIds[0], 0);
    const mine = await seedEnrollment(org.orgId, seq.id, collab.user.userId, collab.accountId, { profile_name: 'Bruno Mien', status: 'paused', pause_reason: 'manual' });
    await seedExecution(org.orgId, mine.enrollmentId, seq.stepIds[0], 0);

    const { page } = await openAs(browser, collab.user, [{ id: collab.accountId }]);
    await openOutreach(page, missionId, seq.name);
    const panel = await openEnrollmentsPanel(page, seq.name);
    await expect(panel.getByText('Alice Collegue', { exact: true })).toBeVisible();
    await expect(panel.getByText('Candidat inscrit par un autre membre : un administrateur ou ce membre peut reprendre sa séquence.')).toBeVisible();
    await panel.getByRole('button', { name: 'Actions pour Alice Collegue' }).click();
    await expect(page.getByRole('menuitem', { name: /Reprendre la séquence|Réessayer/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    // Contrôle positif : son propre candidat se reprend.
    await panel.getByRole('button', { name: 'Actions pour Bruno Mien' }).click();
    await expect(page.getByRole('menuitem', { name: 'Reprendre la séquence' })).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Journal
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Journal', () => {
  // journal-modifier-message-programme
  test('@critical modifier un message programmé écrit final_message et final_subject seulement s\'il est encore programmé ; vide refusé ; déjà parti refusé ; refus de la base traduit ; le texte modifié est celui qui part et celui affiché', async ({ browser, org }) => {
    const { missionId, accountId } = await workspace(org);
    const msgSeq = await seedSeq(org.orgId, org.owner.userId, {
      name: `Journal message ui-1 ${rand()}`,
      projectId: missionId,
      steps: [{ action_type: 'message', message_template: 'Bonjour modèle', delay_days: 0 }, { action_type: 'message', message_template: 'Relance modèle', delay_days: 3 }],
    });
    const inmailSeq = await seedSeq(org.orgId, org.owner.userId, {
      name: `Journal inmail ui-1 ${rand()}`,
      projectId: missionId,
      steps: [{ action_type: 'inmail', subject_template: 'Objet modèle', message_template: 'Message modèle InMail', delay_days: 0 }],
    });
    const in5min = new Date(Date.now() + 5 * 60_000).toISOString();
    const marc = await seedEnrollment(org.orgId, msgSeq.id, org.owner.userId, accountId, { profile_name: 'Marc Message', job_id: missionId });
    const ines = await seedEnrollment(org.orgId, inmailSeq.id, org.owner.userId, accountId, { profile_name: 'Inès Inmail', job_id: missionId });
    const sam = await seedEnrollment(org.orgId, msgSeq.id, org.owner.userId, accountId, { profile_name: 'Sam Envoi', job_id: missionId });
    const marcExec = await seedExecution(org.orgId, marc.enrollmentId, msgSeq.stepIds[0], 0, { scheduled_at: in5min });
    const inesExec = await seedExecution(org.orgId, ines.enrollmentId, inmailSeq.stepIds[0], 0, { scheduled_at: in5min });
    const samExec = await seedExecution(org.orgId, sam.enrollmentId, msgSeq.stepIds[0], 0, { scheduled_at: in5min });

    const { page } = await openAs(browser, org.owner, [{ id: accountId }]);
    await openOutreach(page, missionId, msgSeq.name);
    const sheet = await openJournal(page);
    const editDialog = page.getByRole('dialog', { name: 'Modifier le message planifié' });

    // InMail : objet vide refusé, puis objet et message enregistrés.
    let row = await journalRow(sheet, 'Inès Inmail');
    await row.getByRole('button', { name: 'Modifier', exact: true }).click();
    await expect(editDialog.getByLabel('Objet')).toHaveValue('Objet modèle');
    await editDialog.getByLabel('Objet').fill('');
    await editDialog.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(toast(page, "L'objet ne peut pas être vide pour un InMail ou un e-mail")).toBeVisible();
    expect((await executionRow(inesExec)).final_subject).toBeNull();
    await editDialog.getByLabel('Objet').fill('Objet corrigé');
    await editDialog.getByLabel('Message').fill('');
    await editDialog.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(toast(page, 'Le message ne peut pas être vide')).toBeVisible();
    await editDialog.getByLabel('Message').fill('InMail corrigé dans le Journal');
    await editDialog.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(toast(page, 'Message mis à jour')).toBeVisible();
    expect(await executionRow(inesExec)).toMatchObject({ final_subject: 'Objet corrigé', final_message: 'InMail corrigé dans le Journal', status: 'scheduled' });

    // Message déjà en cours d'envoi entre l'ouverture et l'enregistrement : 0 ligne.
    row = await journalRow(sheet, 'Sam Envoi');
    await row.getByRole('button', { name: 'Modifier', exact: true }).click();
    await admin().from('sequence_step_executions').update({ status: 'sending' }).eq('id', samExec);
    await editDialog.getByLabel('Message').fill('Trop tard');
    await editDialog.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(toast(page, "Ce message est déjà en cours d'envoi ou envoyé : modification impossible.")).toBeVisible();
    expect((await executionRow(samExec)).final_message, 'final_message inchangé').toBeNull();
    // Ramené hors de portée du moteur (aucun envoi pour ce témoin).
    await admin().from('sequence_step_executions').update({ status: 'cancelled' }).eq('id', samExec);

    // Refus de la base (HINT d'un déclencheur) : phrase traduite, pas de « réessayez ».
    row = await journalRow(sheet, 'Marc Message');
    await page.route('**/rest/v1/sequence_step_executions**', async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      return route.fulfill({
        status: 400,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ code: 'P0001', message: 'refused', details: null, hint: 'EXECUTION_NOT_SCHEDULED' }),
      });
    });
    await row.getByRole('button', { name: 'Modifier', exact: true }).click();
    await editDialog.getByLabel('Message').fill('Refusé par la base');
    await editDialog.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(toast(page, 'Seul un message encore programmé peut être modifié.')).toBeVisible();
    expect((await executionRow(marcExec)).final_message).toBeNull();
    await page.unroute('**/rest/v1/sequence_step_executions**');
    await editDialog.getByRole('button', { name: 'Annuler' }).click();

    // Correction enregistrée, puis envoyée par le moteur.
    const corrected = `Texte corrigé dans le Journal ${rand()}`;
    row = await journalRow(sheet, 'Marc Message');
    await row.getByRole('button', { name: 'Modifier', exact: true }).click();
    await editDialog.getByLabel('Message').fill(corrected);
    await editDialog.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(editDialog).toBeHidden();
    await expect.poll(async () => (await executionRow(marcExec)).final_message, { timeout: 15_000 }).toBe(corrected);
    row = await journalRow(sheet, 'Marc Message');
    await expect(row.getByText('Message modifié', { exact: true })).toBeVisible();
    await expect(row.getByText(corrected)).toBeVisible();

    // Échue maintenant (en dernier), puis un cycle du moteur.
    await admin().from('sequence_step_executions').update({ status: 'cancelled' }).eq('id', inesExec);
    await admin().from('sequence_step_executions').update({ scheduled_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', marcExec);
    await runCycle({ force: true });
    await expect.poll(() => sentTexts(accountId), { timeout: 30_000 }).toContain(corrected);
    const sent = await executionRow(marcExec);
    expect(sent.status).toBe('sent');
    expect(sent.final_message).toBe(corrected);
    await sheet.getByRole('button', { name: 'Rafraîchir les activités' }).click();
    // Le Journal affiche l'étape « Envoyé » avec le texte parti.
    row = await journalRow(sheet, 'Marc Message', 'Envoyé');
    await expect(row.getByText(corrected)).toBeVisible();
  });

  // journal-ne-pas-envoyer-etape
  test('@critical « Ne pas envoyer cette étape » passe par skip_execution et l\'étape ne part jamais ; masqué pour un candidat en pause ; 409 « candidat non actif » affiche la phrase du serveur', async ({ browser, org }) => {
    const { missionId, accountId } = await workspace(org);
    const seq = await seedSeq(org.orgId, org.owner.userId, {
      name: `Journal saut ui-1 ${rand()}`,
      projectId: missionId,
      steps: [{ action_type: 'message', message_template: `Étape à ne pas envoyer ${rand()}`, delay_days: 0 }, { action_type: 'message', message_template: 'Relance', delay_days: 1 }],
    });
    const [s0] = seq.stepIds;
    const { data: stepRow } = await admin().from('sequence_steps').select('message_template').eq('id', s0).single();
    const skippedText = stepRow!.message_template as string;
    const in1h = new Date(Date.now() + HOUR).toISOString();
    const camille = await seedEnrollment(org.orgId, seq.id, org.owner.userId, accountId, { profile_name: 'Camille Saut', job_id: missionId });
    const paula = await seedEnrollment(org.orgId, seq.id, org.owner.userId, accountId, { profile_name: 'Paula Pause', job_id: missionId, status: 'paused', pause_reason: 'manual' });
    const remi = await seedEnrollment(org.orgId, seq.id, org.owner.userId, accountId, { profile_name: 'Rémi Repondu', job_id: missionId });
    const camilleExec = await seedExecution(org.orgId, camille.enrollmentId, s0, 0, { scheduled_at: in1h });
    await seedExecution(org.orgId, paula.enrollmentId, s0, 0, { scheduled_at: in1h });
    const remiExec = await seedExecution(org.orgId, remi.enrollmentId, s0, 0, { scheduled_at: in1h });
    // Séquence désactivée : l'étape de Denis est retenue.
    const offSeq = await seedSeq(org.orgId, org.owner.userId, { name: `Journal désactivée ui-1 ${rand()}`, projectId: missionId, isActive: false });
    const denis = await seedEnrollment(org.orgId, offSeq.id, org.owner.userId, accountId, { profile_name: 'Denis Desactive', job_id: missionId });
    await seedExecution(org.orgId, denis.enrollmentId, offSeq.stepIds[0], 0, { scheduled_at: in1h });

    const { page } = await openAs(browser, org.owner, [{ id: accountId }]);
    const skipCalls: Array<Record<string, unknown>> = [];
    page.on('request', (req) => {
      if (req.url().includes('/functions/v1/process-sequences') && req.method() === 'POST') {
        const body = req.postDataJSON() as Record<string, unknown>;
        if (body.action === 'skip_execution') skipCalls.push(body);
      }
    });
    await openOutreach(page, missionId, seq.name);
    const sheet = await openJournal(page);

    // Candidat en pause : étape retenue, pas d'action.
    let row = await journalRow(sheet, 'Paula Pause');
    await expect(sheet.getByRole('button', { name: /^Paula Pause/ })).toContainText('En pause');
    await expect(row.getByRole('button', { name: 'Ne pas envoyer cette étape' })).toHaveCount(0);
    row = await journalRow(sheet, 'Denis Desactive');
    await expect(row.getByText("Séquence désactivée : ne partira pas tant qu'elle n'est pas réactivée.")).toBeVisible();
    await expect(row.getByRole('button', { name: 'Ne pas envoyer cette étape' })).toHaveCount(0);

    // Camille : l'étape est sautée par le serveur, la suivante est planifiée.
    row = await journalRow(sheet, 'Camille Saut');
    await row.getByRole('button', { name: 'Ne pas envoyer cette étape' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Ne pas envoyer cette étape ?' });
    await confirm.getByRole('button', { name: 'Ne pas envoyer', exact: true }).click();
    await expect(toast(page, 'Camille Saut ne recevra pas cette étape')).toBeVisible({ timeout: 20_000 });
    expect(skipCalls.map((b) => b.execution_id)).toContain(camilleExec);
    expect((await executionRow(camilleExec)).status).toBe('skipped');
    let execs = await executionRows(camille.enrollmentId);
    const next = execs.filter((e) => e.step_id === seq.stepIds[1]);
    expect(next.length, 'étape suivante planifiée').toBe(1);
    expect(ms(next[0].scheduled_at)).toBeGreaterThan(Date.now() + 12 * HOUR);

    // Deux cycles du moteur : l'étape sautée n'est ni replanifiée ni envoyée.
    await runCycle({ force: true });
    await runCycle({ force: true });
    execs = await executionRows(camille.enrollmentId);
    expect(execs.filter((e) => e.step_id === s0).map((e) => e.status), 'aucune nouvelle exécution de l\'étape sautée').toEqual(['skipped']);
    expect((await sentTexts(accountId)).filter((t) => t.includes(skippedText.slice(0, 20))), 'rien n\'est parti').toEqual([]);

    // Rémi répond entre l'affichage et le clic : refus 409, phrase du serveur.
    row = await journalRow(sheet, 'Rémi Repondu');
    await admin().from('sequence_enrollments').update({ status: 'replied', replied_at: new Date().toISOString() }).eq('id', remi.enrollmentId);
    await row.getByRole('button', { name: 'Ne pas envoyer cette étape' }).click();
    await page.getByRole('alertdialog', { name: 'Ne pas envoyer cette étape ?' }).getByRole('button', { name: 'Ne pas envoyer', exact: true }).click();
    const refusal = toast(page, "Ce candidat n'est plus actif dans la séquence : reprenez-le avant de sauter une étape.");
    await expect(refusal).toBeVisible({ timeout: 20_000 });
    await expect(refusal).not.toContainText(/Réessayez/i);
    expect((await executionRow(remiExec)).status, 'étape de Rémi inchangée').toBe('scheduled');
    await admin().from('sequence_step_executions').update({ status: 'cancelled' }).eq('enrollment_id', remi.enrollmentId);
  });

  // journal-ne-pas-envoyer-etape (D3 : collaborateur)
  test('@critical Journal d\'un collaborateur : action masquée sur le candidat d\'un collègue, et un refus 403 affiche la phrase du serveur sans inviter à réessayer', async ({ browser, org }) => {
    const { missionId, accountId } = await workspace(org);
    const collab = await seedTeammate(org, 'collaborator', 'Chloé Collaboratrice');
    await admin().from('mission_team').insert({ project_id: missionId, user_id: collab.user.userId, role: 'sourcer' });
    const seq = await seedSeq(org.orgId, collab.user.userId, { name: `Journal collab ui-1 ${rand()}`, projectId: missionId });
    const [s0] = seq.stepIds;
    const alice = await seedEnrollment(org.orgId, seq.id, org.owner.userId, accountId, { profile_name: 'Alice Collegue', job_id: missionId });
    const bruno = await seedEnrollment(org.orgId, seq.id, collab.user.userId, collab.accountId, { profile_name: 'Bruno Mien', job_id: missionId });
    await seedExecution(org.orgId, alice.enrollmentId, s0, 0);
    const brunoExec = await seedExecution(org.orgId, bruno.enrollmentId, s0, 0);

    const { page } = await openAs(browser, collab.user, [{ id: collab.accountId }]);
    await openOutreach(page, missionId, seq.name);
    const sheet = await openJournal(page);
    let row = await journalRow(sheet, 'Alice Collegue');
    await expect(row.getByRole('button', { name: 'Ne pas envoyer cette étape' }), 'masqué sur le candidat d\'un collègue').toHaveCount(0);

    // Bruno passe à un collègue entre l'affichage et le clic : le serveur refuse (403).
    row = await journalRow(sheet, 'Bruno Mien');
    await expect(row.getByRole('button', { name: 'Ne pas envoyer cette étape' })).toBeVisible();
    // Reprise complète par le propriétaire : auteur ET compte d'envoi (le sien). Changer l'auteur seul, en laissant
    // le compte relié du collaborateur, est refusé par la garde SEQ-043 (migration 20260928140415).
    const { error: handoverError } = await admin().from('sequence_enrollments')
      .update({ created_by: org.owner.userId, account_id: accountId }).eq('id', bruno.enrollmentId);
    expect(handoverError, handoverError?.message).toBeNull();
    await row.getByRole('button', { name: 'Ne pas envoyer cette étape' }).click();
    await page.getByRole('alertdialog', { name: 'Ne pas envoyer cette étape ?' }).getByRole('button', { name: 'Ne pas envoyer', exact: true }).click();
    const refusal = toast(page, 'Vous ne pouvez agir que sur les candidats que vous avez inscrits.');
    await expect(refusal).toBeVisible({ timeout: 20_000 });
    await expect(refusal).not.toContainText(/Réessayez/i);
    expect((await executionRow(brunoExec)).status).toBe('scheduled');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Liste des séquences
// ═══════════════════════════════════════════════════════════════════════════

/** Séquence inactive de la mission et deux candidats en pause « séquence désactivée », étapes dans 2 h et 5 h. */
async function inactiveSequenceWithPauses(org: { orgId: string; owner: TestUser }, missionId: string, accountId: string, label: string) {
  const seq = await seedSeq(org.orgId, org.owner.userId, { name: `${label} ${rand()}`, projectId: missionId, isActive: false });
  const enrollments = [];
  for (const [name, hours] of [['Alice Reprise', 2], ['Bruno Reprise', 5]] as const) {
    const e = await seedEnrollment(org.orgId, seq.id, org.owner.userId, accountId, { profile_name: name, status: 'paused', pause_reason: 'sequence_inactive' });
    const scheduledAt = new Date(Date.now() + hours * HOUR).toISOString();
    await seedExecution(org.orgId, e.enrollmentId, seq.stepIds[0], 0, { scheduled_at: scheduledAt });
    enrollments.push({ ...e, scheduledAt });
  }
  return { ...seq, enrollments };
}

test.describe('Liste des séquences', () => {
  // liste-desactiver-jamais-de-faux-succes
  test('désactiver n\'annonce jamais de succès sans preuve : sans candidat, pas de dialogue ; candidats restés actifs ; refus silencieux ; comptage en échec', async ({ browser, org }) => {
    const { missionId, accountId } = await workspace(org);
    const empty = await seedSeq(org.orgId, org.owner.userId, { name: `Sans candidat ui-1 ${rand()}`, projectId: missionId });
    const busy = await seedSeq(org.orgId, org.owner.userId, { name: `Avec candidat ui-1 ${rand()}`, projectId: missionId });
    const refused = await seedSeq(org.orgId, org.owner.userId, { name: `Refus ui-1 ${rand()}`, projectId: missionId });
    const countFail = await seedSeq(org.orgId, org.owner.userId, { name: `Comptage ui-1 ${rand()}`, projectId: missionId });
    const busyEnrollment = await seedEnrollment(org.orgId, busy.id, org.owner.userId, accountId, { profile_name: 'Alice Active' });
    await seedExecution(org.orgId, busyEnrollment.enrollmentId, busy.stepIds[0], 0);

    const { page } = await openAs(browser, org.owner, [{ id: accountId }]);
    await openOutreach(page, missionId, empty.name);

    // (a) Aucun candidat en cours : pas de dialogue, désactivée avec preuve.
    await page.getByRole('switch', { name: `Mettre en pause la séquence ${empty.name}` }).click();
    await expect(toast(page, /Séquence désactivée\. Aucun candidat n.était en cours\./)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(await sequenceActive(empty.id)).toBe(false);

    // (b) Un candidat reste actif au recomptage : la séquence reste active et le dit.
    let patched = false;
    await page.route('**/rest/v1/sequence_enrollments**', async (route) => {
      const req = route.request();
      if (!req.url().includes(busy.id)) return route.fallback();
      if (req.method() === 'PATCH') { patched = true; return route.fallback(); }
      if (req.method() === 'HEAD' && patched) {
        const real = await route.fetch();
        return route.fulfill({ response: real, headers: { ...real.headers(), 'content-range': '*/1' } });
      }
      return route.fallback();
    });
    await page.getByRole('switch', { name: `Mettre en pause la séquence ${busy.name}` }).click();
    await page.getByRole('alertdialog', { name: 'Désactiver cette séquence ?' }).getByRole('button', { name: 'Désactiver', exact: true }).click();
    const stillActive = toast(page, 'La séquence reste active');
    await expect(stillActive).toBeVisible({ timeout: 15_000 });
    await expect(stillActive).toHaveAttribute('data-type', 'error');
    await expect(stillActive.getByRole('button', { name: 'Voir les inscrits' })).toBeVisible();
    expect(await sequenceActive(busy.id), 'la séquence reste active').toBe(true);
    await page.unroute('**/rest/v1/sequence_enrollments**');

    // (c) L'interrupteur est refusé en silence (0 ligne) : « Désactivation impossible ».
    await page.route('**/rest/v1/outreach_sequences**', async (route) => {
      const req = route.request();
      if (req.method() === 'PATCH' && req.url().includes(refused.id)) {
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' });
      }
      return route.fallback();
    });
    await page.getByRole('switch', { name: `Mettre en pause la séquence ${refused.name}` }).click();
    await expect(toast(page, 'Désactivation impossible')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('switch', { name: `Mettre en pause la séquence ${refused.name}` })).toBeChecked();
    expect(await sequenceActive(refused.id)).toBe(true);
    await page.unroute('**/rest/v1/outreach_sequences**');

    // (d) Le comptage des candidats en cours échoue : aucune écriture.
    const writes: string[] = [];
    await page.route('**/rest/v1/sequence_enrollments**', async (route) => {
      const req = route.request();
      if (!req.url().includes(countFail.id)) return route.fallback();
      if (req.method() === 'HEAD') return route.fulfill({ status: 500, headers: { 'access-control-allow-origin': '*' }, body: '' });
      if (req.method() === 'PATCH') writes.push(req.url());
      return route.fallback();
    });
    page.on('request', (req) => { if (req.method() === 'PATCH' && req.url().includes(countFail.id)) writes.push(req.url()); });
    await page.getByRole('switch', { name: `Mettre en pause la séquence ${countFail.name}` }).click();
    await expect(toast(page, /Les candidats en cours n.ont pas pu être comptés/)).toBeVisible({ timeout: 15_000 });
    expect(writes, 'aucune écriture').toEqual([]);
    expect(await sequenceActive(countFail.id)).toBe(true);
  });

  // liste-reactiver-reprise-par-tours-et-echecs
  test('réactiver rappelle la reprise tant qu\'elle progresse puis donne un seul bilan ; échec du premier appel ; reste constant ; pauses inexpliquées au recomptage', async ({ browser, org }) => {
    const { missionId, accountId } = await workspace(org);
    const rounds = await inactiveSequenceWithPauses(org, missionId, accountId, 'Par tours ui-1');
    const failing = await inactiveSequenceWithPauses(org, missionId, accountId, 'Echec reprise ui-1');
    const stuck = await inactiveSequenceWithPauses(org, missionId, accountId, 'Reste constant ui-1');
    const unexplained = await inactiveSequenceWithPauses(org, missionId, accountId, 'Inexpliquee ui-1');
    const { page } = await openAs(browser, org.owner, [{ id: accountId }]);

    /** Réponses de resume_enrollments pour une séquence : 'real+30' (vrai appel, reste 30), objet figé ou statut d'erreur. */
    const scriptResume = async (sequenceId: string, plan: Array<'real+30' | { status: number; body: Record<string, unknown> }>) => {
      const calls: number[] = [];
      await page.route('**/functions/v1/process-sequences', async (route) => {
        const req = route.request();
        if (req.method() !== 'POST') return route.fallback();
        const body = req.postDataJSON() as Record<string, unknown>;
        if (body.action !== 'resume_enrollments' || body.sequence_id !== sequenceId) return route.fallback();
        calls.push(Date.now());
        const step = plan[Math.min(calls.length - 1, plan.length - 1)];
        if (step === 'real+30') {
          const real = await route.fetch();
          const json = (await real.json()) as Record<string, unknown>;
          return route.fulfill({ response: real, json: { ...json, remaining: 30 } });
        }
        await new Promise((r) => setTimeout(r, 1_500));
        return route.fulfill({ status: step.status, contentType: 'application/json', body: JSON.stringify(step.body) });
      });
      return calls;
    };
    const activate = async (name: string) => {
      await page.getByRole('switch', { name: `Activer la séquence ${name}` }).click();
      const confirm = page.getByRole('alertdialog', { name: 'Réactiver cette séquence ?' });
      await expect(confirm).toContainText('2 candidats en pause reprendront.');
      await confirm.getByRole('button', { name: 'Réactiver', exact: true }).click();
    };
    const zeroCounts = { resumed: 0, nothing_to_resume: 0, account_unlinked: 0, not_paused: 0, error: 0 };

    // 1. Reste de 30 puis 0 : deux appels, progression affichée, un seul bilan de succès.
    await openOutreach(page, missionId, rounds.name);
    let calls = await scriptResume(rounds.id, ['real+30', { status: 200, body: { success: true, results: [], counts: zeroCounts, remaining: 0 } }]);
    await activate(rounds.name);
    await expect(toast(page, 'Reprise en cours : 30 candidats encore à reprendre…')).toBeVisible({ timeout: 15_000 });
    const done = toast(page, 'Séquence réactivée. 2 candidats repris.');
    await expect(done).toBeVisible({ timeout: 20_000 });
    await expect(done).toHaveAttribute('data-type', 'success');
    expect(calls.length, 'resume_enrollments rappelé tant qu\'il reste des candidats').toBe(2);
    for (const e of rounds.enrollments) expect((await enrollmentState(e.enrollmentId)).status).toBe('active');
    await page.unroute('**/functions/v1/process-sequences');

    // 2. Premier appel en échec : séquence active, candidats toujours en pause, le toast le dit.
    await openOutreach(page, missionId, failing.name);
    calls = await scriptResume(failing.id, [{ status: 500, body: { success: false, error: 'Erreur serveur' } }]);
    await activate(failing.name);
    const failed = toast(page, /La séquence est réactivée, mais les candidats en pause n.ont pas pu reprendre/);
    await expect(failed).toBeVisible({ timeout: 20_000 });
    await expect(failed).toHaveAttribute('data-type', 'error');
    expect(await sequenceActive(failing.id)).toBe(true);
    for (const e of failing.enrollments) expect(await enrollmentState(e.enrollmentId)).toMatchObject({ status: 'paused', pause_reason: 'sequence_inactive' });
    expect(calls.length).toBe(1);
    await page.unroute('**/functions/v1/process-sequences');

    // 3. Reste constant : arrêt au deuxième tour, avertissement « pour l'instant » et « Voir les inscrits ».
    await openOutreach(page, missionId, stuck.name);
    calls = await scriptResume(stuck.id, ['real+30', { status: 200, body: { success: true, results: [], counts: zeroCounts, remaining: 30 } }]);
    await activate(stuck.name);
    const partial = toast(page, /Séquence réactivée : 2 candidats repris pour l.instant/);
    await expect(partial).toBeVisible({ timeout: 20_000 });
    await expect(partial).toHaveAttribute('data-type', 'warning');
    await expect(partial.getByRole('button', { name: 'Voir les inscrits' })).toBeVisible();
    expect(calls.length, 'arrêt dès que le reste ne diminue plus').toBe(2);
    await page.unroute('**/functions/v1/process-sequences');

    // 4. Bilan « 2 repris » mais les pauses sont toujours là au recomptage : jamais de succès.
    await openOutreach(page, missionId, unexplained.name);
    calls = await scriptResume(unexplained.id, [{ status: 200, body: { success: true, counts: { ...zeroCounts, resumed: 2 }, remaining: 0 } }]);
    await activate(unexplained.name);
    const warn = toast(page, 'Séquence réactivée : 2 candidats repris');
    await expect(warn).toBeVisible({ timeout: 20_000 });
    await expect(warn).toHaveAttribute('data-type', 'warning');
    await expect(warn).toContainText('2 candidats restent en pause sans avoir été repris');
    await expect(toast(page, 'Séquence réactivée. 2 candidats repris.')).toHaveCount(0);
  });

  // liste-activer-refuse-plan-gratuit
  test('offre gratuite : activer est refusé avec « Voir les plans » vers /pricing, sans écriture ni reprise ; désactiver reste possible', async ({ browser, org }) => {
    const { missionId, accountId } = await workspace(org, 'free');
    const inactive = await seedSeq(org.orgId, org.owner.userId, { name: `Inactive gratuit ui-1 ${rand()}`, projectId: missionId, isActive: false });
    const paused = await seedEnrollment(org.orgId, inactive.id, org.owner.userId, accountId, { profile_name: 'Alice Pause', status: 'paused', pause_reason: 'sequence_inactive' });
    await seedExecution(org.orgId, paused.enrollmentId, inactive.stepIds[0], 0);
    const active = await seedSeq(org.orgId, org.owner.userId, { name: `Active gratuit ui-1 ${rand()}`, projectId: missionId, isActive: true });

    const { page } = await openAs(browser, org.owner, [{ id: accountId }]);
    const sideEffects: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      if (req.method() === 'PATCH' && url.includes('/rest/v1/outreach_sequences') && url.includes(inactive.id)) sideEffects.push('patch');
      if (url.includes('/functions/v1/process-sequences') && req.method() === 'POST' && (req.postData() ?? '').includes('resume_enrollments')) sideEffects.push('resume');
    });
    const planLoaded = page.waitForResponse((r) => r.url().includes('/rpc/get_subscription_state'), { timeout: 30_000 });
    await openOutreach(page, missionId, inactive.name);
    await planLoaded;

    await page.getByRole('switch', { name: `Activer la séquence ${inactive.name}` }).click();
    const refusal = toast(page, "L'envoi de séquences nécessite un abonnement");
    await expect(refusal).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(sideEffects, 'ni écriture ni reprise').toEqual([]);
    expect(await sequenceActive(inactive.id)).toBe(false);
    expect((await enrollmentState(paused.enrollmentId)).status).toBe('paused');

    // Désactivation d'une séquence active de la même organisation : possible.
    await page.getByRole('switch', { name: `Mettre en pause la séquence ${active.name}` }).click();
    await expect(toast(page, /Séquence désactivée\. Aucun candidat n.était en cours\./)).toBeVisible({ timeout: 15_000 });
    expect(await sequenceActive(active.id)).toBe(false);

    // Page rechargée : un seul toast, son bouton « Voir les plans » mène aux offres.
    await openOutreach(page, missionId, inactive.name);
    await page.getByRole('switch', { name: `Activer la séquence ${inactive.name}` }).click();
    await toast(page, "L'envoi de séquences nécessite un abonnement").getByRole('button', { name: 'Voir les plans' }).click();
    await expect(page).toHaveURL(/\/pricing/);
  });

  // liste-reactivation-collaborateur-partielle
  test('un collaborateur qui réactive sa séquence ne reprend que ses candidats ; ceux des autres membres restent en pause et le dialogue comme le toast le disent', async ({ browser, org }) => {
    const { missionId, accountId } = await workspace(org);
    const collab = await seedTeammate(org, 'collaborator', 'Chloé Collaboratrice');
    await admin().from('mission_team').insert({ project_id: missionId, user_id: collab.user.userId, role: 'sourcer' });
    const seq = await seedSeq(org.orgId, collab.user.userId, { name: `Collab reprise ui-1 ${rand()}`, projectId: missionId, isActive: false });
    const mine = await seedEnrollment(org.orgId, seq.id, collab.user.userId, collab.accountId, { profile_name: 'Bruno Mien', status: 'paused', pause_reason: 'sequence_inactive' });
    const theirs = await seedEnrollment(org.orgId, seq.id, org.owner.userId, accountId, { profile_name: 'Alice Collegue', status: 'paused', pause_reason: 'sequence_inactive' });
    await seedExecution(org.orgId, mine.enrollmentId, seq.stepIds[0], 0);
    await seedExecution(org.orgId, theirs.enrollmentId, seq.stepIds[0], 0);

    const { page } = await openAs(browser, collab.user, [{ id: collab.accountId }]);
    await openOutreach(page, missionId, seq.name);
    await page.getByRole('switch', { name: `Activer la séquence ${seq.name}` }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Réactiver cette séquence ?' });
    await expect(confirm).toContainText('1 candidat en pause reprendra.');
    await expect(confirm).toContainText(/1 candidat inscrit par\s+d’autres membres restera en pause/);
    await confirm.getByRole('button', { name: 'Réactiver', exact: true }).click();

    const result = toast(page, 'Séquence réactivée : 1 candidat repris');
    await expect(result).toBeVisible({ timeout: 20_000 });
    await expect(result).toHaveAttribute('data-type', 'warning');
    await expect(result).toContainText('1 candidat inscrit par d’autres membres reste en pause');
    expect(await enrollmentState(mine.enrollmentId)).toMatchObject({ status: 'active', pause_reason: null });
    expect(await enrollmentState(theirs.enrollmentId), 'le candidat du propriétaire reste en pause').toMatchObject({ status: 'paused', pause_reason: 'sequence_inactive' });

    // Variante : aucun candidat à lui dans la séquence, aucune reprise demandée, avertissement.
    const onlyTheirs = await seedSeq(org.orgId, collab.user.userId, { name: `Collab sans candidat ui-1 ${rand()}`, projectId: missionId, isActive: false });
    const owners = await seedEnrollment(org.orgId, onlyTheirs.id, org.owner.userId, accountId, { profile_name: 'Alice Seule', status: 'paused', pause_reason: 'sequence_inactive' });
    await seedExecution(org.orgId, owners.enrollmentId, onlyTheirs.stepIds[0], 0);
    const resumeCalls: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/functions/v1/process-sequences') && (req.postData() ?? '').includes('resume_enrollments')) resumeCalls.push(req.postData() ?? '');
    });
    await openOutreach(page, missionId, onlyTheirs.name);
    await page.getByRole('switch', { name: `Activer la séquence ${onlyTheirs.name}` }).click();
    const warned = toast(page, 'Séquence réactivée');
    await expect(warned).toBeVisible({ timeout: 20_000 });
    await expect(warned).toHaveAttribute('data-type', 'warning');
    await expect(warned).toContainText('1 candidat inscrit par d’autres membres reste en pause');
    expect(resumeCalls, 'aucune reprise demandée').toEqual([]);
    expect(await enrollmentState(owners.enrollmentId)).toMatchObject({ status: 'paused', pause_reason: 'sequence_inactive' });
  });

  // liste-supprimer-confirme-impact-et-preuve
  test('supprimer annonce les inscrits, la séquence partagée et la perte de l\'anti-doublon ; Annuler n\'écrit rien ; un refus silencieux affiche « Suppression impossible »', async ({ browser, org }) => {
    const { missionId, accountId } = await workspace(org);
    const missionSeq = await seedSeq(org.orgId, org.owner.userId, { name: `Mission supprimer ui-1 ${rand()}`, projectId: missionId });
    for (const [name, status] of [['Alice', 'active'], ['Bruno', 'active'], ['Chloé', 'paused']] as const) {
      const e = await seedEnrollment(org.orgId, missionSeq.id, org.owner.userId, accountId, { profile_name: `${name} Suppr`, status, ...(status === 'paused' ? { pause_reason: 'manual' } : {}) });
      await seedExecution(org.orgId, e.enrollmentId, missionSeq.stepIds[0], 0);
    }
    const shared = await seedSeq(org.orgId, org.owner.userId, { name: `Partagee supprimer ui-1 ${rand()}`, projectId: null });
    const { page } = await openAs(browser, org.owner, [{ id: accountId }]);
    await openOutreach(page, missionId, missionSeq.name);
    const deleteDialog = page.getByRole('alertdialog', { name: 'Supprimer cette séquence ?' });

    // Séquence de mission avec inscrits : impact et protection annoncés, Annuler n'écrit rien.
    await page.getByRole('button', { name: `Actions de la séquence ${missionSeq.name}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Supprimer', exact: true }).click();
    await expect(deleteDialog).toContainText(/3 candidats inscrits\s*\(dont 2 en cours d'envoi\)/);
    await expect(deleteDialog).toContainText("Ces candidats ne seront plus signalés comme déjà contactés lors d'une prochaine inscription.");
    await deleteDialog.getByRole('button', { name: 'Annuler' }).click();
    expect(await sequenceActive(missionSeq.id), 'séquence toujours là').toBe(true);

    // Suppression refusée en silence (0 ligne) : la ligne reste.
    await page.route('**/rest/v1/outreach_sequences**', async (route) => {
      const req = route.request();
      if (req.method() === 'DELETE' && req.url().includes(missionSeq.id)) {
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' });
      }
      return route.fallback();
    });
    await page.getByRole('button', { name: `Actions de la séquence ${missionSeq.name}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Supprimer', exact: true }).click();
    await deleteDialog.getByRole('button', { name: 'Supprimer définitivement' }).click();
    await expect(toast(page, 'Suppression impossible')).toBeVisible({ timeout: 15_000 });
    await expect(toast(page, 'Séquence supprimée')).toHaveCount(0);
    await expect(page.getByText(missionSeq.name, { exact: true }).first()).toBeVisible();
    expect(await sequenceActive(missionSeq.id)).toBe(true);
    await page.unroute('**/rest/v1/outreach_sequences**');

    // Séquence partagée sans inscrit : « partagée entre toutes vos missions », puis suppression réelle.
    await page.getByRole('button', { name: `Actions de la séquence ${shared.name}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Supprimer', exact: true }).click();
    await expect(deleteDialog).toContainText('Cette séquence est partagée entre toutes vos missions : elle disparaîtra partout.');
    await deleteDialog.getByRole('button', { name: 'Supprimer définitivement' }).click();
    await expect(toast(page, 'Séquence supprimée')).toBeVisible({ timeout: 15_000 });
    expect(await sequenceActive(shared.id), 'séquence partagée supprimée').toBeUndefined();

    // Suppression réelle de la séquence de mission : inscriptions supprimées avec elle.
    await page.getByRole('button', { name: `Actions de la séquence ${missionSeq.name}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Supprimer', exact: true }).click();
    await deleteDialog.getByRole('button', { name: 'Supprimer définitivement' }).click();
    await expect(toast(page, 'Séquence supprimée').last()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(missionSeq.name, { exact: true })).toHaveCount(0);
    expect(await sequenceActive(missionSeq.id)).toBeUndefined();
    const { count } = await admin().from('sequence_enrollments').select('id', { count: 'exact', head: true }).eq('sequence_id', missionSeq.id);
    expect(count, 'inscriptions supprimées avec la séquence').toBe(0);
  });

  // liste-alertes-envois-bloques
  test('la liste signale les envois bloqués par cause avec l\'action qui débloque, et rien sans ces causes', async ({ browser, org }) => {
    const { missionId, accountId } = await workspace(org);
    const seq = await seedSeq(org.orgId, org.owner.userId, { name: `Alertes ui-1 ${rand()}`, projectId: missionId });
    const calm = await seedEnrollment(org.orgId, seq.id, org.owner.userId, accountId, { profile_name: 'Alice Active' });
    await seedExecution(org.orgId, calm.enrollmentId, seq.stepIds[0], 0);
    const { page } = await openAs(browser, org.owner, [{ id: accountId }]);
    await openOutreach(page, missionId, seq.name);
    const alerts = page.getByRole('status').filter({ hasText: /compte LinkedIn déconnecté|abonnement requis|arrêtée automatiquement/ });
    await expect(alerts, 'aucune alerte sans pause bloquante').toHaveCount(0);

    for (const [name, reason] of [
      ['Bruno Deco', 'account_disconnected'], ['Chloé Deco', 'account_disconnected'],
      ['Denis Abo', 'subscription_required'], ['Emma Auto', 'auto_paused'],
    ] as const) {
      const e = await seedEnrollment(org.orgId, seq.id, org.owner.userId, accountId, { profile_name: name, status: 'paused', pause_reason: reason });
      await seedExecution(org.orgId, e.enrollmentId, seq.stepIds[0], 0);
    }
    await openOutreach(page, missionId, seq.name);
    await expect(alerts).toHaveCount(3);
    const disconnected = page.getByRole('status').filter({ hasText: '2 candidats en pause : compte LinkedIn déconnecté.' });
    await expect(disconnected.getByRole('link', { name: 'Reconnecter' })).toHaveAttribute('href', '/settings/account/connections');
    const subscription = page.getByRole('status').filter({ hasText: 'Envois suspendus : abonnement requis.' });
    await expect(subscription.getByRole('link', { name: 'Voir les offres' })).toHaveAttribute('href', '/pricing');
    const auto = page.getByRole('status').filter({ hasText: `Séquence « ${seq.name} » arrêtée automatiquement après trop d’échecs.` });
    await auto.getByRole('button', { name: 'Voir les erreurs' }).click();
    await expect(page.getByRole('dialog', { name: new RegExp(seq.name, 'i') })).toBeVisible();
  });
});

