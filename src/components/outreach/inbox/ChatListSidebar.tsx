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
      "w-80 border-r border-[#1A1A1A]/10 flex flex-col",
      selectedChat && "hidden md:flex"
    )}>
      {/* Search Header */}
      <div className="p-3 border-b border-[#1A1A1A]/10 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-[#1A1A1A]">Messages</h3>
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
            className="pl-9 h-9"
          />
        </div>
        
        {/* Source filter tabs */}
        <div className="flex gap-1">
          <Button
            variant={sourceFilter === 'all' ? "default" : "outline"}
            size="sm"
            className={cn(
              "flex-1 h-7 text-[10px] px-2",
              sourceFilter === 'all' && "bg-[#0077B5] hover:bg-[#005E93]"
            )}
            onClick={() => onSourceFilterChange('all')}
          >
            Tous ({chats.length})
          </Button>
          <Button
            variant={sourceFilter === 'classic' ? "default" : "outline"}
            size="sm"
            className={cn(
              "flex-1 h-7 text-[10px] px-2",
              sourceFilter === 'classic' && "bg-slate-600 hover:bg-slate-700"
            )}
            onClick={() => onSourceFilterChange('classic')}
          >
            Classic ({classicCount})
          </Button>
          <Button
            variant={sourceFilter === 'recruiter' ? "default" : "outline"}
            size="sm"
            className={cn(
              "flex-1 h-7 text-[10px] px-2",
              sourceFilter === 'recruiter' && "bg-amber-600 hover:bg-amber-700"
            )}
            onClick={() => onSourceFilterChange('recruiter')}
          >
            Recruiter ({recruiterCount})
          </Button>
        </div>
        
        {/* Unread filter toggle */}
        <Button
          variant={showUnreadOnly ? "default" : "outline"}
          size="sm"
          className={cn(
            "w-full h-7 text-[10px] gap-2",
            showUnreadOnly && "bg-[#0077B5] hover:bg-[#005E93]"
          )}
          onClick={() => onShowUnreadOnlyChange(!showUnreadOnly)}
        >
          <Reply className="w-3 h-3" />
          Non lus uniquement
          {unreadCount > 0 && (
            <Badge variant="secondary" className={cn(
              "ml-auto h-5 px-1.5 text-[10px]",
              showUnreadOnly && "bg-white/20 text-white"
            )}>
              {unreadCount}
            </Badge>
          )}
        </Button>
      </div>

      {/* Chat List */}
      <ScrollArea className="flex-1">
        {loadingChats ? (
          <div className="p-3 space-y-3">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="w-12 h-12 rounded-full" />
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
          <div className="divide-y divide-[#1A1A1A]/5">
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
