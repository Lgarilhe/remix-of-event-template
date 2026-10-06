/**
 * Design simplifié, fin du lot M : l'état vide de /missions (aucune mission)
 * quitte l'ancien langage (titre en capitales, chiffres publicitaires, logos
 * d'outils que Konekt ne relie pas, lien « page carrières » sans action, fonds
 * animés) pour l'état vide du kit : le dessin « dossier », une phrase, un seul
 * bouton plein, sous le titre « Missions » de la page.
 *
 * Rendu statique de l'état vide (esbuild, alias @/ par tsconfig.app.json),
 * garde sur le source de la liste des missions.
 * Lancer : node --test tests/ux/missions-vide-simplicite.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const { outputFiles } = await build({
  stdin: {
    contents: [
      "export { EmptyMissionState } from './src/components/missions/EmptyMissionState';",
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
  loader: { '.webp': 'empty', '.svg': 'empty', '.png': 'empty' },
  tsconfig: join(ROOT, 'tsconfig.app.json'),
  define: { 'process.env.NODE_ENV': '"production"' },
});
const kit = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const html = kit.renderToStaticMarkup(kit.createElement(kit.EmptyMissionState, { onCreateAI: () => {}, onCreateManual: () => {} }));
const text = html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

test('État vide : dessin décoratif, titre de niveau 2 en casse de phrase, une phrase', () => {
  assert.match(html, /<div aria-hidden="true" class="relative block w-fit[^"]*"><img/, 'le dessin, sans texte alternatif');
  assert.match(html, /<h2 class="[^"]*">Lancez votre première mission<\/h2>/);
  assert.doesNotMatch(html, /uppercase|font-black|tracking-wider/, 'plus de titre en capitales');
  assert.match(text, /Une mission, c'est un poste à pourvoir\. Collez la fiche de poste : l'assistant en tire le brief et les filtres de recherche\./);
});

test('Deux entrées, un seul bouton plein : la fiche de poste d’abord, la saisie à la main en discret', () => {
  const buttons = [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => ({ tag: m[0], label: m[1].replace(/<[^>]+>/g, '').trim() }));
  assert.deepEqual(buttons.map((b) => b.label), ['Coller une fiche de poste', 'Saisir le poste à la main']);
  assert.match(buttons[0].tag, /bg-primary/, 'bouton plein');
  assert.doesNotMatch(buttons[1].tag, /bg-primary/, 'bouton discret');
  for (const b of buttons) assert.match(b.tag, /max-sm:min-h-11/, `${b.label} : 44 px au doigt`);
});

test('Plus de chiffres publicitaires, de logos d’outils non reliés ni de lien sans action', () => {
  for (const gone of ['200M', '45s', '3x', 'Intégrations', 'HubSpot', 'Salesforce', 'Slack', 'page carrières', 'Recommandé', 'IA']) {
    assert.ok(!text.includes(gone), `« ${gone} » encore affiché`);
  }
  const src = read('src/components/missions/EmptyMissionState.tsx');
  assert.doesNotMatch(src, /framer-motion|ShimmerButton|motion\./);
  assert.ok(!existsSync(join(ROOT, 'src/components/magicui/shimmer-button.tsx')), 'composant sans autre lecteur, retiré');
});

test('Liste des missions vide : le titre « Missions » reste, sans second bouton dans l’en-tête', () => {
  const src = read('src/components/outreach/projects/ProjectsListV2.tsx');
  const empty = src.slice(src.indexOf('if (hasData && unifiedProjects.length === 0) {'), src.indexOf('const subtitle ='));
  assert.match(empty, /<PageHeader title="Missions" \/>/);
  assert.match(empty, /<EmptyMissionState\s+onCreateAI=\{\(\) => \{ setCreateInitialTab\('brief'\); setShowCreateModal\(true\); \}\}\s+onCreateManual=\{\(\) => \{ setCreateInitialTab\('manual'\); setShowCreateModal\(true\); \}\}/);
  assert.match(empty, /<div className="mb-6 empty:hidden">\s*<PartnerMissionsSection \/>/);
});
