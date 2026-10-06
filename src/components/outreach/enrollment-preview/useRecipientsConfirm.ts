/**
 * État de la case « Je confirme les destinataires » (refonte mission, lot 5a)
 * pour une liste de destinataires : cochée pour cette liste seulement, et
 * décochée dès que la liste change (signature des identifiants).
 *
 * Lot 5a-2 : avec `aiReview`, la case vaut aussi relecture des messages
 * rédigés par l'IA. Elle est alors obligatoire quel que soit le nombre de
 * candidats, et décochée par toute génération ou régénération
 * (`aiGenerationVersion`).
 */
import { useEffect, useState } from 'react';
import { sendConfirmation, sendConfirmSignature } from '@/lib/contactRecipientsGuard';

export function useRecipientsConfirm(
  recipientIds: readonly string[],
  options: { aiReview?: boolean; aiGenerationVersion?: number } = {},
) {
  const aiReview = !!options.aiReview;
  const signature = sendConfirmSignature(recipientIds, aiReview, options.aiGenerationVersion ?? 0);
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null);
  useEffect(() => {
    setConfirmedFor(null);
  }, [signature]);
  const { required } = sendConfirmation(recipientIds.length, aiReview);
  return {
    required,
    confirmed: confirmedFor === signature,
    /** Vrai tant que la case est obligatoire et pas cochée pour la liste (et les messages IA) affichés. */
    blocked: required && confirmedFor !== signature,
    setConfirmed: (value: boolean) => setConfirmedFor(value ? signature : null),
  };
}
