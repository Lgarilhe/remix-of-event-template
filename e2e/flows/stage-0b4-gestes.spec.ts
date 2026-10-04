/**
 * Refonte mission, lot 0b-4 : les gestes des utilisateurs changent l'étape
 * d'un candidat par set_candidate_stage(s), origine « user », jamais par une
 * écriture directe de status ou pipeline_stage (plan final, sections 6 et 9).
 *
 * Chaque geste est fait dans le navigateur, puis vérifié en base :
 *  - general_stage, process_step_id et decision_source de la ligne ;
 *  - aucune ligne ajoutée à jcs_direct_write_log (garde stage_write_guard, en
 *    observation) pour l'organisation pendant le geste : une écriture directe
 *    qui change l'étape y serait journalisée.
 *
 * Écrans :
 *  - kanban de mission : vers une étape d'entretien, vers Écarté, puis retour
 *    dans À trier (restauration), toast émis après l'enregistrement ;
 *  - tableau de mission : « Retenir » groupé (un candidat déjà contacté
 *    reste à son étape, et c'est annoncé), « Écarter » d'une ligne ;
 *  - /pipeline : déplacement puis « Annuler », qui restaure la cible exacte
 *    (étape d'entretien comprise) ; déplacement groupé depuis une étape de
 *    mission, puis « Annuler » ;
 *  - Sourcing : « Shortlister » et « Archiver » depuis les résultats.
 *    « Restaurer » un profil archivé n'a pas d'entrée dans cet écran
 *    (onRestoreCandidate n'est branché sur aucun bouton) : la restauration est
 *    couverte par le kanban (Écarté vers À trier).
 *
 * Harnais : stack locale (e2e/local-stack), vraie base, migrations du lot 0b-1
 * appliquées (journal et garde). Seuls la liste des comptes LinkedIn, la
 * recherche LinkedIn, la génération des filtres et la notation sont simulées
 * dans le navigateur.
 */
import type { Browser, BrowserContext, Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures';
import {
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
} from '../helpers/supabase-admin';

const LOCAL_STACK = process.env.E2E_EDGE_FUNCTIONS === '1';
test.skip(!LOCAL_STACK, 'stack locale absente (E2E_EDGE_FUNCTIONS=1, voir e2e/local-stack/README.md)');
test.describe.configure({ timeout: 180_000 });

const rand = () => Math.random().toString(36).slice(2, 10);
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// ─── Nettoyage ──────────────────────────────────────────────────────────────

const contexts: BrowserContext[] = [];
const orgsToDelete: TestOrg[] = [];
test.afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close().catch(() => undefined);
  while (orgsToDelete.length) {
    const org = orgsToDelete.pop()!;
    await admin().from('job_candidate_status').delete().eq('organization_id', org.orgId);
    await admin().from('mission_process_steps').delete().eq('organization_id', org.orgId);
    await deleteOrg(org);
  }
});

// ─── Données ────────────────────────────────────────────────────────────────

interface Workspace {
  org: TestOrg;
  accountId: string;
  missionId: string;
}

/** Cabinet sur offre payante, compte LinkedIn du propriétaire, mission. */
async function workspace(label: string): Promise<Workspace> {
  const org = await createOrg('agency', label);
  orgsToDelete.push(org);
  await setOrgPlan(org.orgId);
  const accountId = await seedLinkedInAccount(org.orgId, org.owner.userId, `acc_0b4_${rand()}`, 'OK');
  const missionId = await seedMission(org.orgId, org.owner.userId, { name: `Mission 0b4 ${rand()}` });
  return { org, accountId, missionId };
}

/** Étapes d'entretien de la mission, dans l'ordre donné. */
async function processSteps(ws: Workspace, names: string[]): Promise<Map<string, string>> {
  const { data, error } = await admin().from('mission_process_steps').insert(
    names.map((name, i) => ({ project_id: ws.missionId, organization_id: ws.org.orgId, step_order: i, name, duration_minutes: 30 })),
  ).select('id, name');
  if (error || !data) throw new Error(`mission_process_steps: ${error?.message}`);
  return new Map((data as Array<{ id: string; name: string }>).map((s) => [s.name, s.id]));
}

