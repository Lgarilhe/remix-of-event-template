// Panneau « Parcours de Claire Dubois » de la page d'une séquence (lot 5c-2) :
// le chemin d'un candidat sur le graphe de la séquence, tel que le moteur le
// joue. Module pur, testé sous Node (tests/ux/seq-v2-socle.test.mjs).
//
// Mêmes règles que l'onglet « Étapes » (src/lib/sequenceFlow.ts) et que le
// moteur (engineNextStepId) : départ à la première étape qu'aucun renvoi ne
// vise, fin de séquence, renvois, fourches de « Vérifier la connexion » et
// d'un branchement, issue « Pas acceptée » d'une attente avec étape de repli.
//
// - Une fourche jouée suit la branche prise (celle dont la tête a une
//   exécution) ; l'autre branche est dite « non prise », sans ses étapes
//   encore atteignables par ailleurs (une étape rejointe n'est pas « non prise »).
// - Une fourche pas encore jouée, ou une attente en cours, montre ses deux
//   issues (« Si acceptée », « Si pas acceptée après 10 jours »), chacune avec
//   le délai de sa première étape.
// - Une inscription close s'arrête à sa dernière étape jouée.

import {
  engineNextStepId,
  getPrimarySteps,
  isReferenced,
  rowToSequenceStep,
  type SequenceStepRow,
} from '../components/outreach/sequence/sequenceGraph.ts';
import {
  actionTypeLabel,
  formatSequenceError,
  formatSkipReason,
  isAiReviewPending,
  isHiddenActionType,
  isSentExecutionStatus,
} from './sequenceErrorMessages.ts';
import { clockTime, dayMonth, quotaBlockedLabel, whenLabel } from './enrollmentStatusLine.ts';
import { delayLabel } from './sequenceFlow.ts';
import { plural } from './plural.ts';

export type JourneyState = 'done' | 'current' | 'fail' | 'skip' | 'todo';

export interface JourneyExecution {
  id: string;
  step_id: string;
  step_order: number;
  status: string;
  scheduled_at: string;
  executed_at?: string | null;
  error_message?: string | null;
  skip_reason?: string | null;
  final_message?: string | null;
}

export interface JourneyStepItem<E extends JourneyExecution> {
  kind: 'step';
  key: string;
  /** Ligne jouée (version A/B comprise), sinon l'étape principale de l'ordre. */
  stepId: string;
  number: number;
  actionType: string;
  title: string;
  exec: E | null;
  state: JourneyState;
  detail: string;
}

export interface JourneyBranch<E extends JourneyExecution> {
  label: string;
  items: JourneyItem<E>[];
}

export type JourneyItem<E extends JourneyExecution> =
  | JourneyStepItem<E>
  | { kind: 'branches'; key: string; branches: JourneyBranch<E>[] }
  | { kind: 'not_taken'; key: string; label: string; steps: string[] }
  | { kind: 'join'; key: string; number: number; title: string }
  | { kind: 'end'; key: string; label: string };

export interface JourneyOptions {
  /** Inscription en cours ou en pause : la suite est « à venir ». Close : elle s'arrête à la dernière étape jouée. */
  live: boolean;
  /** L'inscription porte la trace d'un arrêt manuel (motif « Arrêt manuel » lu comme un arrêt). */
  manualStop?: boolean;
  now?: Date;
}

const DONE = new Set(['sent', 'opened', 'clicked', 'replied', 'skipped', 'cancelled', 'failed', 'executed']);
const PENDING = new Set(['scheduled', 'waiting_event', 'quota_blocked', 'sending']);
const WAIT_DEFAULT_DAYS = 3;
const MAX_DEPTH = 6;

const at = (iso: string) => `le ${dayMonth(iso)} à ${clockTime(new Date(iso))}`;
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** Libellés des deux issues d'une fourche, pour une branche à venir et pour une branche non prise. */
function forkLabels(actionType: string, days: number): { future: [string, string]; past: [string, string] } {
  if (actionType === 'check_connection') {
    return { future: ['Si connecté (1er degré)', 'Si non connecté'], past: ['Connecté (1er degré)', 'Non connecté'] };
  }
  if (actionType === 'wait_connection') {
    const after = `après ${plural(days, 'jour', 'jours')}`;
    return { future: ['Si acceptée', `Si pas acceptée ${after}`], past: ['Acceptée', `Pas acceptée ${after}`] };
  }
  return { future: ['Si la condition est remplie', 'Sinon'], past: ['Condition remplie', 'Condition non remplie'] };
}

