/**
 * Lot « identity » du module séquences, côté interface : inscription depuis
 * les résultats de recherche d'une mission (barre groupée « Séquence »), quand
 * un même candidat LinkedIn porte plusieurs identifiants (Recruiter « AE… »,
 * classique « ACo… », slug public /in/{slug}).
 *
 * Contrat : docs/audit-2026-09-25-sequences.md, SEQ-046 (« le même candidat
 * inscrit sous un autre identifiant, Recruiter ou classique, est détecté »),
 * SEQ-128 (inscription vivante signalée quelle que soit sa date), SEQ-222
 * (« déjà dans cette séquence » / « déjà passé par cette séquence »), D3
 * (anti-doublon par une fonction serveur, comparaison exacte des identifiants).
 *
 * Harnais : la recherche LinkedIn (unipile-search), la génération des filtres
 * par l'IA (generate-search-filters) et la liste des comptes (unipile-accounts,
 * action list) sont simulées dans le navigateur ; tout le reste (lectures,
 * anti-doublon find_recent_org_contacts, écritures des inscriptions) passe par
 * la vraie base locale. Les étapes ont un jour de délai : le cycle du moteur
 * lancé par d'autres suites ne prend pas les inscriptions créées ici.
 */
import type { Browser, BrowserContext, Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import {
  addMember,
  admin,
  createOrg,
  deleteOrg,
  seedLinkedInAccount,
  seedMission,
  setOrgPlan,
  storageStateForUser,
  type TestOrg,
  type TestUser,
} from '../helpers/supabase-admin';

const EDGE_DEPLOYED = process.env.E2E_EDGE_FUNCTIONS === '1';
test.skip(!EDGE_DEPLOYED, 'stack locale absente (E2E_EDGE_FUNCTIONS=1, voir e2e/local-stack/README.md)');
test.describe.configure({ timeout: 150_000 });

const rand = () => Math.random().toString(36).slice(2, 10);
const DAY = 24 * 3600 * 1000;

// ─── Nettoyage ──────────────────────────────────────────────────────────────

const contexts: BrowserContext[] = [];
const orgsToDelete: Array<{ org: TestOrg; extra: TestUser[] }> = [];
test.afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
  while (orgsToDelete.length) {
    const { org, extra } = orgsToDelete.pop()!;
    await admin().from('job_candidate_status').delete().eq('organization_id', org.orgId);
    await deleteOrg(org, extra);
  }
});

// ─── Données ────────────────────────────────────────────────────────────────

interface Workspace {
  org: TestOrg;
  accountId: string;
  missionId: string;
}

/** Cabinet sur offre payante, compte LinkedIn du propriétaire, mission. */
async function workspace(label: string, extra: TestUser[] = []): Promise<Workspace> {
  const org = await createOrg('agency', label);
  orgsToDelete.push({ org, extra });
  await setOrgPlan(org.orgId);
  const accountId = await seedLinkedInAccount(org.orgId, org.owner.userId, `acc_${rand()}`, 'OK');
  const missionId = await seedMission(org.orgId, org.owner.userId);
  return { org, accountId, missionId };
}

async function setDisplayName(userId: string, displayName: string) {
  const { error } = await admin().from('profiles').update({ display_name: displayName }).eq('user_id', userId);
  if (error) throw new Error(`display_name: ${error.message}`);
}

/**
 * Séquence de la mission, une étape à un jour de délai : message avec modèle
 * (aperçu d'inscription) ou invitation sans note (inscription simple).
 */
async function sequence(orgId: string, createdBy: string, missionId: string, kind: 'message' | 'invitation' = 'message') {
  const name = `Séquence identité ${rand()}`;
  const { data: seq, error } = await admin()
    .from('outreach_sequences')
    .insert({ name, organization_id: orgId, created_by: createdBy, project_id: missionId, is_active: true })
    .select('id')
    .single();
  if (error || !seq) throw new Error(`sequence: ${error?.message}`);
  const { error: stepError } = await admin().from('sequence_steps').insert({
    sequence_id: seq.id,
    step_order: 0,
    action_type: kind === 'message' ? 'message' : 'connection_request',
    delay_days: 1,
    message_template: kind === 'message' ? 'Bonjour {{firstName}}' : null,
  });
  if (stepError) throw new Error(`sequence step: ${stepError.message}`);
  return { id: seq.id as string, name };
}

