/**
 * ErrorBox : bloc affiché quand une lecture de la marketplace échoue.
 * Sans lui, un échec de RPC ressemble à une liste vide (« Aucune mission »),
 * ce qui trompe l'utilisateur. Partagé par tous les écrans du cercle.
 */

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ErrorBoxProps {
  /** Phrase qui dit ce qui n'a pas pu être chargé. */
  title: string;
  /** Message renvoyé par le serveur, affiché en second plan. */
  detail?: string | null;
  onRetry?: () => void;
}

export const ErrorBox: React.FC<ErrorBoxProps> = ({ title, detail, onRetry }) => (
  <div className="border border-destructive/30 bg-destructive/5 p-6 space-y-3">
    <div className="flex items-start gap-3">
      <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
      <div>
        <p className="text-sm text-foreground">{title}</p>
        {detail ? <p className="text-xs text-muted-foreground mt-1">{detail}</p> : null}
      </div>
    </div>
    {onRetry ? (
      <Button size="sm" variant="outline" className="rounded-full" onClick={onRetry}>
        Réessayer
      </Button>
    ) : null}
  </div>
);

export default ErrorBox;
