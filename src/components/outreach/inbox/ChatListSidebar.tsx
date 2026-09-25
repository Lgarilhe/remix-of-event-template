/**
 * ChatListSidebar — colonne des conversations de la messagerie.
 *
 * Trois rangées avant la première conversation (revue design D-05, D-06) :
 * le titre, la recherche avec le bouton « Filtres », puis le tri visible
 * « Toutes / À répondre / En attente » (SegmentedControl, aria-pressed). Le
 * statut (sommeil, archive), l'étiquette, la boîte d'origine et les non-lus
 * sont dans « Filtres », avec le nombre de filtres actifs.
 *
 * États distincts (D-09) : chargement (squelette), erreur avec « Réessayer »,
 * aucune conversation, aucune conversation pour ces filtres (« Effacer les
 * filtres »).
 */

import React, { useState, useEffect } from 'react';
import { ListFilter, MessageSquare, PanelLeftClose, PanelLeftOpen, RefreshCw, Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { FilterOption, FilterPill } from '@/components/ui/filter-pill';
import { EmptyState, ErrorState } from '@/components/layout';
import { cn } from '@/lib/utils';
import { Chat, SequenceEnrollmentInfo } from '@/hooks/useMessagesInbox';
import { ChatListItem } from './ChatListItem';
import { isRecruiterChat, isClassicChat, hasUnread } from '@/hooks/useMessagesInboxHelpers';
import { ChatCategory, CHAT_CATEGORIES } from '@/hooks/useChatCategories';
import { useChatIntents } from '@/hooks/useChatIntents';

type StatusFilter = 'active' | 'snoozed' | 'archived' | 'all';
type ResponseFilter = 'all' | 'waiting_candidate' | 'waiting_me';
type SourceFilter = 'all' | 'classic' | 'recruiter';

interface ChatListSidebarProps {
  chats: Chat[];
  filteredChats: Chat[];
  selectedChat: Chat | null;
  loadingChats: boolean;
  /** Échec de la dernière lecture de la liste */
  chatsError?: string | null;
  searchQuery: string;
  showUnreadOnly: boolean;
  sourceFilter: SourceFilter;
  categoryFilter: ChatCategory | 'all';
  responseFilter: ResponseFilter;
  /** Statut de mise en sommeil ou d'archive */
  statusFilter?: StatusFilter;
  statusCounts?: { active: number; snoozed: number; archived: number };
  onStatusFilterChange?: (filter: StatusFilter) => void;
  enrollmentsMap: Map<string, SequenceEnrollmentInfo>;
  categoriesMap: Map<string, ChatCategory>;
  /** Brouillons enregistrés, par conversation */
  drafts?: Map<string, string>;
  onSearchChange: (query: string) => void;
  onShowUnreadOnlyChange: (show: boolean) => void;
  onSourceFilterChange: (filter: SourceFilter) => void;
  onCategoryFilterChange: (filter: ChatCategory | 'all') => void;
  onResponseFilterChange: (filter: ResponseFilter) => void;
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

const STATUS_LABELS: Record<StatusFilter, string> = {
  active: 'Actives',
  snoozed: 'En sommeil',
  archived: 'Archivées',
  all: 'Toutes',
};

const CATEGORY_ENTRIES = Object.entries(CHAT_CATEGORIES) as [ChatCategory, (typeof CHAT_CATEGORIES)[ChatCategory]][];

const withCount = (label: string, count: number) => `${label} (${count})`;

/** Bouton icône de l'en-tête : nom accessible et infobulle (01-direction.md, § 6). */
const HeaderIconButton: React.FC<{
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}> = ({ label, onClick, disabled, className, children }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={cn('h-11 w-11 text-muted-foreground hover:text-foreground md:h-8 md:w-8', className)}
      >
        {children}
      </Button>
    </TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>
);

export const ChatListSidebar: React.FC<ChatListSidebarProps> = ({
  chats,
  filteredChats,
  selectedChat,
  loadingChats,
  chatsError = null,
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
  drafts,
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
  // Liste repliée en colonne de 64 px (avatars seuls), préférence gardée
  // dans le navigateur.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('konekt_inbox_sidebar_collapsed') === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('konekt_inbox_sidebar_collapsed', collapsed ? '1' : '0');
    } catch { /* stockage plein ou navigation privée */ }
  }, [collapsed]);

  // Intentions lues par l'IA pour les conversations visibles (cache des analyses).
  const visibleAccountId = filteredChats[0]?.account_id || chats[0]?.account_id || null;
  const { data: intentsMap } = useChatIntents(filteredChats, visibleAccountId);

  const classicCount = chats.filter(c => isClassicChat(c)).length;
  const recruiterCount = chats.filter(c => isRecruiterChat(c)).length;
  const unreadCount = chats.filter(c => hasUnread(c)).length;
  const waitingMeCount = chats.filter(c => c.last_message?.is_sender === false).length;

  // Étiquettes comptées sur toutes les conversations étiquetées, chargées ou non
  const categoryCounts: Record<ChatCategory, number> = {
    interested: 0,
    not_interested: 0,
    to_recontact: 0,
    no_response: 0,
  };
  categoriesMap.forEach((cat) => {
    if (cat in categoryCounts) categoryCounts[cat]++;
  });
  const statusTotal = statusCounts.active + statusCounts.snoozed + statusCounts.archived;

  // Filtres du menu « Filtres » (le tri visible et la recherche sont à part)
  const filterCount = [
    statusFilter !== 'active',
    categoryFilter !== 'all',
    sourceFilter !== 'all',
    showUnreadOnly,
  ].filter(Boolean).length;
  const hasAnyFilter = filterCount > 0 || responseFilter !== 'all' || searchQuery.trim().length > 0;

  const clearFilters = () => {
    onSearchChange('');
    onResponseFilterChange('all');
    onStatusFilterChange?.('active');
    onCategoryFilterChange('all');
    onSourceFilterChange('all');
    onShowUnreadOnlyChange(false);
  };

  const renderList = () => {
    if (loadingChats && chats.length === 0) {
      return (
        <div className="space-y-1 p-2" role="status" aria-label="Chargement des conversations">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-2.5">
              <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
              {!collapsed && (
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-3/5 rounded-sm" />
                  <Skeleton className="h-3 w-4/5 rounded-sm" />
                </div>
              )}
            </div>
          ))}
        </div>
      );
    }

    if (chatsError && chats.length === 0) {
      if (collapsed) return null;
      return (
        <div className="p-3">
          <ErrorState
            variant="compact"
            title="Impossible de charger vos conversations"
            description="La liste n'a pas pu être lue. Vérifiez votre connexion, puis réessayez."
            onRetry={onRefresh}
            retrying={loadingChats}
          />
        </div>
      );
    }

    if (filteredChats.length === 0) {
      if (collapsed) return null;
      if (chats.length === 0) {
        return (
          <div className="p-3">
            <EmptyState
              variant="compact"
              icon={MessageSquare}
              title="Aucune conversation pour l'instant"
              description="Les messages échangés avec vos candidats sur LinkedIn apparaîtront ici."
              action={
                <Button variant="outline" size="sm" onClick={onRefresh} disabled={loadingChats}>
                  <RefreshCw aria-hidden="true" />
                  Actualiser
                </Button>
              }
            />
          </div>
        );
      }
      return (
        <div className="space-y-2 p-3">
          <EmptyState
            variant="compact"
            icon={Search}
            title={hasAnyFilter ? 'Aucune conversation ne correspond' : 'Aucune conversation active'}
            description={
              hasAnyFilter
                ? 'Modifiez la recherche ou les filtres pour élargir la liste.'
                : 'Les conversations en sommeil ou archivées restent accessibles.'
            }
            action={
              hasAnyFilter ? (
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  <X aria-hidden="true" />
                  Effacer les filtres
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => onStatusFilterChange?.('all')}>
                  Voir toutes les conversations
                </Button>
              )
            }
          />
          {searchQuery && hasMoreChats && onLoadAllChats && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={onLoadAllChats}
              loading={loadingAllChats}
            >
              {!loadingAllChats && <Search aria-hidden="true" />}
              {loadingAllChats ? 'Recherche en cours…' : 'Chercher dans toutes les conversations'}
            </Button>
          )}
        </div>
      );
    }

    return (
      <ul className="space-y-0.5 py-1" aria-label="Conversations">
        {filteredChats.map(chat => (
          <li key={chat.id}>
            <ChatListItem
              chat={chat}
              isSelected={selectedChat?.id === chat.id}
              enrollmentsMap={enrollmentsMap}
              category={categoriesMap.get(chat.id) || null}
              onSetCategory={onSetCategory}
              onClick={() => onChatSelect(chat)}
              onDeleteChat={onDeleteChat}
              isDeletingChat={isDeletingChat}
              collapsed={collapsed}
              intent={intentsMap?.get(chat.id)}
              draft={drafts?.get(chat.id) ?? null}
            />
          </li>
        ))}
        {!collapsed && hasMoreChats && (
          <li className="p-2">
            {searchQuery && onLoadAllChats ? (
              <Button variant="ghost" size="sm" className="w-full" onClick={onLoadAllChats} loading={loadingAllChats}>
                {!loadingAllChats && <Search aria-hidden="true" />}
                {loadingAllChats ? 'Recherche en cours…' : 'Chercher dans toutes les conversations'}
              </Button>
            ) : onLoadMoreChats ? (
              <Button variant="outline" size="sm" className="w-full" onClick={onLoadMoreChats} loading={loadingMoreChats}>
                {loadingMoreChats ? 'Chargement…' : 'Charger plus de conversations'}
              </Button>
            ) : null}
          </li>
        )}
      </ul>
    );
  };

  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-col overflow-hidden bg-background transition-[width] duration-200 ease-out',
        'w-full md:shrink-0 md:border-r md:border-border',
        collapsed ? 'md:w-16' : 'md:w-[300px]',
        selectedChat ? 'hidden md:flex' : 'flex',
      )}
    >
      <div className={cn('shrink-0 border-b border-border', collapsed ? 'px-2 py-3' : 'space-y-2.5 p-3')}>
        {/* Titre et actions de la liste */}
        <div className={cn('flex items-center', collapsed ? 'flex-col gap-1' : 'justify-between gap-2')}>
          {!collapsed && <h1 className="text-md font-semibold text-foreground">Messagerie</h1>}
          <div className={cn('flex items-center gap-0.5', collapsed && 'flex-col')}>
            {!collapsed && (
              <HeaderIconButton label="Actualiser les conversations" onClick={onRefresh} disabled={loadingChats}>
                <RefreshCw className={cn(loadingChats && 'animate-spin')} aria-hidden="true" />
              </HeaderIconButton>
            )}
            <HeaderIconButton
              label={collapsed ? 'Déplier la liste des conversations' : 'Replier la liste des conversations'}
              onClick={() => setCollapsed(!collapsed)}
              className="hidden md:inline-flex"
            >
              {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
            </HeaderIconButton>
          </div>
        </div>

        {!collapsed && (
          <>
            {/* Recherche et filtres */}
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  value={searchQuery}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder="Rechercher"
                  aria-label="Rechercher une conversation (nom, poste, message)"
                  className="h-8 pl-8 max-md:h-11"
                />
              </div>
              <FilterPill label="Filtres" icon={ListFilter} count={filterCount} align="end" contentClassName="w-64 max-h-[70vh] overflow-y-auto">
                {onStatusFilterChange && (
                  <div role="group" aria-labelledby="inbox-filter-status">
                    <p id="inbox-filter-status" className="eyebrow px-2 pb-1 pt-1.5">Statut</p>
                    {(['active', 'snoozed', 'archived', 'all'] as StatusFilter[]).map((key) => (
                      <FilterOption
                        key={key}
                        checked={statusFilter === key}
                        onCheckedChange={(on) => onStatusFilterChange(on ? key : 'active')}
                      >
                        {withCount(STATUS_LABELS[key], key === 'all' ? statusTotal : statusCounts[key])}
                      </FilterOption>
                    ))}
                  </div>
                )}
                <div role="group" aria-labelledby="inbox-filter-tag" className="mt-1 border-t border-border pt-1">
                  <p id="inbox-filter-tag" className="eyebrow px-2 pb-1 pt-1.5">Étiquette</p>
                  {CATEGORY_ENTRIES.map(([key, info]) => (
                    <FilterOption
                      key={key}
                      checked={categoryFilter === key}
                      onCheckedChange={(on) => onCategoryFilterChange(on ? key : 'all')}
                    >
                      {withCount(info.label, categoryCounts[key])}
                    </FilterOption>
                  ))}
                </div>
                <div role="group" aria-labelledby="inbox-filter-source" className="mt-1 border-t border-border pt-1">
                  <p id="inbox-filter-source" className="eyebrow px-2 pb-1 pt-1.5">Boîte LinkedIn</p>
                  <FilterOption
                    checked={sourceFilter === 'classic'}
                    onCheckedChange={(on) => onSourceFilterChange(on ? 'classic' : 'all')}
                  >
                    {withCount('Classique', classicCount)}
                  </FilterOption>
                  <FilterOption
                    checked={sourceFilter === 'recruiter'}
                    onCheckedChange={(on) => onSourceFilterChange(on ? 'recruiter' : 'all')}
                  >
                    {withCount('Recruiter', recruiterCount)}
                  </FilterOption>
                </div>
                <div className="mt-1 border-t border-border pt-1">
                  <FilterOption checked={showUnreadOnly} onCheckedChange={onShowUnreadOnlyChange}>
                    {withCount('Non lues uniquement', unreadCount)}
                  </FilterOption>
                </div>
                {filterCount > 0 && (
                  <div className="mt-1 border-t border-border pt-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start"
                      onClick={() => {
                        onStatusFilterChange?.('active');
                        onCategoryFilterChange('all');
                        onSourceFilterChange('all');
                        onShowUnreadOnlyChange(false);
                      }}
                    >
                      <X aria-hidden="true" />
                      Effacer les filtres
                    </Button>
                  </div>
                )}
              </FilterPill>
            </div>

            {/* Tri visible : qui doit répondre */}
            <SegmentedControl
              aria-label="Conversations affichées"
              value={responseFilter}
              onValueChange={onResponseFilterChange}
              options={[
                { value: 'all', label: 'Toutes' },
                {
                  value: 'waiting_me',
                  label: waitingMeCount > 0 ? (
                    <>
                      À répondre <span className="tabular-nums text-muted-foreground">{waitingMeCount}</span>
                    </>
                  ) : (
                    'À répondre'
                  ),
                  title: 'Le candidat a écrit le dernier message',
                },
                { value: 'waiting_candidate', label: 'En attente', title: 'Vous avez écrit le dernier message' },
              ]}
            />
          </>
        )}
      </div>

      {/* Liste : un div natif défile, sans le display: table de ScrollArea */}
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">{renderList()}</div>
    </div>
  );
};
