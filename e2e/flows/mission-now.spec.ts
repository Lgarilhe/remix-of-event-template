/**
 * Refonte mission, lot 3 : la carte « Maintenant » de l'écran Pipeline, sa ligne
 * « Ensuite », « Pourquoi maintenant ? », « Plus tard », le blocage, la ligne
 * d'action de la liste des missions et la colonne « Prochaine action »
 * (décisions : scratchpad lot3/decisions.md ; règle : src/lib/missionNextAction.ts).
 *
 *  1. mission neuve, poste décrit, aucun profil : « Chercher des profils » (rang 10) ;
 *  2. poste vide : « Décrire le poste » (rang 11) vers Cadrage ;
 *  3. retenus pas contactés : « Contacter les N » (envoi permis) ou « Voir les retenus » (formule gratuite) ;
 *  4. profils notés à trier : « Trier les N » ouvre À trier ;
 *  5. réponse non traitée sur votre compte : « Répondre » ouvre Échanges ; réponse d'un collègue : jamais un bouton ;
 *  6. entretien sans nouvelles depuis plus de 5 jours : phrase neutre, « Ouvrir la fiche » ou « Relancer … » ;
 *  7. « Plus tard » : action suivante, liste des missions, rechargement, À traiter intact, rien dans notifications ni
 *     candidate_reminders, tout reporter et « Les reprendre », un second membre ne voit pas le report ;
 *  8. blocage : compte à reconnecter, action sans besoin de LinkedIn, aucun clignotement au chargement ;
 *  9. liste des missions : même rang que la carte, rien pour une mission terminée, jamais « Brief incomplet » ;
 * 10. colonne « Prochaine action » de la liste des candidats ;
 * 11. téléphone (390 x 844) ;
 * 12. mission archivée : pas de carte.
 *
 * Harnais : stack locale (e2e/local-stack), vraie base ; seule la liste des
 * comptes LinkedIn (et la recherche, pour la fiche) est simulée dans le navigateur.
 */
import type { Browser, BrowserContext, Locator, Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures';
import {
  addMember,
  admin,
  backdateStageEntered,
  createOrg,
  deleteOrg,
  seedCandidateRow,
  seedLinkedInAccount,
  seedMission,
  seedMissionConversation,
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
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// ─── Nettoyage ──────────────────────────────────────────────────────────────

const contexts: BrowserContext[] = [];
const orgsToDelete: Array<{ org: TestOrg; extra: TestUser[] }> = [];
test.afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close().catch(() => undefined);
  while (orgsToDelete.length) {
    const { org, extra } = orgsToDelete.pop()!;
    await admin().from('notifications').delete().eq('organization_id', org.orgId);
    await admin().from('candidate_reminders').delete().eq('organization_id', org.orgId);
    await admin().from('mission_conversations').delete().eq('organization_id', org.orgId);
    await admin().from('job_candidate_status').delete().eq('organization_id', org.orgId);
    await admin().from('mission_process_steps').delete().eq('organization_id', org.orgId);
    await deleteOrg(org, extra);
  }
});

// ─── Données ────────────────────────────────────────────────────────────────

interface Workspace {
  org: TestOrg;
  accountId: string | null;
  accountStatus: 'OK' | 'CREDENTIALS';
  missionId: string;
  missionName: string;
}

interface WorkspaceOptions {
  /** Formule : 'cabinet' (envoi permis, défaut) ou 'free' (envoi interdit). */
  plan?: 'cabinet' | 'free';
  /** Compte LinkedIn du propriétaire : relié et en état de marche (défaut), à reconnecter, ou aucune liaison. */
  account?: 'OK' | 'CREDENTIALS' | 'none';
  /** Poste décrit (défaut) ou vide. */
  job?: 'described' | 'empty';
  status?: string;
  jobDetails?: Record<string, unknown>;
}

/** Cabinet, propriétaire, compte LinkedIn simulé, une mission. */
async function workspace(label: string, o: WorkspaceOptions = {}): Promise<Workspace> {
  const org = await createOrg('agency', label);
  orgsToDelete.push({ org, extra: [] });
  await setOrgPlan(org.orgId, o.plan === 'free' ? 'free' : 'cabinet');
  const account = o.account ?? 'OK';
  const accountId = account === 'none' ? null : await seedLinkedInAccount(org.orgId, org.owner.userId, `acc_now_${rand()}`, account);
  const missionName = `Mission now ${rand()}`;
  const jobDetails =
    o.jobDetails ??
    (o.job === 'empty'
      ? { title: 'Responsable RH' }
      : { title: 'Senior Backend Engineer', skills_must_have: ['Go', 'Postgres'] });
  const missionId = await seedMission(org.orgId, org.owner.userId, {
    name: missionName,
    job_details: jobDetails,
    ...(o.status ? { status: o.status } : {}),
  });
  return { org, accountId, accountStatus: account === 'CREDENTIALS' ? 'CREDENTIALS' : 'OK', missionId, missionName };
}

/** Un second membre de l'organisation, avec son propre compte LinkedIn (ou sans). */
async function colleague(ws: Workspace, withAccount = true): Promise<{ user: TestUser; accountId: string | null }> {
  const user = await addMember(ws.org.orgId, 'member', 'now');
  orgsToDelete[orgsToDelete.findIndex((e) => e.org === ws.org)].extra.push(user);
  const accountId = withAccount ? await seedLinkedInAccount(ws.org.orgId, user.userId, `acc_col_${rand()}`, 'OK') : null;
  return { user, accountId };
}

interface CandidateOptions {
  by?: string;
  candidateId?: string;
  score?: number | null;
  recommendation?: string | null;
  unopened?: boolean;
}

