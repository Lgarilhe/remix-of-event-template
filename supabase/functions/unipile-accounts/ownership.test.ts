// Ownership rules of unipile-accounts: the organisation id and the account owner id are compared in one canonical
// form, whatever spelling Postgres accepts for a uuid (review-security, problem 3 of the second wave). Database stand-in
// only, no provider call.
//
//   deno test --no-check --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/unipile-accounts/ownership.test.ts

import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { FakeDb } from '../_shared/connection-claim.testing.ts';
import {
  ACCOUNT_NOT_YOURS_MESSAGE,
  assertAccountInOrg,
  assertCanManageAccount,
  assertCollaboratorUsesOwnAccount,
  assertOwnLinkedInAccount,
  canonicalUuid,
  HttpError,
  lookupAccountOwnership,
  sameId,
} from './ownership.ts';
import { parsePostgresUuid, postgresUuidDb } from './postgres-uuid.testing.ts';

// Ids with letters, so that upper case is not the same string.
const ORG = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
const OTHER_ORG = 'fedcba98-7654-4321-8fed-cba987654321';
const LEA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAMILLE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const mixed = (id: string) => id.split('').map((c, i) => (i % 2 ? c.toUpperCase() : c)).join('');

/** Spellings Postgres reads as the same uuid. */
const SPELLINGS: Array<[string, (id: string) => string]> = [
  ['canonique', (id) => id],
  ['majuscules', (id) => id.toUpperCase()],
  ['casse mêlée', mixed],
  ['accolades', (id) => `{${id}}`],
  ['sans tirets', (id) => id.replaceAll('-', '')],
  ['tiret tous les quatre chiffres', (id) => id.replaceAll('-', '').match(/.{4}/g)!.join('-')],
];

/** Padded or otherwise malformed: Postgres refuses them, so they must never be read as an organisation. */
const REFUSED_SPELLINGS: Array<[string, (id: string) => string]> = [
  ['espace avant', (id) => ` ${id}`],
  ['espace après', (id) => `${id} `],
  ['espaces et tabulation', (id) => `  ${id}\t`],
  ['saut de ligne', (id) => `${id}\n`],
  ['coupé', (id) => id.slice(0, -1)],
  ['allongé', (id) => `${id}0`],
  ['caractère étranger', (id) => `${id.slice(0, -1)}g`],
  ['accolade seule', (id) => `{${id}`],
];

