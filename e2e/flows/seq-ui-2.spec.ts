/**
 * Lot « ui-2 » du module séquences, côté interface : éditeur (suppression
 * d'étape, modification concurrente, retour sans perte, offre gratuite, types
 * d'étape, repli et fin de séquence), suivi des inscrits (pause et reprise
 * groupées, « Marquer comme ayant répondu », « Relancer »), fiche candidat,
 * inscription depuis le sourcing et InMail groupé.
 *
 * Contrat : CLAUDE.md (« Séquences : règles du moteur et de l'interface ») et
 * docs/audit-2026-09-25-sequences.md (D3, D5, D6 ; SEQ-004, SEQ-026, SEQ-059,
 * SEQ-068, SEQ-071, SEQ-129, SEQ-130, SEQ-134, SEQ-139, SEQ-144, SEQ-150,
 * SEQ-151, SEQ-154, SEQ-176, SEQ-212, SEQ-220, SEQ-221, SEQ-222, SEQ-223).
 *
 * Harnais : stack locale (e2e/local-stack), vraie base et vraies actions
 * serveur de process-sequences (resume_enrollments, re_enroll, mark_replied).
 * Sont simulés dans le navigateur : la liste des comptes LinkedIn du
 * prestataire et le solde InMail (unipile-accounts, actions list et
 * inmail_balance), la recherche LinkedIn, la génération IA des messages. Les
 * pannes (500, 403) des chemins d'erreur sont injectées par page.route. Toutes
 * les exécutions seedées sont planifiées dans le futur : le cycle du moteur
 * lancé par d'autres suites n'a rien à ramasser ici.
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

const EDGE_DEPLOYED = process.env.E2E_EDGE_FUNCTIONS === '1';
test.skip(!EDGE_DEPLOYED, 'stack locale absente (E2E_EDGE_FUNCTIONS=1, voir e2e/local-stack/README.md)');
test.describe.configure({ timeout: 180_000 });

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const rand = () => Math.random().toString(36).slice(2, 10);
const inHours = (h: number) => new Date(Date.now() + h * HOUR).toISOString();

// ─── Nettoyage ──────────────────────────────────────────────────────────────

const contexts: BrowserContext[] = [];
const orgsToDelete: Array<{ org: TestOrg; extra: TestUser[] }> = [];
test.afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close().catch(() => undefined);
  while (orgsToDelete.length) {
    const { org, extra } = orgsToDelete.pop()!;
    await admin().from('job_candidate_status').delete().eq('organization_id', org.orgId);
    await admin().from('inmail_queue').delete().eq('organization_id', org.orgId);
    await deleteOrg(org, extra);
  }
});

// ─── Données ────────────────────────────────────────────────────────────────

interface Workspace {
  org: TestOrg;
  accountId: string;
  missionId: string;
}

/** Cabinet (offre Cabinet par défaut), compte LinkedIn relié au propriétaire, mission. */
async function workspace(label: string, planId = 'cabinet'): Promise<Workspace> {
  const org = await createOrg('agency', label);
  orgsToDelete.push({ org, extra: [] });
  await setOrgPlan(org.orgId, planId);
  const accountId = await seedLinkedInAccount(org.orgId, org.owner.userId, `acc_ui2_${rand()}`, 'OK');
  const missionId = await seedMission(org.orgId, org.owner.userId, { name: `Mission ui-2 ${rand()}` });
  return { org, accountId, missionId };
}

interface SeededSeq {
  id: string;
  name: string;
  steps: Array<{ id: string; step_order: number; action_type: string }>;
}

/**
 * Séquence de la mission : `steps` = lignes de sequence_steps (step_order =
 * index par défaut, un jour de délai, condition « always »).
 */
async function missionSequence(
  ws: Workspace,
  label: string,
  steps: Array<Record<string, unknown>>,
  extra: Record<string, unknown> = {},
): Promise<SeededSeq> {
  const name = `${label} ${rand()}`;
  const { data: seq, error } = await admin()
    .from('outreach_sequences')
    .insert({
      name,
      organization_id: ws.org.orgId,
      created_by: ws.org.owner.userId,
      project_id: ws.missionId,
      is_active: true,
      ...extra,
    })
    .select('id')
    .single();
  if (error || !seq) throw new Error(`missionSequence: ${error?.message}`);
  if (steps.length === 0) return { id: seq.id as string, name, steps: [] };
  const { data: rows, error: stepErr } = await admin()
    .from('sequence_steps')
    .insert(steps.map((s, i) => ({
      sequence_id: seq.id,
      organization_id: ws.org.orgId,
      step_order: i,
      condition_type: 'always',
      delay_days: 1,
      ...s,
    })), { defaultToNull: false })
    .select('id, step_order, action_type');
  if (stepErr || !rows) throw new Error(`missionSequence(étapes): ${stepErr?.message}`);
  const ordered = (rows as SeededSeq['steps']).sort((a, b) => a.step_order - b.step_order);
  return { id: seq.id as string, name, steps: ordered };
}

const messageSteps = (texts: string[]) => texts.map((t) => ({ action_type: 'message', message_template: t }));

/** Inscriptions seedées d'un coup (profils uniques), renvoie leurs ids dans l'ordre. */
async function seedEnrollments(ws: Workspace, seq: SeededSeq, rows: Array<Record<string, unknown>>): Promise<string[]> {
  const payload = rows.map((r, i) => ({
    sequence_id: seq.id,
    organization_id: ws.org.orgId,
    created_by: ws.org.owner.userId,
    profile_id: `ACoAAUI2${rand()}${i}`,
    profile_name: `Candidat ${i + 1}`,
    profile_url: `https://www.linkedin.com/in/ui2-${rand()}`,
    account_id: ws.accountId,
    status: 'active',
    current_step_order: 0,
    user_timezone: 'Europe/Paris',
    ...r,
  }));
  const ids: string[] = [];
  for (let i = 0; i < payload.length; i += 500) {
    const { data, error } = await admin().from('sequence_enrollments')
      // Lignes aux clés hétérogènes : une colonne absente garde sa valeur par défaut.
      .insert(payload.slice(i, i + 500), { defaultToNull: false }).select('id, profile_id');
    if (error || !data) throw new Error(`seedEnrollments: ${error?.message}`);
    const byProfile = new Map((data as Array<{ id: string; profile_id: string }>).map((d) => [d.profile_id, d.id]));
    for (const p of payload.slice(i, i + 500)) ids.push(byProfile.get(p.profile_id as string)!);
  }
  return ids;
}

/** Exécutions seedées (étape `stepIndex`, planifiée dans 26 h par défaut). */
async function seedExecutions(ws: Workspace, seq: SeededSeq, rows: Array<{ enrollmentId: string; stepIndex: number } & Record<string, unknown>>) {
  const payload = rows.map(({ enrollmentId, stepIndex, ...rest }) => ({
    enrollment_id: enrollmentId,
    organization_id: ws.org.orgId,
    step_id: seq.steps[stepIndex].id,
    step_order: seq.steps[stepIndex].step_order,
    status: 'scheduled',
    scheduled_at: inHours(26),
    ...rest,
  }));
  for (let i = 0; i < payload.length; i += 500) {
    const { error } = await admin().from('sequence_step_executions').insert(payload.slice(i, i + 500), { defaultToNull: false });
    if (error) throw new Error(`seedExecutions: ${error.message}`);
  }
}

async function enrollmentsOf(sequenceId: string) {
  const rows: Array<{ id: string; status: string; pause_reason: string | null; profile_id: string; tracking_data: Record<string, unknown> | null; replied_at: string | null }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin()
      .from('sequence_enrollments')
      .select('id, status, pause_reason, profile_id, tracking_data, replied_at')
      .eq('sequence_id', sequenceId)
      .range(from, from + 999);
    if (error) throw new Error(`enrollmentsOf: ${error.message}`);
    rows.push(...((data ?? []) as typeof rows));
    if (!data || data.length < 1000) return rows;
  }
}

async function enrollment(id: string) {
  const { data, error } = await admin()
    .from('sequence_enrollments')
    .select('id, status, pause_reason, tracking_data, replied_at, current_step_order')
    .eq('id', id)
    .single();
  if (error) throw new Error(`enrollment: ${error.message}`);
  return data as { id: string; status: string; pause_reason: string | null; tracking_data: Record<string, unknown> | null; replied_at: string | null; current_step_order: number };
}

async function executionsOf(enrollmentId: string) {
  const { data, error } = await admin()
    .from('sequence_step_executions')
    .select('id, step_id, step_order, status, scheduled_at, skip_reason')
    .eq('enrollment_id', enrollmentId)
    .order('step_order');
  if (error) throw new Error(`executionsOf: ${error.message}`);
  return (data ?? []) as Array<{ id: string; step_id: string; step_order: number; status: string; scheduled_at: string; skip_reason: string | null }>;
}

async function stepsOf(sequenceId: string) {
  const { data, error } = await admin()
    .from('sequence_steps')
    .select('id, step_order, action_type, message_template, ends_sequence, next_step_id, timeout_branch_step_id, timeout_days')
    .eq('sequence_id', sequenceId)
    .order('step_order');
  if (error) throw new Error(`stepsOf: ${error.message}`);
  return (data ?? []) as Array<{ id: string; step_order: number; action_type: string; message_template: string | null; ends_sequence: boolean | null; next_step_id: string | null; timeout_branch_step_id: string | null; timeout_days: number | null }>;
}

async function sequenceRow(id: string) {
  const { data, error } = await admin().from('outreach_sequences').select('id, name, is_active').eq('id', id).single();
  if (error) throw new Error(`sequenceRow: ${error.message}`);
  return data as { id: string; name: string; is_active: boolean };
}

// ─── Navigateur ─────────────────────────────────────────────────────────────

/** Action d'un appel d'edge function (null pour un pré-vol CORS ou un corps non JSON). */
function actionOf(route: Route): string | null {
  try {
    return ((route.request().postDataJSON() as { action?: string } | null)?.action) ?? null;
  } catch {
    return null;
  }
}

/**
 * Page connectée en `user`. Seule l'action `list` de unipile-accounts est
 * simulée (comptes LinkedIn du prestataire) ; tout le reste part vers la stack.
 */
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
  return context.newPage();
}

