/**
 * Bandeau du kit (src/components/ui/banner.tsx) : sur téléphone, son action
 * (« Choisir un plan » du bandeau d'essai, « Reconnecter », « Voir les offres »…)
 * et sa croix offrent 44 px au doigt. La croix garde son dessin de 36 px et
 * gagne une zone invisible (::after) : le texte du bandeau garde sa largeur, le
 * bandeau ne grandit pas. Rien ne change sur ordinateur.
 *
 * Rendu statique (esbuild, alias @/ par tsconfig.app.json).
 * Lancer : node --test tests/ux/bandeau-cibles.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const { outputFiles } = await build({
  stdin: {
    contents: [
      "export { Banner, bannerActionClass } from './src/components/ui/banner';",
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
  tsconfig: join(ROOT, 'tsconfig.app.json'),
  define: { 'process.env.NODE_ENV': '"production"' },
});
const kit = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const h = kit.createElement;
const html = kit.renderToStaticMarkup(
  h(kit.Banner, { tone: 'warning', onDismiss: () => {}, action: h('a', { href: '/settings/org/billing', className: kit.bannerActionClass }, 'Choisir un plan') }, 'Essai terminé.'),
);
const classOf = (re) => (html.match(re) || [])[1] ?? '';

test('Action du bandeau : 44 px de haut sur téléphone, inchangée sur ordinateur', () => {
  const cls = classOf(/<a href="\/settings\/org\/billing" class="([^"]*)"/).split(' ');
  assert.ok(cls.includes('max-md:min-h-11'), 'cible de 44 px sur téléphone');
  assert.ok(!cls.some((c) => /^(min-)?h-\d/.test(c)), 'aucune hauteur imposée sur ordinateur');
});

test('Croix : dessin de 36 px sur téléphone, zone de 44 px au doigt, 28 px sur ordinateur', () => {
  const cls = classOf(/<button type="button" aria-label="Fermer le bandeau" class="([^"]*)"/).split(' ');
  for (const c of ['relative', 'h-7', 'w-7', 'max-md:h-9', 'max-md:w-9', 'max-md:after:absolute', 'max-md:after:-inset-1']) {
    assert.ok(cls.includes(c), `classe ${c} attendue`);
  }
  assert.ok(!cls.includes('max-md:h-11'), 'la croix ne s’élargit pas : le texte garderait moins de place');
});
