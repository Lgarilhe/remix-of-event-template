/**
 * SmartReplies — Boutons de suggestions rapides au-dessus du composer.
 *
 * Inspiré de Gmail Smart Reply / Superhuman / Linear :
 *  - Auto-affichage quand des suggestions IA sont disponibles
 *  - Click sur une suggestion = insert dans le composer (pas envoi auto)
 *  - 3 suggestions max (les plus pertinentes)
 *  - Bouton "Voir plus" → ouvre l'AI panel complet
 *
 * Source : `replySuggestions` du `useMessagesInbox` (déjà en place).
 */

import React from 'react';
import { Sparkles, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SmartRepliesProps {
  suggestions: Array<{ text: string; type?: string }>;
  onPick: (text: string) => void;
  onSeeMore?: () => void;
  loading?: boolean;
  className?: string;
}

export const SmartReplies: React.FC<SmartRepliesProps> = ({
  suggestions,
  onPick,
  onSeeMore,
  loading = false,
  className,
}) => {
  // Affiche max 3 suggestions
  const visible = suggestions.slice(0, 3);

  if (loading) {
    return (
      <div className={cn('flex items-center gap-2 px-4 py-2', className)} data-component="smart-replies">
        <Sparkles className="w-3 h-3 text-muted-foreground animate-pulse shrink-0" />
        <div className="flex gap-1.5 flex-1">
          {[60, 80, 50].map((w, i) => (
            <div
              key={i}
              className="h-7 bg-muted/50 animate-pulse rounded-full"
              style={{ width: `${w}px`, animationDelay: `${i * 80}ms` }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (visible.length === 0) return null;

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 px-4 py-2 border-t border-border bg-muted/20',
        'overflow-x-auto scrollbar-thin',
        className,
      )}
      data-component="smart-replies"
    >
      <Sparkles className="w-3 h-3 text-muted-foreground shrink-0" aria-hidden="true" />
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium shrink-0 mr-1">
        Suggestions
      </span>
      <div className="flex items-center gap-1.5">
        {visible.map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onPick(s.text)}
            className={cn(
              'shrink-0 h-7 px-3 inline-flex items-center text-[12px] font-medium',
              'rounded-full border border-border bg-background',
              'hover:bg-foreground hover:text-background hover:border-foreground',
              'transition-colors active:scale-95',
            )}
            title={s.text}
          >
            <span className="truncate max-w-[180px]">
              {s.text.length > 50 ? s.text.slice(0, 47) + '…' : s.text}
            </span>
          </button>
        ))}
        {onSeeMore && suggestions.length > 3 && (
          <button
            type="button"
            onClick={onSeeMore}
            className="shrink-0 h-7 px-2 inline-flex items-center gap-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground rounded-full transition-colors"
          >
            <span>Plus</span>
            <ChevronRight className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
};