async function openOutreach(page: Page, missionId: string, sequenceName: string) {
  await page.goto(`/missions/${missionId}?tab=outreach`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(sequenceName, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
}

async function openEnrollmentsPanel(page: Page, sequenceName: string) {
  await page.getByRole('button', { name: `Voir les candidats inscrits à la séquence ${sequenceName}` }).click();
  const panel = page.getByRole('dialog', { name: new RegExp(sequenceName, 'i') });
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Chargement des inscriptions…')).toHaveCount(0, { timeout: 20_000 });
  return panel;
}

async function openEditor(page: Page, sequenceName: string) {
  await page.getByRole('button', { name: `Actions de la séquence ${sequenceName}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Modifier' }).click();
  await expect(page.getByRole('textbox', { name: 'Nom de la séquence *' })).toHaveValue(sequenceName, { timeout: 15_000 });
}

/**
 * Écritures du navigateur sur sequence_step_executions (contrat : une reprise
 * ou une relance passe par l'action serveur, jamais par une réécriture
 * d'exécution depuis le navigateur).
 */
function executionWritesFromBrowser(page: Page): string[] {
  const writes: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/rest/v1/sequence_step_executions') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method())) {
      writes.push(`${req.method()} ${req.url()}`);
    }
  });
  return writes;
}

/** Ferme le menu ouvert (Échap) et attend qu'il ait disparu. */
async function closeMenu(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem')).toHaveCount(0);
}

const toast = (page: Page, text: string | RegExp) => page.locator('[data-sonner-toast]').filter({ hasText: text });

async function save(page: Page) {
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).first().click();
}

const stepHeader = (page: Page, order: number, kind: 'Action' | 'Condition' | 'Attente', label: string) =>
  page.getByRole('button', { name: new RegExp(`Étape ${order}\\s*${kind}\\s*${label}`) });

/** Bouton de suppression de l'étape dépliée (liste). */
async function expandStep(header: Locator) {
  if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click();
  await expect(header).toHaveAttribute('aria-expanded', 'true');
}

// ═══ Suivi des inscrits ═════════════════════════════════════════════════════

test.describe('Suivi des inscrits : actions groupées', () => {
  // panneau-pause-groupee (SEQ-026) : toute la séquence en base, au-delà des 200 lignes chargées.
  test('« Mettre en pause tous les candidats actifs (230) » met en pause les 230 inscriptions en base, étapes gardées', async ({ browser }) => {
    const ws = await workspace('E2E ui-2 pause groupée');
    const seq = await missionSequence(ws, 'Pause groupée ui-2', messageSteps(['Un', 'Deux']));
    const ids = await seedEnrollments(ws, seq, Array.from({ length: 230 }, () => ({})));
    const scheduledAt = inHours(26);
    await seedExecutions(ws, seq, ids.map((enrollmentId) => ({ enrollmentId, stepIndex: 0, scheduled_at: scheduledAt })));

    const page = await openAs(browser, ws.org.owner, [ws.accountId]);
    await openOutreach(page, ws.missionId, seq.name);
    const panel = await openEnrollmentsPanel(page, seq.name);
    await panel.getByRole('button', { name: 'Mettre en pause tous les candidats actifs (230)' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Mettre en pause tous les candidats actifs (230) ?' });
    await expect(confirm).toContainText('y compris ceux qui ne sont pas affichés');
    await confirm.getByRole('button', { name: 'Mettre en pause', exact: true }).click();

    await expect(toast(page, '230 candidats mis en pause')).toBeVisible({ timeout: 30_000 });
    await expect(toast(page, 'encore en cours')).toHaveCount(0);

    const rows = await enrollmentsOf(seq.id);
    expect(rows.filter((r) => r.status === 'active'), 'plus aucun candidat en cours').toHaveLength(0);
    expect(rows.filter((r) => r.status === 'paused' && r.pause_reason === 'manual')).toHaveLength(230);
    // Contrat : une pause n'annule aucune exécution et garde sa date.
    const { count: stillScheduled } = await admin()
      .from('sequence_step_executions')
      .select('id', { count: 'exact', head: true })
      .in('enrollment_id', ids.slice(0, 100))
      .eq('status', 'scheduled')
      .eq('scheduled_at', scheduledAt);
    expect(stillScheduled, 'étapes prévues intactes').toBe(100);
    await expect(panel.getByRole('button', { name: /Mettre en pause tous les candidats actifs/ })).toHaveCount(0);
  });

  // panneau-pause-groupee : le recomptage qui trouve encore des candidats en cours n'annonce jamais un succès.
  test('pause groupée : s\'il reste des candidats en cours au recomptage, le bilan est une erreur « …, 3 encore en cours »', async ({ browser }) => {
    const ws = await workspace('E2E ui-2 pause recompte');
    const seq = await missionSequence(ws, 'Pause recompte ui-2', messageSteps(['Un']));
    const ids = await seedEnrollments(ws, seq, [{}, {}]);
    await seedExecutions(ws, seq, ids.map((enrollmentId) => ({ enrollmentId, stepIndex: 0 })));

    const page = await openAs(browser, ws.org.owner, [ws.accountId]);
    await openOutreach(page, ws.missionId, seq.name);
    const panel = await openEnrollmentsPanel(page, seq.name);
    await panel.getByRole('button', { name: 'Mettre en pause tous les candidats actifs (2)' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Mettre en pause tous les candidats actifs (2) ?' });
    await expect(confirm).toBeVisible();

    // Recomptage après la pause (HEAD, status=eq.active) : 3 candidats encore
    // en cours (inscrits entre-temps ou hors des droits de l'utilisateur).
    await page.route('**/rest/v1/sequence_enrollments?*', async (route) => {
      const req = route.request();
      if (req.method() !== 'HEAD' || !req.url().includes('status=eq.active')) return route.continue();
      const response = await route.fetch();
      await route.fulfill({ response, headers: { ...response.headers(), 'content-range': '*/3' } });
    });
    await confirm.getByRole('button', { name: 'Mettre en pause', exact: true }).click();

    const failure = toast(page, '2 candidats mis en pause, 3 encore en cours');
    await expect(failure).toBeVisible({ timeout: 20_000 });
    await expect(failure).toContainText('recevront encore des messages');
    await expect(toast(page, /^2 candidats mis en pause$/)).toHaveCount(0);
    expect((await enrollmentsOf(seq.id)).map((r) => r.status)).toEqual(['paused', 'paused']);
  });

  // panneau-reprise-groupee (SEQ-004, D6) : pauses manuelles de toute la séquence, lots de 25, bilan exact.
  test('« Reprendre tous les candidats en pause (32) » : 2 appels (25 + 7), bilan exact (28 repris, 2 comptes non reliés, 1 sans étape, 1 effacement RGPD en erreur), la pause « limite atteinte » n\'est pas touchée', async ({ browser }) => {
    const ws = await workspace('E2E ui-2 reprise groupée');
    const seq = await missionSequence(ws, 'Reprise groupée ui-2', messageSteps(['Un', 'Deux']));
    // Compte d'un ancien membre : plus aucune liaison dans l'organisation.
    const unlinkedAccount = `acc_ui2_parti_${rand()}`;
    // Pauses une par une et pauses de séquence restées alors que la séquence est active (D6).
    const linked = await seedEnrollments(ws, seq, [
      ...Array.from({ length: 26 }, () => ({ status: 'paused', pause_reason: 'manual' })),
      { status: 'paused', pause_reason: 'sequence_inactive' },
      { status: 'paused', pause_reason: 'auto_paused' },
    ]);
    const unlinked = await seedEnrollments(ws, seq, [
      { status: 'paused', pause_reason: 'manual', account_id: unlinkedAccount },
      { status: 'paused', pause_reason: 'manual', account_id: unlinkedAccount },
    ]);
    const quota = await seedEnrollments(ws, seq, [{ status: 'paused', pause_reason: 'quota_reached', profile_name: 'Quota Atteint' }]);
    // Toutes ses étapes déjà envoyées : plus rien à reprendre.
    const [finished] = await seedEnrollments(ws, seq, [{ status: 'paused', pause_reason: 'manual', profile_name: 'Fini Toutes', current_step_order: 2 }]);
    // Effacement RGPD (D5) : jamais repris, compté en erreur.
    const [erased] = await seedEnrollments(ws, seq, [{ status: 'paused', pause_reason: 'manual', profile_name: 'Eva Effacée', tracking_data: { gdpr_erased_at: '2026-09-21T10:00:00.000Z' } }]);
    const all = [...linked, ...unlinked, ...quota, erased];
    const scheduledAt = inHours(30);
    await seedExecutions(ws, seq, all.map((enrollmentId) => ({ enrollmentId, stepIndex: 1, scheduled_at: scheduledAt })));
    const sentAt = new Date(Date.now() - 2 * DAY).toISOString();
    await seedExecutions(ws, seq, [0, 1].map((stepIndex) => ({ enrollmentId: finished, stepIndex, status: 'sent', scheduled_at: sentAt, executed_at: sentAt })));

    const page = await openAs(browser, ws.org.owner, [ws.accountId]);
    const writes = executionWritesFromBrowser(page);
    const calls: number[] = [];
    page.on('request', (req) => {
      if (!req.url().includes('/functions/v1/process-sequences') || req.method() !== 'POST') return;
      try {
        const body = req.postDataJSON() as { action?: string; enrollment_ids?: string[] };
        if (body?.action === 'resume_enrollments') calls.push(body.enrollment_ids?.length ?? 0);
      } catch { /* pré-vol */ }
    });
    await openOutreach(page, ws.missionId, seq.name);
    const panel = await openEnrollmentsPanel(page, seq.name);
    await panel.getByRole('button', { name: 'Reprendre tous les candidats en pause (32)' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Reprendre tous les candidats en pause (32) ?' });
    await expect(confirm).toContainText('limite d’envoi');
    await confirm.getByRole('button', { name: 'Reprendre', exact: true }).click();

    const summary = toast(page, '28 candidats repris');
    await expect(summary).toBeVisible({ timeout: 60_000 });
    await expect(summary).toContainText('2 restent en pause : compte LinkedIn qui n’est plus relié');
    await expect(summary).toContainText('1 n’avait plus d’étape à envoyer');
    await expect(summary).toContainText('1 en erreur');
    expect(calls, 'reprise serveur par lots de 25').toEqual([25, 7]);
    expect(writes, 'aucune exécution réécrite par le navigateur').toEqual([]);

    const rows = new Map((await enrollmentsOf(seq.id)).map((r) => [r.id, r]));
    for (const id of linked) expect(rows.get(id)).toMatchObject({ status: 'active', pause_reason: null });
    for (const id of unlinked) expect(rows.get(id), 'compte non relié : reste en pause').toMatchObject({ status: 'paused', pause_reason: 'manual' });
    expect(rows.get(quota[0]), 'pause « limite atteinte » hors cible').toMatchObject({ status: 'paused', pause_reason: 'quota_reached' });
    expect(rows.get(erased), 'effacement RGPD : jamais repris (D5)').toMatchObject({ status: 'paused' });
    expect(rows.get(finished)?.status, 'plus aucune étape : pas de retour en cours').not.toBe('active');
    // Reprise sans rafale : l'étape prévue garde sa date.
    const { data: kept } = await admin().from('sequence_step_executions').select('status, scheduled_at').in('enrollment_id', linked);
    for (const k of kept ?? []) {
      expect(k.status).toBe('scheduled');
      expect(new Date(k.scheduled_at as string).getTime()).toBe(new Date(scheduledAt).getTime());
    }
  });

  // panneau-reprise-groupee : un appel refusé laisse le reste en pause et le dit (« non traités »).
  test('reprise groupée : le 2e appel refusé laisse 5 candidats en pause et le bilan annonce « 5 non traités »', async ({ browser }) => {
    const ws = await workspace('E2E ui-2 reprise interrompue');
    const seq = await missionSequence(ws, 'Reprise interrompue ui-2', messageSteps(['Un', 'Deux']));
    const ids = await seedEnrollments(ws, seq, Array.from({ length: 30 }, () => ({ status: 'paused', pause_reason: 'manual' })));
    await seedExecutions(ws, seq, ids.map((enrollmentId) => ({ enrollmentId, stepIndex: 1 })));

    const page = await openAs(browser, ws.org.owner, [ws.accountId]);
    let resumeCalls = 0;
    await page.route('**/functions/v1/process-sequences', async (route) => {
      if (actionOf(route) !== 'resume_enrollments') return route.continue();
      resumeCalls += 1;
      if (resumeCalls < 2) return route.continue();
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Serveur indisponible.' }) });
    });
    await openOutreach(page, ws.missionId, seq.name);
    const panel = await openEnrollmentsPanel(page, seq.name);
    await panel.getByRole('button', { name: 'Reprendre tous les candidats en pause (30)' }).click();
    await page.getByRole('alertdialog', { name: 'Reprendre tous les candidats en pause (30) ?' }).getByRole('button', { name: 'Reprendre', exact: true }).click();

    const summary = toast(page, '25 candidats repris');
    await expect(summary).toBeVisible({ timeout: 60_000 });
    await expect(summary).toContainText('5 non traités');
    const rows = await enrollmentsOf(seq.id);
    expect(rows.filter((r) => r.status === 'active')).toHaveLength(25);
    expect(rows.filter((r) => r.status === 'paused' && r.pause_reason === 'manual'), 'le lot refusé reste en pause').toHaveLength(5);
  });

  // panneau-pause-groupee + panneau-reprise-groupee (D3) : masquées au collaborateur, même sur sa propre séquence.
  test('collaborateur : ni pause groupée ni reprise groupée, même sur sa propre séquence et ses propres candidats', async ({ browser }) => {
    const ws = await workspace('E2E ui-2 collaborateur');
    const collab = await addMember(ws.org.orgId, 'collaborator', 'collab');
    orgsToDelete[orgsToDelete.length - 1].extra.push(collab);
    await admin().from('mission_team').insert({ project_id: ws.missionId, user_id: collab.userId, role: 'sourcer' });
    const collabAccount = await seedLinkedInAccount(ws.org.orgId, collab.userId, `acc_ui2_collab_${rand()}`, 'OK');
    const seq = await missionSequence(ws, 'Collaborateur ui-2', messageSteps(['Un', 'Deux']), { created_by: collab.userId });
    const mine = { ...ws, accountId: collabAccount, org: { ...ws.org, owner: collab } };
    const ids = await seedEnrollments(mine, seq, [
      { profile_name: 'Ana Active' },
      { profile_name: 'Paul Pause', status: 'paused', pause_reason: 'manual' },
    ]);
    await seedExecutions(ws, seq, ids.map((enrollmentId) => ({ enrollmentId, stepIndex: 1 })));

    const page = await openAs(browser, collab, [collabAccount]);
    await openOutreach(page, ws.missionId, seq.name);
    const panel = await openEnrollmentsPanel(page, seq.name);
    await expect(panel.getByText('Ana Active', { exact: true })).toBeVisible();
    await expect(panel.getByText('Paul Pause', { exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: /Mettre en pause tous les candidats actifs/ })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: /Reprendre tous les candidats en pause/ })).toHaveCount(0);
    // Contrôle positif : ses propres candidats gardent leurs actions individuelles.
    await panel.getByRole('button', { name: 'Actions pour Paul Pause' }).click();
    await expect(page.getByRole('menuitem', { name: 'Reprendre la séquence' })).toBeVisible();
    await closeMenu(page);
  });
});

test.describe('Suivi des inscrits : réponse et relance', () => {
  // panneau-marquer-repondu (SEQ-221, SEQ-212, SEQ-071)
  test('« Marquer comme ayant répondu » clôt l\'inscription, annule toutes ses étapes en attente sauf l\'envoi en cours, arrête l\'autre séquence du candidat et passe le pipeline à « Répondu »', async ({ browser }) => {
    const ws = await workspace('E2E ui-2 marquer répondu');
    const seq1 = await missionSequence(ws, 'Réponse ui-2 A', messageSteps(['Un', 'Deux', 'Trois', 'Quatre']));
    const seq2 = await missionSequence(ws, 'Réponse ui-2 B', messageSteps(['Un', 'Deux']));
    const profileId = `ACoAAUI2rep${rand()}`;
    const name = 'Denise Roy';
    const [e1] = await seedEnrollments(ws, seq1, [{ profile_id: profileId, profile_name: name, job_id: `project:${ws.missionId}` }]);
    const [e2] = await seedEnrollments(ws, seq2, [{ profile_id: profileId, profile_name: name, status: 'paused', pause_reason: 'manual' }]);
    const { error: jcsErr } = await admin().from('job_candidate_status').insert({
      job_id: `project:${ws.missionId}`,
      project_id: ws.missionId,
      candidate_id: profileId,
      candidate_name: name,
      status: 'contacted',
      created_by: ws.org.owner.userId,
      organization_id: ws.org.orgId,
    });
    expect(jcsErr, jcsErr?.message).toBeNull();
    await seedExecutions(ws, seq1, [
      { enrollmentId: e1, stepIndex: 0, status: 'sending', scheduled_at: new Date(Date.now() - 60_000).toISOString() },
      { enrollmentId: e1, stepIndex: 1, status: 'waiting_event', scheduled_at: inHours(40) },
      { enrollmentId: e1, stepIndex: 2, status: 'quota_blocked', scheduled_at: inHours(50) },
      { enrollmentId: e1, stepIndex: 3, status: 'scheduled', scheduled_at: inHours(60) },
    ]);
    await seedExecutions(ws, seq2, [{ enrollmentId: e2, stepIndex: 1, status: 'scheduled', scheduled_at: inHours(30) }]);

    const page = await openAs(browser, ws.org.owner, [ws.accountId]);
    await openOutreach(page, ws.missionId, seq1.name);
    const panel = await openEnrollmentsPanel(page, seq1.name);
    await panel.getByRole('button', { name: `Actions pour ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Marquer comme ayant répondu' }).click();
    const confirm = page.getByRole('alertdialog', { name: `Marquer ${name} comme ayant répondu ?` });
    await expect(confirm).toContainText('Ses autres séquences encore en cours ou en pause seront aussi arrêtées.');
    await confirm.getByRole('button', { name: 'Marquer comme ayant répondu' }).click();

    const done = toast(page, `Réponse enregistrée pour ${name}`);
    await expect(done).toBeVisible({ timeout: 20_000 });
    await expect(done).toContainText('Son autre séquence en cours ou en pause a été arrêtée.');

    const row1 = await enrollment(e1);
    expect(row1.status).toBe('replied');
    expect(row1.replied_at).not.toBeNull();
    const execs1 = await executionsOf(e1);
    expect(execs1.find((x) => x.step_order === 0)?.status, 'envoi en cours jamais annulé').toBe('sending');
    expect(execs1.filter((x) => x.step_order > 0).map((x) => x.status), 'attente, blocage de quota et étape prévue annulés')
      .toEqual(['cancelled', 'cancelled', 'cancelled']);
    expect((await enrollment(e2)).status, 'autre séquence du candidat arrêtée').toBe('stopped');
    expect((await executionsOf(e2)).map((x) => x.status)).toEqual(['cancelled']);
    const { data: jcs } = await admin().from('job_candidate_status').select('status').eq('organization_id', ws.org.orgId).eq('candidate_id', profileId);
    expect(jcs?.map((r) => r.status), 'pipeline de la mission passé « Répondu »').toEqual(['replied']);
  });

  // panneau-marquer-repondu : inscription close entre l'ouverture du dialogue et le clic → « Rien n'a changé ».
  test('« Marquer comme ayant répondu » sur une inscription close entre-temps affiche « Rien n\'a changé » sans rien arrêter de plus', async ({ browser }) => {
    const ws = await workspace('E2E ui-2 déjà close');
    const seq = await missionSequence(ws, 'Déjà close ui-2', messageSteps(['Un', 'Deux']));
    const name = 'Éric Blanc';
    const [e1] = await seedEnrollments(ws, seq, [{ profile_name: name }]);
    await seedExecutions(ws, seq, [{ enrollmentId: e1, stepIndex: 1 }]);

    const page = await openAs(browser, ws.org.owner, [ws.accountId]);
    await openOutreach(page, ws.missionId, seq.name);
    const panel = await openEnrollmentsPanel(page, seq.name);
    await panel.getByRole('button', { name: `Actions pour ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Marquer comme ayant répondu' }).click();
    const confirm = page.getByRole('alertdialog', { name: `Marquer ${name} comme ayant répondu ?` });
    await expect(confirm).toBeVisible();
    // La réponse arrive par LinkedIn pendant que le dialogue est ouvert.
    const repliedAt = new Date(Date.now() - 5 * 60_000).toISOString();
    await admin().from('sequence_enrollments').update({ status: 'replied', replied_at: repliedAt }).eq('id', e1);
    await confirm.getByRole('button', { name: 'Marquer comme ayant répondu' }).click();

    await expect(toast(page, `Rien n’a changé : la séquence de ${name} était déjà close.`)).toBeVisible({ timeout: 20_000 });
    await expect(toast(page, `Réponse enregistrée pour ${name}`)).toHaveCount(0);
    const row = await enrollment(e1);
    expect(row.status).toBe('replied');
    expect(new Date(row.replied_at!).getTime(), 'date de réponse d\'origine gardée').toBe(new Date(repliedAt).getTime());
  });

  // panneau-relancer-inscription-close (SEQ-004, SEQ-220, D5)
  test('« Relancer depuis l\'étape suivante » : proposé seulement pour une inscription close, jamais en pause ni après effacement RGPD ; le dialogue nomme l\'action et la date de réponse ; re_enroll garde la date de réponse', async ({ browser }) => {
    const ws = await workspace('E2E ui-2 relancer');
    const seq = await missionSequence(ws, 'Relance ui-2', messageSteps(['Un', 'Deux', 'Trois']));
    const repliedAt = '2026-09-20T10:00:00.000Z';
    const [alice, bruno, chloe, denis] = await seedEnrollments(ws, seq, [
      { profile_name: 'Alice Relance', status: 'replied', replied_at: repliedAt, current_step_order: 1 },
      { profile_name: 'Bruno Pause', status: 'paused', pause_reason: 'manual' },
      { profile_name: 'Chloé Effacée', status: 'completed', tracking_data: { gdpr_erased_at: '2026-09-21T10:00:00.000Z' } },
      { profile_name: 'Denis Fini', status: 'replied', replied_at: repliedAt, current_step_order: 3 },
    ]);
    const sentAt = '2026-09-19T09:00:00.000Z';
    await seedExecutions(ws, seq, [
      { enrollmentId: alice, stepIndex: 0, status: 'sent', scheduled_at: sentAt, executed_at: sentAt },
      { enrollmentId: alice, stepIndex: 1, status: 'cancelled', skip_reason: 'Réponse reçue', scheduled_at: '2026-09-22T09:00:00.000Z' },
      { enrollmentId: bruno, stepIndex: 1, status: 'scheduled' },
      { enrollmentId: denis, stepIndex: 0, status: 'sent', scheduled_at: sentAt, executed_at: sentAt },
      { enrollmentId: denis, stepIndex: 1, status: 'sent', scheduled_at: sentAt, executed_at: sentAt },
      { enrollmentId: denis, stepIndex: 2, status: 'sent', scheduled_at: sentAt, executed_at: sentAt },
    ]);

    const page = await openAs(browser, ws.org.owner, [ws.accountId]);
    const writes = executionWritesFromBrowser(page);
    await openOutreach(page, ws.missionId, seq.name);
    const panel = await openEnrollmentsPanel(page, seq.name);

    // En pause : « Reprendre », jamais « Relancer ».
    await panel.getByRole('button', { name: 'Actions pour Bruno Pause' }).click();
    await expect(page.getByRole('menuitem', { name: 'Reprendre la séquence' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Relancer/ })).toHaveCount(0);
    await closeMenu(page);
    // Effacement RGPD : ni reprise ni relance (D5).
    await panel.getByRole('button', { name: 'Actions pour Chloé Effacée' }).click();
    await expect(page.getByRole('menuitem', { name: 'Voir sur LinkedIn' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Relancer/ })).toHaveCount(0);
    await closeMenu(page);

    // A répondu après l'étape 1 : le dialogue nomme la prochaine action et la date de réponse.
    await panel.getByRole('button', { name: 'Actions pour Alice Relance' }).click();
    await page.getByRole('menuitem', { name: 'Relancer depuis l’étape suivante' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Relancer Alice Relance ?' });
    await expect(confirm).toContainText('prochaine action estimée : Message LinkedIn');
    await expect(confirm).toContainText('Alice Relance a répondu le 20 septembre 2026');
    await confirm.getByRole('button', { name: 'Relancer', exact: true }).click();
    await expect(toast(page, 'Séquence relancée pour Alice Relance')).toBeVisible({ timeout: 20_000 });

    const a = await enrollment(alice);
    expect(a.status).toBe('active');
    expect(new Date(String(a.tracking_data?.previous_replied_at)).getTime(), 'date de réponse gardée (SEQ-220)').toBe(new Date(repliedAt).getTime());
    const next = (await executionsOf(alice)).filter((x) => x.step_order === 1 && x.status === 'scheduled');
    expect(next, 'étape 2 programmée').toHaveLength(1);
    expect(new Date(next[0].scheduled_at).getTime(), 'selon son délai, jamais tout de suite').toBeGreaterThan(Date.now() + HOUR);

    // Toutes les étapes faites : « Rien à relancer », statut d'origine remis.
    await panel.getByRole('button', { name: 'Actions pour Denis Fini' }).click();
    await page.getByRole('menuitem', { name: 'Relancer depuis l’étape suivante' }).click();
    await page.getByRole('alertdialog', { name: 'Relancer Denis Fini ?' }).getByRole('button', { name: 'Relancer', exact: true }).click();
    await expect(toast(page, 'Rien à relancer : cette séquence est terminée pour Denis Fini')).toBeVisible({ timeout: 20_000 });
    expect((await enrollment(denis)).status).toBe('replied');
    expect((await enrollment(bruno)).status).toBe('paused');
    expect((await enrollment(chloe)).status).toBe('completed');
    expect(writes, 're_enroll serveur : aucune exécution réécrite par le navigateur').toEqual([]);
  });
});

// ═══ Éditeur ════════════════════════════════════════════════════════════════

test.describe('Éditeur : modification d\'une séquence en cours', () => {
  // editeur-suppression-etape-historique-et-candidats-en-cours (SEQ-059, SEQ-150)
  test('bandeau des candidats en cours ; une étape déjà envoyée n\'est pas supprimée (dialogue, étape gardée, vérification impossible = refus) ; supprimer une étape sans historique demande la confirmation de l\'annulation de ses envois prévus', async ({ browser }) => {
    const ws = await workspace('E2E ui-2 suppression étape');
    const seq = await missionSequence(ws, 'Suppression ui-2', messageSteps(['Un', 'Deux', 'Trois']));
    const [x] = await seedEnrollments(ws, seq, [{ profile_name: 'Xavier Encours', current_step_order: 2 }]);
    const yesterday = new Date(Date.now() - DAY).toISOString();
    await seedExecutions(ws, seq, [
      { enrollmentId: x, stepIndex: 0, status: 'sent', scheduled_at: yesterday, executed_at: yesterday },
      { enrollmentId: x, stepIndex: 1, status: 'sent', scheduled_at: yesterday, executed_at: yesterday },
      { enrollmentId: x, stepIndex: 2, status: 'scheduled', scheduled_at: inHours(26) },
    ]);

    const page = await openAs(browser, ws.org.owner, [ws.accountId]);
    await openOutreach(page, ws.missionId, seq.name);
    await openEditor(page, seq.name);
    await expect(page.getByRole('note').filter({ hasText: '1 candidat est en cours dans cette séquence.' })).toBeVisible();

    // Étape 2 déjà envoyée : expliqué, gardée.
    await page.getByRole('button', { name: 'Supprimer l\'étape 2', exact: true }).click();
    const history = page.getByRole('alertdialog', { name: 'Supprimer l\'étape 2 ?' });
    await expect(history).toContainText('Elle a déjà été envoyée ou traitée pour des candidats de cette séquence (1 fois)');
    await history.getByRole('button', { name: 'Garder l\'étape' }).click();
    await expect(page.getByText('3 étape(s) configurée(s)')).toBeVisible();

    // Vérification de l'historique impossible : refus, étape gardée.
    await page.route('**/rest/v1/sequence_step_executions?*', (route) => (
      route.request().method() === 'HEAD'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' })
        : route.continue()
    ));
    await page.getByRole('button', { name: 'Supprimer l\'étape 2', exact: true }).click();
    await expect(toast(page, 'Impossible de vérifier l\'historique de cette étape')).toBeVisible();
    await expect(page.getByText('3 étape(s) configurée(s)')).toBeVisible();
    await page.unroute('**/rest/v1/sequence_step_executions?*');

    // Étape 3 sans historique, mais un envoi prévu : supprimée à l'écran, confirmation à l'enregistrement.
    await page.getByRole('button', { name: 'Supprimer l\'étape 3', exact: true }).click();
    await expect(page.getByText('2 étape(s) configurée(s)')).toBeVisible();
    await save(page);
    const removal = page.getByRole('alertdialog', { name: 'Supprimer cette étape ?' });
    await expect(removal).toContainText('1 candidat est en cours dans cette séquence.');
    await expect(removal).toContainText('Les envois prévus sur cette étape seront annulés.');
    await removal.getByRole('button', { name: 'Supprimer et enregistrer' }).click();
    await expect(toast(page, 'Séquence mise à jour')).toBeVisible({ timeout: 20_000 });

    const steps = await stepsOf(seq.id);
    expect(steps.map((s) => s.message_template), 'étape 3 supprimée, étape 2 gardée').toEqual(['Un', 'Deux']);
    const execs = await executionsOf(x);
    expect(execs.filter((e) => e.step_id === seq.steps[2].id), 'envoi prévu de l\'étape supprimée annulé').toHaveLength(0);
    expect(execs.map((e) => e.status), 'historique conservé').toEqual(['sent', 'sent']);
  });

  // editeur-suppression-etape-historique-et-candidats-en-cours : candidats en cours inconnus = confirmation demandée aussi.
  test('nombre de candidats en cours illisible à l\'ouverture : supprimer une étape enregistrée demande quand même la confirmation', async ({ browser }) => {
    const ws = await workspace('E2E ui-2 compte inconnu');
    const seq = await missionSequence(ws, 'Compte inconnu ui-2', messageSteps(['Un', 'Deux']));
    const page = await openAs(browser, ws.org.owner, [ws.accountId]);
    await openOutreach(page, ws.missionId, seq.name);
    await page.route('**/rest/v1/sequence_enrollments?*', (route) => (
      route.request().method() === 'HEAD' && route.request().url().includes(`sequence_id=eq.${seq.id}`) && route.request().url().includes('status=eq.active')
        ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' })
        : route.continue()
    ));
    await openEditor(page, seq.name);
    await page.unroute('**/rest/v1/sequence_enrollments?*');
    await expect(page.getByRole('note').filter({ hasText: 'en cours dans cette séquence' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Supprimer l\'étape 2', exact: true }).click();
    await expect(page.getByText('1 étape(s) configurée(s)')).toBeVisible();
    await save(page);
    const removal = page.getByRole('alertdialog', { name: 'Supprimer cette étape ?' });
    await expect(removal).toContainText('Les envois prévus sur cette étape seront annulés.');
    await removal.getByRole('button', { name: 'Supprimer et enregistrer' }).click();
    await expect(toast(page, 'Séquence mise à jour')).toBeVisible({ timeout: 20_000 });
    expect((await stepsOf(seq.id)).map((s) => s.message_template)).toEqual(['Un']);
  });

  // editeur-suppression-etape-historique-et-candidats-en-cours : refus serveur STEP_HAS_HISTORY nommé par type et ancien numéro.
  test('étape envoyée pendant la modification : le refus serveur nomme « Message LinkedIn » (étape 2 avant vos modifications), rien n\'est supprimé', async ({ browser }) => {
    const ws = await workspace('E2E ui-2 refus historique');
    const seq = await missionSequence(ws, 'Refus historique ui-2', [
      { action_type: 'message', message_template: 'Un', delay_days: 0 },
      { action_type: 'message', message_template: 'Deux' },
      { action_type: 'inmail', subject_template: 'Une mission', message_template: 'Trois' },
    ]);
    const [x] = await seedEnrollments(ws, seq, [{ profile_name: 'Yves Course', current_step_order: 1 }]);
    const yesterday = new Date(Date.now() - DAY).toISOString();
    await seedExecutions(ws, seq, [
      { enrollmentId: x, stepIndex: 0, status: 'sent', scheduled_at: yesterday, executed_at: yesterday },
      { enrollmentId: x, stepIndex: 1, status: 'scheduled', scheduled_at: inHours(26) },
    ]);

    const page = await openAs(browser, ws.org.owner, [ws.accountId]);
    await openOutreach(page, ws.missionId, seq.name);
    await openEditor(page, seq.name);
    // Sans historique au clic : supprimée à l'écran, l'étape 3 devient l'étape 2.
    await page.getByRole('button', { name: 'Supprimer l\'étape 2', exact: true }).click();
    await expect(page.getByText('2 étape(s) configurée(s)')).toBeVisible();
    await expect(stepHeader(page, 2, 'Action', 'InMail')).toBeVisible();
    // Le moteur l'envoie entre-temps.
    const { error } = await admin().from('sequence_step_executions')
      .update({ status: 'sent', executed_at: new Date().toISOString() })
      .eq('enrollment_id', x).eq('step_order', 1);
    expect(error, error?.message).toBeNull();

    await save(page);
    await page.getByRole('alertdialog', { name: 'Supprimer cette étape ?' }).getByRole('button', { name: 'Supprimer et enregistrer' }).click();
    const refusal = toast(page, 'Erreur à l\'enregistrement');
    await expect(refusal).toBeVisible({ timeout: 20_000 });
    await expect(refusal).toContainText('Cette étape a déjà été envoyée à des candidats : elle ne peut pas être supprimée.');
    await expect(refusal).toContainText('Étape concernée : « Message LinkedIn » (étape 2 avant vos modifications).');
    await expect(page.getByRole('textbox', { name: 'Nom de la séquence *' }), 'éditeur resté ouvert').toBeVisible();
    expect((await stepsOf(seq.id)).map((s) => s.message_template), 'aucune étape supprimée').toEqual(['Un', 'Deux', 'Trois']);
  });

  // editeur-modification-concurrente-refusee (SEQ-151)
  test('étape ajoutée par un collègue pendant la modification : enregistrement refusé sans rien écrire ; lecture des étapes impossible = éditeur non ouvert', async ({ browser }) => {
    const ws = await workspace('E2E ui-2 concurrence');
    const seq = await missionSequence(ws, 'Concurrence ui-2', messageSteps(['Un', 'Deux']));

    const page = await openAs(browser, ws.org.owner, [ws.accountId]);
    await openOutreach(page, ws.missionId, seq.name);
    await openEditor(page, seq.name);
    // Un collègue ajoute une étape depuis son propre éditeur.
    const { error } = await admin().from('sequence_steps').insert({
      sequence_id: seq.id, organization_id: ws.org.orgId, step_order: 2, action_type: 'message', message_template: 'Trois', condition_type: 'always', delay_days: 1,
    });
    expect(error, error?.message).toBeNull();

    await page.getByRole('textbox', { name: 'Nom de la séquence *' }).fill(`${seq.name} renommée`);
    await expandStep(stepHeader(page, 1, 'Action', 'Message LinkedIn'));
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Un modifié');
    await save(page);
    const refusal = toast(page, 'Erreur à l\'enregistrement');
    await expect(refusal).toBeVisible({ timeout: 20_000 });
    await expect(refusal).toContainText('Cette séquence a été modifiée par un collègue depuis son ouverture. Rouvrez-la avant d’enregistrer.');
    await expect(page.getByRole('textbox', { name: 'Nom de la séquence *' }), 'éditeur resté ouvert').toHaveValue(`${seq.name} renommée`);
    expect((await stepsOf(seq.id)).map((s) => s.message_template), 'étape du collègue gardée, texte inchangé').toEqual(['Un', 'Deux', 'Trois']);
    expect((await sequenceRow(seq.id)).name, 'nom inchangé').toBe(seq.name);

    // Fermer sans enregistrer, puis rouvrir avec une lecture des étapes en échec.
    await page.getByRole('button', { name: 'Retour à la liste' }).click();
    await page.getByRole('alertdialog', { name: 'Quitter sans enregistrer ?' }).getByRole('button', { name: 'Quitter sans enregistrer' }).click();
    await expect(page.getByRole('textbox', { name: 'Nom de la séquence *' })).toHaveCount(0);
    await page.route('**/rest/v1/sequence_steps?*', (route) => (
      route.request().method() === 'GET' && route.request().url().includes(`sequence_id=eq.${seq.id}`)
        ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' })
        : route.continue()
    ));
    await page.getByRole('button', { name: `Actions de la séquence ${seq.name}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Modifier' }).click();
    await expect(toast(page, 'Impossible de charger le détail de cette séquence')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Nom de la séquence *' }), 'éditeur non ouvert').toHaveCount(0);
  });

  // editeur-retour-sans-perte (SEQ-068)
  test('« Retour » sans changement ferme ; avec un changement, « Quitter sans enregistrer ? » (continuer garde l\'éditeur, quitter n\'écrit rien) ; un rechargement déclenche l\'avertissement du navigateur', async ({ browser }) => {
    const ws = await workspace('E2E ui-2 retour');
    const seq = await missionSequence(ws, 'Retour ui-2', messageSteps(['Un']));

    const page = await openAs(browser, ws.org.owner, [ws.accountId]);
    await openOutreach(page, ws.missionId, seq.name);
    const nameField = page.getByRole('textbox', { name: 'Nom de la séquence *' });

    await openEditor(page, seq.name);
    await page.getByRole('button', { name: 'Retour à la liste' }).click();
    await expect(nameField, 'sans changement : fermé directement').toHaveCount(0);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);

    await openEditor(page, seq.name);
    const renamed = `${seq.name} bis`;
    await nameField.fill(renamed);
    await page.getByRole('button', { name: 'Retour à la liste' }).click();
    const leave = page.getByRole('alertdialog', { name: 'Quitter sans enregistrer ?' });
    await expect(leave).toContainText(`Vos modifications de « ${renamed} » seront perdues.`);
    await leave.getByRole('button', { name: 'Continuer la modification' }).click();
    await expect(nameField).toHaveValue(renamed);
    await page.getByRole('button', { name: 'Retour à la liste' }).click();
    await leave.getByRole('button', { name: 'Quitter sans enregistrer' }).click();
    await expect(nameField).toHaveCount(0);
    expect((await sequenceRow(seq.id)).name, 'rien n\'est écrit').toBe(seq.name);

    // Rechargement avec un changement : avertissement du navigateur.
    await openEditor(page, seq.name);
    await nameField.fill(renamed);
    const dialogPromise = page.waitForEvent('dialog');
    const reload = page.reload({ waitUntil: 'domcontentloaded' });
    const dialog = await dialogPromise;
    expect(dialog.type()).toBe('beforeunload');
    await dialog.accept();
    await reload;
    expect((await sequenceRow(seq.id)).name).toBe(seq.name);
  });
});

test.describe('Éditeur : création, types d\'étape, repli et fin', () => {
  // editeur-plan-gratuit-cree-desactivee (SEQ-154)
  test('offre gratuite : la séquence créée est désactivée, annoncé avant et après l\'enregistrement, sans « Séquence créée »', async ({ browser }) => {
    const ws = await workspace('E2E ui-2 offre gratuite', 'free');
    const name = `Gratuite ui-2 ${rand()}`;
    const page = await openAs(browser, ws.org.owner, [ws.accountId]);
    await page.goto(`/missions/${ws.missionId}?tab=outreach`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Créer une séquence', exact: true }).click({ timeout: 30_000 });
    await page.getByRole('dialog', { name: 'Nouvelle séquence' }).getByRole('button', { name: /Partir de zéro/ }).click();
    await page.getByRole('button', { name: 'Expert', exact: true }).click();
    await expect(page.getByText('L\'envoi de séquences nécessite un abonnement : la séquence sera enregistrée désactivée.')).toBeVisible();
    await page.getByRole('textbox', { name: 'Nom de la séquence *' }).fill(name);
    await page.getByRole('button', { name: /^Message LinkedIn/ }).first().click();
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Bonjour, une mission pourrait vous intéresser.');
    await save(page);

    const warning = toast(page, 'Séquence enregistrée et désactivée : l\'envoi nécessite un abonnement.');
    await expect(warning).toBeVisible({ timeout: 20_000 });
    await expect(warning.getByRole('button', { name: 'Voir les offres' })).toBeVisible();
    await expect(toast(page, 'Séquence créée')).toHaveCount(0);
    const { data: rows } = await admin().from('outreach_sequences').select('id, is_active').eq('organization_id', ws.org.orgId).eq('name', name);
    expect(rows ?? []).toHaveLength(1);
    expect(rows![0].is_active, 'créée désactivée').toBe(false);
    const toggle = page.getByRole('switch', { name: `Activer la séquence ${name}`, exact: true });
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toBeChecked();
    await warning.getByRole('button', { name: 'Voir les offres' }).click();
    await expect(page).toHaveURL(/\/pricing/);
  });

  // editeur-types-etapes-proposes (SEQ-015, SEQ-061, SEQ-067)
  test('le choix d\'étape ne propose que ce que le moteur exécute, selon les étapes précédentes ; « Si rien ne se passe » n\'a que deux choix ; une étape e-mail ou Branchement héritée est signalée', async ({ browser }) => {
    const ws = await workspace('E2E ui-2 types');
    const legacy = await missionSequence(ws, 'Héritée ui-2', [
      { action_type: 'email', subject_template: 'Une mission', message_template: 'Bonjour par e-mail', delay_days: 0 },
      { action_type: 'condition_branch' },
      { action_type: 'message', message_template: 'Bonjour' },
    ]);
    const page = await openAs(browser, ws.org.owner, [ws.accountId]);
    await openOutreach(page, ws.missionId, legacy.name);
    await page.getByRole('button', { name: 'Créer une séquence', exact: true }).click();
    await page.getByRole('dialog', { name: 'Nouvelle séquence' }).getByRole('button', { name: /Partir de zéro/ }).click();
    await page.getByRole('button', { name: 'Expert', exact: true }).click();
    await page.getByRole('textbox', { name: 'Nom de la séquence *' }).fill(`Types ui-2 ${rand()}`);

    const offered = (label: string) => page.getByRole('button', { name: new RegExp(`^${label}`) });
    const openPicker = async () => {
      const opener = page.getByRole('button', { name: 'Ajouter une étape', exact: true });
      if (await opener.isVisible()) await opener.click();
    };
    await expect(page.getByText('Commencer par ajouter une étape')).toBeVisible();
    for (const label of ['Invitation LinkedIn', 'InMail', 'Visite de profil', 'Message LinkedIn', 'Message IA', 'Vérifier la connexion']) {
      await expect(offered(label), `${label} proposé`).toHaveCount(1);
    }
    for (const label of ['E-mail', 'WhatsApp', 'Attendre une visite', 'Branchement', 'Attendre la connexion', 'Attendre une réponse']) {
      await expect(offered(label), `${label} non proposé au départ`).toHaveCount(0);
    }

    // Après une invitation : plus d'invitation, « Attendre la connexion » apparaît.
    await offered('Invitation LinkedIn').click();
    await page.getByRole('textbox', { name: 'Note d\'invitation' }).fill('Bonjour, une mission pourrait vous intéresser.');
    await openPicker();
    await expect(offered('Invitation LinkedIn'), 'une seule invitation').toHaveCount(0);
    await expect(offered('Attendre la connexion')).toHaveCount(1);
    await expect(offered('Attendre une réponse'), 'pas avant un message').toHaveCount(0);
    await offered('Attendre la connexion').click();

    // Après l'attente de connexion : le message est proposé, puis « Attendre une réponse » après lui.
    await openPicker();
    await expect(offered('Attendre la connexion')).toHaveCount(0);
    await offered('Message LinkedIn').click();
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Merci pour la connexion.');
    await openPicker();
    await expect(offered('Attendre une réponse')).toHaveCount(1);
    for (const label of ['E-mail', 'WhatsApp', 'Attendre une visite', 'Branchement']) {
      await expect(offered(label)).toHaveCount(0);
    }

    // « Si rien ne se passe » : jamais « Terminer ».
    await expandStep(stepHeader(page, 2, 'Attente', 'Attendre la connexion'));
    await page.getByRole('combobox', { name: 'Si rien ne se passe' }).click();
    await expect(page.getByRole('option')).toHaveText(["Passer à l'étape suivante", 'Aller à une étape de repli']);
    await page.keyboard.press('Escape');

    // Séquence héritée : l'e-mail et le Branchement sont signalés.
    await page.getByRole('button', { name: 'Retour à la liste' }).click();
    await openEditor(page, legacy.name);
    await expect(page.getByText('Les étapes e-mail ne partent pas encore : elles seront sautées pour tous les candidats.').first()).toBeVisible();
    await expect(page.getByText('Cette étape Branchement ne route rien : la séquence continue dans les deux cas.', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('⚠ Non pris en charge')).toHaveCount(2);
  });

  // editeur-repli-delai-et-fin-de-sequence (SEQ-069, SEQ-160, SEQ-015)
  test('repli au délai dépassé et « Fin de séquence » enregistrés en base se relisent tels quels ; le repli ne propose que les étapes suivantes ; « Passer à l\'étape suivante » efface le repli', async ({ browser }) => {
    const ws = await workspace('E2E ui-2 repli');
    const seq = await missionSequence(ws, 'Repli ui-2', [
      { action_type: 'connection_request', message_template: 'Bonjour', delay_days: 0 },
      { action_type: 'wait_connection', wait_for_event: 'connection_accepted', timeout_days: 5 },
      { action_type: 'message', message_template: 'Merci pour la connexion.', ends_sequence: true },
      { action_type: 'inmail', subject_template: 'Une mission', message_template: 'Je me permets un InMail.' },
    ]);
    await admin().from('sequence_steps').update({ timeout_branch_step_id: seq.steps[3].id }).eq('id', seq.steps[1].id);

    const page = await openAs(browser, ws.org.owner, [ws.accountId]);
    await openOutreach(page, ws.missionId, seq.name);
    await openEditor(page, seq.name);
    await expandStep(stepHeader(page, 2, 'Attente', 'Attendre la connexion'));
    await expect(page.getByRole('combobox', { name: 'Si rien ne se passe' })).toHaveText('Aller à une étape de repli');
    const target = page.getByRole('combobox', { name: 'Étape de repli' });
    await expect(target).toHaveText('Étape 4 — InMail');
    await target.click();
    await expect(page.getByRole('option'), 'jamais une étape antérieure').toHaveText(['Sélectionner...', 'Étape 3 — Message LinkedIn', 'Étape 4 — InMail']);
    await page.keyboard.press('Escape');

    // Réenregistrer sans rien toucher : repli et fin de séquence intacts.
    await save(page);
    await expect(toast(page, 'Séquence mise à jour')).toBeVisible({ timeout: 20_000 });
    let steps = await stepsOf(seq.id);
    expect(steps[1].timeout_branch_step_id).toBe(steps[3].id);
    expect(steps[2].ends_sequence, 'fin de séquence relue et réécrite').toBe(true);
    expect(steps[2].next_step_id).toBeNull();

    // « Passer à l'étape suivante » : le repli est effacé.
    await openEditor(page, seq.name);
    await expandStep(stepHeader(page, 2, 'Attente', 'Attendre la connexion'));
    await page.getByRole('combobox', { name: 'Si rien ne se passe' }).click();
    await page.getByRole('option', { name: "Passer à l'étape suivante", exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Étape de repli' })).toHaveCount(0);
    await save(page);
    // L'étape 4 n'est plus atteinte (l'étape 3 termine la séquence) : signalée, enregistrement confirmé.
    const warnings = page.getByRole('alertdialog', { name: 'Enregistrer malgré ces points ?' });
    await expect(warnings).toBeVisible();
    // Le toast du premier enregistrement peut encore être affiché : on attend la réponse de l'enregistrement.
    const saved = page.waitForResponse((r) => r.url().includes('/rpc/save_sequence_steps'));
    await warnings.getByRole('button', { name: 'Enregistrer quand même' }).click();
    expect((await saved).ok()).toBe(true);
    await expect(toast(page, 'Erreur à l\'enregistrement')).toHaveCount(0);
    steps = await stepsOf(seq.id);
    expect(steps[1].timeout_branch_step_id, 'repli effacé').toBeNull();
    expect(steps[2].ends_sequence, 'fin de séquence gardée').toBe(true);
  });

  // editeur-repli-delai-et-fin-de-sequence (SEQ-015) : « Fin de séquence » réaffichée à l'écran.
  test('« Fin de séquence » enregistrée en base est réaffichée sur l\'étape dans l\'onglet Visuel', async ({ browser }) => {
    const ws = await workspace('E2E ui-2 fin visuel');
    const seq = await missionSequence(ws, 'Fin visuel ui-2', [
      { action_type: 'connection_request', message_template: 'Bonjour', delay_days: 0 },
      { action_type: 'wait_connection', wait_for_event: 'connection_accepted', timeout_days: 5 },
      { action_type: 'message', message_template: 'Merci pour la connexion.', ends_sequence: true },
      { action_type: 'inmail', subject_template: 'Une mission', message_template: 'Je me permets un InMail.' },
    ]);
    await admin().from('sequence_steps').update({ timeout_branch_step_id: seq.steps[3].id }).eq('id', seq.steps[1].id);
    const page = await openAs(browser, ws.org.owner, [ws.accountId]);
    await openOutreach(page, ws.missionId, seq.name);
    await openEditor(page, seq.name);
    await page.getByRole('tab', { name: 'Visuel' }).click();
    const node = page.locator('.react-flow__node').filter({ hasText: 'Étape 3' }).first();
    await expect(node).toBeVisible();
    // Le nœud peut être hors de la partie visible du canevas (un clic tomberait
    // à côté) : sélection au clavier, qui passe par la même ouverture des réglages.
    await node.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Étape 3 · ', { exact: false }).last()).toBeVisible();
    const nextStep = page.getByText('Vers quelle étape aller après celle-ci').locator('xpath=preceding-sibling::*[@role="combobox"][1]');
    await expect(nextStep).toHaveText('Fin de séquence', { timeout: 15_000 });
  });
});

// ═══ Sourcing : inscription et InMail groupé ════════════════════════════════

interface SearchProfile {
  id: string;
  name: string;
  network_distance?: string;
}

function asResult(p: SearchProfile) {
  const [first, ...rest] = p.name.split(' ');
  return {
    first_name: first,
    last_name: rest.join(' '),
    headline: 'Ingénieur backend',
    location: 'Paris, France',
    network_distance: 'SECOND_DEGREE',
    profile_url: `https://www.linkedin.com/in/${p.id.toLowerCase()}`,
    ...p,
  };
}

/**
 * Onglet Sourcing de la mission, connecté en propriétaire : la recherche
 * (simulée) affiche `profiles`. Solde InMail simulé : `inmailBalance` rend les
 * crédits Recruiter au moment de chaque lecture (0 par défaut).
 */
async function openSearchResults(
  browser: Browser,
  ws: Workspace,
  profiles: SearchProfile[],
  opts: { inmailBalance?: () => number } = {},
): Promise<Page> {
  const context = await browser.newContext({ storageState: await storageStateForUser(ws.org.owner), timezoneId: 'Europe/Paris' });
  contexts.push(context);
  const balanceOf = opts.inmailBalance ?? (() => 0);
  await context.route('**/functions/v1/unipile-accounts', async (route) => {
    const action = actionOf(route);
    if (action === 'list') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, accounts: [{ id: ws.accountId, account_status: 'OK', provider: 'LINKEDIN', name: 'E2E LinkedIn' }] }),
      });
    }
    if (action === 'inmail_balance') {
      const recruiter = balanceOf();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, balance: { premium: null, recruiter, sales_navigator: null } }),
      });
    }
    return route.continue();
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

async function selectCandidates(page: Page, names: string[]) {
  for (const name of names) await page.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true }).click();
}

