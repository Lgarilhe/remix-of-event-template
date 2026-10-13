/**
 * Connexion des comptes : interrupteur des écrans de connexion directe
 * (src/lib/connectionBeta.ts). Éteint par défaut ; il faut aussi que le serveur
 * annonce la connexion directe pour le canal.
 *
 * Lancer : node --test tests/ux/connexion-beta.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs, read, stripComments } from './connexion-helpers.mjs';

const beta = await loadTs('src/lib/connectionBeta.ts');
const memory = (initial = {}) => {
  const data = { ...initial };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
};

test('clé et paramètre du contrat, éteint par défaut', () => {
  assert.equal(beta.CONNECTION_NATIVE_STORAGE_KEY, 'konekt.connection-native');
  assert.equal(beta.CONNECTION_NATIVE_PARAM, 'connection-native');
  assert.equal(beta.CONNECTION_NATIVE_DEFAULT, false);
  assert.equal(beta.readConnectionNative(memory()), false);
});

test('lecture : 1 allume, 0 éteint, toute autre valeur donne la valeur par défaut', () => {
  const k = beta.CONNECTION_NATIVE_STORAGE_KEY;
  assert.equal(beta.readConnectionNative(memory({ [k]: '1' })), true);
  assert.equal(beta.readConnectionNative(memory({ [k]: '0' })), false);
  for (const v of ['', 'oui', 'true', '2']) assert.equal(beta.readConnectionNative(memory({ [k]: v })), false, v);
});

test('stockage absent ou qui refuse : la valeur par défaut, jamais d\'erreur', () => {
  assert.equal(beta.readConnectionNative(null), false);
  const throwing = { getItem() { throw new Error('bloqué'); }, setItem() { throw new Error('bloqué'); } };
  assert.equal(beta.readConnectionNative(throwing), false);
  assert.equal(beta.writeConnectionNative(true, throwing), false);
  assert.equal(beta.writeConnectionNative(true, null), false);
  const m = memory();
  assert.equal(beta.writeConnectionNative(true, m), true);
  assert.equal(m.data[beta.CONNECTION_NATIVE_STORAGE_KEY], '1');
  assert.equal(beta.writeConnectionNative(false, m), true);
  assert.equal(m.data[beta.CONNECTION_NATIVE_STORAGE_KEY], '0');
});

test('?connection-native=1|0 : lu, puis retiré en gardant les autres paramètres', () => {
  assert.equal(beta.connectionNativeParam('?connection-native=1'), true);
  assert.equal(beta.connectionNativeParam('?a=b&connection-native=0'), false);
  assert.equal(beta.connectionNativeParam('?connection-native=2'), null);
  assert.equal(beta.connectionNativeParam(''), null);
  assert.equal(beta.withoutConnectionNativeParam('?connection-native=1'), '');
  assert.equal(beta.withoutConnectionNativeParam('?a=b&connection-native=1&c=d'), '?a=b&c=d');
});

test('magasin : change l\'état pour la session et prévient les abonnés', () => {
  beta.resetConnectionNativeForTests();
  const seen = [];
  const off = beta.subscribeConnectionNative(() => seen.push(beta.getConnectionNative()));
  assert.equal(beta.getConnectionNative(), false);
  beta.setConnectionNative(true);
  beta.setConnectionNative(true);
  beta.setConnectionNative(false);
  off();
  assert.deepEqual(seen, [true, false], 'un changement identique ne prévient pas');
  beta.resetConnectionNativeForTests();
});

test('écrans directs : le serveur ET l\'interrupteur local, sinon la connexion standard', () => {
  assert.equal(beta.nativeScreensAllowed(true, true), true);
  assert.equal(beta.nativeScreensAllowed(true, false), false);
  assert.equal(beta.nativeScreensAllowed(false, true), false);
  assert.equal(beta.nativeScreensAllowed(null, true), false);
  assert.equal(beta.nativeScreensAllowed(undefined, true), false);
});

test('le hook applique la règle : capacité du fournisseur ET interrupteur local', () => {
  const hook = stripComments(read('src/hooks/useConnection.ts'));
  assert.match(hook, /nativeScreensAllowed\(nativeCapabilityOf\(capabilities, provider\), local\)/);
  assert.match(hook, /useSyncExternalStore\(subscribeConnectionNative, getConnectionNative, \(\) => CONNECTION_NATIVE_DEFAULT\)/);
  // Gmail et Outlook relèvent de la capacité « oauth », l'autre messagerie de « imap »
  assert.match(hook, /case 'imap': return capabilities\.native\.imap;/);
  assert.match(hook, /default: return capabilities\.native\.oauth;/);
});
