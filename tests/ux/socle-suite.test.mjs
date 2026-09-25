/**
 * Chantier design, socle commun après les lots 6 et 7 : fenêtres empilées,
 * pluriel partagé.
 *
 * Lancer : node --test tests/ux/socle-suite.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const load = async (rel) => {
  const { code } = transformSync(read(rel), { loader: 'ts', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
};

const { plural } = await load('src/lib/plural.ts');

test('D-71 : 0 et 1 au singulier, nombre écrit à la française', () => {
  assert.equal(plural(0, 'candidat'), '0 candidat');
  assert.equal(plural(1, 'candidat'), '1 candidat');
  assert.equal(plural(3, 'candidat'), '3 candidats');
  assert.equal(plural(2, 'travail', 'travaux'), '2 travaux');
  assert.equal(plural(1200, 'crédit'), `1${' '}200 crédits`);
});

test('D-71 : une seule fonction de pluriel dans les zones du chantier', () => {
  // Paramètres : zone de la session « Audit complet du dépôt ».
  const skip = new Set(['src/components/settings/BillingSettings.tsx', 'src/lib/plural.ts']);
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${name}`;
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(name) && !skip.has(rel) && /const plural = \(|function plural\(/.test(read(rel))) offenders.push(rel);
    }
  };
  walk('src');
  assert.deepEqual(offenders, []);
});

test('Fenêtres : voile au calque des fenêtres, aria-modal posé par le kit', () => {
  for (const file of ['dialog', 'alert-dialog', 'sheet', 'drawer']) {
    const src = read(`src/components/ui/${file}.tsx`);
    assert.doesNotMatch(src, /z-overlay/, `${file} : voile sous la fenêtre d'origine`);
  }
  for (const file of ['dialog', 'alert-dialog', 'sheet']) {
    assert.match(read(`src/components/ui/${file}.tsx`), /aria-modal="true"/, `${file} : aria-modal`);
  }
  const dialog = read('src/components/ui/dialog.tsx');
  assert.match(dialog, /variant\?: "default" \| "fullscreen"/);
  assert.match(read('src/components/ui/popover.tsx'), /export \{[^}]*PopoverAnchor/);
});
