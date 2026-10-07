/**
 * États d'une conversation de la messagerie : une seule définition pour les
 * onglets, leurs compteurs, les repères de la liste et la ligne « À faire » de
 * la conversation.
 *
 * - À répondre : le candidat a écrit le dernier message.
 * - À relancer : vous avez écrit le dernier message, sans réponse depuis
 *   FOLLOW_UP_BUSINESS_DAYS jours ouvrés (même fenêtre que le chiffre « À
 *   traiter » de la barre latérale, src/lib/businessDays.ts) et sans séquence
 *   active qui s'en charge.
 * - En attente : vous avez écrit le dernier message, sans que la relance soit
 *   due, ou une séquence active attend déjà le candidat.
 *
 * Module pur, sans import : chargé tel quel par les tests (tests/ux).
 */

export type ThreadState = 'to_reply' | 'to_follow_up' | 'waiting' | 'none';

/** Onglet de la liste. « all » : aucune restriction. */
export type ResponseFilter = 'all' | 'waiting_me' | 'to_follow_up' | 'waiting_candidate';

/** Jours ouvrés sans réponse avant de proposer une relance. */
export const FOLLOW_UP_BUSINESS_DAYS = 3;

/** État que sélectionne chaque onglet. */
export const RESPONSE_FILTER_STATE: Record<Exclude<ResponseFilter, 'all'>, ThreadState> = {
  waiting_me: 'to_reply',
  to_follow_up: 'to_follow_up',
  waiting_candidate: 'waiting',
};

/** Paramètre ?onglet= de /inbox (absent : « Toutes »). */
const TAB_PARAMS: Record<Exclude<ResponseFilter, 'all'>, string> = {
  waiting_me: 'a-repondre',
  to_follow_up: 'a-relancer',
  waiting_candidate: 'en-attente',
};

export function responseFilterFromParam(param: string | null | undefined): ResponseFilter {
  const found = (Object.keys(TAB_PARAMS) as Array<keyof typeof TAB_PARAMS>).find((key) => TAB_PARAMS[key] === param);
  return found ?? 'all';
}

export function responseFilterToParam(filter: ResponseFilter): string | null {
  return filter === 'all' ? null : TAB_PARAMS[filter];
}

/**
 * Auteur d'un message : true = vous, false = le candidat, null = inconnu.
 * La liste des conversations donne un booléen (le serveur le convertit), mais
 * les messages d'une conversation arrivent tels que LinkedIn les envoie : 1 ou 0.
 * Un champ absent reste inconnu, jamais deviné.
 */
export function authorIsMine(value: unknown): boolean | null {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  return null;
}

export interface ThreadInput {
  /** Auteur du dernier message : true = vous, false = le candidat, null = inconnu. */
  lastIsMine: boolean | null;
  lastAt: string | null;
  /** Une inscription de séquence active attend encore ce candidat : la relance est déjà prévue. */
  sequenceActive: boolean;
}

const DAY_MS = 86_400_000;

/**
 * Jours ouvrés écoulés depuis une date ISO (samedi et dimanche sautés, fuseau du
 * navigateur). Même règle que businessDaysCutoff : un message du jeudi 10 h a
 * trois jours ouvrés le mardi suivant à 10 h. Null si la date est illisible.
 */
export function businessDaysSince(iso: string, now: Date): number | null {
  const from = new Date(iso);
  if (Number.isNaN(from.getTime())) return null;
  const elapsed = now.getTime() - from.getTime();
  if (elapsed <= 0) return 0;
  // Au-delà d'un an, une approximation suffit et évite une longue boucle.
  if (elapsed > 400 * DAY_MS) return Math.floor(elapsed / DAY_MS / 7) * 5;
  const d = new Date(from.getTime());
  let days = 0;
  for (;;) {
    d.setDate(d.getDate() + 1);
    if (d.getTime() > now.getTime()) return days;
    const weekday = d.getDay();
    if (weekday !== 0 && weekday !== 6) days += 1;
  }
}

export interface LastMessageLike {
  is_sender?: boolean | number | null;
  timestamp?: string | null;
  is_deleted?: boolean;
}

/** Message le plus récent d'un fil, hors messages supprimés. Null si aucun n'a de date lisible. */
export function latestMessage<T extends LastMessageLike>(messages: readonly T[]): T | null {
  let best: T | null = null;
  let bestTime = -Infinity;
  for (const message of messages) {
    if (message.is_deleted || !message.timestamp) continue;
    const time = new Date(message.timestamp).getTime();
    if (Number.isNaN(time) || time < bestTime) continue;
    best = message;
    bestTime = time;
  }
  return best;
}

export function threadState(input: ThreadInput, now: Date): ThreadState {
  if (input.lastIsMine === false) return 'to_reply';
  if (input.lastIsMine !== true) return 'none';
  if (input.sequenceActive) return 'waiting';
  const days = input.lastAt ? businessDaysSince(input.lastAt, now) : null;
  return days !== null && days >= FOLLOW_UP_BUSINESS_DAYS ? 'to_follow_up' : 'waiting';
}

export interface ThreadCounts {
  to_reply: number;
  to_follow_up: number;
  waiting: number;
}

export function countThreadStates(states: Iterable<ThreadState>): ThreadCounts {
  const counts: ThreadCounts = { to_reply: 0, to_follow_up: 0, waiting: 0 };
  for (const state of states) {
    if (state !== 'none') counts[state] += 1;
  }
  return counts;
}

export interface SuggestedAction {
  type: string;
  priority: 'high' | 'medium' | 'low';
  label: string;
  description: string | null;
}

const PRIORITY_RANK: Record<SuggestedAction['priority'], number> = { high: 0, medium: 1, low: 2 };

/**
 * Action la plus prioritaire de l'analyse en cache (analyze-response :
 * suggestedActions, cinq au plus). À égalité, la première. Null sans action
 * lisible : analyse absente, marqueur « aucun message du candidat », liste vide.
 */
export function pickSuggestedAction(analysis: unknown): SuggestedAction | null {
  if (!analysis || typeof analysis !== 'object') return null;
  const raw = (analysis as { suggestedActions?: unknown }).suggestedActions;
  if (!Array.isArray(raw)) return null;
  let best: SuggestedAction | null = null;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { type, priority, label, description } = item as Record<string, unknown>;
    if (typeof label !== 'string' || !label.trim()) continue;
    const rank: SuggestedAction['priority'] =
      priority === 'high' || priority === 'low' ? priority : 'medium';
    if (best && PRIORITY_RANK[rank] >= PRIORITY_RANK[best.priority]) continue;
    best = {
      type: typeof type === 'string' ? type : 'reply',
      priority: rank,
      label: label.trim().slice(0, 160),
      description: typeof description === 'string' && description.trim() ? description.trim().slice(0, 240) : null,
    };
  }
  return best;
}
