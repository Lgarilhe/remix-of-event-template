// Gardes pures des contrôles de fond de process-sequences, vague finale de
// l'audit séquences 2026-09-25 (lot E2) : expéditeur d'un message relu chez le
// fournisseur, attente de connexion déjà satisfaite, lecture des attentes par
// pages et échéance d'une vérification de réponse. Sans accès base ni réseau.
//
//   deno test --no-check supabase/functions/_shared/sequence-wait-guards.test.ts

import type { ReplyCheckState } from './sequence-cycle-rules.ts';
import {
  hasTimeLeft, MIN_REMAINING_FOR_PROVIDER_CHECK_MS, waitsForConnection, type WaitStepLike,
} from './sequence-wait-rules.ts';

// ─── Expéditeur d'un message (REV engine-conditions-channels-1) ─────────────

/** Participants d'une conversation, tels que lus chez le fournisseur. */
export interface ChatAttendeeIdsLike {
  ownIds: Set<string>;
  otherIds: Set<string>;
  /** Liste des participants lue et non vide. */
  resolved: boolean;
}

/** Participants inconnus (liste non lue). */
export function unresolvedAttendees(): ChatAttendeeIdsLike {
  return { ownIds: new Set(['self']), otherIds: new Set(), resolved: false };
}

export interface ChatMessageLike {
  id?: unknown;
  is_sender?: unknown;
  is_sender_self?: unknown;
  sender_attendee_id?: unknown;
  timestamp?: unknown;
  date?: unknown;
  created_at?: unknown;
}

/** Date du message en millisecondes (NaN si illisible). */
export function messageTimeMs(m: ChatMessageLike): number {
  const raw = (m.timestamp || m.date || m.created_at) as string | number | undefined;
  return raw === undefined || raw === null || raw === '' ? Number.NaN : new Date(raw).getTime();
}

/**
 * Expéditeur donné par le message lui-même : `is_sender` (champ du
 * fournisseur, lu par tous les autres lecteurs de ce point d'accès : 1 ou
 * true = nous, 0 ou false = le candidat), puis l'ancien `is_sender_self`.
 * null si aucun des deux n'est renseigné.
 */
export function flaggedSender(m: ChatMessageLike): 'self' | 'candidate' | null {
  if (m.is_sender === true || m.is_sender === 1) return 'self';
  if (m.is_sender === false || m.is_sender === 0) return 'candidate';
  if (m.is_sender_self === true) return 'self';
  if (m.is_sender_self === false) return 'candidate';
  return null;
}

/**
 * Expéditeur d'un message : indicateurs du message d'abord, puis les
 * participants en repli. 'unknown' quand rien ne permet de trancher
 * (participants illisibles, ou lus sans que le candidat y soit identifié).
 */
export function messageSender(m: ChatMessageLike, attendees: ChatAttendeeIdsLike): 'self' | 'candidate' | 'unknown' {
  const flagged = flaggedSender(m);
  if (flagged) return flagged;
  const senderAtt = typeof m.sender_attendee_id === 'string' ? m.sender_attendee_id : '';
  if (senderAtt && attendees.ownIds.has(senderAtt)) return 'self';
  if (senderAtt && attendees.otherIds.has(senderAtt)) return 'candidate';
  // Candidat identifié parmi les participants, expéditeur hors de sa liste : nous.
  if (attendees.resolved && attendees.otherIds.size > 0) return 'self';
  return 'unknown';
}

/**
 * Faut-il lire les participants de la conversation ? Seulement si un message
 * postérieur à la date de référence n'a aucun indicateur d'expéditeur : un
 * message antérieur ne peut pas être une réponse.
 */
export function needsAttendeeResolution(messages: ChatMessageLike[], afterTimestamp: number): boolean {
  return messages.some((m) => messageTimeMs(m) > afterTimestamp && flaggedSender(m) === null);
}

