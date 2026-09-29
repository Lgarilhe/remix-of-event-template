/**
 * Lot « reply-paths » : après une réponse du candidat, le pipeline (kanban de
 * /pipeline) le montre « Répondu » pour la mission de l'inscription, et
 * « Contacté » pour une autre mission où il est aussi suivi.
 *
 * Contrat : CLAUDE.md, « Séquences : règles du moteur et de l'interface », et
 * docs/audit-2026-09-25-sequences.md : SEQ-006 (pipeline « Répondu » borné à
 * l'organisation et à la mission), SEQ-221 (« Marquer comme répondu » met à
 * jour le pipeline).
 *
 * Données d'un candidat contacté amorcées à la main : job_candidate_status en
 * « messaged », étape de pipeline « Contacté ». Depuis le lot 0b-2b, le serveur
 * pose « Contacté » au premier envoi (status 'messaged', general_stage
 * 'contacted', pipeline_stage laissé vide). Chaque ligne de
 * pipeline porte un nom distinct (suffixe M1 / M2) pour reconnaître sa carte au
 * kanban, qui affiche une carte par ligne.
 *
 * L'action mark_replied et le webhook tournent pour de vrai (stack locale,
 * E2E_EDGE_FUNCTIONS=1). Seule la liste des comptes LinkedIn du prestataire
 * est simulée dans le navigateur.
 *
 * L'observation se fait sur le kanban de /pipeline. Le kanban de l'onglet
 * « pipeline » d'une mission a aussi sa colonne « Répondu » depuis la décision
 * 29 (e2e/flows/seq-decisions-ui.spec.ts).
 */
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
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
import { WEBHOOK_SECRET, postJson } from '../helpers/sequence-engine';

const EDGE_DEPLOYED = process.env.E2E_EDGE_FUNCTIONS === '1';
test.skip(!EDGE_DEPLOYED, 'process-sequences et unipile-webhook non servies (E2E_EDGE_FUNCTIONS=1 pour activer)');
test.describe.configure({ timeout: 150_000 });

const HOUR = 3600 * 1000;
const rand = () => Math.random().toString(36).slice(2, 8);

// ─── Nettoyage ──────────────────────────────────────────────────────────────

const contexts: BrowserContext[] = [];
const orgs: TestOrg[] = [];

test.afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
  for (const org of orgs.splice(0)) {
    await admin().from('job_candidate_status').delete().eq('organization_id', org.orgId);
    await deleteOrg(org);
  }
});

// ─── Navigateur ─────────────────────────────────────────────────────────────

