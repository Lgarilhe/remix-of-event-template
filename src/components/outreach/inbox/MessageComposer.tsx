/**
 * MessageComposer — Zone de saisie moderne, inspirée Linear / Slack / Front.
 *
 * Design choices :
 *  - Card élevée avec border subtile + ring focus à l'état actif
 *  - Textarea autosize, padding généreux, typographie soignée
 *  - Boutons d'action avec icônes lucide cohérentes, hover states fluides
 *  - Bouton send avec micro-animation (active:scale-95) + gradient subtil
 *  - Hint clavier discret en uppercase tracking-wider
 */

import React, { useRef, useEffect, useState } from 'react';
import { Loader2, Send, Sparkles, CalendarPlus, Smile } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const QUICK_EMOJIS = ['👋', '🤝', '💼', '🚀', '⭐', '🙏', '😊', '👍', '🔥', '💡', '✨', '🎯', '📌', '✅', '💬'];

export interface MessageComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  disabled?: boolean;
  onOpenAI?: () => void;
  hasAISuggestions?: boolean;
  aiSuggestionsCount?: number;
  onScheduleCall?: () => void;
  hasCalendlyLink?: boolean;
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);
  const isSendable = value.trim().length > 0 && !sending && !disabled;

  const isMac =
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const sendShortcut = isMac ? '⌘' : 'Ctrl';

  // Auto-resize du textarea selon contenu
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = '0px';
    const newHeight = Math.min(ta.scrollHeight, 160);
    ta.style.height = `${Math.max(newHeight, 24)}px`;
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (isSendable) onSend();
    }
  };

  const insertEmoji = (emoji: string) => {
    const ta = textareaRef.current;
    if (!ta) {
      onChange(value + emoji);
      return;
    }
    const start = ta.selectionStart ?? value.length;
    const end = ta.selectionEnd ?? value.length;
    const newValue = value.slice(0, start) + emoji + value.slice(end);
    onChange(newValue);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + emoji.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="border-t border-border bg-background px-4 py-3" data-component="message-composer">
      {/* Composer card avec ring focus */}
      <div
        className={cn(
          'rounded-xl border bg-card transition-all duration-150',
          focused
            ? 'border-foreground/20 ring-2 ring-foreground/10 shadow-sm'
            : 'border-border hover:border-foreground/15',
        )}
      >
        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Écrivez votre message..."
          disabled={disabled}
          rows={1}
          className={cn(
            'w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50',
            'resize-none border-0 outline-none focus:ring-0 focus:outline-none',
            'leading-relaxed px-4 pt-3 pb-1',
          )}
          style={{ minHeight: '24px', maxHeight: '160px' }}
        />

        {/* Action row */}
        <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-1">
          {/* Actions gauche */}
          <div className="flex items-center gap-0.5">
            {onOpenAI && (
              <button
                type="button"
                onClick={onOpenAI}
                className={cn(
                  'h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs font-medium transition-all',
                  hasAISuggestions
                    ? 'bg-foreground text-background hover:opacity-90 active:scale-95'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
                title="Suggestions IA"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>IA</span>
                {hasAISuggestions && aiSuggestionsCount ? (
                  <span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-semibold bg-background text-foreground rounded-full">
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
                  'h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs font-medium transition-colors',
                  hasCalendlyLink
                    ? 'text-muted-foreground hover:bg-accent hover:text-foreground'
                    : 'text-muted-foreground/40 cursor-not-allowed',
                )}
                title={hasCalendlyLink ? 'Insérer un lien de RDV' : 'Configurez un Calendly dans le projet'}
              >
                <CalendarPlus className="w-3.5 h-3.5" />
                <span>RDV</span>
              </button>
            )}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  aria-label="Insérer un emoji"
                >
                  <Smile className="w-4 h-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-2" side="top" align="start">
                <div className="grid grid-cols-5 gap-1">
                  {QUICK_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => insertEmoji(emoji)}
                      className="h-9 w-9 inline-flex items-center justify-center text-lg rounded-md hover:bg-accent transition-colors"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {/* Actions droite */}
          <div className="flex items-center gap-2.5">
            <kbd className="hidden md:inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">
              {channel ? <span>{channel} ·</span> : null}
              <span className="px-1 py-0.5 rounded border border-border/60">{sendShortcut}+↵</span>
            </kbd>
            <button
              type="button"
              onClick={onSend}
              disabled={!isSendable}
              aria-label="Envoyer le message"
              className={cn(
                'h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-xs font-medium transition-all',
                isSendable
                  ? 'bg-foreground text-background hover:opacity-90 active:scale-95 shadow-sm'
                  : 'bg-muted text-muted-foreground/40 cursor-not-allowed',
              )}
            >
              {sending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Envoi...</span>
                </>
              ) : (
                <>
                  <span>Envoyer</span>
                  <Send className="w-3 h-3" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
