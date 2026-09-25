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
 * Commandes disponibles (déclenchées en tapant /ai au début ou via le bouton d'aide à la rédaction) :
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
import { Loader2, Check, X, PenLine } from 'lucide-react';
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
    label: 'Rédiger',
    description: 'Écrit un premier jet à partir du contexte',
    needsCurrentText: false,
    buildSystemPrompt: (ctx) =>
      `Tu es un assistant qui rédige du texte court et percutant. Ton: ${ctx.tone ?? DEFAULT_TONE}. Tutoiement par défaut. Réponds UNIQUEMENT le texte final, sans préfixe ni explication.`,
    buildUserPrompt: (_, ctx, userInput) =>
      `Rédige un ${ctx.purpose ?? 'texte'} pour:\n${ctx.data ? JSON.stringify(ctx.data).slice(0, 1500) : '(pas de contexte)'}\n${userInput ? `\nINSTRUCTION SUPPLÉMENTAIRE: ${userInput}` : ''}`,
  },
  {
    id: 'ameliore',
    label: 'Améliorer',
    description: 'Reformule pour plus de clarté et d’impact',
    needsCurrentText: true,
    buildSystemPrompt: () =>
      'Tu améliores le texte fourni : plus clair, plus percutant, sans changer le sens. Réponds UNIQUEMENT le texte amélioré, sans préambule.',
    buildUserPrompt: (current) => `Texte à améliorer:\n${current}`,
  },
  {
    id: 'raccourcis',
    label: 'Raccourcir',
    description: 'Garde l’essentiel en moitié moins de mots',
    needsCurrentText: true,
    buildSystemPrompt: () =>
      'Tu raccourcis le texte de moitié sans perdre l\'essentiel. Réponds UNIQUEMENT le texte raccourci, sans préambule.',
    buildUserPrompt: (current) => `Texte à raccourcir:\n${current}`,
  },
  {
    id: 'allonge',
    label: 'Développer',
    description: 'Ajoute du contexte et des détails',
    needsCurrentText: true,
    buildSystemPrompt: () =>
      'Tu étoffes le texte fourni avec plus de contexte et de détails pertinents. Réponds UNIQUEMENT le texte étoffé.',
    buildUserPrompt: (current, ctx) => `Texte à étoffer:\n${current}\n${ctx.data ? `\nCONTEXTE: ${JSON.stringify(ctx.data).slice(0, 1000)}` : ''}`,
  },
  {
    id: 'traduis_en',
    label: 'Traduire en anglais',
    description: 'Anglais professionnel, même ton',
    needsCurrentText: true,
    buildSystemPrompt: () =>
      'You translate the text from French to professional English, keeping tone and intent. Reply ONLY with the translation.',
    buildUserPrompt: (current) => `Translate:\n${current}`,
  },
  {
    id: 'corrige',
    label: 'Corriger',
    description: 'Orthographe et grammaire',
    needsCurrentText: true,
    buildSystemPrompt: () =>
      'Tu corriges l\'orthographe et la grammaire sans changer le style. Réponds UNIQUEMENT le texte corrigé.',
    buildUserPrompt: (current) => `Texte à corriger:\n${current}`,
  },
  {
    id: 'tutoiement',
    label: 'Passer au tutoiement',
    description: 'Réécrit le texte en tutoyant',
    needsCurrentText: true,
    buildSystemPrompt: () =>
      'Tu convertis le texte en tutoiement, naturellement. Réponds UNIQUEMENT le texte au tutoiement.',
    buildUserPrompt: (current) => `Texte:\n${current}`,
  },
  {
    id: 'vouvoiement',
    label: 'Passer au vouvoiement',
    description: 'Réécrit le texte en vouvoyant',
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
          console.warn('[AiTextarea]', data?.error || error?.message);
          toast.error("La rédaction n'a pas abouti. Réessayez dans un instant.");
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
        className={cn(preview && 'border-brand', className)}
        {...props}
      />

      {/* Aide à la rédaction : bouton flottant, en haut à droite du champ */}
      {!preview && !loading && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="absolute right-1.5 top-1.5 text-muted-foreground hover:text-foreground"
              title="Aide à la rédaction (/ai)"
              aria-label="Aide à la rédaction"
            >
              <PenLine aria-hidden="true" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-2">
            <div className="space-y-1">
              {currentText.trim().startsWith('/ai') && (
                <div className="mb-1 border-b border-border px-2 py-1.5">
                  <p className="eyebrow mb-1">Votre instruction</p>
                  <p className="text-xs text-foreground">{userInput || '(aucune instruction)'}</p>
                </div>
              )}
              {COMMANDS.map((cmd) => {
                const disabled = cmd.needsCurrentText && !currentText.replace(/^\/ai\s*/, '').trim();
                return (
                  <button
                    type="button"
                    key={cmd.id}
                    onClick={() => runCommand(cmd)}
                    disabled={disabled}
                    title={disabled ? 'Écrivez d’abord un texte' : undefined}
                    className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span className="text-xs font-medium text-foreground">{cmd.label}</span>
                    <span className="w-full truncate text-2xs text-muted-foreground">{cmd.description}</span>
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      )}

      {/* Loader */}
      {loading && (
        <div className="absolute right-1.5 top-1.5 flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-muted-foreground" role="status">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          <span className="text-2xs font-medium">Rédaction…</span>
        </div>
      )}

      {/* Preview accept/reject bar */}
      {preview && (
        <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1.5 rounded-lg border border-border bg-popover px-2 py-1 shadow-sm">
          <span className="text-2xs font-medium text-foreground">Aperçu : {preview.command.label}</span>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            onClick={rejectPreview}
            title="Revenir au texte d’origine"
            aria-label="Revenir au texte d’origine"
          >
            <X aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="primary"
            onClick={acceptPreview}
            title="Garder ce texte"
            aria-label="Garder ce texte"
          >
            <Check aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  );
};
