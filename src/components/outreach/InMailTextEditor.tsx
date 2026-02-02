import React, { useRef, useCallback, useEffect } from 'react';
import { Textarea } from '@/components/ui/textarea';
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
  ArrowRight,
  Info,
  Sparkles,
  Target,
  Lightbulb,
  MessageCircle,
  Zap,
  CheckCircle,
  Star,
  ThumbsUp,
  Briefcase,
  MapPin,
  Clock,
  Phone,
  Mail,
  Users,
  Award,
  TrendingUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface InMailTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: string;
  maxHeight?: string; // Maximum height for auto-resize
  showWordCount?: boolean;
  maxCharacters?: number;
  id?: string;
  onSend?: () => void; // Optional callback for Ctrl+Enter to send
  autoResize?: boolean; // Enable auto-resize based on content
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

// Quick insert snippets for professional messages
const QUICK_INSERTS = [
  { label: 'Saut de paragraphe', insert: '\n\n', icon: WrapText },
  { label: 'Tiret liste', insert: '\n- ', icon: ArrowRight },
  { label: 'Numéro liste', insert: '\n1. ', icon: ArrowRight },
];

export const InMailTextEditor: React.FC<InMailTextEditorProps> = ({
  value,
  onChange,
  placeholder = 'Rédigez votre message...',
  className,
  minHeight = '200px',
  maxHeight = '400px',
  showWordCount = true,
  maxCharacters = 1900, // LinkedIn InMail limit is around 1900-2000 chars
  id,
  onSend,
  autoResize = true,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea based on content
  useEffect(() => {
    if (!autoResize || !textareaRef.current) return;
    
    const textarea = textareaRef.current;
    // Reset height to get accurate scrollHeight
    textarea.style.height = minHeight;
    // Set height to scrollHeight (content height)
    const newHeight = Math.min(
      textarea.scrollHeight,
      parseInt(maxHeight) || 400
    );
    textarea.style.height = `${Math.max(newHeight, parseInt(minHeight) || 60)}px`;
  }, [value, autoResize, minHeight, maxHeight]);

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl+Enter or Cmd+Enter to send
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && onSend) {
      e.preventDefault();
      onSend();
    }
  }, [onSend]);

  // Insert text at cursor position
  const insertAtCursor = useCallback((textToInsert: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      onChange(value + textToInsert);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newValue = value.substring(0, start) + textToInsert + value.substring(end);
    
    onChange(newValue);
    
    // Restore focus and set cursor position after the inserted text
    setTimeout(() => {
      textarea.focus();
      const newPosition = start + textToInsert.length;
      textarea.setSelectionRange(newPosition, newPosition);
    }, 0);
  }, [value, onChange]);

  // Wrap selected text with characters (for emphasis simulation)
  const wrapSelection = useCallback((prefix: string, suffix: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = value.substring(start, end);
    
    if (selectedText) {
      const newValue = value.substring(0, start) + prefix + selectedText + suffix + value.substring(end);
      onChange(newValue);
      
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + prefix.length, end + prefix.length);
      }, 0);
    }
  }, [value, onChange]);

  const wordCount = value.split(/\s+/).filter(Boolean).length;
  const charCount = value.length;
  const isOverLimit = maxCharacters && charCount > maxCharacters;

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex items-center gap-1 p-1 bg-muted/50 rounded-lg border border-border/50">
        <TooltipProvider delayDuration={200}>
          {/* Quick inserts */}
          {QUICK_INSERTS.map((item, i) => (
            <Tooltip key={i}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => insertAtCursor(item.insert)}
                >
                  <item.icon className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>{item.label}</p>
              </TooltipContent>
            </Tooltip>
          ))}

          <div className="w-px h-6 bg-border mx-1" />

          {/* Text emphasis (using Unicode) */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 font-bold"
                onClick={() => wrapSelection('*', '*')}
              >
                *B*
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Emphase avec astérisques (sélectionnez d'abord)</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 italic"
                onClick={() => wrapSelection('_', '_')}
              >
                _I_
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Emphase avec underscores (sélectionnez d'abord)</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2"
                onClick={() => wrapSelection('«', '»')}
              >
                «»
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Guillemets français (sélectionnez d'abord)</p>
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
                          onClick={() => insertAtCursor(emoji)}
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

          {/* Info about LinkedIn formatting */}
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
              <TooltipContent side="bottom" className="max-w-[250px]">
                <p className="text-xs">
                  LinkedIn InMail supporte uniquement le texte brut. 
                  Utilisez les sauts de ligne pour structurer votre message, 
                  les emojis pour ajouter de la personnalité, et les caractères 
                  comme *astérisques* ou _underscores_ pour l'emphase visuelle.
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>

      {/* Textarea */}
      <Textarea
        ref={textareaRef}
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={cn(
          "font-sans leading-relaxed transition-all",
          autoResize ? "resize-none" : "resize-y",
          isOverLimit && "border-red-500 focus-visible:ring-red-500",
          className
        )}
        style={{ 
          minHeight,
          maxHeight: autoResize ? maxHeight : undefined,
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
