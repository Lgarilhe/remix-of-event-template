// Éditeur unique de séquence (lot 5d-2) : règles pures du fil éditable.
// Module sans dépendance applicative à l'exécution, testé sous Node
// (tests/ux/seq-v2-editeur.test.mjs).
//
// L'état d'édition est un tableau de SequenceStep (src/types/sequence.ts),
// celui qu'enregistre useSequenceSave. Chaque geste produit les mêmes étapes
// que l'ancien éditeur pour la même intention :
// - ajout au bout du fil principal : étape de la liste (createEmptyStep de
//   SequenceBuilder, délai de 2 jours sauf en première étape), reliée par
//   chainAfterLastMainStep ;
// - ajout dans une branche : étape de l'onglet Visuel (délai nul), reliée
//   depuis la dernière étape de la branche ou depuis la fourche quand la
//   branche est vide ;
// - suppression : removeStepFromSequence ; version B ou C : addVariantToSteps.
// Le fil suit les règles du moteur (engineNextStepId, comme sequenceFlow.ts) :
// départ à la première étape qu'aucun renvoi ne vise, fourches de « Vérifier
// la connexion » et de l'attente de connexion avec étape de repli, une étape
// déjà dessinée rejointe au lieu d'être répétée.

import type { SequenceStep } from '../types/sequence';
import {
  SEND_WINDOW_HELP,
  effectiveTimeoutAction,
  engineNextStepId,
  getPrimarySteps,
  isReferenced,
  stepTypeLabel,
  unsupportedStepNotice,
  withoutInvitationAi,
  type SequenceIssue,
  type SequenceValidation,
  type StepBranch,
  type StepPosition,
} from '../components/outreach/sequence/sequenceGraph.ts';
import { delayLabel, templateExcerpt } from './sequenceFlow.ts';
import { plural } from './plural.ts';

type Step = SequenceStep;
type ActionType = Step['actionType'];

const END = '__end__';

/**
 * Phrase du créneau d'envoi (SEND_WINDOW_HELP), avec l'apostrophe
 * typographique des textes de l'éditeur ; l'ancien éditeur garde la sienne.
 */
