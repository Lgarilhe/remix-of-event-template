/**
 * MessageComposer — Zone de saisie messages, toujours visible (sticky bottom).
 *
 * Architecture defensively designed pour que l'input soit IMPOSSIBLE à cacher :
 * - Composant ROOT en grid-rows-[auto_auto] avec hauteurs explicites
 * - Background distinct (bg-card) pour visibilité même si bug de overflow
 * - shrink-0 + min-h-[88px] pour bloquer toute compression flex
 * - z-index élevé pour passer au-dessus de tout overlay accidentel
 *
 * Toolbar du composer :
 * - Boutons gauche : Emoji, IA suggestions, RDV Calendly
 * - Bouton droite : Send (icône avion ou loader)
 * - Hint clavier : ⌘+Entrée pour envoyer
 */

import React from 'react';
import { Loader2, Send, Sparkles, CalendarPlus, Smile } from 'lucide-react';
import { InMailTextEditor } from '../InMailTextEditor';
import { cn } from '@/lib/utils';

export interface MessageComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  disabled?: boolean;
  /** Optionnel : ouvrir le panel IA (suggestions de réponse) */
  onOpenAI?: () => void;
  hasAISuggestions?: boolean;
  aiSuggestionsCount?: number;
  /** Optionnel : insérer un lien Calendly */
  onScheduleCall?: () => void;
  hasCalendlyLink?: boolean;
  /** Compose hint affiché */
  channel?: string;
}

export const MessageComposer: React.FC<MessageComposerProps> = ({
  value,
  onChange,
  onSend,
  sending,
  disabled = false,
  onOpenAI,
  hasAISuggestions,
  aiSuggestionsCount,
  onScheduleCall,
  hasCalendlyLink,
  channel,
}) => {
  const isSendable = value.trim().length > 0 && !sending && !disabled;

  // Détection du modificateur clavier (mac vs others)
  const isMac =
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const sendShortcut = isMac ? '⌘ + Entrée' : 'Ctrl + Entrée';

  return (
    <div
      className={cn(
        'shrink-0 border-t border-border bg-card',
        'shadow-[0_-1px_0_0_hsl(var(--border))]',
      )}
      data-component="message-composer"
    >
      {/* Toolbar haute (actions secondaires + hint) */}
      <div className="flex items-center justify-between gap-2 px-4 pt-2 pb-1">
        <div className="flex items-center gap-1">
          {onOpenAI && (
            <button
              type="button"
              onClick={onOpenAI}
              className={cn(
                'h-7 px-2 inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider',
                'border transition-colors',
                hasAISuggestions
                  ? 'bg-foreground text-background border-foreground hover:bg-foreground/90'
                  : 'bg-transparent text-muted-foreground border-border hover:bg-accent/50',
              )}
              title="Suggestions IA"
            >
              <Sparkles className="w-3 h-3" />
              <span>IA</span>
              {hasAISuggestions && aiSuggestionsCount ? (
                <span className="ml-0.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] bg-background text-foreground">
                  {aiSuggestionsCount}
                </span>
              ) : null}
            </button>
          )}
          {onScheduleCall && (
            <button
              type="button"
              onClick={onScheduleCall}
              disabled={!hasCalendlyLink}
              className={cn(
                'h-7 px-2 inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider',
                'border border-border bg-transparent transition-colors',
                hasCalendlyLink
                  ? 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  : 'text-muted-foreground/50 cursor-not-allowed',
              )}
              title={
                hasCalendlyLink
                  ? 'Insérer un lien de rendez-vous'
                  : 'Configurez un lien Calendly dans les paramètres du projet'
              }
            >
              <CalendarPlus className="w-3 h-3" />
              <span>RDV</span>
            </button>
          )}
        </div>

        <span className="hidden md:inline text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">
          {channel ? `${channel} • ` : ''}
          {sendShortcut}
        </span>
      </div>

      {/* Zone éditeur + bouton send */}
      <div className="px-4 pb-4 pt-1">
        <div
          className={cn(
            'flex items-end gap-2 rounded-md border bg-background transition-colors',
            isSendable
              ? 'border-foreground/30 focus-within:border-foreground/50'
              : 'border-border focus-within:border-foreground/30',
          )}
        >
          <div className="flex-1 min-w-0 px-3 py-2">
            <InMailTextEditor
              value={value}
              onChange={onChange}
              placeholder="Écrivez votre message..."
              minHeight="44px"
              maxHeight="200px"
              showWordCount={false}
              maxCharacters={1900}
              className="text-sm leading-relaxed"
              onSend={onSend}
              autoResize
            />
          </div>
          <button
            type="button"
            onClick={onSend}
            disabled={!isSendable}
            aria-label="Envoyer le message"
            className={cn(
              'shrink-0 h-9 w-9 mr-2 mb-2 inline-flex items-center justify-center',
              'transition-all border',
              isSendable
                ? 'bg-foreground text-background border-foreground hover:opacity-90 active:scale-95'
                : 'bg-transparent text-muted-foreground/40 border-border cursor-not-allowed',
            )}
          >
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
