/**
 * ChatListItem — une conversation dans la liste de la messagerie.
 *
 * - Avatar (initiales neutres en repli) et pastille du canal.
 * - Nom, étiquette (posée à la main, sinon l'intention lue par l'IA) et heure.
 * - Aperçu et non-lus : « Vous : » devant vos messages, « Brouillon : » quand
 *   un texte attend d'être envoyé (revue design D-10, D-17).
 * - Repères dans un ordre fixe (D-07) : sommeil ou archive, « À répondre » ou
 *   « En attente », puis la mission de l'inscription (à défaut, la boîte
 *   d'origine, en texte neutre).
 * - Actions (étiquette, suppression) dans un menu : toujours visible au doigt,
 *   au survol ou au focus clavier à la souris (D-03, D-12).
 */

import React, { useState, useEffect } from 'react';
import { AlarmClock, Archive, Briefcase, Hourglass, MoreHorizontal, Reply, Trash2 } from 'lucide-react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Chat, SequenceEnrollmentInfo } from '@/hooks/useMessagesInbox';
import { ChatCategory, CHAT_CATEGORIES } from '@/hooks/useChatCategories';
import {
  getChatDisplayName,
  getChatHeadline,
  getChatSubject,
  getChatAvatar,
  hasUnread,
  getUnreadCount,
  getInitials,
  getChatStatusInfo,
  getMessageSourceType,
  formatChatTime,
} from '@/hooks/useMessagesInboxHelpers';
import { IntentInfo, INTENT_META } from '@/hooks/useChatIntents';
import { useChatStatus } from '@/hooks/useChatStatus';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAttendeePicturesContext } from '@/contexts/AttendeePicturesContext';
import { ChannelIcon, detectChannel } from '@/components/ui/ChannelIcon';

interface ChatListItemProps {
  chat: Chat;
  isSelected: boolean;
  enrollmentsMap: Map<string, SequenceEnrollmentInfo>;
  category: ChatCategory | null;
  onSetCategory: (chatId: string, accountId: string, category: ChatCategory | null) => void;
  onClick: () => void;
  onDeleteChat?: (chatId: string) => Promise<boolean>;
  isDeletingChat?: boolean;
  /** Liste repliée (colonne de 64 px) : avatar et pastille de non-lus seulement. */
  collapsed?: boolean;
  /** Intention lue par l'IA pour ce chat (cache des analyses) */
  intent?: IntentInfo;
  /** Brouillon enregistré pour cette conversation, s'il y en a un. */
  draft?: string | null;
}

// Cible de 44 px au doigt dans les menus (01-direction.md, § 5).
const MENU_ITEM = 'min-h-11 md:min-h-0';

const CATEGORY_ENTRIES = Object.entries(CHAT_CATEGORIES) as [ChatCategory, (typeof CHAT_CATEGORIES)[ChatCategory]][];

