// Écran Séquences de l'organisation (lot 5c-2) : chiffres d'une ligne du
// tableau, calculés à partir des lectures existantes (compteurs de
// get_sequence_enrollment_counts, compteurs journaliers de sequence_analytics,
// inscriptions contactées). Module pur, testé sous Node.
//
// Règles (spécification des séquences, 3.1-B) :
// - « Accept. » = invitations acceptées sur invitations envoyées ;
// - « Rép. » = candidats qui ont répondu sur candidats contactés (contacté :
//   au moins une étape envoyée, ou une réponse) ;
// - un taux ne s'affiche qu'à partir de 5 candidats contactés, sinon « - ».

import { RESPONSE_RATE_MIN_CONTACTED, computeResponseRate } from './sequenceErrorMessages.ts';

export interface EnrollmentBreakdown {
  total: number;
  active: number;
  completed: number;
  replied: number;
  paused: number;
  /** Candidats en pause par raison (sequence_enrollments.pause_reason). */
  pausedByReason: Record<string, number>;
}

export interface EnrollmentCountRow {
  sequence_id: string;
  status: string;
  pause_reason: string | null;
  count: number | string | null;
}

export const emptyBreakdown = (): EnrollmentBreakdown => ({
  total: 0, active: 0, completed: 0, replied: 0, paused: 0, pausedByReason: {},
});

/** Une ligne par séquence, statut et raison de pause → compteurs par séquence (même règle que la liste des séquences). */
export function aggregateEnrollmentCounts(rows: readonly EnrollmentCountRow[]): Map<string, EnrollmentBreakdown> {
  const bySequence = new Map<string, EnrollmentBreakdown>();
  for (const row of rows) {
    const n = Number(row.count) || 0;
    const stats = bySequence.get(row.sequence_id) ?? emptyBreakdown();
    stats.total += n;
    if (row.status === 'active') stats.active += n;
    else if (row.status === 'completed') stats.completed += n;
    else if (row.status === 'replied') stats.replied += n;
    else if (row.status === 'paused') {
      stats.paused += n;
      const reason = row.pause_reason || 'manual';
      stats.pausedByReason[reason] = (stats.pausedByReason[reason] ?? 0) + n;
    }
    bySequence.set(row.sequence_id, stats);
  }
  return bySequence;
}

/** Raisons de pause qui disent un échec d'envoi : rouge dans la barre, « en échec » dans l'alerte. */
export const FAILURE_PAUSE_REASONS = ['send_failed', 'auto_paused'] as const;

export interface ProgressSegments {
  /** En cours. */
  active: number;
  replied: number;
  /** En pause pour une autre raison qu'un échec. */
  paused: number;
  /** En pause après un échec d'envoi (send_failed, auto_paused). */
  failed: number;
  /** Terminées, arrêtées, annulées ou non distribuées. */
  done: number;
  total: number;
}

export function progressSegments(stats: EnrollmentBreakdown): ProgressSegments {
  const failed = FAILURE_PAUSE_REASONS.reduce((sum, reason) => sum + (stats.pausedByReason[reason] ?? 0), 0);
  const paused = Math.max(0, stats.paused - failed);
  const done = Math.max(0, stats.total - stats.active - stats.replied - stats.paused);
  return { active: stats.active, replied: stats.replied, paused, failed, done, total: stats.total };
}

/** « 6 en cours, 6 ont répondu, 1 en pause, 1 en échec, 10 terminées » : jamais de part à zéro. */
export function progressLabel(s: ProgressSegments): string {
  const parts: string[] = [];
  if (s.active > 0) parts.push(`${s.active} en cours`);
  if (s.replied > 0) parts.push(`${s.replied} ${s.replied > 1 ? 'ont répondu' : 'a répondu'}`);
  if (s.paused > 0) parts.push(`${s.paused} en pause`);
  if (s.failed > 0) parts.push(`${s.failed} en échec`);
  if (s.done > 0) parts.push(`${s.done} ${s.done > 1 ? 'terminées' : 'terminée'}`);
  return parts.join(', ');
}

export interface AnalyticsRow {
  sequence_id: string | null;
  invites_sent: number | null;
  invites_accepted: number | null;
}

