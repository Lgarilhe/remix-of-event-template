// Identifiants : compte v2 (acc_), pont depuis les anciens identifiants,
// identifiants de message (null, chaîne ou tableau), références d'utilisateur
// et de conversation.
//
//   deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/_shared/unipile/ids.test.ts

import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert';
import { isUnipileError } from './errors.ts';
import {
  accountPath,
  assertV2AccountId,
  buildAccountMap,
  chatPath,
  chatRef,
  isV2AccountId,
  normalizeEmail,
  normalizeMessageId,
  normalizeMessageIds,
  OutdatedAccountIdError,
  userRef,
  v1ToV2AccountId,
} from './ids.ts';

// ---------------------------------------------------------------------------
// Comptes
// ---------------------------------------------------------------------------

Deno.test('isV2AccountId : préfixe acc_ suivi d’au moins un caractère sûr', () => {
  for (const ok of ['acc_abc', 'acc_A1-b_2', 'acc_01HZX']) strictEqual(isV2AccountId(ok), true, ok);
  for (const bad of ['', 'acc_', 'ACC_x', 'xacc_x', 'abc123', 'acc_a b', 'acc_a/b', 'acc_a?b', 'acc_a#b', ' acc_a', null, undefined, 12, {}, ['acc_a']]) {
    strictEqual(isV2AccountId(bad), false, String(bad));
  }
});

Deno.test('assertV2AccountId : rend l’identifiant ou lève une erreur neutre sur un identifiant obsolète', () => {
  strictEqual(assertV2AccountId('acc_123'), 'acc_123');
  let thrown: unknown;
  try {
    assertV2AccountId('Y9sTx0q1R2uW3vZ4aB5cDe');
  } catch (e) {
    thrown = e;
  }
  ok(thrown instanceof OutdatedAccountIdError);
  ok(isUnipileError(thrown));
  strictEqual(thrown.kind, 'account_disconnected');
  strictEqual(thrown.code, 'outdated_account_id');
  ok(/reconnect/i.test(thrown.message));
  ok(!/unipile|v1|acc_/i.test(thrown.message), `message neutre : ${thrown.message}`);
  // L'identifiant fautif reste côté serveur.
  ok(thrown.debug.note?.includes('Y9sTx0q1R2uW3vZ4aB5cDe'));
  ok(!JSON.stringify(thrown).includes('Y9sTx0q1R2uW3vZ4aB5cDe'));
});

Deno.test('assertV2AccountId : valeur absente ou non textuelle est une erreur de validation', () => {
  for (const bad of [undefined, null, '', '  ', 42, {}]) {
    try {
      assertV2AccountId(bad);
      throw new Error('devait lever');
    } catch (e) {
      ok(e instanceof OutdatedAccountIdError, String(bad));
      strictEqual(e.kind, 'validation');
      strictEqual(e.code, 'missing_account_id');
    }
  }
});

const ACCOUNTS = [
  { id: 'acc_li1', provider: 'linkedin', name: 'Jeanne Martin', metadata: { v1_account_id: 'v1LinkedIn1' } },
  { id: 'acc_li2', provider: 'linkedin', name: 'Paul Durand', metadata: { v1_account_id: 'v1LinkedIn2', v1_instance_port: 1234 } },
  { id: 'acc_mail1', provider: 'google', name: 'Jeanne.Martin@Cabinet.fr', metadata: { v1_account_id: 'v1Mail1' } },
  { id: 'acc_mail2', provider: 'outlook', name: 'paul@cabinet.fr', metadata: {} },
  { id: 'acc_wa1', provider: 'whatsapp', name: '+33600000000', metadata: { custom_data: { a: 'b' } } },
  { id: 'acc_nometa', provider: 'linkedin' },
];

Deno.test('buildAccountMap : index des v1_account_id, des adresses de boîtes et des identifiants v2', () => {
  const map = buildAccountMap(ACCOUNTS);
  strictEqual(map.byV1Id.get('v1LinkedIn1'), 'acc_li1');
  strictEqual(map.byV1Id.get('v1LinkedIn2'), 'acc_li2');
  strictEqual(map.byV1Id.get('v1Mail1'), 'acc_mail1');
  strictEqual(map.byEmail.get('jeanne.martin@cabinet.fr'), 'acc_mail1');
  strictEqual(map.byEmail.get('paul@cabinet.fr'), 'acc_mail2');
  strictEqual(map.byEmail.size, 2, 'ni LinkedIn ni WhatsApp ne sont indexés par adresse');
  strictEqual(map.v2Ids.size, 6);
  ok(map.v2Ids.has('acc_nometa'));
});

