/**
 * Refonte mission, lots 0c-3 et 0c-4 : les écrans lisent la vue
 * mission_candidate_rows et disent les mêmes nombres avec les mêmes mots
 * (plan final du lot 0c, section 10.2).
 *
 *  - liste des missions : pas de « Brief incomplet », « N profils trouvés »,
 *    effectifs égaux aux colonnes du kanban ;
 *  - kanban de mission : colonne Retenu, profil jamais ouvert absent, un
 *    doublon affiché une fois ;
 *  - /pipeline : même étape et même titre de colonne que la mission, profil
 *    jamais ouvert absent, « Annuler » qui remet l'état d'avant de toutes les
 *    lignes du candidat ;
 *  - fiche : la grille IA reçoit l'intitulé du poste et les étapes d'entretien
 *    (interception de generate-scorecard).
 *
 * Ordre B du plan (0c-3 et 0c-4 livrés avant 0b-5) : chaque geste appelle
 * expectNoDirectWrite, qui lit jcs_direct_write_log.
 *
 * Harnais : stack locale (e2e/local-stack), vraie base. Seule la liste des
 * comptes LinkedIn est simulée dans le navigateur.
 */
import type { Browser, BrowserContext, Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures';
import {
  addMember,
  admin,
  candidateRowState,
  createOrg,
  deleteOrg,
  seedCandidateRow,
  seedLinkedInAccount,
  seedMission,
  setOrgPlan,
  storageStateForUser,
  type CandidateStage,
  type TestOrg,
  type TestUser,
} from '../helpers/supabase-admin';

const LOCAL_STACK = process.env.E2E_EDGE_FUNCTIONS === '1';
test.skip(!LOCAL_STACK, 'stack locale absente (E2E_EDGE_FUNCTIONS=1, voir e2e/local-stack/README.md)');
test.describe.configure({ timeout: 180_000 });

const rand = () => Math.random().toString(36).slice(2, 10);

// ─── Nettoyage ──────────────────────────────────────────────────────────────

const contexts: BrowserContext[] = [];
const orgsToDelete: Array<{ org: TestOrg; extra: TestUser[] }> = [];
test.afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close().catch(() => undefined);
  while (orgsToDelete.length) {
    const { org, extra } = orgsToDelete.pop()!;
    await admin().from('job_candidate_status').delete().eq('organization_id', org.orgId);
    await admin().from('mission_process_steps').delete().eq('organization_id', org.orgId);
    await deleteOrg(org, extra);
  }
});

// ─── Données ────────────────────────────────────────────────────────────────

interface Workspace {
  org: TestOrg;
  member: TestUser;
  accountId: string;
  missionId: string;
  missionName: string;
}

/** Cabinet sur offre payante, un second auteur, un compte LinkedIn, une mission au poste connu. */
async function workspace(label: string): Promise<Workspace> {
  const org = await createOrg('agency', label);
  const member = await addMember(org.orgId, 'member', 'lect0c');
  orgsToDelete.push({ org, extra: [member] });
  await setOrgPlan(org.orgId);
  const accountId = await seedLinkedInAccount(org.orgId, org.owner.userId, `acc_0c_${rand()}`, 'OK');
  const missionName = `Mission 0c ${rand()}`;
  const missionId = await seedMission(org.orgId, org.owner.userId, { name: missionName });
  return { org, member, accountId, missionId, missionName };
}

/** Ligne candidat de la mission à l'étape voulue ; `unopened` : profil trouvé par une recherche, rien de plus. */
async function candidate(
  ws: Workspace,
  name: string,
  stage: CandidateStage = 'to_sort',
  o: { candidateId?: string; by?: TestUser; unopened?: boolean; stepId?: string | null } = {},
) {
  const { id } = await seedCandidateRow({
    orgId: ws.org.orgId,
    createdBy: (o.by ?? ws.org.owner).userId,
    candidateId: o.candidateId ?? `ACoAA0C${rand()}`,
    missionId: ws.missionId,
    stage,
    stepId: o.stepId ?? null,
    extra: { candidate_name: name, candidate_headline: 'Ingénieur backend', ...(o.unopened ? { status: 'discovered' } : {}) },
  });
  return id;
}