export function buildJourney<E extends JourneyExecution>(
  rows: readonly SequenceStepRow[],
  executions: readonly E[],
  options: JourneyOptions,
): JourneyItem<E>[] {
  const now = options.now ?? new Date();
  const steps = rows.map(rowToSequenceStep);
  const byId = new Map(steps.map((s) => [s.id, s]));
  const primaries = getPrimarySteps(steps);
  const orders = [...new Set(primaries.map((s) => s.order))].sort((a, b) => a - b);
  const numberOf = (order: number) => orders.indexOf(order) + 1;
  const rowIdsAt = (order: number) => new Set(steps.filter((s) => s.order === order).map((s) => s.id));

  /** Exécution la plus récente d'un ordre d'étape (une version A/B est la même étape). */
  const execAt = (order: number): E | null => {
    const ids = rowIdsAt(order);
    return [...executions]
      .filter((e) => ids.has(e.step_id) || (!byId.has(e.step_id) && e.step_order === order))
      .sort((a, b) => Date.parse(b.scheduled_at) - Date.parse(a.scheduled_at))[0] ?? null;
  };
  const hasExec = (stepId: string | null | undefined) => {
    const step = stepId ? byId.get(stepId) : undefined;
    return !!step && !!execAt(step.order);
  };

  const rendered = new Set<string>();
  const pendingNotTaken: Array<{ item: { kind: 'not_taken'; key: string; label: string; steps: string[] }; head: string | null }> = [];

  const stepItem = (stepId: string, exec: E | null, state: JourneyState, detail: string): JourneyStepItem<E> => {
    const step = byId.get(exec?.step_id ?? '') ?? byId.get(stepId);
    const actionType = step?.actionType ?? 'message';
    const version = step?.variantGroup && steps.filter((s) => s.order === step.order && s.variantGroup).length > 1 ? step.variantGroup : null;
    return {
      kind: 'step',
      key: `step-${stepId}`,
      stepId: step?.id ?? stepId,
      number: numberOf(step?.order ?? -1),
      actionType,
      title: version ? `${actionTypeLabel(actionType)} · version ${version}` : actionTypeLabel(actionType),
      exec,
      state,
      detail,
    };
  };

  const execDetail = (exec: E, actionType: string): { state: JourneyState; detail: string } => {
    if (isSentExecutionStatus(exec.status) || exec.status === 'executed') {
      // Vérification, attente ou visite : rien n'est parti chez le candidat.
      const verb = isHiddenActionType(actionType) || actionType === 'profile_visit' ? 'Fait' : 'Envoyé';
      return { state: 'done', detail: exec.executed_at ? `${verb} ${at(exec.executed_at)}` : verb };
    }
    if (exec.status === 'failed') {
      return { state: 'fail', detail: `En échec : ${formatSequenceError(exec.error_message) || 'échec sans détail'}` };
    }
    if (exec.status === 'skipped' || exec.status === 'cancelled') {
      const reason = formatSkipReason(exec.skip_reason, { manualStop: options.manualStop });
      return { state: 'skip', detail: reason ? `Non envoyée : ${lowerFirst(reason)}` : 'Non envoyée' };
    }
    if (exec.status === 'waiting_event') return { state: 'current', detail: 'En attente' };
    if (exec.status === 'quota_blocked') return { state: 'current', detail: `${quotaBlockedLabel(actionType)}, nouvel essai ${whenLabel(exec.scheduled_at, now)}` };
    if (exec.status === 'sending') return { state: 'current', detail: 'Envoi en cours' };
    if (isAiReviewPending({ status: exec.status, error_message: exec.error_message ?? null, final_message: exec.final_message ?? null })) return { state: 'current', detail: 'Message rédigé par l’IA à relire avant l’envoi' };
    if (PENDING.has(exec.status)) return { state: 'current', detail: `Prévu ${whenLabel(exec.scheduled_at, now)}` };
    return { state: 'done', detail: 'Fait' };
  };

  /** Branche à venir : chaque étape « à venir » avec son délai ; la première avec le délai de l'issue. */
  const walkFuture = (startId: string | null, headDetail: string | null, depth: number): JourneyItem<E>[] => {
    const items: JourneyItem<E>[] = [];
    let id = startId;
    let first = true;
    for (let hops = 0; id && hops < 200; hops += 1) {
      const step = byId.get(id);
      if (!step) break;
      if (rendered.has(step.id)) {
        items.push({ kind: 'join', key: `join-${step.id}-${depth}-${hops}`, number: numberOf(step.order), title: actionTypeLabel(step.actionType) });
        return items;
      }
      rendered.add(step.id);
      const detail = first && headDetail ? headDetail : `À venir · ${delayLabel(step)}`;
      items.push(stepItem(step.id, null, 'todo', detail));
      first = false;
      const branches = forkBranches(step, null, depth);
      if (branches) {
        items.push(branches);
        return items;
      }
      id = linearNext(step);
    }
    items.push({ kind: 'end', key: `end-${startId}-${depth}`, label: 'Fin de la séquence' });
    return items;
  };

  /** Étape suivante hors fourche (attente de réponse avec repli : sans réponse, le moteur y passe). */
  const linearNext = (step: ReturnType<typeof rowToSequenceStep>): string | null =>
    step.actionType === 'wait_reply' && step.timeoutBranchStepId ? step.timeoutBranchStepId : engineNextStepId(step, steps);

  /** Têtes des deux issues d'une fourche, ou null si l'étape n'en est pas une. */
  const forkHeads = (step: ReturnType<typeof rowToSequenceStep>): [string | null, string | null] | null => {
    if (step.actionType === 'check_connection' || step.actionType === 'condition_branch') {
      const fallback = engineNextStepId(step, steps);
      return [step.ifTrueGotoStep ?? fallback, step.ifFalseGotoStep ?? fallback];
    }
    if (step.actionType === 'wait_connection' && step.timeoutBranchStepId) {
      return [engineNextStepId(step, steps), step.timeoutBranchStepId];
    }
    return null;
  };

  /** Les deux issues à venir d'une fourche pas encore jouée ou d'une attente en cours. */
  const forkBranches = (
    step: ReturnType<typeof rowToSequenceStep>,
    exec: E | null,
    depth: number,
  ): JourneyItem<E> | null => {
    const heads = forkHeads(step);
    if (!heads || depth >= MAX_DEPTH) return null;
    const days = step.timeoutDays ?? WAIT_DEFAULT_DAYS;
    const labels = forkLabels(step.actionType, days).future;
    const headDelay = (headId: string | null) => {
      const head = headId ? byId.get(headId) : undefined;
      return head ? delayLabel(head) : 'Aussitôt';
    };
    let details: [string | null, string | null] = [null, null];
    if (step.actionType === 'wait_connection') {
      const accepted = headDelay(heads[0]);
      const deadline = exec && Number.isFinite(Date.parse(exec.scheduled_at))
        ? new Date(Date.parse(exec.scheduled_at) + days * 86_400_000).toISOString()
        : null;
      details = [
        accepted === 'Aussitôt' ? 'À venir · dès l’acceptation' : `À venir · ${accepted.replace(/^Attendre /, '')} après l’acceptation`,
        deadline ? `À venir · à partir du ${dayMonth(deadline)}, sans acceptation` : `À venir · après ${plural(days, 'jour', 'jours')} sans acceptation`,
      ];
    }
    return {
      kind: 'branches',
      key: `branches-${step.id}`,
      branches: [
        { label: labels[0], items: walkFuture(heads[0], details[0], depth + 1) },
        { label: labels[1], items: walkFuture(heads[1], details[1], depth + 1) },
      ],
    };
  };

  // ── Chemin réel ─────────────────────────────────────────────────────────
  const items: JourneyItem<E>[] = [];
  const root = primaries.find((s) => !isReferenced(s, steps)) ?? primaries[0] ?? null;
  let id: string | null = root?.id ?? null;
  let ended = false;
  for (let hops = 0; id && hops < 200; hops += 1) {
    const step = byId.get(id);
    if (!step) break;
    if (rendered.has(step.id)) {
      items.push({ kind: 'join', key: `join-${step.id}`, number: numberOf(step.order), title: actionTypeLabel(step.actionType) });
      ended = true;
      break;
    }
    const exec = execAt(step.order);
    const heads = forkHeads(step);
    const next = heads ? null : linearNext(step);

    if (!exec) {
      // Étape sans exécution : passée si la suite a été jouée, sinon à venir (ou non jouée si l'inscription est close).
      if (!heads && next && hasExec(next)) {
        rendered.add(step.id);
        items.push(stepItem(step.id, null, 'skip', 'Non jouée'));
        id = next;
        continue;
      }
      if (!options.live) {
        items.push({ kind: 'end', key: 'end-closed', label: 'Étapes suivantes non jouées' });
        ended = true;
        break;
      }
      rendered.add(step.id);
      items.push(stepItem(step.id, null, 'todo', `À venir · ${delayLabel(step)}`));
      if (heads) {
        const branches = forkBranches(step, null, 0);
        if (branches) items.push(branches);
        ended = true;
        break;
      }
      id = next;
      continue;
    }

    rendered.add(step.id);
    const { state, detail } = execDetail(exec, byId.get(exec.step_id)?.actionType ?? step.actionType);
    items.push(stepItem(step.id, exec, state, detail));

    if (heads) {
      const decided = DONE.has(exec.status) && state !== 'fail';
      const taken = !decided ? null : heads[0] && hasExec(heads[0]) ? 0 : heads[1] && hasExec(heads[1]) ? 1 : null;
      if (taken === null) {
        // Fourche pas encore jouée ou attente en cours : ses deux issues. Close : rien d'autre n'a été joué.
        if (options.live && !decided) {
          const branches = forkBranches(step, exec, 0);
          if (branches) items.push(branches);
        }
        ended = true;
        break;
      }
      const other = taken === 0 ? 1 : 0;
      if (heads[other] && heads[other] !== heads[taken]) {
        const label = forkLabels(step.actionType, step.timeoutDays ?? WAIT_DEFAULT_DAYS).past[other];
        const item = { kind: 'not_taken' as const, key: `not-taken-${step.id}`, label, steps: [] as string[] };
        items.push(item);
        pendingNotTaken.push({ item, head: heads[other] });
      }
      id = heads[taken];
      continue;
    }
    // Étape terminée, en échec ou en attente : une inscription close ou une étape en cours n'a pas de suite jouée.
    if (state === 'current' || state === 'fail') {
      if (options.live) items.push(...(next ? walkFuture(next, null, 1) : [{ kind: 'end' as const, key: 'end', label: 'Fin de la séquence' }]));
      ended = true;
      break;
    }
    id = next;
  }
  // Fin du graphe atteinte sur le chemin réel.
  if (!ended && items.length > 0) items.push({ kind: 'end', key: 'end', label: 'Fin de la séquence' });

  // Branches non prises : leurs étapes qui n'apparaissent nulle part ailleurs dans le parcours.
  for (const { item, head } of pendingNotTaken) {
    const seen = new Set<string>();
    const queue = head ? [head] : [];
    while (queue.length > 0) {
      const sid = queue.shift() as string;
      if (seen.has(sid) || rendered.has(sid)) continue;
      seen.add(sid);
      const step = byId.get(sid);
      if (!step) continue;
      // Attentes et vérifications : parcourues, pas nommées (rien ne part chez le candidat).
      if (!isHiddenActionType(step.actionType)) item.steps.push(`${numberOf(step.order)} · ${actionTypeLabel(step.actionType)}`);
      const heads = forkHeads(step);
      for (const nextId of heads ?? [linearNext(step)]) if (nextId) queue.push(nextId);
    }
  }
  return items.filter((i) => i.kind !== 'not_taken' || i.steps.length > 0);
}
