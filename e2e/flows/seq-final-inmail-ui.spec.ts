/**
 * Décisions produit 14 et 24 (docs/audit-2026-09-25-sequences.md, « Décisions
 * produit en attente »), côté fenêtre « InMails personnalisés »
 * (BulkInMailModal) :
 *  - 14 : chaque InMail part avec l'URL de profil du candidat
 *    (recipient_profile_url), que la file utilise pour lire le registre global
 *    des effacements ; un candidat effacé refusé est annoncé comme tel dans le
 *    bilan (skipped_erased), jamais « Réessayez. » ;
 *  - 24 : un candidat déjà contacté par l'organisation (séquence ou InMail
 *    groupé) est exclu sans dérogation, propriétaire compris : plus de
 *    « Contacter quand même », aucune génération payée pour un candidat que la
 *    file refusera. Un refus posé par la file après l'ouverture (inscription
 *    faite entre-temps) est annoncé dans le bilan.
 *
 * Harnais : stack locale (e2e/local-stack), vraie base et vraie action queue
 * de process-inmail-queue. Sont simulés dans le navigateur : la liste des
 * comptes LinkedIn et le solde InMail (unipile-accounts), la recherche
 * LinkedIn, la génération IA des messages.
 */
import { createHash } from 'node:crypto';
import type { Browser, BrowserContext, Locator, Page, Route } from '@playwright/test';
import { test, expect } from '@playwright/test';
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
import { ENGINE_SKIP_REASON, engineAvailable, rand } from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
test.describe.configure({ mode: 'serial', timeout: 180_000 });

// Même texte que la fenêtre (RECENT_CONTACT_REFUSED_MESSAGE).
const REFUSED_HELP = 'Sans dérogation possible : la file InMail refuse tout candidat inscrit en séquence ou contacté par votre organisation ces 90 derniers jours, séquence arrêtée comprise.';

// ─── Nettoyage ──────────────────────────────────────────────────────────────

const contexts: BrowserContext[] = [];
const orgsToDelete: TestOrg[] = [];
const erasureIds: string[] = [];
test.afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close().catch(() => undefined);
  for (const id of erasureIds.splice(0)) await admin().from('gdpr_erasures').delete().eq('id', id);
  while (orgsToDelete.length) {
    const org = orgsToDelete.pop()!;
    // inmail_queue n'est pas nettoyée par deleteOrg.
    await admin().from('inmail_queue').delete().eq('organization_id', org.orgId);
    await deleteOrg(org);
  }
});

// ─── Données ────────────────────────────────────────────────────────────────

interface Workspace {
  org: TestOrg;
  accountId: string;
  missionId: string;
}

/** Cabinet (offre Cabinet), compte LinkedIn relié au propriétaire, mission. */
async function workspace(label: string): Promise<Workspace> {
  const org = await createOrg('agency', label);
  orgsToDelete.push(org);
  await setOrgPlan(org.orgId, 'cabinet');
  const accountId = await seedLinkedInAccount(org.orgId, org.owner.userId, `acc_fiu_${rand()}`, 'OK');
  const missionId = await seedMission(org.orgId, org.owner.userId, { name: `Mission InMail final ${rand()}` });
  return { org, accountId, missionId };
}

interface Candidate {
  id: string;
  name: string;
}

const candidate = (tag: string, name: string): Candidate => ({ id: `ACoAAFIU${tag}${rand()}`, name });
/** URL publique renvoyée par la recherche simulée pour ce candidat. */
const profileUrlOf = (c: Candidate) => `https://www.linkedin.com/in/${c.id.toLowerCase()}`;

/** Séquence active de la mission et inscription vivante du candidat. */
async function enrollInSequence(ws: Workspace, c: Candidate) {
  const { data: seq, error } = await admin()
    .from('outreach_sequences')
    .insert({ name: `Séquence InMail final ${rand()}`, organization_id: ws.org.orgId, created_by: ws.org.owner.userId, project_id: ws.missionId, is_active: true })
    .select('id')
    .single();
  if (error || !seq) throw new Error(`outreach_sequences: ${error?.message}`);
  const { error: enrErr } = await admin().from('sequence_enrollments').insert({
    sequence_id: seq.id,
    organization_id: ws.org.orgId,
    created_by: ws.org.owner.userId,
    profile_id: c.id,
    profile_name: c.name,
    profile_url: profileUrlOf(c),
    account_id: ws.accountId,
    status: 'active',
    current_step_order: 0,
    user_timezone: 'Europe/Paris',
  });
  if (enrErr) throw new Error(`sequence_enrollments: ${enrErr.message}`);
}