/**
 * Issue d'une conversation lue : 'replied' si un message du candidat est
 * postérieur à la date de référence ; 'unknown' si un message postérieur reste
 * d'expéditeur indéterminé (avant : écarté « par prudence », la vérification
 * rendait « pas de réponse » dès que la lecture des participants échouait, et
 * la relance partait au candidat qui avait répondu) ; sinon 'no_reply'.
 */
export function replyStateOfMessages<T extends ChatMessageLike>(
  messages: T[],
  afterTimestamp: number,
  attendees: ChatAttendeeIdsLike,
): { state: ReplyCheckState; replies: T[]; undetermined: number } {
  const replies: T[] = [];
  let undetermined = 0;
  for (const m of messages) {
    if (!(messageTimeMs(m) > afterTimestamp)) continue;
    const sender = messageSender(m, attendees);
    if (sender === 'candidate') replies.push(m);
    else if (sender === 'unknown') undetermined++;
  }
  const state: ReplyCheckState = replies.length > 0 ? 'replied' : undetermined > 0 ? 'unknown' : 'no_reply';
  return { state, replies, undetermined };
}

// ─── Échéance d'une vérification de réponse (REV engine-conditions-channels-11)

/**
 * Un appel au fournisseur (15 s au plus) peut-il partir avant l'échéance du
 * contrôle de fond ? Sans échéance (vérification avant envoi, conditions) :
 * toujours. Une vérification enchaîne jusqu'à six appels : l'échéance est
 * testée avant chacun, sinon l'invocation dépassait 60 s et gardait le verrou.
 */
export function providerCallAllowed(deadlineMs: number | null | undefined, nowMs: number): boolean {
  if (deadlineMs === null || deadlineMs === undefined) return true;
  return hasTimeLeft(deadlineMs, nowMs, MIN_REMAINING_FOR_PROVIDER_CHECK_MS);
}

// ─── Attente de connexion déjà satisfaite (REV integration-2) ───────────────

export interface ConnectionStateLike {
  connection_status?: string | null;
  network_distance?: string | null;
}

/**
 * Attente de connexion dont le candidat est déjà en relation (acceptation
 * reçue pendant une pause, que le webhook enregistre sans réarmer l'attente,
 * ou pas encore vue par check_wait_events) : elle se réarme, elle n'expire pas.
 */
export function isConnectionWaitSatisfied(
  step: WaitStepLike | null | undefined,
  enrollment: ConnectionStateLike | null | undefined,
): boolean {
  if (!waitsForConnection(step)) return false;
  return enrollment?.connection_status === 'connected' || enrollment?.network_distance === 'FIRST_DEGREE';
}

// ─── Lecture des attentes par pages (REV engine-conditions-channels-2) ──────

/** Taille d'une page d'attentes lue par check_timeouts. */
export const WAIT_SCAN_PAGE_SIZE = 200;
/** Pages lues au plus par passage et par requête (le budget de temps borne aussi). */
export const WAIT_SCAN_MAX_PAGES = 10;

/**
 * Faut-il lire la page suivante ? Oui tant que la page lue était pleine et
 * qu'il reste des pages permises. Avant : une seule fenêtre des 200 attentes
 * les plus anciennes, toutes organisations confondues. 200 attentes
 * d'acceptation non échues suffisaient à cacher une attente de réponse déjà
 * échue, dont la branche « sans réponse » partait avec des jours de retard.
 */
export function shouldReadNextWaitPage(
  pageIndex: number, pageRows: number,
  opts: { pageSize?: number; maxPages?: number } = {},
): boolean {
  const pageSize = opts.pageSize ?? WAIT_SCAN_PAGE_SIZE;
  const maxPages = opts.maxPages ?? WAIT_SCAN_MAX_PAGES;
  return pageRows >= pageSize && pageIndex + 1 < maxPages;
}

/**
 * Début de la page suivante. Les attentes franchies pendant la page (expirées,
 * réarmées, ou traitées ailleurs entre-temps) ont quitté le filtre : les
 * compter dans le décalage ferait sauter autant d'attentes.
 */
export function nextWaitPageOffset(offset: number, pageRows: number, leftFilter: number): number {
  return offset + Math.max(0, pageRows - Math.max(0, leftFilter));
}
