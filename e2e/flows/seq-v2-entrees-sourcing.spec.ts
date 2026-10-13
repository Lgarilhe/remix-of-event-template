/**
 * Refonte mission, lot 5f-2d : le Sourcing et les recherches ouvrent le flux
 * d'inscription du panneau Contacter dans une feuille latérale (interrupteur des
 * séquences allumé, valeur par défaut).
 *
 *  - Sourcing de la mission (ancienne page, ?tab=sourcing) : le bouton « Séquence »
 *    de la barre de sélection ouvre la feuille « Prise de contact » (pas un menu),
 *    titre « Contacter 3 candidats », séquence de la mission choisie d'avance,
 *    « Inscrire 3 candidats » ; trois inscriptions, lignes Retenu (job_id
 *    project:<mission> pour les lignes créées), feuille fermée, cases décochées ;
 *  - un candidat déjà dans la séquence est rangé « Déjà dans cette séquence » et
 *    reste coché : seuls les inscrits quittent la sélection ;
 *  - un clic dans la feuille n'ouvre pas la fiche du profil ;
 *  - interrupteur éteint : le menu « Séquence » d'avant, aucune feuille ;
 *  - recherche autonome (/sourcing/<id>) : même parcours.
 *
 * Harnais : stack locale (vraie base, vraies gardes, vraies fonctions serveur pour
 * l'aperçu : E2E_EDGE_FUNCTIONS=1). Sont simulés dans le navigateur la liste des
 * comptes LinkedIn, la recherche LinkedIn, la génération des filtres et le scoring
 * (même simulation que seq-retenu.spec.ts).
 */
import type { Browser, BrowserContext, Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures';
import { buildScoringInputVersionKey } from '../../src/lib/sourcingScoringContext';
import { pinLegacySequences } from '../helpers/env';
import {
  admin,
  createOrg,
  deleteOrg,
  seedCandidateRow,
  seedEnrollment,
  seedLinkedInAccount,
  seedMission,
  setOrgPlan,
  storageStateForUser,
  type TestOrg,
} from '../helpers/supabase-admin';

test.describe.configure({ timeout: 180_000 });

const rand = () => Math.random().toString(36).slice(2, 10);

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
  /** Mission (kind mission) ou recherche autonome (kind search) : le projet dont le Sourcing est ouvert. */
  projectId: string;
}

async function workspace(label: string, kind: 'mission' | 'search' = 'mission'): Promise<Workspace> {
  const org = await createOrg('agency', label);
  orgsToDelete.push(org);
  await setOrgPlan(org.orgId);
  const accountId = await seedLinkedInAccount(org.orgId, org.owner.userId, `acc_ent_${rand()}`, 'OK');
  const projectId = await seedMission(org.orgId, org.owner.userId, {
    name: `${kind === 'search' ? 'Recherche' : 'Mission'} entrées ${rand()}`,
    ...(kind === 'search' ? { kind: 'search' } : {}),
  });
  return { org, accountId, projectId };
}

interface SeededSeq {
  id: string;
  name: string;
}

/**
 * Séquence active à une étape : invitation sans note (aucune génération par l'IA, aucun message à relire).
 * `projectId` nul : séquence de l'organisation, rattachée à aucune mission.
 */
async function invitationSequence(ws: Workspace, projectId: string | null = ws.projectId): Promise<SeededSeq> {
  const name = `Entrées ${rand()}`;
  const { data: seq, error } = await admin()
    .from('outreach_sequences')
    .insert({ name, organization_id: ws.org.orgId, created_by: ws.org.owner.userId, project_id: projectId, is_active: true })
    .select('id')
    .single();
  if (error || !seq) throw new Error(`invitationSequence: ${error?.message}`);
  const { error: stepErr } = await admin().from('sequence_steps').insert({
    sequence_id: seq.id,
    organization_id: ws.org.orgId,
    step_order: 0,
    condition_type: 'always',
    delay_days: 0,
    action_type: 'connection_request',
    message_template: null,
  });
  if (stepErr) throw new Error(`invitationSequence(étape): ${stepErr.message}`);
  return { id: seq.id as string, name };
}

