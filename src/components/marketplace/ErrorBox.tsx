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

export const ErrorBox: React.FC<ErrorBoxProps> = ({ title, detail, onRetry }) => (
  <ErrorState variant="compact" title={title} description={detail ?? undefined} onRetry={onRetry} />
);

export default ErrorBox;
