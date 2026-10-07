/**
 * ChatListSidebar — colonne des conversations de la messagerie.
 *
 * Trois rangées avant la première conversation (revue design D-05, D-06) :
 * le titre, la recherche avec le bouton « Filtres », puis les onglets
 * « Toutes / À répondre / À relancer / En attente » (SegmentedControl,
 * aria-pressed, compteurs des conversations actives, états de
 * src/lib/inboxThreadState.ts). Le
 * statut (sommeil, archive), l'étiquette, la boîte d'origine et les non-lus
 * sont dans « Filtres », avec le nombre de filtres actifs.
 *
 * États distincts (D-09) : chargement (squelette), erreur avec « Réessayer »,
 * aucune conversation, aucune conversation pour ces filtres (« Effacer les
 * filtres »).
 *
 * Design simplifié (lot Suite, docs/design/06-simplicite.md) : titre de page à
 * 28 px, plus de bouton « Actualiser » (la liste se relit toutes les 30 s,
 * useMessagesInbox), bascule de la page mission (variante quiet), filtres sans
 * compte, donc sans « (0) ».
 */

import React, { useState, useEffect } from 'react';
import { ListFilter, MessageSquare, PanelLeftClose, PanelLeftOpen, Search, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ServiceLogo } from '@/components/ui/ServiceLogo';
import { SERVICE_LABELS } from '@/lib/messagingServices';
import type { MultichannelConversation } from '@/lib/multichannelInbox';
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
import { ChatCategory, CHAT_CATEGORIES } from '@/hooks/useChatCategories';
import { useChatIntents } from '@/hooks/useChatIntents';
import { RESPONSE_FILTER_STATE, type ResponseFilter, type ThreadCounts } from '@/lib/inboxThreadState';

type StatusFilter = 'active' | 'snoozed' | 'archived' | 'all';
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
  /** Conversations actives par état, pour les compteurs des onglets */
  threadCounts: ThreadCounts;
  /** Enregistrements e-mail/WhatsApp réels ; ils ne passent jamais dans les API LinkedIn. */
  additionalConversations?: MultichannelConversation[];
  selectedAdditionalKey?: string;
  additionalError?: string | null;
  onAdditionalSelect?: (conversation: MultichannelConversation) => void;
  /** Statut de mise en sommeil ou d'archive */
  statusFilter?: StatusFilter;
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
        className={cn('h-11 w-11 md:h-8 md:w-8', className)}
      >
        {children}
      </Button>
    </TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>
);

