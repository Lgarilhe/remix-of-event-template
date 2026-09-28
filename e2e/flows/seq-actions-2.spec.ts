/**
 * Lot « actions-2 » du module séquences, côté interface : réactivation d'une
 * séquence par un collaborateur (candidats des collègues laissés en pause),
 * désactivation partielle (des candidats restent en cours), retrait d'un
 * membre dont l'arrêt des envois échoue.
 *
 * Contrat : CLAUDE.md, « Séquences : règles du moteur et de l'interface »,
 * et docs/audit-2026-09-25-sequences.md (D3, SEQ-025, SEQ-042, SEQ-119).
 *
 * process-sequences et unipile-accounts tournent pour de vrai (stack locale,
 * E2E_EDGE_FUNCTIONS=1). Seule l'action `list` de unipile-accounts est
 * simulée dans le navigateur (comptes LinkedIn du prestataire). Un échec
 * d'écriture est simulé par un déclencheur temporaire posé par psql, limité
 * aux lignes de l'organisation du test.
 */
import { execFileSync } from 'node:child_process';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import {
  addMember,
  admin,
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
test.describe.configure({ mode: 'serial', timeout: 150_000 });

const HOUR = 3600 * 1000;
const rand = () => Math.random().toString(36).slice(2, 8);

// ─── Contextes et nettoyage ─────────────────────────────────────────────────

const contexts: BrowserContext[] = [];
const cleanups: Array<() => unknown> = [];

test.afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
  while (cleanups.length) {
    try {
      await cleanups.pop()!();
    } catch {
      // best-effort
    }
  }
});

