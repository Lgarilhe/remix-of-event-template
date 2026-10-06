/**
 * Statistiques des séquences d'un poste (fiche poste de l'ATS, onglet Séquences).
 *
 * Module pur, sans import : chargé tel quel par les tests (tests/ux).
 *
 * - Inscrits : toutes les inscriptions de la séquence pour ce poste.
 * - Envoyés : candidats qui ont reçu au moins un envoi. Une inscription qui a
 *   répondu ou qui est terminée compte toujours ; les autres (en cours, en
 *   pause, arrêtées) seulement si une étape d'envoi est réellement partie. Une
 *   inscription active sans aucun envoi ne compte pas.
 * - Réponses : inscriptions au statut 'replied'. connection_status ne prend
 *   jamais la valeur 'replied' (seulement 'connected' ou 'pending_invite') :
 *   l'ancien calcul affichait toujours 0 %.
 */

/** Étapes qui envoient quelque chose au candidat (hors attentes, conditions et visites). */
export const SENDING_ACTION_TYPES = [
  'connection_request',
  'message',
  'smart_message',
  'inmail',
  'email',
  'whatsapp_message',
] as const;

/** Statuts d'une exécution partie (ouverte, cliquée ou répondue comprises). */
export const SENT_EXECUTION_STATUSES = ['sent', 'opened', 'clicked', 'replied'] as const;

export interface JobSequenceEnrollmentRow {
  sequence_id: string;
  status: string | null;
  outreach_sequences?: { name?: string | null } | null;
  sequence_step_executions?: Array<{
    status: string | null;
    sequence_steps?: { action_type?: string | null } | null;
  }> | null;
}

export interface JobSequenceStat {
  id: string;
  name: string;
  enrolledCount: number;
  sentCount: number;
  repliedCount: number;
}

const includes = (list: readonly string[], value: string | null | undefined): boolean =>
  !!value && list.includes(value);

export function hasSentExecution(row: JobSequenceEnrollmentRow): boolean {
  return (row.sequence_step_executions ?? []).some(
    (ex) => includes(SENT_EXECUTION_STATUSES, ex.status) && includes(SENDING_ACTION_TYPES, ex.sequence_steps?.action_type),
  );
}

export function computeJobSequenceStats(rows: readonly JobSequenceEnrollmentRow[]): JobSequenceStat[] {
  const map = new Map<string, JobSequenceStat>();
  for (const row of rows) {
    const id = row.sequence_id;
    let stat = map.get(id);
    if (!stat) {
      stat = { id, name: row.outreach_sequences?.name || 'Sans nom', enrolledCount: 0, sentCount: 0, repliedCount: 0 };
      map.set(id, stat);
    }
    stat.enrolledCount += 1;
    const replied = row.status === 'replied';
    if (replied) stat.repliedCount += 1;
    if (replied || row.status === 'completed' || hasSentExecution(row)) stat.sentCount += 1;
  }
  return Array.from(map.values());
}

/** Taux de réponse en pourcentage entier, 0 sans envoi. */
export function responseRatePercent(stat: Pick<JobSequenceStat, 'sentCount' | 'repliedCount'>): number {
  return stat.sentCount > 0 ? Math.round((stat.repliedCount / stat.sentCount) * 100) : 0;
}
