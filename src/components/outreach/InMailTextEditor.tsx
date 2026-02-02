import React, { useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { 
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { 
  WrapText, 
  Smile, 
  List,
  ListOrdered,
  Info,
  Bold,
  Italic,
  Link,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface InMailTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: string;
  maxHeight?: string;
  showWordCount?: boolean;
  maxCharacters?: number;
  id?: string;
  onSend?: () => void;
  autoResize?: boolean;
}

// Common emojis for professional LinkedIn messages
const EMOJI_GROUPS = [
  {
    label: 'Professionnels',
    emojis: ['👋', '🤝', '💼', '📈', '🎯', '💡', '✨', '🚀', '⭐', '🏆']
  },
  {
    label: 'Communication',
    emojis: ['📩', '📞', '💬', '📋', '📌', '✅', '👍', '🙌', '💪', '🔥']
  },
  {
    label: 'Tech',
    emojis: ['💻', '🖥️', '⚙️', '🔧', '📱', '🌐', '☁️', '🔒', '📊', '🗂️']
  },
];

export const InMailTextEditor: React.FC<InMailTextEditorProps> = ({
  value,
  onChange,
  placeholder = 'Rédigez votre message...',
  className,
  minHeight = '200px',
  maxHeight = '400px',
  showWordCount = true,
  maxCharacters = 1900,
  id,
  onSend,
  autoResize = true,
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const isInternalChange = useRef(false);

  // Sync external value changes to the editor
  useEffect(() => {
    if (editorRef.current && !isInternalChange.current) {
      if (editorRef.current.innerHTML !== value) {
        editorRef.current.innerHTML = value;
      }
    }
    isInternalChange.current = false;
  }, [value]);

  // Handle content changes
  const handleInput = useCallback(() => {
    if (editorRef.current) {
      isInternalChange.current = true;
      onChange(editorRef.current.innerHTML);
    }
  }, [onChange]);

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    // Ctrl+Enter or Cmd+Enter to send
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && onSend) {
      e.preventDefault();
      onSend();
      return;
    }

    // Ctrl+B for bold
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault();
      formatText('bold');
      return;
    }

    // Ctrl+I for italic
    if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
      e.preventDefault();
      formatText('italic');
      return;
    }
  }, [onSend]);

  // Apply formatting
  const formatText = useCallback((command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    handleInput();
  }, [handleInput]);

  // Insert HTML at cursor
  const insertHTML = useCallback((html: string) => {
    editorRef.current?.focus();
    document.execCommand('insertHTML', false, html);
    handleInput();
  }, [handleInput]);

  // Insert link
  const insertLink = useCallback(() => {
    const selection = window.getSelection();
    const selectedText = selection?.toString() || '';
    
    const url = prompt('Entrez l\'URL du lien:', 'https://');
    if (!url) return;

    editorRef.current?.focus();
    
    if (selectedText) {
      document.execCommand('createLink', false, url);
    } else {
      const linkText = prompt('Texte du lien:', 'Cliquez ici') || 'Cliquez ici';
      document.execCommand('insertHTML', false, `<a href="${url}">${linkText}</a>`);
    }
    handleInput();
  }, [handleInput]);

  // Insert emoji
  const insertEmoji = useCallback((emoji: string) => {
    editorRef.current?.focus();
    document.execCommand('insertText', false, emoji);
    handleInput();
  }, [handleInput]);

  // Get plain text for counting
  const getPlainText = (html: string) => {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent || div.innerText || '';
  };

  const plainText = getPlainText(value);
  const wordCount = plainText.split(/\s+/).filter(Boolean).length;
  const charCount = plainText.length;
  const isOverLimit = maxCharacters && charCount > maxCharacters;

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex items-center gap-1 p-1 bg-muted/50 rounded-lg border border-border/50">
        <TooltipProvider delayDuration={200}>
          {/* Formatting buttons */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => formatText('bold')}
              >
                <Bold className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Gras (Ctrl+B)</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => formatText('italic')}
              >
                <Italic className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Italique (Ctrl+I)</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={insertLink}
              >
                <Link className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Insérer un lien</p>
            </TooltipContent>
          </Tooltip>

          <div className="w-px h-6 bg-border mx-1" />

          {/* Lists */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => formatText('insertUnorderedList')}
              >
                <List className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Liste à puces</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => formatText('insertOrderedList')}
              >
                <ListOrdered className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Liste numérotée</p>
            </TooltipContent>
          </Tooltip>

          <div className="w-px h-6 bg-border mx-1" />

          {/* Emoji picker */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
              >
                <Smile className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-2" align="start">
              <div className="space-y-3">
                {EMOJI_GROUPS.map((group) => (
                  <div key={group.label}>
                    <p className="text-xs font-medium text-muted-foreground mb-1.5">
                      {group.label}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {group.emojis.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          className="w-8 h-8 text-lg hover:bg-muted rounded transition-colors flex items-center justify-center"
                          onClick={() => insertEmoji(emoji)}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {/* Info */}
          <div className="ml-auto flex items-center">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-muted-foreground"
                >
                  <Info className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[280px]">
                <p className="text-xs">
                  Éditeur WYSIWYG pour LinkedIn Recruiter. 
                  Le formatage (gras, italique, liens, listes) sera conservé dans le message envoyé.
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>

      {/* Editable content area */}
      <div
        ref={editorRef}
        id={id}
        contentEditable
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        data-placeholder={placeholder}
        className={cn(
          "w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
          "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "font-sans leading-relaxed overflow-y-auto",
          "empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground empty:before:pointer-events-none",
          "[&_a]:text-primary [&_a]:underline",
          "[&_strong]:font-bold [&_b]:font-bold",
          "[&_em]:italic [&_i]:italic",
          "[&_ul]:list-disc [&_ul]:ml-4 [&_ol]:list-decimal [&_ol]:ml-4",
          isOverLimit && "border-red-500 focus-visible:ring-red-500",
          className
        )}
        style={{ 
          minHeight,
          maxHeight,
        }}
      />

      {/* Footer with counts */}
      {showWordCount && (
        <div className="flex justify-between items-center text-xs text-muted-foreground">
          <span>{wordCount} mots</span>
          <span className={cn(isOverLimit && "text-red-500 font-medium")}>
            {charCount}{maxCharacters ? ` / ${maxCharacters}` : ''} caractères
            {isOverLimit && " (limite dépassée)"}
          </span>
        </div>
      )}
    </div>
  );
};
