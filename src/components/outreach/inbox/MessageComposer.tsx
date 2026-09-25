/**
 * MessageComposer — rédaction d'un message, avec mise en forme et outils IA.
 *
 * - Barre d'outils : mise en forme (gras, italique, lien, listes), puis
 *   « Reformuler », « Traduire », « Proposer une suite », emoji. Chaque bouton
 *   a un nom accessible ; sous 640 px, la mise en forme passe dans un menu et
 *   les outils IA gardent leur icône (revue design D-13).
 * - Un seul bouton principal : « Envoyer ». « Suggestions » reste discret, son
 *   nombre en accent (D-13, D-19).
 * - Raccourcis : ⌘/Ctrl + B, I, K, et ⌘/Ctrl + Entrée pour envoyer ; « / »
 *   ouvre les modèles.
 *
 * Le gras et l'italique utilisent les caractères Unicode compris par LinkedIn
 * (textFormat.ts).
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import {
  Bold, CalendarPlus, Check, Italic, Languages, Lightbulb, Link as LinkIcon,
  List, ListOrdered, Send, Smile, Type, Wand2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { promptDialog } from '@/lib/promptDialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toggleBold, toggleItalic, toBulletList, toNumberedList, insertLink } from './textFormat';
import { TemplatesPicker } from './TemplatesPicker';
import { useMessageTemplates, MessageTemplate } from '@/hooks/useMessageTemplates';
import {
  interpolatePlaceholders,
  type PlaceholderContext,
} from '@/lib/templatePlaceholders';
import { useTextActions, type RewriteVariant, type CtaChatMessage } from '@/hooks/useTextActions';
import { CtaReplyButton } from './CtaReplyButton';

// Emoji à insérer dans le message (contenu du message, pas icônes d'interface)
const QUICK_EMOJIS = ['👋', '🤝', '💼', '🚀', '⭐', '🙏', '😊', '👍', '🔥', '💡', '✨', '🎯', '📌', '✅', '💬'];

// Outils de la barre : 44 px au doigt, 28 px à la souris (01-direction.md, § 5)
const TOOL_ICON = 'h-11 w-11 text-muted-foreground hover:text-foreground sm:h-7 sm:w-7';
const TOOL_TEXT = 'h-11 w-11 px-0 text-muted-foreground hover:text-foreground sm:h-7 sm:w-auto sm:px-2';

export interface MessageComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  disabled?: boolean;
  onOpenAI?: () => void;
  /** Panneau IA ouvert (état du bouton « Suggestions ») */
  aiPanelOpen?: boolean;
  hasAISuggestions?: boolean;
  aiSuggestionsCount?: number;
  onScheduleCall?: () => void;
  hasCalendlyLink?: boolean;
  /** Nom du canal (« LinkedIn »), en casse normale */
  channel?: string;
  /** Un brouillon de cette conversation est enregistré (revue design D-10). */
  draftSaved?: boolean;
  /** Context pour les placeholders templates (prénom, entreprise, etc.).
      Peut être pré-construit via buildPlaceholderContext() depuis le parent. */
  placeholderContext?: PlaceholderContext;
  /** Historique du chat pour le bouton "Réponse + CTA". Si vide, le
      bouton est désactivé. */
  ctaChatHistory?: CtaChatMessage[];
  /** Nom du candidat (display name) pour le prompt CTA. */
  ctaCandidateName?: string;
  /** Nom du recruteur (toi) pour le prompt CTA. */
  ctaRecruiterName?: string;
  /** Titre de la mission liée pour le prompt CTA. */
  ctaJobTitle?: string;
  /** Brief structuré du poste pour le CTA "Détailler le poste". */
  ctaJobBrief?: Record<string, unknown>;
  /** Lien Calendly pour le CTA "rdv". */
  ctaCalendlyLink?: string;
  /** Ton sélectionné pour le prompt CTA. */
  ctaTone?: string;
}