export const SEND_WINDOW_TEXT = SEND_WINDOW_HELP.replace(/'/g, '’');
const MAX_DEPTH = 12;
const WAIT_DEFAULT_DAYS = 3;

// ── Ouverture ─────────────────────────────────────────────────────────────

/**
 * Étapes d'une séquence ouverte dans l'éditeur, après la lecture de
 * handleEdit (src/lib/sequenceActions.ts) : même transformation que
 * SequenceBuilder à l'ouverture (invitation « IA » : la note saisie part).
 */
export function openEditorSteps(steps: Step[]): Step[] {
  return withoutInvitationAi(steps);
}

// ── Nouvelles étapes ──────────────────────────────────────────────────────

// Événement attendu, comme TRIGGERS de SequenceBuilder.
const LIST_WAIT_EVENTS: Partial<Record<ActionType, Step['waitForEvent']>> = {
  wait_connection: 'connection_accepted',
  wait_reply: 'reply_received',
  wait_profile_visit: 'profile_visited',
};

/** Étape ajoutée au fil principal : createEmptyStep de l'ancienne liste. */
export function newListStep(id: string, order: number, actionType: ActionType): Step {
  return {
    id,
    order,
    actionType,
    conditionType: 'always',
    delayDays: order === 0 ? 0 : 2,
    delayHours: 0,
    delayMinutes: 0,
    preferredHourStart: 9,
    preferredHourEnd: 18,
    useAiPersonalization: false,
    aiTone: 'professional',
    timeoutDays: 3,
    timeoutAction: 'skip',
    waitForEvent: LIST_WAIT_EVENTS[actionType],
  };
}

/** Étape ajoutée dans une branche : createEmptyStep de l'ancien onglet Visuel. */
export function newBranchStep(id: string, order: number, actionType: ActionType): Step {
  return {
    id,
    order,
    actionType,
    conditionType: 'always',
    delayDays: 0,
    delayHours: 0,
    delayMinutes: 0,
    preferredHourStart: 9,
    preferredHourEnd: 18,
    useAiPersonalization: false,
    aiTone: 'professional',
    timeoutDays: 3,
    timeoutAction: 'skip',
    waitForEvent: actionType === 'wait_connection' ? 'connection_accepted' : actionType === 'wait_reply' ? 'reply_received' : undefined,
  };
}

// ── Versions A, B et C ────────────────────────────────────────────────────

/** Types qui acceptent des versions (canABTest de l'ancien éditeur). */
const VERSIONED_TYPES = new Set<string>(['inmail', 'email', 'message', 'smart_message', 'connection_request', 'whatsapp_message']);
export const MAX_VERSIONS = 3;

export function canHaveVersions(actionType: string): boolean {
  return VERSIONED_TYPES.has(actionType);
}

/** Étape jouée à la place de ses versions B et C : la version A, ou l'étape simple. */
export function primaryOf(steps: readonly Step[], stepId: string): Step | undefined {
  const step = steps.find((s) => s.id === stepId);
  if (!step) return undefined;
  if (!step.variantGroup) return step;
  const group = steps.filter((s) => s.order === step.order);
  return group.find((s) => !s.variantGroup) ?? group.find((s) => s.variantGroup === 'A') ?? step;
}

/** Versions d'une étape, A d'abord ; une étape simple est sa seule version. */
export function versionsOf(steps: readonly Step[], stepId: string): Step[] {
  const primary = primaryOf(steps, stepId);
  if (!primary) return [];
  if (!primary.variantGroup) return [primary];
  return steps
    .filter((s) => s.order === primary.order && s.variantGroup)
    .sort((a, b) => String(a.variantGroup).localeCompare(String(b.variantGroup)));
}

/** Champs propres à chaque version ; les autres réglages valent pour toutes les versions de l'étape. */
export const VERSION_FIELDS = ['variantWeight', 'useAiPersonalization', 'aiTone', 'subjectTemplate', 'messageTemplate'] as const;

/** Mise à jour d'une seule ligne (version A, B ou C). */
export function updateVersion(steps: Step[], versionId: string, updates: Partial<Step>): Step[] {
  return steps.map((s) => (s.id === versionId ? { ...s, ...updates } : s));
}

/**
 * Réglage commun (délai, créneau, condition, suite, attente) : écrit sur
 * chaque version de l'étape, pour que la version tirée au sort se comporte
 * comme la version A.
 */
export function updateStepGroup(steps: Step[], stepId: string, updates: Partial<Step>): Step[] {
  const ids = new Set(versionsOf(steps, stepId).map((s) => s.id));
  return steps.map((s) => (ids.has(s.id) ? { ...s, ...updates } : s));
}

// ── Suite d'une étape ─────────────────────────────────────────────────────

/**
 * « Après cette étape » : continuer (ordre ou renvoi existant effacé),
 * terminer la séquence, ou aller à une étape choisie.
 */
export function setAfterStep(steps: Step[], stepId: string, value: 'continue' | 'end' | string): Step[] {
  const nextStepId = value === 'continue' ? undefined : value === 'end' ? END : value;
  return updateStepGroup(steps, stepId, { nextStepId });
}

/** Valeur actuelle de « Après cette étape ». */
export function afterStepValue(step: Pick<Step, 'nextStepId'>): 'continue' | 'end' | string {
  if (step.nextStepId === END) return 'end';
  return step.nextStepId ?? 'continue';
}

/**
 * Où mène « Continuer » (aucun renvoi écrit) pour le moteur : l'étape d'ordre
 * suivant, sauf pour une étape visée par un renvoi (première étape d'une
 * branche, étape rejointe), après laquelle le moteur arrête la séquence
 * (`null`).
 */
export function continueTarget(steps: Step[], stepId: string): string | null {
  const step = primaryOf(steps, stepId);
  if (!step) return null;
  const next = engineNextStepId({ ...step, nextStepId: undefined }, steps);
  return next ? primaryOf(steps, next)?.id ?? next : null;
}

// ── Ajout à un endroit du fil ─────────────────────────────────────────────

const FORK_TYPES = new Set<string>(['check_connection', 'condition_branch']);

function nextGreaterOrder(steps: readonly Step[], order: number): number | undefined {
  let best: number | undefined;
  for (const s of steps) if (s.order > order && (best === undefined || s.order < best)) best = s.order;
  return best;
}

function primaryAtOrder(steps: readonly Step[], order: number): Step | undefined {
  const rows = steps.filter((s) => s.order === order);
  return rows.find((r) => !r.variantGroup) ?? rows.find((r) => r.variantGroup === 'A') ?? rows[0];
}

/** Ordre suivant : où va une branche de vérification sans étape choisie. */
function orderFallback(steps: readonly Step[], step: Step): string | null {
  const order = nextGreaterOrder(steps, step.order);
  return order === undefined ? null : primaryAtOrder(steps, order)?.id ?? null;
}

function nextOrder(steps: readonly Step[]): number {
  return steps.length === 0 ? 0 : Math.max(...steps.map((s) => s.order)) + 1;
}

/** Ce qui suit une étape dans le fil (une attente de réponse avec repli continue vers son repli). */
function continuationOf(step: Step, steps: Step[]): string | null {
  if (step.actionType === 'wait_reply' && step.timeoutBranchStepId) return step.timeoutBranchStepId;
  return engineNextStepId(step, steps);
}

/** Attente de connexion avec repli : fourche « Acceptée / Pas acceptée ». */
function isWaitFork(step: Step): boolean {
  return step.actionType === 'wait_connection' && effectiveTimeoutAction(step) === 'alternative_step';
}

/** Étapes du fil principal (avant la première fourche), dans l'ordre joué. */
function rootChain(steps: Step[]): Step[] {
  const primaries = getPrimarySteps(steps);
  const root = primaries.find((s) => !isReferenced(s, steps)) ?? primaries[0];
  const chain: Step[] = [];
  const seen = new Set<string>();
  let current: Step | undefined = root;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.push(current);
    if (FORK_TYPES.has(current.actionType) || isWaitFork(current)) break;
    const nextId = continuationOf(current, steps);
    current = nextId ? primaryOf(steps, nextId) : undefined;
  }
  return chain;
}