Deno.test('buildAccountMap : entrées invalides ignorées sans exception', () => {
  const map = buildAccountMap([null, undefined, 'x', 3, [], {}, { id: 'old-id' }, { id: 'acc_ok', metadata: { v1_account_id: '' } }, { id: 'acc_ok2', metadata: 'oops' }]);
  strictEqual(map.v2Ids.size, 2);
  strictEqual(map.byV1Id.size, 0);
});

Deno.test('buildAccountMap : table d’adresses fournie en plus (Record ou Map), valeurs invalides écartées', () => {
  const fromRecord = buildAccountMap([], { emailToV2: { 'Boite@Cabinet.fr': 'acc_x', 'bad': 'acc_y', 'ok@x.fr': 'not-v2' } });
  strictEqual(fromRecord.byEmail.get('boite@cabinet.fr'), 'acc_x');
  strictEqual(fromRecord.byEmail.size, 1);
  const fromMap = buildAccountMap([], { emailToV2: new Map([['a@b.fr', 'acc_z']]) });
  strictEqual(fromMap.byEmail.get('a@b.fr'), 'acc_z');
});

Deno.test('v1ToV2AccountId : id déjà v2 inchangé, id v1 pont par v1_account_id, boîte par adresse, sinon null', () => {
  const map = buildAccountMap(ACCOUNTS);
  strictEqual(v1ToV2AccountId('acc_whatever', map), 'acc_whatever');
  strictEqual(v1ToV2AccountId('v1LinkedIn2', map), 'acc_li2');
  strictEqual(v1ToV2AccountId('  v1Mail1 ', map), 'acc_mail1');
  strictEqual(v1ToV2AccountId('unknownMailId', map, { email: ' PAUL@cabinet.fr ' }), 'acc_mail2');
  strictEqual(v1ToV2AccountId('v1LinkedIn1', map, { email: 'paul@cabinet.fr' }), 'acc_li1', 'l’identifiant prime sur l’adresse');
  strictEqual(v1ToV2AccountId('unknown', map), null);
  strictEqual(v1ToV2AccountId('unknown', map, { email: 'nobody@x.fr' }), null);
  strictEqual(v1ToV2AccountId('unknown', map, { email: 'not an email' }), null);
  for (const bad of [undefined, null, '', 12, {}]) strictEqual(v1ToV2AccountId(bad, map), null);
});

Deno.test('normalizeEmail', () => {
  strictEqual(normalizeEmail('  A@B.Fr '), 'a@b.fr');
  strictEqual(normalizeEmail('nope'), null);
  strictEqual(normalizeEmail(null), null);
});

Deno.test('accountPath : valide le compte et encode chaque segment', () => {
  strictEqual(accountPath('acc_1', 'chats', 'c1', 'messages'), '/acc_1/chats/c1/messages');
  strictEqual(accountPath('acc_1'), '/acc_1');
  strictEqual(accountPath('acc_1', 'users', 'a/b?c#d e'), '/acc_1/users/a%2Fb%3Fc%23d%20e');
  strictEqual(accountPath('acc_1', 'users', '../x'), '/acc_1/users/..%2Fx');
  throws(() => accountPath('v1id', 'chats'), OutdatedAccountIdError);
  throws(() => accountPath('acc_1', 'chats', ''), (e: unknown) => isUnipileError(e) && e.kind === 'validation');
});

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

Deno.test('normalizeMessageId / normalizeMessageIds : null, chaîne, tableau', () => {
  strictEqual(normalizeMessageId(null), null);
  strictEqual(normalizeMessageId(undefined), null);
  strictEqual(normalizeMessageId('m1'), 'm1');
  strictEqual(normalizeMessageId(['m1', 'm2']), 'm1');
  strictEqual(normalizeMessageId([]), null);
  strictEqual(normalizeMessageId(''), null);
  deepStrictEqual(normalizeMessageIds(null), []);
  deepStrictEqual(normalizeMessageIds('m1'), ['m1']);
  deepStrictEqual(normalizeMessageIds(['m1', 'm2', 'm1']), ['m1', 'm2']);
});

