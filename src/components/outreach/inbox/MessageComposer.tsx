/**
 * MessageComposer — Zone de saisie moderne avec mise en page + IA.
 *
 * Design inspiré de Linear / Slack / Notion :
 * - Card élevée avec ring focus animé
 * - Toolbar de formatage discrète au-dessus du textarea (Bold, Italic,
 *   List, Link, Emoji)
 * - Bouton IA prominent + RDV + send avec hint clavier
 * - Raccourcis : Ctrl+B (bold), Ctrl+I (italic), Ctrl+K (link),
 *   ⌘+Entrée / Ctrl+Entrée (send)
 *
 * Le formatage utilise des caractères Unicode Bold/Italic compatibles
 * LinkedIn (cf textFormat.ts).
 */

import React, { useRef, useEffect, useState } from 'react';
import {
  Loader2, Send, Sparkles, CalendarPlus, Smile,
  Bold, Italic, List, ListOrdered, Link as LinkIcon,
  FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import { toggleBold, toggleItalic, toBulletList, toNumberedList, insertLink } from './textFormat';
import { TemplatesPicker } from './TemplatesPicker';
import { useMessageTemplates, MessageTemplate } from '@/hooks/useMessageTemplates';

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

  // Slash commands : si l'user tape "/" en début de ligne, on ouvre le picker
  // de templates. Le query est ce qui suit le "/" jusqu'au prochain espace.
  const { markUsed } = useMessageTemplates();
  const [slashQuery, setSlashQuery] = useState<string | null>(null);

  /** Détecte un slash command actif dans la valeur courante.
      Retourne la query (sans /) ou null si pas de slash actif. */
  const detectSlashCommand = (val: string, cursor: number): string | null => {
    // On regarde le segment juste avant le curseur pour voir si on est
    // dans un slash command non-terminé.
    const before = val.slice(0, cursor);
    // Match "/xxx" en fin (sans espace)
    const match = before.match(/(^|\s)\/(\S*)$/);
    if (match) return match[2]; // segment après le "/"
    return null;
  };

  const handleTextChange = (newValue: string) => {
    onChange(newValue);
    const ta = textareaRef.current;
    if (ta) {
      const cursor = ta.selectionStart ?? newValue.length;
      const slash = detectSlashCommand(newValue, cursor);
      setSlashQuery(slash);
    }
  };

  /** Insère un template à la place du slash command */
  const insertTemplate = (template: MessageTemplate) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const cursor = ta.selectionStart ?? value.length;
    const before = value.slice(0, cursor);
    const after = value.slice(cursor);
    // Remplace le "/xxx" par le content du template
    const replaced = before.replace(/(^|\s)\/(\S*)$/, '$1' + template.content);
    const newValue = replaced + after;
    onChange(newValue);
    setSlashQuery(null);
    markUsed(template.id);
    requestAnimationFrame(() => {
      ta.focus();
      const newPos = replaced.length;
      ta.setSelectionRange(newPos, newPos);
    });
  };

  const isMac =
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const cmd = isMac ? '⌘' : 'Ctrl';

  // Auto-resize du textarea selon contenu
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = '0px';
    const newHeight = Math.min(ta.scrollHeight, 160);
    ta.style.height = `${Math.max(newHeight, 24)}px`;
  }, [value]);

  // ─── Helpers de formatage qui transforment la sélection ─────────────
  const applyToSelection = (transform: (selected: string) => string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const before = value.slice(0, start);
    const selected = value.slice(start, end);
    const after = value.slice(end);
    const transformed = transform(selected);
    const newValue = before + transformed + after;
    onChange(newValue);
    requestAnimationFrame(() => {
      ta.focus();
      const newEnd = start + transformed.length;
      ta.setSelectionRange(start, newEnd);
    });
  };

  const handleBold = () => applyToSelection(toggleBold);
  const handleItalic = () => applyToSelection(toggleItalic);
  const handleBulletList = () => applyToSelection(toBulletList);
  const handleNumberedList = () => applyToSelection(toNumberedList);
  const handleLink = () => {
    const url = window.prompt('URL du lien :', 'https://');
    if (!url || url === 'https://') return;
    applyToSelection((selected) => insertLink(selected, url));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // ⌘+Entrée / Ctrl+Entrée → envoyer
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (isSendable) onSend();
      return;
    }
    // ⌘+B / Ctrl+B → bold
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      handleBold();
      return;
    }
    // ⌘+I / Ctrl+I → italic
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      handleItalic();
      return;
    }
    // ⌘+K / Ctrl+K → link
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      handleLink();
      return;
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
    <TooltipProvider delayDuration={400}>
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
          {/* Toolbar formatage (haut de la card) */}
          <div className="flex items-center gap-0.5 px-2 pt-2 pb-1 border-b border-border/50">
            <FormatButton
              icon={<Bold className="w-3.5 h-3.5" />}
              tooltip={`Gras (${cmd}+B)`}
              onClick={handleBold}
            />
            <FormatButton
              icon={<Italic className="w-3.5 h-3.5" />}
              tooltip={`Italique (${cmd}+I)`}
              onClick={handleItalic}
            />
            <FormatButton
              icon={<LinkIcon className="w-3.5 h-3.5" />}
              tooltip={`Lien (${cmd}+K)`}
              onClick={handleLink}
            />
            <div className="w-px h-4 bg-border mx-1" aria-hidden="true" />
            <FormatButton
              icon={<List className="w-3.5 h-3.5" />}
              tooltip="Liste à puces"
              onClick={handleBulletList}
            />
            <FormatButton
              icon={<ListOrdered className="w-3.5 h-3.5" />}
              tooltip="Liste numérotée"
              onClick={handleNumberedList}
            />
            <div className="w-px h-4 bg-border mx-1" aria-hidden="true" />
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  aria-label="Insérer un emoji"
                >
                  <Smile className="w-3.5 h-3.5" />
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

            <div className="flex-1" />

            <span className="text-[10px] text-muted-foreground/50 font-medium px-1 hidden lg:inline">
              {value.length > 0 ? `${value.length} car.` : ''}
            </span>
          </div>

          {/* Textarea */}
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => handleTextChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => setFocused(true)}
              onBlur={() => {
                setFocused(false);
                // Délai pour permettre le click sur picker avant de fermer
                setTimeout(() => setSlashQuery(null), 200);
              }}
              placeholder='Écrivez votre message... (tapez "/" pour insérer un template)'
              disabled={disabled}
              rows={1}
              className={cn(
                'w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50',
                'resize-none border-0 outline-none focus:ring-0 focus:outline-none',
                'leading-relaxed px-4 py-2.5',
              )}
              style={{ minHeight: '24px', maxHeight: '160px' }}
            />
            {/* Slash command templates picker */}
            {slashQuery !== null && (
              <TemplatesPicker
                query={slashQuery}
                onSelect={insertTemplate}
                onClose={() => setSlashQuery(null)}
                onCreateNew={() => {
                  setSlashQuery(null);
                  // Ouvre les Settings → onglet Templates dans un nouvel onglet
                  window.open('/settings?tab=templates', '_blank');
                }}
              />
            )}
          </div>

          {/* Action row (bas de la card) */}
          <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-1 border-t border-border/50">
            {/* Actions gauche */}
            <div className="flex items-center gap-0.5">
              {onOpenAI && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={onOpenAI}
                      className={cn(
                        'h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs font-medium transition-all',
                        hasAISuggestions
                          ? 'bg-foreground text-background hover:opacity-90 active:scale-95 shadow-sm'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                      )}
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>IA</span>
                      {hasAISuggestions && aiSuggestionsCount ? (
                        <span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-semibold bg-background text-foreground rounded-full">
                          {aiSuggestionsCount}
                        </span>
                      ) : null}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Suggestions IA contextuelles</TooltipContent>
                </Tooltip>
              )}
              {onScheduleCall && (
                <Tooltip>
                  <TooltipTrigger asChild>
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
                    >
                      <CalendarPlus className="w-3.5 h-3.5" />
                      <span>RDV</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {hasCalendlyLink ? 'Insérer un lien de rendez-vous' : 'Configurez un Calendly dans le projet'}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>

            {/* Actions droite */}
            <div className="flex items-center gap-2.5">
              <kbd className="hidden md:inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">
                {channel ? <span>{channel} ·</span> : null}
                <span className="px-1 py-0.5 rounded border border-border/60">{cmd}+↵</span>
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
    </TooltipProvider>
  );
};

// ─── Sub-component : bouton de formatage ─────────────────────────────

interface FormatButtonProps {
  icon: React.ReactNode;
  tooltip: string;
  onClick: () => void;
}

const FormatButton: React.FC<FormatButtonProps> = ({ icon, tooltip, onClick }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        type="button"
        onClick={onClick}
        className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
      >
        {icon}
      </button>
    </TooltipTrigger>
    <TooltipContent side="top">{tooltip}</TooltipContent>
  </Tooltip>
);
