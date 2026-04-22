/**
 * AiTextarea — drop-in replacement de Textarea avec slash commands /ai.
 *
 * Usage:
 *   <AiTextarea
 *     value={message}
 *     onChange={(e) => setMessage(e.target.value)}
 *     context={{ mission, candidate }}  // injecté dans le system prompt
 *     placeholder="Tape /ai pour les commandes IA"
 *   />
 *
 * Commandes disponibles (déclenchées en tapant /ai au début ou via le bouton ✨) :
 *   - rédige     : génère depuis zéro avec contexte
 *   - améliore   : reformule le texte actuel
 *   - raccourcis : compresse le texte actuel
 *   - allonge    : étoffe le texte actuel
 *   - traduis    : FR ↔ EN
 *   - corrige    : orthographe/grammaire
 *   - tutoiement : passe au tutoiement
 *   - vouvoiement: passe au vouvoiement
 *
 * Toutes les actions ouvrent une preview avant remplacement (annulable).
 */
import React, { useCallback, useState, useRef, useEffect } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Sparkles, Loader2, Check, X, ArrowRight } from 'lucide-react';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface AiCommand {
  id: string;
  label: string;
  description: string;
  /** Si true, utilise le texte actuel comme input. Si false, génère depuis zéro avec contexte. */
  needsCurrentText: boolean;
  /** Construit le prompt système Claude */
  buildSystemPrompt: (context: AiContext) => string;
  /** Construit le prompt user */
  buildUserPrompt: (currentText: string, context: AiContext, userInput?: string) => string;
}

export interface AiContext {
  /** Le rôle pour lequel le texte est rédigé : "message LinkedIn", "brief de mission", "note debrief", etc. */
  purpose?: string;
  /** Données contextuelles libres (mission, candidat, etc.) */
  data?: Record<string, unknown>;
  /** Tone par défaut (peut être overrideé par la commande) */
  tone?: 'casual' | 'professional' | 'enthusiastic' | 'concise';
}

const DEFAULT_TONE = 'casual';

const COMMANDS: AiCommand[] = [
  {
    id: 'redige',
    label: '✍️ Rédige',
    description: 'Génère depuis zéro (utilise le contexte)',
    needsCurrentText: false,
    buildSystemPrompt: (ctx) =>
      `Tu es un assistant qui rédige du texte court et percutant. Ton: ${ctx.tone ?? DEFAULT_TONE}. Tutoiement par défaut. Réponds UNIQUEMENT le texte final, sans préfixe ni explication.`,
    buildUserPrompt: (_, ctx, userInput) =>
      `Rédige un ${ctx.purpose ?? 'texte'} pour:\n${ctx.data ? JSON.stringify(ctx.data).slice(0, 1500) : '(pas de contexte)'}\n${userInput ? `\nINSTRUCTION SUPPLÉMENTAIRE: ${userInput}` : ''}`,
  },
  {
    id: 'ameliore',
    label: '✨ Améliore',
    description: 'Reformule en mieux (clarté, impact)',
    needsCurrentText: true,
    buildSystemPrompt: () =>
      'Tu améliores le texte fourni : plus clair, plus percutant, sans changer le sens. Réponds UNIQUEMENT le texte amélioré, sans préambule.',
    buildUserPrompt: (current) => `Texte à améliorer:\n${current}`,
  },
  {
    id: 'raccourcis',
    label: '✂️ Raccourcis',
    description: 'Compresse en gardant l\'essentiel',
    needsCurrentText: true,
    buildSystemPrompt: () =>
      'Tu raccourcis le texte de moitié sans perdre l\'essentiel. Réponds UNIQUEMENT le texte raccourci, sans préambule.',
    buildUserPrompt: (current) => `Texte à raccourcir:\n${current}`,
  },
  {
    id: 'allonge',
    label: '📝 Allonge',
    description: 'Étoffe avec plus de détails',
    needsCurrentText: true,
    buildSystemPrompt: () =>
      'Tu étoffes le texte fourni avec plus de contexte et de détails pertinents. Réponds UNIQUEMENT le texte étoffé.',
    buildUserPrompt: (current, ctx) => `Texte à étoffer:\n${current}\n${ctx.data ? `\nCONTEXTE: ${JSON.stringify(ctx.data).slice(0, 1000)}` : ''}`,
  },
  {
    id: 'traduis_en',
    label: '🇬🇧 Traduis EN',
    description: 'Vers l\'anglais professionnel',
    needsCurrentText: true,
    buildSystemPrompt: () =>
      'You translate the text from French to professional English, keeping tone and intent. Reply ONLY with the translation.',
    buildUserPrompt: (current) => `Translate:\n${current}`,
  },
  {
    id: 'corrige',
    label: '🔍 Corrige',
    description: 'Orthographe + grammaire',
    needsCurrentText: true,
    buildSystemPrompt: () =>
      'Tu corriges l\'orthographe et la grammaire sans changer le style. Réponds UNIQUEMENT le texte corrigé.',
    buildUserPrompt: (current) => `Texte à corriger:\n${current}`,
  },
  {
    id: 'tutoiement',
    label: '👋 Tu',
    description: 'Passe au tutoiement',
    needsCurrentText: true,
    buildSystemPrompt: () =>
      'Tu convertis le texte en tutoiement, naturellement. Réponds UNIQUEMENT le texte au tutoiement.',
    buildUserPrompt: (current) => `Texte:\n${current}`,
  },
  {
    id: 'vouvoiement',
    label: '🎩 Vous',
    description: 'Passe au vouvoiement',
    needsCurrentText: true,
    buildSystemPrompt: () =>
      'Tu convertis le texte en vouvoiement professionnel. Réponds UNIQUEMENT le texte au vouvoiement.',
    buildUserPrompt: (current) => `Texte:\n${current}`,
  },
];

