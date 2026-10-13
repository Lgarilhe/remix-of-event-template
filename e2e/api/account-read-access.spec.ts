/**
 * Usage des comptes de l'équipe (constat F9 de la visite du 12/10/2026, étendu par la revue de sécurité du même jour),
 * contre la stack locale (e2e/local-stack), fonctions et faux prestataire pour de vrai.
 *
 * Règle (à confirmer par le propriétaire du produit) : un collaborateur ne se sert que du compte qu'il a relié lui-même,
 * pour N'IMPORTE QUELLE action de unipile-search et de unipile-accounts qui désigne un compte existant (une règle générale,
 * pas une liste : une action ajoutée plus tard est couverte, on le prouve avec une action inventée). Propriétaire,
 * administrateur et membre se servent de ceux de l'organisation ; un appel interne (clé de service) n'est pas concerné.
 *   - lectures de contenu (premier lot) : unipile-search get_chats, get_messages, sync_chat_history, list_sent_invitations,
 *     list_recruiter_projects ; unipile-accounts inmail_balance, list_contracts (et list_recruiter_contracts),
 *     get_account_details, get_attendee_picture, list_invitations_received ;
 *   - le reste : get_parameters (projets et recherches enregistrées du collègue), search (dont dans un projet Recruiter),
 *     search_from_url, get_profile, get_user_posts, mark_as_read, endorse_skill, send_message, withdraw_invitation,
 *     handle_invitation_received, bulk_handle_invitations, disconnect, select_contract, update_proxy, add_reaction,
 *     delete_message, delete_chat.
 * Un refus ne doit jamais atteindre le prestataire ni consommer le plafond LinkedIn du collègue : on le prouve par le
 * journal du faux prestataire et par linkedin_action_log, compte par compte.
 * La liste des comptes (action list) reste visible de toute l'équipe : le test ne garde que l'absence de contenu de conversation.
 *
 * Écriture de l'uuid de l'organisation (revue de sécurité, 13/10/2026, problème 3 de la deuxième série) : la base lit les
 * majuscules, les accolades et l'absence de tirets comme le même uuid ; la règle du collaborateur et le rattachement d'un compte
 * ne doivent pas prendre l'organisation, ainsi écrite, pour une autre. Une écriture que la base refuse (espaces autour) reste refusée.
 *
 * Dernier état connu d'un compte que le prestataire ne renseigne pas (revue de l'écran, 13/10/2026) : un état que le webhook a déjà
 * dit (à reconnecter, en panne, partiel, verrouillé) est rendu tel quel, sans le marqueur « à vérifier ».
 * Licences lues (revue de l'écran, 13/10/2026) : chaque entrée de la liste LinkedIn porte `licences_read`, vrai seulement quand les contrats
 * du compte ont vraiment été lus dans l'appel ; une entrée sans lecture, un ancien identifiant ou un appel des contrats en échec
 * rendent faux, `subscriptions` restant présent pour la compatibilité (une estimation, pas une lecture).
 *
 * Marque de déconnexion WhatsApp (revue de l'écran, 12/10/2026) : list_whatsapp rend `removed_by_member` vrai pour la pierre
 * tombale d'un « Déconnecter », faux pour un compte vivant et pour un compte disparu chez le prestataire (lecture ou webhook).
 *
 * Rôles : Hugo (administrateur), Camille (membre, compte relié), Léa (collaboratrice, compte relié), le propriétaire.
 *
 * @critical
 */
import { test, expect } from '@playwright/test';
import { E2E } from '../helpers/env';
import { addMember, admin, createOrg, deleteOrg, seedLinkedInAccount, signIn, type TestOrg, type TestUser } from '../helpers/supabase-admin';
import { ENGINE_SKIP_REASON, callFunction, engineAvailable, mockCalls, postJson, rand, setMockMode, v2, webhook } from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
test.setTimeout(180_000);

interface Team {
  org: TestOrg;
  hugo: TestUser;
  camille: TestUser;
  lea: TestUser;
  accOwner: string;
  accHugo: string;
  accCamille: string;
  accLea: string;
}

const cleanups: Array<() => Promise<unknown>> = [];
test.afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!().catch(() => undefined);
});

async function team(): Promise<Team> {
  const org = await createOrg('agency', 'E2E lecture comptes');
  const hugo = await addMember(org.orgId, 'admin', 'hugo');
  const camille = await addMember(org.orgId, 'member', 'camille');
  const lea = await addMember(org.orgId, 'collaborator', 'lea');
  cleanups.push(() => deleteOrg(org, [hugo, camille, lea]));
  const accOwner = await seedLinkedInAccount(org.orgId, org.owner.userId, `acc_ro${rand()}`);
  const accHugo = await seedLinkedInAccount(org.orgId, hugo.userId, `acc_rh${rand()}`);
  const accCamille = await seedLinkedInAccount(org.orgId, camille.userId, `acc_rc${rand()}`);
  const accLea = await seedLinkedInAccount(org.orgId, lea.userId, `acc_rl${rand()}`);
  return { org, hugo, camille, lea, accOwner, accHugo, accCamille, accLea };
}