export interface AddResult {
  steps: Step[];
  /** Étape créée, `null` si l'emplacement n'existe plus. */
  newStepId: string | null;
}

/**
 * Le moteur ne fait jamais passer à l'ordre suivant une étape visée par un
 * renvoi. Un geste qui fait viser une étape qui suivait l'ordre (branche de
 * vérification épinglée, nouvelle étape qui rejoint la suite) couperait donc
 * tout ce qui la suivait. Cette suite est écrite explicitement, de proche en
 * proche (chaque renvoi écrit peut à son tour faire viser l'étape suivante),
 * pour que le parcours reste celui d'avant le geste.
 */
function keepOrderLinks(before: Step[], after: Step[]): Step[] {
  const known = new Set(before.map((s) => s.id));
  const nextBefore = new Map<string, string>();
  for (const s of getPrimarySteps(before)) {
    if (FORK_TYPES.has(s.actionType) || s.nextStepId || isReferenced(s, before)) continue;
    const next = engineNextStepId(s, before);
    if (next) nextBefore.set(s.id, next);
  }
  let steps = after;
  for (let pass = 0; pass < steps.length + 1; pass += 1) {
    const cut = getPrimarySteps(steps).find((s) => known.has(s.id) && !s.nextStepId && nextBefore.has(s.id) && isReferenced(s, steps));
    if (!cut) return steps;
    const next = nextBefore.get(cut.id);
    const ids = new Set(versionsOf(steps, cut.id).map((s) => s.id));
    steps = steps.map((s) => (ids.has(s.id) && !s.nextStepId ? { ...s, nextStepId: next } : s));
  }
  return steps;
}

/**
 * Ajoute une étape `actionType` à l'emplacement `position` (celui que donne
 * le fil). Ne juge pas le type : la palette le fait par isStepAllowedAt.
 * - séquence vide : première étape ;
 * - au bout du fil principal : comme la liste de l'ancien éditeur ;
 * - branche vide d'une vérification : la fourche y renvoie (l'autre branche,
 *   si elle n'a pas d'étape choisie, garde explicitement l'étape où elle
 *   allait, avec toute sa suite, pour ne pas devenir une branche vide) ;
 * - branche « Pas acceptée » d'une attente : étape de repli ;
 * - après une étape : la nouvelle étape prend sa place dans le fil, et ce
 *   qui suivait (étape rejointe) la suit.
 */