interface AiTextareaProps extends React.ComponentProps<typeof Textarea> {
  /** Contexte injecté dans les prompts AI */
  context?: AiContext;
  /** Callback quand l'AI génère un nouveau texte (pour update parent state) */
  onAiGenerate?: (text: string) => void;
}

export const AiTextarea: React.FC<AiTextareaProps> = ({
  value,
  onChange,
  context = {},
  onAiGenerate,
  className,
  ...props
}) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<{ command: AiCommand; text: string } | null>(null);
  const [userInput, setUserInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const currentText = String(value ?? '');

  // Détecte /ai au début → ouvre la popover automatiquement
  useEffect(() => {
    if (currentText.trim().startsWith('/ai')) {
      const userQuery = currentText.replace(/^\s*\/ai\s*/, '');
      setUserInput(userQuery);
      setOpen(true);
    }
  }, [currentText]);

  const runCommand = useCallback(
    async (command: AiCommand) => {
      setLoading(true);
      setOpen(false);
      try {
        const messages = [
          { role: 'system' as const, content: command.buildSystemPrompt(context) },
          { role: 'user' as const, content: command.buildUserPrompt(currentText.replace(/^\/ai\s*/, ''), context, userInput) },
        ];
        const { data, error } = await invokeEdgeFunction<{ success: boolean; response?: string; error?: string }>(
          'ai-chat-completion',
          { messages },
        );
        if (error || !data?.success || !data.response) {
          toast.error(data?.error || error?.message || 'Échec génération IA');
          return;
        }
        setPreview({ command, text: data.response.trim() });
      } finally {
        setLoading(false);
      }
    },
    [currentText, context, userInput],
  );

  const acceptPreview = () => {
    if (!preview) return;
    if (onAiGenerate) {
      onAiGenerate(preview.text);
    } else if (onChange) {
      // Synthetic event pour rester compatible avec onChange standard
      onChange({
        target: { value: preview.text },
        currentTarget: { value: preview.text },
      } as React.ChangeEvent<HTMLTextAreaElement>);
    }
    setPreview(null);
    setUserInput('');
    textareaRef.current?.focus();
  };

  const rejectPreview = () => {
    setPreview(null);
  };

  return (
    <div className="relative">
      <Textarea
        ref={textareaRef}
        value={preview ? preview.text : value}
        onChange={(e) => {
          if (preview) return; // freeze pendant preview
          onChange?.(e);
        }}
        className={cn(preview && 'border-brand-purple/50 bg-brand-purple/5', className)}
        {...props}
      />

      {/* Bouton ✨ AI flottant */}
      {!preview && !loading && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="absolute top-1.5 right-1.5 h-7 w-7 hover:bg-brand-purple/10 text-muted-foreground hover:text-brand-purple"
              title="Commandes IA (/ai)"
            >
              <Sparkles className="w-3.5 h-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-2">
            <div className="space-y-1">
              {currentText.trim().startsWith('/ai') && (
                <div className="px-2 py-1.5 mb-1 border-b border-border">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                    Instruction détectée
                  </p>
                  <p className="text-xs text-foreground italic">{userInput || '(commande vide)'}</p>
                </div>
              )}
              {COMMANDS.map((cmd) => {
                const disabled = cmd.needsCurrentText && !currentText.replace(/^\/ai\s*/, '').trim();
                return (
                  <button
                    key={cmd.id}
                    onClick={() => runCommand(cmd)}
                    disabled={disabled}
                    className={cn(
                      'w-full flex items-start gap-2 px-2 py-1.5 text-left rounded hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                    )}
                  >
                    <span className="text-sm shrink-0">{cmd.label.split(' ')[0]}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-foreground">{cmd.label.split(' ').slice(1).join(' ')}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{cmd.description}</p>
                    </div>
                    <ArrowRight className="w-3 h-3 mt-0.5 text-muted-foreground/40" />
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      )}

      {/* Loader */}
      {loading && (
        <div className="absolute top-1.5 right-1.5 flex items-center gap-1.5 px-2 py-1 bg-brand-purple/10 border border-brand-purple/30 text-brand-purple">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span className="text-[10px] font-bold uppercase tracking-wider">Génération…</span>
        </div>
      )}

      {/* Preview accept/reject bar */}
      {preview && (
        <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1.5 px-2 py-1 bg-background border border-brand-purple shadow-sm">
          <span className="text-[10px] font-bold uppercase tracking-wider text-brand-purple">
            Preview {preview.command.label.split(' ').slice(1).join(' ')}
          </span>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={rejectPreview}
            className="h-6 w-6 hover:bg-destructive/10 hover:text-destructive"
            title="Rejeter"
          >
            <X className="w-3 h-3" />
          </Button>
          <Button
            type="button"
            size="icon"
            onClick={acceptPreview}
            className="h-6 w-6 bg-brand-purple text-white hover:bg-brand-purple/90"
            title="Accepter"
          >
            <Check className="w-3 h-3" />
          </Button>
        </div>
      )}
    </div>
  );
};