const tokenOf = async (user: TestUser) => (await signIn(user.email, user.password)).access_token;

interface Read {
  fn: 'unipile-search' | 'unipile-accounts';
  action: string;
  extra?: Record<string, unknown>;
}

const READS: Read[] = [
  { fn: 'unipile-search', action: 'get_chats' },
  { fn: 'unipile-search', action: 'get_messages', extra: { chat_id: 'CLASSIC_1-CHAT' } },
  { fn: 'unipile-search', action: 'sync_chat_history', extra: { chat_id: 'CLASSIC_1-CHAT' } },
  { fn: 'unipile-search', action: 'list_sent_invitations' },
  { fn: 'unipile-search', action: 'list_recruiter_projects' },
  { fn: 'unipile-accounts', action: 'inmail_balance' },
  { fn: 'unipile-accounts', action: 'list_contracts' },
  { fn: 'unipile-accounts', action: 'list_recruiter_contracts' },
  { fn: 'unipile-accounts', action: 'get_account_details' },
  { fn: 'unipile-accounts', action: 'get_attendee_picture', extra: { chat_id: 'CLASSIC_1-CHAT' } },
  { fn: 'unipile-accounts', action: 'list_invitations_received' },
];

function read(t: Team, token: string, r: Read, accountId: string) {
  return callFunction(r.fn, token, { action: r.action, organization_id: t.org.orgId, account_id: accountId, ...r.extra });
}

/** Refus : 403 et le code de la fonction, jamais le contenu du compte. */
function expectRefused(r: Read, res: { status: number; body: Record<string, unknown> }, label: string) {
  const where = `${label} ${r.fn}.${r.action} : ${JSON.stringify(res.body)}`;
  expect(res.status, where).toBe(403);
  expect(res.body.success, where).toBe(false);
  if (r.fn === 'unipile-search') expect(res.body.errorType, where).toBe('ACCOUNT_NOT_YOURS');
  else expect(res.body.error_code, where).toBe('account_not_yours');
  expect(String(res.body.error), where).toContain("relié par un autre membre de l'organisation");
  expect(JSON.stringify(res.body), where).not.toMatch(/unipile/i);
}

/** Lecture servie : jamais le refus de la règle (une photo absente reste un 200 « non disponible »). */
function expectServed(r: Read, res: { status: number; body: Record<string, unknown> }, label: string) {
  const where = `${label} ${r.fn}.${r.action} : ${JSON.stringify(res.body)}`;
  expect(res.status, where).toBe(200);
  expect(res.body.errorType, where).not.toBe('ACCOUNT_NOT_YOURS');
  expect(res.body.error_code, where).not.toBe('account_not_yours');
  if (r.action !== 'get_attendee_picture') expect(res.body.success, where).toBe(true);
}

/**
 * Les autres usages d'un compte. `own` : sans effet destructeur, rejoué sur le compte du collaborateur ; `provider` : atteint le
 * faux prestataire quand il est permis (pas de route inconnue du faux prestataire, sinon la pile signale une violation).
 */
interface Use extends Read {
  own: boolean;
  provider: boolean;
  label: string;
}

const use = (fn: Read['fn'], action: string, extra: Record<string, unknown> | undefined, flags: { own?: boolean; provider?: boolean; label?: string } = {}): Use => ({
  fn, action, extra, own: flags.own ?? true, provider: flags.provider ?? false, label: flags.label ?? action,
});