interface Candidate {
  id: string;
  name: string;
}

const candidateOf = (tag: string, name: string): Candidate => ({ id: `ACoAAENT${tag}${rand()}`, name });

async function rowsOf(ws: Workspace, ids: string[]) {
  const { data, error } = await admin()
    .from('job_candidate_status')
    .select('candidate_id, general_stage, decision_source, job_id, project_id')
    .eq('organization_id', ws.org.orgId)
    .in('candidate_id', ids);
  if (error) throw new Error(`rowsOf: ${error.message}`);
  return (data ?? []) as Array<{ candidate_id: string; general_stage: string; decision_source: string | null; job_id: string; project_id: string | null }>;
}

async function enrollmentsOf(sequenceId: string) {
  const { data, error } = await admin().from('sequence_enrollments').select('id, profile_id, status, account_id').eq('sequence_id', sequenceId);
  if (error) throw new Error(`enrollmentsOf: ${error.message}`);
  return (data ?? []) as Array<{ id: string; profile_id: string; status: string; account_id: string }>;
}

/** Toutes les lignes de Pipeline de l'organisation (la recherche autonome ne doit en créer aucune hors de son projet). */
async function allRows(ws: Workspace) {
  const { data, error } = await admin().from('job_candidate_status').select('candidate_id, job_id, general_stage').eq('organization_id', ws.org.orgId);
  if (error) throw new Error(`allRows: ${error.message}`);
  return (data ?? []) as Array<{ candidate_id: string; job_id: string; general_stage: string }>;
}

// ─── Navigateur ─────────────────────────────────────────────────────────────

function actionOf(route: Route): string | null {
  try {
    return ((route.request().postDataJSON() as { action?: string } | null)?.action) ?? null;
  } catch {
    return null;
  }
}

/** Résultat de recherche tel que le renvoie le service : avec l'adresse du profil (sans elle, « Sans profil LinkedIn »). */
function asResult(c: Candidate) {
  const [first, ...rest] = c.name.split(' ');
  return {
    first_name: first,
    last_name: rest.join(' '),
    headline: 'Ingénieur backend',
    location: 'Paris, France',
    network_distance: 'SECOND_DEGREE',
    profile_url: `https://www.linkedin.com/in/${c.id.toLowerCase()}`,
    public_profile_url: `https://www.linkedin.com/in/${c.id.toLowerCase()}`,
    ...c,
  };
}

interface OpenOptions {
  /** Interrupteur des séquences éteint (secours jusqu'au lot 5j). Défaut : allumé, rien n'est épinglé. */
  legacy?: boolean;
  /**
   * Vue Détaillé de l'ancienne page (une carte par profil, avec ses propres boutons) au lieu du tableau compact,
   * et notation simulée : une note valide (contexte de notation du navigateur) est rendue pour le profil noté.
   */
  detailed?: boolean;
}

