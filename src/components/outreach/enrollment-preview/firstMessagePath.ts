/**
 * Premier message d'une inscription, dans les fenêtres d'inscription
 * (refonte mission, lot 5a) : même parcours que l'aperçu de la carte de
 * l'assistant (firstTextSteps, supabase/functions/_shared/enroll-preview.ts).
 *
 * Depuis la première étape racine (celle que pickFirstStep inscrit), on suit
 * le parcours principal du moteur jusqu'à la première étape qui porte un
 * message (`isMessage` : modèle écrit, ou rédaction par l'IA). Une invitation
 * sans note n'en porte pas : le parcours continue après elle.
 * - Fourche « Vérifier la relation » : la branche du candidat quand sa
 *   relation est connue (`connected`), sinon les deux, chacune avec sa
 *   condition. Branchement sur condition : les deux.
 * - Étape A/B : chaque version, la première puis « selon le tirage ».
 *
 * Module pur, sans import.
 */

export interface PathStep {
  stepId: string;
  stepOrder: number;
  actionType: string;
  parentStepId?: string | null;
  branch?: string | null;
  ifTrueGotoStep?: string | null;
  ifFalseGotoStep?: string | null;
  timeoutBranchStepId?: string | null;
  nextStepId?: string | null;
  variantGroup?: string | null;
  endsSequence?: boolean | null;
}

export interface FirstMessageEntry<T extends PathStep> {
  step: T;
  /** « Si déjà en relation », « Sinon », « Version B selon le tirage »… ; null sur un parcours unique. */
  condition: string | null;
}

export interface FirstMessagePathResult<T extends PathStep> {
  messages: FirstMessageEntry<T>[];
  /** Première action sans message du parcours (visite, vérification), null si le parcours commence par un message. */
  firstAction: T | null;
}

const FORK_LABELS: Record<string, { yes: string; no: string }> = {
  check_connection: { yes: 'Si déjà en relation', no: 'Sinon' },
  condition_branch: { yes: 'Si la condition est remplie', no: 'Sinon' },
};

const MAX_HOPS = 30;
const MAX_FORK_DEPTH = 3;

const isRoot = (s: PathStep) => !s.parentStepId && !s.branch;

function byOrder(a: PathStep, b: PathStep): number {
  return a.stepOrder - b.stepOrder || String(a.variantGroup ?? '').localeCompare(String(b.variantGroup ?? ''));
}

function nextRootAfter<T extends PathStep>(steps: readonly T[], order: number): T | null {
  return [...steps].filter((s) => isRoot(s) && s.stepOrder > order).sort(byOrder)[0] ?? null;
}

function isBranchTarget(steps: readonly PathStep[], id: string): boolean {
  return steps.some((s) => s.stepId !== id
    && [s.timeoutBranchStepId, s.ifTrueGotoStep, s.ifFalseGotoStep, s.nextStepId].includes(id));
}

/** Étape suivante du parcours principal (scheduleNextStep sans condition). */
function nextStepOf<T extends PathStep>(steps: readonly T[], step: T, depth = 0): T | null {
  if (step.endsSequence || depth > MAX_HOPS) return null;
  if (step.parentStepId && step.branch) {
    const sibling = [...steps]
      .filter((s) => s.parentStepId === step.parentStepId && s.branch === step.branch && s.stepOrder > step.stepOrder)
      .sort(byOrder)[0];
    if (sibling) return sibling;
    // Fin de branche : la suite est celle de l'étape parente.
    const parent = steps.find((s) => s.stepId === step.parentStepId);
    return parent ? nextStepOf(steps, parent, depth + 1) : null;
  }
  if (step.nextStepId) return steps.find((s) => s.stepId === step.nextStepId) ?? null;
  // Cible d'un branchement : pas de repli sur l'ordre (règle du moteur).
  if (isBranchTarget(steps, step.stepId)) return null;
  return nextRootAfter(steps, step.stepOrder);
}