async function enrollmentRow(orgId: string, sequenceId: string, createdBy: string, accountId: string, overrides: Record<string, unknown>) {
  const { error } = await admin().from('sequence_enrollments').insert({
    sequence_id: sequenceId,
    organization_id: orgId,
    created_by: createdBy,
    account_id: accountId,
    profile_name: 'Jean Dupont',
    status: 'active',
    current_step_order: 0,
    ...overrides,
  });
  if (error) throw new Error(`enrollmentRow: ${error.message}`);
}

/** Inscriptions de la séquence qui désignent ce candidat, sous n'importe lequel de ses identifiants. */
async function rowsForPerson(sequenceId: string, ids: string[]) {
  const list = ids.join(',');
  const { data, error } = await admin()
    .from('sequence_enrollments')
    .select('id, profile_id, provider_id, status')
    .eq('sequence_id', sequenceId)
    .or(`profile_id.in.(${list}),provider_id.in.(${list}),resolved_profile_id.in.(${list})`);
  if (error) throw new Error(`rowsForPerson: ${error.message}`);
  return data ?? [];
}

interface SearchProfile {
  id: string;
  name: string;
  provider_id?: string;
  public_identifier?: string;
  profile_url?: string;
  public_profile_url?: string;
}

function asResult(p: SearchProfile) {
  const [first, ...rest] = p.name.split(' ');
  return {
    first_name: first,
    last_name: rest.join(' '),
    headline: 'Ingénieur backend',
    location: 'Paris, France',
    network_distance: 'SECOND_DEGREE',
    ...p,
  };
}

// ─── Parcours ───────────────────────────────────────────────────────────────

/**
 * Onglet Sourcing de la mission, connecté en `user`, recherche lancée depuis
 * le brief : les `profiles` s'affichent dans les résultats.
 */
async function openSearchResults(browser: Browser, user: TestUser, ws: Workspace, profiles: SearchProfile[]): Promise<Page> {
  const context = await browser.newContext({ storageState: await storageStateForUser(user), timezoneId: 'Europe/Paris' });
  contexts.push(context);
  await context.route('**/functions/v1/unipile-accounts', async (route) => {
    let action: string | undefined;
    try {
      action = (route.request().postDataJSON() as { action?: string } | null)?.action;
    } catch {
      /* pré-vol CORS */
    }
    if (action !== 'list') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, accounts: [{ id: ws.accountId, account_status: 'OK', provider: 'LINKEDIN', name: 'E2E LinkedIn' }] }),
    });
  });
  await context.route('**/functions/v1/unipile-search', async (route) => {
    let action: string | undefined;
    try {
      action = (route.request().postDataJSON() as { action?: string } | null)?.action;
    } catch {
      /* pré-vol CORS */
    }
    const body = action === 'search'
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

  const page = await context.newPage();
  await page.goto(`/missions/${ws.missionId}?tab=sourcing`, { waitUntil: 'domcontentloaded' });
  await page.getByText('générer depuis le brief').click({ timeout: 30_000 });
  for (const p of profiles) {
    await expect(page.getByRole('checkbox', { name: `Sélectionner ${p.name}`, exact: true })).toBeVisible({ timeout: 30_000 });
  }
  return page;
}

/** Sélectionne ces candidats, « Séquence » puis la séquence : fenêtre d'inscription ouverte. */
async function openEnrollment(page: Page, names: string[], sequenceName: string): Promise<Locator> {
  for (const name of names) {
    await page.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true }).click();
  }
  await page.getByRole('button', { name: 'Séquence', exact: true }).click();
  await page.getByRole('menuitem', { name: new RegExp(sequenceName) }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: sequenceName });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Bouton « Inscrire N candidat(s) » visible de la fenêtre. */
