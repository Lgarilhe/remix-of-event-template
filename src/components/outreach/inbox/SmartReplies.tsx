/**
 * SmartReplies — suggestions de réponse, au-dessus du composeur.
 *
 * - Affichées quand l'IA a préparé des suggestions pour la conversation.
 * - Un clic insère le texte dans le composeur, où on le relit et le modifie :
 *   rien ne part sans passer par « Envoyer » (revue design D-14).
 * - Trois suggestions au plus ; « Toutes les suggestions » ouvre le panneau IA.
 */

import React from 'react';
import { ChevronRight, Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export interface SmartRepliesProps {
  suggestions: Array<{ text: string; type?: string }>;
  onPick: (text: string) => void;
  onSeeMore?: () => void;
  loading?: boolean;
  className?: string;
}

const shorten = (text: string) => (text.length > 50 ? `${text.slice(0, 47)}…` : text);

export const SmartReplies: React.FC<SmartRepliesProps> = ({
  suggestions,
  onPick,
  onSeeMore,
  loading = false,
  className,
}) => {
  const visible = suggestions.slice(0, 3);

  if (loading) {
    return (
      <div className={cn('flex items-center gap-2 px-4 py-2', className)} data-component="smart-replies" role="status">
        <span className="sr-only">Chargement des suggestions</span>
        {[64, 80, 56].map((w) => (
          <Skeleton key={w} className="h-7 rounded-lg" style={{ width: `${w * 2}px` }} />
        ))}
      </div>
    );
  }

  if (visible.length === 0) return null;

  return (
    <div
      className={cn('flex items-center gap-1.5 overflow-x-auto border-t border-border bg-muted px-3 py-2 md:px-4', className)}
      data-component="smart-replies"
    >
      <span className="inline-flex shrink-0 items-center gap-1 text-2xs font-medium text-muted-foreground">
        <Lightbulb className="h-3 w-3" aria-hidden="true" />
        Suggestions
      </span>
      <ul className="flex items-center gap-1.5" aria-label="Suggestions de réponse">
        {visible.map((s, i) => (
          <li key={i} className="shrink-0">
            <Button
              variant="outline"
              size="xs"
              className="max-w-52 bg-background font-normal"
              onClick={() => onPick(s.text)}
              title={s.text}
              aria-label={`Insérer la suggestion : ${s.text}`}
            >
              <span className="truncate">{shorten(s.text)}</span>
            </Button>
          </li>
        ))}
      </ul>
      {onSeeMore && suggestions.length > 3 && (
        <Button variant="ghost" size="xs" className="shrink-0 text-muted-foreground" onClick={onSeeMore}>
          Toutes les suggestions
          <ChevronRight aria-hidden="true" />
        </Button>
      )}
    </div>
  );
};
