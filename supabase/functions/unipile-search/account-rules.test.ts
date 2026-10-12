// Règle de lecture des comptes de l'équipe (SEC-006, constat F9 de la visite du 12/10/2026) : un collaborateur ne lit
// que le compte qu'il a relié lui-même ; propriétaire, administrateur et membre lisent ceux de l'organisation ; un
// appel interne (clé de service) n'est pas concerné. Fonction pure, sans base ni prestataire.
//
//   deno test --no-check --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/unipile-search/account-rules.test.ts

import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import {
  COLLABORATOR_OWN_ACCOUNT_READS,
  collaboratorReadRefusal,
  isCollaboratorRole,
  ownerOnlyRefusal,
  type ReadRuleContext,
} from './account-rules.ts';

const base = { isInternal: false, userId: 'u1' };
const colleagueOf = (role: string | null | undefined): ReadRuleContext => ({ ...base, accountOwnerId: 'u2', role });
const ownOf = (role: string | null | undefined): ReadRuleContext => ({ ...base, accountOwnerId: 'u1', role });

Deno.test('lectures du compte : la liste fermée des actions qui rendent le contenu ou les données du compte', () => {
  deepStrictEqual(
    [...COLLABORATOR_OWN_ACCOUNT_READS].sort(),
    ['get_chats', 'get_messages', 'list_recruiter_projects', 'list_sent_invitations', 'sync_chat_history'],
  );
});

Deno.test('rôles : seuls propriétaire, administrateur et membre lisent l équipe, tout le reste est collaborateur (échec fermé)', () => {
  for (const role of ['owner', 'admin', 'member', 'OWNER', ' admin ']) ok(!isCollaboratorRole(role), role);
  for (const role of ['collaborator', '', null, undefined, 'viewer', 'superadmin']) ok(isCollaboratorRole(role), String(role));
});

Deno.test('collaborateur : refusé sur le compte d un collègue pour chaque lecture, en 403 ACCOUNT_NOT_YOURS sans nom de prestataire', () => {
  for (const action of COLLABORATOR_OWN_ACCOUNT_READS) {
    const refusal = collaboratorReadRefusal(action, colleagueOf('collaborator'))!;
    ok(refusal, action);
    strictEqual(refusal.status, 403, action);
    strictEqual(refusal.body.success, false);
    strictEqual(refusal.body.errorType, 'ACCOUNT_NOT_YOURS');
    strictEqual(
      refusal.body.error,
      "Ce compte LinkedIn est relié par un autre membre de l'organisation. Vous ne pouvez consulter que votre propre compte.",
    );
    ok(!/unipile/i.test(JSON.stringify(refusal.body)));
    ok(!JSON.stringify(refusal.body).includes('\u2014'), 'pas de tiret cadratin');
  }
});

Deno.test('collaborateur : autorisé sur le compte qu il a relié', () => {
  for (const action of COLLABORATOR_OWN_ACCOUNT_READS) {
    strictEqual(collaboratorReadRefusal(action, ownOf('collaborator')), null, action);
  }
});

Deno.test('collaborateur : un compte relié à personne ou un rôle illisible est refusé, jamais ouvert', () => {
  for (const action of COLLABORATOR_OWN_ACCOUNT_READS) {
    ok(collaboratorReadRefusal(action, { ...base, accountOwnerId: null, role: 'collaborator' }), `${action} compte sans titulaire`);
    ok(collaboratorReadRefusal(action, colleagueOf(null)), `${action} rôle absent`);
    ok(collaboratorReadRefusal(action, colleagueOf('viewer')), `${action} rôle inconnu`);
    // Un utilisateur vide ne ressemble jamais au titulaire d un compte vide.
    ok(collaboratorReadRefusal(action, { isInternal: false, userId: '', accountOwnerId: '', role: 'collaborator' }), `${action} utilisateur vide`);
  }
});

Deno.test('propriétaire, administrateur et membre : lisent le compte d un collègue comme avant', () => {
  for (const role of ['owner', 'admin', 'member']) {
    for (const action of COLLABORATOR_OWN_ACCOUNT_READS) {
      strictEqual(collaboratorReadRefusal(action, colleagueOf(role)), null, `${role} ${action}`);
    }
  }
});

Deno.test('appel interne (clé de service) : jamais concerné, même sur le compte d un collègue', () => {
  for (const action of COLLABORATOR_OWN_ACCOUNT_READS) {
    strictEqual(collaboratorReadRefusal(action, { isInternal: true, userId: '', accountOwnerId: 'u2', role: null }), null, action);
  }
});

Deno.test('autres actions : hors de la règle de lecture (recherche, profil, paramètres, écritures déjà réglées par ownerOnlyRefusal)', () => {
  for (const action of ['search', 'search_from_url', 'get_parameters', 'get_profile', 'get_user_posts', 'mark_as_read', 'endorse_skill', 'send_message', 'withdraw_invitation']) {
    strictEqual(collaboratorReadRefusal(action, colleagueOf('collaborator')), null, action);
  }
  // Les écritures gardent leur règle, quel que soit le rôle.
  for (const role of ['owner', 'admin', 'member', 'collaborator']) {
    strictEqual(ownerOnlyRefusal('send_message', colleagueOf(role))!.status, 403, role);
    strictEqual(ownerOnlyRefusal('withdraw_invitation', colleagueOf(role))!.status, 403, role);
  }
});