const stageOf = async (rowId: string) => {
  const s = await candidateRowState(rowId);
  return { stage: s.general_stage, step: s.process_step_id, source: s.decision_source };
};

// ─── Journal des écritures directes (lecture en clé de service) ────────────

async function journalMark(): Promise<number> {
  const { data, error } = await admin().from('jcs_direct_write_log').select('id').order('id', { ascending: false }).limit(1);
  if (error) throw new Error(`jcs_direct_write_log: ${error.message}`);
  return Number((data as Array<{ id: number }> | null)?.[0]?.id ?? 0);
}

async function expectNoDirectWrite(ws: Workspace, mark: number) {
  const { data, error } = await admin()
    .from('jcs_direct_write_log')
    .select('id, op, db_role, row_id, client_info')
    .eq('organization_id', ws.org.orgId)
    .gt('id', mark)
    .order('id');
  if (error) throw new Error(`jcs_direct_write_log: ${error.message}`);
  expect(data ?? [], 'aucune écriture directe de l’étape journalisée pendant le geste').toEqual([]);
}

// ─── Navigateur ─────────────────────────────────────────────────────────────

function actionOf(route: Route): string | null {
  try {
    return ((route.request().postDataJSON() as { action?: string } | null)?.action) ?? null;
  } catch {
    return null;
  }
}

const toast = (page: Page, text: string | RegExp) => page.locator('[data-sonner-toast]').filter({ hasText: text });

/** Page connectée en propriétaire, avec la liste de ses comptes LinkedIn simulée. */
async function openAs(browser: Browser, ws: Workspace): Promise<Page> {
  const context = await browser.newContext({
    storageState: await storageStateForUser(ws.org.owner),
    timezoneId: 'Europe/Paris',
    viewport: { width: 2400, height: 1100 },
  });
  contexts.push(context);
  await context.route('**/functions/v1/unipile-accounts', async (route) => {
    if (actionOf(route) !== 'list') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, accounts: [{ id: ws.accountId, account_status: 'OK', provider: 'LINKEDIN', name: 'E2E LinkedIn' }] }),
    });
  });
  const page = await context.newPage();
  // Tutoriel vidéo du pipeline déjà vu : il s'ouvrirait par-dessus le kanban.
  await page.addInitScript(() => { try { localStorage.setItem('konekt:tuto:seen:pipeline', '1'); } catch { /* sans stockage */ } });
  return page;
}

// Kanban de mission et /pipeline : aria-label « Colonne <libellé>, N candidat(s) ».
const column = (page: Page, label: string) => page.locator(`[aria-label^="Colonne ${label},"]`);