export function addStepAt(steps: Step[], position: StepPosition, actionType: ActionType, newId: string): AddResult {
  const order = nextOrder(steps);
  const none: AddResult = { steps, newStepId: null };

  if (position.afterStepId === null) {
    if (steps.length > 0) return none;
    return { steps: [newListStep(newId, 0, actionType)], newStepId: newId };
  }

  const after = primaryOf(steps, position.afterStepId);
  if (!after) return none;

  if (position.branch === 'true' || position.branch === 'false') {
    if (after.actionType !== 'check_connection') return none;
    const field = position.branch === 'true' ? 'ifTrueGotoStep' : 'ifFalseGotoStep';
    const other = position.branch === 'true' ? 'ifFalseGotoStep' : 'ifTrueGotoStep';
    const fallback = orderFallback(steps, after);
    const created = newBranchStep(newId, order, actionType);
    // Branche qui renvoie déjà vers une étape dessinée ailleurs : la nouvelle étape s'intercale.
    const current = after[field];
    if (current) created.nextStepId = current;
    const next = steps.map((s) => {
      if (s.id !== after.id) return s;
      const updated: Step = { ...s, [field]: newId };
      if (!s[other] && fallback) updated[other] = fallback;
      return updated;
    });
    return { steps: keepOrderLinks(steps, [...next, created]), newStepId: newId };
  }

  if (position.branch === 'timeout') {
    if (after.actionType !== 'wait_connection' && after.actionType !== 'wait_reply') return none;
    const created = newBranchStep(newId, order, actionType);
    if (after.timeoutBranchStepId) created.nextStepId = after.timeoutBranchStepId;
    const next = steps.map((s) => (s.id === after.id ? { ...s, timeoutAction: 'alternative_step' as const, timeoutBranchStepId: newId } : s));
    return { steps: [...next, created], newStepId: newId };
  }

  if (FORK_TYPES.has(after.actionType)) return none;

  // Bout du fil principal (pas la branche « Acceptée » d'une attente) : même geste que la liste de l'ancien éditeur.
  const chain = rootChain(steps);
  const rootTail = chain[chain.length - 1]?.id === after.id && !isWaitFork(after);
  const continuation = continuationOf(after, steps);
  const mains = getPrimarySteps(steps);
  if (rootTail && continuation === null && after.nextStepId !== END && mains[mains.length - 1]?.id === after.id) {
    const created = newListStep(newId, order, actionType);
    const linked = chainAfterLast(steps, after, newId);
    return { steps: [...linked, created], newStepId: newId };
  }

  // Ailleurs : la nouvelle étape suit `after`, et reprend ce qui la suivait,
  // « Fin de la séquence » comprise : la retirer ensuite rend la fin à `after`.
  const created = rootTail ? newListStep(newId, order, actionType) : newBranchStep(newId, order, actionType);
  if (continuation && continuation !== newId) created.nextStepId = continuation;
  else if (after.nextStepId === END) created.nextStepId = END;
  const groupIds = new Set(versionsOf(steps, after.id).map((s) => s.id));
  const linked = steps.map((s) => {
    if (!groupIds.has(s.id)) return s;
    if (after.actionType === 'wait_reply' && after.timeoutBranchStepId) return { ...s, timeoutBranchStepId: newId };
    return { ...s, nextStepId: newId };
  });
  return { steps: keepOrderLinks(steps, [...linked, created]), newStepId: newId };
}

/**
 * chainAfterLastMainStep de l'ancien éditeur, sur l'étape déjà trouvée : la
 * dernière étape n'est reliée que si elle est visée par un renvoi (sinon
 * l'ordre suffit au moteur). L'ancienne règle ne regardait que « Étape
 * suivante » : une dernière étape visée par un repli laissait la nouvelle
 * étape hors du parcours (le moteur s'arrête après une cible de renvoi).
 */
function chainAfterLast(steps: Step[], last: Step, newId: string): Step[] {
  if (last.nextStepId) return steps;
  if (!isReferenced(last, steps)) return steps;
  return steps.map((s) => (s.order === last.order && !s.nextStepId && (s.id === last.id || s.variantGroup) ? { ...s, nextStepId: newId } : s));
}

// ── Déplacer une étape ────────────────────────────────────────────────────

interface Edge { from: string; to: string; kind: string }

function engineEdges(steps: Step[]): Edge[] {
  const edges: Edge[] = [];
  for (const s of getPrimarySteps(steps)) {
    if (FORK_TYPES.has(s.actionType)) {
      const fallback = orderFallback(steps, s);
      const t = s.ifTrueGotoStep ?? fallback;
      const f = s.ifFalseGotoStep ?? fallback;
      if (t) edges.push({ from: s.id, to: primaryOf(steps, t)?.id ?? t, kind: 'true' });
      if (f) edges.push({ from: s.id, to: primaryOf(steps, f)?.id ?? f, kind: 'false' });
      continue;
    }
    const next = engineNextStepId(s, steps);
    if (next) edges.push({ from: s.id, to: primaryOf(steps, next)?.id ?? next, kind: 'next' });
    if (s.timeoutBranchStepId) edges.push({ from: s.id, to: primaryOf(steps, s.timeoutBranchStepId)?.id ?? s.timeoutBranchStepId, kind: 'timeout' });
  }
  return edges;
}

const edgeKey = (e: Edge) => `${e.from}>${e.to}:${e.kind}`;

function startOf(steps: Step[]): string | null {
  const primaries = getPrimarySteps(steps);
  return (primaries.find((s) => !isReferenced(s, steps)) ?? primaries[0])?.id ?? null;
}

function swapOrders(steps: Step[], a: number, b: number): Step[] {
  return steps.map((s) => (s.order === a ? { ...s, order: b } : s.order === b ? { ...s, order: a } : s));
}

export interface MoveCheck {
  allowed: boolean;
  reason: string | null;
}

const MOVE_LINKED = 'Cette étape est reliée à une fourche ou à une étape de repli : elle ne peut pas changer de place.';