function enrollButton(dialog: Locator, count: number) {
  return dialog.getByRole('button', { name: `Inscrire ${count} candidat${count > 1 ? 's' : ''}`, exact: true }).filter({ visible: true }).first();
}

/** Bilan de l'aperçu d'inscription (titre du bilan). */
function previewOutcome(dialog: Locator) {
  return dialog.getByRole('heading', { name: /candidats? inscrits?|Aucune nouvelle inscription|Aucun candidat inscrit/ });
}

const parisDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Paris' });

// ═══ Sélection qui contient deux fois la même personne ══════════════════════

test.describe('Identité du candidat : sélection en double', () => {
  // ui-selection-doublon-deux-identifiants (SEQ-046), aperçu d'inscription
  test('aperçu : un résultat Recruiter et un résultat classique de la même personne n’inscrivent qu’une ligne', async ({ browser }) => {
    const ws = await workspace('E2E Identité sélection aperçu');
    const seq = await sequence(ws.org.orgId, ws.org.owner.userId, ws.missionId, 'message');
    const classic = `ACoAAIDUI${rand()}`;
    const recruiter = `AEMAAIDUI${rand()}`;
    const slug = `jean-dupont-${rand()}`;
    const page = await openSearchResults(browser, ws.org.owner, ws, [
      { id: recruiter, provider_id: classic, public_identifier: slug, name: 'Jean Dupont', profile_url: `https://www.linkedin.com/in/${slug}` },
      { id: classic, public_identifier: slug, name: 'Jean Dupont Classique', profile_url: `https://www.linkedin.com/in/${slug}` },
    ]);
    const dialog = await openEnrollment(page, ['Jean Dupont', 'Jean Dupont Classique'], seq.name);

    await dialog.getByRole('button', { name: /^Inscrire \d+ candidats?$/ }).filter({ visible: true }).first().click();
    await expect(previewOutcome(dialog)).toBeVisible({ timeout: 30_000 });

    const rows = await rowsForPerson(seq.id, [classic, recruiter]);
    // DÉFAUT ui-selection-doublon-non-dedoublonnee : la sélection n'est pas dédoublonnée par provider_id ni par slug, et UNIQUE(sequence_id, profile_id) laisse passer AE… et ACo….
    expect(rows.map((r) => r.profile_id), 'une seule inscription de la personne dans la séquence').toHaveLength(1);
  });

  // ui-selection-doublon-deux-identifiants (SEQ-046), inscription simple
  test('inscription simple : un résultat Recruiter et un résultat classique de la même personne n’inscrivent qu’une ligne', async ({ browser }) => {
    const ws = await workspace('E2E Identité sélection simple');
    const seq = await sequence(ws.org.orgId, ws.org.owner.userId, ws.missionId, 'invitation');
    const classic = `ACoAAIDUS${rand()}`;
    const recruiter = `AEMAAIDUS${rand()}`;
    const slug = `jean-dupont-${rand()}`;
    const page = await openSearchResults(browser, ws.org.owner, ws, [
      { id: recruiter, provider_id: classic, public_identifier: slug, name: 'Jean Dupont', profile_url: `https://www.linkedin.com/in/${slug}` },
      { id: classic, public_identifier: slug, name: 'Jean Dupont Classique', profile_url: `https://www.linkedin.com/in/${slug}` },
    ]);
    const dialog = await openEnrollment(page, ['Jean Dupont', 'Jean Dupont Classique'], seq.name);

    await dialog.getByRole('button', { name: /^Inscrire \d+ candidats?$/ }).click();
    await expect(dialog.getByText(/candidats? inscrits?|déjà dans cette séquence/).first()).toBeVisible({ timeout: 30_000 });

    const rows = await rowsForPerson(seq.id, [classic, recruiter]);
    // DÉFAUT ui-selection-doublon-non-dedoublonnee : même trou dans SequenceEnrollModal (upsert de toute la sélection, conflit sur profile_id seul).
    expect(rows.map((r) => r.profile_id), 'une seule inscription de la personne dans la séquence').toHaveLength(1);
  });
});

