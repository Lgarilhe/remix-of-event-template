/**
 * MessageComposer — rédaction d'un message, avec mise en forme et outils IA.
 *
 * - Le champ et « Envoyer » restent visibles ; « Aide à la rédaction » déplie
 *   les suggestions, la mise en forme, les outils IA et les emojis à la demande.
 * - Les outils restent montés pour préserver une préparation en cours et les
 *   raccourcis de rédaction restent actifs même lorsque la barre est repliée.
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
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuShortcut, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toggleBold, toggleItalic, toBulletList, toNumberedList, insertLink } from './textFormat';
import { TemplatesPicker } from './TemplatesPicker';
import { SmartReplies } from './SmartReplies';
import { useMessageTemplates, MessageTemplate } from '@/hooks/useMessageTemplates';
import {
  interpolatePlaceholders,
  type PlaceholderContext,
} from '@/lib/templatePlaceholders';
import { useTextActions, type RewriteVariant, type CtaChatMessage } from '@/hooks/useTextActions';
import { CtaReplyButton } from './CtaReplyButton';
import { MESSAGE_EMOJIS } from '@/lib/messageEmojis';

// Emoji à insérer dans le message (contenu du message, pas icônes d'interface)
// Outils de la barre : 44 px au doigt, 28 px à la souris (01-direction.md, § 5)
const TOOL_ICON = 'h-11 w-11 sm:h-7 sm:w-7';
const TOOL_TEXT = 'h-11 w-11 px-0 sm:h-7 sm:w-auto sm:px-2';
// Ligne du menu « Mise en forme » : 44 px au doigt.
const FORMAT_ITEM = 'min-h-11 md:min-h-0';

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
  replySuggestions?: Array<{ text: string; type?: string }>;
  onSuggestionPick?: (text: string) => void;
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
  replySuggestions = [],
  onSuggestionPick,
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
  const writingToolsId = useId();
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsRef = useRef<HTMLDivElement>(null);
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (toolsOpen) toolsRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [toolsOpen]);
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
        <div className="rounded-xl border border-input bg-card transition-[border-color,box-shadow] duration-150 focus-within:border-ring focus-within:ring-1 focus-within:ring-ring">
          {/* Les outils secondaires se déplient uniquement à la demande. */}
          <div ref={toolsRef} id={writingToolsId} role="group" aria-label="Outils de rédaction" className={cn('flex-wrap items-center gap-0.5 border-b border-border px-1.5 py-1', toolsOpen ? 'flex' : 'hidden')} onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); setToolsOpen(false); helpButtonRef.current?.focus(); } }}>
            {replySuggestions.length > 0 && onSuggestionPick && <div className="w-full min-w-0">
              <SmartReplies suggestions={replySuggestions} onPick={text => {
                onSuggestionPick(text);
                setToolsOpen(false);
                requestAnimationFrame(() => textareaRef.current?.focus());
              }} onSeeMore={onOpenAI ? () => { setToolsOpen(false); onOpenAI(); } : undefined} />
            </div>}
            {onOpenAI && (
              <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => { setToolsOpen(false); onOpenAI(); }} aria-expanded={aiPanelOpen} className="min-h-11 gap-2 px-2">
                <Lightbulb aria-hidden="true" />{hasAISuggestions ? 'Analyser l’échange' : 'Suggestions'}
                {hasAISuggestions && aiSuggestionsCount ? <span className="tabular-nums text-muted-foreground">{aiSuggestionsCount}</span> : null}
              </Button>
            )}
            {/* Mise en forme : un menu à toutes les tailles ; ses raccourcis restent actifs */}
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="ghost" size="icon-xs" aria-label="Mise en forme" className={TOOL_ICON}>
                      <Type aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="top">Mise en forme</TooltipContent>
              </Tooltip>
              <DropdownMenuContent side="top" align="start" className="w-56">
                <DropdownMenuItem className={FORMAT_ITEM} onSelect={handleBold}>
                  <Bold className="mr-2 h-4 w-4" aria-hidden="true" />Gras
                  <DropdownMenuShortcut>{cmd}+B</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem className={FORMAT_ITEM} onSelect={handleItalic}>
                  <Italic className="mr-2 h-4 w-4" aria-hidden="true" />Italique
                  <DropdownMenuShortcut>{cmd}+I</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem className={FORMAT_ITEM} onSelect={() => void handleLink()}>
                  <LinkIcon className="mr-2 h-4 w-4" aria-hidden="true" />Insérer un lien
                  <DropdownMenuShortcut>{cmd}+K</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem className={FORMAT_ITEM} onSelect={handleBulletList}>
                  <List className="mr-2 h-4 w-4" aria-hidden="true" />Liste à puces
                </DropdownMenuItem>
                <DropdownMenuItem className={FORMAT_ITEM} onSelect={handleNumberedList}>
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
                  {MESSAGE_EMOJIS.map((emoji) => (
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

            <span className="hidden px-2 text-xs text-muted-foreground md:inline">/ pour un modèle</span>
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
              placeholder="Écrivez votre message…"
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
              <Button ref={helpButtonRef} type="button" variant="ghost" size="sm" disabled={disabled} aria-label="Aide à la rédaction" aria-expanded={toolsOpen} aria-controls={writingToolsId} onClick={() => setToolsOpen(open => !open)} className={cn('h-11 gap-2 px-2 md:h-8', toolsOpen && 'bg-accent')}>
                <Wand2 aria-hidden="true" />
                <span className="hidden sm:inline">Aide à la rédaction</span>
                <span className="sm:hidden">Aide</span>
              </Button>
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
                      className="h-11 w-11 px-0 aria-disabled:cursor-not-allowed aria-disabled:text-muted-foreground md:h-8 md:w-8"
                    >
                      <CalendarPlus aria-hidden="true" />
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
              <div className="whitespace-pre-wrap rounded-lg border border-border bg-card p-3 text-sm leading-relaxed text-foreground">
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
                variant="ghost"
                onClick={() => applyRewriteVariant(v)}
                className="group h-auto w-full flex-col items-stretch gap-2 whitespace-normal rounded-xl border border-border p-4 text-left font-normal hover:border-foreground"
              >
                <span className="flex items-center gap-2">
                  <span className="rounded-sm bg-muted px-2 py-0.5 text-2xs font-semibold text-foreground">{v.label}</span>
                  <span className="text-2xs text-muted-foreground">{v.text.length} caractères</span>
                  <Check className="ml-auto" aria-hidden="true" />
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
