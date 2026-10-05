/**
 * Bulle ronde de l'assistant (retour du 05/10/2026, après son retrait par A2, §5.3).
 *
 * Invariants épinglés, par inspection de source :
 *   - le bouton vit dans son composant, monté par AppLayout (pages connectées
 *     seulement, jamais la landing, l'auth ni les portails) ;
 *   - il ouvre le tiroir par openAgent(), sans toucher au raccourci Ctrl K ;
 *   - il est masqué là où une zone de saisie occupe le bas à droite ;
 *   - bouton du kit, nom accessible, aucun nom de fournisseur ni tiret long.
 *
 * Sans navigateur ni base. Lancer : npm run test:ux
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const launcher = read('src/components/agent/AssistantLauncher.tsx');
const layout = read('src/components/AppLayout.tsx');
const drawer = read('src/components/agent/AgentDrawer.tsx');

test('BULLE-1 : montée par AppLayout, pas par le tiroir ni par App', () => {
  assert.match(layout, /import \{ AssistantLauncher \} from '@\/components\/agent\/AssistantLauncher'/);
  assert.match(layout, /<AssistantLauncher \/>/);
  assert.doesNotMatch(drawer, /AssistantLauncher/);
});

test('BULLE-2 : ouvre le tiroir par openAgent, rond, fixé en bas à droite', () => {
  assert.match(launcher, /openAgent\(\)/);
  assert.match(launcher, /fixed bottom-4 right-4/);
  assert.match(launcher, /rounded-full/);
  assert.match(launcher, /aria-label="Ouvrir l'assistant"/);
});

test('BULLE-2b : accent de la marque, étoiles pleines qui scintillent', () => {
  assert.match(launcher, /bg-brand /);
  assert.match(launcher, /text-brand-foreground/);
  assert.doesNotMatch(launcher, /variant="primary"/);
  assert.match(launcher, /animate-twinkle/);
  assert.match(launcher, /fill="currentColor"/);
  assert.doesNotMatch(launcher, /from 'lucide-react'/);
  // La classe du bouton impose 16 px aux icônes : la taille se règle sur le parent.
  assert.match(launcher, /\[&_svg\]:size-8/);
});

test('BULLE-3 : masquée sur /agents et /inbox', () => {
  const routes = launcher.match(/HIDDEN_ROUTES = \[([^\]]*)\]/);
  assert.ok(routes, 'liste HIDDEN_ROUTES introuvable');
  assert.deepEqual([...routes[1].matchAll(/'([^']+)'/g)].map((m) => m[1]), ['/agents', '/inbox']);
  assert.match(launcher, /return null;/);
});

test('BULLE-4 : bouton du kit, couche nommée, aucun nom de fournisseur, aucun tiret long', () => {
  assert.match(launcher, /from '@\/components\/ui\/button'/);
  assert.doesNotMatch(launcher, /<button/);
  assert.match(launcher, /z-sticky/);
  assert.doesNotMatch(launcher, /z-\[/);
  assert.doesNotMatch(launcher, /Unipile|Apollo|PDL|Anthropic|Claude/);
  assert.ok(!launcher.includes('—'), 'tiret long');
});