/** « Séquence » puis la séquence : fenêtre d'inscription ouverte. */
async function openEnrollment(page: Page, sequenceName: string): Promise<Locator> {
  await page.getByRole('button', { name: 'Séquence', exact: true }).click();
  await page.getByRole('menuitem', { name: new RegExp(sequenceName) }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: sequenceName });
  await expect(dialog).toBeVisible();
  return dialog;
}

function enrollButton(dialog: Locator, count: number) {
  return dialog.getByRole('button', { name: `Inscrire ${count} candidat${count > 1 ? 's' : ''}`, exact: true }).filter({ visible: true }).first();
}

const previewOutcome = (dialog: Locator) =>
  dialog.getByRole('heading', { name: /candidats? inscrits?|Aucune nouvelle inscription|Aucun candidat inscrit/ });

test.describe('Sourcing : compatibilité et menu Séquence', () => {
  // inscription-compatibilite-candidat-sequence (SEQ-045, SEQ-139) : séquence d'invitation seule.
  test('invitation seule : le candidat déjà en relation et le candidat hors réseau sont exclus (pastille, un seul compteur), « Inclure quand même » les compte, seuls les inclus sont inscrits', async ({ browser }) => {
    const ws = await workspace('E2E ui-2 compat invitation');
    const seq = await missionSequence(ws, 'Invitation seule ui-2', [{ action_type: 'connection_request', message_template: 'Bonjour {{firstName}}' }]);
    const first = { id: `ACoAAUI2F1${rand()}`, name: 'Fanny Relation', network_distance: 'FIRST_DEGREE' };
    const far = { id: `ACoAAUI2OO${rand()}`, name: 'Oscar Lointain', network_distance: 'OUT_OF_NETWORK' };
    const second = { id: `ACoAAUI2S2${rand()}`, name: 'Sarah Second', network_distance: 'SECOND_DEGREE' };
    const page = await openSearchResults(browser, ws, [first, far, second]);
    await selectCandidates(page, [first.name, far.name, second.name]);
    const dialog = await openEnrollment(page, seq.name);

    await expect(dialog.getByText('Déjà en relation : cette séquence ne contient qu\'une invitation, rien ne lui sera envoyé.')).toBeVisible();
    await expect(dialog.getByText('Hors de votre réseau LinkedIn : seul un InMail peut l\'atteindre.')).toBeVisible();
    await expect(dialog.getByText('1 candidat · 1 étape', { exact: true }), 'un seul compteur, sans les exclus').toBeVisible();
    await expect(enrollButton(dialog, 1)).toBeVisible();
    await dialog.getByRole('button', { name: 'Aperçus', exact: true }).click();
    await expect(dialog.getByRole('button', { name: `${first.name}, Incompatible, exclu` })).toBeVisible();
    await expect(dialog.getByRole('button', { name: `${far.name}, Incompatible, exclu` })).toBeVisible();

    const include = dialog.getByRole('checkbox', { name: 'Inclure quand même (2)' });
    await include.check();
    await expect(dialog.getByText('3 candidats · 1 étape', { exact: true })).toBeVisible();
    await expect(enrollButton(dialog, 3)).toBeVisible();
    await include.uncheck();
    await expect(enrollButton(dialog, 1)).toBeVisible();

    await enrollButton(dialog, 1).click();
    await expect(previewOutcome(dialog)).toHaveText('1 candidat inscrit', { timeout: 30_000 });
    const rows = await enrollmentsOf(seq.id);
    expect(rows.map((r) => r.profile_id), 'seul le candidat compatible est inscrit').toEqual([second.id]);
  });

  // inscription-compatibilite-candidat-sequence (SEQ-138) : invitation puis message IA.
  test('invitation puis message IA : le candidat déjà en relation est averti et inclus, le candidat hors réseau exclu n\'est ni généré ni compté dans l\'estimation de crédits', async ({ browser }) => {
    const ws = await workspace('E2E ui-2 compat génération');
    const seq = await missionSequence(ws, 'Invitation et suite ui-2', [
      { action_type: 'connection_request', message_template: 'Bonjour {{firstName}}' },
      { action_type: 'message', message_template: 'Merci pour la connexion {{firstName}}', use_ai_personalization: true },
    ]);
    const first = { id: `ACoAAUI2G1${rand()}`, name: 'Gilles Relation', network_distance: 'FIRST_DEGREE' };
    const far = { id: `ACoAAUI2GO${rand()}`, name: 'Hugo Lointain', network_distance: 'OUT_OF_NETWORK' };
    const second = { id: `ACoAAUI2G2${rand()}`, name: 'Inès Second', network_distance: 'SECOND_DEGREE' };
    const page = await openSearchResults(browser, ws, [first, far, second]);
    const generated: string[] = [];
    await page.route('**/functions/v1/generate-outreach-message', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      generated.push(route.request().postData() ?? '');
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, subject: 'Une mission', message: 'Message IA de test.' }) });
    });
    await selectCandidates(page, [first.name, far.name, second.name]);
    const dialog = await openEnrollment(page, seq.name);

    await expect(dialog.getByText('Déjà en relation : l\'invitation sera sautée, les messages suivants partiront.')).toBeVisible();
    await expect(dialog.getByText('2 candidats · 2 étapes', { exact: true }), 'averti = inclus, hors réseau = exclu').toBeVisible();
    await dialog.getByRole('button', { name: 'Aperçus', exact: true }).click();
    await expect(dialog.getByRole('button', { name: `${far.name}, Incompatible, exclu` })).toBeVisible();
    await expect(dialog.getByRole('button', { name: first.name, exact: true }), 'averti, pas exclu').toBeVisible();

    // Estimation affichée à côté de « Générer tous les aperçus » (candidats inscrits seulement).
    const estimate = dialog.getByRole('button', { name: 'Générer tous les aperçus' }).locator('xpath=following-sibling::span[1]');
    const creditsFor = async () => Number((await estimate.innerText()).replace(/\D/g, ''));
    const twoTargets = await creditsFor();
    const include = dialog.getByRole('checkbox', { name: 'Inclure quand même (1)' });
    await include.check();
    await expect.poll(creditsFor, { message: 'estimation sur 3 candidats' }).toBe(twoTargets / 2 * 3);
    await include.uncheck();
    await expect.poll(creditsFor, { message: 'estimation revenue à 2 candidats' }).toBe(twoTargets);

    await dialog.getByRole('button', { name: 'Générer tous les aperçus' }).click();
    await expect.poll(() => generated.length, { message: 'une génération par candidat inclus' }).toBe(2);
    await page.waitForTimeout(1_500);
    expect(generated, 'jamais de génération pour le candidat exclu').toHaveLength(2);
    expect(generated.some((b) => b.includes(far.id) || b.includes('Hugo')), 'candidat exclu jamais envoyé à la génération').toBe(false);
    expect(generated.some((b) => b.includes(first.id))).toBe(true);
    expect(generated.some((b) => b.includes(second.id))).toBe(true);
  });

  // inscription-sequence-desactivee-et-menu (SEQ-144)
  test('menu Séquence : seules les séquences actives, rechargées à chaque ouverture, recherche, séquence vide refusée, erreur avec « Réessayer » ; séquence désactivée entre l\'ouverture et le clic = aucune inscription', async ({ browser }) => {
    const ws = await workspace('E2E ui-2 menu');
    const active = await missionSequence(ws, 'Active ui-2', messageSteps(['Bonjour {{firstName}}']));
    const inactive = await missionSequence(ws, 'Inactive ui-2', messageSteps(['Bonjour']), { is_active: false });
    const empty = await missionSequence(ws, 'Vide ui-2', []);
    const cand = { id: `ACoAAUI2M${rand()}`, name: 'Martin Menu' };
    const page = await openSearchResults(browser, ws, [cand]);
    await selectCandidates(page, [cand.name]);

    await page.getByRole('button', { name: 'Séquence', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: new RegExp(active.name) })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: new RegExp(empty.name) })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: new RegExp(inactive.name) }), 'séquence désactivée absente').toHaveCount(0);
    await page.getByRole('textbox', { name: 'Rechercher une séquence' }).fill('Vide');
    await expect(page.getByRole('menuitem', { name: new RegExp(active.name) })).toHaveCount(0);
    await page.getByRole('menuitem', { name: new RegExp(empty.name) }).click();
    await expect(toast(page, 'Cette séquence ne contient aucune étape. Ajoutez au moins une étape avant d\'inscrire des candidats.')).toBeVisible();

    // Rechargé à chaque ouverture : une séquence activée ailleurs apparaît.
    await admin().from('outreach_sequences').update({ is_active: true }).eq('id', inactive.id);
    await page.getByRole('button', { name: 'Séquence', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: new RegExp(inactive.name) })).toBeVisible();
    await closeMenu(page);

    // Lecture en échec : message et « Réessayer ».
    await page.route('**/rest/v1/outreach_sequences?*', (route) => (
      route.request().method() === 'GET' && route.request().url().includes('is_active=eq.true')
        ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' })
        : route.continue()
    ));
    await page.getByRole('button', { name: 'Séquence', exact: true }).click();
    await expect(page.getByText('Impossible de charger les séquences')).toBeVisible();
    await page.unroute('**/rest/v1/outreach_sequences?*');
    await page.getByRole('button', { name: 'Réessayer' }).click();
    await expect(page.getByRole('menuitem', { name: new RegExp(active.name) })).toBeVisible();

    // Désactivée pendant la préparation : refus au clic, rien n'est écrit.
    await page.getByRole('menuitem', { name: new RegExp(active.name) }).click();
    const dialog = page.getByRole('dialog').filter({ hasText: active.name });
    await expect(dialog).toBeVisible();
    await expect(enrollButton(dialog, 1)).toBeEnabled({ timeout: 20_000 });
    await admin().from('outreach_sequences').update({ is_active: false }).eq('id', active.id);
    await enrollButton(dialog, 1).click();
    await expect(toast(page, 'Cette séquence est désactivée. Réactivez-la avant d\'inscrire des candidats.')).toBeVisible({ timeout: 20_000 });
    expect(await enrollmentsOf(active.id), 'aucune inscription').toHaveLength(0);
  });
});

