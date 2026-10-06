/**
 * Contraste des primitives, façon Qonto (docs/design/01-direction.md, § 2, § 6 et § 10 ; décisions
 * du propriétaire du 06/10/2026) :
 *  - Button : trois styles. Plein d'encre (primary) ; contour d'encre pour default, outline et
 *    secondary (blanc à 70 % en sombre) ; discret à l'encre (ghost, link). Désactivé sans opacité,
 *    libellé gris ; en chargement, aria-busy et toujours disabled (pas de double envoi au clavier) ;
 *  - Badge de statut : texte à l'encre, pastille de la couleur du statut, une icône la remplace ;
 *  - FilterPill : puce grise sans filet, contour d'encre quand elle est active, icônes à l'encre ;
 *  - champs : bord de contrôle, focus en anneau plein, désactivé sans opacité, chevron à l'encre ;
 *  - Illustration : posée sur une tuile de surface carte, sauf tile={false}.
 *
 * Rendu statique des primitives empaquetées par esbuild (alias @/ résolus par tsconfig.app.json),
 * gardes sur le source pour les classes. Lancer : node --test tests/ux/contraste-primitives.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const { outputFiles } = await build({
  stdin: {
    contents: [
      "export { Button } from './src/components/ui/button';",
      "export { Badge } from './src/components/ui/badge';",
      "export { FilterPill } from './src/components/ui/filter-pill';",
      "export { Illustration } from './src/components/ui/illustration';",
      "export { Filter } from 'lucide-react';",
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
const h = kit.createElement;
const render = (component, props, ...children) => kit.renderToStaticMarkup(h(component, props, ...children));

/** Chaîne de classes d'une variante cva (`name: "…"`). */
function variant(src, name) {
  const m = new RegExp(`\\b${name}:\\s*"([^"]+)"`).exec(src);
  assert.ok(m, `variante ${name} introuvable`);
  return m[1];
}

const button = read('src/components/ui/button.tsx');
const badge = read('src/components/ui/badge.tsx');

test('Button : un seul contour d\'encre pour default, outline et secondary, désactivé lisible', () => {
  const outline = variant(button, 'outline');
  assert.equal(variant(button, 'default'), outline, 'default rend exactement outline');
  assert.equal(variant(button, 'secondary'), outline, 'secondary rend exactement outline (plus de fond teinté)');
  for (const cls of ['border', 'border-foreground', 'dark:border-foreground/70', 'text-foreground', 'hover:bg-accent', 'disabled:border-border', 'dark:disabled:border-border', 'disabled:text-muted-foreground']) {
    assert.ok(outline.split(/\s+/).includes(cls), `contour d'encre : ${cls}`);
  }
  assert.doesNotMatch(outline, /border-border-strong|bg-foreground\/10/, 'plus de filet de contrôle ni de fond teinté');
});

test('Button : plein d\'encre, jamais la couleur de marque ; en chargement, l\'aplat garde sa couleur', () => {
  const primary = variant(button, 'primary');
  assert.match(primary, /^bg-primary font-semibold text-primary-foreground hover:bg-primary\/90 /);
  assert.doesNotMatch(primary, /brand/);
  assert.match(primary, /disabled:bg-muted disabled:text-muted-foreground aria-busy:bg-primary aria-busy:text-primary-foreground/);
  assert.match(variant(button, 'destructive'), /disabled:bg-muted disabled:text-muted-foreground aria-busy:bg-destructive aria-busy:text-destructive-foreground/);
  assert.match(variant(button, 'ghost'), /disabled:text-muted-foreground/);
  assert.doesNotMatch(button, /disabled:opacity-/, 'désactivé sans opacité');
});

test('Button : le chargement pose aria-busy et garde disabled, dans les deux branches', () => {
  assert.equal((button.match(/disabled=\{disabled \|\| loading\}/g) ?? []).length, 2);
  assert.equal((button.match(/aria-busy=\{loading \|\| undefined\}/g) ?? []).length, 2);

  const busy = render(kit.Button, { variant: 'primary', loading: true }, 'Enregistrer');
  assert.match(busy, /disabled=""/);
  assert.match(busy, /aria-busy="true"/);
  assert.match(busy, /animate-spin/);

  const idle = render(kit.Button, { variant: 'outline' }, 'Relancer');
  assert.doesNotMatch(idle, /aria-busy/);
  assert.match(idle, /border-foreground/);
  assert.doesNotMatch(idle, /opacity-50/);

  const plain = render(kit.Button, null, 'Option');
  assert.match(plain, /border border-foreground bg-transparent text-foreground/, 'sans variante : contour d\'encre');
});

test('Badge de statut : texte à l\'encre et pastille de la couleur du statut', () => {
  for (const [name, color] of [['success', 'success'], ['warning', 'warning'], ['info', 'info'], ['danger', 'danger'], ['destructive', 'danger'], ['brand', 'brand']]) {
    const cls = variant(badge, name).split(/\s+/);
    for (const c of ['text-foreground', `before:bg-${color}`, 'before:size-1.5', 'before:rounded-full', 'has-[>svg]:before:hidden', `[&>svg]:text-${color}`]) {
      assert.ok(cls.includes(c), `${name} : ${c}`);
    }
    assert.ok(!cls.includes(`text-${color}`), `${name} : la couleur ne porte plus le texte`);
  }
  assert.equal(variant(badge, 'muted'), 'border-transparent bg-muted text-foreground', 'neutre : encre sur le gris, sans pastille');

  const dot = render(kit.Badge, { variant: 'success' }, 'Répondu');
  assert.match(dot, /class="[^"]*\bgap-1\.5\b[^"]*"/, 'écart de la pastille');
  assert.doesNotMatch(dot, /class="[^"]*\bgap-1\b(?!\.)/, 'gap-1 de la base remplacé');
  assert.match(dot, /before:bg-success/);
});

