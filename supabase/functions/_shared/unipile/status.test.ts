// Statut de compte : correspondance fournisseur vers Konekt, envoi permis
// seulement en OK, et traitement distinct de la suppression d'un compte.
//
//   deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/_shared/unipile/status.test.ts

import { deepStrictEqual, strictEqual } from 'node:assert';
import { isReconnectable, isSendable, type KonektAccountStatus, mapAccountRemoved, mapAccountStatus } from './status.ts';

Deno.test('mapAccountStatus : les cinq statuts du fournisseur', () => {
  strictEqual(mapAccountStatus('running', false), 'OK');
  strictEqual(mapAccountStatus('disconnected', false), 'CREDENTIALS');
  strictEqual(mapAccountStatus('errored', false), 'ERROR');
  strictEqual(mapAccountStatus('degraded', false), 'DEGRADED');
  strictEqual(mapAccountStatus('partial', false), 'PARTIAL');
});

Deno.test('mapAccountStatus : is_locked gagne sur running, degraded, partial et errored', () => {
  for (const s of ['running', 'degraded', 'partial', 'errored']) {
    strictEqual(mapAccountStatus(s, true), 'LOCKED', s);
  }
});

Deno.test('mapAccountStatus : disconnected l’emporte sur is_locked (se reconnecter est le remède)', () => {
  strictEqual(mapAccountStatus('disconnected', true), 'CREDENTIALS');
});

Deno.test('mapAccountStatus : is_locked absent ou non booléen n’est pas un verrou', () => {
  strictEqual(mapAccountStatus('running'), 'OK');
  strictEqual(mapAccountStatus('running', undefined), 'OK');
  strictEqual(mapAccountStatus('running', null), 'OK');
  strictEqual(mapAccountStatus('running', 'true'), 'OK');
  strictEqual(mapAccountStatus('running', 1), 'OK');
});

Deno.test('mapAccountStatus : statut inconnu, absent ou mal formé donne ERROR, jamais OK', () => {
  for (const s of [undefined, null, '', '   ', 'paused', 'stopped', 'CONNECTING', 42, {}, [], 'unknown']) {
    strictEqual(mapAccountStatus(s, false), 'ERROR', String(s));
  }
});

Deno.test('mapAccountStatus : insensible à la casse du fournisseur, idempotent sur les valeurs Konekt', () => {
  strictEqual(mapAccountStatus(' Running '), 'OK');
  strictEqual(mapAccountStatus('DISCONNECTED'), 'CREDENTIALS');
  const konekt: KonektAccountStatus[] = ['OK', 'CREDENTIALS', 'ERROR', 'DEGRADED', 'PARTIAL', 'LOCKED'];
  for (const s of konekt) {
    const expected = s;
    strictEqual(mapAccountStatus(s, false), expected, s);
    strictEqual(mapAccountStatus(mapAccountStatus(s, false), false), expected, s);
  }
  // Une valeur déjà verrouillée ou en identifiants reste telle quelle.
  strictEqual(mapAccountStatus('LOCKED'), 'LOCKED');
  strictEqual(mapAccountStatus('CREDENTIALS', true), 'CREDENTIALS');
});

Deno.test('isSendable : OK seulement', () => {
  strictEqual(isSendable('OK'), true);
  for (const s of ['CREDENTIALS', 'ERROR', 'DEGRADED', 'PARTIAL', 'LOCKED', 'running', 'ok', '', null, undefined]) {
    strictEqual(isSendable(s), false, String(s));
  }
});

Deno.test('isReconnectable : CREDENTIALS, PARTIAL et ERROR ; pas DEGRADED, LOCKED ni OK', () => {
  for (const s of ['CREDENTIALS', 'PARTIAL', 'ERROR']) strictEqual(isReconnectable(s), true, s);
  for (const s of ['OK', 'DEGRADED', 'LOCKED', 'REMOVED', 'junk', null, undefined]) strictEqual(isReconnectable(s), false, String(s));
});

Deno.test('mapAccountRemoved : terminal, on délie et on arrête les envois, ce n’est pas une déconnexion récupérable', () => {
  deepStrictEqual(mapAccountRemoved(), { status: 'REMOVED', recoverable: false, unlink: true, stopSending: true });
  strictEqual(isSendable(mapAccountRemoved().status), false);
  strictEqual(isReconnectable(mapAccountRemoved().status), false);
});
