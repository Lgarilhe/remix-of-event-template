import React from 'react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { Chat, SequenceEnrollmentInfo } from '@/hooks/useMessagesInbox';
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

interface ChatListItemProps {
  chat: Chat;
  isSelected: boolean;
  enrollmentsMap: Map<string, SequenceEnrollmentInfo>;
  onClick: () => void;
}

export const ChatListItem: React.FC<ChatListItemProps> = ({
  chat,
  isSelected,
  enrollmentsMap,
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

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full p-3 flex items-start gap-3 text-left hover:bg-[#1A1A1A]/3 transition-colors",
        isSelected && "bg-[#0077B5]/5",
        unread && "bg-[#0077B5]/3"
      )}
    >
      {/* Avatar with unread indicator */}
      <div className="relative shrink-0">
        <Avatar className="w-12 h-12">
          <AvatarImage src={avatar} />
          <AvatarFallback className="bg-[#0077B5]/10 text-[#0077B5] font-medium">
            {getInitials(displayName)}
          </AvatarFallback>
        </Avatar>
        {unread && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-[#0077B5] rounded-full flex items-center justify-center text-[9px] text-white font-bold">
            {unreadCount}
          </span>
        )}
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={cn(
              "text-sm truncate",
              unread ? "font-semibold text-[#1A1A1A]" : "font-medium text-[#1A1A1A]"
            )}>
              {displayName}
            </span>
            {/* Source type badge */}
            {sourceType && (
              <span className={cn(
                "shrink-0 px-1.5 py-0.5 text-[9px] font-medium rounded border",
                sourceType.color
              )}>
                {sourceType.label}
              </span>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground shrink-0">
            {formatChatTime(chat.timestamp)}
          </span>
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
        
        {/* Status info */}
        {statusInfo && (
          <p className={cn("text-xs truncate mt-0.5 flex items-center gap-1", statusInfo.color)}>
            {statusInfo.icon}
            <span>{statusInfo.text}</span>
          </p>
        )}
      </div>
    </button>
  );
};
