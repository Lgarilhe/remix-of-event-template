/**
 * Refonte mission, lot 5f-2b : onglet « Contactés » du panneau Prise de contact
 * et pastille du bouton « Prise de contact » (interrupteur des séquences allumé).
 *
 *  - six candidats : une réponse, un envoi bloqué (compte déconnecté), un en
 *    cours, un terminé, un contacté à la main (sans inscription) et un retenu
 *    sans inscription (absent de la liste) ; l'onglet s'ouvre sur Contactés
 *    parce qu'il a des lignes, chaque candidat est dans son groupe, « Sans
 *    suite » est replié, « Séquences » s'écrit dans l'adresse et survit à un
 *    rechargement ;
 *  - mission sans candidat contacté : « Séquences » s'ouvre, « Contactés » dit
 *    qu'il n'y a personne ;
 *  - pastille du bouton : « 1 bloqué » puis « 1 réponse » (lecture de
 *    get_mission_attention), jamais de zéro, nom du bouton inchangé ;
 *  - « Mettre en pause » d'une ligne : écriture gardée du lot 5b, la ligne
 *    passe « En pause ».
 *
 * Harnais : stack locale (vraie base, vraies gardes). L'appel du navigateur à la
 * fonction des comptes LinkedIn est simulé (liste des comptes).
 */
import type { Browser, BrowserContext, Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures';
import {
  admin,
  createOrg,
  deleteOrg,
  seedCandidateRow,
  seedEnrollment,
  seedExecution,
  seedLinkedInAccount,
  seedMission,
  seedMissionConversation,
  seedSequence,
  setOrgPlan,
  storageStateForUser,
  type TestOrg,
} from '../helpers/supabase-admin';

test.describe.configure({ timeout: 150_000 });

const rand = () => Math.random().toString(36).slice(2, 10);

const contexts: BrowserContext[] = [];
const orgsToDelete: TestOrg[] = [];
test.afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close().catch(() => undefined);
  while (orgsToDelete.length) {
    const org = orgsToDelete.pop()!;
    await admin().from('job_candidate_status').delete().eq('organization_id', org.orgId);
    await deleteOrg(org);
  }
});

interface Workspace {
  org: TestOrg;
  accountId: string;
  missionId: string;
  sequenceId: string;
  stepId: string;
}

async function workspace(label: string): Promise<Workspace> {
  const org = await createOrg('agency', label);
  orgsToDelete.push(org);
  await setOrgPlan(org.orgId);
  const accountId = await seedLinkedInAccount(org.orgId, org.owner.userId, `acc_ctc_${rand()}`, 'OK');
  const missionId = await seedMission(org.orgId, org.owner.userId, { name: `Mission contactés ${rand()}` });
  const { sequenceId, steps } = await seedSequence(org.orgId, org.owner.userId, [{ action_type: 'message' }, { action_type: 'message' }]);
  const { error } = await admin().from('outreach_sequences').update({ project_id: missionId }).eq('id', sequenceId);
  if (error) throw new Error(`workspace(project_id): ${error.message}`);
  return { org, accountId, missionId, sequenceId, stepId: steps[0].id };
}

interface Seeded {
  enrollmentId: string | null;
  rowId: string;
}

/** Candidat de la mission : ligne du Pipeline à l'étape voulue, et inscription si elle est demandée. */
async function candidate(
  ws: Workspace,
  key: string,
  name: string,
  stage: 'retained' | 'contacted' | 'replied',
  enrollment: Record<string, unknown> | null,
): Promise<Seeded> {
  const row = await seedCandidateRow({
    orgId: ws.org.orgId,
    createdBy: ws.org.owner.userId,
    missionId: ws.missionId,
    candidateId: key,
    stage,
    extra: { candidate_name: name, candidate_headline: `Poste de ${name}` },
  });
  if (!enrollment) return { enrollmentId: null, rowId: row.id };
  const enrollmentId = await seedEnrollment(ws.org.orgId, ws.sequenceId, ws.org.owner.userId, {
    profile_id: key,
    profile_name: name,
    account_id: ws.accountId,
    job_id: `project:${ws.missionId}`,
    ...enrollment,
  });
  return { enrollmentId, rowId: row.id };
}