// ═══ Pré-contrôle « déjà dans / déjà passé par cette séquence » ═════════════

test.describe('Identité du candidat : pré-contrôle de la séquence', () => {
  // ui-precheck-sequence-autre-identifiant (SEQ-222, SEQ-046), aperçu d'inscription
  // décision produit en attente : une inscription close (arrêtée, ou terminée hors des 90 jours) sous un autre identifiant bloque-t-elle la même séquence ?
  test.fixme('aperçu : un candidat déjà passé par la séquence sous son identifiant Recruiter (arrêtée, ou terminée il y a 120 jours) n’est pas réinscrit', async ({ browser }) => {
    const ws = await workspace('E2E Identité pré-contrôle aperçu');
    const owner = ws.org.owner.userId;
    const seq = await sequence(ws.org.orgId, owner, ws.missionId, 'message');
    const stopped = { classic: `ACoAAIDPS${rand()}`, recruiter: `AEMAAIDPS${rand()}` };
    const old = { classic: `ACoAAIDPO${rand()}`, recruiter: `AEMAAIDPO${rand()}` };
    await enrollmentRow(ws.org.orgId, seq.id, owner, ws.accountId, {
      profile_id: stopped.recruiter, provider_id: stopped.classic, status: 'stopped', completed_at: new Date(Date.now() - 5 * DAY).toISOString(),
    });
    await enrollmentRow(ws.org.orgId, seq.id, owner, ws.accountId, {
      profile_id: old.recruiter, provider_id: old.classic, profile_name: 'Paul Martin', status: 'completed',
      created_at: new Date(Date.now() - 120 * DAY).toISOString(), completed_at: new Date(Date.now() - 100 * DAY).toISOString(),
    });
    const page = await openSearchResults(browser, ws.org.owner, ws, [
      { id: stopped.classic, name: 'Jean Dupont' },
      { id: old.classic, name: 'Paul Martin' },
    ]);
    const dialog = await openEnrollment(page, ['Jean Dupont', 'Paul Martin'], seq.name);

    await dialog.getByRole('button', { name: /^Inscrire \d+ candidats?$/ }).filter({ visible: true }).first().click();
    await expect(previewOutcome(dialog)).toBeVisible({ timeout: 30_000 });

    // DÉFAUT ui-precheck-autre-identifiant : le pré-contrôle ne lit que .eq('profile_id') ; l'anti-doublon ne voit ni une inscription arrêtée ni une inscription close depuis plus de 90 jours.
    expect.soft((await rowsForPerson(seq.id, [stopped.classic, stopped.recruiter])).length, 'inscription arrêtée : pas de seconde ligne').toBe(1);
    expect.soft((await rowsForPerson(seq.id, [old.classic, old.recruiter])).length, 'terminée il y a 120 jours : pas de seconde ligne').toBe(1);
    await expect(dialog.getByText('2 candidats sont déjà passés par cette séquence (terminée, réponse ou arrêt). Relancez-les depuis le suivi de la séquence.')).toBeVisible();
  });

  // ui-precheck-sequence-autre-identifiant (SEQ-222, SEQ-046), inscription simple
  // décision produit en attente : une inscription arrêtée sous un autre identifiant bloque-t-elle la même séquence ?
  test.fixme('inscription simple : un candidat déjà passé par la séquence sous son identifiant Recruiter n’est pas réinscrit', async ({ browser }) => {
    const ws = await workspace('E2E Identité pré-contrôle simple');
    const owner = ws.org.owner.userId;
    const seq = await sequence(ws.org.orgId, owner, ws.missionId, 'invitation');
    const stopped = { classic: `ACoAAIDQS${rand()}`, recruiter: `AEMAAIDQS${rand()}` };
    await enrollmentRow(ws.org.orgId, seq.id, owner, ws.accountId, {
      profile_id: stopped.recruiter, provider_id: stopped.classic, status: 'stopped', completed_at: new Date(Date.now() - 5 * DAY).toISOString(),
    });
    const page = await openSearchResults(browser, ws.org.owner, ws, [{ id: stopped.classic, name: 'Jean Dupont' }]);
    const dialog = await openEnrollment(page, ['Jean Dupont'], seq.name);

    await dialog.getByRole('button', { name: /^Inscrire \d+ candidats?$/ }).click();
    await expect(dialog.getByText(/candidats? inscrits?|déjà passé par cette séquence|déjà dans cette séquence/).first()).toBeVisible({ timeout: 30_000 });

    // DÉFAUT ui-precheck-autre-identifiant : SequenceEnrollModal ne pré-contrôle que .in('profile_id').
    expect.soft((await rowsForPerson(seq.id, [stopped.classic, stopped.recruiter])).length, 'pas de seconde ligne').toBe(1);
    await expect(dialog.getByText('1 candidat est déjà passé par cette séquence (terminée, réponse ou arrêt). Relancez-le depuis le suivi de la séquence.')).toBeVisible();
  });
});

