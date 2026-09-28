/**
 * ErrorBox : bloc affiché quand une lecture de la marketplace échoue.
 * Sans lui, un échec de RPC ressemble à une liste vide (« Aucune mission »),
 * ce qui trompe l'utilisateur. Partagé par tous les écrans du cercle.
 */

import React from 'react';
import { ErrorState } from '@/components/layout/ErrorState';

interface ErrorBoxProps {
  /** Phrase qui dit ce qui n'a pas pu être chargé. */
  title: string;
  /** Message renvoyé par le serveur (déjà traduit), affiché en second plan. */
  detail?: string | null;
  onRetry?: () => void;
}

const sameSentence = (a: string, b: string) =>
  a.trim().replace(/[.\s]+$/, '').toLowerCase() === b.trim().replace(/[.\s]+$/, '').toLowerCase();

export const ErrorBox: React.FC<ErrorBoxProps> = ({ title, detail, onRetry }) => {
  // Le message de repli des hooks reprend souvent le titre mot pour mot : on dit
  // alors quoi faire plutôt que de répéter ce qui a échoué.
  const description = !detail ? undefined : sameSentence(detail, title) ? 'Vérifiez votre connexion, puis réessayez.' : detail;
  return <ErrorState variant="compact" title={title} description={description} onRetry={onRetry} />;
};

export default ErrorBox;