/** Première étape d'une branche de fourche (saut explicite, enfant de la branche, sinon étape racine suivante). */
function forkTarget<T extends PathStep>(steps: readonly T[], step: T, yes: boolean): T | null {
  const goto = yes ? step.ifTrueGotoStep : step.ifFalseGotoStep;
  if (goto) return steps.find((s) => s.stepId === goto) ?? null;
  const child = [...steps]
    .filter((s) => s.parentStepId === step.stepId && s.branch === (yes ? 'yes' : 'no'))
    .sort(byOrder)[0];
  return child ?? nextRootAfter(steps, step.stepOrder);
}

/** Versions A/B d'une étape racine (même ordre, groupe renseigné), sinon l'étape seule. */
function variantsOf<T extends PathStep>(steps: readonly T[], step: T): FirstMessageEntry<T>[] {
  if (!step.variantGroup || !isRoot(step)) return [{ step, condition: null }];
  const rank = [...steps]
    .filter((s) => isRoot(s) && s.stepOrder === step.stepOrder && !!s.variantGroup)
    .sort(byOrder);
  if (rank.length < 2) return [{ step, condition: null }];
  return rank.map((s, i) => ({
    step: s,
    condition: i === 0 ? `Version ${s.variantGroup}` : `Version ${s.variantGroup} selon le tirage`,
  }));
}

const joinCondition = (prefix: string, condition: string | null) => (condition ? `${prefix} · ${condition}` : prefix);

function collect<T extends PathStep>(
  steps: readonly T[],
  start: T | null,
  isMessage: (step: T) => boolean,
  connected: boolean | null,
  seen: Set<string>,
  depth: number,
): FirstMessagePathResult<T> {
  let step = start;
  let firstAction: T | null = null;
  let hops = 0;
  while (step && hops < MAX_HOPS && !seen.has(step.stepId)) {
    seen.add(step.stepId);
    hops += 1;
    if (isMessage(step)) return { messages: variantsOf(steps, step), firstAction };
    if (!firstAction) firstAction = step;
    const fork = FORK_LABELS[step.actionType];
    if (fork && depth < MAX_FORK_DEPTH) {
      // Relation connue : le moteur suivra cette branche pour ce candidat.
      if (step.actionType === 'check_connection' && connected !== null) {
        const own = collect(steps, forkTarget(steps, step, connected), isMessage, connected, new Set(seen), depth + 1);
        return { messages: own.messages, firstAction };
      }
      const yes = collect(steps, forkTarget(steps, step, true), isMessage, connected, new Set(seen), depth + 1);
      const no = collect(steps, forkTarget(steps, step, false), isMessage, connected, new Set(seen), depth + 1);
      const key = (r: FirstMessagePathResult<T>) => r.messages.map((m) => `${m.step.stepId}:${m.condition ?? ''}`).join('|');
      // Les deux branches mènent au même message : aucune condition à afficher.
      if (key(yes) === key(no)) return { messages: yes.messages, firstAction };
      return {
        messages: [
          ...yes.messages.map((m) => ({ ...m, condition: joinCondition(fork.yes, m.condition) })),
          ...no.messages.map((m) => ({ ...m, condition: joinCondition(fork.no, m.condition) })),
        ],
        firstAction,
      };
    }
    step = nextStepOf(steps, step);
  }
  return { messages: [], firstAction };
}

/**
 * Premier message que recevra le candidat. `connected` : vrai s'il est déjà
 * en relation (1er degré), faux s'il ne l'est pas, null si on l'ignore.
 */
export function firstMessagePath<T extends PathStep>(
  steps: readonly T[],
  isMessage: (step: T) => boolean,
  connected: boolean | null = null,
): FirstMessagePathResult<T> {
  const roots = steps.filter(isRoot);
  const pool = roots.length > 0 ? roots : [...steps];
  const start = [...pool].sort(byOrder)[0] ?? null;
  return collect(steps, start, isMessage, connected, new Set<string>(), 0);
}