async function openContext(browser: Browser, ws: Workspace, candidates: Candidate[], opts: OpenOptions = {}): Promise<BrowserContext> {
  const context = await browser.newContext({ storageState: await storageStateForUser(ws.org.owner), timezoneId: 'Europe/Paris' });
  contexts.push(context);
  if (opts.legacy) await pinLegacySequences(context);
  if (opts.detailed) {
    await context.addInitScript(() => {
      try { localStorage.setItem('konekt_search_view_mode', 'detailed'); } catch { /* sans stockage : vue compacte */ }
    });
  }
  await context.route('**/functions/v1/unipile-accounts', async (route) => {
    if (actionOf(route) !== 'list') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, accounts: [{ id: ws.accountId, account_status: 'OK', provider: 'LINKEDIN', name: 'E2E LinkedIn' }] }),
    });
  });
  await context.route('**/functions/v1/unipile-search', async (route) => {
    const body = actionOf(route) === 'search'
      ? { success: true, results: candidates.map(asResult), cursor: null, total: candidates.length }
      : { success: true, items: [] };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await context.route('**/functions/v1/generate-search-filters', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, filters: { keywords: 'Backend Engineer' }, suggestions: null }),
  }));
  if (opts.detailed) {
    // La carte ne propose son propre bouton « Séquence » qu'une fois le profil noté. Une note n'est reprise par le
    // navigateur que si son contexte (empreinte de l'entrée et mémoire de recrutement) est celui de la demande :
    // il se reconstruit ici depuis le corps reçu, comme le fait le serveur.
    await context.route('**/functions/v1/ai-credits', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, has_credits: true, estimated_credits: 1, remaining: 10_000 }),
    }));
    await context.route('**/functions/v1/score-profile-job', async (route) => {
      const body = route.request().postDataJSON() as Record<string, any>;
      const memoryVersionKey = String(body.expected_memory_version_key);
      const scoringContext = {
        fingerprint: '1'.repeat(64),
        inputVersionKey: buildScoringInputVersionKey(body.job, body.customScoringInstructions, {
          organizationId: body.organization_id, projectId: body.project_id, requestModel: body._ai_model, memoryVersionKey,
        }),
        memory: { fingerprint: '2'.repeat(64), versionKey: memoryVersionKey, provenance: [] },
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          result: {
            profile_id: body.profile?.id, name: body.profile?.name, score: 82, recommendation: 'go',
            summary: 'Profil de test, compétences vérifiées.', hardFilterPassed: true, skippedLLM: false, confidenceScore: 95, scoringContext,
          },
        }),
      });
    });
  } else {
    await context.route('**/functions/v1/score-profile-job', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, scores: [] }),
    }));
  }
  return context;
}

const checkbox = (page: Page, name: string) => page.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true });
const checked = (page: Page) => page.getByRole('checkbox', { name: /^Sélectionner /, checked: true });
const sheet = (page: Page) => page.getByRole('dialog', { name: 'Prise de contact', exact: true });
const flow = (page: Page) => page.locator('[data-contact-flow]');
const group = (page: Page, key: 'ready' | 'incomplete' | 'excluded') => page.locator(`[data-contact-group="${key}"]`);
const reason = (page: Page, key: string) => group(page, 'excluded').locator(`[data-contact-reason="${key}"]`);

/** Sourcing de la mission (ancienne page) avec les résultats simulés affichés. */
async function openMissionSourcing(browser: Browser, ws: Workspace, candidates: Candidate[], opts: OpenOptions = {}): Promise<Page> {
  const context = await openContext(browser, ws, candidates, opts);
  const page = await context.newPage();
  await page.goto(`/missions/${ws.projectId}?tab=sourcing`, { waitUntil: 'domcontentloaded' });
  await page.getByText('générer depuis le brief').click({ timeout: 30_000 });
  for (const c of candidates) await expect(checkbox(page, c.name)).toBeVisible({ timeout: 30_000 });
  return page;
}

/** Coche les candidats puis clique « Séquence » de la barre de sélection. */
async function selectAndOpen(page: Page, names: string[]): Promise<void> {
  for (const name of names) await checkbox(page, name).click();
  await page.getByRole('button', { name: 'Séquence', exact: true }).click();
}

// ─── 1. Sourcing de la mission : trois candidats ────────────────────────────