Deno.test('normalizeMessageIds : entrées non textuelles ou vides écartées', () => {
  deepStrictEqual(normalizeMessageIds(['', ' ', 'm1', null, 7, {}, ' m2 ']), ['m1', 'm2']);
  deepStrictEqual(normalizeMessageIds(42), []);
  deepStrictEqual(normalizeMessageIds({ id: 'm1' }), []);
  strictEqual(normalizeMessageId(['', 'm9']), 'm9');
});

// ---------------------------------------------------------------------------
// Utilisateurs
// ---------------------------------------------------------------------------

Deno.test('userRef : un identifiant public seul', () => {
  const ref = userRef('jeanne-martin-123');
  ok(ref);
  strictEqual(ref.primary, 'jeanne-martin-123');
  strictEqual(ref.slug, 'jeanne-martin-123');
  strictEqual(ref.providerId, null);
  deepStrictEqual(ref.candidates, [{ kind: 'slug', value: 'jeanne-martin-123' }]);
});

Deno.test('userRef : une URL de profil donne le slug, avec requête, barre finale et sans schéma', () => {
  for (const url of [
    'https://www.linkedin.com/in/jeanne-martin-123',
    'https://fr.linkedin.com/in/jeanne-martin-123/?originalSubdomain=fr',
    'http://linkedin.com/in/jeanne-martin-123#x',
    'linkedin.com/in/jeanne-martin-123/',
    'www.linkedin.com/in/jeanne-martin-123',
  ]) {
    strictEqual(userRef(url)?.primary, 'jeanne-martin-123', url);
  }
  strictEqual(userRef('https://www.linkedin.com/in/jos%C3%A9-garcia')?.primary, 'josé-garcia');
});

Deno.test('userRef : id fournisseur, URN et URL de piste Sales Navigator', () => {
  const id = 'ACoAABcdEfgHiJkLmNoPqRsTuVwXyZ01234567';
  strictEqual(userRef(id)?.providerId, id);
  strictEqual(userRef(id)?.slug, null);
  strictEqual(userRef(`urn:li:fsd_profile:${id}`)?.providerId, id);
  strictEqual(userRef('urn:li:member:123456')?.providerId, '123456');
  strictEqual(userRef(`https://www.linkedin.com/sales/lead/${id},NAME_SEARCH,xyz`)?.providerId, id);
  strictEqual(userRef('AEMAAB1234567890')?.providerId, 'AEMAAB1234567890');
  // Un id fourni comme « slug » est quand même un id.
  const mixed = userRef({ slug: id });
  strictEqual(mixed?.providerId, id);
  strictEqual(mixed?.slug, null);
});

Deno.test('userRef : ordre de repli documenté, slug d’abord puis identifiant fournisseur', () => {
  const id = 'ACoAABcdEfgHiJkLmN';
  const both = userRef({ slug: 'jeanne', providerId: id });
  ok(both);
  deepStrictEqual(both.candidates, [{ kind: 'slug', value: 'jeanne' }, { kind: 'provider_id', value: id }]);
  strictEqual(both.primary, 'jeanne');
  // Le slug tiré de l'URL complète les pièces manquantes.
  const fromUrl = userRef({ providerId: id, profileUrl: 'https://www.linkedin.com/in/jeanne' });
  deepStrictEqual(fromUrl?.candidates.map((c) => c.value), ['jeanne', id]);
  // Un slug explicite prime sur celui de l'URL.
  strictEqual(userRef({ slug: 'explicit', profileUrl: 'https://www.linkedin.com/in/other' })?.slug, 'explicit');
});

Deno.test('userRef : prefer provider_id inverse l’ordre, sans rien inventer', () => {
  const id = 'ACoAABcdEfgHiJkLmN';
  const ref = userRef({ slug: 'jeanne', providerId: id }, { prefer: 'provider_id' });
  strictEqual(ref?.primary, id);
  deepStrictEqual(ref?.candidates.map((c) => c.kind), ['provider_id', 'slug']);
  // Sans identifiant fournisseur, la préférence retombe sur le slug.
  strictEqual(userRef('jeanne', { prefer: 'provider_id' })?.primary, 'jeanne');
});