/** Invitations envoyées et acceptées, toutes dates confondues, par séquence. */
export function aggregateInvites(rows: readonly AnalyticsRow[]): Map<string, { sent: number; accepted: number }> {
  const bySequence = new Map<string, { sent: number; accepted: number }>();
  for (const row of rows) {
    if (!row.sequence_id) continue;
    const cur = bySequence.get(row.sequence_id) ?? { sent: 0, accepted: 0 };
    cur.sent += Number(row.invites_sent) || 0;
    cur.accepted += Number(row.invites_accepted) || 0;
    bySequence.set(row.sequence_id, cur);
  }
  return bySequence;
}

export interface ContactRow {
  sequence_id: string;
  created_by: string | null;
  status: string;
  /** Exécutions envoyées de l'inscription, au plus une lue. */
  sent: readonly unknown[] | null;
}

export interface ContactStats {
  /** Contactés : au moins une étape envoyée, ou une réponse. */
  contacted: number;
  /** Membres qui ont inscrit des candidats (compte LinkedIn d'envoi par défaut), dans l'ordre d'apparition. */
  enrollers: string[];
}

export function aggregateContacts(rows: readonly ContactRow[]): Map<string, ContactStats> {
  const bySequence = new Map<string, ContactStats>();
  for (const row of rows) {
    const cur = bySequence.get(row.sequence_id) ?? { contacted: 0, enrollers: [] };
    if (row.status === 'replied' || (row.sent?.length ?? 0) > 0) cur.contacted += 1;
    if (row.created_by && !cur.enrollers.includes(row.created_by)) cur.enrollers.push(row.created_by);
    bySequence.set(row.sequence_id, cur);
  }
  return bySequence;
}

export interface SequenceRates {
  contacted: number;
  /** Pourcentage arrondi ; null sous 5 contactés ou sans invitation envoyée. */
  acceptRate: number | null;
  /** Pourcentage arrondi ; null sous 5 contactés. */
  replyRate: number | null;
}

export function sequenceRates(input: { replied: number; contacted: number; invitesSent: number; invitesAccepted: number }): SequenceRates {
  const response = computeResponseRate({ replied: input.replied, contacted: input.contacted });
  const enough = response.contacted >= RESPONSE_RATE_MIN_CONTACTED;
  const accepted = Math.min(input.invitesAccepted, input.invitesSent);
  return {
    contacted: response.contacted,
    acceptRate: enough && input.invitesSent > 0 ? Math.round((accepted / input.invitesSent) * 100) : null,
    replyRate: enough ? response.rate : null,
  };
}

export type SequenceAlertAction = 'errors' | 'reconnect' | 'pricing';

export interface SequenceAlert {
  key: string;
  text: string;
  action: SequenceAlertAction;
  actionLabel: string;
}

const candidats = (n: number) => `${n} candidat${n > 1 ? 's' : ''}`;

/**
 * Ligne d'alerte sous une séquence touchée, une entrée par cause, avec
 * l'action qui débloque (mêmes causes que les bandeaux de la liste des
 * séquences). Rien quand rien n'est bloqué.
 */
export function sequenceAlerts(stats: Pick<EnrollmentBreakdown, 'pausedByReason'>): SequenceAlert[] {
  const by = stats.pausedByReason;
  const alerts: SequenceAlert[] = [];
  const failed = by.send_failed ?? 0;
  if (failed > 0) alerts.push({ key: 'send_failed', text: `${failed} en échec`, action: 'errors', actionLabel: 'Voir les erreurs' });
  const auto = by.auto_paused ?? 0;
  if (auto > 0) {
    alerts.push({ key: 'auto_paused', text: `${candidats(auto)} en pause : trop d’échecs d’envoi`, action: 'errors', actionLabel: 'Voir les erreurs' });
  }
  const disconnected = by.account_disconnected ?? 0;
  if (disconnected > 0) {
    alerts.push({ key: 'account_disconnected', text: `${candidats(disconnected)} en pause : compte LinkedIn déconnecté`, action: 'reconnect', actionLabel: 'Reconnecter' });
  }
  const subscription = by.subscription_required ?? 0;
  if (subscription > 0) {
    alerts.push({ key: 'subscription_required', text: `${candidats(subscription)} en pause : abonnement requis`, action: 'pricing', actionLabel: 'Voir les offres' });
  }
  return alerts;
}

/** « Brouillon » : aucune inscription, jamais (spécification, 3.1). */
export function isDraftSequence(stats: Pick<EnrollmentBreakdown, 'total'>): boolean {
  return stats.total === 0;
}
