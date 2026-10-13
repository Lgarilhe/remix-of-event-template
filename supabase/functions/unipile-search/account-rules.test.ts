// Règle d'usage des comptes de l'équipe (SEC-006, constat F9 de la visite du 12/10/2026, étendue à toute action) : un
// collaborateur ne se sert que du compte qu'il a relié lui-même, pour N'IMPORTE QUELLE action ; propriétaire,
// administrateur et membre se servent de ceux de l'organisation ; un appel interne (clé de service) n'est pas concerné.
// Fonction pure, sans base ni prestataire.
//
//   deno test --no-check --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/unipile-search/account-rules.test.ts

import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import {
  ACCOUNT_NOT_YOURS_MESSAGE,
  canonicalUuid,
  collaboratorOwnAccountRefusal,
  isCollaboratorRole,
  ownerOnlyRefusal,
  OWNER_ONLY_ACTIONS,
  type RoleRuleContext,
  sameId,
} from './account-rules.ts';
import { canonicalUuid as accountsCanonicalUuid, sameId as accountsSameId } from '../unipile-accounts/ownership.ts';

const base = { isInternal: false, userId: 'u1' };
const colleagueOf = (role: string | null | undefined): RoleRuleContext => ({ ...base, accountOwnerId: 'u2', role });
const ownOf = (role: string | null | undefined): RoleRuleContext => ({ ...base, accountOwnerId: 'u1', role });

// Toutes les actions de unipile-search, et deux noms qui n'existent pas (une action future, une action vide).
const ACTIONS = [
  'search', 'search_from_url', 'get_parameters', 'list_recruiter_projects', 'get_profile', 'get_user_posts',
  'get_chats', 'get_messages', 'sync_chat_history', 'mark_as_read', 'endorse_skill', 'list_sent_invitations',
  'send_message', 'withdraw_invitation', 'une_action_ajoutee_plus_tard', '',
];

Deno.test('rôles : seuls propriétaire, administrateur et membre utilisent les comptes de l équipe, tout le reste est collaborateur (échec fermé)', () => {
  for (const role of ['owner', 'admin', 'member', 'OWNER', ' admin ']) ok(!isCollaboratorRole(role), role);
  for (const role of ['collaborator', '', null, undefined, 'viewer', 'superadmin']) ok(isCollaboratorRole(role), String(role));
});

Deno.test('collaborateur : refusé sur le compte d un collègue, en 403 ACCOUNT_NOT_YOURS sans nom de prestataire, et la règle ne reçoit aucune action', () => {
  // La règle ne prend que le contexte : elle ne peut donc dépendre d aucune action (présente ou à venir).
  strictEqual(collaboratorOwnAccountRefusal.length, 1);
  const refusal = collaboratorOwnAccountRefusal(colleagueOf('collaborator'))!;
  ok(refusal);
  strictEqual(refusal.status, 403);
  strictEqual(refusal.body.success, false);
  strictEqual(refusal.body.errorType, 'ACCOUNT_NOT_YOURS');
  strictEqual(refusal.body.error, ACCOUNT_NOT_YOURS_MESSAGE);
  strictEqual(refusal.body.error, "Ce compte est relié par un autre membre de l'organisation. Vous ne pouvez utiliser que votre propre compte.");
  ok(!/unipile/i.test(JSON.stringify(refusal.body)));
  ok(!JSON.stringify(refusal.body).includes('\u2014'), 'pas de tiret cadratin');
  ok(!/LinkedIn/.test(String(refusal.body.error)), 'message valable pour tout type de compte');
});

Deno.test('collaborateur : autorisé sur le compte qu il a relié', () => {
  strictEqual(collaboratorOwnAccountRefusal(ownOf('collaborator')), null);
});

