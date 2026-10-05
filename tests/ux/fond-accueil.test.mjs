/**
 * Fond animé de l'accueil et de la recherche hors mission (docs/design/01-direction.md, § 7,
 * décision du propriétaire du 05/10/2026).
 *  - PageLayout ne change pas sans l'option `backdrop` ;
 *  - le fond est décoratif (aria-hidden, sans clic), ne s'anime que par transform,
 *    et le mouvement réduit reste coupé globalement ;
 *  - seuls l'accueil et la recherche hors mission l'utilisent.
 *
 * Rendu statique de PageLayout empaqueté par esbuild (alias @/ résolus par tsconfig.app.json).
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

const { outputFiles } = await build({
  stdin: {
    contents: [
      "export { PageLayout } from './src/components/layout/PageLayout';",
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
});
const kit = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const page = (props) => kit.renderToStaticMarkup(kit.createElement(kit.PageLayout, props, 'contenu'));

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

test('fond : seuls l\'accueil et la recherche hors mission l\'utilisent', () => {
  const walk = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) return walk(abs);
      return /\.tsx?$/.test(name) ? [abs] : [];
    });
  const users = walk(join(ROOT, 'src'))
    .map((abs) => relative(ROOT, abs).split('\\').join('/'))
    .filter((rel) => /<PageBackdrop\b|<PageLayout\b[^>]*\bbackdrop\b/.test(read(rel)));
  assert.deepEqual(users.sort(), ['src/components/layout/PageLayout.tsx', 'src/pages/Dashboard.tsx', 'src/pages/SourcingSearches.tsx']);
  assert.match(read('src/pages/Dashboard.tsx'), /<PageLayout maxWidth="md" backdrop>/);
  const search = read('src/pages/SourcingSearches.tsx');
  assert.match(search, /<PageBackdrop \/>/);
  assert.match(search, /className="konekt-on-backdrop relative flex w-full/);
});
