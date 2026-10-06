// Vocabulaire commun du module séquences : statuts d'inscription, raisons de
// pause et statuts d'exécution « en attente ». Une seule source pour la liste
// des séquences, le suivi par séquence, la fiche candidat et la messagerie.
//
// Les raisons de pause reflètent la contrainte sequence_enrollments_pause_reason_check.
// Toute nouvelle valeur doit d'abord y être ajoutée par une migration.

export type EnrollmentStatus =
  | 'active'
  | 'paused'
  | 'completed'
  | 'replied'
  | 'bounced'
  | 'cancelled'
  | 'stopped';

export const ENROLLMENT_STATUS_LABELS: Record<EnrollmentStatus, string> = {
  active: 'En cours',
  paused: 'En pause',
  completed: 'Terminée',
  replied: 'A répondu',
  bounced: 'Adresse invalide',
  cancelled: 'Annulée',
  stopped: 'Arrêtée automatiquement',
};

export function enrollmentStatusLabel(status: string | null | undefined): string {
  return ENROLLMENT_STATUS_LABELS[status as EnrollmentStatus] ?? 'Statut inconnu';
}

export type PauseReason =
  | 'manual'
  | 'account_disconnected'
  | 'quota_reached'
  | 'subscription_required'
  | 'sequence_inactive'
  | 'auto_paused'
  | 'send_failed'
  | 'blocked_by_candidate';

/** Raisons posées par une mise en pause de la séquence entière : la réactivation ne reprend qu'elles. */
export const SEQUENCE_LEVEL_PAUSE_REASONS: PauseReason[] = ['sequence_inactive', 'auto_paused'];

export const PAUSE_REASON_LABELS: Record<PauseReason, string> = {
  manual: 'En pause',
  account_disconnected: 'En pause (compte LinkedIn déconnecté)',
  quota_reached: 'En pause (limite d’envoi atteinte)',
  subscription_required: 'En pause (abonnement requis)',
  sequence_inactive: 'En pause (séquence en pause)',
  auto_paused: 'En pause (trop d’échecs d’envoi)',
  send_failed: 'En pause (échec d’envoi)',
  blocked_by_candidate: 'En pause (candidat injoignable)',
};

/** Ce que l'utilisateur peut faire pour débloquer, affiché sous le statut. */
export const PAUSE_REASON_HINTS: Record<PauseReason, string> = {
  manual: 'Reprenez la séquence quand vous le souhaitez.',
  account_disconnected: 'Reconnectez votre compte LinkedIn, les envois reprendront.',
  quota_reached: 'Les envois reprendront quand la limite sera levée.',
  subscription_required: 'Choisissez une offre pour reprendre les envois.',
  sequence_inactive: 'Réactivez la séquence pour reprendre les envois.',
  auto_paused: 'Vérifiez les erreurs, puis réactivez la séquence.',
  send_failed: 'Consultez l’erreur avant de reprendre.',
  blocked_by_candidate: 'Ce candidat ne peut pas recevoir de message LinkedIn.',
};

export function pausedLabel(reason: string | null | undefined): string {
  return PAUSE_REASON_LABELS[reason as PauseReason] ?? 'En pause';
}

export function pauseReasonHint(reason: string | null | undefined): string | null {
  return PAUSE_REASON_HINTS[reason as PauseReason] ?? null;
}

/**
 * Exécutions encore à venir. Une clôture d'inscription (réponse, arrêt définitif)
 * les annule toutes ; « sending » n'en fait pas partie (envoi en cours, le moteur
 * tranche après l'appel).
 */
export const PENDING_EXECUTION_STATUSES = ['scheduled', 'waiting_event', 'quota_blocked'] as const;

/** Exécutions terminées avec un envoi réel ou une décision définitive sur l'étape. */
export const DONE_EXECUTION_STATUSES = ['sent', 'opened', 'clicked', 'replied', 'skipped'] as const;

// ─── Arrêt manuel (lot 5b, décision 3) ─────────────────────────────────────
//
// « Arrêter pour ce candidat » clôt l'inscription en 'completed' avec
// tracking_data.completion_reason = 'manual_stop' (action serveur
// stop_enrollments de process-sequences). Elle reste comptée comme un contact
// pendant 90 jours ; « Relancer la séquence » (re_enroll) la reprend.

/** tracking_data.completion_reason d'une inscription arrêtée à la main. */
export const MANUAL_STOP_COMPLETION_REASON = 'manual_stop';

/** Élément de menu de l'arrêt d'un candidat (suivi des inscrits et fiche candidat). */
export const STOP_FOR_CANDIDATE_LABEL = 'Arrêter pour ce candidat';

/** Aide affichée sous « Arrêter pour ce candidat ». */
export const MANUAL_STOP_HELP = 'Le candidat reste compté comme contacté pendant 90 jours. Vous pourrez le relancer plus tard.';

/** Action proposée après un arrêt manuel (re_enroll : l'étape annulée par l'arrêt est réarmée). */
export const RELAUNCH_AFTER_STOP_LABEL = 'Relancer la séquence';

export interface ManualStopInfo {
  /** Auteur de l'arrêt (user_id), null s'il n'est pas connu. */
  by: string | null;
  /** Date de l'arrêt (ISO), null si elle n'est pas connue. */
  at: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/**
 * Arrêt manuel lu sur une inscription : statut 'completed' et
 * completion_reason 'manual_stop' ; auteur et date lus dans
 * tracking_data.manual_stop. null pour toute autre inscription.
 */
export function readManualStop(
  status: string | null | undefined,
  completionReason: unknown,
  manualStop: unknown,
): ManualStopInfo | null {
  if (status !== 'completed' || completionReason !== MANUAL_STOP_COMPLETION_REASON) return null;
  const stop = asRecord(manualStop);
  const by = typeof stop?.by === 'string' && stop.by ? stop.by : null;
  const at = typeof stop?.at === 'string' && Number.isFinite(Date.parse(stop.at)) ? stop.at : null;
  return { by, at };
}

/**
 * L'inscription porte la trace d'un arrêt manuel (tracking_data.manual_stop),
 * quel que soit son statut (une réponse tardive la fait passer « répondu »
 * sans retirer la trace ; « Annuler » et « Relancer » la retirent).
 */
export function isManualStopTrace(manualStop: unknown): boolean {
  return asRecord(manualStop) !== null;
}

/** Même lecture à partir de tracking_data entier. */
export function hasManualStopTrace(trackingData: unknown): boolean {
  return isManualStopTrace(asRecord(trackingData)?.manual_stop);
}

/** Même lecture à partir de tracking_data entier. */
export function readManualStopFromTracking(status: string | null | undefined, trackingData: unknown): ManualStopInfo | null {
  const tracking = asRecord(trackingData);
  return readManualStop(status, tracking?.completion_reason, tracking?.manual_stop);
}

/** « 29/09 » dans le fuseau du navigateur. */
function dayMonth(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** « Arrêtée par Guillaume Martin le 29/09 » ; sans nom « Arrêtée le 29/09 » ; sans date « Arrêtée par Guillaume Martin ». */
export function manualStopLabel(info: ManualStopInfo, byName?: string | null): string {
  const name = byName?.trim();
  const who = name ? ` par ${name}` : '';
  const when = info.at ? ` le ${dayMonth(info.at)}` : '';
  return who || when ? `Arrêtée${who}${when}` : 'Arrêtée manuellement';
}
