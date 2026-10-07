/**
 * Décisions produit du lot « réponses » vues par le recruteur
 * (docs/audit-2026-09-25-sequences.md, « Décisions produit en attente ») :
 *
 * - 8 : une réponse reçue après la dernière relance passe l'inscription
 *   terminée « A répondu » dans le panneau des inscrits de la mission ;
 * - 10 : quand l'arrêt des autres inscriptions du candidat échoue, l'alerte
 *   « Relances non arrêtées après une réponse » apparaît dans À traiter et
 *   mène aux séquences de la mission ; sans séquence ni mission (InMails
 *   seuls), elle ouvre la fiche du candidat (décision du 07/10/2026).
 *
 * Le webhook tourne pour de vrai (stack locale, E2E_EDGE_FUNCTIONS=1) ; seule
 * la liste des comptes LinkedIn du prestataire est simulée dans le navigateur.
 * La panne est un déclencheur temporaire posé par psql, retiré en fin de test.
 */
import { execFileSync } from 'node:child_process';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
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
  type TestOrg,
  type TestUser,
} from '../helpers/supabase-admin';
import { E2E, pinLegacySequences } from '../helpers/env';

const WEBHOOK_SECRET = process.env.E2E_UNIPILE_WEBHOOK_SECRET ?? '';
const EDGE_DEPLOYED = process.env.E2E_EDGE_FUNCTIONS === '1' && !!WEBHOOK_SECRET;
test.skip(!EDGE_DEPLOYED, 'unipile-webhook non servie (E2E_EDGE_FUNCTIONS=1 et E2E_UNIPILE_WEBHOOK_SECRET pour activer)');
test.describe.configure({ timeout: 150_000, mode: 'serial' });

const HOUR = 3600 * 1000;
const rand = () => Math.random().toString(36).slice(2, 8);
const TIMEZONE = 'Europe/Paris';
const ago = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();

// ─── Nettoyage ──────────────────────────────────────────────────────────────

const contexts: BrowserContext[] = [];
const orgs: Array<{ org: TestOrg; extra: TestUser[] }> = [];
const cleanups: Array<() => void> = [];

