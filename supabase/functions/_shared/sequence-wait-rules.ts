// Règles pures des contrôles de fond de process-sequences : détection des
// réponses (check_replies), délais d'attente (check_timeouts) et attentes
// d'événement (check_wait_events). Sans accès base ni réseau.
//
// Audit séquences 2026-09-25, lot E2.
//
//   deno test --no-check supabase/functions/_shared/sequence-wait-rules.test.ts

import type { ReplyCheckState } from './sequence-cycle-rules.ts';

export type { ReplyCheckState };

// ─── SEQ-031 : événement attendu par une étape d'attente ────────────────────

export interface WaitStepLike {
  action_type?: string | null;
  wait_for_event?: string | null;
  condition_type?: string | null;
  timeout_days?: number | null;
}

/**
 * Événement attendu : wait_for_event, sinon déduit du type d'étape. Les étapes
 * d'attente créées sans événement (mode Visuel, assistant) étaient franchies
 * tout de suite : « Attendre réponse » clôturait en « a répondu », « Attendre
 * connexion » déclarait le candidat connecté.
 */
export function implicitWaitEvent(step: WaitStepLike | null | undefined): string | null {
  const explicit = (step?.wait_for_event ?? '').trim();
  if (explicit) return explicit;
  if (step?.action_type === 'wait_reply') return 'reply_received';
  if (step?.action_type === 'wait_connection') return 'connection_accepted';
  return null;
}

/** Étapes d'attente dont l'événement peut être déduit du type. */
export const IMPLICIT_WAIT_ACTIONS: readonly string[] = ['wait_reply', 'wait_connection'];

/**
 * Délai appliqué à une attente sans événement ni délai (anciennes étapes de
 * l'assistant) : sans lui, l'attente désormais réelle durerait à vie. Même
 * valeur que le délai par défaut de l'assistant et de l'éditeur.
 */
export const IMPLICIT_WAIT_DEFAULT_TIMEOUT_DAYS = 3;

/** Attente de l'acceptation de l'invitation. */
export function waitsForConnection(step: WaitStepLike | null | undefined): boolean {
  return step?.wait_for_event === 'connection_accepted'
    || step?.condition_type === 'wait_until_connected'
    || step?.action_type === 'wait_connection';
}

/** Attente d'une réponse du candidat. */
export function waitsForReply(step: WaitStepLike | null | undefined): boolean {
  return !waitsForConnection(step) && implicitWaitEvent(step) === 'reply_received';
}

// Filtres PostgREST (option referencedTable: 'step') des attentes réarmables
// (phase 1 : connexion seulement, SEQ-085) et interrogeables chez le
// fournisseur (phase 2 : connexion ou réponse, SEQ-086).
export const CONNECTION_WAIT_STEP_FILTER =
  'action_type.eq.wait_connection,wait_for_event.eq.connection_accepted,condition_type.eq.wait_until_connected';
export const POLLABLE_WAIT_STEP_FILTER =
  'action_type.in.(wait_connection,wait_reply),wait_for_event.in.(connection_accepted,reply_received),condition_type.eq.wait_until_connected';

// ─── SEQ-084 : date de référence d'une vérification de réponse ──────────────

export const REPLY_FALLBACK_WINDOW_MS = 72 * 3600_000;

/**
 * Seule une réponse postérieure au dernier envoi visible (invitation comprise)
 * compte, ou à la relance du candidat si elle est plus récente. Avant : fenêtre
 * glissante de 72 h (un message antérieur à l'inscription clôturait en « a
 * répondu », une réponse de 4 jours n'était plus vue). Repli 72 h sans envoi.
 */
export function replyReferenceDate(
  lastVisibleSentAt: string | null | undefined,
  reEnrolledAt: string | null | undefined,
  nowMs: number,
): string {
  const times = [lastVisibleSentAt, reEnrolledAt]
    .map((d) => (d ? Date.parse(d) : Number.NaN))
    .filter((t) => Number.isFinite(t));
  if (times.length === 0) return new Date(nowMs - REPLY_FALLBACK_WINDOW_MS).toISOString();
  return new Date(Math.max(...times)).toISOString();
}

// ─── SEQ-078 : issue d'une lecture des conversations ────────────────────────

/**
 * 2xx : lisible ; 404 : aucun fil avec ce candidat (donc aucune réponse) ;
 * tout autre statut ou un délai dépassé (null) : on ne sait pas.
 */
export function chatLookupOutcome(status: number | null | undefined): 'ok' | 'no_thread' | 'unknown' {
  if (status == null) return 'unknown';
  if (status >= 200 && status < 300) return 'ok';
  if (status === 404) return 'no_thread';
  return 'unknown';
}

