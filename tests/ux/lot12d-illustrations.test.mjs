/**
 * Chantier design, lot 12 : illustrations (dessins à l'encre sur papier crème,
 * accent bleu-vert). Fichiers WebP allégés, composant décoratif unique, états
 * vides et pannes des écrans hors refonte mission.
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
const NAMES = [...component.matchAll(/^\s{2}(\w+): \{ src: \w+, width: \d+, height: \d+ \},$/gm)].map((m) => m[1]);

test('Illustrations : dix dessins, chacun en WebP léger', () => {
  assert.deepEqual(
    [...NAMES].sort(),
    ['brief', 'cafe', 'connexion', 'conversation', 'dossier', 'envoi', 'orientation', 'recherche', 'taches', 'valide'],
  );
  for (const name of NAMES) {
    const rel = `src/assets/illustrations/${name}.webp`;
    assert.ok(existsSync(new URL(rel, ROOT)), `${rel} manquant`);
    assert.ok(statSync(new URL(rel, ROOT)).size < 60 * 1024, `${rel} dépasse 60 Ko`);
    assert.match(component, new RegExp(`import ${name} from '@/assets/illustrations/${name}\\.webp';`));
  }
  const files = readdirSync(new URL('src/assets/illustrations/', ROOT));
  assert.ok(files.every((f) => f.endsWith('.webp')), 'jamais les PNG d’origine (1 Mo chacun)');
});

test('Illustrations : décoratives, fixes, chargées à la demande, place réservée', () => {
  assert.match(component, /alt=""/);
  assert.match(component, /aria-hidden="true"/);
  assert.match(component, /loading="lazy"/);
  assert.match(component, /width=\{width\}\s+height=\{height\}|width=\{width\}[\s\S]{0,40}height=\{height\}/);
  assert.doesNotMatch(component, /animate-|motion\./, 'aucune animation');
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
