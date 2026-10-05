/**
 * Fond animé de l'accueil et de la recherche hors mission (docs/design/01-direction.md, § 7,
 * décision du propriétaire du 05/10/2026).
 *  - PageLayout ne change pas sans l'option `backdrop` ;
 *  - le fond est décoratif (aria-hidden, sans clic), ne s'anime que par transform,
 *    et le mouvement réduit reste coupé globalement ;
 *  - seuls l'accueil et la recherche hors mission l'utilisent ;
 *  - cartes texturées (même décision) : fixes, sans changement du rendu par défaut des composants,
 *    et un seul emplacement texturé à la fois sur l'accueil (le blocage LinkedIn passe avant la
 *    zone « Aucune mission active »).
 *
 * Rendu statique de PageLayout et des panneaux de l'accueil empaquetés par esbuild (alias @/ résolus
 * par tsconfig.app.json), lecture des compteurs et client de la base remplacés par des modules vides.
 * Lancer : node --test tests/ux/fond-accueil.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const stubs = {
  name: 'stubs',
  setup(b) {
    b.onResolve({ filter: /(hooks\/useMissionStageCounts|integrations\/supabase\/client)$/ }, (args) => ({
      path: args.path,
      namespace: 'stub',
    }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: [
        'export const supabase = {};',
        'export const useMissionStageCounts = () => ({ data: undefined });',
      ].join('\n'),
      loader: 'js',
    }));
  },
};

const { outputFiles } = await build({
  stdin: {
    contents: [
      "export { PageLayout } from './src/components/layout/PageLayout';",
      "export { PageBackdrop } from './src/components/layout/PageBackdrop';",
      "export { texturedCard } from './src/components/layout/texturedCard';",
      "export { DashboardFocusPanel } from './src/components/dashboard/DashboardFocusPanel';",
      "export { DashboardMissionsPanel } from './src/components/dashboard/DashboardMissionsPanel';",
      "export { MemoryRouter } from 'react-router-dom';",
      "export { createElement } from 'react';",
      "export { renderToStaticMarkup } from 'react-dom/server.browser';",
    ].join('\n'),
    resolveDir: ROOT,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  loader: { '.webp': 'empty' },
  tsconfig: join(ROOT, 'tsconfig.app.json'),
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [stubs],
});
const kit = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const page = (props) => kit.renderToStaticMarkup(kit.createElement(kit.PageLayout, props, 'contenu'));
const render = (component, props) =>
  kit.renderToStaticMarkup(kit.createElement(kit.MemoryRouter, null, kit.createElement(component, props)));
const focus = (props) =>
  render(kit.DashboardFocusPanel, { unreadMessages: 0, pendingResponses: 0, stagnantCandidates: 0, ...props });

const css = read('src/index.css');
// Bloc du fond : de `.konekt-backdrop {` jusqu'à la fin de `.konekt-on-backdrop`.
const backdropCss = css.slice(css.indexOf('.konekt-backdrop {'), css.indexOf('.light .konekt-on-backdrop'));

test('PageLayout : sans l\'option backdrop, le rendu est celui d\'avant', () => {
  const html = page({ maxWidth: 'md' });
  assert.doesNotMatch(html, /konekt-backdrop|konekt-on-backdrop/);
  assert.match(html, /^<div class="flex-1 bg-background"><div class="py-6 pb-8">/);
});

test('PageLayout : avec backdrop, le fond est décoratif et placé avant le contenu', () => {
  const html = page({ maxWidth: 'md', backdrop: true });
  assert.match(html, /^<div class="flex-1 bg-background relative konekt-on-backdrop"><div aria-hidden="true" class="konekt-backdrop">/);
  assert.equal((html.match(/konekt-backdrop__blob--[abc]/g) || []).length, 3);
  assert.ok(html.indexOf('konekt-backdrop') < html.indexOf('contenu'), 'le fond précède le contenu');
  assert.match(html, /<div class="py-6 pb-8 relative">/, 'le contenu passe au-dessus du fond');
});

test('fond : aucun clic, transform seul, pas de flou, mouvement réduit toujours coupé', () => {
  assert.match(backdropCss, /\.konekt-backdrop \{[^}]*pointer-events: none/);
  assert.doesNotMatch(backdropCss, /blur\(/, 'un flou animé coûte une repeinture à chaque image');
  const keyframes = [...backdropCss.matchAll(/@keyframes konektBackdrop\w+ \{([\s\S]*?\n  \})/g)].map((m) => m[1]);
  assert.equal(keyframes.length, 3);
  for (const k of keyframes) {
    const props = [...k.matchAll(/([a-z-]+):\s/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(props)], ['transform']);
  }
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[^@]*animation-duration: 0\.01ms !important;[^@]*animation-iteration-count: 1 !important;/);
});

test('fond : thème clair dessiné à part, texte gris réglé pour la page qui le porte', () => {
  assert.match(css, /\.light \.konekt-backdrop \{[^}]*--backdrop-a:/);
  assert.match(css, /\.konekt-on-backdrop \{[^}]*--muted-foreground:[^}]*--k-text-muted: hsl\(var\(--muted-foreground\)\)/);
  assert.match(css, /\.light \.konekt-on-backdrop \{[^}]*--muted-foreground:/);
});

test('fond : seuls l\'accueil, la recherche hors mission et le héros du sourcing l\'utilisent', () => {
  const walk = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) return walk(abs);
      return /\.tsx?$/.test(name) ? [abs] : [];
    });
  const users = walk(join(ROOT, 'src'))
    .map((abs) => relative(ROOT, abs).split('\\').join('/'))
    .filter((rel) => /<PageBackdrop\b|<PageLayout\b[^>]*\bbackdrop\b/.test(read(rel)));
  assert.deepEqual(users.sort(), [
    'src/components/layout/PageLayout.tsx',
    'src/components/outreach/LinkedInSearch.tsx',
    'src/pages/Dashboard.tsx',
    'src/pages/SourcingSearches.tsx',
  ]);
  assert.match(read('src/pages/Dashboard.tsx'), /<PageLayout maxWidth="md" backdrop>/);
  const search = read('src/pages/SourcingSearches.tsx');
  assert.match(search, /<PageBackdrop follow \/>/, 'la souris fait pencher les taches sur la recherche');
  assert.match(search, /className="konekt-on-backdrop relative flex w-full/);
});

// ─── Cartes texturées ───────────────────────────────────────────────────────

const cardCss = css.slice(css.indexOf('.konekt-card-tex {'), css.indexOf('.konekt-card-tex--warm'));

test('carte texturée : fixe, texte clair dans les deux thèmes, survol qui assombrit', () => {
  assert.match(cardCss, /\.konekt-card-tex \{[^}]*--foreground: 0 0% 98%/);
  assert.match(cardCss, /--muted-foreground: 0 0% 88%/);
  assert.match(cardCss, /--accent: 0 0% 0% \/ 22%/, 'un survol blanc translucide faisait tomber le contraste sous 4,5:1');
  assert.match(cardCss, /--accent-foreground: 0 0% 98%/);
  assert.doesNotMatch(cardCss, /animation|@keyframes|blur\(/, 'la carte est fixe : le fond de page porte déjà le mouvement');
  assert.match(css, /\.konekt-card-tex--teal \{/);
  assert.match(css, /\.konekt-card-tex--warm \{/);
  assert.equal(kit.texturedCard('teal', 'x'), 'konekt-card-tex konekt-card-tex--teal x');
  assert.equal(kit.texturedCard('warm'), 'konekt-card-tex konekt-card-tex--warm');
});

test('accueil : le blocage LinkedIn est un bandeau texturé chaud au-dessus de la liste', () => {
  const html = focus({ linkedinIssue: true });
  assert.match(html, /^<div class="konekt-card-tex konekt-card-tex--warm /);
  assert.match(html, />Compte LinkedIn à reconnecter</);
  assert.match(html, /href="\/settings\/account\/connections">Reconnecter</);
  assert.doesNotMatch(html, /<ul|<li/, 'seul, le bandeau n\'ouvre pas de liste vide');

  const both = focus({ linkedinIssue: true, unreadMessages: 2 });
  assert.ok(both.indexOf('konekt-card-tex--warm') < both.indexOf('<ul '), 'le bandeau précède la liste');
  assert.match(both, /<ul class="[^"]*\bmt-3\b[^"]*"><li class="flex items-start gap-3\.5 py-4 sm:items-center">/);
  assert.equal((both.match(/konekt-card-tex/g) || []).length, 2, 'un seul bandeau (classe de base et teinte), aucune ligne texturée');

  // Sans blocage, aucune texture : le rendu des lignes est celui d'avant.
  assert.doesNotMatch(focus({ unreadMessages: 2 }), /konekt-card-tex/);
});

test('accueil : « Aucune mission active » ne se texture que si rien ne bloque', () => {
  const props = { projects: [] };
  const plain = render(kit.DashboardMissionsPanel, props);
  assert.doesNotMatch(plain, /konekt-card-tex/, 'rendu par défaut inchangé');
  assert.match(plain, /<a class="[^"]*\bmin-h-11\b[^"]*\bmd:min-h-0\b[^"]*" href="\/missions\?create=brief">/);

  const lit = render(kit.DashboardMissionsPanel, { ...props, highlightEmpty: true });
  assert.match(lit, /konekt-card-tex konekt-card-tex--teal/);
  assert.match(lit, />Aucune mission active</);
  assert.match(lit, /<a class="[^"]*\bbg-primary\b[^"]*" href="\/missions\?create=brief">/, 'bouton plein sur la carte');

  const dash = read('src/pages/Dashboard.tsx');
  assert.match(dash, /highlightEmpty=\{!connections\.isLoading && connections\.linkedin\.status !== 'error'\}/);
});

test('carte « Maintenant » : texturée seulement quand il y a une action, chaude pour un blocage', () => {
  const src = read('src/components/missions/v3/pipeline/NowCard.tsx');
  assert.match(src, /className=\{texturedCard\(main\.rank === '0' \? 'warm' : 'teal', ACTION_CARD\)\}/);
  assert.equal((src.match(/texturedCard\(/g) || []).length, 1, 'une seule carte texturée');
  // Chargement, « rien à faire » et « tout est reporté » gardent la bande grise.
  assert.match(src, /\{\(state === 'clear' \|\| state === 'all_snoozed'\) && \(\s*<div className=\{CARD\}>/);
  assert.match(src, /<div className=\{cn\(CARD, 'flex flex-col gap-3 sm:flex-row sm:items-center'\)\} aria-busy="true"/);
});

test('cartes texturées : seuls la carte « Maintenant », le bandeau LinkedIn et la zone sans mission les utilisent', () => {
  const walk = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) return walk(abs);
      return /\.tsx?$/.test(name) ? [abs] : [];
    });
  const users = walk(join(ROOT, 'src'))
    .map((abs) => relative(ROOT, abs).split('\\').join('/'))
    .filter((rel) => /\btexturedCard\(/.test(read(rel)) && !rel.endsWith('layout/texturedCard.ts'));
  assert.deepEqual(users.sort(), [
    'src/components/dashboard/DashboardFocusPanel.tsx',
    'src/components/dashboard/DashboardMissionsPanel.tsx',
    'src/components/missions/v3/pipeline/NowCard.tsx',
  ]);
});

// ─── Souris et écrans de sourcing ───────────────────────────────────────────

test('fond : la souris incline les taches par `translate`, sans éclaircir ni repeindre', () => {
  const html = kit.renderToStaticMarkup(kit.createElement(kit.PageBackdrop, { follow: true, contained: true }));
  assert.match(html, /^<div aria-hidden="true" class="konekt-backdrop konekt-backdrop--follow konekt-backdrop--contained">/);
  assert.doesNotMatch(kit.renderToStaticMarkup(kit.createElement(kit.PageBackdrop)), /--follow|--contained/, 'défaut inchangé');

  const followCss = css.slice(css.indexOf('.konekt-backdrop--follow .konekt-backdrop__blob {'), css.indexOf('@keyframes konektBackdropA'));
  assert.match(followCss, /translate: calc\(var\(--konekt-mx\) \* /);
  assert.match(css, /\.konekt-backdrop \{[^}]*--konekt-mx: 0;[^}]*--konekt-my: 0;/, 'déclarées par défaut : 0 au repos, le composant les écrase');
  assert.doesNotMatch(followCss, /transform:|filter|opacity|blur\(/, '`translate` se compose avec l\'animation, rien d\'autre ne bouge');
  assert.match(css, /\.konekt-backdrop--contained \{[^}]*mask-composite: intersect/);
});

test('fond : le suivi de souris ignore le toucher et le mouvement réduit, et se défait au démontage', () => {
  const src = read('src/components/layout/PageBackdrop.tsx');
  assert.match(src, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches\) return;/);
  assert.match(src, /e\.pointerType !== 'mouse'\) return;/);
  assert.match(src, /addEventListener\('pointermove', onMove, \{ passive: true \}\)/);
  assert.match(src, /removeEventListener\('pointermove', onMove\)/);
  assert.match(src, /cancelAnimationFrame\(frame\)/);
  assert.match(src, /requestAnimationFrame\(apply\)/, 'une écriture par image, pas par événement');
});

test('sourcing : fond au héros et au plan de la nouvelle page mission seulement, jamais sur les résultats', () => {
  const src = read('src/components/outreach/LinkedInSearch.tsx');
  assert.match(src, /const showBackdrop = isV3 && !!activeProject && \(flowMode === 'hero' \|\| flowMode === 'plan'\);/);
  assert.match(src, /\{showBackdrop && <PageBackdrop follow contained \/>\}/);
  assert.equal((src.match(/<PageBackdrop\b/g) || []).length, 1, 'un seul fond, posé une fois : pas de remise à zéro entre le héros et le plan');
  assert.match(src, /showBackdrop && 'relative konekt-on-backdrop'/);
  // L'accueil garde un fond fixe sous la souris : seul le sourcing et la recherche suivent le curseur.
  assert.match(read('src/components/layout/PageLayout.tsx'), /\{backdrop && <PageBackdrop \/>\}/);
  assert.match(read('src/components/outreach/search/SourcingFlow.tsx'), /<div className="flex-1 px-4 py-6 min-h-\[420px\] relative">/, 'le plan passe au-dessus du fond');
});