/** Ligne candidat de la mission à l'étape voulue. `score` : profil noté (ligne À trier notée). */
async function candidate(
  ws: Workspace,
  name: string,
  stage: CandidateStage = 'to_sort',
  o: CandidateOptions = {},
): Promise<{ rowId: string; candidateId: string }> {
  const candidateId = o.candidateId ?? `ACoAAN${rand()}`;
  const { id } = await seedCandidateRow({
    orgId: ws.org.orgId,
    createdBy: o.by ?? ws.org.owner.userId,
    candidateId,
    missionId: ws.missionId,
    stage,
    extra: {
      candidate_name: name,
      candidate_headline: 'Ingénieur backend',
      linkedin_profile_url: `https://www.linkedin.com/in/${candidateId.toLowerCase()}`,
      ...(o.score != null ? { score: o.score, status: 'new' } : {}),
      ...(o.recommendation ? { recommendation: o.recommendation } : {}),
      ...(o.unopened ? { status: 'discovered' } : {}),
    },
  });
  return { rowId: id, candidateId };
}

const scored = (score = 70, recommendation: string | null = null): CandidateOptions => ({ score, recommendation });

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

interface OpenOptions {
  user?: TestUser;
  /** Comptes de la liste simulée ; défaut : celui du propriétaire, dans son état. */
  accounts?: Array<{ id: string; status: string }>;
  viewport?: { width: number; height: number };
  phone?: boolean;
  /** Retard de la liste des comptes (ms) : le compte reste « en chargement » ce temps. */
  accountsDelayMs?: number;
  timezoneId?: string;
}

/** Page de la nouvelle page mission, connectée, avec la liste des comptes LinkedIn simulée. */
async function openAs(browser: Browser, ws: Workspace, o: OpenOptions = {}): Promise<Page> {
  const accounts = o.accounts ?? (ws.accountId ? [{ id: ws.accountId, status: ws.accountStatus }] : []);
  const context = await browser.newContext({
    storageState: await storageStateForUser(o.user ?? ws.org.owner, 'v3'),
    timezoneId: o.timezoneId ?? 'Europe/Paris',
    viewport: o.viewport ?? { width: 2400, height: 1100 },
    ...(o.phone ? { isMobile: true, hasTouch: true } : {}),
  });
  contexts.push(context);
  await context.route('**/functions/v1/unipile-accounts', async (route) => {
    if (actionOf(route) !== 'list') return route.continue();
    if (o.accountsDelayMs) await new Promise((r) => setTimeout(r, o.accountsDelayMs));
    await json(route, {
      success: true,
      accounts: accounts.map((a) => ({ id: a.id, status: a.status, account_status: a.status, provider: 'LINKEDIN', name: 'E2E LinkedIn' })),
    });
  });
  await context.route('**/functions/v1/unipile-search', (route) =>
    json(route, actionOf(route) === 'search' ? { success: true, results: [], cursor: null, total: 0 } : { success: true, items: [], messages: [], chats: [] }),
  );
  const page = await context.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('konekt:tuto:seen:pipeline', '1'); } catch { /* sans stockage */ } });
  return page;
}

const missionUrl = (ws: Workspace, rest = '') => `/missions/${ws.missionId}${rest}`;
const pathIs = (ws: Workspace, sub = '') => new RegExp(`/missions/${escapeRe(ws.missionId)}${escapeRe(sub)}(\\?[^#]*)?$`);

const nowCard = (page: Page) => page.getByTestId('now-card');
const thenLine = (page: Page) => page.getByTestId('then-line');
const listRows = (page: Page) => page.getByTestId('candidate-list').getByTestId('candidate-row');
const panel = (page: Page) => page.getByTestId('mission-panel');
const toSortList = (page: Page) => page.getByTestId('to-sort-list');
const todoTab = (page: Page) => page.getByRole('tab', { name: /^À traiter/ });

/** Ouvre le Pipeline de la mission et attend que la carte ait fini de se lire. */
async function openPipeline(page: Page, ws: Workspace) {
  await page.goto(missionUrl(ws), { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('mission-v3')).toBeVisible({ timeout: 30_000 });
  await expect(nowCard(page)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('now-card-loading')).toHaveCount(0, { timeout: 30_000 });
}

async function reloadPipeline(page: Page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(nowCard(page)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('now-card-loading')).toHaveCount(0, { timeout: 30_000 });
}

/** Boutons pleins de la carte : un seul (variante « primary »). */
const filledButtons = (card: Locator) => card.locator('button.bg-primary, a.bg-primary');

const why = (card: Locator) => card.getByRole('button', { name: 'Pourquoi maintenant ?' });
const later = (card: Locator) => card.getByRole('button', { name: 'Plus tard', exact: true });

/**
 * Ouvre « Pourquoi maintenant ? ». Depuis l'allègement du 04/10/2026, la proposition, la règle, la ligne
 * « Ensuite » et « Non suivi » n'y sont qu'à la demande ; la carte ne montre que la phrase et le bouton.
 */
async function openWhy(card: Locator) {
  const button = why(card);
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
}

/**
 * Observateur de DOM posé avant le premier chargement : consigne chaque état
 * distinct du texte de la carte (squelette compris) pour prouver qu'aucun état
 * intermédiaire faux (blocage, mauvaise action) n'a clignoté.
 */
async function recordCard(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __nowCardStates: string[] }).__nowCardStates = seen;
    const snap = () => {
      const card = document.querySelector('[data-testid="now-card"]') as HTMLElement | null;
      if (!card) return;
      const loading = card.querySelector('[data-testid="now-card-loading"]') ? '[chargement]' : '';
      const text = `${loading}${card.innerText.replace(/\s+/g, ' ').trim()}`;
      if (seen[seen.length - 1] !== text) seen.push(text);
    };
    new MutationObserver(snap).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  });
}
const recordedStates = (page: Page) =>
  page.evaluate(() => (window as unknown as { __nowCardStates?: string[] }).__nowCardStates ?? []);

// ═══ 1 : mission neuve, poste décrit, aucun profil ══════════════════════════

