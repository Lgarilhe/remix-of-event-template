import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Square, AtSign, Search, Loader2 } from 'lucide-react';
import { useThreadRuntime } from '@assistant-ui/react';
import { cn } from '@/lib/utils';
import {
  useMentionSearch,
  MENTION_TYPES,
  type MentionEntity,
  type MentionType,
} from '@/hooks/useMentionSearch';

export interface MentionRef {
  id: string;
  type: MentionType;
  label: string;
}

/** Shared state: active mentions for the current message */
let activeMentions: MentionRef[] = [];
function setActiveMentions(next: MentionRef[]) {
  activeMentions = next;
}
export function getActiveMentions(): MentionRef[] {
  return activeMentions;
}
export function clearActiveMentions() {
  activeMentions = [];
}

export function MentionComposer() {
  const threadRuntime = useThreadRuntime();

  const [text, setText] = useState('');
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [selectedType, setSelectedType] = useState<MentionType | undefined>(undefined);
  const [mentions, setMentions] = useState<MentionRef[]>([]);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const mentionStartRef = useRef<number>(-1);

  const { results, loading, search, clear } = useMentionSearch();

  // Auto-resize textarea
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = '24px';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, [text]);

  // Search when query changes
  useEffect(() => {
    if (showMentionMenu && mentionQuery.length >= 1) {
      search(mentionQuery, selectedType);
    } else if (showMentionMenu && mentionQuery.length === 0) {
      clear();
    }
  }, [mentionQuery, selectedType, showMentionMenu, search, clear]);

  const closeMentionMenu = useCallback(() => {
    setShowMentionMenu(false);
    setMentionQuery('');
    setSelectedType(undefined);
    setHighlightIndex(0);
    clear();
    mentionStartRef.current = -1;
  }, [clear]);

  const insertMention = useCallback(
    (entity: MentionEntity) => {
      const start = mentionStartRef.current;
      if (start < 0) return;

      const mentionText = `@${entity.label}`;
      const before = text.slice(0, start);
      const after = text.slice(start + mentionQuery.length + 1); // +1 for @
      const newText = before + mentionText + ' ' + after;

      setText(newText);
      setMentions((prev) => {
        const next = [
          ...prev,
          { id: entity.id, type: entity.type, label: entity.label },
        ];
        setActiveMentions(next);
        return next;
      });
      closeMentionMenu();

      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) {
          el.focus();
          const pos = before.length + mentionText.length + 1;
          el.setSelectionRange(pos, pos);
        }
      });
    },
    [text, mentionQuery, closeMentionMenu],
  );

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const val = e.target.value;
      setText(val);

      const cursor = e.target.selectionStart || 0;
      const textBeforeCursor = val.slice(0, cursor);
      const atMatch = textBeforeCursor.match(/@(\S*)$/);

      if (atMatch) {
        mentionStartRef.current = cursor - atMatch[0].length;
        setMentionQuery(atMatch[1]);
        setShowMentionMenu(true);
        setHighlightIndex(0);
      } else if (showMentionMenu) {
        closeMentionMenu();
      }
    },
    [showMentionMenu, closeMentionMenu],
  );

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Snapshot mentions before clearing UI state so the adapter can read them
    setActiveMentions([...mentions]);

    // Use thread runtime's composer to send
    threadRuntime.composer.setText(trimmed);
    threadRuntime.composer.send();
    setText('');
    setMentions([]);
  }, [mentions, text, threadRuntime]);

  const handleCancel = useCallback(() => {
    threadRuntime.cancelRun();
  }, [threadRuntime]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (showMentionMenu && results.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setHighlightIndex((i) => (i + 1) % results.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setHighlightIndex((i) => (i - 1 + results.length) % results.length);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          insertMention(results[highlightIndex]);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          closeMentionMenu();
          return;
        }
      }

      if (e.key === 'Enter' && !e.shiftKey && !showMentionMenu) {
        e.preventDefault();
        handleSend();
      }
    },
    [showMentionMenu, results, highlightIndex, insertMention, closeMentionMenu, handleSend],
  );

  const typeEmoji: Record<MentionType, string> = {
    mission: '🎯',
    candidat: '👤',
    shortlist: '📋',
  };

  return (
    <div className="relative">
      {/* Mention chips */}
      {mentions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pb-2">
          {mentions.map((m, i) => (
            <span
              key={`${m.id}-${i}`}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary border border-primary/20 rounded-md"
            >
              <span>{typeEmoji[m.type]}</span>
              {m.label}
              <button
                type="button"
                onClick={() =>
                  setMentions((prev) => {
                    const next = prev.filter((_, j) => j !== i);
                    setActiveMentions(next);
                    return next;
                  })
                }
                className="ml-0.5 text-primary/50 hover:text-primary"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Mention dropdown */}
      {showMentionMenu && (
        <div
          ref={menuRef}
          className="absolute bottom-full left-0 right-0 mb-1 bg-popover border border-border rounded-xl shadow-lg z-50 overflow-hidden animate-fade-in"
        >
          {/* Type filter tabs */}
          <div className="flex border-b border-border/50 px-2 py-1.5 gap-1">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setSelectedType(undefined); setHighlightIndex(0); }}
              className={cn(
                'px-2 py-1 text-[11px] font-medium rounded-md transition-colors',
                !selectedType
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted/50',
              )}
            >
              Tous
            </button>
            {MENTION_TYPES.map((t) => (
              <button
                type="button"
                key={t.type}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { setSelectedType(t.type); setHighlightIndex(0); }}
                className={cn(
                  'px-2 py-1 text-[11px] font-medium rounded-md transition-colors',
                  selectedType === t.type
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted/50',
                )}
              >
                {t.emoji} {t.label}
              </button>
            ))}
          </div>

          {/* Search hint */}
          {mentionQuery.length === 0 && results.length === 0 && !loading && (
            <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
              <Search className="w-3.5 h-3.5" />
              Tapez un nom pour rechercher…
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Recherche…
            </div>
          )}

          {/* Results */}
          {!loading && results.length > 0 && (
            <div className="max-h-[200px] overflow-y-auto py-1">
              {results.map((entity, i) => (
                <button
                  type="button"
                  key={`${entity.type}-${entity.id}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertMention(entity);
                  }}
                  onMouseEnter={() => setHighlightIndex(i)}
                  className={cn(
                    'w-full text-left px-3 py-2 flex items-center gap-2.5 transition-colors',
                    i === highlightIndex ? 'bg-primary/5' : 'hover:bg-muted/50',
                  )}
                >
                  <span className="text-sm shrink-0">{typeEmoji[entity.type]}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">
                      {entity.label}
                    </p>
                    {entity.subtitle && (
                      <p className="text-[11px] text-muted-foreground truncate">
                        {entity.subtitle}
                      </p>
                    )}
                  </div>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 shrink-0">
                    {entity.type}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* No results */}
          {!loading && mentionQuery.length >= 1 && results.length === 0 && (
            <div className="px-3 py-3 text-xs text-muted-foreground">
              Aucun résultat pour « {mentionQuery} »
            </div>
          )}
        </div>
      )}

      {/* Composer */}
      <div className="relative flex items-end gap-2 border border-border/50 focus-within:border-primary/30 focus-within:ring-1 focus-within:ring-primary/10 transition-all duration-200 px-4 py-3 bg-muted/5 rounded-2xl">
        {/* @ button */}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (showMentionMenu) {
              closeMentionMenu();
            } else {
              const el = inputRef.current;
              if (el) {
                const pos = el.selectionStart || text.length;
                const before = text.slice(0, pos);
                const after = text.slice(pos);
                const needsSpace = before.length > 0 && !before.endsWith(' ') && !before.endsWith('\n');
                const newText = before + (needsSpace ? ' @' : '@') + after;
                setText(newText);
                mentionStartRef.current = pos + (needsSpace ? 1 : 0);
                setMentionQuery('');
                setShowMentionMenu(true);
                requestAnimationFrame(() => {
                  el.focus();
                  const newPos = mentionStartRef.current + 1;
                  el.setSelectionRange(newPos, newPos);
                });
              }
            }
          }}
          className={cn(
            'h-8 w-8 flex items-center justify-center shrink-0 rounded-xl transition-all duration-150',
            showMentionMenu
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
          )}
          title="Mentionner (@candidat, @mission, @shortlist)"
        >
          <AtSign className="h-4 w-4" />
        </button>

        <textarea
          ref={inputRef}
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Posez une question… (@ pour contextualiser)"
          className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none min-h-[24px] max-h-[160px] leading-relaxed"
          rows={1}
          autoFocus
        />

        <button
          type="button"
          onClick={handleSend}
          disabled={!text.trim()}
          className="h-8 w-8 flex items-center justify-center bg-foreground text-background hover:bg-foreground/90 shrink-0 transition-all duration-150 active:scale-90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed rounded-xl"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={handleCancel}
          className="h-8 w-8 flex items-center justify-center bg-destructive/10 text-destructive hover:bg-destructive/20 shrink-0 transition-all duration-150 rounded-xl"
        >
          <Square className="h-3 w-3 fill-current" />
        </button>
      </div>
    </div>
  );
}