/** Libellé d'onglet suivi de son compteur, écrit seulement s'il n'est pas nul. */
const TabLabel: React.FC<{ text: string; count: number }> = ({ text, count }) =>
  count > 0 ? (
    <>
      {text} <span className="tabular-nums text-muted-foreground">{count}</span>
    </>
  ) : (
    <>{text}</>
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
  threadCounts,
  additionalConversations = [],
  selectedAdditionalKey,
  additionalError,
  onAdditionalSelect,
  statusFilter = 'active',
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

  // Filtres du menu « Filtres » (le tri visible et la recherche sont à part)
  const filterCount = [
    statusFilter !== 'active',
    categoryFilter !== 'all',
    sourceFilter !== 'all',
    showUnreadOnly,
  ].filter(Boolean).length;
  const hasAnyFilter = filterCount > 0 || responseFilter !== 'all' || searchQuery.trim().length > 0;
  const externalConversations = additionalConversations.filter(conversation => {
    if (showUnreadOnly || categoryFilter !== 'all' || sourceFilter !== 'all' || !['active', 'all'].includes(statusFilter)) return false;
    if (responseFilter !== 'all' && conversation.state !== RESPONSE_FILTER_STATE[responseFilter]) return false;
    const text = [conversation.candidateName, conversation.projectName, conversation.latest.counterpart, conversation.latest.subject, conversation.latest.content].filter(Boolean).join(' ').toLowerCase();
    return text.includes(searchQuery.toLowerCase().trim());
  });
  const totalConversations = chats.length + additionalConversations.length;

  const clearFilters = () => {
    onSearchChange('');
    onResponseFilterChange('all');
    onStatusFilterChange?.('active');
    onCategoryFilterChange('all');
    onSourceFilterChange('all');
    onShowUnreadOnlyChange(false);
  };

  const renderList = () => {
    if (loadingChats && totalConversations === 0) {
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

    if ((chatsError || additionalError) && totalConversations === 0) {
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

    if (filteredChats.length === 0 && externalConversations.length === 0) {
      if (collapsed) return null;
      if (totalConversations === 0) {
        return (
          <div className="p-3">
            <EmptyState
              variant="compact"
              icon={MessageSquare}
              title="Aucune conversation pour l'instant"
              description="Les échanges LinkedIn, e-mail et WhatsApp avec vos candidats apparaîtront ici."
              action={<Button asChild variant="outline" size="sm" className="min-h-11"><Link to="/settings/account/connections">Connecter un canal</Link></Button>}
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
        {[
          ...filteredChats.map(chat => ({ kind: 'linkedin' as const, chat, time: Date.parse(chat.last_message?.timestamp || chat.timestamp || '') || 0 })),
          ...externalConversations.map(conversation => ({ kind: 'external' as const, conversation, time: Date.parse(conversation.latest.occurred_at) || 0 })),
        ].sort((a, b) => b.time - a.time).map(item => item.kind === 'linkedin' ? (
          <li key={`linkedin-${item.chat.id}`}>
            <ChatListItem
              chat={item.chat}
              isSelected={selectedChat?.id === item.chat.id}
              enrollmentsMap={enrollmentsMap}
              category={categoriesMap.get(item.chat.id) || null}
              onSetCategory={onSetCategory}
              onClick={() => onChatSelect(item.chat)}
              onDeleteChat={onDeleteChat}
              isDeletingChat={isDeletingChat}
              collapsed={collapsed}
              intent={intentsMap?.get(item.chat.id)}
              draft={drafts?.get(item.chat.id) ?? null}
            />
          </li>
        ) : <li key={`external-${item.conversation.key}`}><Button variant="ghost" className={cn('h-auto min-h-20 w-full justify-start gap-3 whitespace-normal rounded-lg px-3 py-3 text-left', selectedAdditionalKey === item.conversation.key && 'bg-muted')} aria-label={`${item.conversation.candidateName} · ${SERVICE_LABELS[item.conversation.latest.service]} · ${item.conversation.projectName || (item.conversation.projectId ? 'Mission rattachée' : 'Mission non identifiée')} · ${item.conversation.latest.direction === 'inbound' ? item.conversation.latest.recipient : item.conversation.latest.sender}`} onClick={() => onAdditionalSelect?.(item.conversation)}>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted"><ServiceLogo service={item.conversation.latest.service} decorative /></span>
          {!collapsed && <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-foreground">{item.conversation.candidateName}</span><span className="mt-1 block truncate text-xs font-normal text-foreground-secondary">{item.conversation.latest.direction === 'outbound' ? 'Envoyé : ' : ''}{item.conversation.latest.content}</span><span className="mt-1 block truncate text-xs font-normal text-muted-foreground">{SERVICE_LABELS[item.conversation.latest.service]} · {item.conversation.projectName || (item.conversation.ambiguousMission ? 'Mission à vérifier' : item.conversation.projectId ? 'Mission rattachée' : 'Mission non identifiée')}</span><span className="mt-1 block truncate text-xs font-normal text-muted-foreground">{item.conversation.latest.direction === 'inbound' ? item.conversation.latest.recipient : item.conversation.latest.sender}</span><span className="mt-1 block text-xs font-normal text-muted-foreground">{item.conversation.state === 'to_reply' ? 'À répondre' : item.conversation.state === 'to_follow_up' ? 'À relancer' : 'En attente'}</span></span>}
        </Button></li>)}
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
        collapsed ? 'md:w-16' : 'md:w-[320px] xl:w-[360px] 2xl:w-[380px]',
        selectedChat || selectedAdditionalKey ? 'hidden md:flex' : 'flex',
      )}
    >
      <div className={cn('shrink-0 border-b border-border', collapsed ? 'px-2 py-3' : 'space-y-2.5 p-3')}>
        {/* Titre et actions de la liste */}
        <div className={cn('flex items-center', collapsed ? 'flex-col gap-1' : 'justify-between gap-2')}>
          {!collapsed && <h1 className="text-title font-semibold text-foreground">Messagerie</h1>}
          <div className={cn('flex items-center gap-0.5', collapsed && 'flex-col')}>
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
                        {STATUS_LABELS[key]}
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
                      {info.label}
                    </FilterOption>
                  ))}
                </div>
                <div role="group" aria-labelledby="inbox-filter-source" className="mt-1 border-t border-border pt-1">
                  <p id="inbox-filter-source" className="eyebrow px-2 pb-1 pt-1.5">Boîte LinkedIn</p>
                  <FilterOption
                    checked={sourceFilter === 'classic'}
                    onCheckedChange={(on) => onSourceFilterChange(on ? 'classic' : 'all')}
                  >
                    Classique
                  </FilterOption>
                  <FilterOption
                    checked={sourceFilter === 'recruiter'}
                    onCheckedChange={(on) => onSourceFilterChange(on ? 'recruiter' : 'all')}
                  >
                    Recruiter
                  </FilterOption>
                </div>
                <div className="mt-1 border-t border-border pt-1">
                  <FilterOption checked={showUnreadOnly} onCheckedChange={onShowUnreadOnlyChange}>
                    Non lues uniquement
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

            {/* Onglets : à qui est la main. Quatre options ne tiennent pas sur une ligne de 300 px : grille de deux colonnes. */}
            <SegmentedControl
              aria-label="Conversations affichées"
              variant="quiet"
              className="grid w-full grid-cols-2"
              value={responseFilter}
              onValueChange={onResponseFilterChange}
              options={[
                { value: 'all', label: 'Toutes' },
                {
                  value: 'waiting_me',
                  label: <TabLabel text="À répondre" count={threadCounts.to_reply} />,
                  title: 'Le candidat a écrit le dernier message',
                },
                {
                  value: 'to_follow_up',
                  label: <TabLabel text="À relancer" count={threadCounts.to_follow_up} />,
                  title: 'Sans réponse depuis trois jours ouvrés',
                },
                { value: 'waiting_candidate', label: 'En attente', title: 'Vous avez écrit le dernier message' },
              ]}
            />
          </>
        )}
      </div>

      {/* Liste : un div natif défile, sans le display: table de ScrollArea */}
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">{additionalError && !collapsed && <div className="space-y-2 p-3" role="status"><p className="text-xs text-muted-foreground">{additionalError}</p><Button variant="outline" size="sm" className="min-h-11" disabled={loadingChats} onClick={onRefresh}>Réessayer les autres canaux</Button></div>}{chatsError && totalConversations > 0 && !collapsed && <div className="space-y-2 p-3" role="status"><p className="text-xs text-muted-foreground">Les conversations LinkedIn n’ont pas pu être actualisées.</p><Button variant="outline" size="sm" className="min-h-11" disabled={loadingChats} onClick={onRefresh}>Réessayer LinkedIn</Button></div>}{renderList()}</div>
    </div>
  );
};
