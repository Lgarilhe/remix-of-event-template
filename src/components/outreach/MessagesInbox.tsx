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
import { cn } from '@/lib/utils';
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
  const { selectedAccount } = props;

  if (!selectedAccount) {
    if (props.loading) {
      return (
         <div className="flex items-center justify-center h-full text-muted-foreground bg-background">
          <div className="text-center">
            <div className="w-5 h-5 border-2 border-foreground/20 border-t-foreground rounded-full animate-spin mx-auto mb-4" />
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Chargement des comptes...</p>
          </div>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground bg-background">
        <div className="text-center">
          <div className="h-14 w-14 bg-foreground text-background flex items-center justify-center mx-auto mb-4">
            <MessageSquare className="w-6 h-6" />
          </div>
          <p className="text-sm uppercase tracking-wide">Sélectionnez un compte LinkedIn pour voir vos messages</p>
        </div>
      </div>
    );
  }

  return <MessagesInboxInner {...props} selectedAccount={selectedAccount} />;
};

const MessagesInboxInner: React.FC<
  MessagesInboxProps & { selectedAccount: string }
> = ({ selectedAccount, onUnreadCountChange, initialChatId, onChatChange, fullHeight }) => {
  const inbox = useMessagesInbox({
    selectedAccount,
    onUnreadCountChange,
    initialChatId,
    onChatChange,
  });

  const { addReaction, deleteMessage, deleteChat, isReacting, isDeleting } = useMessageActions(
    inbox.organizationId ?? null
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
    if (success) {
      // Refresh messages
      inbox.fetchChats(false);
    }
    return success;
  };

  return (
    <AttendeePicturesProvider organizationId={inbox.organizationId ?? null}>
      <PreloadAttendeePictures chats={inbox.chats} />
      <>
      {/* Mobile fullscreen message view */}
      {inbox.selectedChat && (
        <div className="fixed inset-0 z-[2100] bg-background flex flex-col min-h-0 overflow-hidden md:hidden">
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
            onAddReaction={addReaction}
            onDeleteMessage={handleDeleteMessage}
            isReacting={isReacting}
            isDeleting={isDeleting}
          />
        </div>
      )}

      {/* Desktop layout + mobile chat list */}
      <div className={cn("flex bg-background overflow-hidden relative", fullHeight ? "h-full border-x border-t border-foreground" : "h-[calc(100dvh-160px)] md:h-[calc(100dvh-280px)] min-h-[300px] md:min-h-[500px] border border-foreground")}>
        {/* Chat List Sidebar */}
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

        {/* Desktop Message View */}
        <div className="hidden md:flex flex-1 min-w-0">
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
            onAddReaction={addReaction}
            onDeleteMessage={handleDeleteMessage}
            isReacting={isReacting}
            isDeleting={isDeleting}
          />
        </div>

        {/* Sequence Selection Modal */}
        {inbox.showSequenceSelect && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-background border border-foreground p-4 max-w-sm w-full mx-4 shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold uppercase tracking-wide text-sm">Choisir une séquence</h3>
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
                    className="w-full p-3 text-left border border-foreground hover:bg-brutal-accent/20 transition-colors"
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

        {/* Add to Pipeline Modal */}
        {inbox.showPipelineModal && candidateProfile && (
          <AddToPipelineModal
            open={inbox.showPipelineModal}
            onOpenChange={inbox.setShowPipelineModal}
            candidate={candidateProfile}
            preSelectedJobId={inbox.pipelinePreSelectedJobId}
          />
        )}
      </div>
      </>
    </AttendeePicturesProvider>
  );
};

/** Preloads attendee pictures for visible chats that lack a static avatar */
const PreloadAttendeePictures: React.FC<{ chats: import('@/hooks/useMessagesInbox').Chat[] }> = ({ chats }) => {
  const { preloadPictures } = useAttendeePicturesContext();

  useEffect(() => {
    const ids = chats
      .filter((c) => !getChatAvatar(c) && c.attendees?.[0]?.id)
      .map((c) => c.attendees?.[0]?.id)
      .filter((id): id is string => !!id)
      .slice(0, 20);
    if (ids.length > 0) {
      preloadPictures(ids);
    }
  }, [chats, preloadPictures]);

  return null;
};
