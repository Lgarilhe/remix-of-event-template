/**
 * Lot « late-reply » : réponse du candidat arrivée après la fin de sa
 * séquence, vue depuis le panneau des inscrits (onglet « outreach » de la
 * mission).
 *
 * Contrat : docs/audit-2026-09-25-sequences.md, décision SEQ-004 (« Relancer »
 * un candidat qui a répondu, seulement via un dialogue explicite qui rappelle
 * la date de réponse) et SEQ-220 (date de réponse gardée).
 *
 * La réponse tardive est enregistrée par « Marquer comme ayant répondu » sur la
 * ligne terminée (le webhook l'enregistre aussi depuis la décision produit 8,
 * voir e2e/flows/seq-decisions-reply.spec.ts). L'action mark_replied tourne
 * pour de vrai (stack locale, E2E_EDGE_FUNCTIONS=1) ; seule la liste des
 * comptes LinkedIn du prestataire est simulée dans le navigateur.
 */
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { pinLegacySequences } from '../helpers/env';
import {
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
  type TestOrg,
  type TestUser,
} from '../helpers/supabase-admin';

const EDGE_DEPLOYED = process.env.E2E_EDGE_FUNCTIONS === '1';
test.skip(!EDGE_DEPLOYED, 'process-sequences non servie (E2E_EDGE_FUNCTIONS=1 pour activer)');
test.describe.configure({ timeout: 150_000 });

const HOUR = 3600 * 1000;
const rand = () => Math.random().toString(36).slice(2, 8);
const TIMEZONE = 'Europe/Paris';

// ─── Nettoyage ──────────────────────────────────────────────────────────────

const contexts: BrowserContext[] = [];
const orgs: TestOrg[] = [];

test.afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
  for (const org of orgs.splice(0)) {
    await admin().from('job_candidate_status').delete().eq('organization_id', org.orgId);
    await admin().from('notifications').delete().eq('organization_id', org.orgId);
    await deleteOrg(org);
  }
});

/** Page connectée (fuseau de Paris) ; seule l'action `list` de unipile-accounts est simulée. */
async function openAs(browser: Browser, user: TestUser, accountIds: string[]): Promise<Page> {
  const context = await browser.newContext({ storageState: await storageStateForUser(user), timezoneId: TIMEZONE, locale: 'fr-FR' });
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

async function enrollmentRow(id: string) {
  const { data, error } = await admin().from('sequence_enrollments')
    .select('status, replied_at, completed_at, tracking_data').eq('id', id).single();
  if (error || !data) throw new Error(`enrollmentRow: ${error?.message}`);
  return data as { status: string; replied_at: string | null; completed_at: string | null; tracking_data: Record<string, unknown> | null };
}

/** Date au format du dialogue (date-fns « d MMMM yyyy », français), dans le fuseau du navigateur. */
function frenchDate(iso: string) {
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TIMEZONE }).format(new Date(iso));
}

test.describe('Réponse tardive : panneau des inscrits', () => {
  // completed-reply-re-enroll-dialog (SEQ-004)
  test('réponse tardive enregistrée sur une séquence terminée : le dialogue « Relancer » rappelle « a répondu le <date> : vérifiez que la conversation est bien close »', async ({ browser }) => {
    const org = await createOrg('agency', 'E2E late UI');
    orgs.push(org);
    await setOrgPlan(org.orgId);
    const owner = org.owner.userId;
    const accountId = await seedLinkedInAccount(org.orgId, owner, `acc_late_${rand()}`);
    const missionId = await seedMission(org.orgId, owner, { name: `Mission réponse tardive ${rand()}` });
    const { sequenceId, steps } = await seedSequence(org.orgId, owner, [
      { action_type: 'message', delay_days: 1 },
      { action_type: 'message', delay_days: 2 },
    ]);
    const sequenceName = `Séquence terminée ${rand()}`;
    await admin().from('outreach_sequences').update({ project_id: missionId, name: sequenceName }).eq('id', sequenceId);
    const tag = rand();
    const profileName = `Camille Tardive ${tag}`;
    const completedAt = new Date(Date.now() - 24 * HOUR).toISOString();
    const enrollmentId = await seedEnrollment(org.orgId, sequenceId, owner, {
      profile_id: `ACoAAE2ELATE${tag}${rand()}`,
      profile_name: profileName,
      profile_url: `https://www.linkedin.com/in/camille-tardive-${tag}`,
      account_id: accountId,
      job_id: missionId,
      status: 'completed',
      completed_at: completedAt,
      current_step_order: 2,
      user_timezone: TIMEZONE,
      created_at: new Date(Date.now() - 5 * 24 * HOUR).toISOString(),
    });
    for (const [i, hoursAgo] of [[0, 72], [1, 24]] as const) {
      const at = new Date(Date.now() - hoursAgo * HOUR).toISOString();
      await seedExecution(org.orgId, enrollmentId, steps[i], { status: 'sent', scheduled_at: at, executed_at: at, final_message: i === 0 ? 'Bonjour' : 'Relance' });
    }

    const page = await openAs(browser, org.owner, [accountId]);
    await page.goto(`/missions/${missionId}?tab=outreach`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(sequenceName, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: `Voir les candidats inscrits à la séquence ${sequenceName}` }).click();
    const panel = page.getByRole('dialog', { name: new RegExp(sequenceName, 'i') });
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Chargement des inscriptions…')).toHaveCount(0, { timeout: 15_000 });

    // La réponse arrivée après la dernière relance est enregistrée depuis la ligne terminée.
    await panel.getByRole('button', { name: `Actions pour ${profileName}` }).click();
    await page.getByRole('menuitem', { name: 'Marquer comme ayant répondu' }).click();
    const markDialog = page.getByRole('alertdialog', { name: `Marquer ${profileName} comme ayant répondu ?` });
    await expect(markDialog).toContainText('commencées avant la fin de celle-ci');
    await markDialog.getByRole('button', { name: 'Marquer comme ayant répondu' }).click();
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: `Réponse enregistrée pour ${profileName}` })).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await enrollmentRow(enrollmentId)).status, { timeout: 15_000 }).toBe('replied');
    const recorded = await enrollmentRow(enrollmentId);
    expect(recorded.replied_at, 'date de réponse enregistrée').not.toBeNull();
    expect(new Date(recorded.completed_at!).getTime(), 'date de fin conservée').toBe(new Date(completedAt).getTime());

    // « Relancer » : le dialogue nomme l'action et rappelle la date de la réponse.
    await panel.getByRole('button', { name: `Actions pour ${profileName}` }).click();
    await page.getByRole('menuitem', { name: 'Relancer depuis l’étape suivante' }).click();
    const reEnrollDialog = page.getByRole('alertdialog', { name: `Relancer ${profileName} ?` });
    await expect(reEnrollDialog).toBeVisible();
    await expect(reEnrollDialog).toContainText(
      `${profileName} a répondu le ${frenchDate(recorded.replied_at!)} : vérifiez que la conversation est bien close.`,
    );
    await reEnrollDialog.getByRole('button', { name: 'Annuler' }).click();
    await expect(reEnrollDialog).toHaveCount(0);
    expect((await enrollmentRow(enrollmentId)).status, 'annuler ne relance rien').toBe('replied');
  });
});