function teamDb(): FakeDb {
  return new FakeDb({
    organization_members: [
      { id: 'mem-lea', organization_id: ORG, user_id: LEA, role: 'collaborator' },
      { id: 'mem-camille', organization_id: ORG, user_id: CAMILLE, role: 'member' },
    ],
    member_linkedin_accounts: [
      { id: 'l-lea', organization_id: ORG, user_id: LEA, linkedin_account_id: 'acc_lea' },
      { id: 'l-camille', organization_id: ORG, user_id: CAMILLE, linkedin_account_id: 'acc_camille' },
      { id: 'l-other', organization_id: OTHER_ORG, user_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', linkedin_account_id: 'acc_other' },
    ],
    member_email_accounts: [],
    member_whatsapp_accounts: [
      { id: 'w-camille', organization_id: ORG, user_id: CAMILLE, whatsapp_account_id: 'acc_wa_camille' },
    ],
  });
}

Deno.test('parsePostgresUuid (aide de test) : lit un uuid comme Postgres, y compris ce qu il refuse', () => {
  for (const [label, spell] of SPELLINGS) strictEqual(parsePostgresUuid(spell(ORG)), ORG, label);
  for (const [label, spell] of REFUSED_SPELLINGS) strictEqual(parsePostgresUuid(spell(ORG)), null, label);
  strictEqual(parsePostgresUuid(''), null);
});

Deno.test('canonicalUuid : toutes les écritures que la base accepte donnent la forme minuscule à tirets, le reste est rendu tel quel', () => {
  for (const [label, spell] of SPELLINGS) strictEqual(canonicalUuid(spell(ORG)), ORG, label);
  // Une écriture que la base refuse n est jamais « réparée » : elle reste refusée plus loin (rien n élargit l accès).
  for (const [label, spell] of REFUSED_SPELLINGS) strictEqual(canonicalUuid(spell(ORG)), spell(ORG), label);
  strictEqual(canonicalUuid(''), '');
  strictEqual(canonicalUuid('org-1'), 'org-1');
  strictEqual(canonicalUuid('ORG-1'), 'ORG-1', 'ce qui n est pas un uuid est rendu tel quel');
  // Accord avec la lecture de Postgres, sur chaque écriture.
  for (const [, spell] of [...SPELLINGS, ...REFUSED_SPELLINGS]) {
    const value = spell(OTHER_ORG);
    strictEqual(parsePostgresUuid(canonicalUuid(value)), parsePostgresUuid(value));
  }
});

Deno.test('sameId : deux écritures du même uuid sont le même identifiant, jamais un identifiant vide ou absent', () => {
  for (const [, spell] of SPELLINGS) {
    ok(sameId(spell(ORG), ORG));
    ok(sameId(ORG, spell(ORG)));
    ok(!sameId(spell(ORG), OTHER_ORG));
  }
  ok(!sameId(` ${ORG}`, ORG), 'une écriture que la base refuse n est pas le même identifiant');
  ok(!sameId(ORG, null));
  ok(!sameId(null, null));
  ok(!sameId(undefined, undefined));
  ok(!sameId('', ''), 'deux identifiants vides ne se ressemblent pas');
  ok(!sameId(ORG, 42 as unknown as string));
});

Deno.test('lookupAccountOwnership : l organisation est reconnue quelle que soit l écriture de son uuid, et l autre organisation reste étrangère', async () => {
  for (const [label, spell] of SPELLINGS) {
    const own = await lookupAccountOwnership(teamDb(), spell(ORG), 'acc_camille');
    deepStrictEqual(own, { mapped: 'org', userId: CAMILLE, kind: 'linkedin' }, label);
    const wa = await lookupAccountOwnership(teamDb(), spell(ORG), 'acc_wa_camille');
    deepStrictEqual(wa, { mapped: 'org', userId: CAMILLE, kind: 'whatsapp' }, label);
    deepStrictEqual(await lookupAccountOwnership(teamDb(), spell(ORG), 'acc_other'), { mapped: 'foreign', userId: null, kind: null }, `${label} : autre organisation`);
    deepStrictEqual(await lookupAccountOwnership(teamDb(), spell(ORG), 'acc_nobody'), { mapped: 'none', userId: null, kind: null }, `${label} : compte relié à personne`);
    deepStrictEqual(await lookupAccountOwnership(teamDb(), spell(OTHER_ORG), 'acc_camille'), { mapped: 'foreign', userId: null, kind: null }, `${label} : l organisation étrangère ne voit pas le compte`);
  }
  // Un identifiant de titulaire écrit autrement en base est rendu sous sa forme canonique.
  const db = teamDb();
  db.table('member_linkedin_accounts')[1].user_id = CAMILLE.toUpperCase();
  strictEqual((await lookupAccountOwnership(db, ORG, 'acc_camille')).userId, CAMILLE);
  // Une écriture refusée par la base ne rapproche rien.
  for (const [label, spell] of REFUSED_SPELLINGS) {
    deepStrictEqual(await lookupAccountOwnership(teamDb(), spell(ORG), 'acc_camille'), { mapped: 'foreign', userId: null, kind: null }, label);
  }
});

/** Le refus rendu par `run`, ou une erreur si rien n'a été refusé. */
async function refusalOf(run: () => Promise<unknown>, label: string): Promise<HttpError> {
  try {
    await run();
  } catch (e) {
    if (e instanceof HttpError) return e;
    throw e;
  }
  throw new Error(`${label} : aucun refus`);
}

Deno.test('assertCollaboratorUsesOwnAccount : un collaborateur est refusé sur le compte d un collègue quelle que soit l écriture de l organisation', async () => {
  for (const [label, spell] of SPELLINGS) {
    for (const key of ['account_id', 'reconnect_account_id']) {
      for (const account of ['acc_camille', 'acc_wa_camille']) {
        const where = `${label} ${key} ${account}`;
        const refusal = await refusalOf(() => assertCollaboratorUsesOwnAccount(teamDb(), spell(ORG), LEA, 'collaborator', { [key]: account }), where);
        strictEqual(refusal.status, 403, where);
        strictEqual(refusal.code, 'account_not_yours', where);
        strictEqual(refusal.message, ACCOUNT_NOT_YOURS_MESSAGE, where);
      }
    }
    // Son propre compte reste permis, y compris quand son identifiant est écrit autrement.
    await assertCollaboratorUsesOwnAccount(teamDb(), spell(ORG), LEA, 'collaborator', { account_id: 'acc_lea' });
    await assertCollaboratorUsesOwnAccount(teamDb(), spell(ORG), LEA.toUpperCase(), 'collaborator', { account_id: 'acc_lea' });
    // Propriétaire, administrateur, membre : jamais refusés par cette règle.
    for (const role of ['owner', 'admin', 'member']) {
      await assertCollaboratorUsesOwnAccount(teamDb(), spell(ORG), CAMILLE, role, { account_id: 'acc_camille', reconnect_account_id: 'acc_lea' });
    }
  }
  // Un rôle absent ou inconnu reste un collaborateur (échec fermé), pour toutes les écritures.
  for (const role of [null, undefined, '', 'viewer']) {
    const refusal = await refusalOf(() => assertCollaboratorUsesOwnAccount(teamDb(), ORG.toUpperCase(), LEA, role, { account_id: 'acc_camille' }), String(role));
    strictEqual(refusal.code, 'account_not_yours', String(role));
  }
});

Deno.test('assertAccountInOrg, assertOwnLinkedInAccount, assertCanManageAccount : l écriture de l organisation et du titulaire ne change aucun verdict', async () => {
  for (const [label, spell] of SPELLINGS) {
    const db = () => postgresUuidDb(teamDb());
    // Compte d un collègue, vu par un autre membre : rattaché à l organisation.
    const ownership = await assertAccountInOrg(db(), spell(ORG), LEA, 'acc_camille');
    deepStrictEqual(ownership, { mapped: 'org', userId: CAMILLE, kind: 'linkedin' }, label);
    // WhatsApp : seul son titulaire, quelle que soit l écriture de son identifiant.
    strictEqual((await assertAccountInOrg(db(), spell(ORG), CAMILLE, 'acc_wa_camille')).kind, 'whatsapp', label);
    strictEqual((await assertAccountInOrg(db(), spell(ORG), CAMILLE.toUpperCase(), 'acc_wa_camille')).kind, 'whatsapp', `${label} : titulaire écrit en majuscules`);
    await rejects(() => assertAccountInOrg(db(), spell(ORG), LEA, 'acc_wa_camille'), (e: unknown) => e instanceof HttpError && e.status === 403 && /autre membre/.test(e.message), label);
    // Autre organisation et compte relié à personne : refusés.
    await rejects(() => assertAccountInOrg(db(), spell(ORG), LEA, 'acc_other'), (e: unknown) => e instanceof HttpError && e.status === 403, `${label} : autre organisation`);
    // Gestes au nom de son propre compte LinkedIn.
    strictEqual((await assertOwnLinkedInAccount(db(), spell(ORG), LEA.toUpperCase(), 'acc_lea')).userId, LEA, label);
    await rejects(() => assertOwnLinkedInAccount(db(), spell(ORG), LEA, 'acc_camille'), (e: unknown) => e instanceof HttpError && e.status === 403, label);
    // Gérer un compte : son titulaire, quelle que soit l écriture de son identifiant ; un collaborateur, jamais celui d un autre.
    await assertCanManageAccount(db(), spell(ORG), CAMILLE.toUpperCase(), { mapped: 'org', userId: CAMILLE, kind: 'linkedin' });
    await assertCanManageAccount(db(), spell(ORG), CAMILLE, { mapped: 'org', userId: CAMILLE.toUpperCase(), kind: 'linkedin' });
    await rejects(() => assertCanManageAccount(db(), spell(ORG), LEA, { mapped: 'org', userId: CAMILLE, kind: 'linkedin' }), (e: unknown) => e instanceof HttpError && e.status === 403, label);
  }
});