Deno.test('collaborateur : un compte relié à personne ou un rôle illisible est refusé, jamais ouvert', () => {
  ok(collaboratorOwnAccountRefusal({ ...base, accountOwnerId: null, role: 'collaborator' }), 'compte sans titulaire');
  ok(collaboratorOwnAccountRefusal(colleagueOf(null)), 'rôle absent');
  ok(collaboratorOwnAccountRefusal(colleagueOf(undefined)), 'rôle indéfini');
  ok(collaboratorOwnAccountRefusal(colleagueOf('viewer')), 'rôle inconnu');
  ok(collaboratorOwnAccountRefusal(ownOf(null)) === null, 'son propre compte reste permis même sans rôle lu');
  // Un utilisateur vide ne ressemble jamais au titulaire d un compte vide.
  ok(collaboratorOwnAccountRefusal({ isInternal: false, userId: '', accountOwnerId: '', role: 'collaborator' }), 'utilisateur vide');
  ok(collaboratorOwnAccountRefusal({ isInternal: false, userId: '', accountOwnerId: null, role: 'collaborator' }), 'utilisateur vide, compte sans titulaire');
});

Deno.test('propriétaire, administrateur et membre : se servent du compte d un collègue comme avant', () => {
  for (const role of ['owner', 'admin', 'member']) strictEqual(collaboratorOwnAccountRefusal(colleagueOf(role)), null, role);
});

Deno.test('appel interne (clé de service) : jamais concerné, même sur le compte d un collègue', () => {
  strictEqual(collaboratorOwnAccountRefusal({ isInternal: true, userId: '', accountOwnerId: 'u2', role: null }), null);
  strictEqual(collaboratorOwnAccountRefusal({ isInternal: true, userId: '', accountOwnerId: null, role: 'collaborator' }), null);
});

Deno.test('écritures au nom du compte : leur règle reste propre, quel que soit le rôle', () => {
  deepStrictEqual([...OWNER_ONLY_ACTIONS].sort(), ['send_message', 'withdraw_invitation']);
  for (const role of ['owner', 'admin', 'member', 'collaborator']) {
    strictEqual(ownerOnlyRefusal('send_message', colleagueOf(role))!.status, 403, role);
    strictEqual(ownerOnlyRefusal('withdraw_invitation', colleagueOf(role))!.status, 403, role);
    strictEqual(ownerOnlyRefusal('send_message', ownOf(role)), null, `${role} sur son compte`);
  }
  // Les autres actions n ont pas de règle « titulaire seulement » : seul le collaborateur est borné.
  for (const action of ACTIONS.filter((a) => !OWNER_ONLY_ACTIONS.has(a))) {
    strictEqual(ownerOnlyRefusal(action, colleagueOf('admin')), null, action);
    strictEqual(ownerOnlyRefusal(action, colleagueOf('collaborator')), null, action);
  }
});

Deno.test('le message de l écriture refusée garde son texte propre (envoyer, retirer une invitation)', () => {
  strictEqual(
    ownerOnlyRefusal('send_message', colleagueOf('collaborator'))!.body.error,
    "Ce compte LinkedIn est relié par un autre membre de l'organisation. Envoyez depuis votre propre compte.",
  );
  strictEqual(
    ownerOnlyRefusal('withdraw_invitation', colleagueOf('collaborator'))!.body.error,
    "Ce compte LinkedIn est relié par un autre membre de l'organisation. Retirez les invitations depuis votre propre compte.",
  );
});

// ---------------------------------------------------------------------------
// Identifiants : le même uuid écrit autrement est le même identifiant (revue de sécurité, problème 3 de la deuxième série)
// ---------------------------------------------------------------------------

