import React, { useRef, useCallback, useEffect, useMemo, useId } from 'react';
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
import { promptDialog } from '@/lib/promptDialog';
import {
  escapeHTML,
  incomingToEditorHTML,
  normalizeEditorHTMLForStorage,
} from './inmailEditor/transforms';

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
  placeholder = 'Rédigez votre message',
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
  const countId = useId();

  const displayHTML = useMemo(() => incomingToEditorHTML(value), [value]);

  // Get plain text for counting
  const getPlainText = (html: string) => {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent || div.innerText || '';
  };

  // Sync external value changes to the editor
  useEffect(() => {
    if (editorRef.current) {
      // Always sync when value is cleared (e.g. after sending)
      const isCleared = !value && editorRef.current.innerHTML !== '';
      if (isCleared || !isInternalChange.current) {
        if (editorRef.current.innerHTML !== displayHTML) {
          editorRef.current.innerHTML = displayHTML;
        }
      }
    }
    isInternalChange.current = false;
  }, [displayHTML, value]);

  // Handle content changes
  const handleInput = useCallback(() => {
    if (editorRef.current) {
      isInternalChange.current = true;
      const current = editorRef.current.innerHTML;
      const normalizedHTML = normalizeEditorHTMLForStorage(current);

      // Make "truly empty" (fix placeholder not showing when browser leaves <br>)
      const plain = getPlainText(normalizedHTML).trim();
      if (!plain) {
        editorRef.current.innerHTML = '';
        onChange('');
        return;
      }

      onChange(normalizedHTML);
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

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    // Preserve line breaks when pasting plain text
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    const safe = escapeHTML(text).replace(/\n/g, '<br>');
    insertHTML(safe);
  }, [insertHTML]);

  // Insert link (with URL validation & XSS protection)
  const insertLink = useCallback(async () => {
    const selection = window.getSelection();
    const selectedText = selection?.toString() || '';
    // Le dialogue prend le focus : on mémorise la sélection de l'éditeur
    // pour la restaurer avant execCommand.
    const savedRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;

    let url = await promptDialog({
      title: 'Insérer un lien',
      description: "Adresse complète, en https://",
      defaultValue: 'https://',
      placeholder: 'https://exemple.com',
    });
    if (!url || url.trim() === 'https://') return;

    // Validate URL protocol to prevent javascript: XSS
    url = url.trim();
    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }

    let linkText = 'Cliquez ici';
    if (!selectedText) {
      linkText = (await promptDialog({ title: 'Texte du lien', defaultValue: 'Cliquez ici' })) || 'Cliquez ici';
    }

    editorRef.current?.focus();
    if (savedRange) {
      const current = window.getSelection();
      current?.removeAllRanges();
      current?.addRange(savedRange);
    }

    if (selectedText) {
      document.execCommand('createLink', false, url);
    } else {
      // Escape link text to prevent HTML injection
      const safeLinkText = escapeHTML(linkText);
      document.execCommand('insertHTML', false, `<a href="${encodeURI(url)}">${safeLinkText}</a>`);
    }
    handleInput();
  }, [handleInput]);

  // Insert emoji
  const insertEmoji = useCallback((emoji: string) => {
    editorRef.current?.focus();
    document.execCommand('insertText', false, emoji);
    handleInput();
  }, [handleInput]);

  const plainText = getPlainText(value);
  const wordCount = plainText.split(/\s+/).filter(Boolean).length;
  const charCount = plainText.length;
  const isOverLimit = maxCharacters && charCount > maxCharacters;

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 rounded-lg border border-border bg-muted p-1" role="group" aria-label="Mise en forme">
        <TooltipProvider delayDuration={200}>
          {/* Formatting buttons */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="max-md:h-11 max-md:w-11"
                onClick={() => formatText('bold')}
                aria-label="Gras"
              >
                <Bold aria-hidden="true" />
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
                size="icon-sm"
                className="max-md:h-11 max-md:w-11"
                onClick={() => formatText('italic')}
                aria-label="Italique"
              >
                <Italic aria-hidden="true" />
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
                size="icon-sm"
                className="max-md:h-11 max-md:w-11"
                onClick={insertLink}
                aria-label="Insérer un lien"
              >
                <Link aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Insérer un lien</p>
            </TooltipContent>
          </Tooltip>

          <div className="mx-1 h-6 w-px bg-border" aria-hidden="true" />

          {/* Lists */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="max-md:h-11 max-md:w-11"
                onClick={() => formatText('insertUnorderedList')}
                aria-label="Liste à puces"
              >
                <List aria-hidden="true" />
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
                size="icon-sm"
                className="max-md:h-11 max-md:w-11"
                onClick={() => formatText('insertOrderedList')}
                aria-label="Liste numérotée"
              >
                <ListOrdered aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Liste numérotée</p>
            </TooltipContent>
          </Tooltip>

          <div className="mx-1 h-6 w-px bg-border" aria-hidden="true" />

          {/* Emoji picker */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="max-md:h-11 max-md:w-11"
                aria-label="Insérer un emoji"
              >
                <Smile aria-hidden="true" />
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
                        <Button
                          key={emoji}
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="text-lg max-md:h-11 max-md:w-11"
                          onClick={() => insertEmoji(emoji)}
                        >
                          {emoji}
                        </Button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {/* Info */}
          <div className="ml-auto hidden items-center sm:flex">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground max-md:h-11 max-md:w-11"
                  aria-label="À propos de la mise en forme"
                >
                  <Info aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-72">
                <p className="text-xs">
                  La mise en forme (gras, italique, liens, listes) est conservée dans le message envoyé.
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
        role="textbox"
        aria-multiline="true"
        aria-label="Message"
        aria-describedby={showWordCount ? countId : undefined}
        onInput={handleInput}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        data-placeholder={placeholder}
        suppressContentEditableWarning
        className={cn(
          "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm",
          "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "font-sans leading-relaxed overflow-y-auto whitespace-pre-wrap break-words",
          "empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground empty:before:pointer-events-none",
          "[&_a]:text-primary [&_a]:underline",
          "[&_strong]:font-bold [&_b]:font-bold",
          "[&_em]:italic [&_i]:italic",
          "[&_ul]:list-disc [&_ul]:ml-4 [&_ol]:list-decimal [&_ol]:ml-4",
          isOverLimit && "border-danger focus-visible:ring-danger",
          className
        )}
        style={{ 
          minHeight,
          maxHeight,
        }}
      />

      {/* Footer with counts */}
      {showWordCount && (
        <div id={countId} className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{wordCount} {wordCount > 1 ? 'mots' : 'mot'}</span>
          <span className={cn(isOverLimit && "font-medium text-danger")}>
            {charCount}{maxCharacters ? ` / ${maxCharacters}` : ''} caractères
            {isOverLimit && " (limite dépassée)"}
          </span>
        </div>
      )}
    </div>
  );
};
