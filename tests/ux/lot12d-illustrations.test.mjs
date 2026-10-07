/**
 * Chantier design, lot 12 : illustrations (dessins à l'encre sur papier crème,
 * accent bleu-vert). Calques WebP allégés, composant décoratif unique dont les
 * pièces mobiles tournent en boucle (fond fixe), états vides et pannes des
 * écrans hors refonte mission.
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

test('Illustrations : onze dessins, en calques WebP légers', () => {
  assert.deepEqual(
    [...drawings].sort(),
    ['brief', 'cafe', 'connexion', 'conversation', 'dossier', 'envoi', 'orientation', 'recherche', 'taches', 'tri', 'valide'],
  );
  assert.ok(imports.length >= 20, `trop peu de calques importés (${imports.length})`);
  for (const { id, file } of imports) {
    const rel = `src/assets/illustrations/${file}.webp`;
    assert.ok(existsSync(new URL(rel, ROOT)), `${rel} manquant`);
    assert.ok(statSync(new URL(rel, ROOT)).size < 60 * 1024, `${rel} dépasse 60 Ko`);
    assert.match(component, new RegExp(`\\{\\s*src: ${id}(?:,\\s*motion: |\\s*\\})`), `${file} importé sans servir`);
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

test('Illustrations : fond fixe, pièces en boucle avec une pause, dessin fixe avec le mouvement réduit', () => {
  // Rien ne bouge avant que tous les calques soient là.
  assert.match(component, /const ready = settled >= layers\.length;/);
  assert.match(component, /onLoad=\{settle\}\s+onError=\{settle\}/);
  assert.match(component, /!ready && 'opacity-0'/);
  // L'entrée se joue une fois ; les pièces mobiles tournent en boucle (décision du propriétaire, 29/09).
  const anim = (name) => tailwind.split('\n').find((l) => l.includes(`'${name}': 'illu-`));
  assert.match(anim('illu-enter'), / both',$/);
  assert.doesNotMatch(anim('illu-enter'), /infinite/);
  for (const name of ['illu-loop', 'illu-drift', 'illu-draw']) assert.match(anim(name), / infinite both',$/, name);
  assert.match(anim('illu-settle'), /, illu-float 4s .* infinite',$/);
  // Une boucle garde une pause : entrée sur le premier cinquième du tour, pièce en place jusqu'à 80 %.
  for (const name of ['illu-loop', 'illu-draw']) {
    assert.match(tailwind, new RegExp(`'${name}': \\{\\s*'0%': \\{[\\s\\S]*?'20%, 80%': \\{`), name);
  }
  // Durées : entrée d'une seconde au plus ; un tour de boucle entre 2,5 et 4,5 s.
  const motions = [...component.matchAll(/motion: \{ anim: '(\w+)'([^}]*)\}/g)];
  assert.ok(motions.length >= 14, `trop peu de mouvements relevés (${motions.length})`);
  for (const [, kind, rest] of motions) {
    const delay = Number(/delay: (\d+)/.exec(rest)?.[1] ?? 0);
    const duration = Number(/duration: (\d+)/.exec(rest)?.[1]);
    if (kind === 'enter' || kind === 'settle') {
      assert.ok(delay + duration <= 1000, `entrée trop longue : ${rest.trim()}`);
    } else {
      assert.ok(duration >= 2500 && duration <= 4500, `tour de boucle hors 2,5 à 4,5 s : ${rest.trim()}`);
    }
  }
  // Le fond reste fixe : seules les pièces mobiles bouclent.
  assert.match(component, /\{ src: cafeTasse, motion: FADE \}/);
  assert.match(component, /\{ src: orientationPoteau \}/);
  // Mouvement réduit : aucune animation, le dessin est fixe dans son état final.
  assert.match(component, /'motion-reduce:!animate-none'/);
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
  // La boîte multicanale reste accessible sans compte LinkedIn : l’état vide
  // appartient au fil commun, pas à un écran bloquant de connexion.
  const inbox = code('src/components/outreach/MessagesInbox.tsx');
  assert.doesNotMatch(inbox, /title="Aucun compte LinkedIn relié"/);
  assert.match(inbox, /<MultichannelConversation/);
  assert.match(inbox, /<MessageView/);
  const invite = code('src/pages/AcceptMissionInvite.tsx');
  assert.match(invite, /illustration="valide"\s+title="Invitation acceptée"/);
  assert.match(invite, /illustration="orientation" title="Invitation expirée"/);
  assert.match(invite, /illustration="orientation"\s+title="Invitation introuvable"/);
  assert.match(invite, /illustration="connexion"\s+title="L'invitation n'a pas pu être acceptée"/);
  assert.match(code('src/pages/NotFound.tsx'), /<Illustration name="orientation" size="lg"/);
});
