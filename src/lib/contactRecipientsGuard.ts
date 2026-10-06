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

// ─── Lot 5a-2 : relecture des messages rédigés par l'IA (décision 5) ────────
//
// Une séquence dont une étape à message est rédigée par l'IA pour chaque
// candidat ne s'inscrit qu'après génération et relecture : le moteur ne
// rédige plus jamais à l'envoi (aiReviewRequired de
// supabase/functions/_shared/sequence-send-rules.ts).

/** Étapes dont le message partirait rédigé par l'IA (needsMessage du moteur, AI_REVIEW_MESSAGE_ACTIONS). */
export const AI_REVIEW_ACTION_TYPES: readonly string[] = ['message', 'inmail', 'smart_message', 'email', 'whatsapp_message'];

/** L'étape exige-t-elle un texte généré et relu avant l'inscription ? Jamais une invitation. */
export function requiresAiReview(step: { actionType: string; useAiPersonalization?: boolean | null }): boolean {
  return !!step.useAiPersonalization && AI_REVIEW_ACTION_TYPES.includes(step.actionType);
}

export const AI_REVIEW_LABEL = "J'ai relu les messages rédigés par l'IA";
export const AI_REVIEW_HELP = "Obligatoire : les messages rédigés par l'IA partent tels que vous les avez relus.";
export const RECIPIENTS_AND_AI_REVIEW_LABEL = "Je confirme les destinataires et j'ai relu les messages rédigés par l'IA";
export const RECIPIENTS_AND_AI_REVIEW_HELP = `Obligatoire à partir de ${RECIPIENTS_CONFIRM_THRESHOLD} candidats et pour tout message rédigé par l'IA.`;

/**
 * Case du pied de la préparation : aucune, celle des destinataires (dès 5),
 * celle de la relecture (séquence à message IA, quel que soit le nombre), ou
 * une seule case pour les deux dès 5 candidats.
 */
export function sendConfirmation(count: number, aiReview: boolean): { required: boolean; label: string; help: string } {
  const recipients = recipientsConfirmRequired(count);
  if (aiReview && recipients) return { required: true, label: RECIPIENTS_AND_AI_REVIEW_LABEL, help: RECIPIENTS_AND_AI_REVIEW_HELP };
  if (aiReview) return { required: true, label: AI_REVIEW_LABEL, help: AI_REVIEW_HELP };
  return { required: recipients, label: RECIPIENTS_CONFIRM_LABEL, help: RECIPIENTS_CONFIRM_HELP };
}

/**
 * Signature de ce que la case confirme : la liste des destinataires et, pour
 * une relecture, le numéro de la dernière génération. Toute génération ou
 * régénération d'un message IA la change, donc décoche la case.
 */
export function sendConfirmSignature(ids: readonly string[], aiReview: boolean, aiGenerationVersion = 0): string {
  return aiReview ? `${recipientsSignature(ids)}\u0002ia:${aiGenerationVersion}` : recipientsSignature(ids);
}

/**
 * « Générez et relisez les messages rédigés par l'IA avant d'inscrire : 3
 * candidats sur 5 n'en ont pas encore. » `missing` : candidats à inscrire
 * dont un message IA n'est pas encore généré ni écrit à la main.
 */
export function aiReviewMissingMessage(missing: number, total: number): string {
  const many = missing > 1;
  return `Générez et relisez les messages rédigés par l'IA avant d'inscrire : ${missing} candidat${many ? 's' : ''} sur ${total} n'en ${many ? 'ont' : 'a'} pas encore.`;
}