/** Page connectée ; seule l'action `list` de unipile-accounts est simulée. */
async function openAs(browser: Browser, user: TestUser, accountIds: string[]): Promise<Page> {
  const context = await browser.newContext({ storageState: await storageStateForUser(user) });
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

/** Colonne du kanban de /pipeline (aria-label « Colonne <étape>, N candidat(s) »). */
const kanbanColumn = (page: Page, stage: string) => page.locator(`[aria-label^="Colonne ${stage},"]`);

async function openPipeline(page: Page, anyCardName: string) {
  await page.goto('/pipeline', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(anyCardName, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
}

// ─── Données ────────────────────────────────────────────────────────────────

interface Seeded {
  org: TestOrg;
  accountId: string;
  missionId: string;
  sequenceName: string;
  enrollmentId: string;
  profileId: string;
  profileName: string;
  cardM1: string;
  cardM2: string;
}

/**
 * Missions M1 et M2, séquence de deux messages liée à M1, candidat inscrit
 * (job_id = M1) dont le premier message est parti il y a deux jours, relance
 * dans 24 h ; pipeline (M1 et M2) en « messaged » / « Contacté ».
 */
async function seedReplyScene(label: string): Promise<Seeded> {
  const org = await createOrg('agency', `E2E RP UI ${label}`);
  orgs.push(org);
  await setOrgPlan(org.orgId);
  const owner = org.owner.userId;
  const accountId = await seedLinkedInAccount(org.orgId, owner, `acc_e2e_${rand()}`);
  const missionId = await seedMission(org.orgId, owner, { name: `Mission réponse M1 ${rand()}` });
  const otherMissionId = await seedMission(org.orgId, owner, { name: `Mission réponse M2 ${rand()}` });
  const { sequenceId, steps } = await seedSequence(org.orgId, owner, [
    { action_type: 'message', delay_days: 1 },
    { action_type: 'message', delay_days: 2 },
  ]);
  const sequenceName = `Réponses ${label} ${rand()}`;
  await admin().from('outreach_sequences').update({ project_id: missionId, name: sequenceName }).eq('id', sequenceId);
  const tag = rand();
  const profileId = `ACoAAE2EUI${tag}${rand()}`;
  const profileName = `Camille Réponse ${tag}`;
  const enrollmentId = await seedEnrollment(org.orgId, sequenceId, owner, {
    profile_id: profileId,
    profile_name: profileName,
    profile_url: `https://www.linkedin.com/in/camille-${tag}`,
    account_id: accountId,
    job_id: missionId,
    current_step_order: 1,
    user_timezone: 'Europe/Paris',
  });
  const sentAt = new Date(Date.now() - 48 * HOUR).toISOString();
  await seedExecution(org.orgId, enrollmentId, steps[0], { status: 'sent', scheduled_at: sentAt, executed_at: sentAt, final_message: 'Bonjour' });
  await seedExecution(org.orgId, enrollmentId, steps[1], { scheduled_at: new Date(Date.now() + 24 * HOUR).toISOString() });
  const cardM1 = `${profileName} M1`;
  const cardM2 = `${profileName} M2`;
  for (const [jobId, name] of [[missionId, cardM1], [otherMissionId, cardM2]] as const) {
    const { error } = await admin().from('job_candidate_status').insert({
      organization_id: org.orgId, created_by: owner, job_id: jobId, candidate_id: profileId,
      candidate_name: name, status: 'messaged', pipeline_stage: 'Contacté',
    });
    if (error) throw new Error(`job_candidate_status: ${error.message}`);
  }
  return { org, accountId, missionId, sequenceName, enrollmentId, profileId, profileName, cardM1, cardM2 };
}

async function enrollmentStatus(id: string) {
  const { data } = await admin().from('sequence_enrollments').select('status').eq('id', id).single();
  return (data as { status: string } | null)?.status;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

test.describe('Réponse du candidat : pipeline de la mission', () => {
  // ui-kanban-repondu-apres-reponse (bouton « Marquer comme ayant répondu »)
  test('« Marquer comme ayant répondu » dans le panneau des inscrits : carte « Répondu » pour la mission de la séquence, « Contacté » pour l’autre mission', async ({ browser }) => {
    const s = await seedReplyScene('bouton');
    const page = await openAs(browser, s.org.owner, [s.accountId]);

    await page.goto(`/missions/${s.missionId}?tab=outreach`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(s.sequenceName, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: `Voir les candidats inscrits à la séquence ${s.sequenceName}` }).click();
    const panel = page.getByRole('dialog', { name: new RegExp(s.sequenceName, 'i') });
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Chargement des inscriptions…')).toHaveCount(0, { timeout: 15_000 });
    await panel.getByRole('button', { name: `Actions pour ${s.profileName}` }).click();
    await page.getByRole('menuitem', { name: 'Marquer comme ayant répondu' }).click();
    const confirm = page.getByRole('alertdialog', { name: `Marquer ${s.profileName} comme ayant répondu ?` });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Marquer comme ayant répondu' }).click();
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: `Réponse enregistrée pour ${s.profileName}` })).toBeVisible({ timeout: 20_000 });
    expect(await enrollmentStatus(s.enrollmentId), 'inscription close « A répondu »').toBe('replied');

    await openPipeline(page, s.cardM2);
    // DÉFAUT moteur-pipeline-ignore-messaged : mark_replied laisse la ligne « messaged » / « Contacté » : carte M1 restée dans « Contacté ».
    await expect.soft(kanbanColumn(page, 'Répondu').getByText(s.cardM1, { exact: true }), 'mission de la séquence : colonne « Répondu »').toBeVisible();
    await expect.soft(kanbanColumn(page, 'Contacté').getByText(s.cardM2, { exact: true }), 'autre mission : colonne « Contacté »').toBeVisible();
  });

  // ui-kanban-repondu-apres-reponse (réponse détectée par le webhook)
  test('réponse LinkedIn reçue par webhook avant l’ouverture : carte « Répondu » pour la mission de la séquence, « Contacté » pour l’autre mission', async ({ browser }) => {
    const s = await seedReplyScene('webhook');
    const res = await postJson('/functions/v1/unipile-webhook', {
      event: 'message_received',
      account_id: s.accountId,
      account_type: 'LINKEDIN',
      chat_id: `chat_${rand()}`,
      message_id: `msg_${rand()}${rand()}`,
      message: 'Bonjour, oui avec plaisir',
      sender: { attendee_provider_id: s.profileId, attendee_id: 'att_candidate', attendee_name: s.profileName },
    }, { 'unipile-auth': WEBHOOK_SECRET });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await enrollmentStatus(s.enrollmentId), 'inscription close « A répondu »').toBe('replied');

    const page = await openAs(browser, s.org.owner, [s.accountId]);
    await openPipeline(page, s.cardM1);
    await expect.soft(kanbanColumn(page, 'Répondu').getByText(s.cardM1, { exact: true }), 'mission de la séquence : colonne « Répondu »').toBeVisible();
    // DÉFAUT webhook-pipeline-toutes-missions : le webhook passe aussi la ligne de M2 en « Répondu ».
    await expect.soft(kanbanColumn(page, 'Contacté').getByText(s.cardM2, { exact: true }), 'autre mission : colonne « Contacté »').toBeVisible();
  });
});
