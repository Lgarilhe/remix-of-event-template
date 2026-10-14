// Refonte mission, lot 5f-2d : avertissement « relation non vérifiée » de la messagerie.
//
// Module pur, sans import : chargé tel quel sous Node par les tests. Il reprend la règle de
// l'ancien parcours de la messagerie (enrollNotice de MessagesInbox) : quand le fournisseur ne
// donne pas la distance LinkedIn du candidat et que la séquence choisie commence par une
// invitation, la personne est prévenue. Si le candidat est déjà en relation, le moteur saute
// l'invitation et envoie les messages suivants.

/** Le seul champ lu d'une étape : les lignes de sequence_steps (action_type) et l'ancienne forme (actionType). */
export interface NoticeStep {
  action_type?: string | null;
  actionType?: string | null;
}

export const UNVERIFIED_RELATION_NOTICE =
  "Relation LinkedIn non vérifiée : si vous êtes déjà en relation, l'invitation sera sautée.";

/**
 * `distance` : la distance déjà normalisée par normalizeNetworkDistance (src/lib/sequenceCompatibility.ts),
 * nulle ou absente quand le fournisseur ne la donne pas. Ce module ne l'importe pas :
 * sequenceCompatibility charge des modules de l'application qu'un test Node ne sait pas résoudre.
 */
export function unverifiedRelationNotice(
  steps: readonly NoticeStep[] | null | undefined,
  distance: string | null | undefined,
): string | null {
  if (distance != null) return null;
  const hasInvitation = (steps ?? []).some((step) => (step.action_type || step.actionType) === 'connection_request');
  return hasInvitation ? UNVERIFIED_RELATION_NOTICE : null;
}
