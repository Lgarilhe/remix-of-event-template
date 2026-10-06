// Case « Je confirme les destinataires » (refonte mission, lot 5a, décisions 4
// et 7 du lot 5) : obligatoire dès 5 candidats dans les fenêtres qui
// inscrivent dans une séquence ou programment des InMails groupés.
//
// Module pur, sans import : le compte est celui du bouton (candidats
// réellement inscrits, après retraits, exclusions et dérogations), la case
// se décoche dès que la liste des destinataires change.

/** Nombre de destinataires à partir duquel la case est obligatoire. */
export const RECIPIENTS_CONFIRM_THRESHOLD = 5;

export const RECIPIENTS_CONFIRM_LABEL = 'Je confirme les destinataires';
export const RECIPIENTS_CONFIRM_HELP = `Obligatoire à partir de ${RECIPIENTS_CONFIRM_THRESHOLD} candidats.`;

/** La case est-elle obligatoire pour ce nombre de destinataires ? */
export function recipientsConfirmRequired(count: number): boolean {
  return count >= RECIPIENTS_CONFIRM_THRESHOLD;
}

/**
 * Signature d'une liste de destinataires, indépendante de l'ordre : elle
 * change dès qu'un candidat est ajouté, retiré, exclu ou réintégré.
 */
export function recipientsSignature(ids: readonly string[]): string {
  return [...ids].sort().join('\u0001');
}

/**
 * La case bloque-t-elle l'envoi ? Oui dès le seuil, tant qu'elle n'a pas été
 * cochée pour la liste affichée (`confirmedFor` : signature de la liste au
 * moment où la case a été cochée, null si elle ne l'est pas).
 */
export function recipientsConfirmBlocks(ids: readonly string[], confirmedFor: string | null): boolean {
  return recipientsConfirmRequired(ids.length) && confirmedFor !== recipientsSignature(ids);
}
