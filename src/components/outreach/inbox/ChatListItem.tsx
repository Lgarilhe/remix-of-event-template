/**
 * ChatListItem — Item de la sidebar de conversations.
 *
 * Design moderne inspiré de Slack / iMessage / Linear :
 *  - Avatar circulaire avec badge channel discret
 *  - Layout 3 zones : avatar | nom + preview + tags | time + unread dot
 *  - Sélection : bg-accent rounded-lg (pas de border hard)
 *  - Hover : bg-muted/50
 *  - Unread : dot indicator rond + bold nom (pas de badge rouge agressif)
 *  - Actions hover : Tag + Delete (icônes circulaires en haut à droite)
 */

import React, { useState, useEffect } from 'react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
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
import { Tag, X, Trash2, Loader2 } from 'lucide-react';
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
}

/** Récupère le texte d'aperçu du dernier message (avec préfixe "Tu:" si is_sender) */
function getLastMessagePreview(chat: Chat): string | null {
  const lm = chat.last_message;
  if (!lm) return null;
  const text = lm.text || lm.text_content || '';
  if (!text.trim()) return null;
  const cleaned = text.replace(/\s+/g, ' ').trim();
  return lm.is_sender ? `Tu : ${cleaned}` : cleaned;
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
}) => {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const { getPicture, fetchPicture } = useAttendeePicturesContext();
  const displayName = getChatDisplayName(chat);
  const headline = getChatHeadline(chat);
  const subject = getChatSubject(chat);
  const staticAvatar = getChatAvatar(chat);
  const unread = hasUnread(chat);
  const unreadCount = getUnreadCount(chat);
  const statusInfo = getChatStatusInfo(chat, enrollmentsMap);
  const sourceType = getMessageSourceType(chat);
  const categoryInfo = category ? CHAT_CATEGORIES[category] : null;
  const channel = detectChannel(chat.account_type);
  const lastMsgPreview = getLastMessagePreview(chat);
  const time = formatChatTime(chat.timestamp || chat.last_message?.timestamp);

  const attendeeId = chat.attendees?.[0]?.id;
  const cachedPicture = attendeeId ? getPicture(attendeeId) : null;
  const avatar = staticAvatar || cachedPicture || undefined;

  useEffect(() => {
    if (!staticAvatar && attendeeId && !getPicture(attendeeId)) {
      fetchPicture(attendeeId);
    }
  }, [attendeeId, staticAvatar, fetchPicture, getPicture]);

  return (
    <div className="relative group px-2">
      <button
        onClick={onClick}
        className={cn(
          'w-full px-3 py-2.5 flex items-start gap-3 text-left rounded-lg transition-all duration-150',
          isSelected
            ? 'bg-accent text-accent-foreground'
            : 'hover:bg-muted/60',
        )}
      >
        {/* Avatar circulaire avec badge channel */}
        <div className="relative shrink-0 mt-0.5">
          <Avatar className={cn(
            'w-11 h-11 rounded-full',
            isSelected ? 'ring-2 ring-accent-foreground/10' : 'ring-1 ring-border/40',
          )}>
            <AvatarImage src={avatar} className="rounded-full" />
            <AvatarFallback className="bg-gradient-to-br from-foreground/15 to-foreground/5 text-foreground font-semibold rounded-full text-sm">
              {getInitials(displayName)}
            </AvatarFallback>
          </Avatar>
          {/* Badge channel en bas-right */}
          <span className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-background grid place-items-center ring-1 ring-border">
            <ChannelIcon channel={channel} size="xs" />
          </span>
        </div>

        {/* Texte central */}
        <div className="flex-1 min-w-0 overflow-hidden">
          {/* Ligne 1 : nom + time */}
          <div className="flex items-center justify-between gap-2 min-w-0">
            <span
              className={cn(
                'text-sm truncate min-w-0 tracking-tight',
                unread ? 'font-semibold text-foreground' : 'font-medium text-foreground/90',
              )}
            >
              {displayName}
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              {time && (
                <span
                  className={cn(
                    'text-[11px] tabular-nums whitespace-nowrap',
                    unread ? 'text-foreground font-medium' : 'text-muted-foreground/70',
                  )}
                >
                  {time}
                </span>
              )}
            </div>
          </div>

          {/* Ligne 2 : preview du dernier message OU headline en fallback */}
          {lastMsgPreview ? (
            <p
              className={cn(
                'text-[13px] truncate mt-0.5 leading-snug',
                unread ? 'text-foreground/80 font-medium' : 'text-muted-foreground',
              )}
            >
              {lastMsgPreview}
            </p>
          ) : headline ? (
            <p className="text-[12px] text-muted-foreground truncate mt-0.5 leading-snug">
              {headline}
            </p>
          ) : subject ? (
            <p className="text-[12px] text-muted-foreground italic truncate mt-0.5">
              📧 {subject}
            </p>
          ) : null}

          {/* Ligne 3 : badges (source type, catégorie, status, unread count) */}
          <div className="flex items-center gap-1.5 mt-1.5 overflow-hidden min-w-0">
            {sourceType && (
              <span
                className={cn(
                  'shrink-0 inline-flex items-center px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider rounded',
                  sourceType.color,
                )}
              >
                {sourceType.label}
              </span>
            )}
            {categoryInfo && (
              <span
                className={cn(
                  'shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded',
                  categoryInfo.color,
                )}
              >
                <span>{categoryInfo.emoji}</span>
                <span>{categoryInfo.label}</span>
              </span>
            )}
            {statusInfo && (
              <p
                className={cn(
                  'text-[11px] truncate flex items-center gap-1 min-w-0 leading-tight',
                  statusInfo.color,
                )}
              >
                {statusInfo.icon}
                <span className="truncate">{statusInfo.text}</span>
              </p>
            )}
            {/* Unread dot indicator (au lieu d'un gros badge rouge) */}
            {unread && (
              <span className="ml-auto shrink-0 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 text-[10px] font-bold bg-foreground text-background rounded-full tabular-nums">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </div>
        </div>
      </button>

      {/* Hover actions (en haut à droite) */}
      <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 z-10">
        {onDeleteChat && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowDeleteConfirm(true);
            }}
            className="h-7 w-7 grid place-items-center bg-background/95 backdrop-blur border border-border hover:border-destructive hover:text-destructive transition-colors rounded-md shadow-sm"
            aria-label="Supprimer"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="h-7 w-7 grid place-items-center bg-background/95 backdrop-blur border border-border hover:bg-muted transition-colors rounded-md shadow-sm"
              aria-label="Catégoriser"
            >
              <Tag className="w-3 h-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[160px]">
            {(Object.entries(CHAT_CATEGORIES) as [ChatCategory, typeof CHAT_CATEGORIES[ChatCategory]][]).map(([key, info]) => (
              <DropdownMenuItem
                key={key}
                onClick={(e) => {
                  e.stopPropagation();
                  onSetCategory(chat.id, chat.account_id, key === category ? null : key);
                }}
                className={cn('text-xs cursor-pointer', key === category && 'bg-muted')}
              >
                <span className="mr-2">{info.emoji}</span>
                {info.label}
                {key === category && <span className="ml-auto text-muted-foreground">✓</span>}
              </DropdownMenuItem>
            ))}
            {category && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onSetCategory(chat.id, chat.account_id, null);
                  }}
                  className="text-xs cursor-pointer text-muted-foreground"
                >
                  <X className="w-3 h-3 mr-2" />
                  Retirer le tag
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette conversation ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. La conversation sera définitivement supprimée.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeletingChat}
              className="bg-destructive hover:bg-destructive/90"
              onClick={async () => {
                if (onDeleteChat) {
                  await onDeleteChat(chat.id);
                  setShowDeleteConfirm(false);
                }
              }}
            >
              {isDeletingChat ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