Deno.test('userRef : entrées inutilisables donnent null', () => {
  for (const bad of [
    '', '   ', null, undefined, {}, { slug: '' }, { slug: 'a/b' }, { slug: 'a b' }, { slug: 'a?b' },
    'https://www.linkedin.com/company/acme',
    'https://www.linkedin.com/in/',
    'https://example.com/in/jeanne',
    'https://evil.com/?u=linkedin.com/in/x',
    'https://www.linkedin.com/sales/lead/not-an-id,NAME',
  ]) {
    strictEqual(userRef(bad as string), null, JSON.stringify(bad));
  }
});

Deno.test('userRef : un slug ne contient jamais de séparateur de chemin', () => {
  const ref = userRef('https://www.linkedin.com/in/ab%2Fcd');
  strictEqual(ref, null);
});

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

Deno.test('chatRef : couple compte + conversation validé, chemin encodé', () => {
  const ref = chatRef('acc_1', ' chat-9 ');
  deepStrictEqual(ref, { accountId: 'acc_1', chatId: 'chat-9' });
  strictEqual(chatPath(ref), '/acc_1/chats/chat-9');
  strictEqual(chatPath(ref, 'messages'), '/acc_1/chats/chat-9/messages');
  strictEqual(chatPath(ref, 'messages', 'm/1'), '/acc_1/chats/chat-9/messages/m%2F1');
});

Deno.test('chatRef : ancien identifiant de compte et conversation inutilisable sont refusés', () => {
  throws(() => chatRef('v1id', 'chat-9'), OutdatedAccountIdError);
  for (const bad of [undefined, null, '', '  ', 'a/b', 'a b', 'a?b', 12]) {
    throws(() => chatRef('acc_1', bad), (e: unknown) => isUnipileError(e) && e.kind === 'validation' && e.code === 'invalid_chat_id', String(bad));
  }
});

Deno.test('buildAccountMap : une clé revendiquée par deux comptes est ambiguë et ne résout rien', () => {
  const map = buildAccountMap([
    { id: 'acc_A', provider: 'google', name: 'Shared@x.com', metadata: { v1_account_id: 'old' } },
    { id: 'acc_B', provider: 'google', name: 'shared@x.com', metadata: { v1_account_id: 'old' } },
    { id: 'acc_C', provider: 'google', name: 'solo@x.com', metadata: { v1_account_id: 'solo' } },
    // Le même compte listé deux fois n’est pas une collision.
    { id: 'acc_C', provider: 'google', name: 'solo@x.com', metadata: { v1_account_id: 'solo' } },
  ]);
  strictEqual(v1ToV2AccountId('old', map), null);
  strictEqual(v1ToV2AccountId('old', map, { email: 'shared@x.com' }), null);
  strictEqual(v1ToV2AccountId('unknown', map, { email: 'SHARED@x.com' }), null);
  ok(map.ambiguousV1Ids.has('old'));
  ok(map.ambiguousEmails.has('shared@x.com'));
  strictEqual(v1ToV2AccountId('solo', map), 'acc_C');
  strictEqual(v1ToV2AccountId('x', map, { email: 'solo@x.com' }), 'acc_C');
  // Une paire explicite lue pour l’organisation lève l’ambiguïté de la liste globale.
  const settled = buildAccountMap(
    [{ id: 'acc_A', provider: 'google', name: 'shared@x.com' }, { id: 'acc_B', provider: 'google', name: 'shared@x.com' }],
    { emailToV2: { 'shared@x.com': 'acc_B' } },
  );
  strictEqual(v1ToV2AccountId('x', settled, { email: 'shared@x.com' }), 'acc_B');
});

Deno.test('isV2AccountId : un identifiant ne peut pas porter un séparateur encodé', () => {
  for (const hostile of ['acc_x%2F..%2Fy', 'acc_a.b', 'acc_a%00', 'acc_', 'acc_é', 'acc_a:b']) {
    strictEqual(isV2AccountId(hostile), false, hostile);
    throws(() => accountPath(hostile, 'chats'), OutdatedAccountIdError, hostile);
  }
  strictEqual(isV2AccountId('acc_01kyex2j0pexzt3v8prstne0ey'), true);
  strictEqual(isV2AccountId('acc_AB-c_9'), true);
});