test.describe('Sourcing : écritures et bilan de l\'inscription', () => {
  // inscription-ecritures-et-bilan-exact (SEQ-222, SEQ-130)
  test('bilan exact : 1 inscrit (avec sa première exécution), 1 déjà dans la séquence, 1 déjà passé ; aucune seconde ligne', async ({ browser }) => {
    const ws = await workspace('E2E ui-2 bilan');
    const seq = await missionSequence(ws, 'Bilan ui-2', messageSteps(['Bonjour {{firstName}}', 'Relance']));
    const fresh = { id: `ACoAAUI2N${rand()}`, name: 'Nina Nouvelle' };
    const inSeq = { id: `ACoAAUI2E${rand()}`, name: 'Emma Encours' };
    const passed = { id: `ACoAAUI2P${rand()}`, name: 'Paul Passé' };
    await seedEnrollments(ws, seq, [
      { profile_id: inSeq.id, profile_name: inSeq.name },
      { profile_id: passed.id, profile_name: passed.name, status: 'completed', created_at: new Date(Date.now() - 120 * DAY).toISOString(), completed_at: new Date(Date.now() - 100 * DAY).toISOString() },
    ]);
    const page = await openSearchResults(browser, ws, [fresh, inSeq, passed]);
    await selectCandidates(page, [fresh.name, inSeq.name, passed.name]);
    const dialog = await openEnrollment(page, seq.name);
    // Inscription vivante : signalée par l'anti-doublon ; le propriétaire passe outre pour voir le pré-contrôle de la séquence.
    await dialog.getByRole('checkbox', { name: /Inscrire quand même/ }).check();
    await enrollButton(dialog, 3).click();

    await expect(previewOutcome(dialog)).toHaveText('1 candidat inscrit', { timeout: 30_000 });
    await expect(dialog.getByText('1 candidat déjà dans cette séquence.')).toBeVisible();
    await expect(dialog.getByText('1 candidat est déjà passé par cette séquence (terminée, réponse ou arrêt). Relancez-le depuis le suivi de la séquence.')).toBeVisible();
    await expect(toast(page, '1 candidat inscrit dans la séquence')).toBeVisible();

    const rows = await enrollmentsOf(seq.id);
    expect(rows).toHaveLength(3);
    const created = rows.find((r) => r.profile_id === fresh.id);
    expect(created?.status).toBe('active');
    const { data: execs } = await admin().from('sequence_step_executions')
      .select('step_id, status, organization_id, scheduled_at').eq('enrollment_id', created!.id);
    expect(execs ?? [], 'première exécution créée').toHaveLength(1);
    expect(execs![0]).toMatchObject({ step_id: seq.steps[0].id, status: 'scheduled', organization_id: ws.org.orgId });
  });

  // inscription-ecritures-et-bilan-exact (SEQ-129) : première exécution refusée.
  test('première exécution refusée : l\'inscription est retirée, le bilan dit « Aucun candidat inscrit » et nomme l\'échec', async ({ browser }) => {
    const ws = await workspace('E2E ui-2 exécution refusée');
    const seq = await missionSequence(ws, 'Exécution refusée ui-2', messageSteps(['Bonjour {{firstName}}']));
    const cand = { id: `ACoAAUI2R${rand()}`, name: 'Rémi Refus' };
    const page = await openSearchResults(browser, ws, [cand]);
    await page.route('**/rest/v1/sequence_step_executions*', (route) => (
      route.request().method() === 'POST'
        ? route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: '42501', message: 'new row violates row-level security policy' }) })
        : route.continue()
    ));
    await selectCandidates(page, [cand.name]);
    const dialog = await openEnrollment(page, seq.name);
    await enrollButton(dialog, 1).click();

    await expect(previewOutcome(dialog)).toHaveText('Aucun candidat inscrit', { timeout: 30_000 });
    await expect(dialog.getByText(`${cand.name} : les étapes n'ont pas pu être planifiées, candidat non inscrit.`)).toBeVisible();
    await expect(toast(page, '1 inscription en échec')).toBeVisible();
    await expect(toast(page, 'inscrit dans la séquence')).toHaveCount(0);
    expect(await enrollmentsOf(seq.id), 'inscription retirée').toHaveLength(0);
  });

  // inscription-ecritures-et-bilan-exact (SEQ-032) : première étape en test A/B.
  test('première étape A/B 50/50 : chaque inscription tire sa variante, les deux variantes sont présentes sur 20 candidats', async ({ browser }) => {
    const ws = await workspace('E2E ui-2 A/B');
    const seq = await missionSequence(ws, 'A/B ui-2', [
      { step_order: 0, action_type: 'message', message_template: 'Variante A {{firstName}}', variant_group: 'A', variant_weight: 50 },
      { step_order: 0, action_type: 'message', message_template: 'Variante B {{firstName}}', variant_group: 'B', variant_weight: 50 },
    ]);
    const candidates = Array.from({ length: 20 }, (_, i) => ({ id: `ACoAAUI2AB${i}${rand()}`, name: `Candidat Ab${String.fromCharCode(97 + i)}` }));
    const page = await openSearchResults(browser, ws, candidates);
    await selectCandidates(page, candidates.map((c) => c.name));
    const dialog = await openEnrollment(page, seq.name);
    await enrollButton(dialog, 20).click();
    await expect(previewOutcome(dialog)).toHaveText('20 candidats inscrits', { timeout: 90_000 });

    const rows = await enrollmentsOf(seq.id);
    expect(rows).toHaveLength(20);
    const { data: execs } = await admin().from('sequence_step_executions')
      .select('step_id, variant_assigned').in('enrollment_id', rows.map((r) => r.id));
    expect(execs ?? []).toHaveLength(20);
    const stepOf = new Map((await stepsOf(seq.id)).map((s) => [s.message_template?.startsWith('Variante A') ? 'A' : 'B', s.id]));
    const variants = new Set((execs ?? []).map((e) => e.variant_assigned));
    expect([...variants].sort(), 'les deux variantes tirées').toEqual(['A', 'B']);
    for (const e of execs ?? []) expect(e.step_id, 'exécution sur l\'étape de sa variante').toBe(stepOf.get(e.variant_assigned as string));
  });

  // inscription-ecritures-et-bilan-exact (SEQ-224) : délai modifié à l'inscription, appliqué à toute la sélection.
  test('délai de démarrage modifié dans l\'aperçu : annoncé pour tous les candidats, appliqué à chaque inscription de la sélection', async ({ browser }) => {
    const ws = await workspace('E2E ui-2 délai');
    const seq = await missionSequence(ws, 'Délai ui-2', messageSteps(['Bonjour {{firstName}}', 'Relance']));
    const one = { id: `ACoAAUI2D1${rand()}`, name: 'Diane Delai' };
    const two = { id: `ACoAAUI2D2${rand()}`, name: 'Didier Delai' };
    const page = await openSearchResults(browser, ws, [one, two]);
    await selectCandidates(page, [one.name, two.name]);
    const dialog = await openEnrollment(page, seq.name);
    await dialog.getByRole('button', { name: 'Aperçus', exact: true }).click();
    await dialog.getByRole('button', { name: /démarre dans 1j/ }).click();
    const editor = page.getByRole('dialog').filter({ hasText: 'Délai avant la première étape' });
    await expect(editor).toContainText('tous les candidats de cette inscription');
    await editor.getByRole('spinbutton').first().fill('3');
    await editor.getByRole('button', { name: 'Appliquer' }).click();
    await expect(dialog.getByRole('button', { name: /démarre dans 3j/ })).toBeVisible();
    // Même délai affiché pour l'autre candidat de la sélection.
    await dialog.getByRole('button', { name: two.name, exact: true }).click();
    await expect(dialog.getByRole('button', { name: /démarre dans 3j/ })).toBeVisible();

    const before = Date.now();
    await enrollButton(dialog, 2).click();
    await expect(previewOutcome(dialog)).toHaveText('2 candidats inscrits', { timeout: 30_000 });
    const rows = await enrollmentsOf(seq.id);
    expect(rows).toHaveLength(2);
    const { data: execs } = await admin().from('sequence_step_executions').select('enrollment_id, scheduled_at').in('enrollment_id', rows.map((r) => r.id));
    expect(execs ?? []).toHaveLength(2);
    for (const e of execs ?? []) {
      const at = new Date(e.scheduled_at as string).getTime();
      expect(at, 'première étape à J+3 pour chaque candidat').toBeGreaterThanOrEqual(before + 3 * DAY - 60_000);
      expect(at).toBeLessThanOrEqual(Date.now() + 3 * DAY + 60_000);
    }
    for (const r of rows) {
      const overrides = (r.tracking_data as { step_config_overrides?: Record<string, unknown> } | null)?.step_config_overrides;
      expect(overrides?.[seq.steps[0].id], 'délai modifié gardé sur chaque inscription')
        .toMatchObject({ delayDays: 3 });
    }
  });
});

