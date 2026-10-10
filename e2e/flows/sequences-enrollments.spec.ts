/**
 * Séquences : gestion des inscriptions depuis l'interface (onglet « outreach »
 * d'une mission).
 *
 * Contrat testé : CLAUDE.md, « Séquences : règles du moteur et de
 * l'interface », et les scénarios 3, 6 et 7 des « Vérifications à faire à la
 * main » de docs/audit-2026-09-25-sequences.md. Remplace les `test.fixme`
 * « Sauter une étape » (BUG-007) et « Envoyer tout » (MQ-002) de
 * sequences.spec.ts.
 *
 * Les actions membres de process-sequences (skip_execution, nudge_sequences,
 * resume_enrollments) et l'arrêt des envois d'un membre (unipile-accounts,
 * stop_member_linkedin) tournent pour de vrai : ces tests exigent la stack
 * locale (E2E_EDGE_FUNCTIONS=1, voir e2e/local-stack/README.md). Seule la
 * liste des comptes LinkedIn est simulée dans le navigateur.
 *
 * Données : une organisation jetable par test (fixture `org`), plan payant,
 * un compte LinkedIn relié par membre. Les exécutions sont planifiées dans le
 * futur et les étapes ont un jour de délai : le cycle `process` lancé par
 * d'autres suites ne prend que les exécutions échues.
 */
import type { Browser, BrowserContext, Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { pinLegacySequences } from '../helpers/env';
import {
  addMember,
  admin,
  createOrg,
  deleteOrg,
  seedEnrollment,
  seedExecution,
  seedLinkedInAccount,
  seedMission,
  seedSequence,
  setOrgPlan,
  storageStateForUser,
  type SeededStep,
  type TestUser,
} from '../helpers/supabase-admin';

const EDGE_DEPLOYED = process.env.E2E_EDGE_FUNCTIONS === '1';
test.skip(!EDGE_DEPLOYED, 'process-sequences non déployée sur cet environnement (E2E_EDGE_FUNCTIONS=1 pour activer)');

// Seeding, chargement de la mission et appels au moteur : au-delà des 30 s par défaut.
test.describe.configure({ timeout: 120_000 });

const HOUR = 3600 * 1000;
const rand = () => Math.random().toString(36).slice(2, 8);

// Textes d'aide de SequencesList.tsx (contrat §8 et D3).
const COLLABORATOR_DEACTIVATION_HINT = 'La mise en pause de la séquence s’applique à tous ses candidats : réservée aux membres qui gèrent toutes les inscriptions. Mettez vos candidats en pause depuis la liste des inscrits.';

// ─── Contextes navigateur ───────────────────────────────────────────────────

const contexts: BrowserContext[] = [];

test.afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
});

/**
 * Page connectée en `user`. Seule l'action `list` de unipile-accounts est
 * simulée (comptes LinkedIn du prestataire) : les autres actions, dont
 * stop_member_linkedin, partent vers l'edge function locale.
 */