/** Étape `upper` suivie de la seule étape `lower` : les échanger, sinon `null`. */
function swapAdjacent(steps: Step[], upper: Step, lower: Step): Step[] | null {
  for (const s of [upper, lower]) {
    if (FORK_TYPES.has(s.actionType) || s.timeoutBranchStepId) return null;
  }
  const edges = engineEdges(steps);
  const out = edges.filter((e) => e.from === upper.id);
  const into = edges.filter((e) => e.to === lower.id);
  if (out.length !== 1 || out[0].to !== lower.id || into.length !== 1 || into[0].from !== upper.id) return null;

  // Parcours attendu : ce qui menait à `upper` mène à `lower`, `lower` mène à `upper`, `upper` reprend la suite de `lower`.
  const expected = new Set(edges.map((e) => {
    if (e.from === upper.id && e.to === lower.id) return edgeKey({ from: lower.id, to: upper.id, kind: e.kind });
    if (e.from === lower.id) return edgeKey({ ...e, from: upper.id });
    if (e.to === upper.id) return edgeKey({ ...e, to: lower.id });
    return edgeKey(e);
  }));
  const start = startOf(steps);
  const expectedStart = start === upper.id ? lower.id : start;
  const matches = (candidate: Step[]) => {
    const got = engineEdges(candidate).map(edgeKey);
    return got.length === expected.size && got.every((k) => expected.has(k)) && startOf(candidate) === expectedStart;
  };

  // 1. Échanger les ordres suffit quand le fil suit l'ordre des étapes.
  const swapped = swapOrders(steps, upper.order, lower.order);
  if (matches(swapped)) return swapped;

  // 2. Sinon, relier explicitement : renvois vers `upper` portés sur `lower`.
  const lowerNext = lower.nextStepId === END ? END : (engineNextStepId(lower, steps) ?? undefined);
  const upperIds = new Set(versionsOf(steps, upper.id).map((s) => s.id));
  const lowerIds = new Set(versionsOf(steps, lower.id).map((s) => s.id));
  const retarget = (ref: string | undefined) => (ref && upperIds.has(ref) ? lower.id : ref);
  const relinked = swapOrders(steps.map((s) => {
    if (lowerIds.has(s.id)) return { ...s, nextStepId: upper.id };
    if (upperIds.has(s.id)) return { ...s, nextStepId: lowerNext };
    return {
      ...s,
      nextStepId: retarget(s.nextStepId),
      ifTrueGotoStep: retarget(s.ifTrueGotoStep),
      ifFalseGotoStep: retarget(s.ifFalseGotoStep),
      timeoutBranchStepId: retarget(s.timeoutBranchStepId),
    };
  }), upper.order, lower.order);
  return matches(relinked) ? relinked : null;
}

function neighbours(steps: Step[], step: Step): { previous: Step | null; next: Step | null } {
  const edges = engineEdges(steps);
  const into = edges.filter((e) => e.to === step.id);
  const out = edges.filter((e) => e.from === step.id);
  const previous = into.length === 1 && into[0].kind === 'next' ? primaryOf(steps, into[0].from) ?? null : null;
  const next = out.length === 1 && out[0].kind === 'next' ? primaryOf(steps, out[0].to) ?? null : null;
  return { previous, next };
}

/** Monter ou descendre une étape d'un cran dans son fil, versions comprises. `null` si impossible. */
export function moveStep(steps: Step[], stepId: string, direction: 'up' | 'down'): Step[] | null {
  const step = primaryOf(steps, stepId);
  if (!step) return null;
  const { previous, next } = neighbours(steps, step);
  if (direction === 'up') return previous ? swapAdjacent(steps, previous, step) : null;
  return next ? swapAdjacent(steps, step, next) : null;
}

export function canMoveStep(steps: Step[], stepId: string, direction: 'up' | 'down'): MoveCheck {
  const step = primaryOf(steps, stepId);
  if (!step) return { allowed: false, reason: 'Étape introuvable.' };
  if (FORK_TYPES.has(step.actionType) || step.timeoutBranchStepId) return { allowed: false, reason: MOVE_LINKED };
  const { previous, next } = neighbours(steps, step);
  const other = direction === 'up' ? previous : next;
  if (!other) return { allowed: false, reason: direction === 'up' ? 'Rien à monter : c’est la première étape de ce fil.' : 'Rien à descendre : c’est la dernière étape de ce fil.' };
  return moveStep(steps, stepId, direction) ? { allowed: true, reason: null } : { allowed: false, reason: MOVE_LINKED };
}

// ── Fil éditable ──────────────────────────────────────────────────────────

