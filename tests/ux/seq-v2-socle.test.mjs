/**
 * Refonte des séquences (lot 5), socle commun des pages Séquences.
 *
 * Lot 5c-1 (extraction pure) : les types d'une séquence vivent dans
 * src/types/sequence.ts ; seuls les fichiers voués au retrait du lot 5j les
 * lisent encore par le réexport de SequenceBuilder.tsx. Les actions de la
 * liste et du suivi (src/lib/sequenceActions.ts) reçoivent client, toast et
 * mises à jour d'état en paramètres.
 * Étendu au lot 5c-2.
 *
 * Lancer : node --test tests/ux/seq-v2-socle.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

function filesUnder(rel) {
  const dir = new URL(`../../${rel}/`, import.meta.url);
  return readdirSync(dir).flatMap((name) => {
    const child = `${rel}/${name}`;
    return statSync(new URL(name, dir)).isDirectory() ? filesUnder(child) : [child];
  });
}

/** Fichiers retirés au lot 5j qui lisent encore les types par le réexport. */
const RETIRED_TYPE_READERS = new Set([
  'src/components/outreach/sequence/StepEditor.tsx',
  'src/components/outreach/sequence/WorkflowCanvas.tsx',
  'src/components/outreach/sequence/nodes/WorkflowStepNode.tsx',
  'src/components/outreach/sequence/VisualSequenceEditor.tsx',
  'src/components/outreach/sequence/SequenceValidationChecklist.tsx',
]);
const TYPE_NAMES = ['SequenceStep', 'StopConditions', 'SenderAccountConfig', 'Sequence'];

test('5c-1 — les types d’une séquence sont définis une seule fois, dans src/types/sequence.ts', () => {
  const types = read('src/types/sequence.ts');
  for (const name of TYPE_NAMES) {
    assert.match(types, new RegExp(`export interface ${name} \\{`), `${name} absent de src/types/sequence.ts`);
  }
  const builder = read('src/components/outreach/SequenceBuilder.tsx');
  for (const name of TYPE_NAMES) {
    assert.doesNotMatch(builder, new RegExp(`interface ${name} \\{`), `${name} encore défini dans SequenceBuilder.tsx`);
  }
  // Réexport gardé jusqu'au lot 5j pour les fichiers voués au retrait.
  assert.match(builder, /export type \{ SequenceStep, StopConditions, SenderAccountConfig, Sequence \} from '@\/types\/sequence';/);
});

test('5c-1 — hors fichiers voués au retrait, aucun type ne vient plus de SequenceBuilder', () => {
  const importers = filesUnder('src')
    .filter((rel) => /\.(ts|tsx)$/.test(rel))
    .map((rel) => ({ rel, imports: [...read(rel).matchAll(/^import\b[^;]*?from ['"][^'"]*\/SequenceBuilder['"];?$/gm)].map((m) => m[0]) }))
    .filter(({ imports }) => imports.length > 0);
  assert.ok(importers.length > 0, 'aucun importeur trouvé : la recherche est cassée');
  for (const { rel, imports } of importers) {
    if (RETIRED_TYPE_READERS.has(rel)) continue;
    // La liste monte encore l'éditeur actuel (jusqu'au lot 5h) : le composant seul.
    assert.equal(rel, 'src/components/outreach/SequencesList.tsx', `${rel} lit encore SequenceBuilder`);
    assert.deepEqual(imports, ["import { SequenceBuilder } from './SequenceBuilder';"], 'la liste n’en importe que le composant');
  }
});

test('5c-1 — les fichiers gardés lisent les types dans src/types/sequence.ts', () => {
  const expected = {
    'src/components/outreach/sequence/sequenceGraph.ts': /import type \{ Sequence, SequenceStep, StopConditions, SenderAccountConfig \} from '\.\.\/\.\.\/\.\.\/types\/sequence';/,
    'src/components/outreach/sequence/messageTypeUtils.ts': /import type \{ SequenceStep \} from '\.\.\/\.\.\/\.\.\/types\/sequence';/,
    'src/components/outreach/SequencesList.tsx': /import type \{ Sequence \} from '@\/types\/sequence';/,
    'src/components/outreach/SequenceTemplateSelector.tsx': /import type \{ Sequence, SequenceStep \} from '@\/types\/sequence';/,
    'src/lib/sequenceActions.ts': /import type \{ Sequence, StopConditions, SenderAccountConfig \} from '@\/types\/sequence';/,
    'src/hooks/useSequenceSave.ts': /import type \{ Sequence \} from '@\/types\/sequence';/,
  };
  for (const [rel, pattern] of Object.entries(expected)) assert.match(read(rel), pattern, rel);
});

test('5c-1 — actions de la liste et du suivi : client, toast et état passés en paramètres', () => {
  const actions = read('src/lib/sequenceActions.ts');
  // Aucun chargement du client, de sonner ni de l'appel serveur à l'exécution : types seulement.
  assert.match(actions, /^import type \{ toast as sonnerToast \} from 'sonner';$/m);
  assert.match(actions, /^import type \{ supabase as supabaseClient \} from '@\/integrations\/supabase\/client';$/m);
  assert.match(actions, /^import type \{ invokeEdgeFunction as invokeEdgeFunctionFn \} from '@\/lib\/invokeEdgeFunction';$/m);
  assert.doesNotMatch(actions, /^import \{[^}]*\} from '(sonner|@\/integrations\/supabase\/client|@\/lib\/invokeEdgeFunction)';$/m);
  assert.match(actions, /export function createSequenceListActions\(deps: SequenceListActionDeps\)/);
  assert.match(actions, /export function createEnrollmentActions\(deps: EnrollmentActionDeps\)/);
  // Les composants passent leur client et leur toast.
  const list = read('src/components/outreach/SequencesList.tsx');
  const panel = read('src/components/outreach/SequenceEnrollmentsPanel.tsx');
  assert.match(list, /\} = createSequenceListActions\(\{\s*supabase, invokeEdgeFunction, toast, navigate,/);
  assert.match(panel, /= createEnrollmentActions\(\{\s*supabase, invokeEdgeFunction, toast, sequenceId, nameOf,/);
  // L'enregistrement de l'éditeur passe par le hook partagé.
  assert.match(list, /const \{ handleSaveSequence \} = useSequenceSave\(\{/);
  assert.match(read('src/hooks/useSequenceSave.ts'), /supabase\.rpc\('save_sequence_steps', \{/);
});

test('5c-1 — « Enregistrer comme modèle » vit dans son propre fichier', () => {
  const modal = read('src/components/outreach/SaveAsTemplateModal.tsx');
  assert.match(modal, /export const SaveAsTemplateModal: React\.FC<SaveAsTemplateModalProps>/);
  assert.doesNotMatch(read('src/components/outreach/SequenceTemplateSelector.tsx'), /SaveAsTemplateModal/);
  assert.match(read('src/components/outreach/SequencesList.tsx'), /import \{ SaveAsTemplateModal \} from '\.\/SaveAsTemplateModal';/);
  // Catégories des modèles : une seule liste, lue par le modal et par le choix de modèle.
  assert.match(read('src/components/outreach/sequence/sequenceGraph.ts'), /export const TEMPLATE_CATEGORIES = \[/);
  assert.match(modal, /import \{ TEMPLATE_CATEGORIES \} from '\.\/sequence\/sequenceGraph';/);
  for (const rel of ['src/components/outreach/SaveAsTemplateModal.tsx', 'src/components/outreach/SequenceTemplateSelector.tsx']) {
    assert.doesNotMatch(read(rel), /const TEMPLATE_CATEGORIES =/, `${rel} redéfinit les catégories`);
  }
});