/** Plusieurs lectures (identifiant résolu puis identifiant d'origine) : un doute l'emporte sur « pas de réponse ». */
export function combineReplyStates(states: ReplyCheckState[]): ReplyCheckState {
  if (states.includes('replied')) return 'replied';
  if (states.includes('unknown')) return 'unknown';
  return 'no_reply';
}

// ─── SEQ-083 / SEQ-027 : délais d'attente ───────────────────────────────────

/**
 * Début de l'attente : scheduled_at, date à laquelle l'étape est devenue due
 * puis a été mise en attente (repli created_at). Avant : created_at, posé à la
 * planification, avant le délai de l'étape (un délai de 2 j et une attente de
 * 3 j ne laissaient qu'un jour d'attente réelle).
 */
export function waitStartedAt(exec: { scheduled_at?: string | null; created_at?: string | null }): string | null {
  return exec.scheduled_at || exec.created_at || null;
}

/**
 * Délai effectif en jours, null si l'étape n'en a pas. Une étape a un délai
 * quand timeout_days est positif (0 : aucun délai, comme avant), ou quand
 * c'est une attente sans événement ni délai (défaut ci-dessus). Le réglage
 * propre à l'inscription (modale d'inscription) remplace alors ce délai.
 */
export function effectiveWaitTimeoutDays(step: WaitStepLike, overrideDays: unknown): number | null {
  const raw = step.timeout_days;
  let base: number | null = null;
  if (raw !== null && raw !== undefined) {
    const t = Number(raw);
    base = Number.isFinite(t) && t > 0 ? t : null;
  } else if (!(step.wait_for_event ?? '').trim() && IMPLICIT_WAIT_ACTIONS.includes(step.action_type ?? '')) {
    base = IMPLICIT_WAIT_DEFAULT_TIMEOUT_DAYS;
  }
  if (base === null) return null;
  if (overrideDays !== null && overrideDays !== undefined && overrideDays !== '') {
    const o = Number(overrideDays);
    if (Number.isFinite(o) && o >= 0) return o;
  }
  return base;
}

/** L'attente commencée à `startIso` a-t-elle dépassé `timeoutDays` jours entiers ? */
export function isWaitTimedOut(startIso: string | null | undefined, timeoutDays: number | null | undefined, nowMs: number): boolean {
  if (!startIso || timeoutDays === null || timeoutDays === undefined || !Number.isFinite(timeoutDays)) return false;
  const start = Date.parse(startIso);
  if (!Number.isFinite(start)) return false;
  return Math.floor((nowMs - start) / 86_400_000) >= timeoutDays;
}

/** Statuts d'inscription terminaux : leurs attentes n'ont plus d'objet. */
export const TERMINAL_ENROLLMENT_STATUSES: readonly string[] = ['completed', 'replied', 'bounced', 'cancelled', 'stopped'];

/** Motif posé sur l'attente orpheline d'une inscription close (même préfixe que le moteur). */
export function closedEnrollmentWaitReason(enrollmentStatus: string | null | undefined): string {
  return `Inscription close (${enrollmentStatus || 'inconnue'}) : attente annulée`;
}

// ─── SEQ-074 / SEQ-075 : budget de temps et étranglement ────────────────────

/**
 * Durée après le début d'un contrôle de fond au-delà de laquelle plus rien ne
 * démarre (sortie propre vers 45 s, sous la limite d'exécution de 60 s : une
 * invocation coupée garde le verrou global jusqu'à 10 min).
 */
export const CHECK_PASS_BUDGET_MS = 45_000;
/** Temps restant minimal avant d'interroger le fournisseur (appels bornés à 15 s chacun). */
export const MIN_REMAINING_FOR_PROVIDER_CHECK_MS = 15_000;
/** Temps restant minimal avant un traitement en base seule. */
export const MIN_REMAINING_FOR_DB_WORK_MS = 5_000;

export function hasTimeLeft(deadlineMs: number, nowMs: number, minRemainingMs: number): boolean {
  return deadlineMs - nowMs >= minRemainingMs;
}

/** Dernier passage trop récent (étranglement de check_replies et de la phase 2 de check_wait_events). */
export function isThrottled(lastRunIso: string | null | undefined, minIntervalMs: number, nowMs: number): boolean {
  if (!lastRunIso) return false;
  const last = Date.parse(lastRunIso);
  if (!Number.isFinite(last)) return false;
  return nowMs - last < minIntervalMs;
}