export interface EditorStepNode {
  kind: 'step';
  id: string;
  number: number;
  actionType: ActionType;
  title: string;
  /** Début du message, variables en clair. */
  excerpt: string | null;
  /** Explication d'une étape sans message (attente, visite). */
  description: string | null;
  /** « Attendre 2 jours », « Aussitôt ». */
  delay: string;
  /** Délai dessiné au-dessus de la carte (pas sur la première étape, pas sur une première étape de branche sans délai). */
  showDelay: boolean;
  badges: string[];
  /** Identifiants des versions, A d'abord. */
  versionIds: string[];
  /** Type fermé : ce que fait le moteur. */
  notice: string | null;
  /** Attente de connexion sans repli : phrase sous la carte. */
  note: string | null;
}

export interface EditorBranch {
  key: string;
  label: string;
  /** 'yes' : Connecté, Acceptée, condition remplie ; 'no' : l'autre branche. */
  tone: 'yes' | 'no';
  nodes: EditorNode[];
  /** Où ajoute « Ajouter une étape » sous la dernière carte ; `null` quand la branche finit par une fourche. */
  add: StepPosition | null;
}

export interface EditorForkNode extends Omit<EditorStepNode, 'kind' | 'note'> {
  kind: 'fork';
  branches: EditorBranch[];
}

export interface EditorJoinNode {
  kind: 'join';
  targetId: string;
  number: number;
  title: string;
}

export interface EditorEndNode {
  kind: 'end';
}

export type EditorNode = EditorStepNode | EditorForkNode | EditorJoinNode | EditorEndNode;

export interface StepPlacement {
  /** Branche la plus proche (« Connecté (1er degré) »), `null` dans le fil principal. */
  branch: string | null;
  /** Numéro de l'étape précédente, `null` pour la première. */
  afterNumber: number | null;
  delay: string;
}

export interface EditorFlow {
  start: string;
  nodes: EditorNode[];
  /** « Ajouter une étape » du fil principal ; `{ afterStepId: null }` pour une séquence vide. */
  add: StepPosition | null;
  /** Étapes qu'aucun chemin du fil ne dessine : montrées à part, pour rester modifiables et supprimables. */
  orphans: EditorStepNode[];
  stepCount: number;
  /** Numéro de chaque étape (versions comprises). */
  numbers: Map<string, number>;
  placements: Map<string, StepPlacement>;
}

const CONDITION_BADGES: Partial<Record<Step['conditionType'], string>> = {
  if_connected: 'Seulement si en relation',
  if_not_connected: 'Seulement si pas en relation',
  if_no_response: 'Seulement sans réponse',
  if_score_above: 'Seulement au-dessus d’une note',
};

function stepDescription(step: Step): string | null {
  const days = step.timeoutDays ?? WAIT_DEFAULT_DAYS;
  switch (step.actionType) {
    case 'profile_visit': return 'Le candidat est notifié de votre visite.';
    case 'check_connection': return 'Deux branches selon que le candidat est déjà en relation ou non.';
    case 'condition_branch': return 'Deux branches selon la condition de l’étape.';
    case 'wait_connection': return `Attendre que l’invitation soit acceptée, ${plural(days, 'jour', 'jours')} au plus.`;
    case 'wait_reply': return `Attendre une réponse, ${plural(days, 'jour', 'jours')} au plus. Une réponse arrête la séquence.`;
    case 'wait_profile_visit': return `Attendre une visite de profil, ${plural(days, 'jour', 'jours')} au plus.`;
    case 'connection_request': return step.messageTemplate?.trim() ? null : 'Invitation sans note : le candidat reçoit seulement votre demande de mise en relation.';
    case 'smart_message': return step.useAiPersonalization ? 'Message rédigé par l’IA Konekt pour chaque candidat, relu avant l’inscription.' : null;
    default: return null;
  }
}

const hasDelay = (s: Step) => (s.delayDays || 0) > 0 || (s.delayHours || 0) > 0 || (s.delayMinutes || 0) > 0;