/** Bouton icône de la barre : nom accessible, infobulle avec le raccourci. */
const ToolIconButton: React.FC<{ label: string; hint?: string; onClick: () => void; children: React.ReactNode }> = ({
  label,
  hint,
  onClick,
  children,
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button type="button" variant="ghost" size="icon-xs" onClick={onClick} aria-label={label} className={TOOL_ICON}>
        {children}
      </Button>
    </TooltipTrigger>
    <TooltipContent side="top">{hint ? `${label} (${hint})` : label}</TooltipContent>
  </Tooltip>
);

export const MessageComposer: React.FC<MessageComposerProps> = ({
  value,
  onChange,
  onSend,
  sending,
  disabled = false,
  onOpenAI,
  aiPanelOpen = false,
  hasAISuggestions,
  aiSuggestionsCount,
  onScheduleCall,
  hasCalendlyLink,
  channel,
  draftSaved = false,
  placeholderContext,
  ctaChatHistory,
  ctaCandidateName,
  ctaRecruiterName,
  ctaJobTitle,
  ctaJobBrief,
  ctaCalendlyLink,
  ctaTone,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isSendable = value.trim().length > 0 && !sending && !disabled;
  const hasText = value.trim().length > 0;
  const templatesListId = useId();
  const [activeTemplateId, setActiveTemplateId] = useState<string | undefined>(undefined);

  // Commande « / » : le texte qui suit, jusqu'au prochain espace, filtre les modèles.
  const { markUsed } = useMessageTemplates();
  const [slashQuery, setSlashQuery] = useState<string | null>(null);

  // Actions IA : reformuler, traduire
  const { rewrite, translate, rewriteLoading, translateLoading } = useTextActions();
  const [rewriteVariants, setRewriteVariants] = useState<RewriteVariant[] | null>(null);
  const [rewriteDialogOpen, setRewriteDialogOpen] = useState(false);

  // Traduction : aperçu avant de remplacer
  const [translateDialogOpen, setTranslateDialogOpen] = useState(false);
  const [translateOriginal, setTranslateOriginal] = useState<string>('');
  const [translateResult, setTranslateResult] = useState<string>('');
  const [translateTargetLang, setTranslateTargetLang] = useState<'fr' | 'en'>('en');

  /** Reformule la sélection (ou tout le contenu si pas de sélection) */
  const handleRewrite = async () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? value.length;
    const hasSelection = start !== end;
    const sourceText = hasSelection ? value.slice(start, end) : value;
    if (!sourceText.trim()) {
      return;
    }
    const variants = await rewrite(sourceText);
    if (variants && variants.length > 0) {
      setRewriteVariants(variants);
      setRewriteDialogOpen(true);
    }
  };

  /** Applique une variante (remplace la sélection ou tout le contenu) */
  const applyRewriteVariant = (variant: RewriteVariant) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? value.length;
    const hasSelection = start !== end;
    if (hasSelection) {
      const newValue = value.slice(0, start) + variant.text + value.slice(end);
      onChange(newValue);
      requestAnimationFrame(() => {
        ta.focus();
        const newPos = start + variant.text.length;
        ta.setSelectionRange(newPos, newPos);
      });
    } else {
      onChange(variant.text);
    }
    setRewriteDialogOpen(false);
    setRewriteVariants(null);
  };

  /** Traduit le contenu, puis montre l'original et la traduction */
  const handleTranslate = async (targetLang: 'fr' | 'en') => {
    if (!value.trim()) return;
    const translated = await translate(value, targetLang);
    if (translated) {
      setTranslateOriginal(value);
      setTranslateResult(translated);
      setTranslateTargetLang(targetLang);
      setTranslateDialogOpen(true);
    }
  };

  const applyTranslation = () => {
    onChange(translateResult);
    setTranslateDialogOpen(false);
  };

  /** Commande « / » en cours juste avant le curseur : le filtre (sans « / »), sinon null. */
  const detectSlashCommand = (val: string, cursor: number): string | null => {
    const before = val.slice(0, cursor);
    const match = before.match(/(^|\s)\/(\S*)$/);
    if (match) return match[2];
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

  /** Insère un modèle à la place de la commande « / », variables remplacées ({{prenom}}, {{client}}…) */
  const insertTemplate = (template: MessageTemplate) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const cursor = ta.selectionStart ?? value.length;
    const before = value.slice(0, cursor);
    const after = value.slice(cursor);
    const interpolatedContent = placeholderContext
      ? interpolatePlaceholders(template.content, placeholderContext)
      : template.content;
    const replaced = before.replace(/(^|\s)\/(\S*)$/, '$1' + interpolatedContent);
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

  // Hauteur du champ suivant le texte, jusqu'à 160 px
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = '0px';
    const newHeight = Math.min(ta.scrollHeight, 160);
    ta.style.height = `${Math.max(newHeight, 24)}px`;
  }, [value]);

  // ─── Mise en forme de la sélection ───────────────────────────────────
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
  const handleLink = async () => {
    const url = await promptDialog({
      title: 'Insérer un lien',
      defaultValue: 'https://',
      placeholder: 'https://exemple.com',
    });
    const trimmed = url?.trim() ?? '';
    if (!trimmed || trimmed === 'https://') return;
    applyToSelection((selected) => insertLink(selected, trimmed));
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
      void handleLink();
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

  const templatesOpen = slashQuery !== null;
  const scheduleHint = hasCalendlyLink
    ? 'Insérer votre lien de prise de rendez-vous'
    : 'Aucun lien de rendez-vous : ajoutez votre lien Calendly à la mission';

  return (
    <TooltipProvider delayDuration={400}>
      <div className="border-t border-border bg-background px-3 py-3 md:px-4" data-component="message-composer">
        <div className="rounded-xl border border-input bg-card transition-[border-color,box-shadow] duration-150 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/20">
          {/* Barre d'outils */}
          <div className="flex items-center gap-0.5 border-b border-border px-1.5 py-1">
            {/* Mise en forme : boutons à partir de 640 px, menu en dessous */}
            <div className="hidden items-center gap-0.5 sm:flex">
              <ToolIconButton label="Gras" hint={`${cmd}+B`} onClick={handleBold}>
                <Bold aria-hidden="true" />
              </ToolIconButton>
              <ToolIconButton label="Italique" hint={`${cmd}+I`} onClick={handleItalic}>
                <Italic aria-hidden="true" />
              </ToolIconButton>
              <ToolIconButton label="Insérer un lien" hint={`${cmd}+K`} onClick={() => void handleLink()}>
                <LinkIcon aria-hidden="true" />
              </ToolIconButton>
              <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
              <ToolIconButton label="Liste à puces" onClick={handleBulletList}>
                <List aria-hidden="true" />
              </ToolIconButton>
              <ToolIconButton label="Liste numérotée" onClick={handleNumberedList}>
                <ListOrdered aria-hidden="true" />
              </ToolIconButton>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon-xs" aria-label="Mise en forme" className={cn(TOOL_ICON, 'sm:hidden')}>
                  <Type aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-52">
                <DropdownMenuItem className="min-h-11" onSelect={handleBold}>
                  <Bold className="mr-2 h-4 w-4" aria-hidden="true" />Gras
                </DropdownMenuItem>
                <DropdownMenuItem className="min-h-11" onSelect={handleItalic}>
                  <Italic className="mr-2 h-4 w-4" aria-hidden="true" />Italique
                </DropdownMenuItem>
                <DropdownMenuItem className="min-h-11" onSelect={() => void handleLink()}>
                  <LinkIcon className="mr-2 h-4 w-4" aria-hidden="true" />Insérer un lien
                </DropdownMenuItem>
                <DropdownMenuItem className="min-h-11" onSelect={handleBulletList}>
                  <List className="mr-2 h-4 w-4" aria-hidden="true" />Liste à puces
                </DropdownMenuItem>
                <DropdownMenuItem className="min-h-11" onSelect={handleNumberedList}>
                  <ListOrdered className="mr-2 h-4 w-4" aria-hidden="true" />Liste numérotée
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />

            {/* Reformuler : trois variantes, dans un dialogue */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => void handleRewrite()}
                  disabled={!hasText}
                  loading={rewriteLoading}
                  aria-label="Reformuler"
                  className={TOOL_TEXT}
                >
                  {!rewriteLoading && <Wand2 aria-hidden="true" />}
                  <span className="hidden sm:inline">Reformuler</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Propose trois reformulations du texte sélectionné, ou de tout le message</TooltipContent>
            </Tooltip>

            {/* Traduire : anglais ou français, avec aperçu */}
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      disabled={!hasText}
                      loading={translateLoading}
                      aria-label="Traduire"
                      className={TOOL_TEXT}
                    >
                      {!translateLoading && <Languages aria-hidden="true" />}
                      <span className="hidden sm:inline">Traduire</span>
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="top">Traduire le message</TooltipContent>
              </Tooltip>
              <DropdownMenuContent side="top" align="start" className="w-48">
                <DropdownMenuItem className="min-h-11 md:min-h-0" onSelect={() => void handleTranslate('en')}>
                  Traduire en anglais
                </DropdownMenuItem>
                <DropdownMenuItem className="min-h-11 md:min-h-0" onSelect={() => void handleTranslate('fr')}>
                  Traduire en français
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Proposer une suite : réponse rédigée par l'IA, relue avant insertion */}
            <CtaReplyButton
              chatHistory={ctaChatHistory || []}
              candidateName={ctaCandidateName}
              recruiterName={ctaRecruiterName}
              jobTitle={ctaJobTitle}
              jobBrief={ctaJobBrief}
              calendlyLink={ctaCalendlyLink}
              tone={ctaTone}
              disabled={disabled}
              onInsert={(msg) => {
                // Champ vide : le texte remplace ; sinon il s'ajoute à la fin.
                const next = value.trim() ? `${value.trimEnd()}\n\n${msg}` : msg;
                onChange(next);
                requestAnimationFrame(() => {
                  const ta = textareaRef.current;
                  if (!ta) return;
                  ta.focus();
                  ta.setSelectionRange(next.length, next.length);
                  ta.scrollTop = ta.scrollHeight;
                });
              }}
            />

            <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />

            <Popover>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="ghost" size="icon-xs" aria-label="Insérer un emoji" className={TOOL_ICON}>
                      <Smile aria-hidden="true" />
                    </Button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent side="top">Insérer un emoji</TooltipContent>
              </Tooltip>
              <PopoverContent className="w-auto p-2" side="top" align="start">
                <div className="grid grid-cols-5 gap-1">
                  {QUICK_EMOJIS.map((emoji) => (
                    <Button
                      key={emoji}
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => insertEmoji(emoji)}
                      className="text-lg"
                    >
                      {emoji}
                    </Button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <span className="ml-auto hidden px-1 text-2xs tabular-nums text-muted-foreground lg:inline">
              {value.length > 0 ? `${value.length} caractère${value.length > 1 ? 's' : ''}` : ''}
            </span>
          </div>

          {/* Champ */}
          <div className="relative">
            <Textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => handleTextChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => {
                // Délai : un clic dans la liste des modèles passe avant la fermeture
                setTimeout(() => setSlashQuery(null), 200);
              }}
              aria-label="Message"
              aria-autocomplete="list"
              aria-controls={templatesOpen ? templatesListId : undefined}
              aria-activedescendant={templatesOpen ? activeTemplateId : undefined}
              placeholder="Écrivez votre message (« / » pour insérer un modèle)"
              disabled={disabled}
              rows={1}
              className="min-h-0 resize-none rounded-lg border-0 bg-transparent px-3 py-2.5 leading-relaxed hover:border-0 focus-visible:border-0 focus-visible:ring-0"
              style={{ minHeight: '24px', maxHeight: '160px' }}
            />
            {templatesOpen && (
              <TemplatesPicker
                query={slashQuery}
                listId={templatesListId}
                onActiveOptionChange={setActiveTemplateId}
                onSelect={insertTemplate}
                onClose={() => setSlashQuery(null)}
                onCreateNew={() => {
                  setSlashQuery(null);
                  // Paramètres › Rédaction (modèles), dans un nouvel onglet
                  window.open('/settings/account/writing#modeles', '_blank');
                }}
              />
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between gap-2 border-t border-border px-1.5 py-1.5">
            <div className="flex items-center gap-1">
              {onOpenAI && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={onOpenAI}
                      aria-expanded={aiPanelOpen}
                      className={cn('h-11 px-3 md:h-8', aiPanelOpen && 'bg-accent')}
                    >
                      <Lightbulb aria-hidden="true" />
                      Suggestions
                      {hasAISuggestions && aiSuggestionsCount ? (
                        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand/15 px-1 text-3xs font-semibold tabular-nums text-brand">
                          {aiSuggestionsCount}
                        </span>
                      ) : null}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Réponses proposées par l'IA pour cette conversation</TooltipContent>
                </Tooltip>
              )}
              {onScheduleCall && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label="Insérer un lien de rendez-vous"
                      aria-disabled={!hasCalendlyLink || undefined}
                      onClick={hasCalendlyLink ? onScheduleCall : undefined}
                      className="h-11 w-11 px-0 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 md:h-8 md:w-auto md:px-3"
                    >
                      <CalendarPlus aria-hidden="true" />
                      <span className="hidden md:inline">Rendez-vous</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{scheduleHint}</TooltipContent>
                </Tooltip>
              )}
            </div>

            <div className="flex items-center gap-3">
              {draftSaved && (
                <span className="hidden text-2xs text-muted-foreground sm:inline" role="status">
                  Brouillon enregistré
                </span>
              )}
              <span className="hidden items-center gap-1 text-2xs text-muted-foreground lg:inline-flex">
                {channel && <span>{channel} ·</span>}
                <kbd className="rounded-sm border border-border px-1 font-mono text-3xs">{cmd}</kbd>
                <kbd className="rounded-sm border border-border px-1 font-mono text-3xs">Entrée</kbd>
              </span>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={onSend}
                disabled={!isSendable}
                loading={sending}
                aria-label="Envoyer le message"
                className="h-11 md:h-8"
              >
                {sending ? 'Envoi…' : 'Envoyer'}
                {!sending && <Send aria-hidden="true" />}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Traduction : l'original et la traduction, avant de remplacer */}
      <Dialog open={translateDialogOpen} onOpenChange={setTranslateDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Traduction en {translateTargetLang === 'en' ? 'anglais' : 'français'}</DialogTitle>
            <DialogDescription>Relisez la traduction : elle remplacera votre texte, que vous pourrez encore modifier.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <p className="eyebrow mb-1">Original</p>
              <div className="whitespace-pre-wrap rounded-lg border border-border bg-muted p-3 text-sm leading-relaxed text-foreground-secondary">
                {translateOriginal}
              </div>
            </div>
            <div>
              <p className="eyebrow mb-1">Traduction</p>
              <div className="whitespace-pre-wrap rounded-lg border border-border-strong bg-card p-3 text-sm leading-relaxed text-foreground">
                {translateResult}
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setTranslateDialogOpen(false)}>
              Annuler
            </Button>
            <Button variant="primary" onClick={applyTranslation}>
              <Check aria-hidden="true" />
              Remplacer par la traduction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reformulation : une variante remplace le texte */}
      <Dialog open={rewriteDialogOpen} onOpenChange={setRewriteDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Choisir une reformulation</DialogTitle>
            <DialogDescription>
              La variante choisie remplace votre texte ; vous pourrez encore la modifier avant l'envoi.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {rewriteVariants?.map((v, i) => (
              <Button
                key={i}
                type="button"
                variant="outline"
                onClick={() => applyRewriteVariant(v)}
                className="group h-auto w-full flex-col items-stretch gap-2 whitespace-normal p-4 text-left font-normal"
              >
                <span className="flex items-center gap-2">
                  <span className="rounded-sm bg-muted px-2 py-0.5 text-2xs font-semibold text-foreground">{v.label}</span>
                  <span className="text-2xs text-muted-foreground">{v.text.length} caractères</span>
                  <Check className="ml-auto text-muted-foreground group-hover:text-foreground" aria-hidden="true" />
                </span>
                <span className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{v.text}</span>
              </Button>
            ))}
            {rewriteVariants && rewriteVariants.length === 0 && (
              <p className="py-4 text-center text-xs text-muted-foreground">Aucune variante proposée. Réessayez dans un instant.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
};
