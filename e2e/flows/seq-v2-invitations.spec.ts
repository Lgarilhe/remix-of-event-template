/**
 * Refonte mission, lot 5f-3 : les invitations LinkedIn reçues vivent dans la
 * messagerie (/inbox?onglet=invitations), pour tous.
 *
 *  - la messagerie a l'onglet Invitations, interrupteur des séquences allumé
 *    comme éteint ; une invitation y est acceptée, une autre déclinée ;
 *  - interrupteur allumé : le panneau Prise de contact de la mission n'a plus
 *    l'onglet Invitations, et ?outreach=invitations mène à la messagerie ;
 *  - interrupteur éteint : le panneau provisoire garde son onglet.
 *
 * Harnais : stack locale. Le prestataire LinkedIn ne sert pas la liste des
 * invitations reçues : l'appel du navigateur à la fonction des comptes est
 * simulé (liste des comptes, invitations, acceptation et refus), et les
 * demandes envoyées sont relevées.
 */
import type { Browser, BrowserContext, Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures';
import { pinLegacySequences } from '../helpers/env';
import {
  admin,
  createOrg,
  deleteOrg,
  seedLinkedInAccount,
  seedMission,
  setOrgPlan,
  storageStateForUser,
  type TestOrg,
} from '../helpers/supabase-admin';

test.describe.configure({ timeout: 120_000 });

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
}

async function workspace(label: string): Promise<Workspace> {
  const org = await createOrg('agency', label);
  orgsToDelete.push(org);
  await setOrgPlan(org.orgId);
  const accountId = await seedLinkedInAccount(org.orgId, org.owner.userId, `acc_inv_${rand()}`, 'OK');
  const missionId = await seedMission(org.orgId, org.owner.userId, { name: `Mission invitations ${rand()}` });
  return { org, accountId, missionId };
}

const INVITATIONS = [
  { id: 'inv_alice', inviter_name: 'Alice Martin', inviter_id: 'ACoAAALICE', inviter_public_identifier: 'alice-martin', inviter_description: 'Directrice des opérations', inviter_picture_url: null, invitation_text: null, date: 'il y a 2 jours', parsed_datetime: null, shared_secret: 'secret-a', provider: 'LINKEDIN' },
  { id: 'inv_bruno', inviter_name: 'Bruno Petit', inviter_id: 'ACoAABRUNO', inviter_public_identifier: 'bruno-petit', inviter_description: 'Responsable recrutement', inviter_picture_url: null, invitation_text: null, date: 'il y a 3 jours', parsed_datetime: null, shared_secret: 'secret-b', provider: 'LINKEDIN' },
];

interface HandledRequest {
  invitation_id: string;
  invitation_action: string;
}

/** Contexte connecté en propriétaire ; simule la fonction des comptes et relève les acceptations et refus. */
async function openContext(browser: Browser, ws: Workspace, opts: { legacy: boolean }): Promise<{ context: BrowserContext; handled: HandledRequest[] }> {
  const context = await browser.newContext({
    storageState: await storageStateForUser(ws.org.owner, 'v3'),
    timezoneId: 'Europe/Paris',
  });
  if (opts.legacy) await pinLegacySequences(context);
  contexts.push(context);
  const handled: HandledRequest[] = [];
  await context.route('**/functions/v1/unipile-accounts', async (route: Route) => {
    let body: { action?: string; invitation_id?: string; invitation_action?: string } | null = null;
    try {
      body = route.request().postDataJSON() as typeof body;
    } catch {
      body = null;
    }
    const json = (data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    if (body?.action === 'list') {
      return json({ success: true, accounts: [{ id: ws.accountId, account_status: 'OK', provider: 'LINKEDIN', name: 'E2E LinkedIn' }] });
    }
    if (body?.action === 'list_invitations_received') return json({ success: true, invitations: INVITATIONS, cursor: null });
    if (body?.action === 'handle_invitation_received') {
      handled.push({ invitation_id: String(body.invitation_id), invitation_action: String(body.invitation_action) });
      return json({ success: true });
    }
    return route.continue();
  });
  return { context, handled };
}

const toast = (page: Page, text: string | RegExp) => page.locator('[data-sonner-toast]').filter({ hasText: text });

for (const legacy of [false, true]) {
  const mode = legacy ? 'interrupteur éteint' : 'interrupteur allumé';

  test(`messagerie, ${mode} : onglet Invitations, une invitation acceptée, une déclinée`, async ({ browser }) => {
    const ws = await workspace(`E2E invitations ${legacy ? 'off' : 'on'}`);
    const { context, handled } = await openContext(browser, ws, { legacy });
    const page = await context.newPage();
    await page.goto('/inbox?onglet=invitations', { waitUntil: 'domcontentloaded' });

    const tab = page.getByRole('button', { name: 'Invitations', exact: true });
    await expect(tab).toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Conversations', exact: true })).toHaveAttribute('aria-pressed', 'false');
    const alice = page.locator('article').filter({ hasText: 'Alice Martin' });
    const bruno = page.locator('article').filter({ hasText: 'Bruno Petit' });
    await expect(alice).toBeVisible({ timeout: 30_000 });
    await expect(bruno).toBeVisible();

    await alice.getByRole('button').first().click();
    await expect(toast(page, 'Invitation de Alice Martin acceptée')).toBeVisible();
    await expect(alice).toHaveCount(0);

    await bruno.getByRole('button').last().click();
    await expect(toast(page, 'Invitation de Bruno Petit déclinée')).toBeVisible();
    await expect(bruno).toHaveCount(0);

    expect(handled).toEqual([
      { invitation_id: 'inv_alice', invitation_action: 'accept' },
      { invitation_id: 'inv_bruno', invitation_action: 'decline' },
    ]);

    // Retour aux conversations : l'adresse perd l'onglet.
    await page.getByRole('button', { name: 'Conversations', exact: true }).click();
    await expect(page).not.toHaveURL(/onglet=invitations/);
  });
}

test('interrupteur allumé : le panneau de la mission n\'a plus l\'onglet Invitations, le lien mène à la messagerie', async ({ browser }) => {
  const ws = await workspace('E2E invitations panneau on');
  const { context } = await openContext(browser, ws, { legacy: false });
  const page = await context.newPage();

  // Panneau ouvert : séquences seules, sans barre d'onglets.
  await page.goto(`/missions/${ws.missionId}?nouvelle-mission=1&panneau=contact`, { waitUntil: 'domcontentloaded' });
  const panel = page.getByTestId('mission-panel');
  await expect(panel.getByRole('heading', { name: 'Prise de contact' })).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByRole('tab', { name: 'Invitations' })).toHaveCount(0);
  await expect(panel.getByRole('tablist')).toHaveCount(0);

  // Ancien lien d'invitations : la messagerie, onglet Invitations.
  await page.goto(`/missions/${ws.missionId}?nouvelle-mission=1&panneau=contact&outreach=invitations`, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/inbox\?onglet=invitations/, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Invitations', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('interrupteur éteint : le panneau provisoire garde son onglet Invitations', async ({ browser }) => {
  const ws = await workspace('E2E invitations panneau off');
  const { context } = await openContext(browser, ws, { legacy: true });
  const page = await context.newPage();
  await page.goto(`/missions/${ws.missionId}?nouvelle-mission=1&panneau=contact&outreach=invitations`, { waitUntil: 'domcontentloaded' });
  const panel = page.getByTestId('mission-panel');
  await expect(panel.getByRole('tab', { name: 'Invitations' })).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 });
  await expect(page).toHaveURL(/panneau=contact/);
  await expect(page).not.toHaveURL(/\/inbox/);
});
