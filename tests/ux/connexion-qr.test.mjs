/**
 * Encodeur de QR code de l'assistant de connexion (src/components/connections/native/qr.ts).
 *
 * Les empreintes ci-dessous ont été calculées sur des matrices que jsQR, un
 * lecteur indépendant, a décodées en rendant exactement le texte d'origine
 * (octets UTF-8, versions 1, 2, 3 et plus). Elles figent le résultat : une
 * modification de l'encodeur qui change un module fait échouer le test, et se
 * revérifie avec un lecteur avant de mettre à jour l'empreinte.
 *
 * Lancer : node --test tests/ux/connexion-qr.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadTs } from './connexion-helpers.mjs';

const qr = await loadTs('src/components/connections/native/qr.ts');

const hashOf = (matrix) => createHash('sha256').update(matrix.map((r) => r.map((c) => (c ? '1' : '0')).join('')).join('\n')).digest('hex');
const WHATSAPP = '2@' + Array.from({ length: 178 }, (_, i) => 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789+/='[(i * 7 + 3) % 40]).join('');

const GOLDEN = [
  ['Konekt', 21, '6201034052f2cb837bfd87cb4d6d5c7eacc8ae579e71d058033fa23685eb99cb'],
  ['https://konekt-app-navy.vercel.app/settings', 29, '828c5edacdf5b4347cf5aae86a7485eb35db59c806dccc6de008a58e28399a6d'],
  [WHATSAPP, 49, 'fe730eb12ab954536abd2a6131b7b9736ba5b519f618037d8018c85a329a25b3'],
  ['Bonjour à tous, é î ü 日本語', 29, '06c4c78b686980d46a1990e211956c22d750a1c6bb18076ce0498d2a5a9ccc07'],
];

test('la matrice de textes types est celle qu\'un lecteur indépendant a décodée', () => {
  for (const [text, size, hash] of GOLDEN) {
    const matrix = qr.encodeQr(text);
    assert.equal(matrix.length, size, text.slice(0, 20));
    assert.equal(hashOf(matrix), hash, text.slice(0, 20));
  }
});

test('la taille suit la version : 21 modules en version 1, 4 de plus à chaque version', () => {
  assert.equal(qr.encodeQr('a').length, 21);
  assert.equal(qr.encodeQr('a'.repeat(17)).length, 21);
  assert.equal(qr.encodeQr('a'.repeat(18)).length, 25);
  assert.equal(qr.encodeQr('a'.repeat(2953)).length, 177);
});

test('capacités en octets du niveau L, versions 1 à 40', () => {
  const caps = Array.from({ length: 40 }, (_, i) => qr.byteCapacity(i + 1));
  assert.deepEqual(caps.slice(0, 10), [17, 32, 53, 78, 106, 134, 154, 192, 230, 271]);
  assert.equal(caps[39], 2953);
  assert.ok(caps.every((c, i) => i === 0 || c > caps[i - 1]));
});

test('un texte trop long est refusé, jamais tronqué', () => {
  assert.equal(qr.fitsInQr('a'.repeat(2953)), true);
  assert.equal(qr.fitsInQr('a'.repeat(2954)), false);
  assert.throws(() => qr.encodeQr('a'.repeat(2954)), RangeError);
});

test('les trois repères d\'angle et la ligne de synchronisation sont en place', () => {
  const m = qr.encodeQr('Konekt');
  const n = m.length;
  const finder = (x0, y0) => {
    for (let dy = 0; dy < 7; dy++) {
      for (let dx = 0; dx < 7; dx++) {
        const edge = dx === 0 || dx === 6 || dy === 0 || dy === 6;
        const core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
        assert.equal(m[y0 + dy][x0 + dx], edge || core, `repère ${x0},${y0} module ${dx},${dy}`);
      }
    }
  };
  finder(0, 0);
  finder(n - 7, 0);
  finder(0, n - 7);
  for (let i = 8; i < n - 8; i++) {
    assert.equal(m[6][i], i % 2 === 0, `synchronisation horizontale ${i}`);
    assert.equal(m[i][6], i % 2 === 0, `synchronisation verticale ${i}`);
  }
  assert.equal(m[n - 8][8], true, 'module sombre fixe');
});

test('le même texte donne toujours la même matrice', () => {
  assert.equal(hashOf(qr.encodeQr(WHATSAPP)), hashOf(qr.encodeQr(WHATSAPP)));
});