export function buildEditorFlow(steps: Step[]): EditorFlow {
  const primaries = getPrimarySteps(steps);
  const orders = [...new Set(primaries.map((s) => s.order))].sort((a, b) => a - b);
  const numberOfOrder = (order: number) => orders.indexOf(order) + 1;
  const numbers = new Map(steps.map((s) => [s.id, numberOfOrder(s.order)]));
  const placements = new Map<string, StepPlacement>();

  const badgesOf = (step: Step, versionIds: string[]): string[] => {
    const badges: string[] = [];
    if (versionIds.length > 1) badges.push(`A/B · ${versionIds.length} versions`);
    if (step.actionType === 'connection_request' && step.messageTemplate?.trim()) badges.push('avec note');
    if (step.useAiPersonalization && step.actionType !== 'smart_message' && step.actionType !== 'connection_request') badges.push('Rédigé par l’IA');
    if (step.preferredHourStart !== 9 || step.preferredHourEnd !== 18) badges.push(`Créneau ${step.preferredHourStart} h-${step.preferredHourEnd} h`);
    const condition = CONDITION_BADGES[step.conditionType];
    if (condition) badges.push(condition);
    if (unsupportedStepNotice(step.actionType)) badges.push('Non pris en charge');
    return badges;
  };

  const rendered = new Set<string>();
  interface Walked { nodes: EditorNode[]; lastStepId: string | null; endsWithFork: boolean }

  const walk = (startId: string | null, depth: number, branch: string | null, parentNumber: number | null): Walked => {
    const nodes: EditorNode[] = [];
    let id = startId;
    let lastStepId: string | null = null;
    let previousNumber = parentNumber;
    let hops = 0;
    while (id && hops < 400) {
      hops += 1;
      const step = primaryOf(steps, id);
      if (!step) break;
      if (rendered.has(step.id)) {
        nodes.push({ kind: 'join', targetId: step.id, number: numberOfOrder(step.order), title: stepTypeLabel(step.actionType) });
        return { nodes, lastStepId, endsWithFork: false };
      }
      rendered.add(step.id);
      const number = numberOfOrder(step.order);
      const versionIds = versionsOf(steps, step.id).map((s) => s.id);
      const isFirstOfRoot = branch === null && previousNumber === null;
      const isFirstOfBranch = branch !== null && nodes.length === 0;
      const delay = delayLabel(step);
      for (const vid of versionIds) placements.set(vid, { branch, afterNumber: previousNumber, delay });
      const base = {
        id: step.id,
        number,
        actionType: step.actionType,
        title: stepTypeLabel(step.actionType),
        excerpt: step.actionType === 'smart_message' && step.useAiPersonalization ? null : templateExcerpt(step.messageTemplate),
        description: stepDescription(step),
        delay,
        showDelay: !isFirstOfRoot && (!isFirstOfBranch || hasDelay(step)),
        badges: badgesOf(step, versionIds),
        versionIds,
        notice: unsupportedStepNotice(step.actionType),
      };
      lastStepId = step.id;
      previousNumber = number;

      const isCheck = FORK_TYPES.has(step.actionType);
      if ((isCheck || isWaitFork(step)) && depth < MAX_DEPTH) {
        const branches: EditorBranch[] = [];
        const addBranch = (key: string, label: string, tone: 'yes' | 'no', target: string | null, emptyAdd: StepPosition | null) => {
          const walked = walk(target, depth + 1, label, number);
          branches.push({
            key: `${step.id}:${key}`,
            label,
            tone,
            nodes: walked.nodes,
            add: walked.endsWithFork ? null : walked.lastStepId ? { afterStepId: walked.lastStepId } : emptyAdd,
          });
        };
        if (isCheck) {
          // Sans étape choisie des deux côtés, les deux branches suivent l'ordre (comme le moteur). Une seule
          // choisie : l'autre est dessinée vide, comme validateSequence la signale (bloquant), en attente d'une étape.
          const fallback = orderFallback(steps, step);
          const { ifTrueGotoStep: onTrue, ifFalseGotoStep: onFalse } = step;
          const connection = step.actionType === 'check_connection';
          const branchAdd = (b: StepBranch): StepPosition | null => (connection ? { afterStepId: step.id, branch: b } : null);
          addBranch('true', connection ? 'Connecté (1er degré)' : 'Si la condition est remplie', 'yes', onTrue ?? (onFalse ? null : fallback), branchAdd('true'));
          addBranch('false', connection ? 'Non connecté' : 'Sinon', 'no', onFalse ?? (onTrue ? null : fallback), branchAdd('false'));
        } else {
          const days = step.timeoutDays ?? WAIT_DEFAULT_DAYS;
          addBranch('accepted', 'Acceptée', 'yes', engineNextStepId(step, steps), { afterStepId: step.id });
          addBranch('timeout', `Pas acceptée après ${plural(days, 'jour', 'jours')}`, 'no', step.timeoutBranchStepId ?? null, { afterStepId: step.id, branch: 'timeout' });
        }
        nodes.push({ ...base, kind: 'fork', branches });
        return { nodes, lastStepId, endsWithFork: true };
      }

      const note = step.actionType === 'wait_connection'
        ? `Sans acceptation après ${plural(step.timeoutDays ?? WAIT_DEFAULT_DAYS, 'jour', 'jours')}, la séquence passe à l’étape suivante.`
        : null;
      nodes.push({ ...base, kind: 'step', note });
      id = continuationOf(step, steps);
    }
    nodes.push({ kind: 'end' });
    return { nodes, lastStepId, endsWithFork: false };
  };

  const root = primaries.find((s) => !isReferenced(s, steps)) ?? primaries[0] ?? null;
  if (!root) {
    return { start: 'Dès l’inscription, au premier créneau', nodes: [], add: { afterStepId: null }, orphans: [], stepCount: 0, numbers, placements };
  }
  const walked = walk(root.id, 0, null, null);
  const firstDelay = delayLabel(root);
  const orphans: EditorStepNode[] = primaries
    .filter((s) => !rendered.has(s.id))
    .map((step) => {
      const versionIds = versionsOf(steps, step.id).map((v) => v.id);
      return {
        kind: 'step',
        id: step.id,
        number: numberOfOrder(step.order),
        actionType: step.actionType,
        title: stepTypeLabel(step.actionType),
        excerpt: step.actionType === 'smart_message' && step.useAiPersonalization ? null : templateExcerpt(step.messageTemplate),
        description: stepDescription(step),
        delay: delayLabel(step),
        showDelay: false,
        badges: badgesOf(step, versionIds),
        versionIds,
        notice: unsupportedStepNotice(step.actionType),
        note: null,
      };
    });
  return {
    start: firstDelay === 'Aussitôt' ? 'Dès l’inscription, au premier créneau' : `Dès l’inscription, puis ${firstDelay.charAt(0).toLowerCase()}${firstDelay.slice(1)}`,
    nodes: walked.nodes,
    add: walked.endsWithFork ? null : walked.lastStepId ? { afterStepId: walked.lastStepId } : null,
    orphans,
    stepCount: orders.length,
    numbers,
    placements,
  };
}

