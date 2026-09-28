// Première exécution d'une inscription de l'assistant (audit 2026-09-25, SEQ-044).
//
//   deno test --no-check supabase/functions/_shared/sequence-first-step.test.ts

import { strictEqual } from 'node:assert';
import { firstExecutionTime, pickFirstRootStep, type SequenceStepLike } from './sequence-first-step.ts';

const step = (id: string, step_order: number, over: Partial<SequenceStepLike> = {}): SequenceStepLike => ({
  id, step_order, parent_step_id: null, branch: null, if_true_goto_step: null,
  if_false_goto_step: null, timeout_branch_step_id: null, next_step_id: null, ...over,
});

Deno.test('première étape : plus petit step_order, même numéroté à partir de 1', () => {
  strictEqual(pickFirstRootStep([step('b', 2), step('a', 1), step('c', 3)])?.id, 'a');
});

Deno.test('première étape : jamais une cible de branchement ni une étape fille', () => {
  const steps = [
    step('branch-target', 0),
    step('child', 1, { parent_step_id: 'root' }),
    step('root', 2, { if_true_goto_step: 'branch-target', timeout_branch_step_id: 'late' }),
    step('late', 3),
  ];
  strictEqual(pickFirstRootStep(steps)?.id, 'root');
});

Deno.test('première étape : suite de next_step_id, la tête de chaîne gagne', () => {
  const steps = [step('s2', 5), step('s1', 7, { next_step_id: 's2' })];
  strictEqual(pickFirstRootStep(steps)?.id, 's1');
});

Deno.test('première étape : séquence vide = aucune étape', () => {
  strictEqual(pickFirstRootStep([]), null);
});

Deno.test('première étape : toutes ciblées (boucle), repli sur la plus petite', () => {
  const steps = [step('x', 1, { next_step_id: 'y' }), step('y', 2, { next_step_id: 'x' })];
  strictEqual(pickFirstRootStep(steps)?.id, 'x');
});

// Europe/Paris est à UTC+2 le 2026-09-28 (lundi) et le 2026-09-25 (vendredi).
Deno.test('date : dans la plage, sans délai, part maintenant', () => {
  const now = new Date('2026-09-28T08:30:00Z'); // lundi 10:30 à Paris
  strictEqual(firstExecutionTime(now, {}, { start: 9, end: 18 }, 'Europe/Paris').toISOString(), now.toISOString());
});

Deno.test('date : avant la plage, ramenée à l’ouverture du jour', () => {
  const now = new Date('2026-09-28T04:00:00Z'); // lundi 06:00 à Paris
  strictEqual(
    firstExecutionTime(now, {}, { start: 9, end: 18 }, 'Europe/Paris').toISOString(),
    '2026-09-28T07:00:00.000Z',
  );
});

Deno.test('date : vendredi soir, reportée au lundi matin', () => {
  const now = new Date('2026-09-25T17:30:00Z'); // vendredi 19:30 à Paris
  strictEqual(
    firstExecutionTime(now, {}, { start: 9, end: 18 }, 'Europe/Paris').toISOString(),
    '2026-09-28T07:00:00.000Z',
  );
});

Deno.test('date : le délai de l’étape s’ajoute avant la plage', () => {
  const now = new Date('2026-09-28T08:30:00Z'); // lundi 10:30 à Paris
  strictEqual(
    firstExecutionTime(now, { days: 2 }, { start: 9, end: 18 }, 'Europe/Paris').toISOString(),
    '2026-09-30T08:30:00.000Z',
  );
});

Deno.test('date : fuseau invalide ou plage incohérente, repli Europe/Paris 9 h-18 h', () => {
  const now = new Date('2026-09-28T04:00:00Z');
  strictEqual(
    firstExecutionTime(now, {}, { start: 20, end: 3 }, 'Pas/UnFuseau').toISOString(),
    '2026-09-28T07:00:00.000Z',
  );
});