/** Registre global des effacements : empreinte de l'URL normalisée, sans fiche ni inscription dans l'organisation. */
async function registerErasure(url: string) {
  const normalized = url.toLowerCase().replace(/[?#].*$/, '').replace(/\/$/, '').trim();
  const { data, error } = await admin()
    .from('gdpr_erasures')
    .insert({ linkedin_url_hash: createHash('sha256').update(normalized).digest('hex'), reason: 'user_request', source: 'e2e-seq-final-inmail-ui' })
    .select('id')
    .single();
  if (error || !data) throw new Error(`gdpr_erasures: ${error?.message}`);
  erasureIds.push(data.id as string);
}

/**
 * Retire les fiches du pipeline de l'organisation (l'affichage de la recherche
 * en crée) : l'URL du candidat n'est alors connue de la file que par
 * recipient_profile_url.
 */
async function dropPipelineCards(ws: Workspace) {
  const { error } = await admin().from('job_candidate_status').delete().eq('organization_id', ws.org.orgId);
  if (error) throw new Error(`job_candidate_status: ${error.message}`);
}

async function queuedRecipients(ws: Workspace): Promise<string[]> {
  const { data, error } = await admin().from('inmail_queue').select('recipient_profile_id').eq('organization_id', ws.org.orgId);
  if (error) throw new Error(`inmail_queue: ${error.message}`);
  return (data ?? []).map((r) => r.recipient_profile_id as string).sort();
}

// ─── Page ───────────────────────────────────────────────────────────────────

function actionOf(route: Route): string | null {
  try {
    return ((route.request().postDataJSON() as { action?: string } | null)?.action) ?? null;
  } catch {
    return null;
  }
}

const toast = (page: Page, text: string | RegExp) => page.locator('[data-sonner-toast]').filter({ hasText: text });

interface QueueItem {
  recipient_profile_id?: string;
  recipient_profile_url?: string | null;
}

interface Harness {
  page: Page;
  /** Corps envoyés à la génération IA (simulée). */
  generated: Array<{ profileId?: string }>;
  /** Lots envoyés à l'action queue de process-inmail-queue. */
  queued: QueueItem[][];
}

/**
 * Onglet Sourcing de la mission, connecté en propriétaire : la recherche
 * simulée affiche `profiles` (deuxième degré, 10 crédits Recruiter).
 */
async function openSearchResults(browser: Browser, ws: Workspace, profiles: Candidate[]): Promise<Harness> {
  const context = await browser.newContext({ storageState: await storageStateForUser(ws.org.owner), timezoneId: 'Europe/Paris' });
  contexts.push(context);
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
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, balance: { premium: null, recruiter: 10, sales_navigator: null } }),
      });
    }
    return route.continue();
  });
  await context.route('**/functions/v1/unipile-search', async (route) => {
    const body = actionOf(route) === 'search'
      ? {
          success: true,
          results: profiles.map((p) => {
            const [first, ...rest] = p.name.split(' ');
            return {
              id: p.id,
              name: p.name,
              first_name: first,
              last_name: rest.join(' '),
              headline: 'Ingénieur backend',
              location: 'Paris, France',
              network_distance: 'SECOND_DEGREE',
              profile_url: profileUrlOf(p),
            };
          }),
          cursor: null,
          total: profiles.length,
        }
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
  const generated: Harness['generated'] = [];
  await context.route('**/functions/v1/generate-outreach-message', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    try { generated.push(route.request().postDataJSON() as { profileId?: string }); } catch { generated.push({}); }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, subject: 'Une mission pour vous', message: 'Bonjour, une mission pourrait vous intéresser.' }) });
  });

  const page = await context.newPage();
  const queued: Harness['queued'] = [];
  page.on('request', (req) => {
    if (!req.url().includes('/functions/v1/process-inmail-queue') || req.method() !== 'POST') return;
    try {
      const body = req.postDataJSON() as { action?: string; items?: QueueItem[] };
      if (body?.action === 'queue') queued.push(body.items ?? []);
    } catch { /* pré-vol */ }
  });
  await page.goto(`/missions/${ws.missionId}?tab=sourcing`, { waitUntil: 'domcontentloaded' });
  await page.getByText('générer depuis le brief').click({ timeout: 30_000 });
  for (const p of profiles) {
    await expect(page.getByRole('checkbox', { name: `Sélectionner ${p.name}`, exact: true })).toBeVisible({ timeout: 30_000 });
  }
  for (const p of profiles) await page.getByRole('checkbox', { name: `Sélectionner ${p.name}`, exact: true }).click();
  return { page, generated, queued };
}

