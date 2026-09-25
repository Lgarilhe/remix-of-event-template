/**
 * Libellés des étapes de séquence exécutées, pour les historiques d'un
 * candidat (frise de la fiche candidat, activité de la messagerie).
 *
 * Module pur, sans import : chargé tel quel par les tests (tests/ux).
 *
 * Les clés sont les vraies valeurs de sequence_steps.action_type
 * (connection_request, message, smart_message, inmail, profile_visit, email,
 * whatsapp_message). Les anciens noms (send_connection, send_message,
 * send_inmail, visit_profile) n'existent plus : ils faisaient afficher
 * « Action : connection_request ». Une étape en échec ou sautée n'est jamais
 * présentée comme envoyée : le moteur date aussi les échecs (executed_at).
 */

export interface SequenceActionLabel {
  /** Libellé quand l'étape est partie. */
  done: string;
  /** Nom de l'action, pour les autres statuts (« InMail : échec »). */
  noun: string;
}

export const SEQUENCE_ACTION_LABELS: Record<string, SequenceActionLabel> = {
  connection_request: { done: 'Invitation envoyée', noun: 'Invitation' },
  message: { done: 'Message envoyé', noun: 'Message' },
  smart_message: { done: 'Message envoyé', noun: 'Message' },
  inmail: { done: 'InMail envoyé', noun: 'InMail' },
  profile_visit: { done: 'Profil visité', noun: 'Visite de profil' },
  email: { done: 'E-mail envoyé', noun: 'E-mail' },
  whatsapp_message: { done: 'Message WhatsApp envoyé', noun: 'Message WhatsApp' },
};

/** Étapes internes du moteur (attentes, conditions) : rien n'est envoyé au candidat. */
export const INTERNAL_SEQUENCE_ACTIONS = [
  'wait_connection',
  'check_connection',
  'wait_reply',
  'wait_for_event',
  'wait_profile_visit',
  'condition_branch',
] as const;

/** Statuts d'une exécution partie (ouverte, cliquée ou répondue comprises). */
export const SENT_EXECUTION_STATUSES = ['sent', 'opened', 'clicked', 'replied'] as const;

export function isInternalSequenceAction(actionType: string | null | undefined): boolean {
  return !!actionType && (INTERNAL_SEQUENCE_ACTIONS as readonly string[]).includes(actionType);
}

/** Mention du statut d'une étape non partie, null si elle est partie. */
export function sequenceExecutionStatusMention(status: string | null | undefined): string | null {
  if (status && (SENT_EXECUTION_STATUSES as readonly string[]).includes(status)) return null;
  switch (status) {
    case 'failed':
    case 'bounced':
      return 'Échec';
    case 'skipped':
      return 'Étape sautée';
    case 'cancelled':
      return 'Étape annulée';
    case 'sending':
      return 'Envoi en cours';
    default:
      return 'En attente';
  }
}

/**
 * Titre d'une étape exécutée : « InMail envoyé » si elle est partie,
 * « InMail : échec » ou « Invitation : étape sautée » sinon.
 */
export function sequenceExecutionTitle(actionType: string | null | undefined, status: string | null | undefined): string {
  const label = actionType ? SEQUENCE_ACTION_LABELS[actionType] : undefined;
  const mention = sequenceExecutionStatusMention(status);
  if (!mention) return label?.done ?? 'Étape de séquence réalisée';
  return `${label?.noun ?? 'Étape de séquence'} : ${mention.toLowerCase()}`;
}

/** Numéro d'étape affiché, à partir de 1 (step_order est compté à partir de 0). */
export function stepNumberLabel(stepOrder: number | null | undefined): string {
  return `Étape ${(typeof stepOrder === 'number' && stepOrder >= 0 ? stepOrder : 0) + 1}`;
}
