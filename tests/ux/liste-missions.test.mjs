/**
 * Liste des missions (/missions), design simplifié du 04/10/2026
 * (docs/design/06-simplicite.md) : phrases et dates de l'écran
 * (src/components/outreach/projects/missionListFormat.ts) et piles de visages
 * des candidats en entretien (useInterviewingPeople.ts), fonctions pures.
 *
 * - aucun zéro écrit : phrase des lignes, sous-titre de la page ;
 * - l'étape la plus avancée d'abord, accords au singulier et au pluriel ;
 * - activité : omise sous une heure (jamais « à l'instant » sur chaque ligne),
 *   « il y a 3 j » puis la date au-delà de 30 jours ;
 * - visages : trois au plus par mission, une personne une fois, la photo
 *   enregistrée sinon rien (jamais devinée), lignes illisibles ignorées.
 *
 * Modules empaquetés par esbuild, client Supabase et React Query remplacés par
 * des modules vides. Lancer : TZ=Europe/Paris node --test tests/ux/liste-missions.test.mjs
 */
process.env.TZ = 'Europe/Paris';

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT_PATH = fileURLToPath(new URL('../../', import.meta.url));

const stubs = {
  name: 'stubs',
  setup(b) {
    b.onResolve({ filter: /integrations\/supabase\/client$/ }, () => ({ path: 'client', namespace: 'stub' }));
    b.onResolve({ filter: /^(react|@tanstack\/react-query)$/ }, (args) => ({ path: args.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: ['export const supabase = {};', 'export const useMemo = (f) => f();', 'export const useQuery = () => ({});'].join('\n'),
      loader: 'js',
    }));
  },
};

const load = async (rel) => {
  const { outputFiles } = await build({
    entryPoints: [join(ROOT_PATH, rel)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    tsconfig: join(ROOT_PATH, 'tsconfig.app.json'),
    plugins: [stubs],
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
};

const { countsPhrase, missionsSentence, activityLabel, QUIET_ACTIVITY_MS } = await load('src/components/outreach/projects/missionListFormat.ts');
const { groupInterviewingPeople, INTERVIEWING_FACES_PER_MISSION } = await load('src/components/outreach/projects/useInterviewingPeople.ts');

const NBSP = ' ';
const zero = { toSort: 0, contacted: 0, replied: 0, interviewing: 0 };

test('phrase d\'une ligne : seulement ce qui n\'est pas nul, l\'étape la plus avancée d\'abord', () => {
  assert.equal(countsPhrase(zero), '');
  assert.equal(countsPhrase({ ...zero, interviewing: 2, replied: 1 }), '2 en entretien · 1 a répondu');
  assert.equal(countsPhrase({ toSort: 4, contacted: 3, replied: 2, interviewing: 1 }), '1 en entretien · 2 ont répondu · 3 contactés · 4 à trier');
  assert.equal(countsPhrase({ ...zero, contacted: 1 }), '1 contacté');
  for (const c of [zero, { ...zero, toSort: 3 }, { toSort: 1, contacted: 1, replied: 1, interviewing: 1 }]) {
    assert.doesNotMatch(countsPhrase(c), /(^|[^\d])0([^\d]|$)/, 'jamais de zéro');
  }
});

test('sous-titre de la page : une phrase, jamais « 0 à trier »', () => {
  assert.equal(missionsSentence(4, { ...zero, interviewing: 3 }), `4 missions en cours${NBSP}: 3 en entretien.`);
  assert.equal(missionsSentence(4, { toSort: 0, contacted: 0, replied: 1, interviewing: 3 }), `4 missions en cours${NBSP}: 3 en entretien, 1 a répondu.`);
  assert.equal(missionsSentence(1, zero), '1 mission en cours.');
  // Compteurs pas encore lus : le nombre de missions seulement, pas de zéros inventés.
  assert.equal(missionsSentence(2, null), '2 missions en cours.');
  // Aucune mission En cours : une phrase sans chiffre.
  assert.equal(missionsSentence(0, null), 'Aucune mission en cours.');
  assert.equal(missionsSentence(0, zero), 'Aucune mission en cours.');
  assert.doesNotMatch(missionsSentence(4, { ...zero, interviewing: 3 }), /[–—]/);
});

test('activité : omise sous une heure, discrète au-delà, la même source', () => {
  const now = new Date('2026-10-04T12:00:00Z');
  const ago = (ms) => new Date(now.getTime() - ms).toISOString();
  assert.equal(activityLabel(ago(0), now), null);
  assert.equal(activityLabel(ago(59 * 60_000), now), null, 'à l\'instant, il y a 59 min : rien');
  assert.equal(activityLabel(ago(QUIET_ACTIVITY_MS), now), `il y a 1${NBSP}h`);
  assert.equal(activityLabel(ago(3 * 86_400_000), now), `il y a 3${NBSP}j`);
  // Au-delà de 30 jours : la date, comme partout (timeAgo).
  assert.match(activityLabel(ago(60 * 86_400_000), now), /\d+ \p{L}+\.?/u);
  // Rien à dire : date absente, illisible ou dans le futur.
  assert.equal(activityLabel(null, now), null);
  assert.equal(activityLabel('', now), null);
  assert.equal(activityLabel('pas une date', now), null);
  assert.equal(activityLabel(new Date(now.getTime() + 86_400_000).toISOString(), now), null);
});

test('visages en entretien : trois au plus par mission, une personne une fois, la photo enregistrée seulement, l\'identifiant pour la copie', () => {
  const row = (project, candidate, name, picture, large) => ({
    project_id: project, candidate_id: candidate, candidate_name: name, picture, picture_large: large,
  });
  const out = groupInterviewingPeople([
    row('m1', 'c1', 'Camille Fontaine', 'https://img.example/c1.jpg', null),
    row('m1', 'c1', 'Camille Fontaine', 'https://img.example/c1.jpg', null),
    row('m1', 'c2', 'Hugo Lambert', null, 'https://img.example/h-large.jpg'),
    row('m1', 'c3', 'Inès Moreau', '', null),
    row('m1', 'c4', 'Théo Garnier', 'https://img.example/t.jpg', null),
    row('m2', 'c1', 'Camille Fontaine', null, null),
    { project_id: null, candidate_id: 'cx', candidate_name: 'Sans mission' },
    null,
    { project_id: 'm3', candidate_id: 'c9', candidate_name: '   ', picture: 42 },
  ]);
  assert.equal(INTERVIEWING_FACES_PER_MISSION, 3);
  assert.deepEqual(out.m1, [
    { name: 'Camille Fontaine', src: 'https://img.example/c1.jpg', candidateId: 'c1' },
    { name: 'Hugo Lambert', src: 'https://img.example/h-large.jpg', candidateId: 'c2' },
    { name: 'Inès Moreau', src: null, candidateId: 'c3' },
  ]);
  // La même personne dans une autre mission garde sa pile dans cette mission.
  assert.deepEqual(out.m2, [{ name: 'Camille Fontaine', src: null, candidateId: 'c1' }]);
  // Nom vide ou photo illisible : jamais inventés.
  assert.deepEqual(out.m3, [{ name: null, src: null, candidateId: 'c9' }]);
  assert.deepEqual(Object.keys(out).sort(), ['m1', 'm2', 'm3']);
  assert.deepEqual(groupInterviewingPeople(null), {});
  assert.deepEqual(groupInterviewingPeople({}), {});
});