async function openBulkInMail(page: Page) {
  await page.getByRole('button', { name: /InMail/ }).filter({ hasText: 'InMail' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'InMails personnalisés' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Vérification des contacts récents de l\'organisation')).toHaveCount(0, { timeout: 20_000 });
  return dialog;
}

/** Génère `count` messages, lance `beforeQueue`, puis confirme « Planifier ». */
async function generateAndQueue(page: Page, dialog: Locator, count: number, beforeQueue?: () => Promise<void>) {
  const plural = count > 1 ? 's' : '';
  await dialog.getByRole('button', { name: new RegExp(`^Générer ${count} message${plural}`) }).click();
  await expect(toast(page, `${count} message${plural} généré${plural}`)).toBeVisible({ timeout: 20_000 });
  await beforeQueue?.();
  await dialog.getByRole('button', { name: `Planifier ${count} InMail${plural}` }).click();
  await page.getByRole('alertdialog', { name: `Planifier ${count} InMail${plural} ?` }).getByRole('button', { name: 'Planifier', exact: true }).click();
}

// ════════════════════════════════════════════════════════════════════════════

test.describe('InMail groupé : décisions 14 et 24 dans la fenêtre', () => {
  test('décision 24 : un candidat inscrit en séquence est exclu sans « Contacter quand même », propriétaire compris ; seul l\'autre candidat est généré et planifié, avec son URL de profil', async ({ browser }) => {
    const ws = await workspace('E2E InMail final 24');
    const enrolled = candidate('SQ', 'Sacha Sequence');
    const fresh = candidate('OK', 'Olivia Libre');
    await enrollInSequence(ws, enrolled);

    const { page, generated, queued } = await openSearchResults(browser, ws, [enrolled, fresh]);
    const dialog = await openBulkInMail(page);
    await expect(dialog.getByText('Messages rédigés par l\'IA Konekt pour 1 candidat sur 2')).toBeVisible();
    await expect(dialog.getByText('1 candidat déjà contacté par votre organisation, exclu', { exact: true })).toBeVisible();
    await expect(dialog.getByText(REFUSED_HELP)).toBeVisible();
    await expect(dialog.getByText(/quand même/), 'aucune dérogation proposée au propriétaire').toHaveCount(0);
    await expect(dialog.getByRole('checkbox'), 'aucune case de dérogation').toHaveCount(0);

    await generateAndQueue(page, dialog, 1);
    await expect(toast(page, '1 InMail planifié pour envoi')).toBeVisible({ timeout: 20_000 });
    expect(generated.map((g) => g.profileId), 'aucune génération pour le candidat exclu').toEqual([fresh.id]);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toEqual([expect.objectContaining({ recipient_profile_id: fresh.id, recipient_profile_url: profileUrlOf(fresh) })]);
    expect(await queuedRecipients(ws)).toEqual([fresh.id]);
  });

  test('décision 14 : un candidat connu du seul registre des effacements (ni fiche ni inscription) est refusé grâce à son URL ; le bilan partiel l\'annonce comme effacé, pas comme doublon', async ({ browser }) => {
    const ws = await workspace('E2E InMail final 14 partiel');
    const erased = candidate('ER', 'Emile Efface');
    const fresh = candidate('OK', 'Paula Libre');
    await registerErasure(profileUrlOf(erased));

    const { page, generated, queued } = await openSearchResults(browser, ws, [erased, fresh]);
    const dialog = await openBulkInMail(page);
    // Le registre n'est pas lu à l'ouverture : les deux candidats sont proposés.
    await expect(dialog.getByText('Messages rédigés par l\'IA Konekt pour 2 candidats', { exact: true })).toBeVisible();

    await generateAndQueue(page, dialog, 2, () => dropPipelineCards(ws));
    const partial = toast(page, '1 InMail planifié sur 2');
    await expect(partial).toBeVisible({ timeout: 20_000 });
    await expect(partial).toContainText('1 candidat ayant demandé l\'effacement de ses données, exclu.');
    await expect(partial).not.toContainText('déjà contacté');
    expect(generated).toHaveLength(2);
    expect(queued).toHaveLength(1);
    expect(queued[0].map((i) => [i.recipient_profile_id, i.recipient_profile_url]).sort()).toEqual(
      [[erased.id, profileUrlOf(erased)], [fresh.id, profileUrlOf(fresh)]].sort(),
    );
    expect(await queuedRecipients(ws), 'aucune ligne pour le candidat effacé').toEqual([fresh.id]);
  });

  test('décision 14 : lot entièrement refusé pour effacement : « Aucun InMail n\'a été planifié » en dit la raison, jamais « Réessayez. »', async ({ browser }) => {
    const ws = await workspace('E2E InMail final 14 zéro');
    const erased = candidate('EZ', 'Gaston Efface');
    await registerErasure(profileUrlOf(erased));

    const { page } = await openSearchResults(browser, ws, [erased]);
    const dialog = await openBulkInMail(page);
    await generateAndQueue(page, dialog, 1, () => dropPipelineCards(ws));
    const none = toast(page, 'Aucun InMail n’a été planifié');
    await expect(none).toBeVisible({ timeout: 20_000 });
    await expect(none).toContainText('1 candidat ayant demandé l\'effacement de ses données, exclu.');
    await expect(none).not.toContainText('Réessayez');
    await expect(toast(page, /InMails? planifiés? pour envoi/)).toHaveCount(0);
    expect(await queuedRecipients(ws)).toEqual([]);
  });

  test('décisions 14 et 24 : candidat inscrit en séquence après l\'ouverture et candidat effacé, refusés par la file ; le bilan « 1 InMail planifié sur 3 » compte chacun sous sa raison', async ({ browser }) => {
    const ws = await workspace('E2E InMail final 14+24');
    const late = candidate('LT', 'Louis Tardif');
    const erased = candidate('EM', 'Mona Effacee');
    const fresh = candidate('OK', 'Nina Libre');
    await registerErasure(profileUrlOf(erased));

    const { page, queued } = await openSearchResults(browser, ws, [late, erased, fresh]);
    const dialog = await openBulkInMail(page);
    await expect(dialog.getByText('Messages rédigés par l\'IA Konekt pour 3 candidats', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: /^Générer 3 messages/ }).click();
    await expect(toast(page, '3 messages générés')).toBeVisible({ timeout: 20_000 });
    // Un collègue inscrit entre-temps le premier candidat en séquence : la file le refuse.
    await enrollInSequence(ws, late);
    await dropPipelineCards(ws);
    await dialog.getByRole('button', { name: 'Planifier 3 InMails' }).click();
    await page.getByRole('alertdialog', { name: 'Planifier 3 InMails ?' }).getByRole('button', { name: 'Planifier', exact: true }).click();

    const partial = toast(page, '1 InMail planifié sur 3');
    await expect(partial).toBeVisible({ timeout: 20_000 });
    await expect(partial).toContainText('1 candidat déjà contacté par votre organisation, exclu. 1 candidat ayant demandé l\'effacement de ses données, exclu.');
    expect(queued).toHaveLength(1);
    expect(queued[0]).toHaveLength(3);
    expect(await queuedRecipients(ws)).toEqual([fresh.id]);
  });
});