const USES: Use[] = [
  // Paramètres de recherche : ils rendent les projets, les recherches enregistrées et récentes du compte.
  ...['PROJECT', 'SAVED_SEARCH', 'SEAT', 'CUSTOM_FILTER'].map((type) => use('unipile-search', 'get_parameters', { type, service: 'RECRUITER' }, { provider: true, label: `get_parameters ${type}` })),
  // Sales Navigator : le faux prestataire n'a que le contrat Recruiter actif, la fonction suit alors le contrat actif et ne
  // rend aucun de ces types sans appel. Le refus ne dépend pas de ce chemin : il est jugé avant (`provider` faux ici).
  ...['LEAD_LIST', 'ACCOUNT_LIST', 'SAVED_PEOPLE_SEARCH', 'SAVED_COMPANY_SEARCH', 'RECENT_SEARCH', 'PERSONA']
    .map((type) => use('unipile-search', 'get_parameters', { type, service: 'SALES_NAVIGATOR' }, { label: `get_parameters ${type}` })),
  use('unipile-search', 'search', { api: 'classic', keywords: 'Go' }, { provider: true, label: 'search classique' }),
  use('unipile-search', 'search', { api: 'recruiter', keywords: 'Go', recruiter_project_id: '777' }, { provider: true, label: 'search dans un projet Recruiter' }),
  use('unipile-search', 'search_from_url', { url: 'https://www.linkedin.com/search/results/people/?keywords=go' }),
  use('unipile-search', 'get_profile', { profile_id: 'ACoAAcandidat' }, { provider: true }),
  use('unipile-search', 'get_user_posts', { identifier: 'jean-dupont' }, { provider: true }),
  use('unipile-search', 'mark_as_read', { chat_id: 'CLASSIC_1-CHAT' }, { provider: true }),
  // Hors du faux prestataire (aucune route de recommandation) et gestes au nom du compte : refus seulement.
  use('unipile-search', 'endorse_skill', { profile_id: 'ACoAAcandidat', skill_endorsement_id: 'sk1' }, { own: false }),
  use('unipile-search', 'send_message', { chat_id: 'CLASSIC_1-CHAT', text: 'Bonjour' }, { own: false }),
  use('unipile-search', 'withdraw_invitation', { invitation_id: 'inv1' }, { own: false }),
  use('unipile-search', 'une_action_ajoutee_plus_tard', undefined, { own: false }),
  use('unipile-accounts', 'handle_invitation_received', { invitation_id: 'rr1', invitation_action: 'decline' }, { provider: true }),
  use('unipile-accounts', 'bulk_handle_invitations', { invitations: [{ invitation_id: 'rr1', action: 'decline' }] }, { provider: true }),
  use('unipile-accounts', 'add_reaction', { chat_id: 'CLASSIC_1-CHAT', message_id: 'msg1', reaction: 'like' }, { own: false }),
  use('unipile-accounts', 'delete_message', { chat_id: 'CLASSIC_1-CHAT', message_id: 'msg1' }, { own: false }),
  use('unipile-accounts', 'delete_chat', { chat_id: 'CLASSIC_1-CHAT' }, { own: false }),
  use('unipile-accounts', 'disconnect', undefined, { own: false }),
  use('unipile-accounts', 'select_contract', { contract_id: 'c1' }, { own: false }),
  use('unipile-accounts', 'update_proxy', { proxy_mode: 'country', proxy_country: 'FR' }, { own: false }),
  use('unipile-accounts', 'une_action_ajoutee_plus_tard', undefined, { own: false }),
];

async function quotaRows(accountId: string): Promise<number> {
  const { count, error } = await admin().from('linkedin_action_log').select('id', { count: 'exact', head: true }).eq('account_id', accountId);
  if (error) throw new Error(`linkedin_action_log: ${error.message}`);
  return count ?? 0;
}

