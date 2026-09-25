// Règles pures de l'éditeur de séquence : ordre des étapes, suppression,
// enchaînement, contrôles à l'enregistrement et variables des messages.
//
// Ce fichier ne dépend d'aucun module applicatif à l'exécution (les imports
// sont des types) : il est testé directement par tests/ux/seq-audit-f1a.test.mjs.
// Les règles d'enchaînement reproduisent celles du moteur d'envoi
// (process-sequences, scheduleNextStep) : quand l'éditeur montre un chemin,
// c'est celui que suivront les candidats.

import type { Sequence, SequenceStep, StopConditions, SenderAccountConfig } from '../SequenceBuilder';
// Extension explicite : ce fichier est aussi importé tel quel par les tests Node.
import { retiredConditionNotice } from './conditionTypes.ts';

type Step = SequenceStep;

const END = '__end__';
const WAIT_TYPES = new Set(['wait_connection', 'wait_reply', 'wait_profile_visit']);

// ── Noms et champs par type d'étape ───────────────────────────────────────

/** Un seul nom par type d'étape, dans la liste, le canevas et le panneau de réglage. */
export const STEP_TYPE_LABELS: Record<string, string> = {
  connection_request: 'Invitation LinkedIn',
  inmail: 'InMail',
  email: 'E-mail',
  profile_visit: 'Visite de profil',
  message: 'Message LinkedIn',
  smart_message: 'Message IA',
  whatsapp_message: 'WhatsApp',
  check_connection: 'Vérifier la connexion',
  wait_connection: 'Attendre la connexion',
  wait_reply: 'Attendre une réponse',
  wait_profile_visit: 'Attendre une visite',
  condition_branch: 'Branchement',
};

export function stepTypeLabel(actionType: string): string {
  return STEP_TYPE_LABELS[actionType] ?? actionType;
}

const MESSAGE_STEP_TYPES = new Set(['inmail', 'email', 'connection_request', 'message', 'smart_message', 'whatsapp_message']);

/** L'étape porte un texte (message, note d'invitation, e-mail). */
export function stepHasMessageField(actionType: string): boolean {
  return MESSAGE_STEP_TYPES.has(actionType);
}

/**
 * Texte obligatoire hors personnalisation IA. La note d'invitation est
 * facultative : sans note, le moteur envoie l'invitation seule.
 */
export function stepRequiresMessage(actionType: string): boolean {
  return MESSAGE_STEP_TYPES.has(actionType) && actionType !== 'connection_request';
}

/**
 * Objet obligatoire hors personnalisation IA : e-mail, InMail, et Message IA
 * (qui part en InMail quand le candidat n'est pas en relation).
 */
export function stepNeedsSubject(actionType: string): boolean {
  return actionType === 'inmail' || actionType === 'email' || actionType === 'smart_message';
}

/** Personnalisation IA proposée : pas pour l'invitation, dont le moteur ne génère pas la note. */
export function stepAllowsAi(actionType: string): boolean {
  return MESSAGE_STEP_TYPES.has(actionType) && actionType !== 'connection_request';
}

/** Rédaction manuelle : l'IA n'est pas active, ou pas proposée pour ce type. */
export function isManuallyWritten(step: Pick<Step, 'actionType' | 'useAiPersonalization'>): boolean {
  return !step.useAiPersonalization || !stepAllowsAi(step.actionType);
}

/**
 * Invitation marquée « Personnalisation IA » (option retirée) : la note
 * saisie redevient visible et c'est elle qui part, comme le fait le moteur.
 */
export function withoutInvitationAi(steps: Step[]): Step[] {
  if (!steps.some((s) => s.actionType === 'connection_request' && s.useAiPersonalization)) return steps;
  return steps.map((s) => (s.actionType === 'connection_request' && s.useAiPersonalization
    ? { ...s, useAiPersonalization: false }
    : s));
}

// ── Conditions d'arrêt ────────────────────────────────────────────────────

/**
 * La réponse et la désinscription arrêtent toujours la séquence (le moteur
 * n'en tient pas compte autrement) : elles restent vraies dans l'objet écrit.
 */
export function withAlwaysOnStops(value: StopConditions): StopConditions {
  if (value.on_reply && value.on_unsubscribe) return value;
  return { ...value, on_reply: true, on_unsubscribe: true };
}

// ── Délais ────────────────────────────────────────────────────────────────

type Delay = Pick<Step, 'delayDays' | 'delayHours' | 'delayMinutes'>;

/** Délai court pour un résumé : « 2 j 4 h 30 min », vide sans délai. */
export function formatStepDelay(step: Delay): string {
  const d = step.delayDays || 0;
  const h = step.delayHours || 0;
  const m = step.delayMinutes || 0;
  return [d > 0 ? `${d} j` : '', h > 0 ? `${h} h` : '', m > 0 ? `${m} min` : ''].filter(Boolean).join(' ');
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Phrase sous les champs de délai : point de départ explicite. */
export function delaySentence(step: Delay): string {
  const d = step.delayDays || 0;
  const h = step.delayHours || 0;
  const m = step.delayMinutes || 0;
  const parts = [
    d > 0 ? plural(d, 'jour', 'jours') : '',
    h > 0 ? plural(h, 'heure', 'heures') : '',
    m > 0 ? plural(m, 'minute', 'minutes') : '',
  ].filter(Boolean);
  if (parts.length === 0) return "Part dès que l'étape précédente est passée.";
  const text = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} et ${parts[parts.length - 1]}`;
  return `Attendre ${text} après l'étape précédente.`;
}

/** Aide sous la fenêtre d'envoi : ce que le moteur applique en plus. */
export const SEND_WINDOW_HELP =
  "Envois en semaine uniquement, dans votre fuseau horaire, et dans les heures ouvrées de l'expéditeur.";

// ── Brouillon ─────────────────────────────────────────────────────────────

