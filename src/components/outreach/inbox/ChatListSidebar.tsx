import React, { useState, useEffect } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

import { Search, MessageSquare, RefreshCw, Tag, ChevronDown, ArrowUpRight, ArrowDownLeft, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
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
  /** Inbox refonte Phase 1 — filter par status snooze/archive */
  statusFilter?: 'active' | 'snoozed' | 'archived' | 'all';
  statusCounts?: { active: number; snoozed: number; archived: number };
  onStatusFilterChange?: (filter: 'active' | 'snoozed' | 'archived' | 'all') => void;
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
  statusFilter = 'active',
  statusCounts = { active: 0, snoozed: 0, archived: 0 },
  onStatusFilterChange,
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

  // Mode rail collapsable — sidebar 64px (juste avatars) ou 240px (full).
  // Persisté dans localStorage pour respecter la préférence user.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('konekt_inbox_sidebar_collapsed') === '1';
  });
  useEffect(() => {
    try {
      localStorage.setItem('konekt_inbox_sidebar_collapsed', collapsed ? '1' : '0');
    } catch { /* localStorage full ou private mode */ }
  }, [collapsed]);

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
      // Width sidebar adaptative :
      //   - mobile : full width
      //   - md+ collapsed : 64px (juste avatars)
      //   - md+ expanded  : 240px (design complet)
      "h-full bg-background min-h-0 overflow-hidden flex flex-col transition-[width] duration-200 ease-out",
      collapsed ? "md:w-[64px]" : "md:w-[240px]",
      "w-full md:flex-shrink-0 md:border-r md:border-border",
      selectedChat ? "hidden md:flex" : "flex"
    )}>
      {/* Header sidebar moderne */}
      <div className={cn(
        "border-b border-border bg-background/95 backdrop-blur-sm",
        collapsed ? "px-2 py-3 space-y-2" : "px-3 pt-3 pb-2 space-y-2",
      )}>
        {/* Title + actions (refresh + toggle collapse) */}
        <div className={cn(
          "flex items-center",
          collapsed ? "justify-center flex-col gap-1" : "justify-between",
        )}>
          {!collapsed && (
            <h3 className="font-semibold text-foreground tracking-tight text-base">Messages</h3>
          )}
          <div className="flex items-center gap-0.5">
            {!collapsed && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-md"
                onClick={onRefresh}
                disabled={loadingChats}
                aria-label="Rafraîchir les messages"
              >
                <RefreshCw className={cn("w-3.5 h-3.5", loadingChats && "animate-spin")} aria-hidden="true" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-md hidden md:inline-flex"
              onClick={() => setCollapsed(!collapsed)}
              aria-label={collapsed ? "Étendre la sidebar" : "Réduire la sidebar"}
              title={collapsed ? "Étendre la sidebar" : "Réduire la sidebar"}
            >
              {collapsed ? (
                <PanelLeftOpen className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <PanelLeftClose className="w-3.5 h-3.5" aria-hidden="true" />
              )}
            </Button>
          </div>
        </div>

        {/* Search avec design moderne (masqué en mode rail) */}
        {!collapsed && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60" />
            <Input
              placeholder="Rechercher une conversation..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-9 h-9 text-[13px] bg-muted/40 border-transparent rounded-lg focus-visible:bg-background focus-visible:border-border transition-colors"
              aria-label="Rechercher dans les messages"
            />
          </div>
        )}
        
        {/* Filtres — masqués en mode rail collapsed */}
        {!collapsed && (
          <>
        <div className="flex gap-1 overflow-hidden">
          {([
            { key: 'all' as const, label: 'Tous', count: chats.length },
            { key: 'classic' as const, label: 'Classic', count: classicCount },
            { key: 'recruiter' as const, label: 'Recruiter', count: recruiterCount },
          ]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => onSourceFilterChange(tab.key)}
              className={cn(
                "flex-1 min-w-0 h-7 px-2 text-[11px] font-medium rounded-md transition-colors inline-flex items-center justify-center gap-1 whitespace-nowrap overflow-hidden",
                sourceFilter === tab.key
                  ? "bg-foreground text-background"
                  : "bg-muted/40 text-foreground hover:bg-muted"
              )}
            >
              <span className="truncate">{tab.label}</span>
              <span className={cn(
                "tabular-nums text-[10px]",
                sourceFilter === tab.key ? "opacity-70" : "opacity-50",
              )}>{tab.count}</span>
            </button>
          ))}
        </div>

        {/* Quick response filter — pills compactes */}
        <div className="flex gap-1 overflow-hidden">
          {([
            { key: 'all' as const, label: 'Tous', count: null, icon: null },
            { key: 'waiting_candidate' as const, label: 'Att. cand.', count: waitingCandidateCount, icon: <ArrowUpRight className="w-3 h-3" /> },
            { key: 'waiting_me' as const, label: 'Att. moi', count: waitingMeCount, icon: <ArrowDownLeft className="w-3 h-3" /> },
          ]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => onResponseFilterChange(tab.key)}
              className={cn(
                "flex-1 min-w-0 h-7 px-2 text-[11px] font-medium rounded-md transition-colors inline-flex items-center justify-center gap-1 whitespace-nowrap overflow-hidden",
                responseFilter === tab.key
                  ? "bg-foreground text-background"
                  : "bg-muted/40 text-foreground hover:bg-muted"
              )}
            >
              {tab.icon}
              <span className="truncate">{tab.label}</span>
              {tab.count != null && (
                <span className={cn(
                  "tabular-nums text-[10px]",
                  responseFilter === tab.key ? "opacity-70" : "opacity-50",
                )}>{tab.count}</span>
              )}
            </button>
          ))}
        </div>

        {/* Collapsible extra filters toggle */}
        <button
          onClick={() => setFiltersExpanded(!filtersExpanded)}
          className="w-full flex items-center justify-center gap-1 h-6 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <Tag className="w-3 h-3" />
          <span>Tags & filtres{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}</span>
          <ChevronDown className={cn("w-3 h-3 transition-transform", filtersExpanded && "rotate-180")} />
        </button>

        {/* Collapsible section — pills modernes cohérentes */}
        {filtersExpanded && (
          <div className="space-y-1.5 pt-0.5">
            {/* Status filter (Active / Snoozed / Archived) */}
            {onStatusFilterChange && (
              <div className="flex gap-1 overflow-hidden">
                {([
                  { key: 'active' as const, label: 'Actives', emoji: '💬' },
                  { key: 'snoozed' as const, label: 'En sommeil', emoji: '⏰' },
                  { key: 'archived' as const, label: 'Archivées', emoji: '📦' },
                  { key: 'all' as const, label: 'Toutes', emoji: '∗' },
                ]).map((opt) => {
                  const count = opt.key === 'all'
                    ? statusCounts.active + statusCounts.snoozed + statusCounts.archived
                    : statusCounts[opt.key];
                  const isActive = statusFilter === opt.key;
                  return (
                    <button
                      key={opt.key}
                      onClick={() => onStatusFilterChange(opt.key)}
                      title={opt.label}
                      className={cn(
                        "flex-1 min-w-0 h-7 px-2 text-[11px] font-medium rounded-md transition-colors inline-flex items-center justify-center gap-1 whitespace-nowrap",
                        isActive
                          ? "bg-foreground text-background"
                          : "bg-muted/40 text-foreground hover:bg-muted",
                      )}
                    >
                      <span>{opt.emoji}</span>
                      <span className={cn(
                        "tabular-nums text-[10px]",
                        isActive ? "opacity-70" : "opacity-50",
                      )}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Category filter pills */}
            <div className="flex gap-1 overflow-hidden flex-wrap">
              <button
                onClick={() => onCategoryFilterChange('all')}
                className={cn(
                  "min-w-0 h-7 px-2.5 text-[11px] font-medium rounded-md transition-colors inline-flex items-center justify-center",
                  categoryFilter === 'all'
                    ? "bg-foreground text-background"
                    : "bg-muted/40 text-foreground hover:bg-muted",
                )}
              >
                Tous
              </button>
              {(Object.entries(CHAT_CATEGORIES) as [ChatCategory, typeof CHAT_CATEGORIES[ChatCategory]][]).map(([key, info]) => {
                const isActive = categoryFilter === key;
                const count = categoryCounts[key] || 0;
                return (
                  <button
                    key={key}
                    onClick={() => onCategoryFilterChange(isActive ? 'all' : key)}
                    title={info.label}
                    className={cn(
                      "min-w-0 h-7 px-2 text-[11px] font-medium rounded-md transition-colors inline-flex items-center justify-center gap-1 whitespace-nowrap",
                      isActive
                        ? "bg-foreground text-background"
                        : "bg-muted/40 text-foreground hover:bg-muted",
                    )}
                  >
                    <span>{info.emoji}</span>
                    <span className={cn(
                      "tabular-nums text-[10px]",
                      isActive ? "opacity-70" : "opacity-50",
                    )}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Unread filter — switch moderne */}
            <button
              onClick={() => onShowUnreadOnlyChange(!showUnreadOnly)}
              className={cn(
                "w-full h-7 px-3 text-[11px] font-medium rounded-md inline-flex items-center justify-center gap-1.5 transition-colors",
                showUnreadOnly
                  ? "bg-foreground text-background"
                  : "bg-muted/40 text-foreground hover:bg-muted",
              )}
            >
              <span>Non lus uniquement</span>
              {unreadCount > 0 && (
                <span className={cn(
                  "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 text-[10px] font-bold rounded-full tabular-nums",
                  showUnreadOnly
                    ? "bg-background/20 text-background"
                    : "bg-foreground text-background",
                )}>
                  {unreadCount}
                </span>
              )}
            </button>
          </div>
        )}
          </>
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
                className="mt-3 w-full h-8 text-xs font-medium rounded-md bg-foreground text-background hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {loadingAllChats ? (
                  <><RefreshCw className="w-3 h-3 animate-spin" />Recherche en cours...</>
                ) : (
                  <><Search className="w-3 h-3" />Rechercher partout</>
                )}
              </button>
            )}
          </div>
        ) : (
          <div className="py-1 space-y-0.5">
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
                collapsed={collapsed}
              />
            ))}
            {hasMoreChats && searchQuery && onLoadAllChats && (
              <div className="p-2">
                <button
                  onClick={onLoadAllChats}
                  disabled={loadingAllChats}
                  className="w-full h-8 text-xs font-medium rounded-md bg-foreground text-background hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {loadingAllChats ? (
                    <><RefreshCw className="w-3 h-3 animate-spin" />Recherche en cours...</>
                  ) : (
                    <><Search className="w-3 h-3" />Rechercher partout</>
                  )}
                </button>
              </div>
            )}
            {hasMoreChats && !searchQuery && onLoadMoreChats && (
              <div className="p-2">
                <button
                  onClick={onLoadMoreChats}
                  disabled={loadingMoreChats}
                  className="w-full h-8 text-xs font-medium rounded-md bg-muted/40 text-foreground hover:bg-muted transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {loadingMoreChats ? (
                    <><RefreshCw className="w-3 h-3 animate-spin" />Chargement...</>
                  ) : (
                    <>Charger plus</>
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
