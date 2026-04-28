/**
 * MessagesInbox — Container avec sidebar de chats + vue conversation.
 *
 * Refonte from scratch — 2026-04-28.
 *
 * Layout : CSS Grid 2 colonnes (sidebar 360px | conversation 1fr).
 * La hauteur est imposée par le parent (Inbox.tsx fixe via calc(100dvh)).
 */

import React, { useEffect } from 'react';
import { LinkedInAccount } from '@/pages/Outreach';
import { MessageSquare } from 'lucide-react';
import { useMessagesInbox } from '@/hooks/useMessagesInbox';
import { useMessageActions } from '@/hooks/useMessageActions';
import { ChatListSidebar } from './inbox/ChatListSidebar';
import { MessageView } from './inbox/MessageView';
import { AddToPipelineModal } from './AddToPipelineModal';
import { getCurrentCandidateProfile, getChatAvatar } from '@/hooks/useMessagesInboxHelpers';
import { Button } from '@/components/ui/button';
import { GitBranch, X } from 'lucide-react';
import { AttendeePicturesProvider, useAttendeePicturesContext } from '@/contexts/AttendeePicturesContext';

interface MessagesInboxProps {
  accounts: LinkedInAccount[];
  selectedAccount: string | null;
  onAccountChange: (accountId: string | null) => void;
  onUnreadCountChange?: (count: number) => void;
  initialChatId?: string | null;
  onChatChange?: (chatId: string | null) => void;
  loading?: boolean;
  fullHeight?: boolean;
}