async function openContext(browser: Browser, ws: Workspace): Promise<BrowserContext> {
  const context = await browser.newContext({
    storageState: await storageStateForUser(ws.org.owner, 'v3'),
    timezoneId: 'Europe/Paris',
  });
  contexts.push(context);
  await context.route('**/functions/v1/unipile-accounts', async (route: Route) => {
    let body: { action?: string } | null = null;
    try {
      body = route.request().postDataJSON() as typeof body;
    } catch {
      body = null;
    }
    if (body?.action === 'list') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, accounts: [{ id: ws.accountId, account_status: 'OK', provider: 'LINKEDIN', name: 'E2E LinkedIn' }] }),
      });
    }
    return route.continue();
  });
  return context;
}

const panelUrl = (ws: Workspace, extra = '') => `/missions/${ws.missionId}?nouvelle-mission=1&panneau=contact${extra}`;
const group = (page: Page, key: string) => page.locator(`[data-contacted-group="${key}"]`);
const toast = (page: Page, text: string | RegExp) => page.locator('[data-sonner-toast]').filter({ hasText: text });

async function seedSix(ws: Workspace) {
  const alice = await candidate(ws, 'cand_alice', 'Alice Martin', 'replied', { status: 'replied', replied_at: new Date().toISOString() });
  const bruno = await candidate(ws, 'cand_bruno', 'Bruno Petit', 'contacted', { status: 'paused', pause_reason: 'account_disconnected' });
  const chloe = await candidate(ws, 'cand_chloe', 'Chloé Durand', 'retained', { status: 'active' });
  const dan = await candidate(ws, 'cand_dan', 'Dan Roux', 'contacted', { status: 'completed', completed_at: new Date().toISOString() });
  const eva = await candidate(ws, 'cand_eva', 'Eva Lambert', 'contacted', null);
  const fred = await candidate(ws, 'cand_fred', 'Fred Morel', 'retained', null);
  await seedExecution(ws.org.orgId, chloe.enrollmentId!, { id: ws.stepId, step_order: 0, action_type: 'message' });
  return { alice, bruno, chloe, dan, eva, fred };
}

test('Contactés : chaque candidat dans son groupe, ouvert par défaut, « Séquences » gardé dans l\'adresse', async ({ browser }) => {
  const ws = await workspace('E2E contactés groupes');
  await seedSix(ws);
  const context = await openContext(browser, ws);
  const page = await context.newPage();
  await page.goto(panelUrl(ws), { waitUntil: 'domcontentloaded' });

  const panel = page.getByTestId('mission-panel');
  const contactes = panel.getByRole('tab', { name: 'Contactés' });
  const sequences = panel.getByRole('tab', { name: 'Séquences' });
  await expect(contactes).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 });
  await expect(sequences).toHaveAttribute('aria-selected', 'false');
  await expect(panel.getByRole('tab', { name: 'Invitations' })).toHaveCount(0);

  // Un groupe par situation.
  await expect(group(page, 'replied')).toContainText('Alice Martin');
  await expect(group(page, 'replied')).toContainText('A répondu le');
  await expect(group(page, 'blocked')).toContainText('Bruno Petit');
  await expect(group(page, 'blocked')).toContainText('En pause : compte LinkedIn déconnecté');
  await expect(group(page, 'waiting')).toContainText('Chloé Durand');
  await expect(group(page, 'waiting')).toContainText('Eva Lambert');
  await expect(group(page, 'waiting')).toContainText('Contacté hors séquence');
  // Retenu sans inscription : pas contacté, pas dans la liste.
  await expect(panel).not.toContainText('Fred Morel');

  // Sans suite : replié au départ, son effectif est dit.
  const closed = group(page, 'closed');
  await expect(closed.getByRole('button', { name: /Sans suite/ })).toHaveAttribute('aria-expanded', 'false');
  await expect(closed.getByText('Dan Roux')).toHaveCount(0);
  await closed.getByRole('button', { name: /Sans suite/ }).click();
  await expect(closed).toContainText('Dan Roux');
  await expect(closed).toContainText('sans réponse');

  // Le geste d'une réponse mène à la messagerie ; celui d'un compte déconnecté, aux connexions.
  await expect(group(page, 'replied').getByRole('link', { name: 'Voir la conversation' })).toHaveAttribute('href', /\/inbox/);

  // « Séquences » s'écrit dans l'adresse et survit à un rechargement.
  await sequences.click();
  await expect(sequences).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/outreach=sequences/);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(panel.getByRole('tab', { name: 'Séquences' })).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 });

  // Retour sur Contactés : adresse et onglet suivent.
  await panel.getByRole('tab', { name: 'Contactés' }).click();
  await expect(page).toHaveURL(/outreach=contactes/);
  await expect(group(page, 'blocked')).toContainText('Bruno Petit');

  // Le nom d'un candidat inscrit ouvre sa fiche.
  await group(page, 'replied').getByRole('button', { name: 'Alice Martin' }).click();
  await expect(page.getByTestId('mission-panel')).toHaveAttribute('data-panel', 'fiche', { timeout: 15_000 });
});