/** Ancienne clé commune au navigateur, à effacer. */
export const LEGACY_SEQUENCE_DRAFT_KEY = 'sequence-new';

/**
 * Brouillon d'une nouvelle séquence, rangé par utilisateur et par
 * organisation : un poste partagé ou un changement d'organisation ne montre
 * plus le travail d'un autre. `null` tant que l'un des deux est inconnu.
 */
export function sequenceDraftKey(userId: string | null | undefined, organizationId: string | null | undefined): string | null {
  if (!userId || !organizationId) return null;
  return `${LEGACY_SEQUENCE_DRAFT_KEY}:${userId}:${organizationId}`;
}

// ── Types d'étape proposés à l'ajout ──────────────────────────────────────

// Types gardés pour afficher les séquences existantes, mais plus proposés :
// le moteur ne fait pas ce que l'éditeur promettait.
const UNSUPPORTED_STEP_NOTICES = new Map<string, string>([
  ['condition_branch', "Cette étape Branchement ne route rien : la séquence continue dans les deux cas. Utilisez plutôt une condition d'exécution sur l'étape concernée."],
  ['wait_profile_visit', "Cette attente n'est pas prise en charge : l'étape suivante part sans attendre."],
  // Canal e-mail et WhatsApp : à réactiver quand le moteur saura choisir la
  // boîte d'envoi et connaîtra l'adresse ou le numéro du candidat.
  ['email', 'Les étapes e-mail ne partent pas encore : elles seront sautées pour tous les candidats.'],
  ['whatsapp_message', 'Les étapes WhatsApp ne partent pas encore : elles seront sautées pour tous les candidats.'],
]);

export function isStepTypeOffered(actionType: string): boolean {
  return !UNSUPPORTED_STEP_NOTICES.has(actionType);
}

export function unsupportedStepNotice(actionType: string): string | null {
  return UNSUPPORTED_STEP_NOTICES.get(actionType) ?? null;
}

/** Aide affichée sur une étape « Message LinkedIn IA ». */
export const SMART_MESSAGE_INMAIL_HELP =
  "Si le candidat n'est pas en relation, le message part en InMail (un crédit consommé).";

/** Nombre d'étapes (variantes comptées une fois) qui peuvent consommer un crédit InMail. */
export function countInmailCapableSteps(steps: Step[]): number {
  const orders = new Set<number>();
  for (const s of steps) {
    if (s.actionType === 'inmail' || s.actionType === 'smart_message') orders.add(s.order);
  }
  return orders.size;
}

/** Événement attendu par une étape d'attente, lu par le moteur. */
export function waitEventFor(actionType: string): SequenceStep['waitForEvent'] {
  if (actionType === 'wait_connection') return 'connection_accepted';
  if (actionType === 'wait_reply') return 'reply_received';
  return undefined;
}

export function isWaitStep(actionType: string): boolean {
  return WAIT_TYPES.has(actionType);
}

// ── Délai dépassé ─────────────────────────────────────────────────────────

/**
 * Ce que fera le moteur au délai dépassé. Seule l'étape de repli
 * (timeoutBranchStepId) est enregistrée : si elle existe, c'est elle qui part,
 * quelle que soit la valeur locale de timeoutAction.
 */
export function effectiveTimeoutAction(step: Step): 'skip' | 'alternative_step' {
  if (step.timeoutBranchStepId) return 'alternative_step';
  return step.timeoutAction === 'alternative_step' ? 'alternative_step' : 'skip';
}

/** Changement du choix « Si le délai est dépassé » : quitter l'étape alternative efface sa cible. */
export function timeoutActionUpdate(value: string): Partial<Step> {
  return value === 'alternative_step'
    ? { timeoutAction: 'alternative_step' }
    : { timeoutAction: 'skip', timeoutBranchStepId: undefined };
}

// ── Ordre et variantes ────────────────────────────────────────────────────

/** Ordre d'une nouvelle étape : après la plus grande, variantes comprises. */
export function nextStepOrder(steps: Step[]): number {
  if (steps.length === 0) return 0;
  return Math.max(...steps.map((s) => s.order)) + 1;
}

/**
 * Renumérote par groupe d'ordre : les ordres distincts, triés, deviennent
 * 0..n-1. Les variantes A/B d'une même étape gardent donc un ordre commun.
 */
export function renumberByOrderGroup(steps: Step[]): Step[] {
  const distinct = [...new Set(steps.map((s) => s.order))].sort((a, b) => a - b);
  const map = new Map(distinct.map((order, index) => [order, index]));
  return steps.map((s) => {
    const order = map.get(s.order) ?? s.order;
    return order === s.order ? s : { ...s, order };
  });
}

/**
 * Ordre des étapes d'un modèle (sequence_templates.steps_config). Les modèles
 * récents enregistrent step_order, commun aux variantes A/B d'une même étape.
 * Les plus anciens n'ont que leur position : des variantes voisines de lettres
 * différentes y reprennent un ordre commun. Sans cela, chaque variante avait
 * son propre ordre, le tirage n'en voyait qu'une et le candidat recevait les
 * variantes l'une après l'autre.
 */
export function templateStepOrders(configs: ReadonlyArray<Record<string, unknown>>): number[] {
  const declared = configs.map((c) => {
    const value = typeof c.step_order === 'number' ? c.step_order : c.order;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  });
  if (declared.every((v): v is number => v !== null)) return declared;

  const orders: number[] = [];
  let order = -1;
  let groupLetters = new Set<string>();
  for (const c of configs) {
    const raw = c.variant_group ?? c.variantGroup;
    const letter = typeof raw === 'string' && raw ? raw : null;
    if (letter && groupLetters.size > 0 && !groupLetters.has(letter)) {
      groupLetters.add(letter);
    } else {
      order += 1;
      groupLetters = letter ? new Set([letter]) : new Set();
    }
    orders.push(order);
  }
  return orders;
}

