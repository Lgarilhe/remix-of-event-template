// Arrêt manuel d'une inscription et son annulation (refonte mission, lot 5b,
// décision 3 du plan docs/refonte-mission/lot5-plan.md) : règles pures des
// actions membres stop_enrollments et undo_stop_enrollments de
// process-sequences, sans accès base.
//
// - Un arrêt clôt l'inscription en 'completed' avec
//   tracking_data.completion_reason = 'manual_stop' : elle reste comptée par
//   l'anti-doublon de 90 jours (find_recent_org_contacts, enrollmentDuplicates,
//   outil de l'assistant), et une réponse tardive la fait passer « A répondu ».
// - tracking_data.manual_stop garde le jeton, l'auteur, la date et l'état
//   d'avant (statut et raison de pause) : l'annulation, permise 2 minutes à
//   son auteur, remet l'inscription en pause, puis la reprise serveur
//   (resumeOneEnrollment) la réactive si elle était active.
// - Les étapes en attente sont annulées avec le motif « Arrêt manuel », déjà
//   réarmable par la reprise (RESUMABLE_SKIP_REASONS).
//
//   deno test --no-check supabase/functions/_shared/enrollment-stop.test.ts

/** Motif des exécutions annulées par un arrêt manuel (réarmable, RESUMABLE_SKIP_REASONS). */
export const MANUAL_STOP_SKIP_REASON = 'Arrêt manuel';
/** tracking_data.completion_reason d'une inscription arrêtée à la main. */
export const MANUAL_STOP_COMPLETION_REASON = 'manual_stop';
/** Validité du jeton d'annulation : 2 minutes après l'arrêt. */
export const STOP_UNDO_WINDOW_MS = 120_000;
/** Écart d'horloge toléré pour une date d'arrêt dans le futur. */
const FUTURE_SKEW_MS = 60_000;
/** Inscriptions au plus par demande d'arrêt ou d'annulation. */
export const STOP_BATCH_MAX = 200;
/** Statuts qu'un arrêt manuel peut clore. */
export const STOPPABLE_STATUSES: readonly string[] = ['active', 'paused'];

// Raisons de pause qu'une annulation peut remettre (contrainte de la base).
const RESTORABLE_PAUSE_REASONS: readonly string[] = [
  'manual', 'account_disconnected', 'quota_reached', 'subscription_required',
  'sequence_inactive', 'auto_paused', 'send_failed', 'blocked_by_candidate',
];

export interface ManualStop {
  token: string;
  /** Auteur de l'arrêt (user_id), null pour un appel en clé de service. */
  by: string | null;
  /** Date de l'arrêt (ISO), départ des 2 minutes. */
  at: string;
  previous_status: 'active' | 'paused';
  previous_pause_reason: string | null;
}

export type StopOutcome = 'stopped' | 'not_eligible' | 'gdpr_erased' | 'forbidden' | 'changed' | 'not_found' | 'error';
export type UndoOutcome =
  | 'resumed' | 'paused' | 'resume_refused' | 'finished'
  | 'expired' | 'not_author' | 'moved_since' | 'gdpr_erased' | 'replied'
  | 'forbidden' | 'not_found' | 'error';
/** Raison d'une reprise refusée après l'annulation (l'inscription reste en pause manuelle). */
export type ResumeRefusalReason = 'account_unlinked' | 'sequence_inactive' | 'gdpr_registry_unavailable' | 'gdpr_erased' | 'other';

const COLLABORATOR_MESSAGE = 'Vous ne pouvez agir que sur les candidats que vous avez inscrits.';
const NOT_FOUND_MESSAGE = 'Inscription introuvable dans votre organisation.';

/** Message par résultat d'arrêt (aucun pour « stopped »). */
export const STOP_MESSAGES: Record<Exclude<StopOutcome, 'stopped'>, string> = {
  not_eligible: "Ce candidat n'est plus en cours dans la séquence : il n'y a rien à arrêter.",
  gdpr_erased: "Ce candidat a demandé l'effacement de ses données : sa séquence est déjà arrêtée.",
  forbidden: COLLABORATOR_MESSAGE,
  changed: "Arrêt impossible pour l'instant : rien n'a changé.",
  not_found: NOT_FOUND_MESSAGE,
  error: "Arrêt impossible pour l'instant : rien n'a changé.",
};

/** Message par résultat d'annulation ; « resume_refused » : undoResumeRefusedMessage. */
export const UNDO_MESSAGES: Record<Exclude<UndoOutcome, 'resume_refused'>, string> = {
  resumed: 'Arrêt annulé : le candidat reprend la séquence là où il en était.',
  paused: 'Arrêt annulé : le candidat est de nouveau en pause.',
  finished: 'Arrêt annulé : la séquence est terminée pour ce candidat.',
  expired: 'Annulation impossible : le délai est passé.',
  not_author: "Annulation impossible : seule la personne qui a arrêté la séquence peut l'annuler.",
  moved_since: 'Annulation impossible : la séquence du candidat a changé entre-temps.',
  gdpr_erased: "Annulation impossible : ce candidat a demandé l'effacement de ses données.",
  replied: 'Annulation impossible : le candidat a répondu entre-temps.',
  forbidden: COLLABORATOR_MESSAGE,
  not_found: NOT_FOUND_MESSAGE,
  error: "L'annulation n'a pas pu être enregistrée. Réessayez dans un instant.",
};

