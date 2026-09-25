/**
 * MessagesInbox — Container avec sidebar de chats + vue conversation.
 *
 * Refonte from scratch — 2026-04-28.
 *
 * Layout : CSS Grid 2 colonnes (sidebar 360px | conversation 1fr).
 * La hauteur est imposée par le parent (Inbox.tsx fixe via calc(100dvh)).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { LinkedInAccount } from '@/pages/Outreach';
import { MessageSquare, AlertCircle, Loader2 } from 'lucide-react';
import { useMessagesInbox, type InboxSequenceOption } from '@/hooks/useMessagesInbox';
import { useMessageActions } from '@/hooks/useMessageActions';
import { useEdgeFunctionWarmup } from '@/hooks/useEdgeFunctionWarmup';
import { useAutoPrefetchAnalyses } from '@/hooks/useAutoPrefetchAnalyses';
import { ChatListSidebar } from './inbox/ChatListSidebar';
import { MessageView } from './inbox/MessageView';
import { AddToPipelineModal } from './AddToPipelineModal';
import { SequenceEnrollModal } from './SequenceEnrollModal';
import type { LinkedInProfile } from './types';
import { toast } from 'sonner';
import { getCurrentCandidateProfile, getChatAvatar, getChatJobInfo } from '@/hooks/useMessagesInboxHelpers';
import { normalizeNetworkDistance } from '@/lib/sequenceCompatibility';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { GitBranch } from 'lucide-react';
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

  const candidateProfile = getCurrentCandidateProfile(inbox.selectedChat);

  // Séquence choisie, pas encore engagée. Le choix ouvre la préparation, il
  // n'inscrit personne (audit UX du 09/09/2026, constat UX05). Ses étapes
  // complètes sont chargées avec la liste : la préparation montre les messages.
  const [pendingSequence, setPendingSequence] = useState<InboxSequenceOption | null>(null);
  // Mission de rattachement de l'inscription ('' = sans mission).
  const [selectedMissionId, setSelectedMissionId] = useState('');

  // Mission liée au candidat (inscription existante), présélectionnée à
  // l'ouverture du dialogue de choix.
  const linkedMissionId = useMemo(() => {
    const chat = inbox.selectedChat;
    if (!chat) return '';
    const jobId = getChatJobInfo(chat, inbox.enrollmentsMap)?.job_id;
    if (!jobId) return '';
    return inbox.activeMissions.find(m => m.id === jobId || m.job_id === jobId)?.id ?? '';
  }, [inbox.selectedChat, inbox.enrollmentsMap, inbox.activeMissions]);
  useEffect(() => {
    if (inbox.showSequenceSelect) setSelectedMissionId(linkedMissionId);
  }, [inbox.showSequenceSelect, linkedMissionId]);
  const selectedMission = inbox.activeMissions.find(m => m.id === selectedMissionId) ?? null;

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
      // Distance du participant quand le fournisseur la donne ; sinon
      // inconnue (pas de blocage, un avertissement si la séquence invite).
      network_distance: attendee?.specifics?.network_distance ?? attendee?.network_distance ?? undefined,
    } as unknown as LinkedInProfile;
  }, [inbox.selectedChat, candidateProfile]);

  // Relation non vérifiée et séquence avec invitation : l'invitation échouera
  // si le candidat est déjà en relation.
  const enrollNotice = useMemo(() => {
    if (!pendingSequence || !enrollProfile) return null;
    const distanceKnown = normalizeNetworkDistance(enrollProfile.network_distance) != null;
    const hasInvitation = pendingSequence.steps.some(
      (s: { action_type?: string; actionType?: string }) => (s.action_type || s.actionType) === 'connection_request',
    );
    return !distanceKnown && hasInvitation
      ? "Relation LinkedIn non vérifiée. Si vous êtes déjà en relation avec ce candidat, l'invitation échouera."
      : null;
  }, [pendingSequence, enrollProfile]);

  // Choisir n'inscrit pas : on ouvre la préparation, avec les étapes complètes
  // (messages compris). Une séquence vide n'ouvre rien.
  const handleChooseSequence = (sequence: InboxSequenceOption) => {
    if (sequence.steps.length === 0) {
      toast.error("Cette séquence ne contient aucune étape. Ajoutez au moins une étape avant d'inscrire des candidats.");
      return;
    }
    setPendingSequence(sequence);
    inbox.setShowSequenceSelect(false);
  };

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

      {/* Mobile fullscreen vue conversation (< md / 768px) */}
      {inbox.selectedChat && (
        <div className="fixed inset-0 z-[2100] bg-background md:hidden">
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
            onSuggestionSend={inbox.handleSuggestionSend}
            onFetchSuggestions={inbox.fetchReplySuggestions}
            onClearSuggestions={() => {
              inbox.setReplySuggestions([]);
              inbox.setSuggestionsLoaded(false);
            }}
            onAddToPipeline={inbox.handleAddToPipeline}
            onEnrollInSequence={inbox.handleEnrollInSequence}
            onEnrollmentsChanged={inbox.fetchEnrollments}
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

        {/* Vue conversation desktop (cachée < md, flex-1 sur md+).
            min-w-0 + overflow-hidden pour empêcher tout débordement
            horizontal venant des bulles ou du panel IA. */}
        <div className="hidden md:block md:flex-1 md:min-w-0 h-full max-w-full overflow-hidden">
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
            onSuggestionSend={inbox.handleSuggestionSend}
            onFetchSuggestions={inbox.fetchReplySuggestions}
            onClearSuggestions={() => {
              inbox.setReplySuggestions([]);
              inbox.setSuggestionsLoaded(false);
            }}
            onAddToPipeline={inbox.handleAddToPipeline}
            onEnrollInSequence={inbox.handleEnrollInSequence}
            onEnrollmentsChanged={inbox.fetchEnrollments}
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
        Choix de la séquence. Le dialogue partagé remplace la fenêtre maison :
        celle-ci était posée à `z-50` dans le même composant que la conversation
        mobile en `z-[2100]`, donc invisible sur téléphone (constat UX07). Il
        apporte au passage le focus, la touche Échap et le titre annoncé.
      */}
      <Dialog open={inbox.showSequenceSelect} onOpenChange={inbox.setShowSequenceSelect}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Choisir une séquence</DialogTitle>
            <DialogDescription className="text-xs">
              {candidateProfile?.name
                ? `Vous verrez les messages et les avertissements avant d'inscrire ${candidateProfile.name}.`
                : "Vous verrez les messages et les avertissements avant d'inscrire le candidat."}
            </DialogDescription>
          </DialogHeader>
          {/* Mission de rattachement : contexte donné à l'IA et suivi dans le
              pipeline de la mission. « Sans mission » ne bloque rien. */}
          <div className="space-y-1">
            <label htmlFor="inbox-enroll-mission" className="text-xs font-medium text-foreground">
              Mission
            </label>
            <select
              id="inbox-enroll-mission"
              value={selectedMissionId}
              onChange={(e) => setSelectedMissionId(e.target.value)}
              className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="">Sans mission</option>
              {inbox.activeMissions.map((mission) => (
                <option key={mission.id} value={mission.id}>{mission.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {inbox.sequencesStatus === 'loading' && inbox.sequences.length === 0 && (
              <p className="text-xs text-muted-foreground py-4 flex items-center justify-center gap-2" role="status">
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                Chargement des séquences…
              </p>
            )}
            {inbox.sequencesStatus === 'error' && (
              <div className="py-3 text-center space-y-2" role="alert">
                <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 text-destructive" aria-hidden="true" />
                  Impossible de charger les séquences.
                </p>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => void inbox.fetchSequences()}>
                  Réessayer
                </Button>
              </div>
            )}
            {inbox.sequencesStatus === 'ready' && inbox.sequences.length === 0 && (
              <p className="text-xs text-muted-foreground py-4 text-center">
                Aucune séquence active. Activez-en une ou créez-la depuis les séquences d'une mission.
              </p>
            )}
            {inbox.sequencesStatus !== 'error' && inbox.sequences.map((sequence) => (
              <button
                key={sequence.id}
                type="button"
                onClick={() => handleChooseSequence(sequence)}
                className="w-full p-3 text-left border border-border rounded-md hover:bg-accent/20 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <GitBranch className="w-4 h-4 text-foreground" />
                  <span className="font-medium text-sm">{sequence.name}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {sequence.stepCount} étape{sequence.stepCount > 1 ? 's' : ''}
                </p>
              </button>
            ))}
          </div>
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
          job={selectedMission ? { id: selectedMission.id, title: selectedMission.name } : null}
          notice={enrollNotice}
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
