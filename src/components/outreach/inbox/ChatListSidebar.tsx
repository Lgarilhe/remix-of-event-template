import React, { useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

import { Search, MessageSquare, RefreshCw, Tag, ChevronDown, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Chat, SequenceEnrollmentInfo } from '@/hooks/useMessagesInbox';
import { ChatListItem } from './ChatListItem';
import { isRecruiterChat, isClassicChat, hasUnread } from '@/hooks/useMessagesInboxHelpers';
import { ChatCategory, CHAT_CATEGORIES } from '@/hooks/useChatCategories';

interface ChatListSidebarProps {
  chats: Chat[];
  filteredChats: Chat[];
  selectedChat: Chat | null;
  loadingChats: boolean;
  searchQuery: string;
  showUnreadOnly: boolean;
  sourceFilter: 'all' | 'classic' | 'recruiter';
  categoryFilter: ChatCategory | 'all';
  responseFilter: 'all' | 'waiting_candidate' | 'waiting_me';
  enrollmentsMap: Map<string, SequenceEnrollmentInfo>;
  categoriesMap: Map<string, ChatCategory>;
  onSearchChange: (query: string) => void;
  onShowUnreadOnlyChange: (show: boolean) => void;
  onSourceFilterChange: (filter: 'all' | 'classic' | 'recruiter') => void;
  onCategoryFilterChange: (filter: ChatCategory | 'all') => void;
  onResponseFilterChange: (filter: 'all' | 'waiting_candidate' | 'waiting_me') => void;
  onSetCategory: (chatId: string, accountId: string, category: ChatCategory | null) => void;
  onChatSelect: (chat: Chat) => void;
  onRefresh: () => void;
  hasMoreChats?: boolean;
  loadingMoreChats?: boolean;
  loadingAllChats?: boolean;
  onLoadMoreChats?: () => void;
  onLoadAllChats?: () => void;
  onDeleteChat?: (chatId: string) => Promise<boolean>;
  isDeletingChat?: boolean;
}

export const ChatListSidebar: React.FC<ChatListSidebarProps> = ({
  chats,
  filteredChats,
  selectedChat,
  loadingChats,
  searchQuery,
  showUnreadOnly,
  sourceFilter,
  categoryFilter,
  responseFilter,
  enrollmentsMap,
  categoriesMap,
  onSearchChange,
  onShowUnreadOnlyChange,
  onSourceFilterChange,
  onCategoryFilterChange,
  onResponseFilterChange,
  onSetCategory,
  onChatSelect,
  onRefresh,
  hasMoreChats = false,
  loadingMoreChats = false,
  loadingAllChats = false,
  onLoadMoreChats,
  onLoadAllChats,
  onDeleteChat,
  isDeletingChat,
}) => {
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  const classicCount = chats.filter(c => isClassicChat(c)).length;
  const recruiterCount = chats.filter(c => isRecruiterChat(c)).length;
  const unreadCount = chats.filter(c => hasUnread(c)).length;
  const waitingCandidateCount = chats.filter(c => c.last_message?.is_sender === true).length;
  const waitingMeCount = chats.filter(c => c.last_message?.is_sender === false).length;

  // Count categories from the full DB map (not just loaded chats) for accurate counters
  const categoryCounts = {
    interested: 0,
    not_interested: 0,
    to_recontact: 0,
    no_response: 0,
  };
  categoriesMap.forEach((cat) => {
    if (cat in categoryCounts) categoryCounts[cat as ChatCategory]++;
  });

  // Count active filters
  const activeFilterCount = [
    sourceFilter !== 'all',
    categoryFilter !== 'all',
    responseFilter !== 'all',
    showUnreadOnly,
  ].filter(Boolean).length;

  return (
    <div className={cn(
      "w-full md:w-80 border-r border-foreground flex flex-col flex-shrink-0 bg-background min-h-0 overflow-x-hidden",
      selectedChat ? "hidden md:flex" : "flex"
    )}>
      {/* Compact Header */}
      <div className="p-2 border-b border-foreground space-y-1.5">
        {/* Title + refresh */}
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground uppercase tracking-wide text-xs">Messages</h3>
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-6 w-6"
            onClick={onRefresh}
            disabled={loadingChats}
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loadingChats && "animate-spin")} />
          </Button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Rechercher..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-8 h-7 text-xs border-foreground rounded-none"
          />
        </div>
        
        {/* Source filter — always visible, compact */}
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
                "flex-1 h-6 text-xs font-medium uppercase tracking-wider border border-foreground transition-colors",
                index > 0 && "border-l-0",
                sourceFilter === tab.key
                  ? "bg-foreground text-background"
                  : "bg-background text-foreground hover:bg-accent"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Quick response filter — always visible */}
        <div className="flex gap-0">
          {([
            { key: 'all' as const, label: 'Tous' },
            { key: 'waiting_candidate' as const, label: `Att. cand. (${waitingCandidateCount})`, icon: <ArrowUpRight className="w-2.5 h-2.5" /> },
            { key: 'waiting_me' as const, label: `Att. moi (${waitingMeCount})`, icon: <ArrowDownLeft className="w-2.5 h-2.5" /> },
          ]).map((tab, index) => (
            <button
              key={tab.key}
              onClick={() => onResponseFilterChange(tab.key)}
              className={cn(
                "flex-1 h-6 text-xs font-medium uppercase tracking-wider border border-foreground transition-colors flex items-center justify-center gap-0.5",
                index > 0 && "border-l-0",
                responseFilter === tab.key
                  ? "bg-foreground text-background"
                  : "bg-background text-foreground hover:bg-accent"
              )}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Collapsible extra filters toggle */}
        <button
          onClick={() => setFiltersExpanded(!filtersExpanded)}
          className="w-full flex items-center justify-center gap-1 h-5 text-xs text-muted-foreground hover:text-foreground transition-colors uppercase tracking-wider"
        >
          <Tag className="w-2.5 h-2.5" />
          <span>Tags & filtres{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}</span>
          <ChevronDown className={cn("w-2.5 h-2.5 transition-transform", filtersExpanded && "rotate-180")} />
        </button>

        {/* Collapsible section */}
        {filtersExpanded && (
          <div className="space-y-1.5 pt-0.5">
            {/* Category filter pills */}
            <div className="flex gap-0">
              <button
                onClick={() => onCategoryFilterChange('all')}
                className={cn(
                  "flex-1 h-6 px-1.5 text-xs font-medium uppercase tracking-wider border transition-colors",
                  categoryFilter === 'all'
                    ? "bg-foreground text-background border-foreground"
                    : "bg-background text-foreground border-foreground/30 hover:border-foreground"
                )}
              >
                Tous
              </button>
              {(Object.entries(CHAT_CATEGORIES) as [ChatCategory, typeof CHAT_CATEGORIES[ChatCategory]][]).map(([key, info], index) => (
                <button
                  key={key}
                  onClick={() => onCategoryFilterChange(categoryFilter === key ? 'all' : key)}
                  className={cn(
                    "flex-1 h-6 px-1.5 text-xs font-medium border border-l-0 transition-colors",
                    categoryFilter === key
                      ? cn("border-foreground", info.color)
                      : "bg-background text-foreground border-foreground/30 hover:border-foreground"
                  )}
                >
                  {info.emoji} {categoryCounts[key] || 0}
                </button>
              ))}
            </div>
            
            {/* Unread filter */}
            <button
              onClick={() => onShowUnreadOnlyChange(!showUnreadOnly)}
              className={cn(
                "w-full h-5 text-xs font-medium uppercase tracking-wider border border-foreground flex items-center justify-center gap-1 transition-colors",
                showUnreadOnly
                  ? "bg-foreground text-background"
                  : "bg-background text-foreground hover:bg-accent"
              )}
            >
              <span>Non lus uniquement</span>
              {unreadCount > 0 && (
                <span className={cn(
                  "px-1 text-[8px] font-bold min-w-[14px] text-center",
                  showUnreadOnly 
                    ? "bg-background/20 text-background" 
                    : "bg-destructive text-destructive-foreground rounded-full"
                )}>
                  {unreadCount}
                </span>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Chat List */}
      <ScrollArea className="flex-1 min-h-0">
        {loadingChats ? (
          <div className="p-2 space-y-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-3 animate-pulse" style={{ animationDelay: `${i * 80}ms` }}>
                <div className="h-9 w-9 rounded-full bg-muted flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 bg-muted rounded w-3/5" />
                  <div className="h-2.5 bg-muted/60 rounded w-4/5" />
                </div>
                <div className="h-2.5 bg-muted/40 rounded w-8 flex-shrink-0" />
              </div>
            ))}
          </div>
        ) : filteredChats.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">
              {searchQuery ? 'Aucune conversation trouvée' : 'Aucune conversation'}
            </p>
            {searchQuery && hasMoreChats && onLoadAllChats && (
              <button
                onClick={onLoadAllChats}
                disabled={loadingAllChats}
                className="mt-3 w-full h-7 text-xs font-medium uppercase tracking-wider border border-foreground bg-foreground text-background hover:bg-foreground/80 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {loadingAllChats ? (
                  <><RefreshCw className="w-3 h-3 animate-spin" />Recherche en cours...</>
                ) : (
                  <><Search className="w-3 h-3" />Rechercher dans tout l'inbox</>
                )}
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-foreground/5">
            {filteredChats.map(chat => (
              <ChatListItem
                key={chat.id}
                chat={chat}
                isSelected={selectedChat?.id === chat.id}
                enrollmentsMap={enrollmentsMap}
                category={categoriesMap.get(chat.id) || null}
                onSetCategory={onSetCategory}
                onClick={() => onChatSelect(chat)}
                onDeleteChat={onDeleteChat}
                isDeletingChat={isDeletingChat}
              />
            ))}
            {hasMoreChats && searchQuery && onLoadAllChats && (
              <div className="p-2">
                <button
                  onClick={onLoadAllChats}
                  disabled={loadingAllChats}
                  className="w-full h-7 text-xs font-medium uppercase tracking-wider border border-foreground bg-foreground text-background hover:bg-foreground/80 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {loadingAllChats ? (
                    <><RefreshCw className="w-3 h-3 animate-spin" />Recherche en cours...</>
                  ) : (
                    <><Search className="w-3 h-3" />Rechercher dans tout l'inbox</>
                  )}
                </button>
              </div>
            )}
            {hasMoreChats && !searchQuery && onLoadMoreChats && (
              <div className="p-2">
                <button
                  onClick={onLoadMoreChats}
                  disabled={loadingMoreChats}
                  className="w-full h-7 text-xs font-medium uppercase tracking-wider border border-foreground bg-background text-foreground hover:bg-foreground hover:text-background transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {loadingMoreChats ? (
                    <><RefreshCw className="w-3 h-3 animate-spin" />Chargement...</>
                  ) : (
                    <>Charger plus de conversations</>
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
};