/**
 * Étapes affichées dans la liste : une par ordre (la variante A, ou l'étape
 * simple). Une variante sans étape A reste affichée au lieu d'être masquée.
 */
export function getPrimarySteps(steps: Step[]): Step[] {
  const byOrder = new Map<number, Step[]>();
  for (const s of steps) {
    const rows = byOrder.get(s.order) ?? [];
    rows.push(s);
    byOrder.set(s.order, rows);
  }
  const result: Step[] = [];
  for (const order of [...byOrder.keys()].sort((a, b) => a - b)) {
    const rows = byOrder.get(order) ?? [];
    result.push(...rows.filter((r) => !r.variantGroup));
    const variants = rows
      .filter((r) => r.variantGroup)
      .sort((a, b) => String(a.variantGroup).localeCompare(String(b.variantGroup)));
    if (variants.length > 0) result.push(variants.find((v) => v.variantGroup === 'A') ?? variants[0]);
  }
  return result;
}

// ── Références entre étapes ───────────────────────────────────────────────

function refsOf(s: Step): Array<string | undefined> {
  return [s.nextStepId, s.ifTrueGotoStep, s.ifFalseGotoStep, s.timeoutBranchStepId];
}

/** Même règle que le moteur : une étape visée par un renvoi ne passe jamais à l'ordre suivant. */
export function isReferenced(step: Step, steps: Step[]): boolean {
  return steps.some((s) => refsOf(s).includes(step.id));
}

/** Étapes situées dans une branche de « Vérifier connexion » (même calcul que le canevas). */
export function branchStepIds(steps: Step[]): Set<string> {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const ids = new Set<string>();
  const walk = (id: string | undefined, seen: Set<string>) => {
    if (!id || id === END || seen.has(id)) return;
    seen.add(id);
    ids.add(id);
    const s = byId.get(id);
    walk(s?.nextStepId, seen);
    walk(s?.ifTrueGotoStep, seen);
    walk(s?.ifFalseGotoStep, seen);
  };
  for (const s of steps) {
    if (s.actionType !== 'check_connection') continue;
    const seen = new Set<string>();
    walk(s.ifTrueGotoStep, seen);
    walk(s.ifFalseGotoStep, seen);
  }
  return ids;
}

function primaryAtOrder(steps: Step[], order: number): Step | undefined {
  const rows = steps.filter((s) => s.order === order);
  return rows.find((r) => !r.variantGroup) ?? rows.find((r) => r.variantGroup === 'A') ?? rows[0];
}

function nextGreaterOrder(steps: Step[], order: number): number | undefined {
  let best: number | undefined;
  for (const s of steps) {
    if (s.order > order && (best === undefined || s.order < best)) best = s.order;
  }
  return best;
}

/**
 * Étape jouée après `step` (hors « Vérifier connexion »), selon le moteur :
 * fin de séquence, étape suivante choisie, arrêt si l'étape est visée par un
 * renvoi, sinon l'ordre suivant. `null` : la séquence s'arrête après elle.
 */
export function engineNextStepId(step: Step, steps: Step[]): string | null {
  if (step.nextStepId === END) return null;
  if (step.nextStepId) return step.nextStepId;
  if (isReferenced(step, steps)) return null;
  const order = nextGreaterOrder(steps, step.order);
  if (order === undefined) return null;
  return primaryAtOrder(steps, order)?.id ?? null;
}

// ── Suppression et ajout ──────────────────────────────────────────────────

/**
 * Supprime une étape :
 * - une étape principale (variante A ou étape simple) part avec ses variantes ;
 * - les renvois qui la visaient passent à l'étape qui la suivait (chaîne
 *   « Étape suivante », tête de branche, étape de repli) ;
 * - les ordres sont renumérotés par groupe, variantes comprises.
 * La dernière étape peut être supprimée : la séquence redevient vide et
 * l'éditeur propose à nouveau le choix d'une première étape.
 */
export function removeStepFromSequence(steps: Step[], stepId: string): Step[] {
  const target = steps.find((s) => s.id === stepId);
  if (!target) return steps;

  const isSecondaryVariant = !!target.variantGroup && target.variantGroup !== 'A';
  const removedIds = new Set<string>(
    target.variantGroup === 'A'
      ? steps.filter((s) => s.order === target.order && s.variantGroup).map((s) => s.id)
      : [target.id],
  );
  const remaining = steps.filter((s) => !removedIds.has(s.id));
  if (remaining.length === 0) return [];

  // Ce qui suivait l'étape retirée. Une variante B ou C retirée seule est
  // remplacée par l'étape restante de son groupe.
  let successor: string | undefined = isSecondaryVariant
    ? remaining.find((s) => s.order === target.order && s.variantGroup)?.id ?? target.nextStepId
    : target.nextStepId;
  if (successor && successor !== END && removedIds.has(successor)) successor = undefined;

  const reroute = (ref: string | undefined, selfId: string, allowEnd: boolean): string | undefined => {
    if (!ref || !removedIds.has(ref)) return ref;
    if (!successor || successor === selfId) return undefined;
    if (successor === END) return allowEnd ? END : undefined;
    return successor;
  };

  let result = remaining.map((s) => {
    const next = {
      ...s,
      nextStepId: reroute(s.nextStepId, s.id, true),
      ifTrueGotoStep: reroute(s.ifTrueGotoStep, s.id, false),
      ifFalseGotoStep: reroute(s.ifFalseGotoStep, s.id, false),
      timeoutBranchStepId: reroute(s.timeoutBranchStepId, s.id, false),
    };
    return next;
  });

  // Variantes restantes du groupe touché : une seule redevient une étape
  // simple, plusieurs se partagent 100 %.
  if (target.variantGroup) {
    const group = result.filter((s) => s.order === target.order && s.variantGroup);
    if (group.length === 1) {
      result = result.map((s) => (s.id === group[0].id ? { ...s, variantGroup: undefined, variantWeight: undefined } : s));
    } else if (group.length > 1) {
      const base = Math.floor(100 / group.length);
      const extra = 100 - base * group.length;
      const weights = new Map(group.map((g, i) => [g.id, base + (i === 0 ? extra : 0)]));
      result = result.map((s) => (weights.has(s.id) ? { ...s, variantWeight: weights.get(s.id) } : s));
    }
  }

  return renumberByOrderGroup(result);
}