/** Dernier message, sans les retours à la ligne ; « mine » : envoyé par vous. */
function getLastMessagePreview(chat: Chat): { mine: boolean; text: string } | null {
  const lm = chat.last_message;
  if (!lm) return null;
  const text = (lm.text || lm.text_content || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return { mine: lm.is_sender === true, text };
}

const hourLabel = (date: Date) =>
  `${date.getHours()} h${date.getMinutes() ? ` ${date.getMinutes().toString().padStart(2, '0')}` : ''}`;

/** Fin de la mise en sommeil : « dans 45 min », « 18 h », « demain 9 h », « vendredi 9 h », « 5 mai ». */
function formatSnoozeUntil(date: Date): string {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffMin = Math.round(diffMs / 60000);
  const diffHours = Math.round(diffMs / 3600000);
  const diffDays = Math.round(diffMs / 86400000);

  if (diffMin < 60) return `dans ${diffMin} min`;
  if (diffHours < 24) {
    if (date.getDate() === now.getDate()) return hourLabel(date);
    return `dans ${diffHours} h`;
  }
  if (diffDays === 1) return `demain ${hourLabel(date)}`;
  if (diffDays < 7) return `${date.toLocaleDateString('fr-FR', { weekday: 'long' })} ${hourLabel(date)}`;
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

/** Date d'archivage : « aujourd'hui », « hier », « il y a 3 jours », « il y a 2 semaines », « 5 mars ». */
function formatArchivedAt(date: Date): string {
  const diffDays = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (diffDays <= 0) return "aujourd'hui";
  if (diffDays === 1) return 'hier';
  if (diffDays < 7) return `il y a ${diffDays} jours`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `il y a ${weeks} semaine${weeks > 1 ? 's' : ''}`;
  }
  return `le ${date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`;
}

export const ChatListItem: React.FC<ChatListItemProps> = ({
  chat,
  isSelected,
  enrollmentsMap,
  category,
  onSetCategory,
  onClick,
  onDeleteChat,
  isDeletingChat,
  collapsed = false,
  intent,
  draft,
}) => {
  const intentMeta = intent ? INTENT_META[intent.intent] : null;

  // Mise en sommeil et archive : repères de la ligne
  const { getSnoozedUntil, getArchivedAt } = useChatStatus();
  const snoozedUntil = getSnoozedUntil(chat.id);
  const archivedAt = getArchivedAt(chat.id);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const { getPicture, fetchPicture } = useAttendeePicturesContext();
  const displayName = getChatDisplayName(chat);
  const headline = getChatHeadline(chat);
  const subject = getChatSubject(chat);
  const staticAvatar = getChatAvatar(chat);
  const unread = hasUnread(chat);
  const unreadCount = getUnreadCount(chat);
  const statusInfo = getChatStatusInfo(chat, enrollmentsMap);
  const source = getMessageSourceType(chat);
  const categoryInfo = category ? CHAT_CATEGORIES[category] : null;
  const channel = detectChannel(chat.account_type);
  const preview = getLastMessagePreview(chat);
  const time = formatChatTime(chat.timestamp || chat.last_message?.timestamp);
  const draftText = !isSelected && draft?.trim() ? draft.replace(/\s+/g, ' ').trim() : null;

  const attendeeId = chat.attendees?.[0]?.id;
  const cachedPicture = attendeeId ? getPicture(attendeeId) : null;
  const avatar = staticAvatar || cachedPicture || undefined;

  useEffect(() => {
    if (!staticAvatar && attendeeId && !getPicture(attendeeId)) {
      fetchPicture(attendeeId);
    }
  }, [attendeeId, staticAvatar, fetchPicture, getPicture]);

  const unreadLabel = unreadCount > 1 ? `${unreadCount} messages non lus` : '1 message non lu';

  // ─── Liste repliée : avatar et pastille de non-lus ───────────────────
  if (collapsed) {
    return (
      <div className="px-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              onClick={onClick}
              aria-current={isSelected ? 'true' : undefined}
              aria-label={unread ? `${displayName}, ${unreadLabel}` : displayName}
              className={cn('h-auto w-full p-1.5', isSelected && 'bg-accent')}
            >
              <span className="relative shrink-0">
                <Avatar className={cn('h-9 w-9', isSelected && 'ring-2 ring-brand')}>
                  <AvatarImage src={avatar} alt="" />
                  <AvatarFallback className="text-xs font-semibold text-foreground-secondary">
                    {getInitials(displayName)}
                  </AvatarFallback>
                </Avatar>
                {unread && (
                  <span
                    aria-hidden="true"
                    className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-3xs font-semibold tabular-nums text-brand-foreground ring-2 ring-background"
                  >
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{displayName}</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  // Repère d'état, en tête de la troisième ligne
  let state: React.ReactNode = null;
  if (snoozedUntil) {
    state = (
      <span
        className="inline-flex shrink-0 items-center gap-1 text-muted-foreground"
        title={`En sommeil jusqu'au ${snoozedUntil.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
      >
        <AlarmClock className="h-3 w-3" aria-hidden="true" />
        Réveil {formatSnoozeUntil(snoozedUntil)}
      </span>
    );
  } else if (archivedAt) {
    state = (
      <span className="inline-flex shrink-0 items-center gap-1 text-muted-foreground">
        <Archive className="h-3 w-3" aria-hidden="true" />
        Archivée {formatArchivedAt(archivedAt)}
      </span>
    );
  } else if (statusInfo?.kind === 'reply') {
    state = (
      <span className="inline-flex shrink-0 items-center gap-1 font-medium text-brand">
        <Reply className="h-3 w-3" aria-hidden="true" />À répondre
      </span>
    );
  } else if (statusInfo?.kind === 'waiting') {
    state = (
      <span className="inline-flex shrink-0 items-center gap-1 text-muted-foreground">
        <Hourglass className="h-3 w-3" aria-hidden="true" />
        En attente
      </span>
    );
  }

  // L'étiquette posée à la main l'emporte sur l'intention lue par l'IA. Faute
  // de place, elle se tronque avant le nom (shrink-[3]).
  const tag = categoryInfo ? (
    <Badge variant={categoryInfo.tone} className="min-w-0 shrink-[3] px-1.5 py-0 text-2xs">
      <span className="truncate">{categoryInfo.label}</span>
    </Badge>
  ) : intentMeta ? (
    <Badge variant={intentMeta.tone} className="min-w-0 shrink-[3] px-1.5 py-0 text-2xs" title={intent?.summary || undefined}>
      <span className="truncate">{intentMeta.label}</span>
    </Badge>
  ) : null;

  // Troisième ligne : l'état, puis la mission ; à défaut de mission, la boîte d'origine.
  const hasMeta = !!state || !!statusInfo?.mission || !!source;

  const previewLine = draftText ? (
    <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
      <span className="font-medium text-foreground">Brouillon : </span>
      {draftText}
    </span>
  ) : preview ? (
    <span className={cn('min-w-0 flex-1 truncate text-sm', unread ? 'font-medium text-foreground' : 'text-muted-foreground')}>
      {preview.mine && <span className="font-normal text-muted-foreground">Vous : </span>}
      {preview.text}
    </span>
  ) : headline ? (
    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{headline}</span>
  ) : subject ? (
    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">Objet : {subject}</span>
  ) : (
    <span className="flex-1" />
  );

  return (
    <div className="group relative px-1.5">
      <button
        type="button"
        onClick={onClick}
        aria-current={isSelected ? 'true' : undefined}
        className={cn(
          'relative flex w-full min-w-0 items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          // Au doigt, le menu d'actions reste affiché : sa place est réservée.
          '[@media(hover:none)]:pr-12',
          isSelected ? 'bg-accent' : 'hover:bg-accent',
        )}
      >
        {isSelected && <span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-brand" />}

        {/* Avatar et pastille du canal */}
        <span className="relative shrink-0">
          <Avatar className="h-10 w-10">
            <AvatarImage src={avatar} alt="" />
            <AvatarFallback className="text-xs font-semibold text-foreground-secondary">
              {getInitials(displayName)}
            </AvatarFallback>
          </Avatar>
          <span
            aria-hidden="true"
            className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full bg-background ring-1 ring-border"
          >
            <ChannelIcon channel={channel} size="xs" />
          </span>
        </span>

        <span className="min-w-0 flex-1">
          {/* Nom, étiquette et heure */}
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={cn('min-w-0 truncate text-sm text-foreground', unread ? 'font-semibold' : 'font-medium')}>
              {displayName}
            </span>
            {tag}
            {time && (
              <span
                className={cn(
                  'ml-auto shrink-0 whitespace-nowrap pl-1 text-2xs tabular-nums',
                  unread ? 'font-medium text-foreground' : 'text-muted-foreground',
                )}
              >
                {time}
              </span>
            )}
          </span>

          {/* Aperçu (brouillon en cours, dernier message, sinon le titre du profil) et non-lus */}
          <span className="mt-0.5 flex min-w-0 items-center gap-2">
            {previewLine}
            {unread && (
              <span className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-brand px-1 text-3xs font-semibold tabular-nums text-brand-foreground">
                <span aria-hidden="true">{unreadCount > 99 ? '99+' : unreadCount}</span>
                <span className="sr-only">{unreadLabel}</span>
              </span>
            )}
          </span>

          {/* Repères : état, puis mission (ou boîte d'origine) */}
          {hasMeta && (
            <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs">
              {state}
              {statusInfo?.mission ? (
                <span className="inline-flex min-w-0 items-center gap-1 text-foreground-secondary">
                  <Briefcase className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">{statusInfo.mission}</span>
                </span>
              ) : source ? (
                <span className="min-w-0 truncate text-muted-foreground">{source.label}</span>
              ) : null}
            </span>
          )}
        </span>
      </button>

      {/* Actions de la ligne : visibles au doigt, au survol et au focus clavier */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Actions pour la conversation avec ${displayName}`}
                className={cn(
                  'absolute right-3 top-1/2 h-11 w-11 -translate-y-1/2 text-muted-foreground hover:text-foreground',
                  '[@media(hover:hover)]:h-8 [@media(hover:hover)]:w-8 [@media(hover:hover)]:bg-accent',
                  '[@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100',
                )}
              >
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Actions</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Étiquette</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={category ?? 'none'}
            onValueChange={(value) =>
              onSetCategory(chat.id, chat.account_id, value === 'none' ? null : (value as ChatCategory))
            }
          >
            {CATEGORY_ENTRIES.map(([key, info]) => (
              <DropdownMenuRadioItem key={key} value={key} className={MENU_ITEM}>
                {info.label}
              </DropdownMenuRadioItem>
            ))}
            <DropdownMenuRadioItem value="none" className={MENU_ITEM}>
              Sans étiquette
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          {onDeleteChat && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className={cn(MENU_ITEM, 'text-destructive focus:text-destructive')}
                onSelect={() => setShowDeleteConfirm(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                Supprimer la conversation
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette conversation ?</AlertDialogTitle>
            <AlertDialogDescription>
              La conversation avec {displayName} sera supprimée de votre messagerie LinkedIn. Cette action est
              irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeletingChat}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (onDeleteChat) {
                  await onDeleteChat(chat.id);
                  setShowDeleteConfirm(false);
                }
              }}
            >
              Supprimer la conversation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
