/**
 * Adresses envoyées à la mesure (SEC-043, audit du 01/09/2026).
 *
 * Certaines pages portent un jeton dans leur chemin (/client/:token,
 * /portal/:token, /mission-invite/:token), d'autres un identifiant de
 * candidat, de mission ou de séquence ; la requête et le fragment peuvent
 * porter un jeton (?token=…, #access_token=…). Aucun ne doit partir vers la
 * mesure.
 *
 *   1. analyticsPath, sur chaque route de App.tsx : paramètre remplacé par son
 *      nom, même quand sa valeur a la forme d'un mot ; route sans paramètre
 *      gardée telle quelle ; racine inconnue ramenée à « /autre ».
 *   2. analyticsUrl : origine et chemin réduit, sans requête ni fragment ;
 *      null quand l'adresse est illisible.
 *   3. trackEvent : l'adresse réduite part en `u` avec chaque envoi (pages
 *      vues comprises) ; rien ne part sans adresse lisible.
 *   4. loadAnalytics : variante manuelle du script par défaut ; un script
 *      automatique (VITE_PLAUSIBLE_SRC) n'est pas chargé.
 *   5. App.tsx envoie une page vue à chaque changement de chemin.
 *
 * Sur le code d'origine (script automatique, adresse entière), les fonctions
 * analyticsPath, analyticsUrl et isManualPlausibleScript n'existent pas et le
 * fichier échoue.
 *
 * Lancer : node --test tests/ux/mesures-adresses.test.mjs
 * UX_ROOT=<dossier> relit un autre arbre (ex. une extraction de HEAD).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = resolve(process.env.UX_ROOT || fileURLToPath(new URL('../../', import.meta.url)));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

/** Module analytics.ts transpilé, variables d'environnement Vite remplacées. */
async function loadModule(env = {}) {
  const define = { 'import.meta.env': JSON.stringify(env) };
  const { outputFiles } = await build({
    entryPoints: [join(ROOT, 'src/lib/analytics.ts')],
    bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent', define,
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
}

const analytics = await loadModule();
const { analyticsPath, analyticsUrl, isManualPlausibleScript, trackEvent, trackPageview } = analytics;

test.afterEach(() => {
  delete globalThis.window;
  delete globalThis.document;
});

// ─── 1. Chemins des routes de App.tsx ───────────────────────────────────────

// Source brute : « /* » d'une route à joker (/missions/:id/*) ouvrirait un faux commentaire.
const ROUTES = read('src/App.tsx').split('\n')
  .filter((line) => !/^\s*(\/\/|\{\/\*)/.test(line))
  .flatMap((line) => [...line.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]))
  .filter((p) => p !== '*');

test('routes — App.tsx lue (garde-fou du test)', () => {
  assert.ok(ROUTES.length >= 30, `seulement ${ROUTES.length} routes lues`);
  for (const route of ['/client/:token', '/portal/:token', '/mission-invite/:token', '/pipeline/scorecard/:candidateId']) {
    assert.ok(ROUTES.includes(route), `${route} absente de App.tsx`);
  }
});

// Valeurs les plus difficiles : un mot (ressemble à un segment fixe), un uuid,
// un identifiant de candidat LinkedIn, un jeton.
const SAMPLES = ['jean-dupont', 'c0ffee00-1111-2222-3333-444455556666', 'linkedin:jean-dupont', 'Xy7_q-9AbCdEf0123'];

test('routes — chaque paramètre est remplacé par son nom, quelle que soit sa valeur', () => {
  for (const route of ROUTES.filter((r) => r.includes(':'))) {
    for (const sample of SAMPLES) {
      const path = route.replace(/:[A-Za-z]+/g, encodeURIComponent(sample)).replace(/\/\*$/, '');
      const sent = analyticsPath(path);
      assert.ok(!sent.includes(encodeURIComponent(sample)) && !sent.includes(sample), `${route} avec « ${sample} » : ${sent}`);
      assert.equal(sent, route.replace(/\/\*$/, ''), `${route} : ${sent}`);
    }
  }
});

test('routes — une route sans paramètre est envoyée telle quelle', () => {
  for (const route of ROUTES.filter((r) => !r.includes(':'))) {
    const path = route.replace(/\/\*$/, '');
    assert.equal(analyticsPath(path), path, route);
  }
  assert.equal(analyticsPath('/sequences/nouvelle'), '/sequences/nouvelle');
  assert.equal(analyticsPath('/settings/account/connections'), '/settings/account/connections');
  assert.equal(analyticsPath('/missions/c0ffee00-1111-2222-3333-444455556666/sourcing'), '/missions/:id/sourcing');
});

test('routes — segment inattendu et racine inconnue ne partent jamais tels quels', () => {
  assert.equal(analyticsPath('/missions/abc/sourcing/c0ffee00-1111'), '/missions/:id/sourcing/:id');
  assert.equal(analyticsPath('/settings/Jean.Dupont@exemple.fr'), '/settings/:id');
  assert.equal(analyticsPath('/jean-dupont'), '/autre');
  assert.equal(analyticsPath('/CLIENT/Xy7_q-9AbCdEf0123'), '/autre');
  assert.equal(analyticsPath('//client//Xy7_q-9AbCdEf0123/'), '/client/:token');
  assert.equal(analyticsPath('/'), '/');
  assert.equal(analyticsPath(''), '/');
});

// ─── 2. Adresse complète ────────────────────────────────────────────────────

test('adresse — origine et chemin réduit, sans requête ni fragment', () => {
  assert.equal(analyticsUrl({ origin: 'https://app.exemple', pathname: '/client/Xy7_q-9AbCdEf0123', search: '?token=abc', hash: '#access_token=def' }), 'https://app.exemple/client/:token');
  assert.equal(analyticsUrl({ origin: 'http://localhost:8080', pathname: '/unsubscribe', search: '?token=abc' }), 'http://localhost:8080/unsubscribe');
  assert.equal(analyticsUrl(null), null);
  assert.equal(analyticsUrl({}), null);
  assert.equal(analyticsUrl({ origin: 'null', pathname: '/' }), null);
  assert.equal(analyticsUrl({ origin: 'https://app.exemple/client/abc', pathname: '/' }), null);
});

// ─── 3. Envois ──────────────────────────────────────────────────────────────

function fakeWindow(location) {
  const calls = [];
  globalThis.window = { location, plausible: (name, options) => { calls.push([name, options]); } };
  return calls;
}

test('envois — page vue et événement portent l’adresse réduite, jamais l’adresse entière', () => {
  const calls = fakeWindow({ origin: 'https://app.exemple', pathname: '/portal/Xy7_q-9AbCdEf0123', search: '?x=1', hash: '#y', href: 'https://app.exemple/portal/Xy7_q-9AbCdEf0123?x=1#y' });
  trackPageview();
  trackEvent('Stage Change', { stage: 'retained' });
  assert.deepEqual(calls, [
    ['pageview', { u: 'https://app.exemple/portal/:token' }],
    ['Stage Change', { u: 'https://app.exemple/portal/:token', props: { stage: 'retained' } }],
  ]);
});

test('envois — rien ne part quand l’adresse est illisible', () => {
  const calls = fakeWindow(undefined);
  trackPageview();
  trackEvent('Stage Change', { stage: 'retained' });
  assert.deepEqual(calls, []);
  globalThis.window = {};
  assert.doesNotThrow(() => trackPageview());
});

// ─── 4. Chargement du script ────────────────────────────────────────────────

test('script — seules les variantes manuelles sont admises', () => {
  for (const src of ['https://plausible.io/js/script.manual.js', '/js/script.manual.outbound-links.js', 'https://stats.exemple/js/script.outbound-links.manual.js']) {
    assert.equal(isManualPlausibleScript(src), true, src);
  }
  for (const src of ['https://plausible.io/js/script.js', 'https://plausible.io/js/script.outbound-links.js', 'https://plausible.io/js/manual.js', 'https://plausible.io/js/script.manual.js.map', 'https://plausible.io/js/pa-abc.js', '']) {
    assert.equal(isManualPlausibleScript(src), false, src);
  }
});

/** Fausse page : rend les scripts ajoutés à head. */
function fakeDocument() {
  const appended = [];
  globalThis.document = {
    querySelector: () => null,
    createElement: () => ({ setAttribute(name, value) { this[name] = value; } }),
    head: { appendChild: (el) => appended.push(el) },
  };
  globalThis.window = {};
  return appended;
}

test('script — par défaut, la variante manuelle est chargée', async () => {
  const mod = await loadModule({ VITE_PLAUSIBLE_DOMAIN: 'app.exemple' });
  const appended = fakeDocument();
  mod.loadAnalytics();
  assert.equal(appended.length, 1);
  assert.equal(appended[0].src, 'https://plausible.io/js/script.manual.js');
  assert.equal(appended[0]['data-domain'], 'app.exemple');
});

test('script — un script automatique n’est pas chargé', async () => {
  const mod = await loadModule({ VITE_PLAUSIBLE_DOMAIN: 'app.exemple', VITE_PLAUSIBLE_SRC: 'https://plausible.io/js/script.js' });
  const appended = fakeDocument();
  const warn = console.warn;
  console.warn = () => {};
  try { mod.loadAnalytics(); } finally { console.warn = warn; }
  assert.equal(appended.length, 0);
  assert.equal(globalThis.window.plausible, undefined);
});

test('script — sans domaine, rien n’est chargé', async () => {
  const mod = await loadModule({});
  const appended = fakeDocument();
  mod.loadAnalytics();
  assert.equal(appended.length, 0);
});

// ─── 5. Pages vues ──────────────────────────────────────────────────────────

test('App.tsx — une page vue à chaque changement de chemin', () => {
  const app = code(read('src/App.tsx'));
  assert.match(app, /useEffect\(\(\) => \{\s*trackPageview\(\);\s*\}, \[location\.pathname\]\);/);
});
