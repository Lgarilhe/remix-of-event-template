/**
 * État de la case « Je confirme les destinataires » (refonte mission, lot 5a)
 * pour une liste de destinataires : cochée pour cette liste seulement, et
 * décochée dès que la liste change (signature des identifiants).
 */
import { useEffect, useState } from 'react';
import { recipientsConfirmBlocks, recipientsConfirmRequired, recipientsSignature } from '@/lib/contactRecipientsGuard';

export function useRecipientsConfirm(recipientIds: readonly string[]) {
  const signature = recipientsSignature(recipientIds);
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null);
  useEffect(() => {
    setConfirmedFor(null);
  }, [signature]);
  return {
    required: recipientsConfirmRequired(recipientIds.length),
    confirmed: confirmedFor === signature,
    /** Vrai tant que la case est obligatoire et pas cochée pour la liste affichée. */
    blocked: recipientsConfirmBlocks(recipientIds, confirmedFor),
    setConfirmed: (value: boolean) => setConfirmedFor(value ? signature : null),
  };
}