export const MessagesInbox: React.FC<MessagesInboxProps> = (props) => {
  const { selectedAccount, loading } = props;

  // Loading / no account selected
  if (!selectedAccount) {
    return (
      <div className="h-full grid place-items-center bg-background text-muted-foreground">
        <div className="text-center max-w-md px-6">
          {loading ? (
            <>
              <div className="w-6 h-6 border-2 border-border border-t-foreground rounded-full animate-spin mx-auto mb-4" />
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Chargement de votre compte LinkedIn...
              </p>
            </>
          ) : (
            <>
              <div className="h-14 w-14 bg-foreground/5 text-foreground/40 grid place-items-center mx-auto mb-4 rounded-md">
                <MessageSquare className="w-6 h-6" />
              </div>
              <p className="text-sm font-medium text-foreground/70">
                Aucun compte LinkedIn connecté
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Connectez votre LinkedIn dans les paramètres pour voir vos messages.
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  return <MessagesInboxInner {...props} selectedAccount={selectedAccount} />;
};

const MessagesInboxInner: React.FC<MessagesInboxProps & { selectedAccount: string }> = ({
  selectedAccount,
  onUnreadCountChange,
  initialChatId,
  onChatChange,
}) => {
  const inbox = useMessagesInbox({
    selectedAccount,
    onUnreadCountChange,
    initialChatId,
    onChatChange,
  });

  const { addReaction, deleteMessage, deleteChat, isReacting, isDeleting } = useMessageActions(
    inbox.organizationId ?? null,
  );

  const candidateProfile = getCurrentCandidateProfile(inbox.selectedChat);

  const handleDeleteChat = async (chatId: string) => {
    const success = await deleteChat(chatId);
    if (success) {
      if (inbox.selectedChat?.id === chatId) {
        inbox.setSelectedChat(null);
      }
      inbox.fetchChats(true);
    }
    return success;
  };

  const handleDeleteMessage = async (messageId: string) => {
    const success = await deleteMessage(messageId);
    if (success) inbox.fetchChats(false);
    return success;
  };

  // Wrapper pour addReaction : déclenche un re-fetch des messages après
  // succès afin que la réaction apparaisse immédiatement dans le UI
  // (l'edge function `add_reaction` envoie la réaction à LinkedIn via
  // Unipile mais ne met pas à jour le state local des messages).
  const handleAddReaction = async (messageId: string, reaction: string): Promise<boolean> => {
    const success = await addReaction(messageId, reaction);
    if (success && inbox.selectedChat?.id) {
      // Re-fetch pour récupérer la réaction depuis Unipile
      inbox.fetchMessages(inbox.selectedChat.id);
    }
    return success;
  };

  return (
    <AttendeePicturesProvider organizationId={inbox.organizationId ?? null}>
      <PreloadAttendeePictures chats={inbox.chats} />

      {/* Mobile/tablette fullscreen vue conversation (< lg / 1024px) */}
      {inbox.selectedChat && (
        <div className="fixed inset-0 z-[2100] bg-background lg:hidden">
          <MessageView
            selectedChat={inbox.selectedChat}
            messages={inbox.messages}
            loadingMessages={inbox.loadingMessages}
            newMessage={inbox.newMessage}
            sending={inbox.sending}
            replySuggestions={inbox.replySuggestions}
            loadingSuggestions={inbox.loadingSuggestions}
            suggestionsLoaded={inbox.suggestionsLoaded}
            enrollmentsMap={inbox.enrollmentsMap}
            availableJobs={inbox.availableJobs}
            messagesEndRef={inbox.messagesEndRef}
            messagesContainerRef={inbox.messagesContainerRef}
            analysisData={inbox.analysisData}
            loadingAnalysis={inbox.loadingAnalysis}
            selectedTone={inbox.selectedTone}
            onToneChange={inbox.setSelectedTone}
            onBack={() => inbox.setSelectedChat(null)}
            onNewMessageChange={inbox.setNewMessage}
            onSendMessage={inbox.sendMessage}
            onSuggestionClick={inbox.handleSuggestionClick}
            onSuggestionSend={inbox.handleSuggestionSend}
            onFetchSuggestions={inbox.fetchReplySuggestions}
            onClearSuggestions={() => {
              inbox.setReplySuggestions([]);
              inbox.setSuggestionsLoaded(false);
            }}
            onAddToPipeline={inbox.handleAddToPipeline}
            onEnrollInSequence={inbox.handleEnrollInSequence}
            onScheduleCall={inbox.handleScheduleCall}
            calendlyLink={inbox.calendlyLink}
            onAddReaction={handleAddReaction}
            onDeleteMessage={handleDeleteMessage}
            isReacting={isReacting}
            isDeleting={isDeleting}
          />
        </div>
      )}

      {/* Layout flex pur. Breakpoint à `lg` (1024px) au lieu de `md` (768px)
          pour éviter le 2-cols cramped quand le viewport effectif est petit
          (l'AppSidebar Konekt prend 256px du viewport, donc < 1024px de
          viewport effectif l'inbox manque de place). */}
      <div
        className="h-full bg-background overflow-hidden flex"
        data-component="messages-inbox-grid"
      >
        {/* Sidebar de chats */}
        <ChatListSidebar
          chats={inbox.chats}
          filteredChats={inbox.filteredChats}
          selectedChat={inbox.selectedChat}
          loadingChats={inbox.loadingChats}
          searchQuery={inbox.searchQuery}
          showUnreadOnly={inbox.showUnreadOnly}
          sourceFilter={inbox.sourceFilter}
          categoryFilter={inbox.chatCategories.categoryFilter}
          responseFilter={inbox.responseFilter}
          statusFilter={inbox.chatStatus.statusFilter}
          statusCounts={inbox.chatStatus.getStatusCounts(inbox.chats.map((c) => c.id))}
          onStatusFilterChange={inbox.chatStatus.setStatusFilter}
          enrollmentsMap={inbox.enrollmentsMap}
          categoriesMap={inbox.chatCategories.categoriesMap}
          onSearchChange={inbox.setSearchQuery}
          onShowUnreadOnlyChange={inbox.setShowUnreadOnly}
          onSourceFilterChange={inbox.setSourceFilter}
          onCategoryFilterChange={inbox.chatCategories.setCategoryFilter}
          onResponseFilterChange={inbox.setResponseFilter}
          onSetCategory={inbox.chatCategories.setCategory}
          onChatSelect={inbox.setSelectedChat}
          onRefresh={() => inbox.fetchChats(true)}
          hasMoreChats={inbox.hasMoreChats}
          loadingMoreChats={inbox.loadingMoreChats}
          loadingAllChats={inbox.loadingAllChats}
          onLoadMoreChats={inbox.loadMoreChats}
          onLoadAllChats={inbox.loadAllChats}
          onDeleteChat={handleDeleteChat}
          isDeletingChat={isDeleting}
        />

        {/* Vue conversation desktop (cachée < lg, flex-1 sur lg+) */}
        <div className="hidden lg:block lg:flex-1 lg:min-w-0 h-full overflow-hidden">
          <MessageView
            selectedChat={inbox.selectedChat}
            messages={inbox.messages}
            loadingMessages={inbox.loadingMessages}
            newMessage={inbox.newMessage}
            sending={inbox.sending}
            replySuggestions={inbox.replySuggestions}
            loadingSuggestions={inbox.loadingSuggestions}
            suggestionsLoaded={inbox.suggestionsLoaded}
            enrollmentsMap={inbox.enrollmentsMap}
            availableJobs={inbox.availableJobs}
            messagesEndRef={inbox.messagesEndRef}
            messagesContainerRef={inbox.messagesContainerRef}
            analysisData={inbox.analysisData}
            loadingAnalysis={inbox.loadingAnalysis}
            selectedTone={inbox.selectedTone}
            onToneChange={inbox.setSelectedTone}
            onBack={() => inbox.setSelectedChat(null)}
            onNewMessageChange={inbox.setNewMessage}
            onSendMessage={inbox.sendMessage}
            onSuggestionClick={inbox.handleSuggestionClick}
            onSuggestionSend={inbox.handleSuggestionSend}
            onFetchSuggestions={inbox.fetchReplySuggestions}
            onClearSuggestions={() => {
              inbox.setReplySuggestions([]);
              inbox.setSuggestionsLoaded(false);
            }}
            onAddToPipeline={inbox.handleAddToPipeline}
            onEnrollInSequence={inbox.handleEnrollInSequence}
            onScheduleCall={inbox.handleScheduleCall}
            calendlyLink={inbox.calendlyLink}
            onAddReaction={handleAddReaction}
            onDeleteMessage={handleDeleteMessage}
            isReacting={isReacting}
            isDeleting={isDeleting}
          />
        </div>
      </div>

      {/* Modals — fixed/portal, hors layout grid */}
      {inbox.showSequenceSelect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-background border border-border rounded-md p-4 max-w-sm w-full shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-sm">Choisir une séquence</h3>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => inbox.setShowSequenceSelect(false)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {inbox.sequences.map((sequence) => (
                <button
                  key={sequence.id}
                  onClick={() => inbox.enrollInSequence(sequence)}
                  className="w-full p-3 text-left border border-border rounded-md hover:bg-accent/20 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <GitBranch className="w-4 h-4 text-foreground" />
                    <span className="font-medium text-sm">{sequence.name}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {sequence.steps.length} étape(s)
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {inbox.showPipelineModal && candidateProfile && (
        <AddToPipelineModal
          open={inbox.showPipelineModal}
          onOpenChange={inbox.setShowPipelineModal}
          candidate={candidateProfile}
          preSelectedJobId={inbox.pipelinePreSelectedJobId}
        />
      )}
    </AttendeePicturesProvider>
  );
};

const PreloadAttendeePictures: React.FC<{ chats: import('@/hooks/useMessagesInbox').Chat[] }> = ({ chats }) => {
  const { preloadPictures } = useAttendeePicturesContext();
  useEffect(() => {
    const ids = chats
      .filter((c) => !getChatAvatar(c) && c.attendees?.[0]?.id)
      .map((c) => c.attendees?.[0]?.id)
      .filter((id): id is string => !!id)
      .slice(0, 20);
    if (ids.length > 0) preloadPictures(ids);
  }, [chats, preloadPictures]);
  return null;
};
