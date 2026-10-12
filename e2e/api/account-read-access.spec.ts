/**
 * Lecture des comptes LinkedIn de l'équipe (constat F9 de la visite du 12/10/2026), contre la stack locale
 * (e2e/local-stack), fonctions et faux prestataire pour de vrai.
 *
 * Règle (à confirmer par le propriétaire du produit) : un collaborateur ne lit que le compte qu'il a relié lui-même ;
 * propriétaire, administrateur et membre lisent ceux de l'organisation ; un appel interne (clé de service) n'est pas
 * concerné. Elle vaut pour toutes les lectures qui rendent le contenu ou les données d'un autre membre :
 *   unipile-search   : get_chats, get_messages, sync_chat_history, list_sent_invitations, list_recruiter_projects ;
 *   unipile-accounts : inmail_balance, list_contracts (et list_recruiter_contracts), get_account_details,
 *                      get_attendee_picture, list_invitations_received.
 * Un refus ne doit jamais atteindre le prestataire : on le prouve par le journal du faux prestataire, compte par compte.
 * La liste des comptes (action list) reste visible de toute l'équipe : le test ne garde que l'absence de contenu de conversation.
 *
 * Rôles : Hugo (administrateur), Camille (membre, compte relié), Léa (collaboratrice, compte relié), le propriétaire.
 *
 * @critical
 */
import { test, expect } from '@playwright/test';
import { E2E } from '../helpers/env';
import { addMember, createOrg, deleteOrg, seedLinkedInAccount, signIn, type TestOrg, type TestUser } from '../helpers/supabase-admin';
import { ENGINE_SKIP_REASON, callFunction, engineAvailable, mockCalls, postJson, rand } from '../helpers/sequence-engine';

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
    const allowed = new Set(['id', 'name', 'identifier', 'status', 'mapped', 'profile_picture_url', 'subscriptions', 'is_locked', 'reconnectable', 'initial_sync_status']);
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