/** Sous-titre du panneau : « Branche « Non connecté », aussitôt après l’étape 2 ». */
export function placementText(placement: StepPlacement | undefined): string {
  if (!placement) return 'Étape qu’aucun chemin n’atteint : elle ne partira pas.';
  if (placement.afterNumber === null) return 'Première étape, dès l’inscription';
  const when = placement.delay === 'Aussitôt' ? 'aussitôt' : placement.delay.replace(/^Attendre /, '');
  const text = `${when} après l’étape ${placement.afterNumber}`;
  return placement.branch ? `Branche « ${placement.branch} », ${text}` : `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

// ── Points à corriger par étape ───────────────────────────────────────────

export interface StepIssues {
  errors: string[];
  warnings: string[];
}

// « Étape 3 : », « Étape 3 (B) : », « Étape 3, Étape 5 : » (libellés de validateSequence).
const ISSUE_PREFIX = /^((?:Étape \d+(?: \([A-C]\))?)(?:, Étape \d+(?: \([A-C]\))?)*) : (.+)$/s;

/**
 * Points de validateSequence (seule règle) rangés par étape, d'après le
 * libellé « Étape N » qui les ouvre : le numéro est l'ordre + 1. Le texte
 * rendu commence par une capitale, sans le libellé.
 */
export function issuesByOrder(validation: SequenceValidation): Map<number, StepIssues> {
  const map = new Map<number, StepIssues>();
  const add = (message: string, kind: keyof StepIssues) => {
    const m = message.match(ISSUE_PREFIX);
    if (!m) return;
    const text = `${m[2].charAt(0).toUpperCase()}${m[2].slice(1)}`;
    for (const n of m[1].matchAll(/Étape (\d+)/g)) {
      const order = Number(n[1]) - 1;
      const entry = map.get(order) ?? { errors: [], warnings: [] };
      if (!entry[kind].includes(text)) entry[kind].push(text);
      map.set(order, entry);
    }
  };
  for (const issue of validation.errors) add(issue.message, 'errors');
  for (const issue of validation.warnings) add(issue.message, 'warnings');
  return map;
}

/** Ordre de la première étape nommée par un point de validateSequence (« Étape 3 : … »), sinon null. */
export function issueStepOrder(message: string): number | null {
  const m = message.match(ISSUE_PREFIX);
  const first = m?.[1].match(/Étape (\d+)/);
  return first ? Number(first[1]) - 1 : null;
}

/** Un point mène quelque part : une étape nommée, ou les expéditeurs (onglet Réglages). */
export function issueHasTarget(issue: Pick<SequenceIssue, 'area' | 'message'>): boolean {
  return issue.area === 'senders' || issueStepOrder(issue.message) !== null;
}

/**
 * Étapes déjà en base retirées dans l'éditeur, versions comptées une fois
 * (removedPersistedStepCount de l'ancien éditeur) : leurs envois prévus
 * seront annulés à l'enregistrement.
 */
export function removedStepCount(persisted: readonly Pick<Step, 'id' | 'order'>[], current: readonly Pick<Step, 'id'>[]): number {
  const kept = new Set(current.map((s) => s.id));
  return new Set(persisted.filter((s) => !kept.has(s.id)).map((s) => s.order)).size;
}
