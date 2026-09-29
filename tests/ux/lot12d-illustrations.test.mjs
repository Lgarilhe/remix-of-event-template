/**
 * Chantier design, lot 12 : illustrations (dessins à l'encre sur papier crème,
 * accent bleu-vert). Calques WebP allégés, composant décoratif unique dont les
 * pièces se posent une fois à l'apparition, états vides et pannes des écrans
 * hors refonte mission.
 *
 * Lancer : node --test tests/ux/lot12d-illustrations.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');
/** Code sans commentaires : les commentaires citent parfois ce qu'on bannit. */
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const component = code('src/components/ui/illustration.tsx');
const tailwind = read('tailwind.config.ts');
/** Dessins : entrées « nom: { width, height, … layers: [ … ] } » de DRAWINGS. */
const drawings = (() => {
  const body = component.slice(component.indexOf('const DRAWINGS'), component.indexOf('const SIZES'));
  return [...body.matchAll(/^\s{2}(\w+): \{/gm)].map((m) => m[1]);
})();
const imports = [...component.matchAll(/^import (\w+) from '@\/assets\/illustrations\/([\w-]+)\.webp';$/gm)].map((m) => ({ id: m[1], file: m[2] }));

test('Illustrations : dix dessins, en calques WebP légers', () => {
  assert.deepEqual(
    [...drawings].sort(),
    ['brief', 'cafe', 'connexion', 'conversation', 'dossier', 'envoi', 'orientation', 'recherche', 'taches', 'valide'],
  );
  assert.ok(imports.length >= 20, `trop peu de calques importés (${imports.length})`);
  for (const { id, file } of imports) {
    const rel = `src/assets/illustrations/${file}.webp`;
    assert.ok(existsSync(new URL(rel, ROOT)), `${rel} manquant`);
    assert.ok(statSync(new URL(rel, ROOT)).size < 60 * 1024, `${rel} dépasse 60 Ko`);
    assert.match(component, new RegExp(`\\{ src: ${id}(?:, motion: | \\})`), `${file} importé sans servir`);
  }
  // Chaque fichier du dossier sert un dessin, jamais les PNG d'origine (1 Mo chacun).
  const files = readdirSync(new URL('src/assets/illustrations/', ROOT));
  assert.ok(files.every((f) => f.endsWith('.webp')), 'jamais les PNG d’origine');
  assert.deepEqual(files.map((f) => f.replace(/\.webp$/, '')).sort(), imports.map((i) => i.file).sort(), 'calque orphelin');
});

test('Illustrations : décoratives, place réservée, chargées à la demande', () => {
  assert.match(component, /alt=""/);
  assert.match(component, /aria-hidden="true"/);
  assert.match(component, /loading="lazy"/);
  assert.match(component, /width=\{width\}\s+height=\{height\}/);
  // Le premier calque donne la taille, les autres se superposent au même cadrage.
  assert.match(component, /i === 0 \? cn\('block h-auto w-auto', SIZES\[size\]\) : 'absolute inset-0 h-full w-full'/);
});

test('Illustrations : entrée jouée une fois, une seconde au plus, coupée par le mouvement réduit', () => {
  // Rien ne bouge avant que tous les calques soient là.
  assert.match(component, /const ready = settled >= layers\.length;/);
  assert.match(component, /onLoad=\{settle\}\s+onError=\{settle\}/);
  assert.match(component, /!ready && 'opacity-0'/);
  // Deux animations, jouées une fois, jamais en boucle.
  for (const name of ['illu-enter', 'illu-draw']) {
    const line = tailwind.split('\n').find((l) => l.includes(`'${name}': '${name} `));
    assert.ok(line, `animation ${name} absente de tailwind.config.ts`);
    assert.match(line, / both',$/);
    assert.doesNotMatch(line, /infinite/);
  }
  assert.doesNotMatch(component, /infinite|iteration/);
  // Départ et durée : une seconde au plus pour chaque pièce.
  const motions = [...component.matchAll(/motion: \{([^}]*)\}/g)].map((m) => m[1]);
  assert.ok(motions.length >= 12, `trop peu de mouvements relevés (${motions.length})`);
  for (const m of motions) {
    const delay = Number(/delay: (\d+)/.exec(m)?.[1] ?? 0);
    const duration = Number(/duration: (\d+)/.exec(m)?.[1]);
    assert.ok(duration > 0 && delay + duration <= 1000, `mouvement trop long : ${m.trim()}`);
  }
  // Mouvement réduit : durée coupée par la règle globale, attente coupée par le calque.
  assert.match(read('src/index.css'), /prefers-reduced-motion: reduce[\s\S]{0,120}animation-duration: 0\.01ms !important/);
  assert.match(component, /'motion-reduce:!\[animation-delay:0ms\]'/);
});

test('Illustrations : états vides et pannes du kit', () => {
  const empty = code('src/components/layout/EmptyState.tsx');
  assert.match(empty, /illustration\?: IllustrationName;/);
  assert.match(empty, /<Illustration name=\{illustration\} size=\{compact \? 'sm' : 'md'\}/);
  const error = code('src/components/layout/ErrorState.tsx');
  assert.match(error, /illustration\?: IllustrationName;/);
  assert.match(error, /illustration && !compact \?/, 'une panne compacte garde son icône');
  const deadEnd = code('src/components/public/PublicDeadEnd.tsx');
  assert.match(deadEnd, /link: 'orientation',\s*missing: 'orientation',\s*network: 'connexion',/);
  assert.doesNotMatch(deadEnd, /IconTile/);
});

test('Illustrations : une par écran, là où l’écran était vide', () => {
  const placements = [
    ['src/pages/Tasks.tsx', 'taches', 'Aucune tâche en cours'],
    ['src/pages/Calendar.tsx', 'cafe', 'Rien de prévu'],
    ['src/components/dashboard/DashboardTodayPanel.tsx', 'cafe', "Rien de prévu aujourd'hui"],
    ['src/pages/ATS.tsx', 'recherche', "Aucun candidat pour l'instant"],
    ['src/pages/Agents.tsx', 'conversation', 'Aucune conversation'],
    ['src/components/outreach/SequencesList.tsx', 'envoi', 'Aucune séquence pour cette mission'],
    ['src/components/outreach/MessagesInbox.tsx', 'connexion', 'Aucun compte LinkedIn relié'],
    ['src/components/outreach/inbox/MessageView.tsx', 'conversation', 'Sélectionnez une conversation'],
  ];
  for (const [rel, name, title] of placements) {
    const src = code(rel);
    // Le titre de l'état vide, pas une autre occurrence de la même phrase.
    const at = Math.max(src.indexOf(`title="${title}`), src.indexOf(`title={\`${title}`));
    assert.ok(at > 0, `${rel} : « ${title} » introuvable`);
    const around = src.slice(Math.max(0, at - 200), at);
    assert.match(around, new RegExp(`illustration="${name}"`), `${rel} : ${name} attendu avant « ${title} »`);
    assert.equal((src.match(/illustration="/g) ?? []).length, 1, `${rel} : une seule illustration`);
  }
  const invite = code('src/pages/AcceptMissionInvite.tsx');
  assert.match(invite, /illustration="valide"\s+title="Invitation acceptée"/);
  assert.match(invite, /illustration="orientation" title="Invitation expirée"/);
  assert.match(invite, /illustration="orientation"\s+title="Invitation introuvable"/);
  assert.match(invite, /illustration="connexion"\s+title="L'invitation n'a pas pu être acceptée"/);
  assert.match(code('src/pages/NotFound.tsx'), /<Illustration name="orientation" size="lg"/);
});
