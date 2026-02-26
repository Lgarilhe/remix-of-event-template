import React from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { BrutalLoader } from '@/components/ui/brutal-loader';
import { Search, MessageSquare, RefreshCw, Reply, Tag, Sparkles, Clock, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
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
  onAutoTag: () => void;
  autoTagging: boolean;
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
  onAutoTag,
  autoTagging,
  onChatSelect,
  onRefresh,
}) => {
  const classicCount = chats.filter(c => isClassicChat(c)).length;
  const recruiterCount = chats.filter(c => isRecruiterChat(c)).length;
  const unreadCount = chats.filter(c => hasUnread(c)).length;
  const waitingCandidateCount = chats.filter(c => !hasUnread(c)).length;
  const waitingMeCount = chats.filter(c => hasUnread(c)).length;

  // Count categories
  const categoryCounts = {
    interested: 0,
    not_interested: 0,
    to_recontact: 0,
    no_response: 0,
  };
  chats.forEach(c => {
    const cat = categoriesMap.get(c.id);
    if (cat && cat in categoryCounts) categoryCounts[cat as ChatCategory]++;
  });

  return (
    <div className={cn(
      "w-full md:w-80 border-r border-foreground flex flex-col flex-shrink-0 bg-background min-h-0",
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

        {/* Category filter pills */}
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => onCategoryFilterChange('all')}
            className={cn(
              "h-6 px-2 text-[9px] font-medium uppercase tracking-wider border transition-colors",
              categoryFilter === 'all'
                ? "bg-foreground text-background border-foreground"
                : "bg-background text-foreground border-foreground/30 hover:border-foreground"
            )}
          >
            <Tag className="w-2.5 h-2.5 inline mr-1" />
            Tous
          </button>
          {(Object.entries(CHAT_CATEGORIES) as [ChatCategory, typeof CHAT_CATEGORIES[ChatCategory]][]).map(([key, info]) => (
            <button
              key={key}
              onClick={() => onCategoryFilterChange(categoryFilter === key ? 'all' : key)}
              className={cn(
                "h-6 px-2 text-[9px] font-medium border transition-colors",
                categoryFilter === key
                  ? cn("border-foreground", info.color)
                  : "bg-background text-foreground border-foreground/30 hover:border-foreground"
              )}
            >
              {info.emoji} {categoryCounts[key] || 0}
            </button>
          ))}
          <button
            onClick={onAutoTag}
            disabled={autoTagging}
            className={cn(
              "h-6 px-2 text-[9px] font-medium uppercase tracking-wider border transition-colors flex items-center gap-1",
              autoTagging
                ? "bg-foreground text-background border-foreground animate-pulse"
                : "bg-background text-foreground border-foreground/30 hover:border-foreground hover:bg-accent"
            )}
            title="Auto-catégoriser les 100 dernières conversations avec l'IA"
          >
            <Sparkles className="w-2.5 h-2.5" />
            {autoTagging ? 'Analyse...' : 'Auto-tag'}
          </button>
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

        {/* Response status filter */}
        <div className="flex gap-0">
          {([
            { key: 'all' as const, label: 'Tous', icon: <Clock className="w-3 h-3 relative z-10" /> },
            { key: 'waiting_candidate' as const, label: `Att. candidat (${waitingCandidateCount})`, icon: <ArrowUpRight className="w-3 h-3 relative z-10" /> },
            { key: 'waiting_me' as const, label: `Att. moi (${waitingMeCount})`, icon: <ArrowDownLeft className="w-3 h-3 relative z-10" /> },
          ]).map((tab, index) => (
            <button
              key={tab.key}
              onClick={() => onResponseFilterChange(tab.key)}
              className={cn(
                "relative overflow-hidden flex-1 h-7 text-[10px] font-medium uppercase tracking-wider border border-foreground transition-colors group flex items-center justify-center gap-1",
                index > 0 && "border-l-0",
                responseFilter === tab.key
                  ? "bg-foreground text-background"
                  : "bg-background text-foreground"
              )}
            >
              {tab.icon}
              <span className="relative z-10">{tab.label}</span>
              {responseFilter !== tab.key && (
                <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Chat List */}
      <ScrollArea className="flex-1 min-h-0">
        {loadingChats ? (
          <div className="p-3">
            <BrutalLoader compact messages={['Chargement des messages…', 'Synchronisation inbox…', 'Récupération des conversations…']} />
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
                category={categoriesMap.get(chat.id) || null}
                onSetCategory={onSetCategory}
                onClick={() => onChatSelect(chat)}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
};