test.describe('Lecture des comptes de l’équipe', () => {
  test.describe.configure({ mode: 'serial' });

  test('@critical un collaborateur est refusé sur le compte d’un collègue pour chaque lecture, sans appel au prestataire', async () => {
    const t = await team();
    const token = await tokenOf(t.lea);
    for (const r of READS) {
      const before = (await mockCalls(t.accCamille)).length;
      expectRefused(r, await read(t, token, r, t.accCamille), 'Léa sur Camille');
      expect((await mockCalls(t.accCamille)).length, `${r.action} : aucun appel pour le compte de Camille`).toBe(before);
    }
    // Y compris le compte d’un administrateur et celui du propriétaire.
    for (const accountId of [t.accHugo, t.accOwner]) {
      for (const r of READS) expectRefused(r, await read(t, token, r, accountId), `Léa sur ${accountId}`);
      expect(await mockCalls(accountId), `aucun appel pour ${accountId}`).toEqual([]);
    }
  });

  test('@critical un collaborateur lit le compte qu’il a relié, le prestataire est appelé', async () => {
    const t = await team();
    const token = await tokenOf(t.lea);
    for (const r of READS) {
      const before = (await mockCalls(t.accLea)).length;
      expectServed(r, await read(t, token, r, t.accLea), 'Léa sur Léa');
      expect((await mockCalls(t.accLea)).length, `${r.action} : le prestataire est appelé pour son propre compte`).toBeGreaterThan(before);
    }
  });

  test('@critical un administrateur, un membre et le propriétaire lisent le compte d’un collègue comme avant', async () => {
    const t = await team();
    const readers: Array<[string, TestUser, string]> = [
      ['Hugo (administrateur) sur Camille', t.hugo, t.accCamille],
      ['propriétaire sur Camille', t.org.owner, t.accCamille],
      ['Camille (membre) sur Hugo', t.camille, t.accHugo],
      ['Hugo (administrateur) sur Léa', t.hugo, t.accLea],
    ];
    for (const [label, user, accountId] of readers) {
      const token = await tokenOf(user);
      for (const r of READS) expectServed(r, await read(t, token, r, accountId), label);
    }
  });

  test('@critical un collaborateur est refusé sur le compte d’un collègue pour toute autre action, sans appel au prestataire ni unité du plafond', async () => {
    const t = await team();
    const token = await tokenOf(t.lea);
    const quotaBefore = await quotaRows(t.accCamille);
    for (const u of USES) {
      const before = (await mockCalls(t.accCamille)).length;
      expectRefused(u, await read(t, token, u, t.accCamille), `Léa sur Camille (${u.label})`);
      expect((await mockCalls(t.accCamille)).length, `${u.label} : aucun appel pour le compte de Camille`).toBe(before);
    }
    expect(await quotaRows(t.accCamille), 'aucune unité du plafond LinkedIn de Camille consommée').toBe(quotaBefore);
    // Même refus pour le compte d’un administrateur et pour celui du propriétaire (un échantillon : get_parameters, recherche dans un projet, profil, invitations).
    for (const accountId of [t.accHugo, t.accOwner]) {
      for (const u of USES.filter((x) => ['get_parameters PROJECT', 'get_parameters LEAD_LIST', 'search dans un projet Recruiter', 'get_profile', 'handle_invitation_received', 'bulk_handle_invitations'].includes(x.label))) {
        expectRefused(u, await read(t, token, u, accountId), `Léa sur ${accountId} (${u.label})`);
      }
      expect(await mockCalls(accountId), `aucun appel pour ${accountId}`).toEqual([]);
      expect(await quotaRows(accountId), `aucune unité du plafond pour ${accountId}`).toBe(0);
    }
  });

  test('@critical un collaborateur se sert du compte qu’il a relié : le prestataire est appelé et la règle ne refuse rien', async () => {
    const t = await team();
    const token = await tokenOf(t.lea);
    for (const u of USES.filter((x) => x.own)) {
      const before = (await mockCalls(t.accLea)).length;
      const res = await read(t, token, u, t.accLea);
      const where = `Léa sur Léa (${u.label}) : ${JSON.stringify(res.body)}`;
      expect(res.body.errorType, where).not.toBe('ACCOUNT_NOT_YOURS');
      expect(res.body.error_code, where).not.toBe('account_not_yours');
      if (u.provider) {
        expect((await mockCalls(t.accLea)).length, `${u.label} : le prestataire est appelé pour son propre compte`).toBeGreaterThan(before);
        expect(res.status, where).toBe(200);
      }
    }
  });

  test('un administrateur, un membre et le propriétaire se servent du compte d’un collègue pour les paramètres de recherche, comme avant', async () => {
    const t = await team();
    const readers: Array<[string, TestUser, string]> = [
      ['Hugo (administrateur) sur Camille', t.hugo, t.accCamille],
      ['propriétaire sur Camille', t.org.owner, t.accCamille],
      ['Camille (membre) sur Hugo', t.camille, t.accHugo],
    ];
    const samples = USES.filter((x) => ['get_parameters PROJECT', 'get_parameters SAVED_SEARCH', 'get_parameters LEAD_LIST', 'search dans un projet Recruiter'].includes(x.label));
    for (const [label, user, accountId] of readers) {
      const token = await tokenOf(user);
      for (const u of samples) {
        const before = (await mockCalls(accountId)).length;
        const res = await read(t, token, u, accountId);
        expectServed(u, res, `${label} (${u.label})`);
        if (u.provider) expect((await mockCalls(accountId)).length, `${label} (${u.label}) : le prestataire est appelé`).toBeGreaterThan(before);
      }
    }
  });

  test('un appel interne (clé de service) n’est pas concerné et un compte d’une autre organisation reste refusé à tous', async () => {
    const t = await team();
    const internal = await postJson('/functions/v1/unipile-search', {
      action: 'get_chats', organization_id: t.org.orgId, account_id: t.accCamille,
    }, { Authorization: `Bearer ${E2E.serviceRoleKey}` });
    expect(internal.status, JSON.stringify(internal.body)).toBe(200);
    expect(internal.body.success).toBe(true);

    const other = await team();
    for (const user of [t.org.owner, t.hugo, t.lea]) {
      const token = await tokenOf(user);
      for (const r of READS) {
        const res = await read(t, token, r, other.accCamille);
        expect(res.status, `${r.fn}.${r.action} : ${JSON.stringify(res.body)}`).toBe(403);
        expect(res.body.success).toBe(false);
      }
    }
    expect(await mockCalls(other.accCamille), 'aucun appel pour le compte d’une autre organisation').toEqual([]);
  });

  test('la liste des comptes (action list) rend à un collaborateur les comptes de l’équipe, sans aucun contenu de conversation', async () => {
    const t = await team();
    const res = await callFunction('unipile-accounts', await tokenOf(t.lea), { action: 'list', organization_id: t.org.orgId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.success).toBe(true);
    const accounts = res.body.accounts as Array<Record<string, unknown>>;
    // Identité de compte seulement : nom affiché, état, licences. Ni conversation, ni message, ni invitation, ni solde.
    const allowed = new Set(['id', 'name', 'identifier', 'status', 'mapped', 'profile_picture_url', 'subscriptions', 'is_locked', 'reconnectable', 'initial_sync_status', 'licences_read']);
    for (const account of accounts) {
      for (const key of Object.keys(account)) expect(allowed.has(key), `clé inattendue dans la liste : ${key}`).toBe(true);
    }
  });

  test('plafond de requêtes de unipile-search : le refus est dit en français', async () => {
    const t = await team();
    const token = await tokenOf(t.hugo);
    // Sans compte la requête passe le plafond puis s’arrête à « Account ID requis » : seul le plafond est exercé.
    let limited: { status: number; body: Record<string, unknown> } | null = null;
    for (let attempt = 1; attempt <= 80 && !limited; attempt++) {
      const res = await callFunction('unipile-search', token, { action: 'get_chats', organization_id: t.org.orgId });
      if (res.status === 429) limited = res;
      else expect(res.status, `requête ${attempt} : ${JSON.stringify(res.body)}`).toBe(400);
    }
    expect(limited, 'le plafond de 60 requêtes par minute est atteint').not.toBeNull();
    expect(limited!.body.errorType).toBe('RATE_LIMIT');
    expect(limited!.body.error).toBe('Trop de demandes. Patientez quelques secondes.');
    expect(JSON.stringify(limited!.body)).not.toMatch(/rate limit/i);
  });
});

const mixedCase = (id: string) => id.split('').map((c, i) => (i % 2 ? c.toUpperCase() : c)).join('');

/** Écritures du même uuid que la base accepte, sans la forme canonique (un uuid sans lettre n'a pas de majuscules : écartées). */
function orgSpellings(orgId: string): Array<[string, string]> {
  const all: Array<[string, string]> = [
    ['majuscules', orgId.toUpperCase()],
    ['casse mêlée', mixedCase(orgId)],
    ['accolades', `{${orgId}}`],
    ['sans tirets', orgId.replaceAll('-', '')],
  ];
  return all.filter(([, value]) => value !== orgId);
}

/** Écritures que la base refuse (22P02) : jamais lues comme l'organisation. */
const orgPadded = (orgId: string): Array<[string, string]> => [
  ['espace avant', ` ${orgId}`],
  ['espace après', `${orgId} `],
  ['espaces et tabulation', `  ${orgId}\t`],
];

/** Un échantillon de chaque famille d'actions, assez court pour tenir sous le plafond de 60 requêtes par minute de unipile-search. */
const SPELLING_SAMPLE: Read[] = [
  ...READS.filter((r) => r.fn === 'unipile-accounts'),
  { fn: 'unipile-search', action: 'get_chats' },
  { fn: 'unipile-search', action: 'get_parameters', extra: { type: 'PROJECT', service: 'RECRUITER' } },
  { fn: 'unipile-search', action: 'send_message', extra: { chat_id: 'CLASSIC_1-CHAT', text: 'Bonjour' } },
  { fn: 'unipile-accounts', action: 'une_action_ajoutee_plus_tard' },
  { fn: 'unipile-accounts', action: 'disconnect' },
];

const readIn = (t: Team, orgId: string, token: string, r: Read, accountId: string) =>
  callFunction(r.fn, token, { action: r.action, organization_id: orgId, account_id: accountId, ...r.extra });

test.describe('Uuid de l’organisation écrit autrement', () => {
  test.describe.configure({ mode: 'serial' });

  test('@critical un collaborateur reste refusé sur le compte d’un collègue quelle que soit l’écriture de l’uuid de l’organisation, sans appel au prestataire ni unité du plafond', async () => {
    const t = await team();
    const token = await tokenOf(t.lea);
    const callsBefore = (await mockCalls(t.accCamille)).length;
    const quotaBefore = await quotaRows(t.accCamille);
    const spellings = orgSpellings(t.org.orgId);
    expect(spellings.length, 'au moins les accolades et l’absence de tirets').toBeGreaterThanOrEqual(2);
    for (const [label, orgId] of spellings) {
      // Cas de la revue : la reconnexion désigne le compte du collègue par reconnect_account_id seul.
      for (const body of [
        { action: 'connect_cookie', access_token: 'AQED', reconnect_account_id: t.accCamille },
        { action: 'connection_start', provider: 'linkedin', reconnect_account_id: t.accCamille },
      ]) {
        const res = await callFunction('unipile-accounts', token, { organization_id: orgId, ...body });
        expectRefused({ fn: 'unipile-accounts', action: body.action }, res, `${label} Léa sur Camille`);
      }
      for (const r of SPELLING_SAMPLE) expectRefused(r, await readIn(t, orgId, token, r, t.accCamille), `${label} Léa sur Camille`);
    }
    expect((await mockCalls(t.accCamille)).length, 'aucun appel pour le compte de Camille').toBe(callsBefore);
    expect(await quotaRows(t.accCamille), 'aucune unité du plafond LinkedIn de Camille consommée').toBe(quotaBefore);
  });

  test('@critical un collaborateur se sert du compte qu’il a relié, un administrateur de celui d’un collègue, quelle que soit l’écriture de l’uuid de l’organisation', async () => {
    const t = await team();
    const leaToken = await tokenOf(t.lea);
    const hugoToken = await tokenOf(t.hugo);
    for (const [label, orgId] of orgSpellings(t.org.orgId)) {
      for (const r of READS.filter((x) => x.fn === 'unipile-accounts' || x.action === 'get_chats')) {
        const before = (await mockCalls(t.accLea)).length;
        expectServed(r, await readIn(t, orgId, leaToken, r, t.accLea), `${label} Léa sur Léa`);
        expect((await mockCalls(t.accLea)).length, `${label} ${r.action} : le prestataire est appelé pour son propre compte`).toBeGreaterThan(before);
        const hugoBefore = (await mockCalls(t.accCamille)).length;
        expectServed(r, await readIn(t, orgId, hugoToken, r, t.accCamille), `${label} Hugo (administrateur) sur Camille`);
        expect((await mockCalls(t.accCamille)).length, `${label} ${r.action} : le prestataire est appelé`).toBeGreaterThan(hugoBefore);
      }
    }
  });

  test('un uuid d’organisation avec des espaces autour est refusé comme avant, pour un collaborateur comme pour un administrateur, sans rien lire ni écrire', async () => {
    const t = await team();
    const sample: Read[] = [
      { fn: 'unipile-accounts', action: 'inmail_balance' },
      { fn: 'unipile-accounts', action: 'une_action_ajoutee_plus_tard' },
      { fn: 'unipile-search', action: 'get_chats' },
    ];
    for (const user of [t.lea, t.hugo]) {
      const token = await tokenOf(user);
      for (const [label, orgId] of orgPadded(t.org.orgId)) {
        for (const r of sample) {
          for (const accountId of [t.accCamille, user === t.lea ? t.accLea : t.accHugo]) {
            const res = await readIn(t, orgId, token, r, accountId);
            const where = `${label} ${user.email} ${r.fn}.${r.action} : ${JSON.stringify(res.body)}`;
            expect(res.status, where).toBe(403);
            expect(res.body.success === true, where).toBe(false);
            expect(res.body.error_code, where).not.toBe('account_not_yours');
            expect(JSON.stringify(res.body), where).not.toMatch(/unipile/i);
          }
        }
        const reconnect = await callFunction('unipile-accounts', token, { organization_id: orgId, action: 'connect_cookie', access_token: 'AQED', reconnect_account_id: t.accCamille });
        expect(reconnect.status, `${label} connect_cookie : ${JSON.stringify(reconnect.body)}`).toBe(403);
      }
    }
    for (const accountId of [t.accCamille, t.accLea, t.accHugo]) expect(await mockCalls(accountId), `aucun appel pour ${accountId}`).toEqual([]);
  });
});

test.describe('Liste des comptes : compte que le prestataire ne renseigne pas', () => {
  test.describe.configure({ mode: 'serial' });

  test('@critical le dernier état connu est rendu tel quel quand le webhook a déjà dit la vérité (sans « à vérifier »), les états sans gravité gardent le marqueur', async () => {
    const org = await createOrg('agency', 'E2E liste non lue');
    const stored = ['CREDENTIALS', 'ERROR', 'PARTIAL', 'LOCKED', 'DEGRADED'] as const;
    const members: Array<readonly [(typeof stored)[number], TestUser]> = [];
    for (const status of stored) members.push([status, await addMember(org.orgId, 'member', `nl${status.toLowerCase()}`)] as const);
    cleanups.push(() => deleteOrg(org, members.map(([, member]) => member)));
    const readable = await seedLinkedInAccount(org.orgId, org.owner.userId, `acc_nl${rand()}`);
    const accounts: Record<string, string> = {};
    for (const [status, member] of members) {
      accounts[status] = await seedLinkedInAccount(org.orgId, member.userId, `acc_nl${status.toLowerCase()}${rand()}`);
      const { error } = await admin().from('member_linkedin_accounts').update({ account_status: status }).eq('linkedin_account_id', accounts[status]);
      if (error) throw new Error(error.message);
      // Le prestataire répond « trop de requêtes » pour la lecture de ce compte : il n'est pas lu, son dernier état est montré.
      await setMockMode(accounts[status], { error: { ops: ['getAccount'], methods: ['GET'], preset: 'rate_limited' } });
    }

    const res = await callFunction('unipile-accounts', await tokenOf(org.owner), { action: 'list', organization_id: org.orgId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.success).toBe(true);
    const byId = Object.fromEntries((res.body.accounts as Array<Record<string, unknown>>).map((a) => [String(a.id), a]));
    for (const status of ['CREDENTIALS', 'ERROR', 'PARTIAL', 'LOCKED']) {
      const entry = byId[accounts[status]];
      expect(entry, status).toBeTruthy();
      expect(entry.status, status).toBe(status);
      expect('unverified' in entry, `${status} : le webhook a dit la vérité, pas de marqueur « à vérifier » : ${JSON.stringify(entry)}`).toBe(false);
      expect(entry.reconnectable, `${status} : l’action Reconnecter suit l’état`).toBe(status !== 'LOCKED');
      expect(entry.licences_read, `${status} : le prestataire n’a pas répondu, aucune licence lue`).toBe(false);
    }
    expect(byId[accounts.DEGRADED], JSON.stringify(byId[accounts.DEGRADED])).toMatchObject({ status: 'DEGRADED', unverified: true, reconnectable: false, licences_read: false });
    expect(byId[readable], 'un compte lu ne porte pas le marqueur').toMatchObject({ status: 'OK', licences_read: true });
    expect('unverified' in byId[readable]).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/unipile/i);
  });

  test('@critical licences_read : vrai seulement quand les contrats du compte ont vraiment été lus dans cet appel (lus, appel en échec, PARTIAL lu, enregistré non lu, ancien identifiant)', async () => {
    const org = await createOrg('agency', 'E2E licences lues');
    const names = ['lu', 'sanscontrat', 'partiel', 'nonlu', 'ancien'] as const;
    const members: Array<readonly [(typeof names)[number], TestUser]> = [];
    for (const name of names) members.push([name, await addMember(org.orgId, 'member', `lr${name}`)] as const);
    cleanups.push(() => deleteOrg(org, members.map(([, member]) => member)));
    const ids: Record<string, string> = {};
    for (const [name, member] of members) {
      ids[name] = await seedLinkedInAccount(org.orgId, member.userId, name === 'ancien' ? `ancien${rand()}` : `acc_lr${name}${rand()}`);
    }
    // Lu avec ses contrats (offre Recruiter) : licences lues.
    await setMockMode(ids.lu, { licenses: ['classic', 'recruiter'] });
    // Compte lu, mais l’appel des contrats échoue : l’offre n’est pas lue.
    await setMockMode(ids.sanscontrat, { error: { ops: ['getAvailableContracts'], methods: ['GET'], status: 500 } });
    // PARTIAL réellement lu chez le prestataire : ses contrats sont lus.
    await setMockMode(ids.partiel, { status: 'partial', locked: false, licenses: ['classic', 'sales_navigator'] });
    // Enregistré CREDENTIALS, le prestataire ne répond pas : entrée construite sans lecture.
    {
      const { error } = await admin().from('member_linkedin_accounts').update({ account_status: 'CREDENTIALS' }).eq('linkedin_account_id', ids.nonlu);
      if (error) throw new Error(error.message);
    }
    await setMockMode(ids.nonlu, { error: { ops: ['getAccount'], methods: ['GET'], preset: 'rate_limited' } });

    const res = await callFunction('unipile-accounts', await tokenOf(org.owner), { action: 'list', organization_id: org.orgId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const byId = Object.fromEntries((res.body.accounts as Array<Record<string, unknown>>).map((a) => [String(a.id), a]));
    for (const name of names) expect(typeof byId[ids[name]]?.licences_read, `${name} : toujours un booléen`).toBe('boolean');

    expect(byId[ids.lu], JSON.stringify(byId[ids.lu])).toMatchObject({ status: 'OK', licences_read: true });
    expect((byId[ids.lu].subscriptions as Record<string, boolean>).recruiter, 'offre lue').toBe(true);

    expect(byId[ids.sanscontrat], JSON.stringify(byId[ids.sanscontrat])).toMatchObject({ status: 'OK', licences_read: false });
    // `subscriptions` reste présent (compatibilité) mais n'est qu'une estimation : c'est `licences_read` qui dit qu'elle n'est pas lue.
    expect((byId[ids.sanscontrat].subscriptions as Record<string, boolean>).classic).toBe(true);
    expect('unverified' in byId[ids.sanscontrat], 'le compte lui-même a été lu').toBe(false);

    expect(byId[ids.partiel], JSON.stringify(byId[ids.partiel])).toMatchObject({ status: 'PARTIAL', licences_read: true });
    expect((byId[ids.partiel].subscriptions as Record<string, boolean>).sales_navigator).toBe(true);

    expect(byId[ids.nonlu], JSON.stringify(byId[ids.nonlu])).toMatchObject({ status: 'CREDENTIALS', licences_read: false });
    expect(byId[ids.ancien], JSON.stringify(byId[ids.ancien])).toMatchObject({ status: 'CREDENTIALS', licences_read: false });
    expect(await mockCalls(ids.ancien), 'un ancien identifiant n’appelle pas le prestataire').toEqual([]);
    expect(JSON.stringify(res.body)).not.toMatch(/unipile/i);
  });
});

test.describe('Déconnexion WhatsApp : marque du geste voulu (removed_by_member)', () => {
  test.describe.configure({ mode: 'serial' });

  const accountsCall = (token: string, orgId: string, body: Record<string, unknown>) =>
    callFunction('unipile-accounts', token, { organization_id: orgId, ...body });

  /** Lien WhatsApp du membre en base, et compte WhatsApp correspondant dans le faux prestataire. */
  async function whatsapp(orgId: string, userId: string, name: string, mode: { missing?: boolean } = {}): Promise<string> {
    const id = `acc_wa${rand()}`;
    const { error } = await admin().from('member_whatsapp_accounts').insert({
      organization_id: orgId, user_id: userId, whatsapp_account_id: id, phone_number: '+33612345678', name, account_status: 'OK',
    });
    if (error) throw new Error(error.message);
    await setMockMode(id, { provider: 'whatsapp', name: '+33 6 12 34 56 78', ...mode });
    return id;
  }

  const rowOf = async (accountId: string) => {
    const { data, error } = await admin().from('member_whatsapp_accounts').select('account_status, removed_by_member_at').eq('whatsapp_account_id', accountId).single();
    if (error) throw new Error(error.message);
    return data as { account_status: string; removed_by_member_at: string | null };
  };

  const listed = async (token: string, orgId: string) => {
    const res = await accountsCall(token, orgId, { action: 'list_whatsapp' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.success, JSON.stringify(res.body)).toBe(true);
    return Object.fromEntries((res.body.accounts as Array<Record<string, unknown>>).map((a) => [String(a.id), a]));
  };

  test('@critical après « Déconnecter », list_whatsapp rend la pierre tombale avec removed_by_member vrai ; un compte disparu chez le prestataire, par la lecture ou par le webhook, reste faux', async () => {
    const org = await createOrg('agency', 'E2E marque WhatsApp');
    cleanups.push(() => deleteOrg(org));
    const token = await tokenOf(org.owner);
    const userId = org.owner.userId;
    const live = await whatsapp(org.orgId, userId, 'Actif');
    const vanished = await whatsapp(org.orgId, userId, 'Disparu', { missing: true });
    const removedByHook = await whatsapp(org.orgId, userId, 'Retiré par le prestataire');
    const bye = await whatsapp(org.orgId, userId, 'Quitté');

    let accounts = await listed(token, org.orgId);
    expect(accounts[live], JSON.stringify(accounts[live])).toMatchObject({ status: 'OK', removed_by_member: false });
    expect(accounts[bye], JSON.stringify(accounts[bye])).toMatchObject({ status: 'OK', removed_by_member: false });
    // Disparu chez le prestataire, vu par la lecture : DELETED sans marque.
    expect(accounts[vanished], JSON.stringify(accounts[vanished])).toMatchObject({ status: 'DELETED', removed_by_member: false });
    expect((await rowOf(vanished)).removed_by_member_at).toBeNull();

    // Geste voulu : la liaison reste en DELETED et porte la marque.
    const disconnected = await accountsCall(token, org.orgId, { action: 'disconnect_whatsapp', account_id: bye });
    expect(disconnected.status, JSON.stringify(disconnected.body)).toBe(200);
    expect(disconnected.body.success).toBe(true);
    const tombstone = await rowOf(bye);
    expect(tombstone.account_status).toBe('DELETED');
    expect(tombstone.removed_by_member_at, 'la marque du geste voulu est posée').not.toBeNull();

    // À chaque chargement, le même résultat, et la pierre tombale n’est pas relue chez le prestataire.
    const callsBefore = (await mockCalls(bye)).length;
    for (let load = 1; load <= 3; load++) {
      accounts = await listed(token, org.orgId);
      expect(accounts[bye], `chargement ${load}`).toMatchObject({ status: 'DELETED', removed_by_member: true });
      expect(accounts[vanished], `chargement ${load}`).toMatchObject({ status: 'DELETED', removed_by_member: false });
      expect(accounts[live], `chargement ${load}`).toMatchObject({ status: 'OK', removed_by_member: false });
    }
    expect((await mockCalls(bye)).length, 'la pierre tombale n’appelle pas le prestataire').toBe(callsBefore);

    // Compte retiré chez le prestataire (webhook account.remove) : DELETED sans marque.
    await webhook(v2.accountRemove(removedByHook));
    expect((await rowOf(removedByHook)).account_status).toBe('DELETED');
    expect((await rowOf(removedByHook)).removed_by_member_at, 'le webhook ne pose jamais la marque d’un geste voulu').toBeNull();
    accounts = await listed(token, org.orgId);
    expect(accounts[removedByHook], JSON.stringify(accounts[removedByHook])).toMatchObject({ status: 'DELETED', removed_by_member: false });
    expect(accounts[bye]).toMatchObject({ status: 'DELETED', removed_by_member: true });
  });

  test('« Déconnecter » sur un compte déjà disparu chez le prestataire pose la marque, et rien n’est visible du compte d’un collègue', async () => {
    const org = await createOrg('agency', 'E2E marque WhatsApp 2');
    const peer = await addMember(org.orgId, 'member', 'wapeer');
    cleanups.push(() => deleteOrg(org, [peer]));
    const token = await tokenOf(org.owner);
    const vanished = await whatsapp(org.orgId, org.owner.userId, 'Disparu', { missing: true });
    const colleague = await whatsapp(org.orgId, peer.userId, 'Collègue');

    expect((await listed(token, org.orgId))[vanished]).toMatchObject({ status: 'DELETED', removed_by_member: false });
    const removed = await accountsCall(token, org.orgId, { action: 'disconnect_whatsapp', account_id: vanished });
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    expect(removed.body.success).toBe(true);
    const accounts = await listed(token, org.orgId);
    expect(accounts[vanished]).toMatchObject({ status: 'DELETED', removed_by_member: true });
    expect(accounts[colleague], 'le compte d’un collègue n’est jamais listé').toBeUndefined();

    // Le compte d’un collègue ne se déconnecte pas, et sa ligne n’est pas marquée.
    const refused = await accountsCall(token, org.orgId, { action: 'disconnect_whatsapp', account_id: colleague });
    expect(refused.status, JSON.stringify(refused.body)).toBe(403);
    expect((await rowOf(colleague)).removed_by_member_at).toBeNull();
  });
});