const VARIANT_LETTERS = ['A', 'B', 'C'];

/**
 * Ajoute une variante (B, puis C) à l'étape `sourceStepId`. Les poids sont
 * répartis sur le nombre réel de variantes après l'ajout, le reste va à A :
 * 50/50, puis 34/33/33. Au-delà de trois variantes, rien ne change.
 */
export function addVariantToSteps(steps: Step[], sourceStepId: string, newStepId: string): Step[] {
  const source = steps.find((s) => s.id === sourceStepId);
  if (!source) return steps;
  const group = steps.filter((s) => s.order === source.order && (s.variantGroup || s.id === source.id));
  if (group.length >= VARIANT_LETTERS.length) return steps;
  const used = new Set(group.map((s) => s.variantGroup || 'A'));
  const letter = VARIANT_LETTERS.find((l) => !used.has(l));
  if (!letter) return steps;

  const count = group.length + 1;
  const base = Math.floor(100 / count);
  const remainder = 100 - base * count;
  const weightFor = (variant: string) => base + (variant === 'A' ? remainder : 0);

  const updated = steps.map((s) => {
    if (s.order !== source.order || !(s.variantGroup || s.id === source.id)) return s;
    const variant = s.variantGroup || 'A';
    return { ...s, variantGroup: variant, variantWeight: weightFor(variant) };
  });
  const primary = updated.find((s) => s.id === source.id) ?? source;
  const newStep: Step = {
    ...primary,
    id: newStepId,
    variantGroup: letter,
    variantWeight: weightFor(letter),
    messageTemplate: '',
    subjectTemplate: '',
  };
  return [...updated, newStep];
}

/**
 * Étapes proposées comme étape de repli d'une attente : seulement celles qui
 * viennent après elle. Une étape antérieure renverrait un message déjà parti.
 */
export function timeoutTargetOptions(step: Step, steps: Step[]): Step[] {
  return steps.filter((s) => s.id !== step.id && s.order > step.order);
}

/** Étape de repli déjà enregistrée vers une étape antérieure (ou la même). */
export function hasBackwardTimeoutTarget(step: Step, steps: Step[]): boolean {
  if (!step.timeoutBranchStepId) return false;
  const target = steps.find((s) => s.id === step.timeoutBranchStepId);
  return !!target && target.order <= step.order;
}

/**
 * Ajout en fin de liste : si la dernière étape principale est chaînée par un
 * « Étape suivante » (séquence construite dans l'onglet Visuel) et n'a pas de
 * suite, le moteur s'arrêterait après elle. On la relie à la nouvelle étape.
 */
export function chainAfterLastMainStep(steps: Step[], newStepId: string): Step[] {
  const branchIds = branchStepIds(steps);
  const mains = getPrimarySteps(steps).filter((s) => !branchIds.has(s.id));
  const last = mains[mains.length - 1];
  if (!last || last.actionType === 'check_connection' || last.nextStepId) return steps;
  if (!steps.some((s) => s.nextStepId === last.id)) return steps;
  return steps.map((s) =>
    s.order === last.order && !s.nextStepId && (s.id === last.id || s.variantGroup)
      ? { ...s, nextStepId: newStepId }
      : s,
  );
}

// ── Contrôles à l'enregistrement ──────────────────────────────────────────

export function stepLabel(s: Step): string {
  return `Étape ${s.order + 1}${s.variantGroup ? ` (${s.variantGroup})` : ''}`;
}

/** Erreurs bloquantes d'enchaînement : branche vide, renvoi mort, repli sans cible, variante seule. */
export function validateStepGraph(steps: Step[]): string[] {
  const errors: string[] = [];
  const ids = new Set(steps.map((s) => s.id));

  for (const s of steps) {
    const label = stepLabel(s);
    if (s.actionType === 'check_connection') {
      const hasTrue = !!s.ifTrueGotoStep;
      const hasFalse = !!s.ifFalseGotoStep;
      if (hasTrue !== hasFalse) {
        errors.push(`${label} : la branche ${hasTrue ? 'Non connecté' : 'Connecté'} est vide. Ajoutez une étape ou choisissez Étape suivante pour les deux cas.`);
      }
    }
    const refs = [s.ifTrueGotoStep, s.ifFalseGotoStep, s.timeoutBranchStepId, s.nextStepId === END ? undefined : s.nextStepId];
    if (refs.some((r) => r && !ids.has(r))) {
      errors.push(`${label} : elle renvoie vers une étape qui n'existe plus. Choisissez une autre étape.`);
    }
    if (isWaitStep(s.actionType) && effectiveTimeoutAction(s) === 'alternative_step' && !s.timeoutBranchStepId) {
      errors.push(`${label} : choisissez l'étape à exécuter si le délai est dépassé.`);
    }
  }

  const variantsByOrder = new Map<number, Step[]>();
  for (const s of steps) {
    if (!s.variantGroup) continue;
    const rows = variantsByOrder.get(s.order) ?? [];
    rows.push(s);
    variantsByOrder.set(s.order, rows);
  }
  for (const [order, rows] of [...variantsByOrder.entries()].sort((a, b) => a[0] - b[0])) {
    if (rows.length !== 1) continue;
    const letter = rows[0].variantGroup;
    errors.push(
      letter === 'A'
        ? `Étape ${order + 1} : test A/B incomplet, la variante A est seule. Retirez le test A/B.`
        : `Étape ${order + 1} : variante ${letter} sans étape A. Retirez le test A/B ou supprimez l'étape.`,
    );
  }

  return errors;
}