test.afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
  while (cleanups.length) {
    try { cleanups.pop()!(); } catch { /* au mieux */ }
  }
  for (const { org, extra } of orgs.splice(0)) {
    await admin().from('job_candidate_status').delete().eq('organization_id', org.orgId);
    await admin().from('notifications').delete().eq('organization_id', org.orgId);
    await admin().from('inmail_queue').delete().eq('organization_id', org.orgId);
    await deleteOrg(org, extra);
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

/** Message du candidat reçu par le webhook LinkedIn (format message_received). */
async function reply(accountId: string, profileId: string) {
  const res = await fetch(`${E2E.supabaseUrl}/functions/v1/unipile-webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: E2E.anonKey, 'unipile-auth': WEBHOOK_SECRET },
    body: JSON.stringify({
      event: 'message_received',
      account_id: accountId,
      account_type: 'LINKEDIN',
      chat_id: `chat_drui_${rand()}${rand()}`,
      message_id: `msg_drui_${rand()}${rand()}`,
      message: 'Bonjour, oui avec plaisir',
      sender: { attendee_provider_id: profileId, attendee_id: 'att_candidate', attendee_name: 'Camille Martin' },
    }),
  });
  return res.status;
}

const psql = (sql: string) => execFileSync(
  'psql',
  ['-h', '127.0.0.1', '-p', '54322', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atc', sql],
  { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8' },
);

/** L'arrêt des inscriptions `ids` (passage à 'stopped') échoue jusqu'à la fin du test. */
function failSiblingStop(ids: string[]) {
  const name = `e2e_drui_fail_${rand()}`;
  psql(
    `CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'échec simulé (e2e)'; END $f$;` +
    `CREATE TRIGGER ${name} BEFORE UPDATE ON public.sequence_enrollments FOR EACH ROW WHEN (NEW.status = 'stopped' AND OLD.id IN (${ids.map((id) => `'${id}'`).join(', ')})) EXECUTE FUNCTION public.${name}();`,
  );
  cleanups.push(() => psql(`DROP TRIGGER IF EXISTS ${name} ON public.sequence_enrollments; DROP FUNCTION IF EXISTS public.${name}();`));
}

/** L'annulation des InMails `ids` (passage à 'cancelled') échoue jusqu'à la fin du test. */
function failInMailCancel(ids: string[]) {
  const name = `e2e_drui_fail_${rand()}`;
  psql(
    `CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'échec simulé (e2e)'; END $f$;` +
    `CREATE TRIGGER ${name} BEFORE UPDATE ON public.inmail_queue FOR EACH ROW WHEN (NEW.status = 'cancelled' AND OLD.id IN (${ids.map((id) => `'${id}'`).join(', ')})) EXECUTE FUNCTION public.${name}();`,
  );
  cleanups.push(() => psql(`DROP TRIGGER IF EXISTS ${name} ON public.inmail_queue; DROP FUNCTION IF EXISTS public.${name}();`));
}

/** Séquence de deux messages rattachée à la mission, nommée pour être retrouvée à l'écran. */
async function missionSequence(orgId: string, createdBy: string, missionId: string, label: string) {
  const { sequenceId, steps } = await seedSequence(orgId, createdBy, [
    { action_type: 'message', delay_days: 1 },
    { action_type: 'message', delay_days: 2 },
  ]);
  const sequenceName = `${label} ${rand()}`;
  await admin().from('outreach_sequences').update({ project_id: missionId, name: sequenceName }).eq('id', sequenceId);
  return { sequenceId, steps, sequenceName };
}

test.describe('Décisions réponses : ce que voit le recruteur', () => {
  // Décision 8
  test('réponse reçue après la dernière relance : le panneau des inscrits montre « A répondu » au lieu de « Terminée »', async ({ browser }) => {
    const org = await createOrg('agency', 'E2E DR8 UI');
    orgs.push({ org, extra: [] });
    await setOrgPlan(org.orgId);
    const owner = org.owner.userId;
    const accountId = await seedLinkedInAccount(org.orgId, owner, `acc_drui_${rand()}`);
    const missionId = await seedMission(org.orgId, owner, { name: `Mission réponse tardive ${rand()}` });
    const { sequenceId, steps, sequenceName } = await missionSequence(org.orgId, owner, missionId, 'Séquence terminée');
    const tag = rand();
    const profileName = `Camille Tardive ${tag}`;
    const profileId = `ACoAAE2EDRUI${tag}${rand()}`;
    const enrollmentId = await seedEnrollment(org.orgId, sequenceId, owner, {
      profile_id: profileId, profile_name: profileName, account_id: accountId, job_id: missionId,
      status: 'completed', completed_at: ago(24), current_step_order: 2, user_timezone: TIMEZONE, created_at: ago(120),
    });
    for (const [i, hoursAgo] of [[0, 72], [1, 24]] as const) {
      await seedExecution(org.orgId, enrollmentId, steps[i], {
        status: 'sent', scheduled_at: ago(hoursAgo), executed_at: ago(hoursAgo), final_message: i === 0 ? 'Bonjour' : 'Relance',
      });
    }

    expect(await reply(accountId, profileId), 'webhook traité').toBe(200);

    const page = await openAs(browser, org.owner, [accountId]);
    await page.goto(`/missions/${missionId}?tab=outreach`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(sequenceName, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: `Voir les candidats inscrits à la séquence ${sequenceName}` }).click();
    const panel = page.getByRole('dialog', { name: new RegExp(sequenceName, 'i') });
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Chargement des inscriptions…')).toHaveCount(0, { timeout: 15_000 });
    await expect(panel.getByText(profileName)).toBeVisible();
    await expect(panel.getByText('A répondu', { exact: true })).toBeVisible();
    await expect(panel.getByText('Terminée', { exact: true })).toHaveCount(0);
  });

  // Décision 10
  test('arrêt des autres relances en échec : l’alerte apparaît dans À traiter et mène aux séquences de la mission', async ({ browser }) => {
    const org = await createOrg('agency', 'E2E DR10 UI');
    const member = await addMember(org.orgId, 'member', 'drui');
    orgs.push({ org, extra: [member] });
    await setOrgPlan(org.orgId);
    const owner = org.owner.userId;
    const ownerAccount = await seedLinkedInAccount(org.orgId, owner, `acc_drui_${rand()}`);
    const memberAccount = await seedLinkedInAccount(org.orgId, member.userId, `acc_drui_${rand()}`);
    const missionId = await seedMission(org.orgId, owner, { name: `Mission alerte ${rand()}` });
    const mine = await missionSequence(org.orgId, owner, missionId, 'Séquence du propriétaire');
    const theirs = await missionSequence(org.orgId, member.userId, missionId, 'Séquence du membre');
    const profileId = `ACoAAE2EDRUI${rand()}${rand()}`;
    const base = { profile_id: profileId, profile_name: 'Camille Martin', status: 'active', current_step_order: 1, user_timezone: TIMEZONE, job_id: missionId };
    const e1 = await seedEnrollment(org.orgId, mine.sequenceId, owner, { ...base, account_id: ownerAccount });
    const e2 = await seedEnrollment(org.orgId, theirs.sequenceId, member.userId, { ...base, account_id: memberAccount });
    for (const [enrollmentId, steps] of [[e1, mine.steps], [e2, theirs.steps]] as const) {
      await seedExecution(org.orgId, enrollmentId, steps[0], { status: 'sent', scheduled_at: ago(48), executed_at: ago(48), final_message: 'Bonjour' });
      await seedExecution(org.orgId, enrollmentId, steps[1], { status: 'scheduled', scheduled_at: new Date(Date.now() + 24 * HOUR).toISOString() });
    }
    failSiblingStop([e2]);

    expect(await reply(ownerAccount, profileId), '500 pour obtenir un rejeu').toBe(500);

    const page = await openAs(browser, org.owner, [ownerAccount]);
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    const alert = page.locator('#sidebar-panel').getByRole('button', { name: /Relances non arrêtées après une réponse/ });
    await expect(alert).toBeVisible({ timeout: 30_000 });
    await alert.click();
    await expect(page).toHaveURL(new RegExp(`/missions/${missionId}\\?tab=outreach`));
  });

  // Décision du 07/10/2026 : l'écran Séquences ne montrait pas le candidat.
  test('annulation des InMails programmés en échec, sans séquence ni mission : l’alerte ouvre la fiche du candidat', async ({ browser }) => {
    const org = await createOrg('agency', 'E2E DR10 UI sans séquence');
    orgs.push({ org, extra: [] });
    await setOrgPlan(org.orgId);
    const owner = org.owner.userId;
    const accountId = await seedLinkedInAccount(org.orgId, owner, `acc_drui_${rand()}`);
    const tag = rand();
    const profileName = `Camille Sans Séquence ${tag}`;
    const profileId = `ACoAAE2EDRUI${tag}${rand()}`;
    const { data, error } = await admin().from('inmail_queue').insert({
      account_id: accountId, recipient_profile_id: profileId, recipient_name: profileName, subject: 'Poste', message: 'Bonjour',
      status: 'scheduled', scheduled_at: new Date(Date.now() + 48 * HOUR).toISOString(), created_by: owner, organization_id: org.orgId,
    }).select('id').single();
    if (error || !data) throw new Error(`inmail_queue: ${error?.message}`);
    failInMailCancel([data.id as string]);

    expect(await reply(accountId, profileId), '500 pour obtenir un rejeu').toBe(500);

    const page = await openAs(browser, org.owner, [accountId]);
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    const alert = page.locator('#sidebar-panel').getByRole('button', { name: /Relances non arrêtées après une réponse/ });
    await expect(alert).toBeVisible({ timeout: 30_000 });
    await alert.click();
    await expect(page).toHaveURL(new RegExp(`/pipeline\\?candidate=${profileId}$`));
    await expect(page.getByRole('dialog').getByText(profileName).first(), 'fiche du candidat ouverte').toBeVisible({ timeout: 30_000 });
  });
});
