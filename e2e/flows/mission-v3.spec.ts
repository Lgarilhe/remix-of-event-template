/**
 * Refonte mission, lots 1 et 2 : nouvelle page mission, allumée par défaut, avec
 * l'interrupteur par navigateur (clé konekt.mission-v3 du stockage local,
 * src/lib/missionBeta.ts) pour revenir à l'ancienne page.
 *
 * Parcours vérifiés dans le navigateur, sur la vraie base :
 *  1. /missions/:id ouvre la nouvelle page, Pipeline actif, sans le stepper ;
 *  2. trois onglets (Pipeline, Sourcing, Cadrage), Retour revient à l'écran
 *     précédent ; Cadrage : cinq sections, un critère enregistré, une étape
 *     sans candidat supprimée après confirmation ;
 *  3. fiche du candidat à droite (quatre onglets), fermée par Retour et Échap ;
 *  4. barre d'étapes « En ce moment » : une puce filtre (?etape=), un second
 *     clic revient à la liste par défaut, « Écartés » montre les écartés ;
 *  5. « Retenir » groupé depuis À trier : toast après l'écriture, toutes les
 *     lignes des groupes retenues (origine user), aucune écriture directe ;
 *  6. Bilan (?bilan=1), fermé par Retour ;
 *  7. profils jamais ouverts absents de la liste, de À trier et du kanban,
 *     lien « 1 profil trouvé » vers le Sourcing ;
 *  8. anciennes adresses ?tab= converties, interrupteur allumé ;
 *  9. nouvelle page par défaut (rien d'écrit dans le stockage) ;
 *     ?nouvelle-mission=0|1 ; « Revenir à l'ancienne page », choix gardé ;
 * 10. barre latérale allumée : pas de chevron des vues sur la mission.
 *
 * Harnais : stack locale (e2e/local-stack), comme stage-0b4-gestes.spec.ts.
 * Seuls la liste des comptes LinkedIn, la recherche LinkedIn, la génération
 * des filtres et la notation sont simulées dans le navigateur.
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
const BETA_KEY = 'konekt.mission-v3';
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
  missionName: string;
}

/** Cabinet sur offre payante, compte LinkedIn du propriétaire, mission décrite. */
async function workspace(label: string): Promise<Workspace> {
  const org = await createOrg('agency', label);
  orgsToDelete.push(org);
  await setOrgPlan(org.orgId);
  const accountId = await seedLinkedInAccount(org.orgId, org.owner.userId, `acc_v3_${rand()}`, 'OK');
  const missionName = `Mission V3 ${rand()}`;
  const missionId = await seedMission(org.orgId, org.owner.userId, { name: missionName });
  return { org, accountId, missionId, missionName };
}

/** Étapes d'entretien de la mission, dans l'ordre donné. */
async function processSteps(ws: Workspace, names: string[]): Promise<Map<string, string>> {
  const { data, error } = await admin().from('mission_process_steps').insert(
    names.map((name, i) => ({ project_id: ws.missionId, organization_id: ws.org.orgId, step_order: i, name, duration_minutes: 30 })),
  ).select('id, name');
  if (error || !data) throw new Error(`mission_process_steps: ${error?.message}`);
  return new Map((data as Array<{ id: string; name: string }>).map((s) => [s.name, s.id]));
}

async function candidate(
  ws: Workspace,
  name: string,
  stage: CandidateStage = 'to_sort',
  opts: { stepId?: string | null; candidateId?: string; extra?: Record<string, unknown> } = {},
): Promise<{ rowId: string; candidateId: string }> {
  const candidateId = opts.candidateId ?? `ACoAAV3${rand()}`;
  const { id } = await seedCandidateRow({
    orgId: ws.org.orgId,
    createdBy: ws.org.owner.userId,
    candidateId,
    missionId: ws.missionId,
    stage,
    stepId: opts.stepId ?? null,
    extra: {
      candidate_name: name,
      candidate_headline: 'Ingénieur backend',
      linkedin_profile_url: `https://www.linkedin.com/in/${candidateId.toLowerCase()}`,
      ...opts.extra,
    },
  });
  return { rowId: id, candidateId };
}