/**
 * Étapes qu'aucun chemin n'atteint (une par ordre) : elles s'affichent mais ne
 * partiront jamais. Parcours depuis la première étape avec les règles du moteur.
 */
export function findUnreachableSteps(steps: Step[]): Step[] {
  if (steps.length === 0) return [];
  const byId = new Map(steps.map((s) => [s.id, s]));
  const orders = [...new Set(steps.map((s) => s.order))].sort((a, b) => a - b);
  const reached = new Set<number>();
  const queue: number[] = [orders[0]];

  const orderOf = (id: string | undefined): number | undefined => (id ? byId.get(id)?.order : undefined);
  const afterStep = (s: Step): number | undefined => {
    if (s.nextStepId === END) return undefined;
    if (s.nextStepId) return orderOf(s.nextStepId);
    if (isReferenced(s, steps)) return undefined;
    return nextGreaterOrder(steps, s.order);
  };

  while (queue.length > 0) {
    const order = queue.shift() as number;
    if (reached.has(order)) continue;
    reached.add(order);
    for (const s of steps) {
      if (s.order !== order) continue;
      const targets: Array<number | undefined> = [];
      if (s.actionType === 'check_connection') {
        targets.push(s.ifTrueGotoStep ? orderOf(s.ifTrueGotoStep) : nextGreaterOrder(steps, s.order));
        targets.push(s.ifFalseGotoStep ? orderOf(s.ifFalseGotoStep) : nextGreaterOrder(steps, s.order));
      } else {
        targets.push(afterStep(s));
        if (isWaitStep(s.actionType) && s.timeoutBranchStepId) targets.push(orderOf(s.timeoutBranchStepId));
      }
      for (const t of targets) if (t !== undefined && !reached.has(t)) queue.push(t);
    }
  }

  return orders
    .filter((o) => !reached.has(o))
    .map((o) => primaryAtOrder(steps, o))
    .filter((s): s is Step => !!s);
}

export function unreachableStepWarning(step: Step, typeLabel?: string): string {
  const what = typeLabel ? ` (${typeLabel})` : '';
  return `Étape ${step.order + 1}${what} : aucun chemin n'y mène, elle ne partira jamais. Reliez-la depuis l'étape précédente dans l'onglet Visuel (« Étape suivante »).`;
}

// ── Parcours réel vers une étape ──────────────────────────────────────────

type EdgeKind = 'next' | 'true' | 'false' | 'timeout';
interface IncomingEdge { from: Step; kind: EdgeKind }

function isSecondaryVariant(s: Step, steps: Step[]): boolean {
  return !!s.variantGroup && primaryAtOrder(steps, s.order)?.id !== s.id;
}

/**
 * Renvois entrants de chaque étape, selon les règles du moteur : étape
 * suivante choisie ou ordre suivant, branches de « Vérifier la connexion »
 * (ordre suivant quand la branche n'est pas choisie), étape de repli d'une
 * attente. Les variantes B et C suivent leur variante A et n'en ajoutent pas.
 */
function incomingEdges(steps: Step[]): Map<string, IncomingEdge[]> {
  const map = new Map<string, IncomingEdge[]>();
  const add = (to: string | null | undefined, from: Step, kind: EdgeKind) => {
    if (!to || to === END) return;
    const list = map.get(to) ?? [];
    list.push({ from, kind });
    map.set(to, list);
  };
  for (const s of steps) {
    if (isSecondaryVariant(s, steps)) continue;
    if (s.actionType === 'check_connection') {
      const order = nextGreaterOrder(steps, s.order);
      const fallback = order === undefined ? undefined : primaryAtOrder(steps, order)?.id;
      add(s.ifTrueGotoStep ?? fallback, s, 'true');
      add(s.ifFalseGotoStep ?? fallback, s, 'false');
    } else {
      add(engineNextStepId(s, steps), s, 'next');
      if (isWaitStep(s.actionType) && s.timeoutBranchStepId) add(s.timeoutBranchStepId, s, 'timeout');
    }
  }
  return map;
}

/** Une variante B ou C est jouée à la place de sa variante A : même parcours. */
function pathAnchor(step: Step, steps: Step[]): Step {
  return isSecondaryVariant(step, steps) ? primaryAtOrder(steps, step.order) ?? step : step;
}

/**
 * Étapes jouées avant `step` sur au moins un chemin (une par ordre). Une
 * étape qu'aucun renvoi ne vise vient après l'étape d'ordre inférieur, comme
 * dans une séquence construite en mode Liste ; une étape de branche ne voit
 * que sa branche.
 */
export function previousStepsOf(step: Step, steps: Step[]): Step[] {
  const incoming = incomingEdges(steps);
  const start = pathAnchor(step, steps);
  const seen = new Set<string>([start.id]);
  const result: Step[] = [];
  const queue = [start.id];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    for (const edge of incoming.get(id) ?? []) {
      if (seen.has(edge.from.id)) continue;
      seen.add(edge.from.id);
      result.push(edge.from);
      queue.push(edge.from.id);
    }
  }
  return result;
}

export type ConnectionContext = 'connected' | 'not_connected' | 'unknown';

/**
 * Relation avec le candidat au moment de l'étape, quand le parcours la
 * garantit : branche « connecté » ou « non connecté » de la vérification,
 * invitation acceptée (attente de connexion avec étape de repli) ou délai
 * de l'attente dépassé. Sinon, ou si les chemins divergent : inconnue.
 */