async function openAs(browser: Browser, user: TestUser, accountIds: string[]): Promise<Page> {
  const context = await browser.newContext({ storageState: await storageStateForUser(user) });
  // Lot 5h : ancienne interface des séquences, épinglée sur le secours (clé à « 0 ») jusqu'au lot 5j.
  await pinLegacySequences(context);
  contexts.push(context);
  await context.route('**/functions/v1/unipile-accounts', async (route) => {
    let action: string | undefined;
    try {
      action = (route.request().postDataJSON() as { action?: string } | null)?.action;
    } catch {
      /* pas de body JSON (pré-vol CORS) */
    }
    if (action !== 'list') return route.continue();
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

/** Onglet outreach de la mission, liste des séquences chargée. */
async function openOutreach(page: Page, missionId: string, sequenceName: string) {
  await page.goto(`/missions/${missionId}?tab=outreach`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(sequenceName, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
}

/** Ligne d'une séquence (vue bureau) : parent du bouton « candidats ». */
function sequenceRow(page: Page, sequenceName: string) {
  return page.getByRole('button', { name: `Voir les candidats inscrits à la séquence ${sequenceName}` }).locator('..');
}

/** Ouvre le panneau des inscrits depuis le compteur de candidats de la ligne. */
async function openEnrollmentsPanel(page: Page, sequenceName: string) {
  await page.getByRole('button', { name: `Voir les candidats inscrits à la séquence ${sequenceName}` }).click();
  const panel = page.getByRole('dialog', { name: new RegExp(sequenceName, 'i') });
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Chargement des inscriptions…')).toHaveCount(0, { timeout: 15_000 });
  return panel;
}

/** Déplie le parcours d'un candidat du panneau (le déclencheur commence par son nom). */
async function expandEnrollment(panel: Locator, name: string) {
  await panel.getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await expect(panel.getByText('Parcours', { exact: true }).first()).toBeVisible();
}

const toast = (page: Page, title: string) => page.locator('[data-sonner-toast]').filter({ hasText: title });

// ─── Données ────────────────────────────────────────────────────────────────

/** Mission de l'organisation et séquence de 3 messages (1 jour de délai) rattachée. */
async function seedMissionSequence(orgId: string, createdBy: string, missionId: string, label: string) {
  const { sequenceId, steps } = await seedSequence(orgId, createdBy, [
    { action_type: 'message', delay_days: 1 },
    { action_type: 'message', delay_days: 1 },
    { action_type: 'message', delay_days: 1 },
  ]);
  const name = `${label} ${rand()}`;
  const { error } = await admin().from('outreach_sequences').update({ project_id: missionId, name }).eq('id', sequenceId);
  if (error) throw new Error(`seedMissionSequence: ${error.message}`);
  return { sequenceId, steps, name };
}

/** Inscription active depuis le compte relié de `createdBy`, avec son étape 0 planifiée. */
async function seedEnrolled(
  orgId: string,
  sequenceId: string,
  step: SeededStep,
  createdBy: string,
  accountId: string,
  profileName: string,
  scheduledAt: Date,
) {
  const enrollmentId = await seedEnrollment(orgId, sequenceId, createdBy, {
    profile_name: profileName,
    profile_url: `https://www.linkedin.com/in/e2e-${rand()}`,
    account_id: accountId,
    user_timezone: 'Europe/Paris',
  });
  const executionId = await seedExecution(orgId, enrollmentId, step, { scheduled_at: scheduledAt.toISOString() });
  return { enrollmentId, executionId, scheduledAt };
}

async function enrollmentRow(id: string) {
  const { data, error } = await admin()
    .from('sequence_enrollments')
    .select('id, status, pause_reason, current_step_order')
    .eq('id', id)
    .single();
  if (error) throw new Error(`enrollmentRow: ${error.message}`);
  return data as { status: string; pause_reason: string | null; current_step_order: number };
}

async function executionRows(enrollmentId: string) {
  const { data, error } = await admin()
    .from('sequence_step_executions')
    .select('id, step_id, step_order, status, scheduled_at')
    .eq('enrollment_id', enrollmentId);
  if (error) throw new Error(`executionRows: ${error.message}`);
  return (data ?? []) as Array<{ id: string; step_id: string; step_order: number; status: string; scheduled_at: string }>;
}

async function executionRow(id: string) {
  const { data, error } = await admin()
    .from('sequence_step_executions')
    .select('id, status, scheduled_at')
    .eq('id', id)
    .single();
  if (error) throw new Error(`executionRow: ${error.message}`);
  return data as { status: string; scheduled_at: string };
}

const ms = (iso: string) => new Date(iso).getTime();

/**
 * Millisecondes restantes avant minuit, heure de Paris : `nudge_sequences`
 * n'avance que les actions prévues plus tard AUJOURD'HUI dans le fuseau de
 * l'inscription (même calcul que e2e/api/sequences-engine.spec.ts).
 */
function msUntilParisMidnight(now = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const elapsedMs = ((get('hour') * 60 + get('minute')) * 60 + get('second')) * 1000 + now.getMilliseconds();
  return 24 * HOUR - elapsedMs;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

test.describe('Séquences — inscriptions', () => {
  test("@critical « Sauter » une étape depuis le panneau avance la séquence et ne la rejoue pas (BUG-007)", async ({ browser, org }) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    const missionId = await seedMission(org.orgId, owner.userId, { name: 'Mission Inscrits E2E' });
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
    const seq = await seedMissionSequence(org.orgId, owner.userId, missionId, 'Saut e2e');
    const alice = await seedEnrolled(org.orgId, seq.sequenceId, seq.steps[0], owner.userId, account, 'Alice Martin', new Date(Date.now() + 2 * HOUR));

    const page = await openAs(browser, owner, [account]);
    await openOutreach(page, missionId, seq.name);
    const panel = await openEnrollmentsPanel(page, seq.name);
    await expandEnrollment(panel, 'Alice Martin');

    await panel.getByRole('button', { name: 'Sauter', exact: true }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Sauter cette étape ?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Sauter l\'étape' }).click();

    await expect(toast(page, 'Étape sautée')).toBeVisible({ timeout: 20_000 });
    await expect(toast(page, 'L\'étape n\'a pas pu être sautée')).toHaveCount(0);

    // En base : l'étape est sautée, la position avance, l'étape suivante est planifiée.
    expect((await executionRow(alice.executionId)).status, 'étape marquée sautée').toBe('skipped');
    expect((await enrollmentRow(alice.enrollmentId)).current_step_order, 'position avancée').toBe(seq.steps[0].step_order + 1);
    const executions = await executionRows(alice.enrollmentId);
    const next = executions.filter((e) => e.step_id === seq.steps[1].id);
    expect(next.length, 'étape suivante planifiée').toBe(1);
    expect(['scheduled', 'waiting_event', 'quota_blocked']).toContain(next[0].status);
    // L'étape sautée n'est pas replanifiée (avant : nouvelle exécution une heure plus tard).
    const skippedStep = executions.filter((e) => e.step_id === seq.steps[0].id);
    expect(skippedStep.map((e) => e.status), 'aucune nouvelle exécution pour l\'étape sautée').toEqual(['skipped']);

    // L'écran relu montre l'état réel : un seul « Sauter », sur l'étape suivante.
    await expect(panel.getByRole('button', { name: 'Sauter', exact: true })).toHaveCount(1);
  });

  test("@critical « Envoyer les actions du jour » avance les actions sans erreur pour un collaborateur (MQ-002)", async ({ browser, org }) => {
    const untilMidnight = msUntilParisMidnight();
    test.skip(untilMidnight < 10 * 60_000, 'Trop près de minuit à Paris : l\'action tomberait le lendemain');
    // Plus tard AUJOURD'HUI à Paris (au plus dans 1 h, avant minuit) : seules ces actions avancent.
    const laterToday = () => new Date(Date.now() + Math.min(HOUR, untilMidnight / 2));

    const owner = org.owner;
    await setOrgPlan(org.orgId);
    const missionId = await seedMission(org.orgId, owner.userId, { name: 'Mission Actions du jour E2E' });
    const collab = await addMember(org.orgId, 'collaborator', 'collab');
    org.addExtraUser(collab);
    // L'équipe de la mission lui ouvre la mission ; il ne lit que ses propres
    // séquences (RLS outreach_sequences, lot C1 : plus de lecture par l'équipe).
    // Le propriétaire a inscrit un candidat dans la séquence du collaborateur.
    await admin().from('mission_team').insert({ project_id: missionId, user_id: collab.userId, role: 'sourcer' });
    const ownerAccount = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
    const collabAccount = await seedLinkedInAccount(org.orgId, collab.userId, `acc_e2e_${rand()}`);
    const seq = await seedMissionSequence(org.orgId, collab.userId, missionId, 'Relances du jour e2e');
    const mine = await seedEnrolled(org.orgId, seq.sequenceId, seq.steps[0], collab.userId, collabAccount, 'Bruno Petit', laterToday());
    // D3 : le candidat inscrit par un autre membre n'est pas avancé par un collaborateur.
    const colleague = await seedEnrolled(org.orgId, seq.sequenceId, seq.steps[0], owner.userId, ownerAccount, 'Alice Martin', laterToday());

    // Autre organisation, action prévue plus tard aujourd'hui : jamais touchée.
    const other = await createOrg('agency', 'E2E Actions du jour autre');
    try {
      await setOrgPlan(other.orgId);
      const otherAccount = await seedLinkedInAccount(other.orgId, other.owner.userId, `acc_e2e_${rand()}`);
      const otherSeq = await seedSequence(other.orgId, other.owner.userId, [{ action_type: 'message', delay_days: 1 }]);
      const otherEnrolled = await seedEnrolled(
        other.orgId, otherSeq.sequenceId, otherSeq.steps[0], other.owner.userId, otherAccount, 'Zoé Autre', laterToday(),
      );
      const colleagueBefore = await executionRow(colleague.executionId);
      const otherBefore = await executionRow(otherEnrolled.executionId);

      const page = await openAs(browser, collab, [collabAccount]);
      await openOutreach(page, missionId, seq.name);

      const nudge = page.getByRole('button', { name: 'Envoyer les actions du jour' });
      await expect(nudge).toBeEnabled();
      await nudge.click();
      const confirm = page.getByRole('alertdialog', { name: 'Envoyer maintenant les actions du jour ?' });
      await expect(confirm).toBeVisible();
      await confirm.getByRole('button', { name: 'Envoyer maintenant' }).click();

      await expect(toast(page, '1 action avancée')).toBeVisible({ timeout: 20_000 });
      await expect(toast(page, 'Les actions du jour n’ont pas pu être avancées')).toHaveCount(0);

      // Relu tout de suite : le cycle `process` d'une autre suite peut ensuite l'envoyer.
      const mineAfter = await executionRow(mine.executionId);
      expect(ms(mineAfter.scheduled_at), 'mon action du jour avancée à maintenant').toBeLessThanOrEqual(Date.now() + 5_000);
      expect(ms(mineAfter.scheduled_at)).toBeLessThan(mine.scheduledAt.getTime());
      expect((await executionRow(colleague.executionId)).scheduled_at, 'candidat d\'un autre membre non avancé (D3)')
        .toBe(colleagueBefore.scheduled_at);
      expect((await executionRow(otherEnrolled.executionId)).scheduled_at, 'autre organisation intacte')
        .toBe(otherBefore.scheduled_at);
    } finally {
      await deleteOrg(other);
    }
  });

  test('audit scénario 3 : pause manuelle, désactivation puis réactivation de la séquence, reprise sans rafale', async ({ browser, org }) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    const missionId = await seedMission(org.orgId, owner.userId, { name: 'Mission Pause E2E' });
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
    const seq = await seedMissionSequence(org.orgId, owner.userId, missionId, 'Pause e2e');
    // Dates distinctes, toutes futures : la reprise doit les garder telles quelles.
    const alice = await seedEnrolled(org.orgId, seq.sequenceId, seq.steps[0], owner.userId, account, 'Alice Martin', new Date(Date.now() + 2 * HOUR));
    const bruno = await seedEnrolled(org.orgId, seq.sequenceId, seq.steps[0], owner.userId, account, 'Bruno Petit', new Date(Date.now() + 5 * HOUR));
    const chloe = await seedEnrolled(org.orgId, seq.sequenceId, seq.steps[0], owner.userId, account, 'Chloé Durand', new Date(Date.now() + 26 * HOUR));

    const page = await openAs(browser, owner, [account]);
    await openOutreach(page, missionId, seq.name);

    // 1. Pause manuelle d'Alice depuis le panneau : immédiate, « Annuler » dans
    // le toast (lot 5b, décision 3).
    const panel = await openEnrollmentsPanel(page, seq.name);
    await panel.getByRole('button', { name: 'Actions pour Alice Martin' }).click();
    await page.getByRole('menuitem', { name: 'Mettre en pause pour ce candidat' }).click();
    await expect(toast(page, 'Séquence mise en pause pour Alice Martin.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('alertdialog'), 'plus de fenêtre de confirmation').toHaveCount(0);
    expect(await enrollmentRow(alice.enrollmentId)).toMatchObject({ status: 'paused', pause_reason: 'manual' });
    await panel.getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect(panel).toBeHidden();

    // 2. Mise en pause de la séquence, sans fenêtre : le toast dit le résultat réel.
    await page.getByRole('switch', { name: `Mettre en pause la séquence ${seq.name}` }).click();
    await expect(toast(page, 'Séquence mise en pause : 2 candidats en pause.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('alertdialog'), 'plus de fenêtre de confirmation').toHaveCount(0);

    expect(await enrollmentRow(alice.enrollmentId), 'pause manuelle conservée').toMatchObject({ status: 'paused', pause_reason: 'manual' });
    for (const e of [bruno, chloe]) {
      expect(await enrollmentRow(e.enrollmentId)).toMatchObject({ status: 'paused', pause_reason: 'sequence_inactive' });
    }
    const { data: seqOff } = await admin().from('outreach_sequences').select('is_active').eq('id', seq.sequenceId).single();
    expect(seqOff?.is_active).toBe(false);

    // 3. Réactivation : seules les pauses de séquence reprennent.
    await page.getByRole('switch', { name: `Activer la séquence ${seq.name}` }).click();
    const activate = page.getByRole('alertdialog', { name: 'Réactiver cette séquence ?' });
    await expect(activate).toContainText('2 candidats en pause reprendront.');
    await expect(activate).toContainText('1 candidat mis en pause pour une autre raison');
    await activate.getByRole('button', { name: 'Réactiver' }).click();
    await expect(toast(page, 'Séquence réactivée. 2 candidats repris.')).toBeVisible({ timeout: 30_000 });

    expect(await enrollmentRow(alice.enrollmentId), 'le candidat mis en pause à la main reste en pause')
      .toMatchObject({ status: 'paused', pause_reason: 'manual' });
    for (const e of [bruno, chloe]) {
      expect(await enrollmentRow(e.enrollmentId), 'les autres reprennent').toMatchObject({ status: 'active', pause_reason: null });
    }

    // Sans rafale : chaque étape en attente garde son statut et SA date prévue
    // (resumeDate = max(date prévue, maintenant + 1 min)), rien n'est avancé à maintenant.
    for (const e of [alice, bruno, chloe]) {
      const rows = await executionRows(e.enrollmentId);
      expect(rows.length, 'aucune exécution créée ni supprimée').toBe(1);
      expect(rows[0].status).toBe('scheduled');
      expect(ms(rows[0].scheduled_at), 'date prévue inchangée').toBe(e.scheduledAt.getTime());
    }
  });

  test('audit scénario 6 : un collaborateur ne voit pas la séquence d\'un autre, ne désactive pas la sienne et n\'agit pas sur les candidats d\'un collègue', async ({ browser, org }) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    const missionId = await seedMission(org.orgId, owner.userId, { name: 'Mission Collaborateur E2E' });
    const collab = await addMember(org.orgId, 'collaborator', 'collab');
    org.addExtraUser(collab);
    await admin().from('mission_team').insert({ project_id: missionId, user_id: collab.userId, role: 'sourcer' });
    const ownerAccount = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
    const collabAccount = await seedLinkedInAccount(org.orgId, collab.userId, `acc_e2e_${rand()}`);

    // Séquence d'un autre membre : depuis le lot C1 (20260927233806, R7), le
    // collaborateur ne la lit plus, même dans l'équipe de la mission.
    const ownerSeq = await seedMissionSequence(org.orgId, owner.userId, missionId, 'Séquence du propriétaire e2e');
    const zoe = await seedEnrolled(org.orgId, ownerSeq.sequenceId, ownerSeq.steps[0], owner.userId, ownerAccount, 'Zoé Martin', new Date(Date.now() + 2 * HOUR));
    // Séquence du collaborateur, active : un candidat inscrit par le propriétaire, un par lui-même.
    const collabSeq = await seedMissionSequence(org.orgId, collab.userId, missionId, 'Séquence du collaborateur e2e');
    const alice = await seedEnrolled(org.orgId, collabSeq.sequenceId, collabSeq.steps[0], owner.userId, ownerAccount, 'Alice Martin', new Date(Date.now() + 2 * HOUR));
    const bruno = await seedEnrolled(org.orgId, collabSeq.sequenceId, collabSeq.steps[0], collab.userId, collabAccount, 'Bruno Petit', new Date(Date.now() + 3 * HOUR));

    const page = await openAs(browser, collab, [collabAccount]);
    await openOutreach(page, missionId, collabSeq.name);
    await expect(page.getByText(ownerSeq.name, { exact: true }), 'séquence d\'un autre membre non affichée').toHaveCount(0);

    // Sa propre séquence active : interrupteur verrouillé avec l'explication (D3).
    const ownSwitch = page.getByRole('switch', { name: `Mettre en pause la séquence ${collabSeq.name}` });
    await expect(ownSwitch).toHaveAttribute('aria-disabled', 'true');
    await expect(ownSwitch).toHaveAttribute('title', COLLABORATOR_DEACTIVATION_HINT);
    // aria-disabled seulement (pas disabled) : le clic reste possible et dit
    // pourquoi. Playwright refuse de cliquer un élément aria-disabled sans force.
    await ownSwitch.click({ force: true });
    await expect(toast(page, 'Mise en pause réservée')).toBeVisible();
    // Lot 5b : la mise en pause écrit tout de suite (plus de fenêtre) ; le clic
    // verrouillé n'a rien écrit, ni sur l'interrupteur ni sur les inscriptions.
    const { data: collabSeqRow } = await admin().from('outreach_sequences').select('is_active').eq('id', collabSeq.sequenceId).single();
    expect(collabSeqRow?.is_active, 'séquence toujours active').toBe(true);
    for (const e of [alice, bruno]) {
      expect(await enrollmentRow(e.enrollmentId), 'aucune inscription mise en pause').toMatchObject({ status: 'active', pause_reason: null });
    }

    // Panneau de sa séquence : ni pause ni arrêt groupés (D3, lot 5b).
    const panel = await openEnrollmentsPanel(page, collabSeq.name);
    await expect(panel.getByText('Bruno Petit', { exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: /Mettre en pause tous les candidats actifs/ })).toHaveCount(0);
    // Libellé vérifié chez le propriétaire (« Arrêter » groupé, lot 5b).
    await expect(panel.getByRole('button', { name: /^Arrêter \(\d+\)$/ })).toHaveCount(0);

    // Candidat inscrit par un autre membre : consultation seulement.
    await panel.getByRole('button', { name: 'Actions pour Alice Martin' }).click();
    await expect(page.getByRole('menuitem', { name: 'Voir sur LinkedIn' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Mettre en pause pour ce candidat' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Arrêter pour ce candidat' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Marquer comme ayant répondu' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expandEnrollment(panel, 'Alice Martin');
    await expect(panel.getByText(/^Prévu :/).first()).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Sauter', exact: true }), 'pas de « Sauter » sur le candidat d\'un autre').toHaveCount(0);

    // Son propre candidat, dans la même séquence : les actions sont là (contrôle positif).
    await panel.getByRole('button', { name: 'Actions pour Bruno Petit' }).click();
    await expect(page.getByRole('menuitem', { name: 'Mettre en pause pour ce candidat' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Arrêter pour ce candidat' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Marquer comme ayant répondu' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expandEnrollment(panel, 'Bruno Petit');
    await expect(panel.getByRole('button', { name: 'Sauter', exact: true })).toHaveCount(1);

    // Rien n'a bougé en base.
    for (const e of [alice, bruno, zoe]) expect((await enrollmentRow(e.enrollmentId)).status).toBe('active');
  });

  test("audit scénario 7 : retirer un membre met ses inscriptions en pause avant le retrait", async ({ browser, org }) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    const missionId = await seedMission(org.orgId, owner.userId, { name: 'Mission Retrait E2E' });
    const member = await addMember(org.orgId, 'member', 'sortant');
    org.addExtraUser(member);
    const memberName = `Marc Sortant ${rand()}`;
    await admin().from('profiles').update({ display_name: memberName }).eq('user_id', member.userId);
    const ownerAccount = await seedLinkedInAccount(org.orgId, owner.userId, `acc_e2e_${rand()}`);
    const memberAccount = await seedLinkedInAccount(org.orgId, member.userId, `acc_e2e_${rand()}`);

    const seq = await seedMissionSequence(org.orgId, member.userId, missionId, 'Séquence du membre e2e');
    const alice = await seedEnrolled(org.orgId, seq.sequenceId, seq.steps[0], member.userId, memberAccount, 'Alice Martin', new Date(Date.now() + 2 * HOUR));
    const bruno = await seedEnrolled(org.orgId, seq.sequenceId, seq.steps[0], member.userId, memberAccount, 'Bruno Petit', new Date(Date.now() + 26 * HOUR));
    // Témoin : candidat inscrit depuis le compte du propriétaire, jamais touché.
    const ownerSeq = await seedMissionSequence(org.orgId, owner.userId, missionId, 'Séquence du propriétaire e2e');
    const chloe = await seedEnrolled(org.orgId, ownerSeq.sequenceId, ownerSeq.steps[0], owner.userId, ownerAccount, 'Chloé Durand', new Date(Date.now() + 3 * HOUR));

    const page = await openAs(browser, owner, [ownerAccount, memberAccount]);
    // Ordre des appels : arrêt des envois (réponse reçue) puis retrait du membre.
    const events: string[] = [];
    page.on('response', (res) => {
      if (res.url().includes('/functions/v1/unipile-accounts') && res.request().method() === 'POST'
        && res.request().postData()?.includes('stop_member_linkedin')) {
        events.push(`stop:${res.status()}`);
      }
    });
    page.on('request', (req) => {
      if (req.method() === 'DELETE' && req.url().includes('/rest/v1/organization_members')) events.push('delete_member');
    });

    await page.goto('/settings/org/team', { waitUntil: 'domcontentloaded' });
    const removeButton = page.getByRole('button', { name: `Retirer ${memberName} de l'équipe` });
    await expect(removeButton).toBeVisible({ timeout: 30_000 });
    await removeButton.click();

    const confirm = page.getByRole('alertdialog', { name: 'Retirer ce membre de l\'équipe ?' });
    await expect(confirm).toContainText('Ses séquences en cours (2 candidats) seront mises en pause', { timeout: 15_000 });
    await confirm.getByRole('button', { name: 'Retirer de l\'équipe' }).click();

    await expect(toast(page, 'Membre retiré')).toBeVisible({ timeout: 20_000 });
    await expect(toast(page, '2 relances mises en pause')).toBeVisible();
    await expect(confirm).toBeHidden();
    await expect(removeButton).toHaveCount(0);

    expect(events, 'envois arrêtés avant le retrait du membre').toEqual(['stop:200', 'delete_member']);

    // Ses inscriptions sont en pause manuelle, leurs étapes gardent statut et date.
    for (const e of [alice, bruno]) {
      expect(await enrollmentRow(e.enrollmentId)).toMatchObject({ status: 'paused', pause_reason: 'manual' });
      const rows = await executionRows(e.enrollmentId);
      expect(rows.length).toBe(1);
      expect(rows[0].status, 'étape en attente conservée').toBe('scheduled');
      expect(ms(rows[0].scheduled_at), 'date prévue inchangée').toBe(e.scheduledAt.getTime());
    }
    expect((await enrollmentRow(chloe.enrollmentId)).status, 'candidat du propriétaire intact').toBe('active');

    // Le membre et la liaison de son compte ont disparu.
    const { data: membership } = await admin()
      .from('organization_members').select('id').eq('organization_id', org.orgId).eq('user_id', member.userId);
    expect(membership ?? [], 'membre retiré').toHaveLength(0);
    const { data: links } = await admin()
      .from('member_linkedin_accounts').select('id').eq('organization_id', org.orgId).eq('user_id', member.userId);
    expect(links ?? [], 'liaison LinkedIn retirée').toHaveLength(0);
  });
});

// ─── Lot 5b : gestes immédiats avec « Annuler » (décision 3) ────────────────

/** Statut et tracking d'une inscription (arrêt manuel compris). */
async function stopState(id: string) {
  const { data, error } = await admin()
    .from('sequence_enrollments')
    .select('status, pause_reason, completed_at, tracking_data')
    .eq('id', id)
    .single();
  if (error) throw new Error(`stopState: ${error.message}`);
  return data as { status: string; pause_reason: string | null; completed_at: string | null; tracking_data: Record<string, unknown> | null };
}

test.describe('Séquences — pause et arrêt immédiats, avec « Annuler » (lot 5b)', () => {
  test('pause d’un candidat sans fenêtre, puis « Annuler » : reprise serveur, date de l’étape gardée', async ({ browser, org }) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    const missionId = await seedMission(org.orgId, owner.userId, { name: 'Mission Pause Annuler 5b' });
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_5b_${rand()}`);
    const seq = await seedMissionSequence(org.orgId, owner.userId, missionId, 'Pause annuler 5b');
    const alice = await seedEnrolled(org.orgId, seq.sequenceId, seq.steps[0], owner.userId, account, 'Alice Martin', new Date(Date.now() + 3 * HOUR));

    const page = await openAs(browser, owner, [account]);
    await openOutreach(page, missionId, seq.name);
    const panel = await openEnrollmentsPanel(page, seq.name);
    await panel.getByRole('button', { name: 'Actions pour Alice Martin' }).click();
    await page.getByRole('menuitem', { name: 'Mettre en pause pour ce candidat' }).click();

    const paused = toast(page, 'Séquence mise en pause pour Alice Martin.');
    await expect(paused).toBeVisible({ timeout: 15_000 });
    await expect(paused.getByRole('status')).toBeVisible();
    await expect(page.getByRole('alertdialog'), 'aucune fenêtre de confirmation').toHaveCount(0);
    expect(await enrollmentRow(alice.enrollmentId)).toMatchObject({ status: 'paused', pause_reason: 'manual' });

    // « Annuler » : resume_enrollments sur cette seule inscription.
    const resumeCalls: string[][] = [];
    page.on('request', (req) => {
      if (req.method() !== 'POST' || !req.url().includes('/functions/v1/process-sequences')) return;
      try {
        const body = req.postDataJSON() as { action?: string; enrollment_ids?: string[] } | null;
        if (body?.action === 'resume_enrollments') resumeCalls.push(body.enrollment_ids ?? []);
      } catch {
        /* pas de corps JSON */
      }
    });
    await paused.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect(toast(page, 'Pause annulée.')).toBeVisible({ timeout: 20_000 });
    expect(resumeCalls).toEqual([[alice.enrollmentId]]);
    expect(await enrollmentRow(alice.enrollmentId)).toMatchObject({ status: 'active', pause_reason: null });
    const rows = await executionRows(alice.enrollmentId);
    expect(rows.length, 'aucune exécution créée ni supprimée').toBe(1);
    expect(rows[0].status).toBe('scheduled');
    expect(ms(rows[0].scheduled_at), 'date prévue gardée').toBe(alice.scheduledAt.getTime());
  });

  test('« Arrêter pour ce candidat » sans fenêtre, puis « Annuler » ; nouvel arrêt, statut « Arrêtée par … » et « Relancer la séquence »', async ({ browser, org }) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    await admin().from('profiles').update({ display_name: 'Guillaume Martin' }).eq('user_id', owner.userId);
    const missionId = await seedMission(org.orgId, owner.userId, { name: 'Mission Arrêt Annuler 5b' });
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_5b_${rand()}`);
    const seq = await seedMissionSequence(org.orgId, owner.userId, missionId, 'Arrêt annuler 5b');
    const alice = await seedEnrolled(org.orgId, seq.sequenceId, seq.steps[0], owner.userId, account, 'Alice Martin', new Date(Date.now() + 3 * HOUR));

    const page = await openAs(browser, owner, [account]);
    await openOutreach(page, missionId, seq.name);
    const panel = await openEnrollmentsPanel(page, seq.name);
    await panel.getByRole('button', { name: 'Actions pour Alice Martin' }).click();
    const stopItem = page.getByRole('menuitem', { name: 'Arrêter pour ce candidat' });
    await expect(stopItem).toContainText('Le candidat reste compté comme contacté pendant 90 jours. Vous pourrez le relancer plus tard.');
    await stopItem.click();

    const stopped = toast(page, 'Séquence arrêtée pour Alice Martin.');
    await expect(stopped).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('alertdialog'), 'aucune fenêtre de confirmation').toHaveCount(0);
    const afterStop = await stopState(alice.enrollmentId);
    expect(afterStop.status).toBe('completed');
    expect(afterStop.tracking_data?.completion_reason).toBe('manual_stop');
    const exec = await executionRow(alice.executionId);
    expect(exec.status, 'étape en attente annulée').toBe('cancelled');

    // « Annuler » : undo_stop_enrollments, la séquence reprend là où elle en était.
    await stopped.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect(toast(page, 'Arrêt annulé : Alice Martin reprend la séquence là où elle en était.')).toBeVisible({ timeout: 20_000 });
    const afterUndo = await stopState(alice.enrollmentId);
    expect(afterUndo).toMatchObject({ status: 'active', pause_reason: null, completed_at: null });
    expect(afterUndo.tracking_data?.completion_reason).toBeUndefined();
    expect(afterUndo.tracking_data?.manual_stop).toBeUndefined();
    const rearmed = await executionRow(alice.executionId);
    expect(rearmed.status, 'étape réarmée').toBe('scheduled');
    expect(ms(rearmed.scheduled_at), 'à sa date prévue').toBe(alice.scheduledAt.getTime());

    // Nouvel arrêt laissé tel quel : statut « Arrêtée par … le … », puis « Relancer la séquence ».
    await panel.getByRole('button', { name: 'Actions pour Alice Martin' }).click();
    await page.getByRole('menuitem', { name: 'Arrêter pour ce candidat' }).click();
    await expect(toast(page, 'Séquence arrêtée pour Alice Martin.').last()).toBeVisible({ timeout: 20_000 });
    await expect(panel.getByText(/^Arrêtée par Guillaume Martin le \d{2}\/\d{2}$/)).toBeVisible({ timeout: 15_000 });
    expect((await stopState(alice.enrollmentId)).status).toBe('completed');

    await panel.getByRole('button', { name: 'Actions pour Alice Martin' }).click();
    await page.getByRole('menuitem', { name: 'Relancer la séquence' }).click();
    const relaunch = page.getByRole('alertdialog', { name: 'Relancer Alice Martin ?' });
    await expect(relaunch).toContainText('La séquence reprend là où elle a été arrêtée');
    await relaunch.getByRole('button', { name: 'Relancer', exact: true }).click();
    await expect(toast(page, 'Séquence relancée pour Alice Martin')).toBeVisible({ timeout: 20_000 });
    const relaunched = await stopState(alice.enrollmentId);
    expect(relaunched.status).toBe('active');
    expect(relaunched.tracking_data?.completion_reason, 'trace de l’arrêt retirée').toBeUndefined();
    expect((await executionRow(alice.executionId)).status, 'étape « Arrêt manuel » réarmée').toBe('scheduled');
  });

  test('« Arrêter » groupé sans fenêtre, puis « Annuler » : candidats en cours et en pause arrêtés, puis remis comme avant', async ({ browser, org }) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    const missionId = await seedMission(org.orgId, owner.userId, { name: 'Mission Arrêt groupé 5b' });
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_5b_${rand()}`);
    const seq = await seedMissionSequence(org.orgId, owner.userId, missionId, 'Arrêt groupé 5b');
    const alice = await seedEnrolled(org.orgId, seq.sequenceId, seq.steps[0], owner.userId, account, 'Alice Martin', new Date(Date.now() + 2 * HOUR));
    const bruno = await seedEnrolled(org.orgId, seq.sequenceId, seq.steps[0], owner.userId, account, 'Bruno Petit', new Date(Date.now() + 5 * HOUR));
    // Candidate en pause manuelle avant le geste : arrêtée aussi, puis remise en pause.
    const chloe = await seedEnrollment(org.orgId, seq.sequenceId, owner.userId, {
      profile_name: 'Chloé Durand', account_id: account, user_timezone: 'Europe/Paris', status: 'paused', pause_reason: 'manual',
    });
    await seedExecution(org.orgId, chloe, seq.steps[0], { scheduled_at: new Date(Date.now() + 4 * HOUR).toISOString() });

    const page = await openAs(browser, owner, [account]);
    await openOutreach(page, missionId, seq.name);
    const panel = await openEnrollmentsPanel(page, seq.name);
    const stopAll = panel.getByRole('button', { name: 'Arrêter (3)', exact: true });
    await expect(stopAll, 'arrêt groupé proposé au propriétaire, avec l’effectif').toBeVisible({ timeout: 15_000 });
    await stopAll.click();

    const stopped = toast(page, 'Séquence arrêtée pour 3 candidats.');
    await expect(stopped).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('alertdialog'), 'aucune fenêtre de confirmation').toHaveCount(0);
    for (const id of [alice.enrollmentId, bruno.enrollmentId, chloe]) {
      const row = await stopState(id);
      expect(row.status, 'arrêtée').toBe('completed');
      expect(row.tracking_data?.completion_reason).toBe('manual_stop');
      expect(row.tracking_data?.manual_stop).toEqual(expect.objectContaining({ by: owner.userId }));
    }
    expect((await stopState(chloe)).tracking_data?.manual_stop).toEqual(expect.objectContaining({ previous_status: 'paused', previous_pause_reason: 'manual' }));

    await stopped.getByRole('button', { name: 'Annuler', exact: true }).click();
    const undone = toast(page, 'Arrêt annulé pour 3 candidats.');
    await expect(undone).toBeVisible({ timeout: 30_000 });
    await expect(undone).toContainText('De nouveau en pause : 1 candidat.');
    for (const e of [alice, bruno]) {
      expect(await stopState(e.enrollmentId)).toMatchObject({ status: 'active', pause_reason: null, completed_at: null });
      const rows = await executionRows(e.enrollmentId);
      expect(rows[0].status, 'étape réarmée').toBe('scheduled');
      expect(ms(rows[0].scheduled_at), 'à sa date prévue').toBe(e.scheduledAt.getTime());
    }
    expect(await stopState(chloe), 'en pause avant l’arrêt : de nouveau en pause').toMatchObject({ status: 'paused', pause_reason: 'manual', completed_at: null });
  });

  test('mise en pause de la séquence sans fenêtre, puis « Annuler » : seules les inscriptions rendues reprennent ; Échap ferme sans annuler', async ({ browser, org }) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    const missionId = await seedMission(org.orgId, owner.userId, { name: 'Mission Pause Séquence 5b' });
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_5b_${rand()}`);
    const seq = await seedMissionSequence(org.orgId, owner.userId, missionId, 'Pause séquence 5b');
    const alice = await seedEnrolled(org.orgId, seq.sequenceId, seq.steps[0], owner.userId, account, 'Alice Martin', new Date(Date.now() + 2 * HOUR));
    const bruno = await seedEnrolled(org.orgId, seq.sequenceId, seq.steps[0], owner.userId, account, 'Bruno Petit', new Date(Date.now() + 5 * HOUR));
    // Pause posée par le moteur avant le geste : « Annuler » ne la lève pas.
    const chloe = await seedEnrollment(org.orgId, seq.sequenceId, owner.userId, {
      profile_name: 'Chloé Durand', account_id: account, user_timezone: 'Europe/Paris', status: 'paused', pause_reason: 'auto_paused',
    });
    await seedExecution(org.orgId, chloe, seq.steps[0], { scheduled_at: new Date(Date.now() + 4 * HOUR).toISOString() });

    const page = await openAs(browser, owner, [account]);
    await openOutreach(page, missionId, seq.name);
    const sequenceActive = async () => {
      const { data } = await admin().from('outreach_sequences').select('is_active').eq('id', seq.sequenceId).single();
      return data?.is_active;
    };

    await page.getByRole('switch', { name: `Mettre en pause la séquence ${seq.name}` }).click();
    const paused = toast(page, 'Séquence mise en pause : 2 candidats en pause.');
    await expect(paused).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('alertdialog'), 'aucune fenêtre de confirmation').toHaveCount(0);
    expect(await sequenceActive()).toBe(false);
    for (const e of [alice, bruno]) {
      expect(await enrollmentRow(e.enrollmentId)).toMatchObject({ status: 'paused', pause_reason: 'sequence_inactive' });
    }

    await paused.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect(toast(page, 'Pause annulée.')).toBeVisible({ timeout: 30_000 });
    expect(await sequenceActive(), 'interrupteur remis').toBe(true);
    await expect(page.getByRole('switch', { name: `Mettre en pause la séquence ${seq.name}` })).toBeChecked({ timeout: 15_000 });
    for (const e of [alice, bruno]) {
      expect(await enrollmentRow(e.enrollmentId)).toMatchObject({ status: 'active', pause_reason: null });
      const rows = await executionRows(e.enrollmentId);
      expect(rows[0].status).toBe('scheduled');
      expect(ms(rows[0].scheduled_at), 'date prévue gardée').toBe(e.scheduledAt.getTime());
    }
    expect(await enrollmentRow(chloe), 'pause posée par le moteur gardée').toMatchObject({ status: 'paused', pause_reason: 'auto_paused' });

    // Nouvelle mise en pause, toast fermé par Échap : rien n'est annulé.
    await page.getByRole('switch', { name: `Mettre en pause la séquence ${seq.name}` }).click();
    const again = toast(page, 'Séquence mise en pause : 2 candidats en pause.').last();
    await expect(again).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press('Escape');
    await expect(toast(page, 'Séquence mise en pause : 2 candidats en pause.')).toHaveCount(0, { timeout: 10_000 });
    expect(await sequenceActive(), 'la séquence reste en pause').toBe(false);
    for (const e of [alice, bruno]) {
      expect((await enrollmentRow(e.enrollmentId)).status).toBe('paused');
    }
  });
});