const N = {
  retained: 'Rita Retenue',
  contacted: 'Carl Contacte',
  replied: 'Rose Repondu',
  interviewing: 'Eric Entretien',
  rejected: 'Ethan Ecarte',
  toSortA: 'Anna Atrier',
  toSortB: 'Bruno Atrier',
  toSortC: 'Chloe Atrier',
  unopened: 'Jamais Ouvert',
} as const;

interface Seeded {
  steps: Map<string, string>;
  rows: Record<keyof typeof N, string>;
  /** Seconde ligne d'Anna dans la mission (ancienne forme de job_id) : même groupe. */
  annaDuplicateRowId: string;
}

/**
 * Jeu du contrat : deux étapes d'entretien ; Retenu, Contacté, A répondu, En
 * entretien (première étape), Écarté ; trois À trier notés ; un jamais ouvert.
 * Anna a deux lignes dans la mission (doublon) : un geste écrit tout le groupe.
 */
async function seedPipeline(ws: Workspace): Promise<Seeded> {
  const steps = await processSteps(ws, ['Préqualification', 'Entretien client']);
  const first = steps.get('Préqualification')!;
  const scored = { score: 70, status: 'new' };
  const rows = {
    retained: (await candidate(ws, N.retained, 'retained')).rowId,
    contacted: (await candidate(ws, N.contacted, 'contacted')).rowId,
    replied: (await candidate(ws, N.replied, 'replied')).rowId,
    interviewing: (await candidate(ws, N.interviewing, 'interviewing', { stepId: first })).rowId,
    rejected: (await candidate(ws, N.rejected, 'rejected')).rowId,
    toSortA: '',
    toSortB: (await candidate(ws, N.toSortB, 'to_sort', { extra: scored })).rowId,
    toSortC: (await candidate(ws, N.toSortC, 'to_sort', { extra: scored })).rowId,
    unopened: (await candidate(ws, N.unopened, 'to_sort', { extra: { status: 'discovered' } })).rowId,
  };
  const anna = await candidate(ws, N.toSortA, 'to_sort', { extra: scored });
  rows.toSortA = anna.rowId;

  const { data, error } = await admin()
    .from('job_candidate_status')
    .insert({
      organization_id: ws.org.orgId,
      project_id: ws.missionId,
      job_id: ws.missionId,
      candidate_id: anna.candidateId,
      created_by: ws.org.owner.userId,
      candidate_name: N.toSortA,
      status: 'new',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`doublon d'Anna : ${error?.message}`);
  return { steps, rows, annaDuplicateRowId: data.id as string };
}

// ─── Journal des écritures directes (lecture en clé de service) ────────────

/** Dernier identifiant du journal, pris juste avant le geste. */
async function journalMark(): Promise<number> {
  const { data, error } = await admin().from('jcs_direct_write_log').select('id').order('id', { ascending: false }).limit(1);
  if (error) throw new Error(`jcs_direct_write_log: ${error.message}`);
  return Number((data as Array<{ id: number }> | null)?.[0]?.id ?? 0);
}

/** Écritures directes de l'étape journalisées pour l'organisation depuis `mark`. */
async function journalSince(orgId: string, mark: number): Promise<unknown[]> {
  const { data, error } = await admin()
    .from('jcs_direct_write_log')
    .select('id, op, db_role, row_id, old_status, new_status, old_pipeline_stage, new_pipeline_stage, old_general_stage, new_general_stage, client_info')
    .eq('organization_id', orgId)
    .gt('id', mark)
    .order('id');
  if (error) throw new Error(`jcs_direct_write_log: ${error.message}`);
  return data ?? [];
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

const json = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

/**
 * Page connectée en propriétaire. `beta` : valeur de l'interrupteur posée avec
 * la session, avant le premier chargement (true : nouvelle page, false :
 * ancienne page, 'default' : rien d'écrit, la valeur par défaut de l'application).
 * Les changements faits ensuite par la page (?nouvelle-mission=0, « Revenir à
 * l'ancienne page ») restent dans le contexte, rechargements compris.
 */
async function openAs(browser: Browser, ws: Workspace, opts: { beta: boolean | 'default' }): Promise<Page> {
  const context = await browser.newContext({
    storageState: await storageStateForUser(ws.org.owner, opts.beta === 'default' ? 'default' : opts.beta ? 'v3' : 'legacy'),
    timezoneId: 'Europe/Paris',
  });
  contexts.push(context);
  await context.route('**/functions/v1/unipile-accounts', async (route) => {
    if (actionOf(route) !== 'list') return route.continue();
    await json(route, { success: true, accounts: [{ id: ws.accountId, account_status: 'OK', provider: 'LINKEDIN', name: 'E2E LinkedIn' }] });
  });
  await context.route('**/functions/v1/unipile-search', (route) =>
    json(route, actionOf(route) === 'search' ? { success: true, results: [], cursor: null, total: 0 } : { success: true, items: [] }),
  );
  await context.route('**/functions/v1/generate-search-filters', (route) =>
    json(route, { success: true, filters: { keywords: 'Backend Engineer' }, suggestions: null }),
  );
  await context.route('**/functions/v1/score-profile-job', (route) => json(route, { success: true, scores: [] }));
  const page = await context.newPage();
  // Tutoriel vidéo du pipeline de l'ancienne page déjà vu.
  await page.addInitScript(() => { try { localStorage.setItem('konekt:tuto:seen:pipeline', '1'); } catch { /* sans stockage */ } });
  return page;
}

const missionUrl = (ws: Workspace, rest = '') => `/missions/${ws.missionId}${rest}`;
/** Adresse exacte de la mission : chemin puis, au choix, une recherche exacte. */
const urlIs = (ws: Workspace, rest = '') => new RegExp(`/missions/${escapeRe(ws.missionId)}${escapeRe(rest)}$`);
/** Chemin exact, recherche libre. */
const pathIs = (ws: Workspace, sub = '') => new RegExp(`/missions/${escapeRe(ws.missionId)}${escapeRe(sub)}(\\?[^#]*)?$`);

const shell = (page: Page) => page.getByTestId('mission-v3');
const tabs = (page: Page) => page.getByRole('navigation', { name: 'Écrans de la mission' });
const panel = (page: Page) => page.getByTestId('mission-panel');
const list = (page: Page) => page.getByTestId('candidate-list');
const listRows = (page: Page) => list(page).getByTestId('candidate-row');
const stageBar = (page: Page) => page.getByTestId('stage-bar');
const toast = (page: Page, text: string | RegExp) => page.locator('[data-sonner-toast]').filter({ hasText: text });
/** Stepper de l'ancienne page (PhaseStepper), dans le contenu seulement. */
const oldStepper = (page: Page) => page.locator('#main-content').getByText('Sourcing & Outreach', { exact: true });
const betaValue = (page: Page) => page.evaluate((key) => { try { return localStorage.getItem(key); } catch { return 'indisponible'; } }, BETA_KEY);

async function openPipeline(page: Page, ws: Workspace, anyName: string = N.retained) {
  await page.goto(missionUrl(ws), { waitUntil: 'domcontentloaded' });
  await expect(shell(page)).toBeVisible({ timeout: 30_000 });
  await expect(listRows(page).filter({ hasText: anyName })).toBeVisible({ timeout: 30_000 });
}

async function openToSort(page: Page, count: number) {
  await page.getByRole('button', { name: `À trier (${count})`, exact: true }).click();
  await expect(page.getByTestId('to-sort-list').getByTestId('candidate-row')).toHaveCount(count, { timeout: 30_000 });
}

/** Onglet Missions de la barre latérale, sélectionné sans second clic (qui ouvrirait /missions). */
async function showSidebarMissions(page: Page) {
  const tab = page.getByRole('tab', { name: 'Missions' });
  await expect(tab).toBeVisible({ timeout: 30_000 });
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

// ═══ 1 et 2 : ouverture, trois onglets, Retour ══════════════════════════════

test.describe('Lots 1 et 2 : coquille de la nouvelle page mission', () => {
  test('/missions/:id ouvre Pipeline sans stepper ; Sourcing et Cadrage par les onglets ; Retour revient à l’écran précédent', async ({ browser }) => {
    const ws = await workspace('E2E V3 coquille');
    await seedPipeline(ws);
    const page = await openAs(browser, ws, { beta: true });

    await openPipeline(page, ws);
    await expect(page).toHaveURL(urlIs(ws));
    await expect(tabs(page).getByRole('link', { name: 'Pipeline', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(oldStepper(page), 'pas de stepper de l’ancienne page').toHaveCount(0);

    // Sourcing.
    await tabs(page).getByRole('link', { name: 'Sourcing', exact: true }).click();
    await expect(page).toHaveURL(pathIs(ws, '/sourcing'));
    await expect(tabs(page).getByRole('link', { name: 'Sourcing', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(tabs(page).getByRole('link', { name: 'Pipeline', exact: true })).not.toHaveAttribute('aria-current', 'page');

    // Cadrage : cinq sections (Équipe : cabinet sur offre payante), Réglages repliés.
    await tabs(page).getByRole('link', { name: 'Cadrage', exact: true }).click();
    await expect(page).toHaveURL(pathIs(ws, '/cadrage'));
    for (const [id, title] of [
      ['cadrage-criteres', 'Critères'],
      ['cadrage-poste', 'Le poste'],
      ['cadrage-etapes', "Étapes d'entretien"],
      ['cadrage-equipe', 'Équipe'],
      ['cadrage-reglages', 'Réglages'],
    ]) {
      const section = page.locator(`#${id}`);
      await expect(section).toBeVisible({ timeout: 30_000 });
      await expect(section.getByText(title, { exact: true }).first()).toBeVisible();
    }
    await expect(page.locator('#cadrage-reglages [aria-expanded]').first(), 'Réglages repliés').toHaveAttribute('aria-expanded', 'false');

    // Retour : Sourcing, puis Pipeline.
    await page.goBack();
    await expect(page).toHaveURL(pathIs(ws, '/sourcing'));
    await expect(tabs(page).getByRole('link', { name: 'Sourcing', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.goBack();
    await expect(page).toHaveURL(urlIs(ws));
    await expect(tabs(page).getByRole('link', { name: 'Pipeline', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(listRows(page).filter({ hasText: N.retained })).toBeVisible({ timeout: 30_000 });
  });

  test('Cadrage : un critère modifié est enregistré ; une étape sans candidat se supprime après confirmation', async ({ browser }) => {
    const ws = await workspace('E2E V3 cadrage');
    await processSteps(ws, ['Étape vide']);
    const page = await openAs(browser, ws, { beta: true });
    await page.goto(missionUrl(ws, '/cadrage'), { waitUntil: 'domcontentloaded' });
    const criteria = page.locator('#cadrage-criteres');
    await expect(criteria).toBeVisible({ timeout: 30_000 });

    // Critère : libellé, puis importance ; enregistré 800 ms après la dernière frappe.
    await criteria.getByRole('button', { name: 'Ajouter un critère' }).click();
    const label = criteria.getByRole('textbox', { name: 'Libellé du critère 1' });
    await expect(label).toBeFocused();
    await label.fill('Culture produit');
    await criteria
      .getByRole('group', { name: 'Importance du critère Culture produit' })
      .getByRole('button', { name: 'Indispensable' })
      .click();
    await expect(page.getByText('Enregistré', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(async () => {
        const { data } = await admin().from('sourcing_projects').select('job_details').eq('id', ws.missionId).single();
        const list = ((data?.job_details as { evaluation_criteria?: Array<{ label: string; weight: number }> } | null)
          ?.evaluation_criteria) ?? [];
        return list.map((c) => [c.label, c.weight]);
      }, { timeout: 15_000 })
      .toEqual([['Culture produit', 3]]);

    // Étape sans candidat : confirmation, puis suppression.
    const steps = page.locator('#cadrage-etapes');
    await steps.getByRole('button', { name: "Supprimer l'étape Étape vide" }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText("Aucun candidat n'est à cette étape.", { timeout: 15_000 });
    await dialog.getByRole('button', { name: "Supprimer l'étape" }).click();
    await expect(toast(page, 'Étape « Étape vide » supprimée.')).toBeVisible({ timeout: 15_000 });
    await expect(steps.getByText('Aucune étape. Ajoutez au moins une étape pour suivre les entretiens.')).toBeVisible();
    const { count } = await admin()
      .from('mission_process_steps')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', ws.missionId);
    expect(count).toBe(0);
  });

  // ═══ 3 : fiche ════════════════════════════════════════════════════════════

  test('clic sur une ligne : fiche à droite avec quatre onglets ; Retour et Échap la ferment', async ({ browser }) => {
    const ws = await workspace('E2E V3 fiche');
    const seeded = await seedPipeline(ws);
    const page = await openAs(browser, ws, { beta: true });
    await openPipeline(page, ws);

    const row = page.locator(`[data-testid="candidate-row"][data-row-id="${seeded.rows.retained}"]`);
    await expect(row).toContainText(N.retained);

    const openFiche = async () => {
      await row.getByText(N.retained, { exact: true }).click();
      await expect(panel(page)).toBeVisible({ timeout: 15_000 });
      await expect(panel(page)).toHaveAttribute('data-panel', 'fiche');
      await expect(page).toHaveURL(new RegExp(`[?&]panneau=fiche(&|$)`));
      await expect(page).toHaveURL(new RegExp(`[?&]candidat=${escapeRe(seeded.rows.retained)}(&|$)`));
    };

    await openFiche();
    await expect(panel(page)).toContainText(N.retained, { timeout: 30_000 });
    const tablist = panel(page).getByRole('tablist', { name: 'Fiche du candidat' });
    await expect(tablist).toBeVisible({ timeout: 30_000 });
    for (const name of ['Aperçu', 'Échanges', 'Évaluations', 'Profil']) {
      await expect(tablist.getByRole('tab', { name, exact: true })).toBeVisible();
    }
    await expect(tablist.getByRole('tab', { name: 'Aperçu', exact: true })).toHaveAttribute('aria-selected', 'true');
    // La liste reste visible à côté de la fiche (ordinateur).
    await expect(row).toBeVisible();

    // Retour ferme la fiche.
    await page.goBack();
    await expect(panel(page)).toHaveCount(0);
    await expect(page).toHaveURL(urlIs(ws));

    // Échap aussi.
    await openFiche();
    await expect(panel(page).getByRole('tablist', { name: 'Fiche du candidat' })).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await expect(page).not.toHaveURL(/[?&]panneau=/);
  });

  // ═══ 4 : barre d'étapes et filtre ════════════════════════════════════════

  test('barre d’étapes : « A répondu 1 » filtre, second clic revient à la liste en cours, « Écartés 1 » montre l’écarté', async ({ browser }) => {
    const ws = await workspace('E2E V3 etapes');
    await seedPipeline(ws);
    const page = await openAs(browser, ws, { beta: true });
    await openPipeline(page, ws);

    const bar = stageBar(page);
    await expect(bar).toBeVisible();
    // Effectifs « en ce moment », sous le nom de l'étape ; étapes d'entretien réelles.
    for (const name of ['À trier 3', 'Retenus 1', 'Contactés 1', 'A répondu 1', 'Préqualification 1', 'Entretien client 0', 'Embauché 0', 'Écartés 1']) {
      await expect(bar.getByRole('button', { name, exact: true }), `puce « ${name} »`).toBeVisible({ timeout: 30_000 });
    }

    // Liste par défaut : les candidats en cours, ni À trier, ni écarté, ni jamais ouvert.
    await expect(listRows(page)).toHaveCount(4, { timeout: 30_000 });
    for (const name of [N.toSortA, N.rejected, N.unopened]) {
      await expect(list(page).getByText(name, { exact: true })).toHaveCount(0);
    }

    const replied = bar.getByRole('button', { name: 'A répondu 1', exact: true });
    await replied.click();
    await expect(replied).toHaveAttribute('aria-pressed', 'true');
    await expect(replied).toHaveAttribute('data-stage', 'replied');
    await expect(page).toHaveURL(/[?&]etape=replied(&|$)/);
    await expect(listRows(page)).toHaveCount(1, { timeout: 30_000 });
    await expect(listRows(page).first()).toContainText(N.replied);

    await replied.click();
    await expect(replied).toHaveAttribute('aria-pressed', 'false');
    await expect(page).not.toHaveURL(/[?&]etape=/);
    await expect(listRows(page)).toHaveCount(4, { timeout: 30_000 });

    const rejected = bar.getByRole('button', { name: 'Écartés 1', exact: true });
    await rejected.click();
    await expect(rejected).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/[?&]etape=rejected(&|$)/);
    await expect(listRows(page)).toHaveCount(1, { timeout: 30_000 });
    await expect(listRows(page).first()).toContainText(N.rejected);
  });

  // ═══ 5 : Retenir groupé ══════════════════════════════════════════════════

  test('« Retenir » depuis À trier : toast après l’écriture, toutes les lignes des groupes retenues, aucune écriture directe', async ({ browser }) => {
    const ws = await workspace('E2E V3 retenir');
    const seeded = await seedPipeline(ws);
    const page = await openAs(browser, ws, { beta: true });
    await openPipeline(page, ws);

    await openToSort(page, 3);
    const toSort = page.getByTestId('to-sort-list');
    await expect(toSort.getByText(N.unopened, { exact: true })).toHaveCount(0);
    for (const name of [N.toSortA, N.toSortB]) {
      await toSort.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true }).click();
    }
    const bar = page.getByRole('toolbar', { name: 'Actions sur la sélection' });
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('2 candidats sélectionnés');

    const mark = await journalMark();
    await bar.getByRole('button', { name: 'Retenir', exact: true }).click();
    await expect(toast(page, '2 candidats retenus.')).toBeVisible({ timeout: 20_000 });

    // Toast après l'écriture : la base porte déjà l'étape quand il s'affiche,
    // sur les deux lignes d'Anna (doublon) comme sur celle de Bruno.
    for (const id of [seeded.rows.toSortA, seeded.annaDuplicateRowId, seeded.rows.toSortB]) {
      const s = await candidateRowState(id);
      expect({ stage: s.general_stage, source: s.decision_source }, `ligne ${id}`).toEqual({ stage: 'retained', source: 'user' });
    }
    const untouched = await candidateRowState(seeded.rows.toSortC);
    expect(untouched.general_stage, 'Chloé, non cochée, reste à trier').toBe('to_sort');
    const unopened = await candidateRowState(seeded.rows.unopened);
    expect(unopened.general_stage, 'le jamais ouvert ne bouge pas').toBe('to_sort');

    await expectNoDirectWrite(ws, mark);

    // Relecture : effectifs à jour, sans rechargement.
    await expect(stageBar(page).getByRole('button', { name: 'Retenus 3', exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'À trier (1)', exact: true })).toBeVisible({ timeout: 20_000 });
  });

  // ═══ 6 : Bilan ═══════════════════════════════════════════════════════════

  test('Bilan : trois taux depuis le début de la mission, fermé par Retour', async ({ browser }) => {
    const ws = await workspace('E2E V3 bilan');
    await seedPipeline(ws);
    const page = await openAs(browser, ws, { beta: true });
    await openPipeline(page, ws);

    const toggle = page.getByRole('button', { name: 'Bilan', exact: true });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    const bilan = page.getByTestId('bilan');
    await expect(bilan).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/[?&]bilan=1(&|$)/);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(bilan).toContainText('Depuis le début de la mission');
    // Cumuls de get_mission_stage_counts : 5 triés par vous (hors À trier),
    // 4 retenus au total (l'écarté l'a été depuis À trier), 3 contactés, 2 réponses.
    await expect(bilan).toContainText('4 retenus sur 5 profils triés par vous', { timeout: 15_000 });
    await expect(bilan).toContainText('3 ont été contactés sur 4 retenus');
    await expect(bilan).toContainText('2 ont répondu sur 3 contactés');

    await page.goBack();
    await expect(bilan).toHaveCount(0);
    await expect(page).toHaveURL(urlIs(ws));
  });

  // ═══ 7 : jamais ouverts ══════════════════════════════════════════════════

  test('profils jamais ouverts : absents de la liste, de À trier et du kanban ; « 1 profil trouvé » mène au Sourcing', async ({ browser }) => {
    const ws = await workspace('E2E V3 jamais ouverts');
    await seedPipeline(ws);
    const page = await openAs(browser, ws, { beta: true });
    await openPipeline(page, ws);

    await expect(list(page).getByText(N.unopened, { exact: true })).toHaveCount(0);
    await openToSort(page, 3);
    await expect(page.getByTestId('to-sort-list').getByText(N.unopened, { exact: true })).toHaveCount(0);

    // Kanban (?vue=etapes) : ni À trier (tri dans la section de la liste), ni
    // Écartés (derrière leur puce), ni jamais ouvert.
    await page.getByRole('group', { name: 'Affichage' }).getByRole('button', { name: 'Par étape', exact: true }).click();
    await expect(page).toHaveURL(/[?&]vue=etapes(&|$)/);
    const board = page.getByTestId('mission-board');
    await expect(board).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('to-sort-list'), 'la liste laisse la place au kanban').toHaveCount(0);
    // Quatre candidats en cours (Retenus, Contactés, A répondu, Préqualification).
    await expect(board.getByTestId('board-card')).toHaveCount(4, { timeout: 30_000 });
    await expect(board.getByTestId('board-card').filter({ hasText: N.toSortA })).toHaveCount(0);
    await expect(board.getByTestId('board-card').filter({ hasText: N.rejected })).toHaveCount(0);
    await expect(board.getByTestId('board-card').filter({ hasText: N.retained })).toHaveCount(1);
    await expect(page.locator('#main-content').getByText(N.unopened, { exact: true })).toHaveCount(0);

    const link = page.getByTestId('unopened-link');
    await expect(link).toHaveText('1 profil trouvé', { timeout: 30_000 });
    await link.click();
    await expect(page).toHaveURL(pathIs(ws, '/sourcing'));
    await expect(tabs(page).getByRole('link', { name: 'Sourcing', exact: true })).toHaveAttribute('aria-current', 'page');
  });

  // ═══ 8 : anciennes adresses ══════════════════════════════════════════════

  test('interrupteur allumé : les anciennes adresses ?tab= mènent au bon écran', async ({ browser }) => {
    const ws = await workspace('E2E V3 adresses');
    const page = await openAs(browser, ws, { beta: true });

    await page.goto(missionUrl(ws, '?tab=process'), { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(urlIs(ws, '/cadrage?section=etapes'), { timeout: 30_000 });
    await expect(page.locator('#cadrage-etapes')).toBeVisible({ timeout: 30_000 });
    await expect(tabs(page).getByRole('link', { name: 'Cadrage', exact: true })).toHaveAttribute('aria-current', 'page');

    await page.goto(missionUrl(ws, '?tab=outreach'), { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(urlIs(ws, '?panneau=contact'), { timeout: 30_000 });
    await expect(panel(page)).toBeVisible({ timeout: 30_000 });
    await expect(panel(page)).toHaveAttribute('data-panel', 'contact');
    await expect(panel(page)).toContainText('Prise de contact');

    await page.goto(missionUrl(ws, '?tab=insights'), { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(urlIs(ws, '?bilan=1'), { timeout: 30_000 });
    await expect(page.getByTestId('bilan')).toBeVisible({ timeout: 30_000 });

    await page.goto(missionUrl(ws, '?tab=sourcing'), { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(pathIs(ws, '/sourcing'), { timeout: 30_000 });
    await expect(shell(page)).toBeVisible();
  });

  // ═══ 9 : interrupteur ═══════════════════════════════════════════════════

  test('interrupteur : nouvelle page par défaut ; ?nouvelle-mission=0|1 ; « Revenir à l’ancienne page »', async ({ browser }) => {
    const ws = await workspace('E2E V3 interrupteur');
    const page = await openAs(browser, ws, { beta: 'default' });

    // Navigateur sans choix : la nouvelle page, et rien d'écrit dans le stockage.
    await page.goto(missionUrl(ws), { waitUntil: 'domcontentloaded' });
    await expect(shell(page)).toBeVisible({ timeout: 30_000 });
    await expect(oldStepper(page)).toHaveCount(0);
    await expect(page).toHaveURL(urlIs(ws));
    expect(await betaValue(page)).toBeNull();

    // Une ancienne adresse mène à l'écran correspondant de la nouvelle page.
    await page.goto(missionUrl(ws, '?tab=sourcing'), { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(pathIs(ws, '/sourcing'), { timeout: 30_000 });
    await expect(shell(page)).toBeVisible({ timeout: 30_000 });

    // ?nouvelle-mission=0 : l'ancienne page, choix gardé, paramètre retiré.
    await page.goto(missionUrl(ws, '?nouvelle-mission=0'), { waitUntil: 'domcontentloaded' });
    await expect(oldStepper(page)).toBeVisible({ timeout: 30_000 });
    await expect(shell(page)).toHaveCount(0);
    await expect(page).toHaveURL(urlIs(ws));
    expect(await betaValue(page)).toBe('0');

    // Le choix survit au rechargement ; une adresse de la nouvelle page revient à l'ancienne vue.
    await page.goto(missionUrl(ws), { waitUntil: 'domcontentloaded' });
    await expect(oldStepper(page)).toBeVisible({ timeout: 30_000 });
    await page.goto(missionUrl(ws, '/sourcing'), { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(urlIs(ws, '?tab=sourcing'), { timeout: 30_000 });
    await expect(oldStepper(page)).toBeVisible({ timeout: 30_000 });
    await expect(shell(page)).toHaveCount(0);

    // Depuis l'ancienne page, « Passer à la nouvelle page » rallume en un clic, au même endroit.
    await page.getByRole('button', { name: 'Passer à la nouvelle page', exact: true }).click();
    await expect(page).toHaveURL(pathIs(ws, '/sourcing'), { timeout: 30_000 });
    await expect(shell(page)).toBeVisible({ timeout: 30_000 });
    expect(await betaValue(page)).toBe('1');

    // ?nouvelle-mission=1 rallume aussi, puis quitte l'adresse.
    await page.goto(missionUrl(ws, '?nouvelle-mission=1'), { waitUntil: 'domcontentloaded' });
    await expect(shell(page)).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(urlIs(ws));
    expect(await betaValue(page)).toBe('1');

    // « Revenir à l'ancienne page » : éteint, même endroit dans l'ancienne page.
    await tabs(page).getByRole('link', { name: 'Sourcing', exact: true }).click();
    await expect(page).toHaveURL(pathIs(ws, '/sourcing'));
    // Dans le menu « ... » de l'en-tête.
    await shell(page).getByRole('button', { name: "Plus d'actions", exact: true }).first().click();
    await page.getByRole('menuitem', { name: "Revenir à l'ancienne page", exact: true }).click();
    await expect(page).toHaveURL(urlIs(ws, '?tab=sourcing'), { timeout: 30_000 });
    await expect(oldStepper(page)).toBeVisible({ timeout: 30_000 });
    await expect(shell(page)).toHaveCount(0);
    expect(await betaValue(page)).toBe('0');

    // ?nouvelle-mission=0 depuis une adresse de la nouvelle page : éteint, ancienne vue.
    await page.goto(missionUrl(ws, '?nouvelle-mission=1'), { waitUntil: 'domcontentloaded' });
    await expect(shell(page)).toBeVisible({ timeout: 30_000 });
    await page.goto(missionUrl(ws, '/cadrage?section=etapes&nouvelle-mission=0'), { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(urlIs(ws, '?tab=process'), { timeout: 30_000 });
    await expect(oldStepper(page)).toBeVisible({ timeout: 30_000 });
    await expect(shell(page)).toHaveCount(0);
    expect(await betaValue(page)).toBe('0');

    // Barre latérale éteinte : le chevron des vues reste (témoin du test suivant).
    await showSidebarMissions(page);
    await expect(page.getByRole('button', { name: `Afficher les vues de ${ws.missionName}`, exact: true })).toBeVisible({ timeout: 30_000 });
  });

  // ═══ 10 : barre latérale allumée ═════════════════════════════════════════

  test('barre latérale allumée : la mission ouverte n’a pas de chevron des vues', async ({ browser }) => {
    const ws = await workspace('E2E V3 barre');
    const page = await openAs(browser, ws, { beta: true });
    await page.goto(missionUrl(ws), { waitUntil: 'domcontentloaded' });
    await expect(shell(page)).toBeVisible({ timeout: 30_000 });

    await showSidebarMissions(page);
    const sidebar = page.locator('#sidebar-panel');
    await expect(sidebar.getByText(ws.missionName, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: `Afficher les vues de ${ws.missionName}`, exact: true })).toHaveCount(0);
  });
});
