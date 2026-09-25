/**
 * MessagesInbox — liste des conversations et conversation ouverte.
 *
 * - Ordinateur : deux colonnes, la liste et la conversation.
 * - Téléphone : la liste, puis la conversation en plein écran une fois ouverte.
 *   Elle se pose sur le calque nommé z-sticky, sous les dialogues, les menus
 *   et les toasts (revue design D-72).
 * - MessageView n'est monté qu'une fois : le point de rupture ne change que sa
 *   mise en page (D-18). Il n'y a plus deux conversations en parallèle qui
 *   écrivent le même brouillon et lisent deux fois la même frise.
 *
 * La hauteur vient du parent (Inbox.tsx, calée sur l'espace visible).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, GitBranch, Link2 } from 'lucide-react';
import { LinkedInAccount } from '@/pages/Outreach';
import { useMessagesInbox } from '@/hooks/useMessagesInbox';
import { useMessageActions } from '@/hooks/useMessageActions';
import { useEdgeFunctionWarmup } from '@/hooks/useEdgeFunctionWarmup';
import { useAutoPrefetchAnalyses } from '@/hooks/useAutoPrefetchAnalyses';
import { useChatDrafts } from '@/hooks/useChatDraft';
import { ChatListSidebar } from './inbox/ChatListSidebar';
import { MessageView } from './inbox/MessageView';
import { AddToPipelineModal } from './AddToPipelineModal';
import { SequenceEnrollModal } from './SequenceEnrollModal';
import type { LinkedInProfile } from './types';
import { getCurrentCandidateProfile, getChatAvatar } from '@/hooks/useMessagesInboxHelpers';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { ChannelIcon } from '@/components/ui/ChannelIcon';
import { EmptyState } from '@/components/layout';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AttendeePicturesProvider, useAttendeePicturesContext } from '@/contexts/AttendeePicturesContext';
import { sequenceChannels } from '@/lib/sequenceCatalog';
import { cn } from '@/lib/utils';
import { plural } from '@/lib/plural';

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

  // Compte en cours de chargement, ou aucun compte LinkedIn relié
  if (!selectedAccount) {
    return (
      <div className="grid h-full place-items-center bg-background p-4">
        {loading ? (
          <Spinner label="Chargement de votre compte LinkedIn" size="lg" />
        ) : (
          <EmptyState
            icon={Link2}
            title="Aucun compte LinkedIn relié"
            description="Reliez votre compte LinkedIn pour lire vos conversations et répondre aux candidats depuis Konekt."
            action={
              <Button variant="primary" size="sm" asChild>
                <Link to="/settings/account/connections">Relier votre compte LinkedIn</Link>
              </Button>
            }
            className="w-full max-w-md"
          />
        )}
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
  // Warm-up des edge functions IA pour éviter les cold starts
  useEdgeFunctionWarmup(true);

  const inbox = useMessagesInbox({
    selectedAccount,
    onUnreadCountChange,
    initialChatId,
    onChatChange,
  });

  // Pré-chargement en background des analyses IA pour les chats récents.
  // Comme ça quand l'user ouvre un chat, l'analyse est déjà en cache → instantané.
  useAutoPrefetchAnalyses({ chats: inbox.chats, enabled: true });

  const { addReaction, deleteMessage, deleteChat, isReacting, isDeleting } = useMessageActions(
    inbox.organizationId ?? null,
  );

  // Brouillons en cours, signalés dans la liste (revue design D-10)
  const drafts = useChatDrafts();

  const candidateProfile = getCurrentCandidateProfile(inbox.selectedChat);

  // Séquence choisie, pas encore engagée. Le choix ouvre la préparation, il
  // n'inscrit personne (audit UX du 09/09/2026, constat UX05).
  const [pendingSequence, setPendingSequence] = useState<
    { id: string; name: string; steps: unknown[] } | null
  >(null);

  // Le candidat de la conversation, au format attendu par la préparation
  // d'inscription partagée avec le sourcing.
  const enrollProfile = useMemo<LinkedInProfile | null>(() => {
    const chat = inbox.selectedChat;
    if (!chat || !candidateProfile?.linkedinId) return null;
    const attendee = chat.attendees?.[0];
    return {
      id: candidateProfile.linkedinId,
      name: candidateProfile.name,
      headline: candidateProfile.headline,
      profile_url: candidateProfile.linkedinUrl,
      public_profile_url: candidateProfile.linkedinUrl,
      profile_picture_url: getChatAvatar(chat) || undefined,
      // Distance inconnue depuis une conversation : la vérification de
      // compatibilité la traite comme non renseignée, donc sans blocage abusif.
      network_distance: (attendee as { network_distance?: unknown })?.network_distance,
    } as unknown as LinkedInProfile;
  }, [inbox.selectedChat, candidateProfile]);

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

  // Réaction : les messages sont relus après succès, la fonction d'envoi ne
  // mettant pas à jour l'état local.
  const handleAddReaction = async (messageId: string, reaction: string): Promise<boolean> => {
    const success = await addReaction(messageId, reaction);
    if (success && inbox.selectedChat?.id) {
      inbox.fetchMessages(inbox.selectedChat.id);
    }
    return success;
  };

  return (
    <AttendeePicturesProvider organizationId={inbox.organizationId ?? null}>
      <PreloadAttendeePictures chats={inbox.chats} />

      <div className="flex h-full overflow-hidden bg-background" data-component="messages-inbox-grid">
        <ChatListSidebar
          chats={inbox.chats}
          filteredChats={inbox.filteredChats}
          selectedChat={inbox.selectedChat}
          loadingChats={inbox.loadingChats}
          chatsError={inbox.chatsError}
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
          drafts={drafts}
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

        {/* Conversation : plein écran sur téléphone quand elle est ouverte,
            colonne de droite sur ordinateur. */}
        <div
          className={cn(
            'h-full min-w-0 overflow-hidden bg-background',
            inbox.selectedChat
              ? 'fixed inset-0 z-sticky md:static md:z-auto md:flex-1'
              : 'hidden md:block md:flex-1',
          )}
        >
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
            activeMissions={inbox.activeMissions}
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
            onRefetchMessages={async () => {
              if (!inbox.selectedChat) return 0;
              // 1er essai : fetch normal (cache Unipile, rapide ~500ms)
              const count = await inbox.fetchMessages(inbox.selectedChat.id);
              if (count > 0) return count;
              // Fallback : si 0 messages, force un sync history complet (~10-30s)
              return await inbox.syncChatHistory(inbox.selectedChat.id);
            }}
            onAutoSyncIfEmpty={(chatId) => inbox.syncChatHistory(chatId, { silent: true })}
            onDeleteMessage={handleDeleteMessage}
            isReacting={isReacting}
            isDeleting={isDeleting}
          />
        </div>
      </div>

      {/*
        Choix de la séquence, sur le dialogue partagé (focus, Échap, titre
        annoncé ; constat UX07). Il s'ouvre depuis l'en-tête de la conversation
        (revue design D-02) et ne fait que choisir : l'inscription se confirme
        dans la préparation.
      */}
      <Dialog open={inbox.showSequenceSelect} onOpenChange={inbox.setShowSequenceSelect}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Choisir une séquence</DialogTitle>
            <DialogDescription>
              {candidateProfile?.name
                ? `Vous verrez les messages et les avertissements avant d'inscrire ${candidateProfile.name}.`
                : "Vous verrez les messages et les avertissements avant d'inscrire le candidat."}
            </DialogDescription>
          </DialogHeader>
          {inbox.sequences.length === 0 ? (
            <EmptyState
              variant="compact"
              icon={GitBranch}
              title="Aucune séquence active"
              description="Les séquences se créent et s'activent depuis l'onglet Outreach d'une mission."
              action={
                <Button variant="outline" size="sm" asChild>
                  <Link to="/missions" onClick={() => inbox.setShowSequenceSelect(false)}>
                    Voir les missions
                  </Link>
                </Button>
              }
            />
          ) : (
            <ul className="max-h-72 space-y-2 overflow-y-auto" aria-label="Séquences actives">
              {inbox.sequences.map((sequence) => {
                const channels = sequenceChannels(sequence.steps);
                return (
                  <li key={sequence.id}>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        // Choisir n'inscrit pas : on ouvre la préparation.
                        setPendingSequence(sequence);
                        inbox.setShowSequenceSelect(false);
                      }}
                      className="h-auto w-full justify-start gap-3 whitespace-normal p-3 text-left font-normal"
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-muted text-foreground-secondary">
                        <GitBranch aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">{sequence.name}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          {plural(sequence.steps.length, 'étape')}
                          {channels.map((channel) => (
                            <ChannelIcon key={channel} channel={channel} size="sm" />
                          ))}
                        </span>
                      </span>
                      <ChevronRight className="text-muted-foreground" aria-hidden="true" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      {/*
        Préparation avant engagement, la même que depuis le sourcing : candidat,
        messages, contacts récents et avertissements de compatibilité, puis
        confirmation explicite.
      */}
      {pendingSequence && enrollProfile && selectedAccount && (
        <SequenceEnrollModal
          isOpen
          onClose={() => setPendingSequence(null)}
          sequence={pendingSequence}
          profiles={[enrollProfile]}
          accountId={selectedAccount}
          onSuccess={() => {
            setPendingSequence(null);
            inbox.fetchEnrollments();
          }}
        />
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