/** Ligne candidat de la mission, à l'étape voulue (posée par set_candidate_stage, origine user). */
async function candidate(ws: Workspace, name: string, stage: CandidateStage = 'to_sort', stepId: string | null = null, candidateId = `ACoAA0B4${rand()}`) {
  const { id } = await seedCandidateRow({
    orgId: ws.org.orgId,
    createdBy: ws.org.owner.userId,
    candidateId,
    missionId: ws.missionId,
    stage,
    stepId,
    extra: { candidate_name: name, candidate_headline: 'Ingénieur backend' },
  });
  return id;
}

const stageOf = async (rowId: string) => {
  const s = await candidateRowState(rowId);
  return { stage: s.general_stage, step: s.process_step_id, source: s.decision_source };
};

// ─── Journal des écritures directes (lecture en clé de service) ────────────

interface JournalRow {
  id: number;
  op: string;
  db_role: string | null;
  row_id: string | null;
  old_status: string | null;
  new_status: string | null;
  old_pipeline_stage: string | null;
  new_pipeline_stage: string | null;
  old_general_stage: string | null;
  new_general_stage: string | null;
  client_info: string | null;
}

/** Dernier identifiant du journal, pris juste avant le geste. */
async function journalMark(): Promise<number> {
  const { data, error } = await admin().from('jcs_direct_write_log').select('id').order('id', { ascending: false }).limit(1);
  if (error) throw new Error(`jcs_direct_write_log: ${error.message}`);
  return Number((data as Array<{ id: number }> | null)?.[0]?.id ?? 0);
}

/** Écritures directes de l'étape journalisées pour l'organisation depuis `mark`. */
async function journalSince(orgId: string, mark: number): Promise<JournalRow[]> {
  const { data, error } = await admin()
    .from('jcs_direct_write_log')
    .select('id, op, db_role, row_id, old_status, new_status, old_pipeline_stage, new_pipeline_stage, old_general_stage, new_general_stage, client_info')
    .eq('organization_id', orgId)
    .gt('id', mark)
    .order('id');
  if (error) throw new Error(`jcs_direct_write_log: ${error.message}`);
  return (data ?? []) as JournalRow[];
}

