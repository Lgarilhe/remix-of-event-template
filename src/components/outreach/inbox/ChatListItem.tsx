import React, { useState } from 'react';
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
import { Tag, X } from 'lucide-react';

interface ChatListItemProps {
  chat: Chat;
  isSelected: boolean;
  enrollmentsMap: Map<string, SequenceEnrollmentInfo>;
  category: ChatCategory | null;
  onSetCategory: (chatId: string, accountId: string, category: ChatCategory | null) => void;
  onClick: () => void;
}

export const ChatListItem: React.FC<ChatListItemProps> = ({
  chat,
  isSelected,
  enrollmentsMap,
  category,
  onSetCategory,
  onClick,
}) => {
  const displayName = getChatDisplayName(chat);
  const headline = getChatHeadline(chat);
  const subject = getChatSubject(chat);
  const avatar = getChatAvatar(chat);
  const unread = hasUnread(chat);
  const unreadCount = getUnreadCount(chat);
  const statusInfo = getChatStatusInfo(chat, enrollmentsMap);
  const sourceType = getMessageSourceType(chat);
  const categoryInfo = category ? CHAT_CATEGORIES[category] : null;

  return (
    <div className="relative group">
      <button
        onClick={onClick}
        className={cn(
          "w-full p-3 flex items-start gap-3 text-left hover:bg-brutal-accent/10 transition-colors",
          isSelected && "bg-brutal-accent/15 border-l-2 border-l-foreground",
          unread && !isSelected && "bg-muted/50"
        )}
      >
        {/* Avatar with unread indicator */}
        <div className="relative shrink-0">
          <Avatar className="w-12 h-12 rounded-none">
            <AvatarImage src={avatar} />
            <AvatarFallback className="bg-foreground/10 text-foreground font-medium rounded-none">
              {getInitials(displayName)}
            </AvatarFallback>
          </Avatar>
          {unread && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-destructive flex items-center justify-center text-[9px] text-destructive-foreground font-bold">
              {unreadCount}
            </span>
          )}
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={cn(
              "text-sm truncate",
              unread ? "font-semibold text-foreground" : "font-medium text-foreground"
            )}>
              {displayName}
            </span>
            {/* Source type badge */}
            {sourceType && (
              <span className={cn(
                "shrink-0 px-1.5 py-0.5 text-[9px] font-medium border uppercase tracking-wider",
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
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {categoryInfo && (
              <span className={cn(
                "inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-medium border rounded-sm",
                categoryInfo.color
              )}>
                {categoryInfo.emoji} {categoryInfo.label}
              </span>
            )}
            {statusInfo && (
              <p className={cn("text-xs truncate flex items-center gap-1", statusInfo.color)}>
                {statusInfo.icon}
                <span>{statusInfo.text}</span>
              </p>
            )}
            {(chat.timestamp || chat.last_message?.timestamp) && (
              <span className="text-[10px] text-muted-foreground/60 whitespace-nowrap">
                · {formatChatTime(chat.timestamp || chat.last_message?.timestamp)}
              </span>
            )}
          </div>
        </div>
      </button>

      {/* Category quick action — visible on hover */}
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
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
    </div>
  );
};