test('mission sans candidat contacté : Séquences s\'ouvre, Contactés dit qu\'il n\'y a personne', async ({ browser }) => {
  const ws = await workspace('E2E contactés vide');
  const context = await openContext(browser, ws);
  const page = await context.newPage();
  await page.goto(panelUrl(ws), { waitUntil: 'domcontentloaded' });
  const panel = page.getByTestId('mission-panel');
  await expect(panel.getByRole('tab', { name: 'Séquences' })).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 });
  await panel.getByRole('tab', { name: 'Contactés' }).click();
  await expect(panel.getByText('Aucun candidat contacté pour l’instant.')).toBeVisible();
  await expect(page).toHaveURL(/outreach=contactes/);
});

test('pastille de « Prise de contact » : bloqués, puis réponses, jamais de zéro, nom du bouton inchangé', async ({ browser }) => {
  const ws = await workspace('E2E contactés pastille');
  const context = await openContext(browser, ws);
  const page = await context.newPage();
  const missionUrl = `/missions/${ws.missionId}?nouvelle-mission=1`;
  const button = page.getByRole('button', { name: 'Prise de contact', exact: true });
  const badge = page.getByTestId('contact-badge');

  // Rien à signaler : pas de pastille, pas de zéro.
  await candidate(ws, 'cand_calme', 'Camille Calme', 'retained', { status: 'active' });
  await page.goto(missionUrl, { waitUntil: 'domcontentloaded' });
  await expect(button).toBeVisible({ timeout: 30_000 });
  await expect(badge).toHaveCount(0);

  // Un envoi bloqué : « 1 bloqué ».
  await candidate(ws, 'cand_bruno', 'Bruno Petit', 'contacted', { status: 'paused', pause_reason: 'account_disconnected' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(badge).toHaveText('1 bloqué', { timeout: 30_000 });
  await expect(button).toHaveAccessibleDescription('1 bloqué');

  // Une réponse non traitée sur mon compte : « 1 réponse » passe devant, la description dit tout.
  await seedMissionConversation({
    orgId: ws.org.orgId,
    projectId: ws.missionId,
    accountId: ws.accountId,
    candidateId: 'cand_bruno',
    createdBy: ws.org.owner.userId,
    lastInboundAt: new Date(),
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(badge).toHaveText('1 réponse', { timeout: 30_000 });
  await expect(button).toHaveAccessibleDescription('1 réponse, 1 bloqué');
  // Le bouton ouvre toujours le panneau.
  await button.click();
  await expect(page.getByTestId('mission-panel').getByRole('heading', { name: 'Prise de contact' })).toBeVisible();
});

test('« Mettre en pause » d\'une ligne : écriture gardée du lot 5b, la ligne passe « En pause »', async ({ browser }) => {
  const ws = await workspace('E2E contactés pause');
  const { chloe } = await seedSix(ws);
  const context = await openContext(browser, ws);
  const page = await context.newPage();
  await page.goto(panelUrl(ws), { waitUntil: 'domcontentloaded' });
  const row = page.locator(`[data-contacted-row="${chloe.enrollmentId}"]`);
  await expect(row).toContainText('En cours', { timeout: 30_000 });
  await row.getByRole('button', { name: 'Mettre en pause' }).click();
  await expect(toast(page, 'Séquence mise en pause pour Chloé Durand.')).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText('En pause');
  await expect(row.getByRole('button', { name: 'Mettre en pause' })).toHaveCount(0);

  const { data } = await admin().from('sequence_enrollments').select('status, pause_reason').eq('id', chloe.enrollmentId!).single();
  expect(data).toEqual({ status: 'paused', pause_reason: 'manual' });
});