async function expectNoDirectWrite(ws: Workspace, mark: number) {
  expect(await journalSince(ws.org.orgId, mark), 'aucune écriture directe de l’étape journalisée pendant le geste').toEqual([]);
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
async function openAs(browser: Browser, ws: Workspace, viewport?: { width: number; height: number }): Promise<Page> {
  const context = await browser.newContext({
    storageState: await storageStateForUser(ws.org.owner),
    timezoneId: 'Europe/Paris',
    ...(viewport ? { viewport } : {}),
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

// Kanban de mission (MissionPipeline.tsx : aria-label « Colonne <libellé>, N candidat(s) »).
const column = (page: Page, label: string) => page.locator(`[aria-label^="Colonne ${label},"]`);

async function openMissionPipeline(page: Page, missionId: string, anyName: string, view: 'table' | 'kanban') {
  await page.goto(`/missions/${missionId}?tab=pipeline`, { waitUntil: 'domcontentloaded' });
  if (view === 'kanban') await page.getByRole('button', { name: 'Kanban', exact: true }).click({ timeout: 30_000 });
  await expect(page.getByText(anyName, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
}

/** Glisse la carte `name` dans la colonne `label` (capteur de pointeur, 5 px d'amorce). */
async function dragCard(page: Page, name: string, label: string) {
  const card = page.getByText(name, { exact: true }).first();
  const target = column(page, label);
  await target.scrollIntoViewIfNeeded();
  const from = (await card.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + Math.min(120, to.height / 2), { steps: 15 });
  await page.mouse.up();
}

/** /pipeline, une carte visible. */
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

// ═══ Kanban de mission ══════════════════════════════════════════════════════

test.describe('Lot 0b-4 : kanban de mission', () => {
  test('vers une étape d’entretien, vers Écarté, puis retour dans À trier : set_candidate_stage, toast après l’enregistrement, aucune écriture directe', async ({ browser }) => {
    const ws = await workspace('E2E 0b4 kanban');
    const steps = await processSteps(ws, ['Préqualif', 'Entretien client']);
    const interview = steps.get('Entretien client')!;
    const name = 'Alice Kanban';
    const rowId = await candidate(ws, name);

    // Écran large : les sept colonnes tiennent sans défilement horizontal, la
    // carte et la colonne visée restent à l'écran pendant le glisser.
    const page = await openAs(browser, ws, { width: 2400, height: 1100 });
    await openMissionPipeline(page, ws.missionId, name, 'kanban');
    await expect(column(page, 'À trier').getByText(name, { exact: true })).toBeVisible();
    const mark = await journalMark();

    // 1. Vers une étape d'entretien : interviewing et l'étape de la colonne.
    await dragCard(page, name, 'Entretien client');
    await expect(toast(page, `${name} déplacé vers « Entretien client »`)).toBeVisible({ timeout: 15_000 });
    // Toast après l'enregistrement : la base porte déjà l'étape quand il s'affiche.
    expect(await stageOf(rowId), 'étape enregistrée avant le toast').toEqual({ stage: 'interviewing', step: interview, source: 'user' });
    await expect(column(page, 'Entretien client').getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 });

    // 2. Vers Écarté : plus d'étape d'entretien.
    await dragCard(page, name, 'Écarté');
    await expect(toast(page, `${name} déplacé vers « Écarté »`)).toBeVisible({ timeout: 15_000 });
    expect(await stageOf(rowId)).toEqual({ stage: 'rejected', step: null, source: 'user' });
    await expect(column(page, 'Écarté').getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 });

    // 3. Restauration : d'Écarté vers À trier.
    await dragCard(page, name, 'À trier');
    await expect(toast(page, `${name} déplacé vers « À trier »`)).toBeVisible({ timeout: 15_000 });
    expect(await stageOf(rowId)).toEqual({ stage: 'to_sort', step: null, source: 'user' });
    await expect(column(page, 'À trier').getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 });

    await expectNoDirectWrite(ws, mark);
  });
});

// ═══ Tableau de mission (vue par défaut de l'onglet Pipeline) ═══════════════

test.describe('Lot 0b-4 : tableau de mission', () => {
  test('« Retenir » groupé retient le candidat à trier et laisse le contacté à son étape ; « Écarter » d’une ligne écarte', async ({ browser }) => {
    const ws = await workspace('E2E 0b4 tableau');
    const toSort = 'Chloe Atrier';
    const contacted = 'Denis Contacte';
    const toSortId = await candidate(ws, toSort);
    const contactedId = await candidate(ws, contacted, 'contacted');

    const page = await openAs(browser, ws);
    await openMissionPipeline(page, ws.missionId, toSort, 'table');
    const mark = await journalMark();

    for (const name of [toSort, contacted]) {
      await page.getByRole('row').filter({ hasText: name }).getByRole('checkbox').click();
    }
    await page.getByRole('button', { name: 'Retenir', exact: true }).click();
    await expect(toast(page, '1 candidat mis à jour. 1 candidat déjà plus loin, laissé à son étape.')).toBeVisible({ timeout: 15_000 });
    expect(await stageOf(toSortId)).toEqual({ stage: 'retained', step: null, source: 'user' });
    expect((await stageOf(contactedId)).stage, 'un candidat contacté ne recule pas vers Retenu').toBe('contacted');

    await page.getByRole('button', { name: `Actions pour ${toSort}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Écarter', exact: true }).click();
    await expect(toast(page, '1 candidat mis à jour.').last()).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => (await stageOf(toSortId)).stage, { timeout: 15_000 }).toBe('rejected');
    expect((await stageOf(toSortId)).source).toBe('user');

    await expectNoDirectWrite(ws, mark);
  });
});

// ═══ /pipeline ══════════════════════════════════════════════════════════════

test.describe('Lot 0b-4 : /pipeline', () => {
  test('déplacement vers « Écarté » puis « Annuler » : la cible exacte revient, étape d’entretien comprise', async ({ browser }) => {
    const ws = await workspace('E2E 0b4 pipeline annuler');
    const steps = await processSteps(ws, ['Entretien RH', 'Entretien client']);
    const interview = steps.get('Entretien client')!;
    const name = 'Emma Entretien';
    const rowId = await candidate(ws, name, 'interviewing', interview);

    const page = await openAs(browser, ws);
    await openGlobalPipeline(page, name);
    // Étape de mission (identifiant) affichée « ITW en cours » (lot 0b-2a).
    await expect(page.locator('[aria-label^="Colonne ITW en cours,"]').getByText(name, { exact: true })).toBeVisible();
    const mark = await journalMark();

    await moveCard(page, name, 'Écarté');
    const moved = toast(page, `${name} est maintenant à l'étape\u00a0«\u00a0Écarté\u00a0»`);
    await expect(moved).toBeVisible({ timeout: 15_000 });
    expect(await stageOf(rowId), 'Écarté enregistré avant le toast').toEqual({ stage: 'rejected', step: null, source: 'user' });

    await moved.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect.poll(() => stageOf(rowId), { timeout: 15_000 }).toEqual({ stage: 'interviewing', step: interview, source: 'user' });
    // Le toast de l'annulation nomme l'étape en mots, jamais par son identifiant.
    await expect(toast(page, /est maintenant à l'étape/).last()).toBeVisible({ timeout: 15_000 });
    await expect.soft(toast(page, UUID_RE), 'aucun identifiant d’étape affiché').toHaveCount(0);

    await expectNoDirectWrite(ws, mark);
  });

  test('déplacement groupé depuis une étape de mission, puis « Annuler » : chaque candidat retrouve son étape d’entretien', async ({ browser }) => {
    const ws = await workspace('E2E 0b4 pipeline groupe');
    const steps = await processSteps(ws, ['Entretien RH', 'Entretien client']);
    const hr = steps.get('Entretien RH')!;
    const client = steps.get('Entretien client')!;
    const first = 'Farid Groupe';
    const second = 'Gaelle Groupe';
    const firstId = await candidate(ws, first, 'interviewing', hr);
    const secondId = await candidate(ws, second, 'interviewing', client);

    const page = await openAs(browser, ws);
    await openGlobalPipeline(page, first);
    await expect(page.getByText(second, { exact: true }).first()).toBeVisible();
    const mark = await journalMark();

    for (const name of [first, second]) {
      await page.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true }).click();
    }
    const bar = page.getByRole('toolbar', { name: 'Actions sur 2 candidats sélectionnés' });
    await bar.getByRole('button', { name: 'Déplacer vers…' }).click();
    await page.getByRole('menuitem', { name: 'Écarté', exact: true }).click();

    const moved = toast(page, '2 candidats déplacés vers «\u00a0Écarté\u00a0»');
    await expect(moved).toBeVisible({ timeout: 20_000 });
    for (const id of [firstId, secondId]) {
      expect(await stageOf(id)).toEqual({ stage: 'rejected', step: null, source: 'user' });
    }

    await moved.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect(toast(page, '2 candidats sont revenus à leur étape précédente.')).toBeVisible({ timeout: 20_000 });
    expect(await stageOf(firstId), 'première étape d’entretien restaurée').toEqual({ stage: 'interviewing', step: hr, source: 'user' });
    expect(await stageOf(secondId), 'seconde étape d’entretien restaurée').toEqual({ stage: 'interviewing', step: client, source: 'user' });

    await expectNoDirectWrite(ws, mark);
  });
});

// ═══ Sourcing ═══════════════════════════════════════════════════════════════

interface SearchProfile {
  id: string;
  name: string;
}

function asResult(p: SearchProfile) {
  const [firstName, ...rest] = p.name.split(' ');
  return {
    first_name: firstName,
    last_name: rest.join(' '),
    headline: 'Ingénieur backend',
    location: 'Paris, France',
    network_distance: 'SECOND_DEGREE',
    ...p,
  };
}

/** Onglet Sourcing de la mission : la recherche simulée affiche `profiles`. */
async function openSearchResults(browser: Browser, ws: Workspace, profiles: SearchProfile[]): Promise<Page> {
  const page = await openAs(browser, ws);
  const context = page.context();
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
  await page.goto(`/missions/${ws.missionId}?tab=sourcing`, { waitUntil: 'domcontentloaded' });
  await page.getByText('générer depuis le brief').click({ timeout: 30_000 });
  for (const p of profiles) {
    await expect(page.getByRole('checkbox', { name: `Sélectionner ${p.name}`, exact: true })).toBeVisible({ timeout: 30_000 });
  }
  return page;
}

/** Ligne du Sourcing (job_id « project:<mission> ») d'un candidat. */
async function sourcingRow(ws: Workspace, candidateId: string) {
  const { data, error } = await admin()
    .from('job_candidate_status')
    .select('id, general_stage, process_step_id, decision_source')
    .eq('organization_id', ws.org.orgId)
    .eq('candidate_id', candidateId)
    .eq('job_id', `project:${ws.missionId}`)
    .maybeSingle();
  if (error) throw new Error(`sourcingRow: ${error.message}`);
  const row = data as { id: string; general_stage: string; process_step_id: string | null; decision_source: string | null } | null;
  return row ? { stage: row.general_stage, step: row.process_step_id, source: row.decision_source } : null;
}

test.describe('Lot 0b-4 : Sourcing', () => {
  test('« Shortlister » retient un profil à trier et laisse un contacté à son étape ; « Archiver » écarte ; aucune écriture directe', async ({ browser }) => {
    const ws = await workspace('E2E 0b4 sourcing');
    const kept: SearchProfile = { id: `ACoAA0B4S${rand()}`, name: 'Hugo Retenu' };
    const archived: SearchProfile = { id: `ACoAA0B4A${rand()}`, name: 'Ines Archivee' };
    const contacted: SearchProfile = { id: `ACoAA0B4C${rand()}`, name: 'Jules Contacte' };
    await candidate(ws, contacted.name, 'contacted', null, contacted.id);

    const page = await openSearchResults(browser, ws, [kept, archived, contacted]);
    const mark = await journalMark();

    // Retenir : le profil à trier passe Retenu ; le contacté reste, et c'est annoncé.
    for (const p of [kept, contacted]) {
      await page.getByRole('checkbox', { name: `Sélectionner ${p.name}`, exact: true }).click();
    }
    await page.getByTitle('Shortlister pour cette mission').click();
    await expect(toast(page, '1 profil ajouté à la shortlist. 1 candidat déjà plus loin, laissé à son étape.')).toBeVisible({ timeout: 20_000 });
    expect(await sourcingRow(ws, kept.id)).toEqual({ stage: 'retained', step: null, source: 'user' });
    expect((await sourcingRow(ws, contacted.id))?.stage, 'un candidat contacté ne recule pas vers Retenu').toBe('contacted');

    // Archiver : Écarté, origine user.
    await page.getByRole('checkbox', { name: `Sélectionner ${archived.name}`, exact: true }).click();
    await page.getByTitle('Archiver les profils sélectionnés').click();
    await expect(toast(page, '1 profil archivé')).toBeVisible({ timeout: 20_000 });
    expect(await sourcingRow(ws, archived.id)).toEqual({ stage: 'rejected', step: null, source: 'user' });

    await expectNoDirectWrite(ws, mark);
  });
});