async function openMissionKanban(page: Page, missionId: string, anyName: string) {
  await page.goto(`/missions/${missionId}?tab=pipeline`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Kanban', exact: true }).click({ timeout: 30_000 });
  await expect(page.getByText(anyName, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
}

async function openGlobalPipeline(page: Page, anyName: string) {
  await page.goto('/pipeline', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(anyName, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
}

/** « Déplacer vers… » d'une carte du /pipeline. */
async function moveCard(page: Page, name: string, label: string) {
  const trigger = page.getByRole('button', { name: `Déplacer ${name} vers une autre étape`, exact: true });
  await page.getByText(name, { exact: true }).first().hover();
  await trigger.click();
  await page.getByRole('menuitemradio', { name: label, exact: true }).click();
}

// ═══ Liste des missions, kanban de mission ═════════════════════════════════

test.describe('Lot 0c-3 : liste et kanban de mission', () => {
  test('la carte de la liste et les colonnes du kanban disent les mêmes nombres ; un profil jamais ouvert reste au Sourcing ; un doublon compte une fois', async ({ browser }) => {
    const ws = await workspace('E2E 0c liste kanban');
    await candidate(ws, 'Alice Atrier');
    await candidate(ws, 'Bruno Retenu', 'retained');
    await candidate(ws, 'Chloe Contactee', 'contacted');
    // Doublon : même personne, deux auteurs, deux lignes À trier.
    const shared = `ACoAA0CD${rand()}`;
    await candidate(ws, 'Denis Doublon', 'to_sort', { candidateId: shared });
    await candidate(ws, 'Denis Doublon', 'to_sort', { candidateId: shared, by: ws.member });
    // Profil trouvé par une recherche, jamais ouvert.
    await candidate(ws, 'Zoe Jamaisouverte', 'to_sort', { unopened: true });

    const page = await openAs(browser, ws);

    // Liste : pas de « Brief incomplet », un lien « 1 profil trouvé », effectifs de l'entonnoir.
    await page.goto('/missions', { waitUntil: 'domcontentloaded' });
    const row = page.getByTestId('mission-row').filter({ hasText: ws.missionName });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Brief incomplet')).toHaveCount(0);
    await expect(row).toContainText('1 profil trouvé');
    // Colonnes d'effectifs : seulement celles qui ont un nombre (À trier, Contacté). A répondu et
    // En entretien, à zéro pour toute la liste, ne sont pas affichées : aucun zéro écrit.
    const cells = row.locator('td');
    await expect(cells).toHaveCount(4); // mission, À trier, Contacté, menu de la ligne
    await expect(cells.nth(1)).toHaveText('2');
    await expect(cells.nth(2)).toHaveText('1');
    await expect(page.getByRole('columnheader', { name: 'À trier', exact: true })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'A répondu', exact: true })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'En entretien', exact: true })).toHaveCount(0);

    // Kanban : les mêmes nombres sous les mêmes noms d'étape.
    await openMissionKanban(page, ws.missionId, 'Alice Atrier');
    await expect(column(page, 'À trier')).toHaveAttribute('aria-label', 'Colonne À trier, 2 candidats');
    await expect(column(page, 'Retenu')).toHaveAttribute('aria-label', 'Colonne Retenu, 1 candidat');
    await expect(column(page, 'Retenu').getByText('Bruno Retenu', { exact: true })).toBeVisible();
    await expect(column(page, 'Contacté')).toHaveAttribute('aria-label', 'Colonne Contacté, 1 candidat');
    await expect(page.getByText('Zoe Jamaisouverte', { exact: true }), 'jamais ouvert : absent du Pipeline').toHaveCount(0);
    await expect(page.getByText('Denis Doublon', { exact: true }), 'un doublon, une carte').toHaveCount(1);
  });
});

test.describe('Design simplifié : liste des missions', () => {
  test('les candidats en entretien montrent leur visage (photo enregistrée, sinon initiales), une case à zéro reste vide', async ({ browser }) => {
    const ws = await workspace('E2E liste visages');
    const photo = `data:image/svg+xml;utf8,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='8' height='8'><rect width='8' height='8' fill='#c9724a'/></svg>")}`;
    const interviewing = async (name: string, picture: string | null) => {
      const { id } = await seedCandidateRow({
        orgId: ws.org.orgId,
        createdBy: ws.org.owner.userId,
        candidateId: `ACoAA0F${rand()}`,
        missionId: ws.missionId,
        stage: 'interviewing',
        extra: { candidate_name: name, linkedin_profile_data: picture ? { profile_picture_url: picture } : {} },
      });
      return id;
    };
    await interviewing('Eric Entretien', photo);
    await interviewing('Eva Entretien', null);
    await candidate(ws, 'Alice Atrier');

    const page = await openAs(browser, ws);
    await page.goto('/missions', { waitUntil: 'domcontentloaded' });
    const row = page.getByTestId('mission-row').filter({ hasText: ws.missionName });
    await expect(row).toBeVisible({ timeout: 30_000 });

    // Les deux visages, nommés ; la photo enregistrée est celle de la ligne, l'autre en initiales.
    const faces = row.getByRole('img', { name: /Eric Entretien/ });
    await expect(faces).toBeVisible({ timeout: 30_000 });
    await expect(faces).toHaveAccessibleName(/Eva Entretien/);
    await expect(row.locator(`img[src="${photo}"]`)).toHaveCount(1);
    await expect(faces.getByText('EE', { exact: true })).toHaveCount(1);
    // Colonnes : À trier (1) et En entretien (les visages) ; Contacté et A répondu, vides partout, n'existent pas.
    await expect(page.getByRole('columnheader', { name: 'En entretien', exact: true })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Contacté', exact: true })).toHaveCount(0);
    await expect(row.locator('td').nth(1)).toHaveText('1');
    // Sous-titre : une phrase sans zéro.
    await expect(page.getByText(/^1 mission en cours\s*: 2 en entretien, 1 à trier\.$/)).toBeVisible();

    // Le menu de la ligne est atteignable au clavier même sans survol, et ouvre les mêmes actions.
    const menu = row.getByRole('button', { name: `Actions pour ${ws.missionName}` });
    await menu.focus();
    await expect(menu).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Mettre en pause' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Supprimer' })).toBeVisible();
  });
});