export function connectionContextOf(step: Step, steps: Step[]): ConnectionContext {
  const incoming = incomingEdges(steps);
  const found = new Set<ConnectionContext>();
  const visiting = new Set<string>();
  const walk = (id: string) => {
    if (visiting.has(id)) return;
    visiting.add(id);
    const edges = incoming.get(id) ?? [];
    if (edges.length === 0) found.add('unknown');
    for (const { from, kind } of edges) {
      if (from.actionType === 'check_connection') {
        found.add(kind === 'true' ? 'connected' : 'not_connected');
      } else if (from.actionType === 'wait_connection' && kind === 'timeout') {
        found.add('not_connected');
      } else if (from.actionType === 'wait_connection' && from.timeoutBranchStepId) {
        found.add('connected');
      } else {
        walk(from.id);
      }
    }
    visiting.delete(id);
  };
  walk(pathAnchor(step, steps).id);
  if (found.size === 1) {
    const [only] = [...found];
    return only;
  }
  return 'unknown';
}

const BRANCH_BADGES: Partial<Record<EdgeKind, string>> = {
  true: 'Si connecté',
  false: 'Si non connecté',
  timeout: 'Si délai dépassé',
};

/**
 * Branche de chaque étape, lue sur tous les chemins qui y mènent : « Si
 * connecté », « Si non connecté », « Si délai dépassé ». Une étape où les
 * branches se rejoignent n'en porte pas. La plus proche vient en premier.
 */
export function branchBadgesByStep(steps: Step[]): Map<string, string[]> {
  const incoming = incomingEdges(steps);
  const memo = new Map<string, string[]>();
  const onStack = new Set<string>();
  const labelsOf = (id: string): string[] => {
    const cached = memo.get(id);
    if (cached) return cached;
    onStack.add(id);
    let common: string[] | null = null;
    for (const { from, kind } of incoming.get(id) ?? []) {
      if (onStack.has(from.id)) continue; // boucle : chemin ignoré
      const own = BRANCH_BADGES[kind];
      const path = [...(own ? [own] : []), ...labelsOf(from.id).filter((l) => l !== own)];
      common = common === null ? path : common.filter((l) => path.includes(l));
    }
    onStack.delete(id);
    const result = common ?? [];
    memo.set(id, result);
    return result;
  };
  const byStep = new Map<string, string[]>();
  for (const s of steps) byStep.set(s.id, labelsOf(pathAnchor(s, steps).id));
  return byStep;
}

// ── Vérification complète (liste, mode Guidé, enregistrement) ─────────────

export type SequenceArea = 'info' | 'senders' | 'steps' | 'guardrails';

export interface SequenceIssue {
  /** Regroupement dans la liste de vérification. */
  check: string;
  /** Étape du mode Guidé concernée. */
  area: SequenceArea;
  message: string;
}

export interface SequenceValidation {
  /** Bloquants : l'enregistrement est refusé tant qu'il en reste. */
  errors: SequenceIssue[];
  /** Recommandations : affichées, sans bloquer. */
  warnings: SequenceIssue[];
}

type ValidatedSequence = Pick<Sequence, 'name' | 'steps' | 'multiSenderEnabled' | 'senderAccounts'>;

/** Au-delà, un expéditeur reçoit beaucoup de nouveaux candidats par jour. */
export const HIGH_SENDER_DAILY_LIMIT = 80;

/**
 * Une seule vérification pour la liste de vérification, le fil du mode Guidé
 * et l'enregistrement : ce qui bloque l'enregistrement est affiché comme
 * bloquant, et rien d'autre.
 */
