import React from 'react';
import { LinkedInAccount } from '@/pages/Outreach';
import { MessageSquare } from 'lucide-react';
import { useMessagesInbox } from '@/hooks/useMessagesInbox';
import { ChatListSidebar } from './inbox/ChatListSidebar';
import { MessageView } from './inbox/MessageView';
import { AddToPipelineModal } from './AddToPipelineModal';
import { getCurrentCandidateProfile } from '@/hooks/useMessagesInboxHelpers';
import { Button } from '@/components/ui/button';
import { GitBranch, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MessagesInboxProps {
  accounts: LinkedInAccount[];
  selectedAccount: string | null;
  onAccountChange: (accountId: string | null) => void;
  onUnreadCountChange?: (count: number) => void;
}

export const MessagesInbox: React.FC<MessagesInboxProps> = (props) => {
  const { selectedAccount } = props;

  // Wrapper without hooks: avoids hook-order issues when selectedAccount toggles
  if (!selectedAccount) {
    return (
      <div className="flex items-center justify-center h-96 text-muted-foreground">
        <div className="text-center">
          <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p>Sélectionnez un compte LinkedIn pour voir vos messages</p>
        </div>
      </div>
    );
  }

  return <MessagesInboxInner {...props} selectedAccount={selectedAccount} />;
};

const MessagesInboxInner: React.FC<
  MessagesInboxProps & { selectedAccount: string }
> = ({ selectedAccount, onUnreadCountChange }) => {
  const inbox = useMessagesInbox({
    selectedAccount,
    onUnreadCountChange,
  });

  const candidateProfile = getCurrentCandidateProfile(inbox.selectedChat);

  return (
    <div className="flex h-[calc(100vh-220px)] min-h-[500px] bg-white rounded-xl border border-[#1A1A1A]/10 overflow-hidden">
      {/* Chat List Sidebar */}
      <ChatListSidebar
        chats={inbox.chats}
        filteredChats={inbox.filteredChats}
        selectedChat={inbox.selectedChat}
        loadingChats={inbox.loadingChats}
        searchQuery={inbox.searchQuery}
        showUnreadOnly={inbox.showUnreadOnly}
        sourceFilter={inbox.sourceFilter}
        enrollmentsMap={inbox.enrollmentsMap}
        onSearchChange={inbox.setSearchQuery}
        onShowUnreadOnlyChange={inbox.setShowUnreadOnly}
        onSourceFilterChange={inbox.setSourceFilter}
        onChatSelect={inbox.setSelectedChat}
        onRefresh={() => inbox.fetchChats(true)}
      />

      {/* Message View */}
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
      />

      {/* Sequence Selection Modal */}
      {inbox.showSequenceSelect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl p-4 max-w-sm w-full mx-4 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Choisir une séquence</h3>
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
                  className="w-full p-3 text-left rounded-lg border hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <GitBranch className="w-4 h-4 text-violet-600" />
                    <span className="font-medium">{sequence.name}</span>
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
  );
};