// ═══ /pipeline ══════════════════════════════════════════════════════════════

test.describe('Lot 0c-4 : /pipeline', () => {
  test('même étape et mêmes titres que la mission ; jamais ouvert absent ; « Annuler » remet toutes les lignes du doublon', async ({ browser }) => {
    const ws = await workspace('E2E 0c pipeline');
    await candidate(ws, 'Bruno Retenu', 'retained');
    await candidate(ws, 'Chloe Contactee', 'contacted');
    await candidate(ws, 'Zoe Jamaisouverte', 'to_sort', { unopened: true });
    const shared = `ACoAA0CD${rand()}`;
    const first = await candidate(ws, 'Denis Doublon', 'to_sort', { candidateId: shared });
    const second = await candidate(ws, 'Denis Doublon', 'to_sort', { candidateId: shared, by: ws.member });

    const page = await openAs(browser, ws);
    await openGlobalPipeline(page, 'Bruno Retenu');
    await expect(column(page, 'Retenu').getByText('Bruno Retenu', { exact: true })).toBeVisible();
    await expect(column(page, 'Contacté').getByText('Chloe Contactee', { exact: true })).toBeVisible();
    await expect(column(page, 'À trier').getByText('Denis Doublon', { exact: true })).toHaveCount(1);
    await expect(page.getByText('Zoe Jamaisouverte', { exact: true }), 'jamais ouvert : absent du /pipeline').toHaveCount(0);

    // Un geste écrit toutes les lignes du doublon, « Annuler » les remet.
    const mark = await journalMark();
    await moveCard(page, 'Denis Doublon', 'Écarté');
    const moved = toast(page, `Denis Doublon est maintenant à l'étape « Écarté »`);
    await expect(moved).toBeVisible({ timeout: 15_000 });
    for (const id of [first, second]) {
      expect(await stageOf(id), 'les deux lignes sont écartées').toEqual({ stage: 'rejected', step: null, source: 'user' });
    }

    await moved.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect(toast(page, /revenu à son étape précédente\./)).toBeVisible({ timeout: 20_000 });
    for (const id of [first, second]) {
      await expect.poll(() => stageOf(id), { timeout: 15_000 }).toEqual({ stage: 'to_sort', step: null, source: null });
      expect((await candidateRowState(id)).contacted_at, 'aucun jalon laissé par le geste').toBeNull();
    }
    await expectNoDirectWrite(ws, mark);
  });
});