export function validateSequence(sequence: ValidatedSequence): SequenceValidation {
  const errors: SequenceIssue[] = [];
  const warnings: SequenceIssue[] = [];
  const err = (check: string, message: string, area: SequenceArea = 'steps') => errors.push({ check, area, message });
  const warn = (check: string, message: string, area: SequenceArea = 'steps') => warnings.push({ check, area, message });
  const steps = sequence.steps;

  if (!sequence.name.trim()) err('name', 'Donnez un nom à la séquence.', 'info');
  if (steps.length === 0) err('steps', 'Ajoutez au moins une étape.');

  for (const s of steps) {
    const label = stepLabel(s);
    const manual = isManuallyWritten(s);
    if (stepRequiresMessage(s.actionType) && manual && !s.messageTemplate?.trim()) {
      err('messages', `${label} : message à rédiger.`);
    }
    if (stepNeedsSubject(s.actionType) && manual && !s.subjectTemplate?.trim()) {
      err('subjects', s.actionType === 'smart_message'
        ? `${label} : objet à renseigner, il sert si le message part en InMail.`
        : `${label} : objet à renseigner.`);
    }
    if (s.actionType === 'connection_request' && (s.messageTemplate?.length || 0) > 300) {
      err('invite_length', `${label} : note d'invitation trop longue (300 caractères au plus).`);
    }
    if (s.conditionType === 'if_score_above' && !s.conditionValue?.trim()) {
      err('score', `${label} : indiquez le seuil de score.`);
    }
    // Sans délai maximal, une attente bloquerait le candidat indéfiniment.
    if (isWaitStep(s.actionType) && (!s.timeoutDays || s.timeoutDays <= 0)) {
      err('wait_timeouts', `${label} : indiquez combien de jours attendre au plus.`);
    }
    const dDays = s.delayDays ?? 0, dHours = s.delayHours ?? 0, dMins = s.delayMinutes ?? 0;
    if (dDays < 0 || dHours < 0 || dMins < 0) err('delays', `${label} : les délais ne peuvent pas être négatifs.`);
    if (dHours > 23) err('delays', `${label} : les heures de délai vont de 0 à 23.`);
    if (dMins > 59) err('delays', `${label} : les minutes de délai vont de 0 à 59.`);
    if (typeof s.preferredHourStart === 'number' && typeof s.preferredHourEnd === 'number'
        && s.preferredHourStart >= s.preferredHourEnd) {
      err('send_window', `${label} : l'heure de fin de la fenêtre d'envoi doit venir après l'heure de début.`);
    }
    if (isWaitStep(s.actionType) && hasBackwardTimeoutTarget(s, steps)) {
      err('timeout_target', `${label} : l'étape de repli doit venir après l'attente, sinon un message déjà envoyé repartirait. Choisissez une étape suivante.`);
    }
    const retired = retiredConditionNotice(s.conditionType);
    if (retired) warn('retired_condition', `${label} : ${retired}`);
  }

  // Enchaînement : branche vide, renvoi mort, repli sans cible, variante seule.
  for (const message of validateStepGraph(steps)) err('routing', message);

  // Tests A/B : le total des poids doit faire 100 % par étape.
  const variantsByOrder = new Map<number, Step[]>();
  for (const s of steps) {
    if (!s.variantGroup) continue;
    const rows = variantsByOrder.get(s.order) ?? [];
    rows.push(s);
    variantsByOrder.set(s.order, rows);
  }
  for (const [order, rows] of [...variantsByOrder.entries()].sort((a, b) => a[0] - b[0])) {
    if (rows.length < 2) continue;
    const total = rows.reduce((sum, v) => sum + (v.variantWeight || 0), 0);
    if (total !== 100) err('ab_weights', `Étape ${order + 1} : les poids des variantes font ${total} % au lieu de 100 %.`);
  }

  // Recommandations.
  for (const s of findUnreachableSteps(steps)) {
    warn('unreachable', `Étape ${s.order + 1} : aucun chemin n'y mène, elle ne partira jamais.`);
  }
  for (const type of ['condition_branch', 'wait_profile_visit', 'email', 'whatsapp_message']) {
    const concerned = steps.filter((s) => s.actionType === type);
    if (concerned.length === 0) continue;
    const labels = [...new Set(concerned.map((s) => `Étape ${s.order + 1}`))];
    warn('unsupported', `${labels.join(', ')} : ${unsupportedStepNotice(type) ?? ''}`);
  }
  const inmailSteps = countInmailCapableSteps(steps);
  if (inmailSteps > 0) {
    warn('inmail_cost', inmailSteps > 1
      ? `${inmailSteps} étapes peuvent partir en InMail payant (un crédit par envoi).`
      : '1 étape peut partir en InMail payant (un crédit par envoi).');
  }
  const senders = sequence.senderAccounts ?? [];
  if (sequence.multiSenderEnabled && senders.length === 0) {
    warn('senders', 'Plusieurs expéditeurs est activé sans expéditeur : les envois partiront du compte de chaque inscription.', 'senders');
  }
  if (sequence.multiSenderEnabled) {
    const high = senders.filter((s) => s.daily_limit > HIGH_SENDER_DAILY_LIMIT);
    if (high.length > 0) {
      warn('daily_limits', `${high.length} expéditeur${high.length > 1 ? 's' : ''} au-delà de ${HIGH_SENDER_DAILY_LIMIT} actions LinkedIn par jour.`, 'senders');
    }
  }
  const noDelay = steps.filter((s) => s.order > 0 && !isWaitStep(s.actionType) && s.actionType !== 'check_connection'
    && !s.delayDays && !s.delayHours && !s.delayMinutes);
  const noDelayOrders = new Set(noDelay.map((s) => s.order));
  if (noDelayOrders.size > 0) {
    warn('delays_zero', `${noDelayOrders.size} étape${noDelayOrders.size > 1 ? 's partent' : ' part'} sans délai après la précédente.`);
  }

  return { errors, warnings };
}

// ── Variables des messages ────────────────────────────────────────────────

// Clés remplies par le moteur pour une séquence (_shared/template-interpolation.ts,
// buildSequenceContext). Toute autre variable est retirée du message à l'envoi.
export const SEQUENCE_TEMPLATE_KEYS: readonly string[] = [
  'prenom', 'nom', 'nom_complet', 'headline', 'poste_actuel', 'entreprise_actuelle',
  'profil_linkedin', 'niveau_connexion',
  'poste_recherche', 'client', 'lieu_poste', 'type_contrat', 'skills_requis',
  'mon_prenom', 'mon_nom', 'ma_signature', 'mon_poste', 'ma_societe', 'lien_calendly',
  'aujourd_hui', 'jour_semaine', 'date_courte', 'salutation', 'periode_jour',
  'first_name', 'last_name', 'name', 'company', 'job_title', 'sender_name', 'calendly_link',
];

const PREVIEW_EXAMPLES: Record<string, string> = {
  prenom: 'Laurent', first_name: 'Laurent',
  nom: 'Garilhe', last_name: 'Garilhe',
  nom_complet: 'Laurent Garilhe', name: 'Laurent Garilhe',
  entreprise_actuelle: 'Konekt', company: 'Konekt',
  poste_actuel: 'Lead Developer', job_title: 'Lead Developer',
  headline: 'Lead Developer chez Konekt',
  profil_linkedin: 'linkedin.com/in/laurent-garilhe',
  niveau_connexion: '2e',
  poste_recherche: '[poste de la mission]',
  client: '[client de la mission]',
  lieu_poste: '[lieu du poste]',
  type_contrat: '[type de contrat]',
  skills_requis: '[compétences clés]',
  mon_prenom: '[votre prénom]', sender_name: '[votre prénom]',
  mon_nom: '[votre nom]',
  ma_signature: '[votre nom complet]',
  mon_poste: '[votre poste]',
  ma_societe: '[votre société]',
  lien_calendly: "[lien d'agenda de la mission]", calendly_link: "[lien d'agenda de la mission]",
  aujourd_hui: '[date du jour]',
  jour_semaine: '[jour de la semaine]',
  date_courte: '[date]',
  salutation: 'Bonjour',
  periode_jour: '[moment de la journée]',
};

export const EMPTY_AT_SEND = "(vide à l'envoi)";

interface Placeholder {
  raw: string;
  key: string;
  fallback: string | null;
}

