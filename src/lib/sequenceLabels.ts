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
  sequence_inactive: 'En pause (séquence désactivée)',
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
