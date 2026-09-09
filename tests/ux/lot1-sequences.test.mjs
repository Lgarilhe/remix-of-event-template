/**
 * Lot 1 du chantier UX, seconde moitié — garde-fous de non-régression.
 *
 * Couvre UX05 (choisir une séquence n'inscrit plus personne), UX06 (les
 * éditeurs longs conservent le travail) et UX07 (le choix de séquence n'est
 * plus posé sous la conversation mobile).
 *
 * Lancer : npm run test:ux
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const inbox = read('src/components/outreach/MessagesInbox.tsx');
const createMission = read('src/components/missions/v2/CreateMissionV2.tsx');
const sequenceBuilder = read('src/components/outreach/SequenceBuilder.tsx');

// ---------------------------------------------------------------- UX05
test('UX05 — choisir une séquence dans la messagerie n’inscrit personne', () => {
  assert.doesNotMatch(
    inbox,
    /onClick=\{\(\)\s*=>\s*inbox\.enrollInSequence\(/,
    'un clic sur une ligne de séquence engageait le candidat sans confirmation',
  );
  assert.match(inbox, /setPendingSequence\(sequence\)/, 'le choix doit ouvrir la préparation');
});

test('UX05 — la messagerie utilise la même préparation que le sourcing', () => {
  assert.match(inbox, /import \{ SequenceEnrollModal \}/);
  assert.match(inbox, /<SequenceEnrollModal/, 'la modale partagée doit être rendue');
  // Elle porte les avertissements de compatibilité et les contacts récents.
  const modal = read('src/components/outreach/SequenceEnrollModal.tsx');
  assert.match(modal, /checkProfilesCompat/);
  assert.match(modal, /findRecentEnrollments/);
});

// ---------------------------------------------------------------- UX07
test('UX07 — le choix de séquence passe par le dialogue partagé', () => {
  // Le composant portait sa propre fenêtre en z-50, dans le même fichier que la
  // conversation mobile en z-[2100] : elle passait dessous sur téléphone.
  assert.doesNotMatch(
    inbox,
    /className="fixed inset-0 z-50 flex items-center justify-center bg-black\/50/,
    'la fenêtre maison doit céder la place au dialogue partagé',
  );
  assert.match(inbox, /<Dialog open=\{inbox\.showSequenceSelect\}/);
});

test('UX07 — la conversation mobile garde sa couche, sans nouvelle valeur arbitraire', () => {
  // On ne compte que les couches réellement appliquées, pas celles citées en
  // commentaire.
  const couches = [...inbox.matchAll(/className="[^"]*?z-\[(\d+)\]/g)].map((m) => Number(m[1]));
  assert.deepEqual(couches, [2100], 'une seule couche explicite doit subsister');
});

// ---------------------------------------------------------------- UX06
test('UX06 — la création de mission conserve la saisie à la fermeture', () => {
  assert.match(createMission, /saveEditorDraft\(\s*MISSION_DRAFT_KEY/);
  assert.match(createMission, /loadEditorDraft<MissionDraft>\(MISSION_DRAFT_KEY\)/);
  // Le brouillon ne survit pas à une mission réellement créée.
  assert.match(createMission, /creationReussieRef\.current = true;/);
  assert.match(createMission, /const aConserver = aDuTexte && !creationReussieRef\.current;/);
});

test('UX06 — l’éditeur de séquence conserve le travail non enregistré', () => {
  assert.match(sequenceBuilder, /saveEditorDraft\(SEQUENCE_DRAFT_KEY/);
  assert.match(sequenceBuilder, /loadEditorDraft<Sequence>\(SEQUENCE_DRAFT_KEY\)/);
  assert.match(
    sequenceBuilder,
    /if \(enregistreeRef\.current\) return;/,
    'une séquence enregistrée ne doit pas laisser de brouillon derrière elle',
  );
});

test('UX06 — une séquence existante n’est jamais écrasée par un vieux brouillon', () => {
  const debut = sequenceBuilder.indexOf('const brouillonInitial');
  assert.ok(debut !== -1);
  const ligne = sequenceBuilder.slice(debut, debut + 200);
  assert.match(ligne, /isEditing \? null :/, 'en édition, aucun brouillon local ne doit être relu');
});

test('UX06 — les brouillons d’éditeurs expirent au lieu de s’accumuler', () => {
  const helper = read('src/lib/editorDraft.ts');
  assert.match(helper, /MAX_AGE_MS/);
  assert.match(helper, /savedAt > MAX_AGE_MS/);
});