const RESUME_REFUSAL_TEXT: Record<ResumeRefusalReason, string> = {
  account_unlinked: 'compte LinkedIn non relié',
  sequence_inactive: 'séquence en pause',
  gdpr_registry_unavailable: 'vérification des effacements indisponible',
  gdpr_erased: 'effacement des données demandé',
  other: 'reprise impossible pour le moment',
};

/** « Arrêt annulé : le candidat reste en pause (raison). » */
export function undoResumeRefusedMessage(reason: ResumeRefusalReason): string {
  return `Arrêt annulé : le candidat reste en pause (${RESUME_REFUSAL_TEXT[reason]}).`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

const ms = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : NaN);

/** tracking_data relu, plus la raison de fin et la trace de l'arrêt. */
export function stopTracking(trackingData: unknown, stop: ManualStop): Record<string, unknown> {
  return {
    ...(asRecord(trackingData) ?? {}),
    completion_reason: MANUAL_STOP_COMPLETION_REASON,
    manual_stop: { ...stop },
  };
}

/** Trace de l'arrêt lue dans tracking_data, null si absente ou illisible. */
export function readManualStop(trackingData: unknown): ManualStop | null {
  const raw = asRecord(asRecord(trackingData)?.manual_stop);
  if (!raw) return null;
  const { token, by, at, previous_status: previousStatus, previous_pause_reason: previousPauseReason } = raw;
  if (typeof token !== 'string' || !token || typeof at !== 'string' || !Number.isFinite(ms(at))) return null;
  if (previousStatus !== 'active' && previousStatus !== 'paused') return null;
  return {
    token,
    by: typeof by === 'string' && by ? by : null,
    at,
    previous_status: previousStatus,
    previous_pause_reason: typeof previousPauseReason === 'string' && previousPauseReason ? previousPauseReason : null,
  };
}

/** Inscription close par un arrêt manuel (statut et raison de fin). */
export function isManualStop(status: string | null | undefined, trackingData: unknown): boolean {
  return status === 'completed' && asRecord(trackingData)?.completion_reason === MANUAL_STOP_COMPLETION_REASON;
}

/** Fin de validité du jeton (ISO). */
export function undoExpiresAt(stopAtIso: string): string {
  return new Date(ms(stopAtIso) + STOP_UNDO_WINDOW_MS).toISOString();
}

/** Jeton encore valable : arrêt posé il y a 2 minutes au plus (date future refusée au-delà d'une minute d'écart). */
export function isUndoWindowOpen(stopAtIso: string, nowMs: number): boolean {
  const at = ms(stopAtIso);
  if (!Number.isFinite(at)) return false;
  return at - nowMs <= FUTURE_SKEW_MS && nowMs - at <= STOP_UNDO_WINDOW_MS;
}

/** Raison de pause remise par l'annulation : celle d'avant l'arrêt, sinon 'manual'. */
export function pauseReasonAfterUndo(stop: Pick<ManualStop, 'previous_status' | 'previous_pause_reason'>): string {
  return stop.previous_status === 'paused' && stop.previous_pause_reason
    && RESTORABLE_PAUSE_REASONS.includes(stop.previous_pause_reason)
    ? stop.previous_pause_reason
    : 'manual';
}

/**
 * Raisons de pause levées par un événement (reconnexion du compte LinkedIn,
 * paiement, réactivation de la séquence), qui ne reprend que les inscriptions
 * en pause à son arrivée. Pendant l'arrêt, l'inscription est close : si
 * l'événement est passé entre-temps, remettre la raison la laisserait en pause
 * sans fin.
 */
export const EVENT_LIFTED_PAUSE_REASONS: readonly string[] = [
  'account_disconnected', 'subscription_required', 'sequence_inactive', 'auto_paused',
];

/**
 * Cause de la pause d'avant l'arrêt encore présente au moment de l'annulation.
 * Une valeur inconnue (lecture impossible, null) vaut « présente » : la raison
 * d'avant est remise, comme sans ce contrôle. Raison manuelle ou levée par une
 * personne (quota, échec d'envoi, blocage) : toujours présente.
 */
export function pauseCauseHolds(
  reason: string,
  state: { sequenceActive: boolean | null; accountOk: boolean | null; canSendSequences: boolean | null },
): boolean {
  switch (reason) {
    case 'sequence_inactive':
    case 'auto_paused':
      return state.sequenceActive !== true;
    case 'account_disconnected':
      return state.accountOk !== true;
    case 'subscription_required':
      return state.canSendSequences !== true;
    default:
      return true;
  }
}