// ═══ Dérogation « Inscrire quand même » ═════════════════════════════════════

test.describe('Identité du candidat : dérogation du propriétaire', () => {
  // ui-derogation-admin-meme-sequence (SEQ-046)
  test('« Inscrire quand même » n’inscrit pas une seconde fois dans la même séquence un candidat inscrit sous un autre identifiant ; une autre séquence reste possible', async ({ browser }) => {
    const ws = await workspace('E2E Identité dérogation');
    const owner = ws.org.owner.userId;
    await setDisplayName(owner, 'Claire Dubois');
    const seq = await sequence(ws.org.orgId, owner, ws.missionId, 'message');
    const other = await sequence(ws.org.orgId, owner, ws.missionId, 'message');
    const classic = `ACoAAIDDR${rand()}`;
    const recruiter = `AEMAAIDDR${rand()}`;
    await enrollmentRow(ws.org.orgId, seq.id, owner, ws.accountId, { profile_id: recruiter, provider_id: classic });
    const { data: existing } = await admin().from('sequence_enrollments').select('created_at').eq('sequence_id', seq.id).eq('profile_id', recruiter).single();

    const page = await openSearchResults(browser, ws.org.owner, ws, [{ id: classic, name: 'Jean Dupont' }]);
    let dialog = await openEnrollment(page, ['Jean Dupont'], seq.name);
    await expect(dialog.getByText(`Déjà contacté par Claire le ${parisDate(existing!.created_at as string)}`)).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole('checkbox', { name: /Inscrire quand même/ }).check();
    await enrollButton(dialog, 1).click();
    await expect(previewOutcome(dialog)).toBeVisible({ timeout: 30_000 });

    // DÉFAUT ui-derogation-double-inscription : la dérogation lève l'anti-doublon et le pré-contrôle ne lit que profile_id : seconde ligne dans la même séquence.
    expect.soft((await rowsForPerson(seq.id, [classic, recruiter])).length, 'pas de seconde inscription dans la même séquence').toBe(1);
    await expect.soft(dialog.getByText('1 candidat déjà dans cette séquence.')).toBeVisible();

    // Témoin : dans une autre séquence, la dérogation inscrit bien le candidat.
    // Nouvelle page, statut pipeline « contacté » retiré : la liste des
    // résultats montre de nouveau le candidat, sans dépendre de l'onglet actif.
    await admin().from('job_candidate_status').delete().eq('organization_id', ws.org.orgId);
    const again = await openSearchResults(browser, ws.org.owner, ws, [{ id: classic, name: 'Jean Dupont' }]);
    dialog = await openEnrollment(again, ['Jean Dupont'], other.name);
    await dialog.getByRole('checkbox', { name: /Inscrire quand même/ }).check();
    await enrollButton(dialog, 1).click();
    await expect(previewOutcome(dialog)).toBeVisible({ timeout: 30_000 });
    expect((await rowsForPerson(other.id, [classic, recruiter])).length, 'autre séquence : inscription par dérogation').toBe(1);
  });
});

// ═══ Anti-doublon par resolved_profile_id, provider_id et slug ══════════════

