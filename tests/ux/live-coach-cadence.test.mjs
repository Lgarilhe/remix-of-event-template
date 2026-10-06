/**
 * Assistant d'entretien en direct : cadence des suggestions.
 *
 * Retour d'un test en entretien : les recommandations s'actualisaient trop
 * souvent, la personne était perdue. Causes dans le code : une pause de la voix
 * (1,5 s) lançait une analyse sans aucun délai minimal, toute phrase de plus de
 * 80 caractères aussi, et chaque réponse remplaçait le sujet affiché dès que son
 * intitulé changeait. Deux sources de transcription doublaient encore les pauses.
 *  - règles pures (src/lib/liveCoachCadence.ts) ;
 *  - gardes sur le panneau : toutes les analyses passent par les mêmes règles.
 * Lancer : node --test tests/ux/live-coach-cadence.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
/** Code sans commentaires : les commentaires citent parfois ce qui est proscrit. */
const code = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

async function load(contents) {
  const { outputFiles } = await build({
    stdin: { contents, resolveDir: ROOT, loader: 'ts' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    tsconfig: join(ROOT, 'tsconfig.app.json'),
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
}

const cadence = await load("export * from './src/lib/liveCoachCadence';");
const {
  COACH_MIN_INTERVAL_MS, COACH_MIN_NEW_CHARS, TOPIC_HOLD_MS, MAX_DIG_DEEPER,
  shouldAnalyze, shouldShowTopic, mergeDigDeeper, normalizeTopic,
} = cadence;

// ─── Quand analyser ───────────────────────────────────────────────────────

test('analyse : une première analyse part dès qu\'assez de texte est là, sans délai à attendre', () => {
  assert.equal(shouldAnalyze({ now: 1_000_000, lastCallAt: 0, pendingChars: COACH_MIN_NEW_CHARS }), true);
});

test('analyse : trop peu de texte neuf, rien ne part, même longtemps après la précédente', () => {
  assert.equal(shouldAnalyze({ now: 10_000_000, lastCallAt: 0, pendingChars: COACH_MIN_NEW_CHARS - 1 }), false);
  assert.equal(shouldAnalyze({ now: 10_000_000, lastCallAt: 0, pendingChars: 0 }), false);
});

test('analyse : délai minimal respecté, beaucoup de texte ou non', () => {
  const last = 500_000;
  assert.equal(shouldAnalyze({ now: last + COACH_MIN_INTERVAL_MS - 1, lastCallAt: last, pendingChars: 5000 }), false);
  assert.equal(shouldAnalyze({ now: last + COACH_MIN_INTERVAL_MS, lastCallAt: last, pendingChars: COACH_MIN_NEW_CHARS }), true);
});

test('analyse : le délai minimal est de l\'ordre de la lecture d\'un sujet, pas de quelques secondes', () => {
  assert.ok(COACH_MIN_INTERVAL_MS >= 20_000, 'au moins vingt secondes entre deux analyses');
  assert.ok(TOPIC_HOLD_MS >= COACH_MIN_INTERVAL_MS, 'un sujet reste affiché au moins autant que le délai entre deux analyses');
});

// ─── Sujet suivant ────────────────────────────────────────────────────────

test('sujet : le premier s\'affiche toujours', () => {
  assert.equal(shouldShowTopic(null, { topic: 'Parcours' }, 0, 0), true);
});

test('sujet : un sujet affiché depuis moins de TOPIC_HOLD_MS n\'est pas remplacé', () => {
  assert.equal(shouldShowTopic({ topic: 'Parcours' }, { topic: 'Management' }, 100_000, 100_000 + TOPIC_HOLD_MS - 1), false);
});

test('sujet : passé le délai de lecture, un sujet différent le remplace', () => {
  assert.equal(shouldShowTopic({ topic: 'Parcours' }, { topic: 'Management' }, 100_000, 100_000 + TOPIC_HOLD_MS), true);
});

test('sujet : le même sujet reformulé ne change jamais l\'écran, même longtemps après', () => {
  assert.equal(shouldShowTopic({ topic: 'Motivation & projet' }, { topic: 'motivation, projet !' }, 0, 10 * TOPIC_HOLD_MS), false);
  assert.equal(normalizeTopic('Motivation & projet'), normalizeTopic('motivation, projet !'));
});

// ─── Points à creuser ─────────────────────────────────────────────────────

test('points à creuser : sans doublon de signal, et jamais plus que MAX_DIG_DEEPER, les plus récents', () => {
  const item = (signal) => ({ signal, question: `Question sur ${signal}` });
  let list = [];
  list = mergeDigDeeper(list, [item('A'), item('B')]);
  list = mergeDigDeeper(list, [item('B'), item('C')]);
  assert.deepEqual(list.map((i) => i.signal), ['A', 'B', 'C']);
  list = mergeDigDeeper(list, [item('D'), item('E')]);
  assert.equal(list.length, MAX_DIG_DEEPER);
  assert.deepEqual(list.map((i) => i.signal), ['C', 'D', 'E']);
  assert.deepEqual(mergeDigDeeper(list, []).map((i) => i.signal), ['C', 'D', 'E'], 'rien de neuf, rien ne bouge');
});

// ─── Gardes sur le panneau ────────────────────────────────────────────────

const panel = code('src/components/ats/LiveCoachingPanel.tsx');

test('panneau : plus de seuil à 80 caractères ni d\'intervalle de 12 s propre au panneau', () => {
  assert.doesNotMatch(panel, /COACH_INTERVAL_MS|pendingLen > 80|pendingLen > 0/);
});

test('panneau : toute analyse déclenchée par la transcription passe par shouldAnalyze, pause de la voix comprise', () => {
  const messages = panel.slice(panel.indexOf('socket.onmessage = async'), panel.indexOf('socket.onerror = (err)'));
  assert.equal((messages.match(/shouldAnalyze\(/g) ?? []).length, 2, 'phrase finale et fin d\'énoncé');
  const utteranceEnd = messages.slice(messages.indexOf("data.type === 'UtteranceEnd'"));
  assert.match(utteranceEnd, /^data\.type === 'UtteranceEnd'\) \{\s*(?:\/\/[^\n]*\n\s*)?const now = Date\.now\(\);\s*if \(shouldAnalyze\(/);
  // L'analyse finale, à l'arrêt demandé, reste libre : c'est le dernier texte.
  const stop = panel.slice(panel.indexOf('const stopRecording = useCallback'), panel.indexOf('const generateReport = useCallback'));
  assert.doesNotMatch(stop, /shouldAnalyze/);
});

test('panneau : le sujet suivant passe par shouldShowTopic, l\'introduction par le même chemin d\'affichage', () => {
  assert.match(panel, /shouldShowTopic\(nextTopicRef\.current, d\.next_topic, topicShownAtRef\.current, Date\.now\(\)\)/);
  assert.match(panel, /const showTopic = useCallback\(\(topic: NextTopicItem\) => \{\s*nextTopicRef\.current = topic;\s*topicShownAtRef\.current = Date\.now\(\);\s*setNextTopic\(topic\);/);
  assert.match(panel, /showTopic\(\{\s*topic: 'Introduction'/);
  assert.equal((panel.match(/setNextTopic\(/g) ?? []).length, 1, 'un seul endroit change le sujet affiché');
});

test('panneau : les points à creuser sont fusionnés et limités par mergeDigDeeper', () => {
  assert.match(panel, /const next = mergeDigDeeper\(prev, d\.dig_deeper\);/);
});