test('FilterPill : puce grise sans filet au repos, contour d\'encre active, icônes à l\'encre', () => {
  const src = read('src/components/ui/filter-pill.tsx');
  assert.match(src, /active \? "border-foreground" : "border-transparent hover:border-border-strong data-\[state=open\]:border-border-strong"/);
  assert.doesNotMatch(src, /<(?:Icon|ChevronDown)\b[^>]*text-muted-foreground/, 'icône et chevron à l\'encre');

  const idle = render(kit.FilterPill, { label: 'Statut', count: 0, icon: kit.Filter }, null);
  assert.match(idle, /rounded-lg border bg-muted px-3/);
  assert.match(idle, /border-transparent/);
  const active = render(kit.FilterPill, { label: 'Statut', count: 2, icon: kit.Filter }, null);
  assert.match(active, /\bborder-foreground\b/);
  assert.doesNotMatch(active, /text-muted-foreground/);
});

test('Champs : focus en anneau plein, désactivé sans opacité, chevron du Select à l\'encre', () => {
  for (const file of ['input.tsx', 'textarea.tsx', 'select.tsx']) {
    const src = read(`src/components/ui/${file}`);
    assert.match(src, /focus-visible:border-ring focus-visible:(?:outline-none focus-visible:)?ring-1 focus-visible:ring-ring/, `${file} : anneau plein`);
    assert.doesNotMatch(src, /ring-ring\/20|ring-\[3px\]/, `${file} : plus d'anneau à 20 %`);
    assert.match(src, /disabled:border-border disabled:bg-muted disabled:text-muted-foreground/, `${file} : désactivé lisible`);
    assert.doesNotMatch(src, /disabled:opacity-50/, `${file} : désactivé sans opacité`);
    assert.match(src, /border border-input/, `${file} : bord de contrôle`);
  }
  assert.match(read('src/components/ui/input.tsx'), /focus-visible:ring-danger"/, 'erreur : anneau rouge plein');
  assert.match(read('src/components/ui/select.tsx'), /<ChevronDown className="h-4 w-4" \/>/);
  assert.match(read('src/components/ui/radio-group.tsx'), /rounded-full border border-input text-primary/);
});

test('Illustration : posée sur une tuile de surface carte, sauf tile={false}', () => {
  const tiled = render(kit.Illustration, { name: 'cafe', className: 'mx-auto mb-4' });
  assert.match(tiled, /^<div aria-hidden="true" class="w-fit rounded-xl bg-card p-4 mx-auto mb-4"><div aria-hidden="true" class="relative block w-fit">/);
  const bare = render(kit.Illustration, { name: 'cafe', tile: false, className: 'mb-4' });
  assert.match(bare, /^<div aria-hidden="true" class="relative block w-fit mb-4">/);
  assert.doesNotMatch(bare, /bg-card/);
});

test('Pastilles neutres et croix de fermeture à l\'encre', () => {
  assert.match(read('src/components/ui/IconTile.tsx'), /default: 'bg-muted text-foreground',/);
  assert.match(read('src/components/layout/EmptyState.tsx'), /'mb-3 grid place-items-center rounded-lg bg-muted text-foreground',/);
  assert.match(read('src/components/layout/PageHeader.tsx'), /place-items-center rounded-lg bg-muted text-foreground">/);
  for (const file of ['dialog.tsx', 'sheet.tsx']) {
    assert.match(read(`src/components/ui/${file}`), /justify-center rounded-lg text-foreground transition-colors duration-150 hover:bg-accent/, `${file} : croix à l'encre`);
  }
  assert.doesNotMatch(read('src/components/ui/command.tsx'), /opacity-50" \/>/, 'loupe sans opacité');
  assert.doesNotMatch(read('src/components/ui/dropdown-menu.tsx'), /opacity-60/, 'raccourci en gris secondaire, sans opacité');
});

test('Onglets : l\'onglet actif garde l\'anneau de focus (activation automatique)', () => {
  // Un onglet qui reçoit le focus s'active aussitôt. Les règles d'état (ring-1 ring-border-strong, ou
  // ring-0 des onglets soulignés) sont générées après focus-visible:ring-2 à spécificité égale : sans
  // une règle propre à l'onglet actif (0,3,0), le focus au clavier ne se voyait jamais.
  const tabs = read('src/components/ui/tabs.tsx');
  assert.match(tabs, /data-\[state=active\]:focus-visible:ring-2 data-\[state=active\]:focus-visible:ring-ring/);
  // Rangées d'onglets qui défilent (overflow-x-auto) : l'anneau est tracé à l'intérieur, sinon rogné.
  for (const rel of ['src/components/sequences/SequenceTabs.tsx', 'src/pages/SequencesPage.tsx']) {
    assert.match(read(rel), /'focus-visible:ring-inset focus-visible:ring-offset-0'/, rel);
  }
});