const SEQUENCES_PLAN_REQUIRED_MESSAGE = "L'envoi de séquences et d'InMails nécessite un abonnement. Passez à un plan payant pour contacter ces candidats.";

/** Génération des InMails simulée (IA hors sujet ici) ; renvoie les corps reçus. */
async function mockInMailGeneration(page: Page): Promise<string[]> {
  const bodies: string[] = [];
  await page.route('**/functions/v1/generate-outreach-message', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    bodies.push(route.request().postData() ?? '');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, subject: 'Une mission pour vous', message: 'Bonjour, une mission pourrait vous intéresser.' }) });
  });
  return bodies;
}

/** Appels process-inmail-queue du navigateur, par action. */
function recordInMailQueue(page: Page): string[] {
  const actions: string[] = [];
  page.on('request', (req) => {
    if (!req.url().includes('/functions/v1/process-inmail-queue') || req.method() !== 'POST') return;
    try { actions.push(String((req.postDataJSON() as { action?: string })?.action)); } catch { /* pré-vol */ }
  });
  return actions;
}

/** Aide sous les candidats exclus de l'InMail groupé (RECENT_CONTACT_REFUSED_MESSAGE de BulkInMailModal). */
const RECENT_CONTACT_REFUSED_TEXT =
  'Sans dérogation possible : la file InMail refuse tout candidat inscrit en séquence ou contacté par votre organisation ces 90 derniers jours, séquence arrêtée comprise.';