test.describe('Design simplifié : /pipeline', () => {
  test('les visages : photo enregistrée sur la carte, le tableau et la chronologie ; initiales sans photo ou lien expiré ; une carte attrapée par sa photo se déplace', async ({ browser }) => {
    const ws = await workspace('E2E pipeline visages');
    const portrait = 'https://media.licdn.com/e2e-pipeline/portrait.png';
    const expired = 'https://media.licdn.com/e2e-pipeline/expire.png';
    const seed = async (name: string, stage: CandidateStage, picture: string | null) => {
      const { id } = await seedCandidateRow({
        orgId: ws.org.orgId,
        createdBy: ws.org.owner.userId,
        candidateId: `ACoAA0V${rand()}`,
        missionId: ws.missionId,
        stage,
        extra: { candidate_name: name, linkedin_profile_data: picture ? { profile_picture_url: picture } : {} },
      });
      return id;
    };
    const paulId = await seed('Paul Portrait', 'retained', portrait);
    await seed('Sans Photo', 'contacted', null);
    await seed('Lien Expire', 'replied', expired);

    const page = await openAs(browser, ws);
    // Un pixel pour la photo valide, un refus pour le lien expiré : les initiales reviennent.
    const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    await page.context().route('https://media.licdn.com/e2e-pipeline/*', (route) =>
      route.request().url() === expired
        ? route.fulfill({ status: 404, body: '' })
        : route.fulfill({ status: 200, contentType: 'image/png', body: pixel }),
    );
    await openGlobalPipeline(page, 'Paul Portrait');

    // Kanban : la photo chargée, sinon les initiales.
    const card = (name: string) => page.locator('[data-card-id]').filter({ hasText: name });
    const face = card('Paul Portrait').locator(`img[src="${portrait}"]`);
    await expect(face).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => face.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(card('Sans Photo').locator('img')).toHaveCount(0);
    await expect(card('Sans Photo').getByText('SP', { exact: true })).toBeVisible();
    await expect(card('Lien Expire').getByText('LE', { exact: true }), 'lien expiré : les initiales').toBeVisible({ timeout: 15_000 });
    await expect(card('Lien Expire').locator('img')).toHaveCount(0);

    // Une carte attrapée par sa photo se déplace (une image dans une carte déplaçable).
    const from = (await face.boundingBox())!;
    const to = (await column(page, 'Contacté').boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, { steps: 4 });
    await page.mouse.move(to.x + to.width / 2, to.y + Math.min(120, to.height / 2), { steps: 15 });
    await page.mouse.up();
    await expect.poll(async () => (await stageOf(paulId)).stage, { timeout: 15_000 }).toBe('contacted');

    // Tableau et chronologie : le même visage devant le nom.
    const views = page.getByRole('group', { name: 'Affichage du pipeline' });
    await views.getByRole('button', { name: 'Tableau', exact: true }).click();
    const row = page.getByRole('row').filter({ hasText: 'Paul Portrait' });
    await expect(row.locator(`img[src="${portrait}"]`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('row').filter({ hasText: 'Sans Photo' }).getByText('SP', { exact: true })).toBeVisible();
    await views.getByRole('button', { name: 'Chronologie', exact: true }).click();
    await expect(page.locator('li').filter({ hasText: 'Paul Portrait' }).locator(`img[src="${portrait}"]`)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('li').filter({ hasText: 'Sans Photo' }).getByText('SP', { exact: true })).toBeVisible();
  });
});

// ═══ Fiche : grille IA ══════════════════════════════════════════════════════

test.describe('Lot 0c-4 : fiche candidat', () => {
  test('la grille IA reçoit l’intitulé du poste et les étapes d’entretien de la mission', async ({ browser }) => {
    const ws = await workspace('E2E 0c grille');
    const { data: steps, error } = await admin().from('mission_process_steps').insert([
      { project_id: ws.missionId, organization_id: ws.org.orgId, step_order: 0, name: 'Entretien RH', duration_minutes: 30 },
      { project_id: ws.missionId, organization_id: ws.org.orgId, step_order: 1, name: 'Entretien client', duration_minutes: 45 },
    ]).select('id, name');
    if (error || !steps) throw new Error(`mission_process_steps: ${error?.message}`);
    const client = (steps as Array<{ id: string; name: string }>).find((s) => s.name === 'Entretien client')!;
    const candidateId = `ACoAA0CG${rand()}`;
    await candidate(ws, 'Emma Grille', 'interviewing', { candidateId, stepId: client.id });

    const page = await openAs(browser, ws);
    const sent: Array<{ jobContext?: Record<string, unknown> }> = [];
    await page.context().route('**/functions/v1/generate-scorecard', async (route) => {
      try {
        sent.push(route.request().postDataJSON() as { jobContext?: Record<string, unknown> });
      } catch { /* corps illisible : la vérification plus bas échoue */ }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'e2e' }) });
    });

    await page.goto(`/pipeline/scorecard/${candidateId}?mission=${ws.missionId}`, { waitUntil: 'domcontentloaded' });
    // Sans grille, la fiche propose d'en créer une ; la génération est ensuite offerte sur la grille vide.
    await page.getByRole('button', { name: 'Créer une grille' }).first().click({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Générer la grille' }).click({ timeout: 30_000 });
    await expect.poll(() => sent.length, { timeout: 20_000 }).toBeGreaterThan(0);

    const context = sent[0].jobContext ?? {};
    expect(context.title, 'intitulé du poste du brief').toBe('Senior Backend Engineer');
    expect((context.processSteps as Array<{ name: string }>).map((s) => s.name)).toEqual(['Entretien RH', 'Entretien client']);
    expect(context.currentStepName, 'étape du candidat').toBe('Entretien client');
  });
});
