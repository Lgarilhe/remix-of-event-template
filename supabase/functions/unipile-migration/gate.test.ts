// Porte des administrateurs de la plateforme : fermée par défaut.
//
//   deno test --no-check --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/unipile-migration/gate.test.ts

import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { ADMIN_DENIED_MESSAGE, parseAdminList, platformAdminGate } from './gate.ts';

Deno.test('parseAdminList : virgules, espaces et vides', () => {
  deepStrictEqual(parseAdminList('a, b ,,c,'), ['a', 'b', 'c']);
  deepStrictEqual(parseAdminList(''), []);
  deepStrictEqual(parseAdminList('   '), []);
  deepStrictEqual(parseAdminList(undefined), []);
  deepStrictEqual(parseAdminList(null), []);
});

Deno.test('porte : liste absente ou vide = fermée, même pour un utilisateur connu', () => {
  for (const raw of [undefined, null, '', '  ,  ,']) {
    const result = platformAdminGate('u1', raw);
    ok(!result.ok);
    if (!result.ok) {
      strictEqual(result.status, 403);
      strictEqual(result.error, ADMIN_DENIED_MESSAGE);
      strictEqual(result.error_code, 'admin_only');
    }
  }
});

Deno.test('porte : utilisateur non listé, absent ou vide = fermée, avec le même message', () => {
  const messages = new Set<string>();
  for (const user of ['u3', null, undefined, '']) {
    const result = platformAdminGate(user, 'u1,u2');
    ok(!result.ok);
    if (!result.ok) messages.add(result.error);
  }
  strictEqual(messages.size, 1, 'le refus ne dit pas pourquoi');
  // Et le même message que pour une liste absente : rien n'indique si la liste existe.
  const noList = platformAdminGate('u1', undefined);
  ok(!noList.ok && messages.has(noList.error));
});

Deno.test('porte : utilisateur listé passe, l\'identifiant doit être exact', () => {
  ok(platformAdminGate('u2', 'u1, u2 ,u3').ok);
  ok(!platformAdminGate('u', 'u1,u2').ok);
  ok(!platformAdminGate('U1', 'u1').ok, 'sensible à la casse');
  ok(!platformAdminGate('u1 ', 'u1x').ok);
});

Deno.test('message de refus : français neutre, sans nom de prestataire', () => {
  ok(!/unipile/i.test(ADMIN_DENIED_MESSAGE));
  ok(!ADMIN_DENIED_MESSAGE.includes('—'));
});