// Même lecture que le moteur : {{ clé | filtre | fallback:"valeur" }}, clé en minuscules.
function parsePlaceholders(text: string): Placeholder[] {
  const out: Placeholder[] = [];
  const re = /\{\{\s*([^{}]+?)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const parts = m[1].split('|').map((p) => p.trim());
    let fallback: string | null = null;
    for (const f of parts.slice(1)) {
      const fm = f.match(/^(fallback|default)(?::\s*(?:"([^"]*)"|'([^']*)'|(.+)))?$/);
      if (fm) fallback = fm[2] ?? fm[3] ?? fm[4]?.trim() ?? '';
    }
    out.push({ raw: m[0], key: parts[0].toLowerCase(), fallback });
  }
  return out;
}

/** Variables qui seront retirées du message à l'envoi (clé inconnue du moteur, sans valeur de repli). */
export function findUnknownTemplateVariables(text: string | undefined, extraKeys: Iterable<string> = []): string[] {
  if (!text) return [];
  const known = new Set<string>([...SEQUENCE_TEMPLATE_KEYS, ...[...extraKeys].map((k) => k.toLowerCase())]);
  const unknown = new Set<string>();
  for (const p of parsePlaceholders(text)) {
    if (!known.has(p.key) && p.fallback === null) unknown.add(`{{${p.key}}}`);
  }
  return [...unknown];
}

/** Aperçu d'un message avec des valeurs d'exemple ; une variable inconnue du moteur apparaît vide. */
export function renderTemplatePreview(text: string, extraValues: Record<string, string> = {}): string {
  const extras = new Map(Object.entries(extraValues).map(([k, v]) => [k.toLowerCase(), v]));
  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (raw) => {
    const [p] = parsePlaceholders(raw);
    if (!p) return raw;
    const value = extras.get(p.key) ?? (SEQUENCE_TEMPLATE_KEYS.includes(p.key) ? PREVIEW_EXAMPLES[p.key] : undefined);
    if (value) return value;
    if (p.fallback !== null) return p.fallback;
    return EMPTY_AT_SEND;
  });
}

// ── Ligne de base vers étape de l'éditeur ─────────────────────────────────

/** Colonnes de sequence_steps lues par l'éditeur. */
export interface SequenceStepRow {
  id: string;
  step_order: number;
  action_type: string;
  condition_type?: string | null;
  condition_value?: string | null;
  delay_days?: number | null;
  delay_hours?: number | null;
  delay_minutes?: number | null;
  preferred_hour_start?: number | null;
  preferred_hour_end?: number | null;
  subject_template?: string | null;
  message_template?: string | null;
  use_ai_personalization?: boolean | null;
  ai_tone?: string | null;
  timeout_days?: number | null;
  wait_for_event?: string | null;
  variant_group?: string | null;
  variant_weight?: number | null;
  cc_emails?: string[] | null;
  bcc_emails?: string[] | null;
  include_unsubscribe?: boolean | null;
  signature_id?: string | null;
  if_true_goto_step?: string | null;
  if_false_goto_step?: string | null;
  next_step_id?: string | null;
  timeout_branch_step_id?: string | null;
  ends_sequence?: boolean | null;
}

/**
 * Même lecture que la modification d'une séquence : l'id de la ligne est
 * conservé. Pour une copie, save_sequence_steps insère alors de nouvelles
 * lignes et remappe elle-même les renvois vers leurs nouveaux ids.
 */
export function rowToSequenceStep(s: SequenceStepRow): Step {
  return {
    id: s.id,
    order: s.step_order,
    actionType: s.action_type as Step['actionType'],
    conditionType: (s.condition_type || 'always') as Step['conditionType'],
    conditionValue: s.condition_value ?? undefined,
    delayDays: s.delay_days ?? 0,
    delayHours: s.delay_hours ?? 0,
    delayMinutes: s.delay_minutes ?? 0,
    preferredHourStart: s.preferred_hour_start ?? 9,
    preferredHourEnd: s.preferred_hour_end ?? 18,
    subjectTemplate: s.subject_template ?? '',
    messageTemplate: s.message_template ?? '',
    useAiPersonalization: s.use_ai_personalization ?? false,
    aiTone: (s.ai_tone || 'professional') as Step['aiTone'],
    timeoutDays: s.timeout_days ?? undefined,
    waitForEvent: (s.wait_for_event ?? undefined) as Step['waitForEvent'],
    timeoutAction: s.timeout_branch_step_id ? 'alternative_step' : 'skip',
    ifTrueGotoStep: s.if_true_goto_step ?? undefined,
    ifFalseGotoStep: s.if_false_goto_step ?? undefined,
    nextStepId: s.ends_sequence ? END : s.next_step_id ?? undefined,
    timeoutBranchStepId: s.timeout_branch_step_id ?? undefined,
    variantGroup: s.variant_group ?? undefined,
    variantWeight: s.variant_weight ?? undefined,
    ccEmails: s.cc_emails ?? undefined,
    bccEmails: s.bcc_emails ?? undefined,
    includeUnsubscribe: s.include_unsubscribe ?? undefined,
    signatureId: s.signature_id ?? undefined,
  };
}

// ── Réglages de séquence lus en base (colonnes json) ──────────────────────

export function asStopConditions(value: unknown): StopConditions | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  return {
    on_reply: v.on_reply !== false,
    on_click: v.on_click === true,
    on_unsubscribe: v.on_unsubscribe !== false,
    on_meeting_booked: v.on_meeting_booked === true,
  };
}

export function asSenderAccounts(value: unknown): SenderAccountConfig[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object' && typeof (v as Record<string, unknown>).account_id === 'string')
    .map((v) => ({
      account_id: String(v.account_id),
      email: typeof v.email === 'string' ? v.email : '',
      daily_limit: typeof v.daily_limit === 'number' ? v.daily_limit : 50,
      // Libellé et canal affichés dans « Plusieurs expéditeurs » : gardés à la copie.
      ...(typeof v.label === 'string' ? { label: v.label } : {}),
      ...(v.channel === 'linkedin' ? { channel: 'linkedin' as const } : {}),
    }));
}
