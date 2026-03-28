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

  const attendeeId = chat.attendees?.[0]?.id;
  const cachedPicture = attendeeId ? getPicture(attendeeId) : null;
  const avatar = staticAvatar || cachedPicture || undefined;

  // Lazy-fetch picture if not available
  useEffect(() => {
    if (!staticAvatar && attendeeId && !getPicture(attendeeId)) {
      fetchPicture(attendeeId);
    }
  }, [attendeeId, staticAvatar, fetchPicture, getPicture]);

  return (
    <div className="relative group overflow-hidden">
      <button
        onClick={onClick}
        className={cn(
          "w-full p-3 flex items-start gap-3 text-left hover:bg-brutal-accent/10 transition-colors",
          isSelected && "bg-brutal-accent/15 border-l-2 border-l-foreground",
          unread && !isSelected && "bg-muted/50"
        )}
      >
        {/* Avatar with unread indicator + channel badge */}
        <div className="relative shrink-0">
          <Avatar className="w-12 h-12 rounded-none">
            <AvatarImage src={avatar} />
            <AvatarFallback className="bg-foreground/10 text-foreground font-medium rounded-none">
              {getInitials(displayName)}
            </AvatarFallback>
          </Avatar>
          {unread && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-600 flex items-center justify-center text-[9px] text-white font-bold">
              {unreadCount}
            </span>
          )}
          {/* Channel indicator */}
          <span className="absolute -bottom-0.5 -right-0.5 bg-background rounded-full p-0.5">
            <ChannelIcon channel={detectChannel(chat.account_type)} size="xs" />
          </span>
        </div>
        
        <div className="flex-1 min-w-0 overflow-hidden">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={cn(
              "text-sm truncate min-w-0",
              unread ? "font-semibold text-foreground" : "font-medium text-foreground"
            )}>
              {displayName}
            </span>
            {/* Source type badge */}
            {sourceType && (
              <span className={cn(
                "shrink-0 px-1 py-0.5 text-[8px] font-medium border uppercase tracking-wider whitespace-nowrap",
                sourceType.color
              )}>
                {sourceType.label}
              </span>
            )}
          </div>
          
          {/* Show headline or InMail subject */}
          {(headline || subject) && (
            <p className="text-[10px] text-muted-foreground truncate">
              {subject ? (
                <span className="italic">📧 {subject}</span>
              ) : (
                headline
              )}
            </p>
          )}
          
          {/* Category badge + Status info */}
          <div className="flex items-center gap-1.5 mt-0.5 overflow-hidden min-w-0">
            {categoryInfo && (
              <span className={cn(
                "inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-medium border shrink-0",
                categoryInfo.color
              )}>
                {categoryInfo.emoji} {categoryInfo.label}
              </span>
            )}
            {statusInfo && (
              <p className={cn("text-xs truncate flex items-center gap-1 min-w-0", statusInfo.color)}>
                {statusInfo.icon}
                <span className="truncate">{statusInfo.text}</span>
              </p>
            )}
            {(chat.timestamp || chat.last_message?.timestamp) && (
              <span className="text-[10px] text-muted-foreground/60 whitespace-nowrap shrink-0">
                · {formatChatTime(chat.timestamp || chat.last_message?.timestamp)}
              </span>
            )}
          </div>
        </div>
      </button>

      {/* Hover actions */}
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5">
        {/* Delete chat button */}
        {onDeleteChat && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowDeleteConfirm(true);
            }}
            className="h-6 w-6 flex items-center justify-center bg-destructive text-destructive-foreground border border-foreground/30 hover:bg-destructive/80 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
        {/* Category tag */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="h-6 w-6 flex items-center justify-center bg-background border border-foreground/30 hover:bg-muted transition-colors">
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
                className={cn("text-xs cursor-pointer", key === category && "bg-muted")}
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
