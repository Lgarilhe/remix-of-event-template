/**
 * Lot P, P-0b : règles pures des adresses de photo (src/lib/pictureUrl.ts).
 *
 * Échéance lue dans le paramètre e=, adresses que la base accepterait comme
 * nouvelles, lots envoyés à refresh_candidate_pictures. Le module est compilé par
 * esbuild comme dans tests/ux/lot12-panneaux.test.mjs : ce fichier demande donc
 * les dépendances installées (job build de ci.yml), contrairement à
 * tests/ux/photos-candidats.test.mjs, qui reste sans dépendance.
 *
 * Lancer : node --test tests/ux/photos-adresses-fraiches.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = process.env.PHOTOS_ROOT || fileURLToPath(new URL('../../', import.meta.url));

async function loadTs(rel) {
  const { outputFiles } = await build({
    entryPoints: [join(ROOT, rel)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    tsconfig: join(ROOT, 'tsconfig.app.json'),
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
}

const NOW = Date.parse('2026-10-05T10:00:00Z');
const at = (ms) => `https://media.licdn.com/dms/image/v2/D4E03AQ/profile-displayphoto-shrink_100_100/0/1?e=${Math.floor(ms / 1000)}&v=beta&t=sig`;
const DAY = 24 * 60 * 60 * 1000;

test('pictureExpiryMs lit e=, rien sans e= valide', async () => {
  const P = await loadTs('src/lib/pictureUrl.ts');
  assert.equal(P.pictureExpiryMs('https://media.licdn.com/x?e=1999999999&v=beta'), 1999999999000);
  assert.equal(P.pictureExpiryMs('https://media.licdn.com/x?v=beta&e=1999999999'), 1999999999000);
  assert.equal(P.pictureExpiryMs('https://media.licdn.com/x?v=beta'), null);
  assert.equal(P.pictureExpiryMs('https://media.licdn.com/x?te=1999999999'), null);
  assert.equal(P.pictureExpiryMs('https://media.licdn.com/x?e=abc'), null);
  assert.equal(P.pictureExpiryMs(null), null);
  assert.equal(P.pictureExpiryMs(undefined), null);
});

test('isUsablePictureUrl : mêmes règles que candidate_picture_should_replace pour la nouvelle adresse', async () => {
  const P = await loadTs('src/lib/pictureUrl.ts');
  assert.equal(P.isUsablePictureUrl(at(NOW + 30 * DAY), NOW), true);
  assert.equal(P.isUsablePictureUrl('https://media.licdn.com/x?v=beta', NOW), true, 'sans échéance : acceptée');
  assert.equal(P.isUsablePictureUrl(at(NOW + 12 * 60 * 60 * 1000), NOW), false, 'échoit dans moins d\'un jour');
  assert.equal(P.isUsablePictureUrl(at(NOW - 5 * DAY), NOW), false, 'échue');
  for (const bad of [
    'http://media.licdn.com/x?e=1999999999',
    'https://evil.example/x?e=1999999999',
    'https://licdn.com.evil.example/x',
    'https://evil.example/licdn.com/x',
    'https://media.licdn.com@evil.example/x',
    'https://media.licdn.com:8443/x',
    'https://media.licdn.com/x y',
    `https://media.licdn.com/${'a'.repeat(2100)}`,
    '', null, undefined, 42, {},
  ]) {
    assert.equal(P.isUsablePictureUrl(bad, NOW), false, `refusée : ${String(bad).slice(0, 40)}`);
  }
});

test('pictureRefreshItems : adresses utilisables seulement, un candidat une fois', async () => {
  const P = await loadTs('src/lib/pictureUrl.ts');
  const fresh = at(NOW + 30 * DAY);
  const expired = at(NOW - 5 * DAY);
  const items = P.pictureRefreshItems([
    { id: 'a', linkedinProfileData: { profile_picture_url: fresh, profile_picture_url_large: fresh } },
    { id: 'a', linkedinProfileData: { profile_picture_url: 'https://media.licdn.com/autre?v=1' } },
    { id: 'b', linkedinProfileData: { profile_picture_url: expired, profile_picture_url_large: fresh } },
    { id: 'c', linkedinProfileData: { profile_picture_url: expired } },
    { id: 'd', linkedinProfileData: { name: 'sans photo' } },
    { id: 'e', linkedinProfileData: null },
    { id: 'f' },
    { id: '', linkedinProfileData: { profile_picture_url: fresh } },
  ], NOW);
  assert.deepEqual(items, [
    { candidate_id: 'a', picture: fresh, picture_large: fresh },
    { candidate_id: 'b', picture: null, picture_large: fresh },
  ]);
  assert.deepEqual(P.pictureRefreshItems([], NOW), []);
  assert.equal(P.PICTURE_REFRESH_BATCH, 200, 'le plafond de refresh_candidate_pictures');
});