const LEA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAMILLE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ORG = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
const mixed = (id: string) => id.split('').map((c, i) => (i % 2 ? c.toUpperCase() : c)).join('');
const SPELLINGS: Array<[string, (id: string) => string]> = [
  ['canonique', (id) => id],
  ['majuscules', (id) => id.toUpperCase()],
  ['casse mêlée', mixed],
  ['accolades', (id) => `{${id}}`],
  ['sans tirets', (id) => id.replaceAll('-', '')],
  ['tiret tous les quatre chiffres', (id) => id.replaceAll('-', '').match(/.{4}/g)!.join('-')],
];
// Écritures que la base refuse : rendues telles quelles, jamais prises pour l identifiant.
const REFUSED: Array<[string, (id: string) => string]> = [
  ['espace avant', (id) => ` ${id}`],
  ['espace après', (id) => `${id} `],
  ['saut de ligne', (id) => `${id}\n`],
  ['coupé', (id) => id.slice(0, -1)],
  ['accolade seule', (id) => `{${id}`],
];

Deno.test('canonicalUuid et sameId : toutes les écritures que la base accepte, rien de plus', () => {
  for (const [label, spell] of SPELLINGS) {
    strictEqual(canonicalUuid(spell(ORG)), ORG, label);
    ok(sameId(spell(ORG), ORG), label);
    ok(!sameId(spell(ORG), CAMILLE), label);
  }
  for (const [label, spell] of REFUSED) {
    strictEqual(canonicalUuid(spell(ORG)), spell(ORG), label);
    ok(!sameId(spell(ORG), ORG), label);
  }
  strictEqual(canonicalUuid('u1'), 'u1');
  ok(sameId('u1', 'u1'));
  ok(!sameId('', ''));
  ok(!sameId(null, null));
  ok(!sameId(LEA, null));
  ok(!sameId(undefined, undefined));
});

Deno.test('les deux copies de canonicalUuid et sameId (unipile-search et unipile-accounts) rendent les mêmes résultats', () => {
  const inputs = [
    ...[ORG, LEA, CAMILLE].flatMap((id) => [...SPELLINGS, ...REFUSED].map(([, spell]) => spell(id))),
    '', 'u1', 'U1', 'org-1', ' ', '{}', '{', 'g'.repeat(32), ORG.slice(0, 35), `${ORG}-`,
  ];
  for (const value of inputs) strictEqual(canonicalUuid(value), accountsCanonicalUuid(value), JSON.stringify(value));
  for (const a of inputs.slice(0, 40)) for (const b of inputs.slice(0, 40)) strictEqual(sameId(a, b), accountsSameId(a, b), `${JSON.stringify(a)} ${JSON.stringify(b)}`);
});

Deno.test('compte relié par le même membre : reconnu quelle que soit l écriture de son identifiant, pour la règle du collaborateur et celle des écritures', () => {
  for (const [label, spell] of SPELLINGS) {
    const own = { isInternal: false, userId: spell(LEA), accountOwnerId: LEA };
    strictEqual(collaboratorOwnAccountRefusal({ ...own, role: 'collaborator' }), null, `${label} : son compte, utilisateur écrit autrement`);
    strictEqual(collaboratorOwnAccountRefusal({ isInternal: false, userId: LEA, accountOwnerId: spell(LEA), role: 'collaborator' }), null, `${label} : son compte, titulaire écrit autrement`);
    for (const action of ['send_message', 'withdraw_invitation']) strictEqual(ownerOnlyRefusal(action, own), null, `${label} ${action}`);
    // Un autre membre reste un autre membre, quelle que soit l écriture.
    const colleague = { isInternal: false, userId: spell(LEA), accountOwnerId: spell(CAMILLE), role: 'collaborator' };
    strictEqual(collaboratorOwnAccountRefusal(colleague)?.status, 403, `${label} : collègue`);
    for (const action of ['send_message', 'withdraw_invitation']) strictEqual(ownerOnlyRefusal(action, colleague)?.status, 403, `${label} ${action} : collègue`);
  }
  // Une écriture que la base refuse n est pas le titulaire : jamais ouvert.
  for (const [label, spell] of REFUSED) {
    strictEqual(collaboratorOwnAccountRefusal({ isInternal: false, userId: spell(LEA), accountOwnerId: LEA, role: 'collaborator' })?.status, 403, label);
  }
});