async function openBulkInMail(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: /InMail/ }).filter({ hasText: 'InMail' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'InMails personnalisés' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Vérification des contacts récents de l\'organisation')).toHaveCount(0, { timeout: 20_000 });
  // La fenêtre garde son onglet d'une ouverture à l'autre : retour à la rédaction.
  await dialog.getByRole('tab', { name: /^Composer/ }).click();
  return dialog;
}

async function seedPendingInMails(ws: Workspace, recipients: string[], status = 'pending') {
  const { error } = await admin().from('inmail_queue').insert(recipients.map((r) => ({
    account_id: ws.accountId,
    recipient_profile_id: r,
    recipient_name: `Destinataire ${r.slice(-4)}`,
    subject: 'Une mission',
    message: 'Bonjour',
    status,
    scheduled_at: inHours(48),
    created_by: ws.org.owner.userId,
    organization_id: ws.org.orgId,
  })));
  if (error) throw new Error(`seedPendingInMails: ${error.message}`);
}

test.describe('Sourcing : offre gratuite et InMail groupé', () => {
  // offre-gratuite-bloque-inscription-et-inmail (SEQ-134)
  test('offre gratuite : le menu Séquence et l\'InMail groupé proposent un abonnement et n\'écrivent rien', async ({ browser }) => {
    const ws = await workspace('E2E ui-2 gratuit sourcing', 'free');
    const seq = await missionSequence(ws, 'Gratuite sourcing ui-2', messageSteps(['Bonjour {{firstName}}']));
    const cand = { id: `ACoAAUI2FR${rand()}`, name: 'Gaël Gratuit' };
    const page = await openSearchResults(browser, ws, [cand], { inmailBalance: () => 10 });
    const generated = await mockInMailGeneration(page);
    const queueActions = recordInMailQueue(page);
    let sequencesListed = 0;
    page.on('request', (req) => { if (req.url().includes('/rest/v1/outreach_sequences') && req.url().includes('is_active=eq.true')) sequencesListed++; });
    await selectCandidates(page, [cand.name]);

    await page.getByRole('button', { name: 'Séquence', exact: true }).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByText(SEQUENCES_PLAN_REQUIRED_MESSAGE)).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Voir les plans' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: new RegExp(seq.name) }), 'aucune séquence proposée').toHaveCount(0);
    expect(sequencesListed, 'séquences non chargées').toBe(0);
    await closeMenu(page).catch(() => page.keyboard.press('Escape'));

    const dialog = await openBulkInMail(page);
    await expect(dialog.getByText(SEQUENCES_PLAN_REQUIRED_MESSAGE)).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Générer 1 message/ })).toBeDisabled();
    await page.waitForTimeout(1_000);
    expect(generated, 'aucune génération').toHaveLength(0);
    expect(queueActions.filter((a) => a === 'queue'), 'aucune mise en file').toHaveLength(0);
    expect(await enrollmentsOf(seq.id)).toHaveLength(0);
    const { count } = await admin().from('inmail_queue').select('id', { count: 'exact', head: true }).eq('organization_id', ws.org.orgId);
    expect(count).toBe(0);
  });

  // inmail-groupe-doublons-credits-annulation (SEQ-125, SEQ-133)
  test('InMail groupé : InMail déjà en file et candidat en séquence exclus sans dérogation, un crédit par destinataire hors relation, crédits manquants bloquants', async ({ browser }) => {
    const ws = await workspace('E2E ui-2 inmail doublons');
    const seq = await missionSequence(ws, 'Séquence InMail ui-2', messageSteps(['Bonjour']));
    const queued = { id: `ACoAAUI2IQ${rand()}`, name: 'Alice Enfile' };
    const enrolled = { id: `ACoAAUI2IE${rand()}`, name: 'Bruno Sequence' };
    const related = { id: `ACoAAUI2IR${rand()}`, name: 'Chloé Relation', network_distance: 'FIRST_DEGREE' };
    const fresh = { id: `ACoAAUI2IF${rand()}`, name: 'Diane Libre' };
    await seedEnrollments(ws, seq, [{ profile_id: enrolled.id, profile_name: enrolled.name }]);
    await seedPendingInMails(ws, [queued.id]);

    const page = await openSearchResults(browser, ws, [queued, enrolled, related, fresh], { inmailBalance: () => 0 });
    const generated = await mockInMailGeneration(page);
    await selectCandidates(page, [queued.name, enrolled.name, related.name]);
    let dialog = await openBulkInMail(page);

    await expect(dialog.getByText('Messages rédigés par l\'IA Konekt pour 1 candidat sur 3')).toBeVisible();
    await expect(dialog.getByText('2 candidats déjà contactés par votre organisation, exclus')).toBeVisible();
    await expect(dialog.getByText('0 InMail payant, 1 message gratuit (déjà en relation)', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Générer 1 message/ }), 'rien à payer : génération possible sans crédit').toBeEnabled();
    // Décision 24 : la file refuse ces candidats côté serveur, plus de « Contacter quand même ».
    await expect(dialog.getByText(/Contacter quand même/)).toHaveCount(0);
    await expect(dialog.getByText(RECENT_CONTACT_REFUSED_TEXT, { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // Crédits : un candidat ni en séquence ni en relation coûte un InMail.
    await selectCandidates(page, [fresh.name]);
    dialog = await openBulkInMail(page);
    await expect(dialog.getByText('Messages rédigés par l\'IA Konekt pour 2 candidats sur 4')).toBeVisible();
    await expect(dialog.getByText('1 InMail payant, 1 message gratuit (déjà en relation)', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Crédits insuffisants (0 restants, 1 requis)')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Crédits insuffisants', exact: true })).toBeDisabled();
    await page.waitForTimeout(500);
    expect(generated, 'aucune génération').toHaveLength(0);
  });

  // inmail-groupe-doublons-credits-annulation (SEQ-126, SEQ-226) : bilan partiel, bilan zéro, crédits relus.
  test('InMail groupé : bilan exact « 1 InMail planifié sur 2 », puis « Aucun InMail n\'a été planifié » et crédits relus insuffisants au nouvel essai', async ({ browser }) => {
    const ws = await workspace('E2E ui-2 inmail bilan');
    const related = { id: `ACoAAUI2BR${rand()}`, name: 'Denis Relation', network_distance: 'FIRST_DEGREE' };
    const late = { id: `ACoAAUI2BL${rand()}`, name: 'Elise Tardive' };
    const other = { id: `ACoAAUI2BO${rand()}`, name: 'Fabien Autre' };
    let balance = 5;
    const page = await openSearchResults(browser, ws, [related, late, other], { inmailBalance: () => balance });
    await mockInMailGeneration(page);
    const queueActions = recordInMailQueue(page);

    await selectCandidates(page, [related.name, late.name]);
    let dialog = await openBulkInMail(page);
    await dialog.getByRole('button', { name: /^Générer 2 messages/ }).click();
    await expect(toast(page, '2 messages générés')).toBeVisible({ timeout: 20_000 });
    // Un collègue programme entre-temps un InMail pour le second candidat : la file le refuse.
    await seedPendingInMails(ws, [late.id], 'scheduled');
    await dialog.getByRole('button', { name: 'Planifier 2 InMails' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Planifier 2 InMails ?' });
    await expect(confirm).toContainText('1 InMail payant, 1 message gratuit (déjà en relation)');
    await confirm.getByRole('button', { name: 'Planifier', exact: true }).click();
    const partial = toast(page, '1 InMail planifié sur 2');
    await expect(partial).toBeVisible({ timeout: 20_000 });
    await expect(partial).toContainText('1 candidat déjà contacté par votre organisation, exclu.');
    const { data: rows } = await admin().from('inmail_queue').select('recipient_profile_id, status').eq('organization_id', ws.org.orgId).eq('recipient_profile_id', related.id);
    expect(rows ?? [], 'seul le destinataire accepté est en file').toHaveLength(1);
    expect(['pending', 'scheduled']).toContain(rows![0].status);
    const { count: lateCount } = await admin().from('inmail_queue').select('id', { count: 'exact', head: true }).eq('organization_id', ws.org.orgId).eq('recipient_profile_id', late.id);
    expect(lateCount, 'pas de second InMail pour le candidat refusé').toBe(1);
    await dialog.getByRole('button', { name: 'Fermer', exact: true }).last().click();
    await expect(dialog).toBeHidden();

    // Bilan zéro : rien en file, les messages restent ; le solde relu est à 0 et bloque le nouvel essai.
    await page.getByRole('checkbox', { name: `Sélectionner ${related.name}`, exact: true }).click();
    await page.getByRole('checkbox', { name: `Sélectionner ${late.name}`, exact: true }).click();
    await selectCandidates(page, [other.name]);
    dialog = await openBulkInMail(page);
    await dialog.getByRole('button', { name: /^Générer 1 message/ }).click();
    await expect(toast(page, '1 message généré')).toBeVisible({ timeout: 20_000 });
    await seedPendingInMails(ws, [other.id], 'scheduled');
    balance = 0;
    await dialog.getByRole('button', { name: 'Planifier 1 InMail' }).click();
    await page.getByRole('alertdialog', { name: 'Planifier 1 InMail ?' }).getByRole('button', { name: 'Planifier', exact: true }).click();
    const none = toast(page, 'Aucun InMail n’a été planifié');
    await expect(none).toBeVisible({ timeout: 20_000 });
    await expect(none).toContainText('Ces candidats ont déjà un InMail en file ou ont été contactés par votre organisation');
    await expect(toast(page, /InMails? planifiés? pour envoi/)).toHaveCount(0);
    const queuesBefore = queueActions.filter((a) => a === 'queue').length;
    await dialog.getByRole('button', { name: 'Planifier 1 InMail' }).click();
    await page.getByRole('alertdialog', { name: 'Planifier 1 InMail ?' }).getByRole('button', { name: 'Planifier', exact: true }).click();
    await expect(toast(page, 'Crédits InMail insuffisants (0 restants, 1 requis)')).toBeVisible();
    expect(queueActions.filter((a) => a === 'queue').length, 'pas de nouvel envoi à la file').toBe(queuesBefore);
  });

  // inmail-groupe-doublons-credits-annulation (SEQ-126) : annulation de toute la file.
  test('« Annuler les envois en attente » confirme le nombre compté en base (150) et affiche le nombre réellement annulé', async ({ browser }) => {
    const ws = await workspace('E2E ui-2 inmail annulation');
    await seedPendingInMails(ws, Array.from({ length: 120 }, (_, i) => `ACoAAUI2XP${i}${rand()}`), 'pending');
    await seedPendingInMails(ws, Array.from({ length: 30 }, (_, i) => `ACoAAUI2XS${i}${rand()}`), 'scheduled');
    const cand = { id: `ACoAAUI2XC${rand()}`, name: 'Hélène Annule' };
    const page = await openSearchResults(browser, ws, [cand], { inmailBalance: () => 5 });
    await selectCandidates(page, [cand.name]);
    const dialog = await openBulkInMail(page);
    await dialog.getByRole('tab', { name: /File d'attente/ }).click();
    await dialog.getByRole('button', { name: 'Annuler les envois en attente' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Annuler 150 InMails en attente ?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Annuler les envois' }).click();
    await expect(toast(page, '150 InMails annulés')).toBeVisible({ timeout: 20_000 });
    const { data } = await admin().from('inmail_queue').select('status').eq('organization_id', ws.org.orgId);
    expect((data ?? []).filter((r) => r.status === 'cancelled')).toHaveLength(150);
    expect((data ?? []).filter((r) => r.status !== 'cancelled')).toHaveLength(0);
  });
});

// ═══ Fiche candidat ═════════════════════════════════════════════════════════

test.describe('Fiche candidat : séquences du candidat', () => {
  // fiche-candidat-actions-sequences (SEQ-004, SEQ-176, SEQ-221, D5)
  test('pause sans annuler d\'étape, reprise serveur, « Marquer comme ayant répondu » qui annonce les autres séquences arrêtées ; effacement RGPD sans « Reprendre » ; étapes échouée et sautée jamais « Envoyé »', async ({ browser }) => {
    const ws = await workspace('E2E ui-2 fiche');
    const profileId = `ACoAAUI2FC${rand()}`;
    const name = 'Lucie Fiche';
    const { error: jcsErr } = await admin().from('job_candidate_status').insert({
      job_id: `project:${ws.missionId}`, project_id: ws.missionId, candidate_id: profileId, candidate_name: name,
      status: 'contacted', pipeline_stage: 'messaged', created_by: ws.org.owner.userId, organization_id: ws.org.orgId,
    });
    expect(jcsErr, jcsErr?.message).toBeNull();
    const seq1 = await missionSequence(ws, 'Fiche A ui-2', messageSteps(['Un', 'Deux', 'Trois']));
    const seq2 = await missionSequence(ws, 'Fiche B ui-2', messageSteps(['Un', 'Deux']));
    const seq3 = await missionSequence(ws, 'Fiche C ui-2', messageSteps(['Un', 'Deux']));
    const [e1] = await seedEnrollments(ws, seq1, [{ profile_id: profileId, profile_name: name, current_step_order: 2 }]);
    const [e2] = await seedEnrollments(ws, seq2, [{ profile_id: profileId, profile_name: name }]);
    const [e3] = await seedEnrollments(ws, seq3, [{ profile_id: profileId, profile_name: name, status: 'paused', pause_reason: 'manual', tracking_data: { gdpr_erased_at: '2026-09-21T10:00:00.000Z' } }]);
    const yesterday = new Date(Date.now() - DAY).toISOString();
    const pendingAt = inHours(26);
    await seedExecutions(ws, seq1, [
      { enrollmentId: e1, stepIndex: 0, status: 'skipped', scheduled_at: yesterday, executed_at: yesterday, skip_reason: 'Déjà en relation : invitation inutile' },
      { enrollmentId: e1, stepIndex: 1, status: 'failed', scheduled_at: yesterday, executed_at: yesterday, error_message: 'Envoi refusé par LinkedIn' },
      { enrollmentId: e1, stepIndex: 2, status: 'scheduled', scheduled_at: pendingAt },
    ]);
    await seedExecutions(ws, seq2, [{ enrollmentId: e2, stepIndex: 1, scheduled_at: inHours(30) }]);
    await seedExecutions(ws, seq3, [{ enrollmentId: e3, stepIndex: 1, scheduled_at: inHours(30) }]);

    const page = await openAs(browser, ws.org.owner, [ws.accountId]);
    const writes = executionWritesFromBrowser(page);
    // Tutoriel vidéo du pipeline déjà vu : il s'ouvrirait par-dessus le tableau.
    await page.addInitScript(() => { try { localStorage.setItem('konekt:tuto:seen:pipeline', '1'); } catch { /* sans stockage */ } });
    await page.goto(`/missions/${ws.missionId}?tab=pipeline`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Kanban', exact: true }).click({ timeout: 30_000 });
    await page.getByText(name, { exact: true }).first().click();
    await page.getByRole('tab', { name: /^Séquences/ }).or(page.getByRole('button', { name: /^Séquences/ })).first().click({ timeout: 20_000 });
    const card = (seqName: string) => page.locator('[id$="-content-sequences"] div.rounded-xl').filter({ has: page.getByRole('heading', { name: seqName, exact: true }) });
    await expect(card(seq1.name)).toBeVisible({ timeout: 20_000 });

    // Effacement RGPD : ni « Reprendre » ni reprise possible.
    await expect(card(seq3.name).getByText(/Ce candidat a demandé l.effacement de ses données : il ne peut plus être relancé\./)).toBeVisible();
    await expect(card(seq3.name).getByRole('button', { name: 'Reprendre', exact: true })).toHaveCount(0);

    // Étapes sautée et échouée : jamais « Envoyé ».
    await card(seq1.name).getByRole('button', { name: /Voir l'historique/ }).click();
    await expect(card(seq1.name).getByText(/^Ignoré il y a/)).toBeVisible();
    await expect(card(seq1.name).getByText(/^Échec il y a/)).toBeVisible();
    await expect(card(seq1.name).getByText(/Envoyé il y a/)).toHaveCount(0);

    // Mise en pause : statut et raison, aucune étape annulée, date gardée.
    await card(seq1.name).getByRole('button', { name: 'Mettre en pause', exact: true }).click();
    await page.getByRole('alertdialog', { name: `Mettre en pause « ${seq1.name} » ?` }).getByRole('button', { name: 'Mettre en pause' }).click();
    await expect(toast(page, 'Séquence mise en pause')).toBeVisible({ timeout: 20_000 });
    expect(await enrollment(e1)).toMatchObject({ status: 'paused', pause_reason: 'manual' });
    const pending = (await executionsOf(e1)).find((x) => x.step_order === 2)!;
    expect(pending.status).toBe('scheduled');
    expect(new Date(pending.scheduled_at).getTime()).toBe(new Date(pendingAt).getTime());

    // Reprise : action serveur, bilan partagé.
    const resumeCall = page.waitForRequest((req) => req.url().includes('/functions/v1/process-sequences') && (req.postData() ?? '').includes('resume_enrollments'));
    await card(seq1.name).getByRole('button', { name: 'Reprendre', exact: true }).click();
    await page.getByRole('alertdialog', { name: `Reprendre « ${seq1.name} » ?` }).getByRole('button', { name: 'Reprendre' }).click();
    await resumeCall;
    await expect(toast(page, 'Séquence reprise')).toBeVisible({ timeout: 20_000 });
    expect(await enrollment(e1)).toMatchObject({ status: 'active', pause_reason: null });

    // Réponse sur la 2e séquence : les autres séquences du candidat s'arrêtent, et c'est dit.
    await card(seq2.name).getByRole('button', { name: 'Actions de l\'inscription' }).click();
    await page.getByRole('menuitem', { name: 'Marquer comme ayant répondu' }).click();
    const confirm = page.getByRole('alertdialog', { name: `Marquer ${name} comme ayant répondu ?` });
    await expect(confirm).toContainText('Ses autres séquences encore en cours ou en pause seront aussi arrêtées.');
    await confirm.getByRole('button', { name: 'Marquer comme ayant répondu' }).click();
    const replied = toast(page, `Réponse enregistrée pour ${name}`);
    await expect(replied).toBeVisible({ timeout: 20_000 });
    await expect(replied).toContainText('Ses 2 autres séquences en cours ou en pause ont été arrêtées.');
    expect((await enrollment(e2)).status).toBe('replied');
    expect((await enrollment(e1)).status).toBe('stopped');
    expect((await enrollment(e3)).status).toBe('stopped');
    expect((await executionsOf(e2)).map((x) => x.status)).toEqual(['cancelled']);
    expect(writes, 'pause, reprise et réponse sans réécriture d\'exécution par le navigateur').toEqual([]);
  });
});
