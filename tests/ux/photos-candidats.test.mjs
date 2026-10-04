/**
 * Photos des candidats : la notation garde la photo LinkedIn enregistrée.
 *
 * Avant ce correctif, serializeProfileForStorage omettait profile_picture_url :
 * chaque note réécrivait linkedin_profile_data sans la photo posée à la
 * découverte, et le candidat perdait sa photo partout où elle est relue.
 *
 * Même forme que tests/c1 : lecture du source et assertions sur les motifs,
 * sans navigateur ni base.
 *
 * Lancer : node --test tests/ux/photos-candidats.test.mjs
 * PHOTOS_ROOT=<dossier> relit un autre arbre (ex. une extraction de main) :
 * c'est ainsi qu'on vérifie que ces tests échouent sur le code d'origine.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.PHOTOS_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// Corps d'une fonction de premier niveau : de sa déclaration à la première
// accolade fermante en colonne 0.
function fnBody(src, signature) {
  const start = src.indexOf(signature);
  assert.ok(start >= 0, `${signature} introuvable`);
  const end = src.indexOf('\n}\n', start);
  assert.ok(end > start, `fin de ${signature} introuvable`);
  return src.slice(start, end);
}

// Corps d'un hook déclaré par `const nom = useCallback(` : jusqu'à la fin de
// son tableau de dépendances.
function callbackBody(src, name) {
  const start = src.indexOf(`const ${name} = useCallback(`);
  assert.ok(start >= 0, `${name} introuvable`);
  const end = src.indexOf('\n  }, [', start);
  assert.ok(end > start, `fin de ${name} introuvable`);
  return src.slice(start, end);
}

test('la notation enregistre la photo du candidat', () => {
  const body = fnBody(read('src/hooks/useLinkedInScoring.ts'), 'function serializeProfileForStorage(');
  assert.match(body, /profile_picture_url: profile\.profile_picture_url,/);
  assert.match(body, /profile_picture_url_large: profile\.profile_picture_url_large,/);
});

test('une note sans photo garde celle déjà enregistrée', () => {
  const src = read('src/hooks/useJobCandidateStatus.ts');
  const keep = fnBody(src, 'async function keepStoredPictures');
  // Lecture limitée à la ligne que l'upsert va réécrire (job_id, candidat, auteur).
  assert.match(keep, /\.eq\('job_id', jobId\)/);
  assert.match(keep, /\.eq\('created_by', userId\)/);
  assert.match(keep, /\.in\('candidate_id', /);
  assert.match(keep, /linkedin_profile_data->>profile_picture_url\b/);
  assert.match(keep, /linkedin_profile_data->>profile_picture_url_large\b/);
  // Seuls les profils notés sans photo sont relus ; un échec de lecture remonte.
  assert.match(keep, /!PICTURE_KEYS\.some\(/);
  assert.match(keep, /if \(error\) throw error;/);

  for (const name of ['saveScore', 'batchSaveScores']) {
    const body = callbackBody(src, name);
    const keepAt = body.indexOf('await keepStoredPictures(jobId, user.id, ');
    const upsertAt = body.indexOf('.upsert(');
    assert.ok(keepAt > 0 && keepAt < upsertAt, `${name} : photo reprise avant l'upsert`);
  }
  // La charge de saveScore écrit le profil complété, pas celui reçu.
  const single = callbackBody(src, 'saveScore');
  assert.match(single, /linkedin_profile_data: linkedinProfileData \|\| null,/);
  assert.doesNotMatch(single, /linkedin_profile_data: candidateData\.linkedinProfileData/);
});