/** tracking_data après l'annulation : raison de fin et trace retirées, date d'annulation gardée. */
export function undoTracking(trackingData: unknown, nowIso: string): Record<string, unknown> {
  const copy = { ...(asRecord(trackingData) ?? {}) };
  if (copy.completion_reason === MANUAL_STOP_COMPLETION_REASON) delete copy.completion_reason;
  delete copy.manual_stop;
  copy.manual_stop_undone_at = nowIso;
  return copy;
}

/**
 * tracking_data d'une inscription relancée (« Relancer la séquence ») après un
 * arrêt : raison de fin et trace de l'arrêt retirées, pour qu'une fin
 * ultérieure ne s'affiche pas comme un arrêt manuel. Autres clés inchangées.
 */
export function withoutManualStop(trackingData: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...trackingData };
  if (copy.completion_reason === MANUAL_STOP_COMPLETION_REASON) delete copy.completion_reason;
  delete copy.manual_stop;
  return copy;
}

export type StopDecision =
  | { kind: 'stop'; previousStatus: 'active' | 'paused'; previousPauseReason: string | null }
  | { kind: 'refuse'; outcome: 'forbidden' | 'gdpr_erased' | 'not_eligible' };

/** Arrêt d'une inscription relue : collaborateur, effacement RGPD, statut. */
export function decideStop(input: {
  status: string;
  pauseReason: string | null | undefined;
  gdprErased: boolean;
  canAct: boolean;
}): StopDecision {
  if (!input.canAct) return { kind: 'refuse', outcome: 'forbidden' };
  if (input.gdprErased) return { kind: 'refuse', outcome: 'gdpr_erased' };
  if (input.status !== 'active' && input.status !== 'paused') return { kind: 'refuse', outcome: 'not_eligible' };
  return {
    kind: 'stop',
    previousStatus: input.status,
    previousPauseReason: input.status === 'paused' ? input.pauseReason ?? null : null,
  };
}

export type UndoDecision =
  | { kind: 'undo'; previousStatus: 'active' | 'paused'; pauseReason: string; stopAt: string }
  | { kind: 'refuse'; outcome: 'forbidden' | 'replied' | 'moved_since' | 'not_author' | 'expired' | 'gdpr_erased' };

/**
 * Lecture des refus d'une annulation, dans cet ordre : collaborateur ;
 * réponse déjà enregistrée (statut « répondu » avec ce jeton) ; inscription
 * qui n'est plus close par CET arrêt (autre statut, autre jeton) ; autre
 * auteur ; délai passé ; effacement RGPD. Les réponses vues ailleurs
 * (conversation de mission, inscription sœur) sont lues ensuite par
 * l'appelant (replyAfterStop).
 */
export function decideUndo(input: {
  status: string;
  trackingData: unknown;
  token: string;
  callerUserId: string | null;
  nowMs: number;
  gdprErased: boolean;
  canAct: boolean;
}): UndoDecision {
  if (!input.canAct) return { kind: 'refuse', outcome: 'forbidden' };
  const stop = readManualStop(input.trackingData);
  const sameStop = !!stop && !!input.token && stop.token === input.token;
  if (sameStop && input.status === 'replied') return { kind: 'refuse', outcome: 'replied' };
  if (!stop || !sameStop || !isManualStop(input.status, input.trackingData)) return { kind: 'refuse', outcome: 'moved_since' };
  if (stop.by !== input.callerUserId) return { kind: 'refuse', outcome: 'not_author' };
  if (!isUndoWindowOpen(stop.at, input.nowMs)) return { kind: 'refuse', outcome: 'expired' };
  if (input.gdprErased) return { kind: 'refuse', outcome: 'gdpr_erased' };
  return { kind: 'undo', previousStatus: stop.previous_status, pauseReason: pauseReasonAfterUndo(stop), stopAt: stop.at };
}

/** Une des dates (réponse reçue) est postérieure à l'arrêt. */
export function replyAfterStop(stopAtIso: string, dates: Array<string | null | undefined>): boolean {
  const at = ms(stopAtIso);
  if (!Number.isFinite(at)) return false;
  return dates.some((d) => ms(d) > at);
}

/** Compteurs de la réponse d'arrêt, tous présents même à zéro. */
export function countStopOutcomes(results: Array<{ outcome: StopOutcome }>): Record<StopOutcome, number> {
  const counts: Record<StopOutcome, number> = {
    stopped: 0, not_eligible: 0, gdpr_erased: 0, forbidden: 0, changed: 0, not_found: 0, error: 0,
  };
  for (const r of results) counts[r.outcome]++;
  return counts;
}

/** Compteurs de la réponse d'annulation, tous présents même à zéro. */
export function countUndoOutcomes(results: Array<{ outcome: UndoOutcome }>): Record<UndoOutcome, number> {
  const counts: Record<UndoOutcome, number> = {
    resumed: 0, paused: 0, resume_refused: 0, finished: 0, expired: 0, not_author: 0,
    moved_since: 0, gdpr_erased: 0, replied: 0, forbidden: 0, not_found: 0, error: 0,
  };
  for (const r of results) counts[r.outcome]++;
  return counts;
}