test('Sourcing de la mission : « Séquence » ouvre la feuille Prise de contact, trois inscrits, Retenu, feuille fermée, cases décochées', async ({ browser }) => {
  test.skip(process.env.E2E_EDGE_FUNCTIONS !== '1', 'draft-sequence (aperçu) absente : E2E_EDGE_FUNCTIONS=1');
  const ws = await workspace('E2E entrées trois');
  const seq = await invitationSequence(ws);
  const karim = candidateOf('K', 'Karim Trie');
  const hugo = candidateOf('H', 'Hugo Neuf');
  const nina = candidateOf('N', 'Nina Neuve');
  // Karim est À trier dans la mission ; Hugo et Nina n'ont pas de ligne.
  await seedCandidateRow({
    orgId: ws.org.orgId, createdBy: ws.org.owner.userId, missionId: ws.projectId, candidateId: karim.id, stage: 'to_sort', extra: { candidate_name: karim.name },
  });
  const page = await openMissionSourcing(browser, ws, [karim, hugo, nina]);
  await selectAndOpen(page, [karim.name, hugo.name, nina.name]);

  // Une feuille, pas un menu.
  await expect(sheet(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(flow(page)).toBeVisible({ timeout: 20_000 });
  await expect(sheet(page).getByRole('heading', { name: 'Contacter 3 candidats' })).toBeVisible();

  // La séquence de la mission est choisie d'avance.
  await expect(page.locator('[data-sequence-picker]')).toContainText(seq.name);

  // Les trois sont prêts, aucun exclu.
  const enroll = sheet(page).getByRole('button', { name: /^Inscrire 3 candidats$/ });
  await expect(enroll).toBeEnabled({ timeout: 30_000 });
  await expect(group(page, 'excluded')).toHaveCount(0);
  await enroll.click();

  // Trois inscriptions, depuis le compte du bouton.
  await expect.poll(async () => (await enrollmentsOf(seq.id)).map((e) => e.profile_id).sort(), { timeout: 30_000 })
    .toEqual([karim.id, hugo.id, nina.id].sort());
  expect((await enrollmentsOf(seq.id)).every((e) => e.account_id === ws.accountId)).toBe(true);

  // Retenu à l'inscription, une seule ligne par candidat ; les lignes créées portent la clé du Sourcing de la mission.
  const stages = async (c: Candidate) => (await rowsOf(ws, [c.id])).map((r) => `${r.general_stage}/${r.decision_source}`);
  await expect.poll(() => stages(karim), { message: 'À trier : Retenu, une seule ligne', timeout: 20_000 }).toEqual(['retained/user']);
  await expect.poll(() => stages(hugo), { message: 'sans ligne : créée, Retenu', timeout: 20_000 }).toEqual(['retained/user']);
  await expect.poll(() => stages(nina), { message: 'sans ligne : créée, Retenu', timeout: 20_000 }).toEqual(['retained/user']);
  for (const c of [karim, hugo, nina]) {
    const [row] = await rowsOf(ws, [c.id]);
    expect(row.job_id, `clé du Sourcing de mission (${c.name})`).toBe(`project:${ws.projectId}`);
  }

  // La feuille se ferme, les trois cases sont décochées et la barre de sélection a disparu.
  await expect(sheet(page)).toHaveCount(0, { timeout: 20_000 });
  await expect(checked(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Séquence', exact: true })).toHaveCount(0);
});

// ─── 2. Un candidat déjà dans la séquence reste coché ───────────────────────

test('Sourcing de la mission : un candidat déjà dans la séquence est exclu et reste coché, les autres sont inscrits et décochés', async ({ browser }) => {
  test.skip(process.env.E2E_EDGE_FUNCTIONS !== '1', 'draft-sequence (aperçu) absente : E2E_EDGE_FUNCTIONS=1');
  const ws = await workspace('E2E entrées exclu');
  const seq = await invitationSequence(ws);
  const karim = candidateOf('K', 'Karim Trie');
  const hugo = candidateOf('H', 'Hugo Neuf');
  const nina = candidateOf('N', 'Nina Neuve');
  const dora = candidateOf('D', 'Dora Dedans');
  await seedCandidateRow({
    orgId: ws.org.orgId, createdBy: ws.org.owner.userId, missionId: ws.projectId, candidateId: karim.id, stage: 'to_sort', extra: { candidate_name: karim.name },
  });
  // Dora est déjà inscrite dans la séquence choisie.
  const doraEnrollment = await seedEnrollment(ws.org.orgId, seq.id, ws.org.owner.userId, {
    profile_id: dora.id, profile_name: dora.name, account_id: ws.accountId, job_id: `project:${ws.projectId}`, status: 'active',
  });

  const page = await openMissionSourcing(browser, ws, [karim, hugo, nina, dora]);
  await selectAndOpen(page, [karim.name, hugo.name, nina.name, dora.name]);

  await expect(sheet(page)).toBeVisible({ timeout: 20_000 });
  await expect(sheet(page).getByRole('heading', { name: 'Contacter 4 candidats' })).toBeVisible();
  await expect(page.locator('[data-sequence-picker]')).toContainText(seq.name);

  // Dora est rangée « Déjà dans cette séquence » (exclue), les trois autres sont prêts.
  await expect(reason(page, 'in_sequence')).toContainText('Déjà dans cette séquence', { timeout: 30_000 });
  await expect(reason(page, 'in_sequence').locator(`[data-contact-row="${dora.id}"]`)).toBeVisible();
  for (const c of [karim, hugo, nina]) {
    await expect(group(page, 'ready').locator(`[data-contact-row="${c.id}"]`)).toBeVisible();
  }
  const enroll = sheet(page).getByRole('button', { name: /^Inscrire 3 candidats$/ });
  await expect(enroll).toBeEnabled({ timeout: 30_000 });
  await enroll.click();

  // Trois nouvelles inscriptions ; celle de Dora n'a pas bougé.
  await expect.poll(async () => (await enrollmentsOf(seq.id)).map((e) => e.profile_id).sort(), { timeout: 30_000 })
    .toEqual([karim.id, hugo.id, nina.id, dora.id].sort());
  const doraRows = (await enrollmentsOf(seq.id)).filter((e) => e.profile_id === dora.id);
  expect(doraRows.map((e) => e.id)).toEqual([doraEnrollment]);
  // Dora n'est pas retenue par l'inscription d'un autre : aucune ligne de Pipeline pour elle.
  expect((await rowsOf(ws, [dora.id])).filter((r) => r.general_stage === 'retained')).toHaveLength(0);
  await expect.poll(async () => (await rowsOf(ws, [hugo.id, nina.id])).map((r) => r.general_stage).sort(), { timeout: 20_000 })
    .toEqual(['retained', 'retained']);

  // Seuls les inscrits quittent la sélection : Dora, exclue, reste cochée.
  await expect(sheet(page)).toHaveCount(0, { timeout: 20_000 });
  await expect(checked(page)).toHaveCount(1);
  await expect(checkbox(page, dora.name)).toBeChecked();
});

// ─── 3. Un clic dans la feuille n'ouvre pas la fiche ────────────────────────

test('Vue Détaillé : un clic dans la feuille ouverte depuis une carte n\'ouvre pas la fiche du profil', async ({ browser }) => {
  test.skip(process.env.E2E_EDGE_FUNCTIONS !== '1', 'draft-sequence (aperçu) absente : E2E_EDGE_FUNCTIONS=1');
  const ws = await workspace('E2E entrées clic');
  const seq = await invitationSequence(ws);
  const lea = candidateOf('L', 'Léa Cliquée');
  const page = await openMissionSourcing(browser, ws, [lea], { detailed: true });
  const card = page.locator('[role="button"][aria-label^="Candidat Léa Cliquée"]');
  await expect(card).toBeVisible({ timeout: 30_000 });
  // La carte propose son propre bouton « Séquence » une fois le profil noté.
  await expect(card.getByRole('button', { name: 'Séquence', exact: true })).toHaveCount(0);
  await card.getByRole('button', { name: 'Noter', exact: true }).click();
  await expect(card).toHaveAttribute('aria-label', /score 82 sur 100/, { timeout: 30_000 });
  const cardSequence = card.getByRole('button', { name: 'Séquence', exact: true });
  await expect(cardSequence).toBeVisible({ timeout: 30_000 });

  // Témoin : un clic sur le texte de la carte, sans feuille, ouvre bien la fiche (c'est ce que le clic de la feuille ne doit pas faire).
  await card.getByText('Ingénieur backend').first().click();
  await expect(page.getByRole('dialog', { name: lea.name, exact: true })).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('[role="dialog"]')).toHaveCount(0, { timeout: 20_000 });

  // Le bouton de la carte ouvre la feuille, un seul candidat.
  await cardSequence.click();
  await expect(sheet(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(flow(page)).toBeVisible({ timeout: 20_000 });
  await expect(sheet(page).getByRole('heading', { name: 'Contacter 1 candidat' })).toBeVisible();
  await expect(page.locator('[data-sequence-picker]')).toContainText(seq.name);
  await expect(group(page, 'ready').locator(`[data-contact-row="${lea.id}"]`)).toBeVisible({ timeout: 30_000 });

  // Un clic sur du texte de la feuille (titre, résumé, nom du candidat) remonte par l'arbre React jusqu'à la carte,
  // qui ouvrirait la fiche : la feuille reste la seule fenêtre ouverte.
  // Court délai : si la fiche s'ouvre au premier clic, elle recouvre la feuille et les clics suivants échouent vite.
  await sheet(page).getByRole('heading', { name: 'Prise de contact' }).click({ timeout: 5_000 });
  await flow(page).getByRole('heading', { name: 'Contacter 1 candidat' }).click({ timeout: 5_000 });
  await group(page, 'ready').locator(`[data-contact-row="${lea.id}"]`).getByText(lea.name).click({ timeout: 5_000 });
  await expect(page.locator('[role="dialog"]')).toHaveCount(1);
  await expect(sheet(page)).toBeVisible();
  await expect(page.getByRole('dialog', { name: lea.name, exact: true })).toHaveCount(0);
  // Rien n'a été inscrit en cliquant.
  expect(await enrollmentsOf(seq.id)).toHaveLength(0);
});

// ─── 4. Interrupteur éteint : l'ancien menu ─────────────────────────────────

test('Interrupteur éteint : le menu « Séquence » d\'avant s\'ouvre, pas de feuille', async ({ browser }) => {
  const ws = await workspace('E2E entrées ancien menu');
  const seq = await invitationSequence(ws);
  const lia = candidateOf('A', 'Lia Ancienne');
  const page = await openMissionSourcing(browser, ws, [lia], { legacy: true });
  await selectAndOpen(page, [lia.name]);

  await expect(page.getByRole('menu')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('menuitem', { name: new RegExp(seq.name) })).toBeVisible({ timeout: 20_000 });
  await expect(sheet(page)).toHaveCount(0);
  await expect(flow(page)).toHaveCount(0);
  expect(await enrollmentsOf(seq.id)).toHaveLength(0);
});


// ─── 5. Recherche autonome (/sourcing/<id>) ─────────────────────────────────

/** Recherche autonome avec les résultats simulés affichés (nouvelle disposition du Sourcing : liste à trier). */
async function openStandaloneSearch(browser: Browser, ws: Workspace, candidates: Candidate[]): Promise<Page> {
  const context = await openContext(browser, ws, candidates);
  const page = await context.newPage();
  await page.goto(`/sourcing/${ws.projectId}`, { waitUntil: 'domcontentloaded' });
  await page.getByText('générer les filtres depuis le poste').click({ timeout: 30_000 });
  for (const c of candidates) await expect(checkbox(page, c.name)).toBeVisible({ timeout: 30_000 });
  return page;
}

/** Coche les candidats de la recherche autonome et clique « Contacter » de la barre de sélection. */
async function selectAndContactInSearch(page: Page, names: string[]): Promise<void> {
  for (const name of names) await checkbox(page, name).click();
  await page.getByRole('button', { name: 'Contacter', exact: true }).click();
  await expect(sheet(page)).toBeVisible({ timeout: 20_000 });
  await expect(flow(page)).toBeVisible({ timeout: 20_000 });
}

test('Recherche autonome : « Contacter » ouvre la feuille, une séquence de l\'organisation se choisit, inscription et Retenu dans la recherche', async ({ browser }) => {
  test.skip(process.env.E2E_EDGE_FUNCTIONS !== '1', 'draft-sequence (aperçu) absente : E2E_EDGE_FUNCTIONS=1');
  const ws = await workspace('E2E entrées recherche', 'search');
  // Séquence de l'organisation, rattachée à aucune mission.
  const seq = await invitationSequence(ws, null);
  const alix = candidateOf('A', 'Alix Recherche');
  const bruno = candidateOf('B', 'Bruno Recherche');
  const page = await openStandaloneSearch(browser, ws, [alix, bruno]);
  await selectAndContactInSearch(page, [alix.name, bruno.name]);

  // Une feuille, pas un menu ; aucune séquence de la recherche : rien n'est choisi d'avance, donc rien à inscrire.
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(sheet(page).getByRole('heading', { name: 'Contacter 2 candidats' })).toBeVisible();
  const picker = page.locator('[data-sequence-picker="ready"]');
  await expect(picker).toContainText('Choisir une séquence', { timeout: 20_000 });
  await expect(sheet(page).getByRole('button', { name: /^Inscrire/ })).toHaveCount(0);

  // La séquence de l'organisation se choisit dans le menu.
  await picker.getByRole('button').click();
  await page.getByRole('menuitem', { name: new RegExp(seq.name) }).click();
  await expect(picker).toContainText(seq.name);
  const enroll = sheet(page).getByRole('button', { name: /^Inscrire 2 candidats$/ });
  await expect(enroll).toBeEnabled({ timeout: 30_000 });
  await enroll.click();

  // Deux inscriptions, depuis le compte du bouton.
  await expect.poll(async () => (await enrollmentsOf(seq.id)).map((e) => e.profile_id).sort(), { timeout: 30_000 })
    .toEqual([alix.id, bruno.id].sort());
  expect((await enrollmentsOf(seq.id)).every((e) => e.account_id === ws.accountId)).toBe(true);

  // Retenu à l'inscription, dans la recherche elle-même (poste « project:<recherche> ») et nulle part ailleurs.
  await expect.poll(async () => (await allRows(ws)).map((r) => `${r.candidate_id}|${r.job_id}|${r.general_stage}`).sort(), { timeout: 20_000 })
    .toEqual([alix, bruno].map((c) => `${c.id}|project:${ws.projectId}|retained`).sort());

  // La feuille se ferme et la barre de sélection a disparu.
  await expect(sheet(page)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Contacter', exact: true })).toHaveCount(0);
});

// La demande attendait, pour une recherche autonome, une feuille « sans « cette mission » dans les textes » (flux hors mission).
// Observé : la recherche est un projet (sourcing_projects, kind « search ») dont le poste synthétique s'appelle « project:<id> »
// comme celui d'une mission ; le point d'entrée en tire donc un identifiant de mission (missionIdOf) et le sélecteur de séquence
// propose « Rédiger une séquence pour cette mission » (SequencePicker, missionId non nul). Le mode « sans mission » du lot
// (missionId et job nuls) n'est atteint que depuis la messagerie sans mission choisie et la fiche du Pipeline global.
// Défaut de texte ou choix de conception : à trancher avant de retirer le fixme.
test.fixme('Recherche autonome : aucun texte « cette mission » dans la feuille', async ({ browser }) => {
  const ws = await workspace('E2E entrées recherche texte', 'search');
  await invitationSequence(ws, null);
  const alix = candidateOf('A', 'Alix Texte');
  const page = await openStandaloneSearch(browser, ws, [alix]);
  await selectAndContactInSearch(page, [alix.name]);
  await sheet(page).locator('[data-sequence-picker="ready"]').getByRole('button').click();
  await expect(page.getByRole('menu')).not.toContainText('cette mission');
  await expect(sheet(page)).not.toContainText('cette mission');
});