/** Page connectée en `user` ; seule l'action `list` de unipile-accounts est simulée. */
async function openAs(browser: Browser, user: TestUser, accountIds: string[]): Promise<Page> {
  const context = await browser.newContext({ storageState: await storageStateForUser(user) });
  contexts.push(context);
  await context.route('**/functions/v1/unipile-accounts', async (route) => {
    let action: string | undefined;
    try {
      action = (route.request().postDataJSON() as { action?: string } | null)?.action;
    } catch {
      /* pré-vol CORS */
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

async function openOutreach(page: Page, missionId: string, sequenceName: string) {
  await page.goto(`/missions/${missionId}?tab=outreach`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(sequenceName, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
}

const toast = (page: Page, title: string | RegExp) => page.locator('[data-sonner-toast]').filter({ hasText: title });

function psql(sql: string) {
  return execFileSync(
    'psql',
    ['-h', '127.0.0.1', '-p', '54322', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atc', sql],
    { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8' },
  );
}

/** Déclencheur temporaire : toute écriture `event` sur `table` échoue pour cette organisation. */
function failingTrigger(table: string, event: 'INSERT' | 'UPDATE', orgId: string) {
  const name = `e2e_a2_fail_${rand()}${rand()}`;
  psql(
    `CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'échec simulé (e2e)'; END $f$;` +
    `CREATE TRIGGER ${name} BEFORE ${event} ON public.${table} FOR EACH ROW ` +
    `WHEN (NEW.organization_id = '${orgId}'::uuid) EXECUTE FUNCTION public.${name}();`,
  );
  cleanups.push(() => psql(`DROP TRIGGER IF EXISTS ${name} ON public.${table}; DROP FUNCTION IF EXISTS public.${name}();`));
}

// ─── Données ────────────────────────────────────────────────────────────────

async function seedMissionSequence(orgId: string, createdBy: string, missionId: string, label: string) {
  const { sequenceId, steps } = await seedSequence(orgId, createdBy, [
    { action_type: 'message', delay_days: 1 },
    { action_type: 'message', delay_days: 1 },
  ]);
  const name = `${label} ${rand()}`;
  const { error } = await admin().from('outreach_sequences').update({ project_id: missionId, name }).eq('id', sequenceId);
  if (error) throw new Error(`seedMissionSequence: ${error.message}`);
  return { sequenceId, steps, name };
}

/** Inscription depuis le compte de `createdBy`, étape 0 planifiée dans le futur. */
async function seedEnrolled(
  orgId: string,
  sequenceId: string,
  step: SeededStep,
  createdBy: string,
  accountId: string,
  profileName: string,
  overrides: Record<string, unknown> = {},
) {
  const enrollmentId = await seedEnrollment(orgId, sequenceId, createdBy, {
    profile_name: profileName,
    profile_url: `https://www.linkedin.com/in/e2e-${rand()}`,
    account_id: accountId,
    user_timezone: 'Europe/Paris',
    ...overrides,
  });
  await seedExecution(orgId, enrollmentId, step, { scheduled_at: new Date(Date.now() + 26 * HOUR).toISOString() });
  return enrollmentId;
}

async function enrollmentRow(id: string) {
  const { data, error } = await admin().from('sequence_enrollments').select('status, pause_reason').eq('id', id).single();
  if (error) throw new Error(`enrollmentRow: ${error.message}`);
  return data as { status: string; pause_reason: string | null };
}

async function sequenceActive(sequenceId: string) {
  const { data } = await admin().from('outreach_sequences').select('is_active').eq('id', sequenceId).single();
  return data?.is_active as boolean;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

test.describe('Séquences — actions (lot actions-2)', () => {
  // resume-sequence-collaborateur-other-members
  test('un collaborateur réactive sa séquence : ses candidats reprennent, ceux des collègues restent en pause et l’écran avertit au lieu d’un succès', async ({ browser, org }) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    const missionId = await seedMission(org.orgId, owner.userId, { name: 'Mission Collaborateur A2' });
    const collab = await addMember(org.orgId, 'collaborator', 'collab');
    org.addExtraUser(collab);
    await admin().from('mission_team').insert({ project_id: missionId, user_id: collab.userId, role: 'sourcer' });
    const ownerAccount = await seedLinkedInAccount(org.orgId, owner.userId, `acc_a2_${rand()}`);
    const collabAccount = await seedLinkedInAccount(org.orgId, collab.userId, `acc_a2_${rand()}`);

    const seq = await seedMissionSequence(org.orgId, collab.userId, missionId, 'Séquence du collaborateur A2');
    await admin().from('outreach_sequences').update({ is_active: false }).eq('id', seq.sequenceId);
    const paused = { status: 'paused', pause_reason: 'sequence_inactive' };
    const mine = [
      await seedEnrolled(org.orgId, seq.sequenceId, seq.steps[0], collab.userId, collabAccount, 'Alice Martin', paused),
      await seedEnrolled(org.orgId, seq.sequenceId, seq.steps[0], collab.userId, collabAccount, 'Bruno Petit', paused),
    ];
    const theirs = [
      await seedEnrolled(org.orgId, seq.sequenceId, seq.steps[0], owner.userId, ownerAccount, 'Chloé Durand', paused),
      await seedEnrolled(org.orgId, seq.sequenceId, seq.steps[0], owner.userId, ownerAccount, 'David Leroy', paused),
      await seedEnrolled(org.orgId, seq.sequenceId, seq.steps[0], owner.userId, ownerAccount, 'Emma Roux', paused),
    ];

    const page = await openAs(browser, collab, [collabAccount]);
    await openOutreach(page, missionId, seq.name);

    await page.getByRole('switch', { name: `Activer la séquence ${seq.name}` }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Réactiver cette séquence ?' });
    await expect(confirm).toContainText('2 candidats en pause reprendront.');
    await expect(confirm).toContainText(/3 candidats inscrits par\s+d’autres membres resteront en pause/);
    await confirm.getByRole('button', { name: 'Réactiver' }).click();

    const warning = toast(page, 'Séquence réactivée : 2 candidats repris');
    await expect(warning).toBeVisible({ timeout: 30_000 });
    await expect(warning).toHaveAttribute('data-type', 'warning');
    await expect(warning).toContainText('3 candidats inscrits par d’autres membres restent en pause');
    await expect(toast(page, 'Séquence réactivée. 2 candidats repris.'), 'jamais un succès complet').toHaveCount(0);

    expect(await sequenceActive(seq.sequenceId)).toBe(true);
    for (const id of mine) expect(await enrollmentRow(id)).toMatchObject({ status: 'active', pause_reason: null });
    for (const id of theirs) expect(await enrollmentRow(id), 'candidats des collègues laissés en pause').toMatchObject({ status: 'paused', pause_reason: 'sequence_inactive' });
  });

  // desactivation-partielle-reste-active
  test('désactivation pendant qu’un candidat est inscrit : la séquence reste active, le toast le dit et ouvre la liste des inscrits', async ({ browser, org }) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    const missionId = await seedMission(org.orgId, owner.userId, { name: 'Mission Désactivation A2' });
    const account = await seedLinkedInAccount(org.orgId, owner.userId, `acc_a2_${rand()}`);
    const seq = await seedMissionSequence(org.orgId, owner.userId, missionId, 'Séquence partielle A2');
    const first = await seedEnrolled(org.orgId, seq.sequenceId, seq.steps[0], owner.userId, account, 'Alice Martin');

    const page = await openAs(browser, owner, [account]);
    await openOutreach(page, missionId, seq.name);

    // Inscription concurrente : un candidat est inscrit juste après la mise en
    // pause des inscriptions, avant le recompte.
    let latecomer: string | null = null;
    await page.route('**/rest/v1/sequence_enrollments?**', async (route) => {
      if (route.request().method() !== 'PATCH' || latecomer) return route.fallback();
      const response = await route.fetch();
      latecomer = await seedEnrollment(org.orgId, seq.sequenceId, owner.userId, {
        profile_name: 'Bruno Petit', account_id: account, user_timezone: 'Europe/Paris',
      });
      await route.fulfill({ response });
    });

    await page.getByRole('switch', { name: `Mettre en pause la séquence ${seq.name}` }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Désactiver cette séquence ?' });
    await confirm.getByRole('button', { name: 'Désactiver' }).click();

    const stillActive = toast(page, 'La séquence reste active');
    await expect(stillActive).toBeVisible({ timeout: 20_000 });
    await expect(stillActive).toContainText('1 candidat est bien en pause.');
    await expect(stillActive).toContainText('1 candidat reste en cours');
    await expect(toast(page, /^Séquence désactivée/), 'pas de faux succès').toHaveCount(0);

    expect(latecomer, 'inscription concurrente créée').not.toBeNull();
    expect(await sequenceActive(seq.sequenceId), 'séquence non marquée désactivée').toBe(true);
    expect(await enrollmentRow(first)).toMatchObject({ status: 'paused', pause_reason: 'sequence_inactive' });
    expect((await enrollmentRow(latecomer!)).status).toBe('active');
    await expect(page.getByRole('switch', { name: `Mettre en pause la séquence ${seq.name}` }), 'l’interrupteur reste sur « active »').toBeVisible();

    // Accès à la liste des inscrits depuis le toast.
    await stillActive.getByRole('button', { name: 'Voir les inscrits' }).click();
    await expect(page.getByRole('dialog', { name: new RegExp(seq.name, 'i') })).toBeVisible();
  });

  // stop-echec-garde-liaison (écran Équipe)
  test('retrait d’un membre dont l’arrêt des envois échoue : aucun retrait demandé, message d’erreur, membre et liaison conservés', async ({ browser, org }) => {
    const owner = org.owner;
    await setOrgPlan(org.orgId);
    const member = await addMember(org.orgId, 'member', 'sortant');
    org.addExtraUser(member);
    const memberName = `Marc Sortant ${rand()}`;
    await admin().from('profiles').update({ display_name: memberName }).eq('user_id', member.userId);
    const ownerAccount = await seedLinkedInAccount(org.orgId, owner.userId, `acc_a2_${rand()}`);
    const memberAccount = await seedLinkedInAccount(org.orgId, member.userId, `acc_a2_${rand()}`);
    const { error: inmailErr } = await admin().from('inmail_queue').insert({
      organization_id: org.orgId, created_by: member.userId, account_id: memberAccount,
      recipient_profile_id: `ACoAAE2EA2${rand()}${rand()}`, subject: 'Opportunité', message: 'Bonjour',
      status: 'scheduled', scheduled_at: new Date(Date.now() + 26 * HOUR).toISOString(), network_distance: 2,
    });
    if (inmailErr) throw new Error(`inmail_queue: ${inmailErr.message}`);
    cleanups.push(() => admin().from('inmail_queue').delete().eq('organization_id', org.orgId));
    failingTrigger('inmail_queue', 'UPDATE', org.orgId);

    const page = await openAs(browser, owner, [ownerAccount, memberAccount]);
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
    await confirm.getByRole('button', { name: 'Retirer de l\'équipe' }).click();

    await expect(page.locator('[data-sonner-toast][data-type="error"]').filter({ hasText: /pas pu être arrêtés/ })).toBeVisible({ timeout: 20_000 });
    await expect(toast(page, 'Membre retiré'), 'aucun succès annoncé').toHaveCount(0);
    expect(events, 'aucune suppression du membre après l’échec de l’arrêt').toEqual(['stop:500']);
    await expect(confirm, 'la confirmation reste ouverte : rien n’a été retiré').toBeVisible();

    const { data: membership } = await admin()
      .from('organization_members').select('id').eq('organization_id', org.orgId).eq('user_id', member.userId);
    expect(membership ?? [], 'membre toujours dans l’équipe').toHaveLength(1);
    const { data: links } = await admin()
      .from('member_linkedin_accounts').select('id').eq('organization_id', org.orgId).eq('user_id', member.userId);
    expect(links ?? [], 'liaison LinkedIn conservée').toHaveLength(1);
  });
});