test.describe('Identité du candidat : anti-doublon de l’organisation', () => {
  // ui-anti-doublon-resolved-et-slug (SEQ-046, SEQ-128, D3)
  test('l’aperçu signale « Déjà contacté par {prénom} le {date} » et exclut le candidat inscrit par un collègue sous resolved_profile_id ou sous son slug, sans rapprocher un slug voisin', async ({ browser }) => {
    const ws = await workspace('E2E Identité anti-doublon');
    const mate = await addMember(ws.org.orgId, 'member', 'collegue');
    orgsToDelete[orgsToDelete.length - 1].extra.push(mate);
    await setDisplayName(mate.userId, 'Claire Dubois');
    const mateAccount = await seedLinkedInAccount(ws.org.orgId, mate.userId, `acc_${rand()}`, 'OK');
    const mateSeq = await sequence(ws.org.orgId, mate.userId, ws.missionId, 'message');
    const seq = await sequence(ws.org.orgId, ws.org.owner.userId, ws.missionId, 'message');

    const jean = { classic: `ACoAAIDAJ${rand()}`, recruiter: `AEMAAIDAJ${rand()}` };
    const paulSlug = `paul-martin-${rand()}`;
    const tenDaysAgo = new Date(Date.now() - 10 * DAY).toISOString();
    // Inscription active du collègue : identifiant classique résolu, sans URL.
    await enrollmentRow(ws.org.orgId, mateSeq.id, mate.userId, mateAccount, {
      profile_id: jean.recruiter, resolved_profile_id: jean.classic, profile_url: null,
    });
    const { data: jeanRow } = await admin().from('sequence_enrollments').select('created_at').eq('profile_id', jean.recruiter).single();
    // Inscription terminée il y a 10 jours : seul le slug de l'URL (avec paramètres) relie le candidat.
    await enrollmentRow(ws.org.orgId, mateSeq.id, mate.userId, mateAccount, {
      profile_id: `AEMAAIDAP${rand()}`, profile_name: 'Paul Martin', status: 'completed',
      profile_url: `https://www.linkedin.com/in/${paulSlug}/?trk=x`, created_at: tenDaysAgo, completed_at: tenDaysAgo,
    });

    const neighbour = `ACoAAIDAN${rand()}`;
    const page = await openSearchResults(browser, ws.org.owner, ws, [
      { id: jean.classic, name: 'Jean Dupont' },
      { id: `ACoAAIDAP${rand()}`, name: 'Paul Martin', profile_url: `https://linkedin.com/in/${paulSlug.replace('paul-martin', 'Paul-Martin')}` },
      { id: neighbour, name: 'Paule Martine', profile_url: 'https://www.linkedin.com/in/paul-martin' },
    ]);
    const dialog = await openEnrollment(page, ['Jean Dupont', 'Paul Martin', 'Paule Martine'], seq.name);

    await expect(dialog.getByText('2 candidats déjà contactés par votre organisation', { exact: false })).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByText(`Déjà contacté par Claire le ${parisDate(jeanRow!.created_at as string)}`).first()).toBeVisible();
    await expect(dialog.getByText(`Déjà contacté par Claire le ${parisDate(tenDaysAgo)}`).first()).toBeVisible();
    const banner = dialog.locator('li').filter({ hasText: 'Déjà contacté par' });
    await expect(banner.filter({ hasText: 'Jean Dupont' })).toHaveCount(1);
    await expect(banner.filter({ hasText: 'Paul Martin' })).toHaveCount(1);
    await expect(banner.filter({ hasText: 'Paule Martine' }), 'slug voisin non rapproché').toHaveCount(0);
    await expect(enrollButton(dialog, 1), 'seul le candidat au slug voisin est compté').toBeVisible();

    await enrollButton(dialog, 1).click();
    await expect(previewOutcome(dialog)).toBeVisible({ timeout: 30_000 });
    const { data: created } = await admin().from('sequence_enrollments').select('profile_id').eq('sequence_id', seq.id);
    expect((created ?? []).map((r) => r.profile_id), 'seul le candidat non contacté est inscrit').toEqual([neighbour]);
  });
});
