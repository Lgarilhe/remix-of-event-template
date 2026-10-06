/**
 * Sourcing : le filtre d'expérience côté navigateur ne rejoue pas la tranche
 * que LinkedIn applique déjà (Recruiter et Sales Navigator, paramètre envoyé).
 * Sans cela, un profil senior ayant suivi une formation récente disparaissait
 * de la liste dès que l'on saisissait des années, et la recherche relançait
 * jusqu'à dix pages pour compenser.
 *
 * Lancer : node --test tests/ux/lot13-filtre-experience.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const source = readFileSync(new URL('src/hooks/useLinkedInSearchActions.ts', ROOT), 'utf8');

test('la deuxième passe est sautée quand LinkedIn a reçu la tranche', () => {
  const guard = source.match(/const linkedinFiltersExperience = ([\s\S]*?);\s*const filteredBatch = ([\s\S]*?);\n/);
  assert.ok(guard, 'garde linkedinFiltersExperience présente');
  const condition = guard[1];
  assert.match(condition, /!isDatabase/, 'jamais pour la Base Konekt, qui ne reçoit pas la tranche');
  assert.match(condition, /'recruiter'/);
  assert.match(condition, /'sales_navigator'/);
  assert.doesNotMatch(condition, /'classic'/, 'Classic n\'a pas de filtre serveur : la passe reste utile');
  assert.match(condition, /years_of_experience_min !== null/);
  assert.match(condition, /years_of_experience_max !== null/);
  assert.match(guard[2], /linkedinFiltersExperience\s*\?\s*batch/, 'le lot passe tel quel');
  assert.match(guard[2], /filterByCalculatedExperience\(/, 'le repli reste en place');
});

test('les années saisies sont envoyées à LinkedIn en Recruiter et Sales Navigator', () => {
  assert.match(source, /baseParams\.years_of_experience = yearsExp/);
  assert.match(source, /baseParams\.tenure = \[tenure\]/);
});
