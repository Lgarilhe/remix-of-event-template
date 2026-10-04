/**
 * Refonte mission, lot 3 : garde-fous statiques de la règle de la prochaine
 * action (src/lib/missionNextAction.ts) et des reports « Plus tard »
 * (src/lib/missionSnooze.ts).
 *
 * Même forme que lot12-mission-v3.test.mjs : lecture des sources et assertions
 * sur les motifs, sans navigateur, sans base, sans esbuild (Node 20).
 *  - les deux modules sont purs : aucun import, aucune horloge ni hasard, aucun
 *    accès au navigateur ;
 *  - la règle ne lit ni hasFeature ni effectivePlanId : la formule et les droits
 *    lui arrivent en états déjà lus ;
 *  - « Plus tard » ne touche jamais aux notifications ni à la barre latérale ;
 *  - textes : ni confirm natif, ni mesure d'usage, ni tiret long, ni « (s) »,
 *    ni nom de prestataire, ni mot interdit, jamais « Rien ne presse » ;
 *  - la CI joue les tests du lot.
 *
 * Lancer : node --test tests/c1/lot3-regle.test.mjs
 * C1_ROOT=<dossier> relit un autre arbre.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.C1_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const RULE = 'src/lib/missionNextAction.ts';
const SNOOZE = 'src/lib/missionSnooze.ts';
const PURE = [RULE, SNOOZE];

/** Code sans commentaires : blocs et fins de ligne (« https:// » reste). */
function stripComments(src) {
  return src
    .replace(/(^|[\s{(])\/\*[\s\S]*?\*\//g, '$1')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}
const code = (rel) => stripComments(read(rel));

// ─── Modules purs ───────────────────────────────────────────────────────────

test('lot 3 : les deux modules existent et sont purs, sans import hors plural.ts', () => {
  for (const rel of PURE) {
    assert.ok(existsSync(join(ROOT, rel)), `${rel} absent`);
    const src = code(rel);
    // Seule exception : plural.ts (sans dépendance), pour garder une seule fonction de pluriel dans src/ (D-71).
    const imports = src.match(/^\s*import\s.*$/gm) ?? [];
    const allowed = rel === RULE ? ["import { plural } from './plural';"] : [];
    assert.deepEqual(imports.map((l) => l.trim()), allowed, `${rel} : imports`);
    assert.doesNotMatch(src, /\bimport\s*\(/, `${rel} : import dynamique`);
    assert.doesNotMatch(src, /\brequire\s*\(/, `${rel} : require`);
    assert.doesNotMatch(src, /^\s*export\s+(\*|\{[^}]*\})\s+from\s/m, `${rel} : réexport`);
  }
  // Pas de seconde fonction de pluriel (D-71) : la règle importe celle de src/lib/plural.ts.
  assert.doesNotMatch(code(RULE), /const plural = \(|function plural\(/);
});

test('lot 3 : ni horloge, ni hasard, ni navigateur, ni stockage dans les modules purs', () => {
  for (const rel of PURE) {
    const src = code(rel);
    assert.doesNotMatch(src, /\bDate\.now\s*\(/, `${rel} : Date.now (l'heure est un paramètre)`);
    assert.doesNotMatch(src, /new Date\(\s*\)/, `${rel} : new Date() sans argument`);
    assert.doesNotMatch(src, /\bMath\.random\b/, `${rel} : Math.random`);
    assert.doesNotMatch(src, /\b(window|document|navigator|localStorage|sessionStorage)\b/, `${rel} : navigateur`);
    assert.doesNotMatch(src, /\b(fetch|supabase|invokeEdgeFunction)\b/, `${rel} : accès réseau`);
    assert.doesNotMatch(src, /\b(trackEvent|window\.confirm|confirm\()/, `${rel} : mesure ou confirm natif`);
  }
});

test('lot 3 : la règle ne lit ni hasFeature, ni effectivePlanId, ni le plan', () => {
  const src = code(RULE);
  assert.doesNotMatch(src, /\bhasFeature\b/);
  assert.doesNotMatch(src, /\bhasPlanFeature\b/);
  assert.doesNotMatch(src, /\beffectivePlanId\b/);
  assert.doesNotMatch(src, /\bplan_id\b|\bsubscription\b/i);
  // La formule arrive en état (SourceState), jamais un plan par défaut.
  assert.match(src, /sendAllowed: SourceState<boolean>/);
});

test('lot 3 : « Plus tard » ne touche jamais aux notifications ni à la barre latérale', () => {
  for (const rel of PURE) {
    const src = code(rel);
    assert.doesNotMatch(src, /notifications|markRead|markAllForYouRead|candidate_reminders|useSidebar|\['sidebar'/, `${rel}`);
  }
});

test('lot 3 : aucun appel de modèle d\'IA dans la règle', () => {
  for (const rel of PURE) {
    assert.doesNotMatch(code(rel), /ai-chat-completion|generate-|search-agent-chat|call-claude/, rel);
  }
});

// ─── API attendue par les écrans ────────────────────────────────────────────

test('lot 3 : API de la règle et des reports', () => {
  const rule = code(RULE);
  for (const name of [
    'computeNowCard', 'missionListAction', 'buildRowSignals', 'rowNextAction', 'parseAttentionRow',
    'sourceOf', 'sourceOk', 'linkedinSource', 'whenText', 'calendarDaysSince', 'buildMailto',
  ]) assert.match(rule, new RegExp(`export function ${name}\\b`), name);
  for (const name of ['REPLY_MAX_AGE_DAYS', 'INTERVIEW_WAIT_DAYS', 'THEN_MAX', 'RANK_RULES', 'RANK_ORDER', 'UNMONITORED_RANKS']) {
    assert.match(rule, new RegExp(`export const ${name}\\b`), name);
  }
  assert.match(rule, /export const REPLY_MAX_AGE_DAYS = 30;/);
  assert.match(rule, /export const INTERVIEW_WAIT_DAYS = 5;/);
  assert.match(rule, /export const THEN_MAX = 3;/);
  const snooze = code(SNOOZE);
  for (const name of ['snoozeKey', 'nextLocalMorning', 'isSnoozed', 'snoozeChecker']) {
    assert.match(snooze, new RegExp(`export function ${name}\\b`), name);
  }
  assert.match(snooze, /SNOOZE_END_HOUR = 6;/);
  // Le lendemain matin passe par le constructeur local (changement d'heure sans décalage), pas par un ajout de millisecondes.
  assert.match(snooze, /new Date\(d\.getFullYear\(\), d\.getMonth\(\), d\.getDate\(\) \+ 1, SNOOZE_END_HOUR/);
  assert.doesNotMatch(snooze, /86_?400_?000|24 \* 60 \* 60/);
});

test('lot 3 : le rang 0 n\'est jamais produit sur un état en chargement', () => {
  const src = code(RULE);
  // Une cause en chargement retient la carte (état « loading ») avant tout blocage.
  assert.match(src, /loadingNeeds\.length > 0/);
  assert.match(src, /loading = true;\s*break outer;/);
  // « Rien ne presse » n'existe pas dans le code : la carte dit « Rien d'autre à faire. ».
  assert.doesNotMatch(src, /Rien ne presse/);
  assert.match(src, /Rien d'autre à faire\./);
});

// ─── Textes ─────────────────────────────────────────────────────────────────

const VENDORS = /\b(Unipile|Apollo|PDL|People Data Labs|Anthropic|Claude|Resend|Brandfetch)\b/;
/** Tiret long (U+2014) et tiret demi-cadratin (U+2013). */
const DASHES = new RegExp(`${String.fromCharCode(0x2014)}|${String.fromCharCode(0x2013)}`);
const BANNED_WORDS = /\b(crucial\w*|essentiel\w*|robustes?|compl[eè]t\w*|puissan\w*|fluid\w*|explor\w*)\b/i;

test('lot 3 : textes des deux modules : ni tiret long, ni « (s) », ni prestataire, ni mot interdit', () => {
  for (const rel of PURE) {
    const src = read(rel);
    assert.doesNotMatch(src, DASHES, `${rel} : tiret long`);
    assert.doesNotMatch(src, /[A-Za-zÀ-ÿ]\(s\)/, `${rel} : « (s) » (accorder par plural)`);
    assert.doesNotMatch(src, VENDORS, `${rel} : nom de prestataire`);
    assert.doesNotMatch(src, BANNED_WORDS, `${rel} : mot interdit`);
    assert.doesNotMatch(src, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, `${rel} : emoji`);
    assert.doesNotMatch(src, /Rien ne presse/, `${rel} : « Rien ne presse »`);
  }
});

test('lot 3 : les tests du lot ne contiennent pas non plus de tiret long', () => {
  for (const rel of ['tests/ux/lot3-maintenant.test.mjs', 'tests/c1/lot3-regle.test.mjs']) {
    assert.ok(existsSync(join(ROOT, rel)), `${rel} absent`);
    assert.doesNotMatch(read(rel), DASHES, rel);
  }
  // Le test de comportement fixe son fuseau.
  assert.match(read('tests/ux/lot3-maintenant.test.mjs'), /process\.env\.TZ = 'Europe\/Paris';/);
});

// ─── CI ─────────────────────────────────────────────────────────────────────

test('lot 3 : la CI joue les tests du lot', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /node --test tests\/c1\/lot3-\*\.test\.mjs/);
  assert.match(ci, /node --test tests\/ux\/lot3-maintenant\.test\.mjs/);
  // Le test de comportement s'empaquette avec esbuild : job « build » (npm ci), fuseau posé.
  const build = ci.slice(ci.indexOf('  build:'));
  assert.match(build, /tests\/ux\/lot3-maintenant\.test\.mjs/);
  assert.match(build, /TZ: Europe\/Paris/);
  // Les gardes statiques tournent sans esbuild : job « agent-safety ».
  const safety = ci.slice(ci.indexOf('  agent-safety:'), ci.indexOf('  migrations:'));
  assert.match(safety, /tests\/c1\/lot3-\*\.test\.mjs/);
});