test.describe('Lot 3 : carte « Maintenant »', () => {
  test('1. poste décrit et aucun profil : « Chercher des profils » (rang 10), un seul bouton plein, « Pourquoi maintenant ? », jamais « Rien ne presse »', async ({ browser }) => {
    const ws = await workspace('E2E now 1');
    const page = await openAs(browser, ws);
    await openPipeline(page, ws);
    const card = nowCard(page);

    await expect(card.getByRole('heading', { name: 'Maintenant', exact: true })).toBeVisible();
    await expect(card).toContainText("Aucun profil n'a encore été trouvé pour cette mission.");
    // Une phrase et un bouton : la proposition et la donnée ne s'affichent pas avant « Pourquoi maintenant ? ».
    await expect(card).not.toContainText('Le poste est décrit : lancez une première recherche.');
    await expect(card).not.toContainText('Non suivi');
    await expect(card).not.toContainText('Blocage');

    const primary = card.getByRole('button', { name: 'Chercher des profils', exact: true });
    await expect(primary).toBeVisible();
    await expect(filledButtons(card), 'un seul bouton plein').toHaveCount(1);
    await expect(primary).toHaveClass(/bg-primary/);
    await expect(page.getByText('Rien ne presse')).toHaveCount(0);

    // « Pourquoi maintenant ? » : la règle appliquée, en clair, puis ce qui est non suivi.
    const whyButton = why(card);
    await expect(whyButton).toHaveAttribute('aria-expanded', 'false');
    await whyButton.click();
    await expect(whyButton).toHaveAttribute('aria-expanded', 'true');
    await expect(card).toContainText('Le poste est décrit : lancez une première recherche.');
    await expect(card).toContainText('La mission ne compte aucun profil, et le poste est décrit.');
    await expect(card).toContainText('Le poste est décrit et la mission ne compte aucun profil.');
    await expect(card).toContainText('Aucun blocage ne l\'empêche.');
    await expect(card).toContainText('Non suivi : ');
    await expect(card).toContainText('Les entretiens, les avis du client, les propositions de l\'assistant et les relances automatiques ne sont pas encore suivis.');

    // Le bouton mène au Sourcing.
    await primary.click();
    await expect(page).toHaveURL(pathIs(ws, '/sourcing'));
  });

  // ═══ 2 : poste vide ═══════════════════════════════════════════════════════

  test('2. poste vide : « Décrire le poste » (rang 11) mène à Cadrage', async ({ browser }) => {
    const ws = await workspace('E2E now 2', { job: 'empty' });
    const page = await openAs(browser, ws);
    await openPipeline(page, ws);
    const card = nowCard(page);

    await expect(card).toContainText("Le poste n'est pas encore décrit.");
    await openWhy(card);
    await expect(card).toContainText('Décrivez-le pour commencer');
    await expect(page.getByText('Rien ne presse')).toHaveCount(0);
    const button = card.getByRole('button', { name: 'Décrire le poste', exact: true });
    await expect(button).toBeVisible();
    await expect(filledButtons(card)).toHaveCount(1);
    // Rang 10 absent : sans poste décrit, on ne propose pas de chercher.
    await expect(card.getByRole('button', { name: 'Chercher des profils' })).toHaveCount(0);

    await button.click();
    await expect(page).toHaveURL(pathIs(ws, '/cadrage'));
    await expect(page.locator('#cadrage-poste')).toBeVisible({ timeout: 30_000 });
  });

  // ═══ 3 : retenus pas contactés ════════════════════════════════════════════

  test('3a. retenus pas contactés, envoi permis : « Contacter les N » coche les retenus et filtre la liste', async ({ browser }) => {
    const ws = await workspace('E2E now 3a');
    await candidate(ws, 'Rita Retenue', 'retained');
    await candidate(ws, 'Remi Retenu', 'retained');
    await candidate(ws, 'Carl Contacte', 'contacted');
    const page = await openAs(browser, ws);
    await openPipeline(page, ws);
    const card = nowCard(page);

    await expect(card).toContainText('2 candidats retenus attendent un premier message.');
    await openWhy(card);
    await expect(card).toContainText('Contactez-les maintenant.');
    await expect(card).toContainText('2 profils sont à l\'étape Retenu, sans aucun message envoyé depuis Konekt.');
    await expect(filledButtons(card)).toHaveCount(1);
    const button = card.getByRole('button', { name: 'Contacter les 2', exact: true });
    await expect(button).toBeVisible();
    await expect(listRows(page)).toHaveCount(3, { timeout: 30_000 });

    await button.click();
    await expect(page).toHaveURL(/[?&]etape=retained(&|$)/);
    await expect(listRows(page)).toHaveCount(2, { timeout: 30_000 });
    await expect(listRows(page).filter({ hasText: 'Carl Contacte' })).toHaveCount(0);
    // Les retenus sont cochés, la barre d'actions apparaît.
    await expect(page.getByRole('checkbox', { name: 'Sélectionner Rita Retenue', exact: true })).toBeChecked({ timeout: 30_000 });
    await expect(page.getByRole('checkbox', { name: 'Sélectionner Remi Retenu', exact: true })).toBeChecked();
    const bar = page.getByRole('toolbar', { name: 'Actions sur la sélection' });
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('2 candidats sélectionnés');
    // Décision 3 : « sélectionne les retenus et ouvre le panneau de contact existant ». Comportement réel du code
    // (PipelineScreen, commentaire de contactRetained) : aucun panneau, le focus doit aller au « Contacter » de la
    // barre d'actions. TROUVAILLE : le focus ne s'y pose jamais, voir le rapport (le « Contacter » est encore grisé
    // quand la demande de focus s'exécute, et la demande est alors abandonnée). Ce scénario reste rouge.
    const contactInBar = bar.getByRole('button', { name: /^Contacter/ }).first();
    await expect(contactInBar).toBeFocused({ timeout: 10_000 });
  });

  test('3b. retenus pas contactés, formule gratuite : « Voir les retenus » filtre la liste, aucune impasse', async ({ browser }) => {
    const ws = await workspace('E2E now 3b', { plan: 'free' });
    await candidate(ws, 'Rita Retenue', 'retained');
    await candidate(ws, 'Remi Retenu', 'retained');
    await candidate(ws, 'Carl Contacte', 'contacted');
    const page = await openAs(browser, ws);
    await openPipeline(page, ws);
    const card = nowCard(page);

    await expect(card).toContainText('2 candidats retenus attendent un premier message.');
    await expect(card.getByRole('button', { name: /^Contacter/ })).toHaveCount(0);
    await openWhy(card);
    await expect(card).toContainText('Retrouvez-les dans la liste, filtrée sur Retenu.');
    const button = card.getByRole('button', { name: 'Voir les retenus', exact: true });
    await expect(button).toBeVisible();
    await expect(filledButtons(card)).toHaveCount(1);
    await expect(listRows(page)).toHaveCount(3, { timeout: 30_000 });

    await button.click();
    await expect(page).toHaveURL(/[?&]etape=retained(&|$)/);
    await expect(listRows(page)).toHaveCount(2, { timeout: 30_000 });
    await expect(listRows(page).filter({ hasText: 'Carl Contacte' })).toHaveCount(0);
    // Aucune sélection posée, aucune route de paiement.
    await expect(page.getByRole('toolbar', { name: 'Actions sur la sélection' })).toHaveCount(0);
    await expect(page).not.toHaveURL(/\/settings\/org\/billing/);
  });

  // ═══ 4 : profils notés à trier ════════════════════════════════════════════

  test('4. profils notés à trier : « N nouveaux profils notés, dont M recommandés », « Trier les N » ouvre À trier', async ({ browser }) => {
    const ws = await workspace('E2E now 4');
    await candidate(ws, 'Anna Atrier', 'to_sort', scored(85, 'go'));
    await candidate(ws, 'Bruno Atrier', 'to_sort', scored(80, 'go'));
    await candidate(ws, 'Chloe Atrier', 'to_sort', scored(55, 'maybe'));
    // Jamais ouvert : ni noté, ni compté dans la phrase.
    await candidate(ws, 'Jamais Ouvert', 'to_sort', { unopened: true });
    // Un retenu au passage : sans lui il n'y aurait pas de liste « en cours » et la page montrerait autre chose.
    const page = await openAs(browser, ws);
    await openPipeline(page, ws);
    const card = nowCard(page);

    await expect(card).toContainText('3 nouveaux profils notés, dont 2 recommandés.');
    await openWhy(card);
    await expect(card).toContainText('Triez-les pour garder les meilleurs.');
    await expect(card).toContainText('2 sont recommandés par la notation.');
    await expect(filledButtons(card)).toHaveCount(1);
    // Le profil jamais ouvert est annoncé dans « Ensuite » (rang 8b), jamais sur la carte.
    await expect(thenLine(page)).toContainText('Passer en revue 1 profil trouvé');

    await expect(toSortList(page)).toHaveCount(0);
    await card.getByRole('button', { name: 'Trier les 3', exact: true }).click();
    await expect(toSortList(page)).toBeVisible({ timeout: 30_000 });
    await expect(toSortList(page).getByTestId('candidate-row')).toHaveCount(3, { timeout: 30_000 });
    await expect(toSortList(page).getByText('Jamais Ouvert', { exact: true })).toHaveCount(0);
  });

  // ═══ 5 : réponse non traitée ══════════════════════════════════════════════

  test('5. réponse non traitée : « X vous a répondu », « Répondre » ouvre Échanges ; après un envoi la carte passe à la suite ; la réponse d\'un collègue n\'est jamais un bouton', async ({ browser }) => {
    const ws = await workspace('E2E now 5');
    const rose = await candidate(ws, 'Rose Repondu', 'contacted');
    await candidate(ws, 'Anna Atrier', 'to_sort', scored(75));
    const now = Date.now();
    const linkId = await seedMissionConversation({
      orgId: ws.org.orgId,
      projectId: ws.missionId,
      accountId: ws.accountId!,
      candidateId: rose.candidateId,
      createdBy: ws.org.owner.userId,
      lastOutboundAt: new Date(now - 3 * DAY),
      lastInboundAt: new Date(now - 26 * HOUR),
    });
    const page = await openAs(browser, ws);
    await openPipeline(page, ws);
    const card = nowCard(page);

    await expect(card).toContainText(/Rose Repondu vous a répondu (hier|aujourd'hui|\w+)\./);
    await openWhy(card);
    await expect(card).toContainText('Répondez-lui pour garder la conversation active.');
    await expect(card).toContainText('vous n\'y avez pas encore répondu');
    await expect(filledButtons(card)).toHaveCount(1);
    // La suite : les profils notés à trier (dans le panneau ouvert).
    await expect(thenLine(page)).toContainText('Trier 1 profil noté');

    // « Répondre » : la fiche s'ouvre sur l'onglet Échanges.
    await card.getByRole('button', { name: 'Répondre', exact: true }).click();
    await expect(panel(page)).toBeVisible({ timeout: 15_000 });
    await expect(panel(page)).toHaveAttribute('data-panel', 'fiche');
    await expect(page).toHaveURL(new RegExp(`[?&]candidat=`));
    await expect(panel(page)).toContainText('Rose Repondu', { timeout: 30_000 });
    const echanges = panel(page).getByRole('tablist', { name: 'Fiche du candidat' }).getByRole('tab', { name: 'Échanges', exact: true });
    await expect(echanges).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 });
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);

    // Un message de sortie plus récent que la réponse : la carte repasse à l'action suivante après relecture.
    const { error } = await admin()
      .from('mission_conversations')
      .update({ last_outbound_at: new Date().toISOString() })
      .eq('id', linkId);
    if (error) throw new Error(`mission_conversations: ${error.message}`);
    await reloadPipeline(page);
    await expect(card).not.toContainText('vous a répondu');
    await expect(card).toContainText('1 nouveau profil noté.');
    await expect(card.getByRole('button', { name: 'Répondre', exact: true })).toHaveCount(0);

    // Réponse arrivée sur le compte d'un COLLÈGUE : une information, jamais un bouton.
    const col = await colleague(ws);
    const cora = await candidate(ws, 'Cora Collegue', 'contacted');
    await seedMissionConversation({
      orgId: ws.org.orgId,
      projectId: ws.missionId,
      accountId: col.accountId!,
      candidateId: cora.candidateId,
      createdBy: col.user.userId,
      lastOutboundAt: new Date(Date.now() - 3 * DAY),
      lastInboundAt: new Date(Date.now() - 2 * HOUR),
    });
    await reloadPipeline(page);
    await expect(card).not.toContainText('Cora Collegue vous a répondu');
    await expect(card.getByRole('button', { name: 'Répondre' })).toHaveCount(0);
    await expect(card).toContainText('1 nouveau profil noté.');
    await openWhy(card);
    const then = thenLine(page);
    await expect(then).toContainText('1 réponse reçue par un collègue');
    // Sans bouton ni lien : un simple texte.
    await expect(then.getByRole('button', { name: /collègue/ })).toHaveCount(0);
    await expect(then.getByRole('link', { name: /collègue/ })).toHaveCount(0);
  });

  // ═══ 6 : entretien sans nouvelles ═════════════════════════════════════════

  test('6. entretien depuis plus de 5 jours : phrase neutre, « Ouvrir la fiche » puis « Relancer … » quand le client a une adresse', async ({ browser }) => {
    const ws = await workspace('E2E now 6');
    const eric = await candidate(ws, 'Eric Entretien', 'interviewing');
    const eva = await candidate(ws, 'Eva Cinqjours', 'interviewing');
    backdateStageEntered(eric.rowId, 6);
    backdateStageEntered(eva.rowId, 5);
    const page = await openAs(browser, ws);
    await openPipeline(page, ws);
    const card = nowCard(page);

    await expect(card).toContainText('Eric Entretien est en entretien depuis 6 jours.');
    // Phrase neutre : aucune affirmation qu'un entretien a eu lieu ; le seuil est strict (5 jours : pas encore).
    const text = (await card.innerText()).replace(/\s+/g, ' ');
    expect(text).not.toMatch(/a eu lieu|s'est tenu|s'est déroulé|est passé|a passé/i);
    expect(text, 'Eva, depuis 5 jours exactement, n\'est pas signalée').not.toContain('Eva Cinqjours');
    expect(text).not.toContain('autre candidat');
    await openWhy(card);
    await expect(card).toContainText('au-delà du seuil de 5 jours');
    await expect(filledButtons(card)).toHaveCount(1);
    await expect(card.getByRole('button', { name: 'Ouvrir la fiche', exact: true })).toBeVisible();

    await card.getByRole('button', { name: 'Ouvrir la fiche', exact: true }).click();
    await expect(panel(page)).toBeVisible({ timeout: 15_000 });
    await expect(panel(page)).toContainText('Eric Entretien', { timeout: 30_000 });
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);

    // Le client du poste a un interlocuteur avec une adresse : « Relancer Marie Dupont », en mailto:.
    const { error } = await admin()
      .from('sourcing_projects')
      .update({
        job_details: {
          title: 'Senior Backend Engineer',
          skills_must_have: ['Go', 'Postgres'],
          client: { hiring_manager: { name: 'Marie Dupont', email: 'marie.dupont@client.test' } },
        },
      })
      .eq('id', ws.missionId);
    if (error) throw new Error(`sourcing_projects: ${error.message}`);
    await reloadPipeline(page);
    await expect(card).toContainText('Eric Entretien est en entretien depuis 6 jours.');
    await openWhy(card);
    await expect(card).toContainText('Relancez Marie Dupont pour connaître la suite.');
    const mail = card.getByRole('link', { name: 'Relancer Marie Dupont', exact: true });
    await expect(mail).toBeVisible();
    await expect(mail).toHaveAttribute('href', /^mailto:marie\.dupont@client\.test\?subject=.*&body=/);
    const href = decodeURIComponent((await mail.getAttribute('href')) ?? '');
    expect(href).toContain('Eric Entretien');
    expect(href).not.toMatch(/a eu lieu/);
    await expect(filledButtons(card)).toHaveCount(1);
  });

  // ═══ 7 : « Plus tard » ════════════════════════════════════════════════════

  test('7. « Plus tard » : action suivante, liste des missions, rechargement, À traiter intact, rien dans notifications ni rappels ; tout reporter et « Les reprendre » ; un second membre ne voit pas le report', async ({ browser }) => {
    const ws = await workspace('E2E now 7');
    await candidate(ws, 'Rita Retenue', 'retained');
    await candidate(ws, 'Remi Retenu', 'retained');
    await candidate(ws, 'Anna Atrier', 'to_sort', scored(75));
    // Une réponse de candidat non lue : le chiffre d'« À traiter » n'est pas nul.
    const notif = await admin().from('notifications').insert({
      user_id: ws.org.owner.userId,
      organization_id: ws.org.orgId,
      type: 'new_message',
      title: 'Nouveau message de Rose Repondu',
      metadata: { chat_id: `chat_${rand()}`, is_candidate: true, profile_name: 'Rose Repondu', project_id: ws.missionId },
    });
    if (notif.error) throw new Error(`notifications: ${notif.error.message}`);

    const notificationsOf = async () => {
      const { data, error } = await admin().from('notifications').select('id, read_at, type').eq('user_id', ws.org.owner.userId).order('id');
      if (error) throw new Error(`notifications: ${error.message}`);
      return data ?? [];
    };
    const remindersCount = async () => {
      const { count, error } = await admin().from('candidate_reminders').select('id', { count: 'exact', head: true }).eq('organization_id', ws.org.orgId);
      if (error) throw new Error(`candidate_reminders: ${error.message}`);
      return count ?? 0;
    };
    const snoozesOf = async (userId: string) => {
      const { data, error } = await admin().from('mission_action_snoozes').select('action_key, expires_at, project_id').eq('user_id', userId).eq('project_id', ws.missionId);
      if (error) throw new Error(`mission_action_snoozes: ${error.message}`);
      return data ?? [];
    };
    const notificationsBefore = await notificationsOf();
    expect(notificationsBefore).toHaveLength(1);

    const page = await openAs(browser, ws);
    await openPipeline(page, ws);
    const card = nowCard(page);
    await expect(card).toContainText('2 candidats retenus attendent un premier message.');
    await openWhy(card);
    await expect(thenLine(page)).toContainText('Trier 1 profil noté');
    // Chiffre d'« À traiter » avant : lu dans la barre latérale.
    await expect(todoTab(page)).toHaveAttribute('aria-label', 'À traiter, 1 élément', { timeout: 30_000 });
    const todoBefore = await todoTab(page).getAttribute('aria-label');

    // Plus tard : la carte passe à l'action suivante, la ligne reportée sort de « Ensuite ».
    await later(card).click();
    await expect(card).toContainText('1 nouveau profil noté.', { timeout: 15_000 });
    await expect(card).not.toContainText('candidats retenus attendent');
    await openWhy(card);
    await expect(thenLine(page)).toHaveCount(0);
    await expect.poll(async () => (await snoozesOf(ws.org.owner.userId)).map((s) => s.action_key), { timeout: 15_000 }).toEqual(['retained_uncontacted']);
    const [snooze] = await snoozesOf(ws.org.owner.userId);
    const endsAt = new Date(snooze.expires_at);
    expect(endsAt.getTime(), 'échéance : demain matin').toBeGreaterThan(Date.now());
    expect(endsAt.getTime()).toBeLessThanOrEqual(Date.now() + 31 * HOUR);

    // Un rechargement garde le report.
    await reloadPipeline(page);
    await expect(card).toContainText('1 nouveau profil noté.');
    await expect(card).not.toContainText('candidats retenus attendent');
    await openWhy(card);
    await expect(thenLine(page)).toHaveCount(0);

    // La liste des missions : la ligne reportée a disparu, la suivante la remplace.
    await page.goto('/missions', { waitUntil: 'domcontentloaded' });
    const row = page.getByTestId('mission-row').filter({ hasText: ws.missionName });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.getByRole('button', { name: `Trier 1 profil noté, ${ws.missionName}` })).toBeVisible({ timeout: 30_000 });
    await expect(row).not.toContainText('retenus');

    // Chiffre d'« À traiter » identique ; rien écrit dans notifications ni candidate_reminders.
    await expect(todoTab(page)).toHaveAttribute('aria-label', todoBefore ?? '', { timeout: 30_000 });
    expect(await notificationsOf(), 'notifications inchangées').toEqual(notificationsBefore);
    expect(await remindersCount(), 'aucun rappel écrit').toBe(0);

    // Un second membre ne voit pas le report du premier.
    const col = await colleague(ws);
    const page2 = await openAs(browser, ws, { user: col.user, accounts: [{ id: col.accountId!, status: 'OK' }] });
    await openPipeline(page2, ws);
    await expect(nowCard(page2)).toContainText('2 candidats retenus attendent un premier message.');
    expect(await snoozesOf(col.user.userId)).toEqual([]);

    // Tout reporter : « Vos actions du jour sont reportées à demain. », « Les reprendre » rétablit.
    await openPipeline(page, ws);
    await expect(card).toContainText('1 nouveau profil noté.');
    await later(card).click();
    await expect(card).toContainText('Vos actions du jour sont reportées à demain.', { timeout: 15_000 });
    await expect(page.getByText('Rien ne presse')).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Plus tard' })).toHaveCount(0);
    await expect.poll(async () => (await snoozesOf(ws.org.owner.userId)).map((s) => s.action_key).sort(), { timeout: 15_000 }).toEqual(['retained_uncontacted', 'to_sort']);
    await expect(todoTab(page)).toHaveAttribute('aria-label', todoBefore ?? '');

    await reloadPipeline(page);
    await expect(card).toContainText('Vos actions du jour sont reportées à demain.');
    await card.getByRole('button', { name: 'Les reprendre', exact: true }).click();
    await expect(card).toContainText('2 candidats retenus attendent un premier message.', { timeout: 15_000 });
    await expect.poll(async () => (await snoozesOf(ws.org.owner.userId)).length, { timeout: 15_000 }).toBe(0);
    await openWhy(card);
    await expect(thenLine(page)).toContainText('Trier 1 profil noté');

    // Toujours rien dans les notifications ni les rappels, et le chiffre n'a pas bougé.
    expect(await notificationsOf(), 'notifications inchangées').toEqual(notificationsBefore);
    expect(await remindersCount()).toBe(0);
    await expect(todoTab(page)).toHaveAttribute('aria-label', todoBefore ?? '');
  });

  // ═══ 8 : blocage ══════════════════════════════════════════════════════════

  test('8a. compte LinkedIn à reconnecter et une action qui en a besoin : la carte affiche le blocage, « Reconnecter » mène aux connexions', async ({ browser }) => {
    const ws = await workspace('E2E now 8a', { account: 'CREDENTIALS' });
    await candidate(ws, 'Rita Retenue', 'retained');
    const page = await openAs(browser, ws);
    await openPipeline(page, ws);
    const card = nowCard(page);

    await expect(card).toContainText('Blocage');
    await expect(card).toContainText('Votre compte LinkedIn est déconnecté.');
    await expect(filledButtons(card)).toHaveCount(1);
    await expect(card.getByRole('button', { name: 'Contacter ce candidat' })).toHaveCount(0);
    await openWhy(card);
    await expect(card).toContainText('Reconnectez-le pour pouvoir chercher des profils et écrire aux candidats.');
    await expect(card).toContainText('Cela empêche : contacter');
    await expect(card).toContainText('Un blocage');
    await expect(card).toContainText('empêche l\'action suivante');
    await card.getByRole('button', { name: 'Reconnecter', exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/account\/connections/);
  });

  test('8b. compte à reconnecter mais action sans besoin de LinkedIn (profils à trier) : pas de blocage', async ({ browser }) => {
    const ws = await workspace('E2E now 8b', { account: 'CREDENTIALS' });
    await candidate(ws, 'Anna Atrier', 'to_sort', scored(70));
    const page = await openAs(browser, ws);
    await recordCard(page);
    await openPipeline(page, ws);
    const card = nowCard(page);

    await expect(card).toContainText('1 nouveau profil noté.');
    await expect(card).not.toContainText('Blocage');
    await expect(card).not.toContainText('déconnecté');
    await expect(card.getByRole('button', { name: 'Trier ce profil', exact: true })).toBeVisible();
    expect((await recordedStates(page)).filter((s) => s.includes('Blocage')), 'aucun clignotement de blocage').toEqual([]);
  });

  test('8c. aucune liaison LinkedIn : rien ne clignote au chargement ; une action sans besoin de LinkedIn ne montre jamais de blocage', async ({ browser }) => {
    // Poste décrit sans profil : l'action (rang 10) exige LinkedIn, le blocage est « non relié ».
    const wsA = await workspace('E2E now 8c1', { account: 'none' });
    const pageA = await openAs(browser, wsA);
    await recordCard(pageA);
    await openPipeline(pageA, wsA);
    const cardA = nowCard(pageA);
    await expect(cardA).toContainText('Blocage');
    await expect(cardA).toContainText("Votre compte LinkedIn n'est pas relié.");
    await cardA.getByRole('button', { name: 'Relier LinkedIn', exact: true }).waitFor();
    const statesA = await recordedStates(pageA);
    expect(statesA.filter((s) => s.includes('Chercher des profils')), 'jamais « Chercher des profils » avant le blocage').toEqual([]);
    expect(statesA.filter((s) => s.includes("Rien d'autre à faire")), 'jamais « Rien d\'autre à faire »').toEqual([]);

    // Profils à trier seulement, aucune liaison : jamais de blocage, même un instant.
    const wsB = await workspace('E2E now 8c2', { account: 'none' });
    await candidate(wsB, 'Anna Atrier', 'to_sort', scored(70));
    const pageB = await openAs(browser, wsB);
    await recordCard(pageB);
    await openPipeline(pageB, wsB);
    await expect(nowCard(pageB)).toContainText('1 nouveau profil noté.');
    const statesB = await recordedStates(pageB);
    expect(statesB.filter((s) => s.includes('Blocage') || s.includes('LinkedIn')), 'aucun blocage affiché').toEqual([]);

    // Compte relié et en état de marche, mais liste des comptes lente : jamais de blocage pendant l'attente.
    const wsC = await workspace('E2E now 8c3');
    const pageC = await openAs(browser, wsC, { accountsDelayMs: 2_500 });
    await recordCard(pageC);
    await pageC.goto(missionUrl(wsC), { waitUntil: 'domcontentloaded' });
    await expect(nowCard(pageC).getByRole('button', { name: 'Chercher des profils', exact: true })).toBeVisible({ timeout: 30_000 });
    const statesC = await recordedStates(pageC);
    expect(statesC.filter((s) => s.includes('Blocage') || s.includes("n'est pas relié") || s.includes('déconnecté') || s.includes("n'est plus disponible")), 'aucun blocage pendant l\'attente de la liste des comptes').toEqual([]);
  });

  // ═══ 9 : liste des missions ═══════════════════════════════════════════════

  test('9. liste des missions : même rang que la carte en forme courte ; mission terminée ou archivée sans ligne ; jamais « Brief incomplet »', async ({ browser }) => {
    const ws = await workspace('E2E now 9');
    await candidate(ws, 'Anna Atrier', 'to_sort', scored(70));
    // Une mission terminée et une archivée avec des retenus : pas de ligne d'action.
    const doneName = `Mission terminee ${rand()}`;
    const doneId = await seedMission(ws.org.orgId, ws.org.owner.userId, { name: doneName, status: 'completed' });
    const archivedName = `Mission archivee ${rand()}`;
    const archivedId = await seedMission(ws.org.orgId, ws.org.owner.userId, { name: archivedName, status: 'archived' });
    for (const missionId of [doneId, archivedId]) {
      await seedCandidateRow({
        orgId: ws.org.orgId,
        createdBy: ws.org.owner.userId,
        candidateId: `ACoAAN${rand()}`,
        missionId,
        stage: 'retained',
        extra: { candidate_name: 'Rita Retenue' },
      });
    }
    // Une mission au poste vide : « Décrire le poste », jamais « Brief incomplet ».
    const emptyName = `Mission vide ${rand()}`;
    await seedMission(ws.org.orgId, ws.org.owner.userId, { name: emptyName, job_details: { title: 'Responsable RH' } });

    const page = await openAs(browser, ws);
    await page.goto('/missions', { waitUntil: 'domcontentloaded' });
    const row = page.getByTestId('mission-row').filter({ hasText: ws.missionName });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.getByRole('button', { name: `Trier 1 profil noté, ${ws.missionName}` })).toBeVisible({ timeout: 30_000 });
    const emptyRow = page.getByTestId('mission-row').filter({ hasText: emptyName });
    await expect(emptyRow.getByRole('button', { name: `Décrire le poste, ${emptyName}` })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Brief incomplet')).toHaveCount(0);

    // Terminées et archivées : section repliable, aucune ligne d'action.
    await page.getByRole('button', { name: /Terminées, archivées/ }).click();
    const doneRow = page.getByTestId('mission-row').filter({ hasText: doneName });
    const archivedRow = page.getByTestId('mission-row').filter({ hasText: archivedName });
    await expect(doneRow).toBeVisible({ timeout: 15_000 });
    await expect(archivedRow).toBeVisible();
    for (const r of [doneRow, archivedRow]) {
      await expect(r.getByRole('button', { name: /^(Voir|Contacter|Trier|Décrire|Chercher|Passer)/ })).toHaveCount(0);
      await expect(r).not.toContainText('retenu');
    }
    await expect(page.getByText('Brief incomplet')).toHaveCount(0);

    // Le clic de la ligne mène à l'écran de la carte, qui dit la même chose.
    await row.getByRole('button', { name: `Trier 1 profil noté, ${ws.missionName}` }).click();
    await expect(page).toHaveURL(new RegExp(`/missions/${escapeRe(ws.missionId)}`));
    await expect(nowCard(page)).toContainText('1 nouveau profil noté.', { timeout: 30_000 });
  });

  // ═══ 10 : colonne « Prochaine action » ════════════════════════════════════

  test('10. colonne « Prochaine action » : « Répondre » pour la ligne qui attend une réponse, rien d\'écrit sinon ; l\'ancienneté passe sous l\'étape', async ({ browser }) => {
    const ws = await workspace('E2E now 10');
    const rose = await candidate(ws, 'Rose Repondu', 'contacted');
    const carl = await candidate(ws, 'Carl Contacte', 'contacted');
    backdateStageEntered(carl.rowId, 8);
    await candidate(ws, 'Rita Retenue', 'retained');
    await seedMissionConversation({
      orgId: ws.org.orgId,
      projectId: ws.missionId,
      accountId: ws.accountId!,
      candidateId: rose.candidateId,
      createdBy: ws.org.owner.userId,
      lastOutboundAt: new Date(Date.now() - 4 * DAY),
      lastInboundAt: new Date(Date.now() - 3 * HOUR),
    });
    const page = await openAs(browser, ws);
    await openPipeline(page, ws);
    await expect(page.getByRole('columnheader', { name: 'Prochaine action' })).toBeVisible({ timeout: 30_000 });
    await expect(listRows(page)).toHaveCount(3, { timeout: 30_000 });

    const roseRow = listRows(page).filter({ hasText: 'Rose Repondu' });
    await expect(roseRow).toContainText(/Répondre \((aujourd'hui|hier|il y a \d+ j)\)/);
    const carlRow = listRows(page).filter({ hasText: 'Carl Contacte' });
    // Pas de « Aucune action depuis N j » : l'ancienneté se lit sous l'étape, en orange et dite « sans mouvement ».
    await expect(carlRow).not.toContainText('Aucune action');
    await expect(carlRow).not.toContainText('Répondre');
    // Midi (Paris) il y a 8 jours civils : la ligne compte des blocs de 24 h, soit 7 j avant midi à Paris et 8 j après.
    await expect(carlRow).toContainText(/Contacté\s*depuis\s[78]\sj/);
    await expect(carlRow).toContainText('sans mouvement');
    // Une ligne récente (moins d'un jour) n'écrit aucune ancienneté.
    await expect(listRows(page).filter({ hasText: 'Rita Retenue' })).not.toContainText(/depuis\s\d+\sj/);
    await expect(listRows(page).filter({ hasText: 'Rita Retenue' })).toContainText('Contacter');
  });

  // ═══ 11 : téléphone ═══════════════════════════════════════════════════════

  test('11. téléphone (390 x 844) : la carte tient sans défilement horizontal, bouton plein large, cibles de 44 px, pas de barre fixe', async ({ browser }) => {
    const ws = await workspace('E2E now 11');
    await candidate(ws, 'Anna Atrier', 'to_sort', scored(70));
    const page = await openAs(browser, ws, { viewport: { width: 390, height: 844 }, phone: true });
    await openPipeline(page, ws);
    const card = nowCard(page);
    await expect(card).toContainText('1 nouveau profil noté.', { timeout: 30_000 });

    // Pas de défilement horizontal de la page.
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
    }));
    expect(overflow.scrollWidth, 'pas de défilement horizontal').toBeLessThanOrEqual(overflow.clientWidth);
    expect(overflow.bodyScrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
    const box = await card.boundingBox();
    expect(box, 'carte mesurable').not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, 'la carte tient dans l\'écran').toBeLessThanOrEqual(390.5);

    // Le bouton plein est visible et large ; « Pourquoi maintenant ? » et « Plus tard » ont 44 px.
    const primary = card.getByRole('button', { name: 'Trier ce profil', exact: true });
    await expect(primary).toBeVisible();
    await expect(primary).toBeInViewport();
    const primaryBox = await primary.boundingBox();
    expect(primaryBox!.width, 'bouton plein large').toBeGreaterThan(box!.width * 0.8);
    expect(primaryBox!.height).toBeGreaterThanOrEqual(44);
    for (const target of [why(card), later(card)]) {
      await expect(target).toBeVisible();
      const b = await target.boundingBox();
      expect(b!.height, 'cible de 44 px').toBeGreaterThanOrEqual(44);
      expect(b!.x + b!.width).toBeLessThanOrEqual(390.5);
    }

    // Pas de barre fixe : aucun élément en position fixed qui porte le bouton de la carte.
    const fixedWithAction = await page.evaluate(() => {
      const hits: string[] = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
        if (getComputedStyle(el).position === 'fixed' && /Trier ce profil|Plus tard/.test(el.innerText ?? '')) hits.push(el.tagName);
      }
      return hits;
    });
    expect(fixedWithAction, 'pas de barre fixe portant l\'action').toEqual([]);
    // La carte défile avec la page : sa position change quand la page défile.
    expect(await card.evaluate((el) => {
      let node: HTMLElement | null = el as HTMLElement;
      while (node) {
        const p = getComputedStyle(node).position;
        if (p === 'fixed' || p === 'sticky') return p;
        node = node.parentElement;
      }
      return 'static';
    })).toBe('static');

    // « Pourquoi maintenant ? » s'ouvre sans défilement horizontal.
    await why(card).click();
    await expect(card).toContainText('Non suivi : ');
    const after = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(after).toBe(true);
  });

  // ═══ 12 : mission archivée ════════════════════════════════════════════════

  test('12. mission archivée : pas de carte', async ({ browser }) => {
    const ws = await workspace('E2E now 12', { status: 'archived' });
    await candidate(ws, 'Rita Retenue', 'retained');
    await candidate(ws, 'Anna Atrier', 'to_sort', scored(70));
    const page = await openAs(browser, ws);
    await page.goto(missionUrl(ws), { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('mission-v3')).toBeVisible({ timeout: 30_000 });
    // La liste est lue : la mission est bien affichée, mais sans carte.
    await expect(listRows(page).filter({ hasText: 'Rita Retenue' })).toBeVisible({ timeout: 30_000 });
    await expect(nowCard(page)).toHaveCount(0);
    await expect(page.getByTestId('now-card-loading')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Maintenant', exact: true })).toHaveCount(0);
    await expect(page.getByText('Mission archivée', { exact: false }).first()).toBeVisible();
  });
});
