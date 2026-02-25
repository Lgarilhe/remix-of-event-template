import React from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, MessageSquare, RefreshCw, Reply } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Chat, SequenceEnrollmentInfo } from '@/hooks/useMessagesInbox';
import { ChatListItem } from './ChatListItem';
import { isRecruiterChat, isClassicChat, hasUnread } from '@/hooks/useMessagesInboxHelpers';

interface ChatListSidebarProps {
  chats: Chat[];
  filteredChats: Chat[];
  selectedChat: Chat | null;
  loadingChats: boolean;
  searchQuery: string;
  showUnreadOnly: boolean;
  sourceFilter: 'all' | 'classic' | 'recruiter';
  enrollmentsMap: Map<string, SequenceEnrollmentInfo>;
  onSearchChange: (query: string) => void;
  onShowUnreadOnlyChange: (show: boolean) => void;
  onSourceFilterChange: (filter: 'all' | 'classic' | 'recruiter') => void;
  onChatSelect: (chat: Chat) => void;
  onRefresh: () => void;
}

export const ChatListSidebar: React.FC<ChatListSidebarProps> = ({
  chats,
  filteredChats,
  selectedChat,
  loadingChats,
  searchQuery,
  showUnreadOnly,
  sourceFilter,
  enrollmentsMap,
  onSearchChange,
  onShowUnreadOnlyChange,
  onSourceFilterChange,
  onChatSelect,
  onRefresh,
}) => {
  const classicCount = chats.filter(c => isClassicChat(c)).length;
  const recruiterCount = chats.filter(c => isRecruiterChat(c)).length;
  const unreadCount = chats.filter(c => hasUnread(c)).length;

  return (
    <div className={cn(
      "w-full md:w-80 border-r border-foreground flex flex-col flex-shrink-0 bg-background",
      selectedChat ? "hidden md:flex" : "flex"
    )}>
      {/* Search Header */}
      <div className="p-3 border-b border-foreground space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground uppercase tracking-wide text-xs">Messages</h3>
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8"
            onClick={onRefresh}
            disabled={loadingChats}
          >
            <RefreshCw className={cn("w-4 h-4", loadingChats && "animate-spin")} />
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher une conversation..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9 h-9 border-foreground rounded-none"
          />
        </div>
        
        {/* Source filter tabs — brutal style */}
        <div className="flex gap-0">
          {([
            { key: 'all' as const, label: `Tous (${chats.length})` },
            { key: 'classic' as const, label: `Classic (${classicCount})` },
            { key: 'recruiter' as const, label: `Recruiter (${recruiterCount})` },
          ]).map((tab, index) => (
            <button
              key={tab.key}
              onClick={() => onSourceFilterChange(tab.key)}
              className={cn(
                "relative overflow-hidden flex-1 h-7 text-[10px] font-medium uppercase tracking-wider border border-foreground transition-colors group",
                index > 0 && "border-l-0",
                sourceFilter === tab.key
                  ? "bg-foreground text-background"
                  : "bg-background text-foreground"
              )}
            >
              <span className="relative z-10">{tab.label}</span>
              {sourceFilter !== tab.key && (
                <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
              )}
            </button>
          ))}
        </div>
        
        {/* Unread filter toggle */}
        <button
          onClick={() => onShowUnreadOnlyChange(!showUnreadOnly)}
          className={cn(
            "relative overflow-hidden w-full h-7 text-[10px] font-medium uppercase tracking-wider border border-foreground flex items-center justify-center gap-2 transition-colors group",
            showUnreadOnly
              ? "bg-foreground text-background"
              : "bg-background text-foreground"
          )}
        >
          <Reply className="w-3 h-3 relative z-10" />
          <span className="relative z-10">Non lus uniquement</span>
          {unreadCount > 0 && (
            <span className={cn(
              "ml-1 px-1.5 py-0.5 text-[9px] font-bold min-w-[16px] text-center relative z-10",
              showUnreadOnly 
                ? "bg-background/20 text-background" 
                : "bg-destructive text-destructive-foreground rounded-full"
            )}>
              {unreadCount}
            </span>
          )}
          {!showUnreadOnly && (
            <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
          )}
        </button>
      </div>

      {/* Chat List */}
      <ScrollArea className="flex-1">
        {loadingChats ? (
          <div className="p-3 space-y-3">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="w-12 h-12 rounded-none" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredChats.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">
              {searchQuery ? 'Aucune conversation trouvée' : 'Aucune conversation'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-foreground/5">
            {filteredChats.map(chat => (
              <ChatListItem
                key={chat.id}
                chat={chat}
                isSelected={selectedChat?.id === chat.id}
                enrollmentsMap={enrollmentsMap}
                onClick={() => onChatSelect(chat)}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
};
