import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useAttendeePicturesContext } from '@/contexts/AttendeePicturesContext';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { InMailTextEditor } from '../InMailTextEditor';
import { ToneSelector, AITone } from './ToneSelector';
import { InlineAIPanel } from './InlineAIPanel';
import { ActivityEventCard } from './ActivityEventCard';
import { SnoozeArchiveButtons } from './SnoozeArchiveButtons';
import { useChatStatus } from '@/hooks/useChatStatus';
import { useChatDraft } from '@/hooks/useChatDraft';
import { useProfileActivity, ActivityEvent } from '@/hooks/useProfileActivity';
import {
  Sparkles,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { 
  ChevronLeft,
  User,
  Loader2,
  MessageSquare,
  Clock,
  CheckCheck,
  Check,
  Zap,
  CalendarPlus,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Chat, Message, SequenceEnrollmentInfo, JobData } from '@/hooks/useMessagesInbox';
import { ChannelIcon, detectChannel } from '@/components/ui/ChannelIcon';
import {
  getChatDisplayName,
  getChatHeadline,
  getChatSubject,
  getChatAvatar,
  getInitials,
  getMessageText,
  getChatJobInfo,
  getAttendeeProfileId,
  formatMessageTime,
} from '@/hooks/useMessagesInboxHelpers';

const REACTION_EMOJIS = ['👍', '❤️', '🔥', '👏', '😂', '😮'];

interface MessageViewProps {
  selectedChat: Chat | null;
  messages: Message[];
  loadingMessages: boolean;
  newMessage: string;
  sending: boolean;
  replySuggestions: Array<{ text: string; type: string }>;
  loadingSuggestions: boolean;
  suggestionsLoaded: boolean;
  enrollmentsMap: Map<string, SequenceEnrollmentInfo>;
  availableJobs: JobData[];
  messagesEndRef: React.RefObject<HTMLDivElement>;
  messagesContainerRef: React.RefObject<HTMLDivElement>;
  analysisData?: any;
  loadingAnalysis?: boolean;
  selectedTone?: AITone;
  onToneChange?: (tone: AITone) => void;
  onBack: () => void;
  onNewMessageChange: (message: string) => void;
  onSendMessage: () => void;
  onSuggestionClick: (text: string) => void;
  onSuggestionSend: (text: string) => void;
  onFetchSuggestions: () => void;
  onClearSuggestions: () => void;
  onAddToPipeline: (jobId?: string, jobTitle?: string) => void;
  onEnrollInSequence: () => void;
  onScheduleCall: () => void;
  calendlyLink?: string | null;
  onAddReaction?: (messageId: string, reaction: string) => Promise<boolean>;
  onDeleteMessage?: (messageId: string) => Promise<boolean>;
  isReacting?: boolean;
  isDeleting?: boolean;
}

export const MessageView: React.FC<MessageViewProps> = ({
  selectedChat,
  messages,
  loadingMessages,
  newMessage,
  sending,
  replySuggestions,
  loadingSuggestions,
  suggestionsLoaded,
  enrollmentsMap,
  availableJobs,
  messagesEndRef,
  messagesContainerRef,
  selectedTone = 'casual',
  onToneChange,
  onBack,
  onNewMessageChange,
  onSendMessage,
  onSuggestionClick,
  onSuggestionSend,
  onFetchSuggestions,
  onClearSuggestions,
  onAddToPipeline,
  onEnrollInSequence,
  onScheduleCall,
  calendlyLink,
  onAddReaction,
  onDeleteMessage,
  isReacting,
  isDeleting,
}) => {
  const [localTone, setLocalTone] = useState<AITone>(selectedTone);
  const currentTone = onToneChange ? selectedTone : localTone;
  const handleToneChange = onToneChange || setLocalTone;
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [reactingMsgId, setReactingMsgId] = useState<string | null>(null);
  const [deleteMsgConfirm, setDeleteMsgConfirm] = useState<string | null>(null);
  const localContainerRef = useRef<HTMLDivElement>(null);

  // Chat status (snooze + archive) — Inbox refonte Phase 1
  // Hook indépendant utilisé ici (état dupliqué avec useMessagesInbox.chatStatus
  // mais cost négligeable et évite de propager 6 props supplémentaires).
  const chatStatus = useChatStatus();

  // Draft auto-save — restore le brouillon au mount du chat sélectionné
  // FIX: on dédie le restore au moment où la chat selection change, pas à chaque
  // changement de draft. Sinon on overwrite le newMessage parent à chaque tick.
  const { draft, setDraft, clearDraft } = useChatDraft(selectedChat?.id);
  const lastChatIdRef = useRef<string | null>(null);
  useEffect(() => {
    const id = selectedChat?.id || null;
    if (id === lastChatIdRef.current) return;
    lastChatIdRef.current = id;
    // Au changement de chat, si on a un draft sauvegardé et que l'input parent
    // est vide, on restaure le draft. NB : useChatDraft load le draft async,
    // donc on attend un tick pour être sûr d'avoir la valeur fraîche.
    if (id && draft && !newMessage) {
      onNewMessageChange(draft);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChat?.id]);

  // Sync : à chaque changement de newMessage côté parent, on persiste le draft.
  // FIX: on ne persiste QUE si le user a effectivement tapé quelque chose
  // (newMessage non vide). Sinon on évite de spammer localStorage avec des
  // drafts vides qui delete les drafts existants au mount.
  useEffect(() => {
    if (!selectedChat?.id) return;
    if (!newMessage) return; // ne pas écraser un draft existant avec ""
    setDraft(newMessage);
  }, [newMessage, selectedChat?.id, setDraft]);

  // Cleanup du draft après envoi réussi (sending → false + newMessage vide)
  const wasSendingRef = useRef(sending);
  useEffect(() => {
    if (wasSendingRef.current && !sending && !newMessage) {
      // Transition sending true→false avec input vide = envoi réussi
      clearDraft();
    }
    wasSendingRef.current = sending;
  }, [sending, newMessage, clearDraft]);

  // Scroll to bottom when messages load or change
  useEffect(() => {
    if (!loadingMessages && messages.length > 0) {
      const container = localContainerRef.current;
      if (container) {
        const timeout = setTimeout(() => {
          requestAnimationFrame(() => {
            try {
              container.scrollTo({ top: container.scrollHeight, behavior: 'auto' });
            } catch {
              container.scrollTop = container.scrollHeight;
            }
          });
        }, 80);
        return () => clearTimeout(timeout);
      }
    }
  }, [messages, loadingMessages]);

  const profileId = selectedChat ? getAttendeeProfileId(selectedChat) : null;
  const profileUrl = selectedChat?.attendees?.[0]?.profile_url || null;
  const profileName = selectedChat ? getChatDisplayName(selectedChat) : null;
  const { events: activityEvents } = useProfileActivity(profileId, profileUrl, profileName);

  // Merge messages and activity events into a unified timeline
  type TimelineItem = 
    | { kind: 'message'; data: Message }
    | { kind: 'event'; data: ActivityEvent };

  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [];
    messages.forEach(m => items.push({ kind: 'message', data: m }));
    activityEvents.forEach(e => items.push({ kind: 'event', data: e }));
    items.sort((a, b) => {
      const tA = (a.kind === 'message' ? a.data.timestamp : a.data.timestamp) || '';
      const tB = (b.kind === 'message' ? b.data.timestamp : b.data.timestamp) || '';
      return tA.localeCompare(tB);
    });
    return items;
  }, [messages, activityEvents]);

  // Move hooks that were after the early return to before it
  const { getPicture, fetchPicture } = useAttendeePicturesContext();
  const attendeeId = selectedChat?.attendees?.[0]?.id;
  const cachedPicture = attendeeId ? getPicture(attendeeId) : null;
  const staticAvatar = selectedChat ? getChatAvatar(selectedChat) : null;
  const avatar = staticAvatar || cachedPicture || undefined;

  useEffect(() => {
    if (!staticAvatar && attendeeId && !getPicture(attendeeId)) {
      fetchPicture(attendeeId);
    }
  }, [attendeeId, staticAvatar, fetchPicture, getPicture]);

  if (!selectedChat) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <div className="h-14 w-14 bg-foreground text-background flex items-center justify-center mx-auto mb-4">
            <MessageSquare className="w-6 h-6" />
          </div>
          <p className="text-sm uppercase tracking-wide">Sélectionnez une conversation</p>
        </div>
      </div>
    );
  }

  const displayName = getChatDisplayName(selectedChat);
  const headline = getChatHeadline(selectedChat);
  const subject = getChatSubject(selectedChat);
  const jobInfo = getChatJobInfo(selectedChat, enrollmentsMap);

  const hasCandidateMessage = messages.some(m => !m.is_sender);

  // Find the full job data for the current conversation's job
  const currentJobData = jobInfo?.job_id
    ? availableJobs.find(j => j.id === jobInfo.job_id)
    : undefined;

  const aiContext = {
    recipientName: displayName,
    recipientHeadline: headline,
    messages: messages.map(m => ({
      text: getMessageText(m),
      is_sender: !!m.is_sender,
      timestamp: m.timestamp,
    })),
    jobContext: jobInfo ? { title: jobInfo.job_title || 'Poste non spécifié' } : undefined,
    currentJobData: currentJobData || undefined,
    profileData: {
      name: displayName,
      headline: headline,
      currentRole: headline?.split(' at ')[0] || headline?.split(' chez ')[0],
      currentCompany: headline?.split(' at ')[1] || headline?.split(' chez ')[1],
      skills: headline?.split(/[|,·]/).map(s => s.trim()).filter(Boolean) || [],
    },
    availableJobs: availableJobs,
    calendlyLink: calendlyLink || undefined,
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      {/* Chat Header */}
      <div className="p-2 md:p-3 border-b border-border flex items-center gap-2 md:gap-3 bg-background shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={onBack}
          aria-label="Retour à la liste des messages"
        >
          <ChevronLeft className="w-5 h-5" aria-hidden="true" />
        </Button>
        <Avatar className="w-8 h-8 md:w-10 md:h-10 rounded-lg shrink-0">
          <AvatarImage src={avatar} />
          <AvatarFallback className="bg-foreground/10 text-foreground font-medium rounded-lg text-xs md:text-sm">
            {getInitials(displayName)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-foreground truncate text-xs md:text-sm uppercase tracking-wide flex items-center gap-1.5">
            <ChannelIcon channel={detectChannel(selectedChat.account_type)} size="sm" />
            {displayName}
          </h4>
          {headline && (
            <p className="text-xs md:text-xs text-muted-foreground truncate">{headline}</p>
          )}
          {subject && (
            <p className="text-xs text-muted-foreground truncate flex items-center gap-1 hidden md:flex">
              <span>📧</span> {subject}
            </p>
          )}
        </div>
        
        {/* Snooze + Archive buttons (Inbox refonte Phase 1) */}
        <div className="hidden md:flex items-center gap-0.5">
          <SnoozeArchiveButtons
            chatId={selectedChat.id}
            accountId={selectedChat.account_id}
            isSnoozed={chatStatus.isSnoozed(selectedChat.id)}
            isArchived={chatStatus.isArchived(selectedChat.id)}
            snoozedUntil={chatStatus.getSnoozedUntil(selectedChat.id)}
            onSnooze={chatStatus.snoozeChat}
            onArchive={chatStatus.archiveChat}
            onRestore={chatStatus.restoreChat}
            compact
          />
        </div>

        {/* Tone Selector - hidden on mobile to save space */}
        <div className="hidden md:block">
          <ToneSelector selectedTone={currentTone} onToneChange={handleToneChange} />
        </div>

        {/* AI Panel toggle */}
        {messages.length > 0 && (
          <button
            className={cn(
              "relative overflow-hidden h-8 px-2 md:px-3 text-xs font-medium uppercase tracking-wider border group shrink-0",
              aiPanelOpen
                ? "bg-accent text-foreground border-border"
                : "bg-foreground text-background border-border"
            )}
            onClick={() => setAiPanelOpen(!aiPanelOpen)}
          >
            <span className="relative z-10 flex items-center gap-1">
              <Zap className="w-3.5 h-3.5" />
              <span className="hidden md:inline">IA</span>
            </span>
          </button>
        )}

        {/* Calendly button */}
        <button
          className={cn(
            "relative overflow-hidden h-8 px-2 md:px-3 text-xs font-medium uppercase tracking-wider border bg-background text-foreground group shrink-0 flex items-center",
            calendlyLink ? "border-border" : "border-border opacity-70"
          )}
          onClick={onScheduleCall}
          title={calendlyLink ? "Insérer le lien Calendly" : "Configurer un lien Calendly dans le projet"}
        >
          <span className="relative z-10 flex items-center gap-1">
            <CalendarPlus className="w-3.5 h-3.5" />
            <span className="hidden md:inline">RDV</span>
          </span>
        </button>

        {selectedChat.attendees?.[0]?.profile_url && (
          <a
            href={selectedChat.attendees[0].profile_url}
            target="_blank"
            rel="noopener noreferrer"
            className="relative overflow-hidden h-8 px-2 md:px-3 text-xs font-medium uppercase tracking-wider border border-border bg-background text-foreground group shrink-0 flex items-center"
          >
            <span className="relative z-10 flex items-center gap-1">
              <User className="w-3 h-3" />
              <span className="hidden md:inline">Profil</span>
            </span>
          </a>
        )}
      </div>

      {/* Messages Area */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain touch-pan-y p-4" ref={localContainerRef} style={{ WebkitOverflowScrolling: 'touch' }}>
        {loadingMessages && messages.length === 0 ? (
          <div className="flex flex-col justify-end h-full gap-3 pb-2">
            <div className="flex justify-start">
              <div className="h-10 bg-muted rounded-2xl rounded-bl-sm w-2/5 animate-pulse" />
            </div>
            <div className="flex justify-end">
              <div className="h-10 bg-primary/15 rounded-2xl rounded-br-sm w-1/3 animate-pulse" style={{ animationDelay: '100ms' }} />
            </div>
            <div className="flex justify-start">
              <div className="h-16 bg-muted rounded-2xl rounded-bl-sm w-3/5 animate-pulse" style={{ animationDelay: '200ms' }} />
            </div>
            <div className="flex justify-end">
              <div className="h-10 bg-primary/15 rounded-2xl rounded-br-sm w-2/5 animate-pulse" style={{ animationDelay: '300ms' }} />
            </div>
            <div className="flex justify-start">
              <div className="h-10 bg-muted rounded-2xl rounded-bl-sm w-1/4 animate-pulse" style={{ animationDelay: '400ms' }} />
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Aucun message dans cette conversation</p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {timeline.map((item, idx) => {
              if (item.kind === 'event') {
                return <ActivityEventCard key={`evt-${item.data.id}`} event={item.data} />;
              }
              const msg = item.data;
              return (
                <div
                  key={msg.id ?? idx}
                  className={cn("flex group/msg relative", msg.is_sender ? "justify-end" : "justify-start")}
                >
                  <div className="relative max-w-[75%]">
                    <div
                      className={cn(
                        "px-4 py-2.5",
                        msg.is_sender
                          ? "bg-foreground text-background"
                          : "bg-muted text-foreground border border-border"
                      )}
                    >
                      <p className="text-sm whitespace-pre-wrap break-words">{getMessageText(msg)}</p>
                      <div className={cn(
                        "flex items-center gap-1 mt-1",
                        msg.is_sender ? "justify-end" : "justify-start"
                      )}>
                        <span className={cn(
                          "text-xs",
                          msg.is_sender ? "text-background/70" : "text-muted-foreground"
                        )}>
                          {formatMessageTime(msg.timestamp)}
                        </span>
                        {!!msg.is_sender && (
                          (msg.read || msg.seen === 1) ? (
                            <CheckCheck className="w-3 h-3 text-background/70" />
                          ) : msg.delivered ? (
                            <Check className="w-3 h-3 text-background/70" />
                          ) : (
                            <Clock className="w-3 h-3 text-background/50" />
                          )
                        )}
                      </div>
                    </div>

                    {/* Reaction bar for received messages */}
                    {!msg.is_sender && onAddReaction && msg.id != null && (
                      <div className="absolute -bottom-3 left-2 opacity-0 group-hover/msg:opacity-100 transition-opacity z-10 flex gap-0.5 bg-background/90 backdrop-blur-sm border border-border px-1 py-0.5 shadow-md">
                        {REACTION_EMOJIS.map(emoji => (
                          <button
                            key={emoji}
                            disabled={isReacting && reactingMsgId === msg.id}
                            onClick={async () => {
                              setReactingMsgId(msg.id);
                              await onAddReaction(msg.id, emoji);
                              setReactingMsgId(null);
                            }}
                            className="h-6 w-6 flex items-center justify-center text-sm hover:bg-accent transition-colors disabled:opacity-50"
                          >
                            {isReacting && reactingMsgId === msg.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              emoji
                            )}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Delete button for sent messages */}
                    {!!msg.is_sender && onDeleteMessage && msg.id != null && (
                      <button
                        onClick={() => setDeleteMsgConfirm(msg.id)}
                        className="absolute -top-2 -right-2 opacity-0 group-hover/msg:opacity-100 transition-opacity z-10 h-6 w-6 flex items-center justify-center bg-destructive text-destructive-foreground border border-border shadow-md hover:bg-destructive/80"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Inline AI Panel — between messages and input */}
      <InlineAIPanel
        open={aiPanelOpen}
        onClose={() => setAiPanelOpen(false)}
        context={aiContext}
        chatId={selectedChat.id}
        accountId={selectedChat.account_id}
        onSuggestionSelect={(text) => { onSuggestionClick(text); }}
        onSuggestionSend={(text) => { onSuggestionSend(text); }}
        onAddToPipeline={onAddToPipeline}
        sending={sending}
      />

      {/* AI suggestions badge when panel is closed */}
      {replySuggestions.length > 0 && !aiPanelOpen && (
        <div className="px-3 pt-2 shrink-0">
          <button
            onClick={() => setAiPanelOpen(true)}
            className="flex items-center gap-1.5 px-2 py-1 text-xs uppercase tracking-wider font-medium border border-border bg-accent/10 hover:bg-accent/20 transition-colors"
          >
            <Sparkles className="w-3 h-3" />
            {replySuggestions.length} suggestions IA
          </button>
        </div>
      )}

      {/* Separator before input */}
      <div className="border-t border-border shrink-0" />

      {/* Message Input — shrink-0 + bg-background pour garantir la visibilité */}
      <div className="px-3 py-3 shrink-0 bg-background">
        <div className="flex items-end gap-2">
          <div className="flex-1 min-w-0">
            <InMailTextEditor
              value={newMessage}
              onChange={onNewMessageChange}
              placeholder={`Écrivez un message... (${typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl'}+Entrée pour envoyer)`}
              minHeight="60px"
              maxHeight="200px"
              showWordCount={false}
              maxCharacters={1900}
              className="text-sm"
              onSend={onSendMessage}
              autoResize={true}
            />
          </div>
          <button
            onClick={onSendMessage}
            disabled={sending || !newMessage.trim()}
            className="relative overflow-hidden h-10 w-10 bg-foreground text-background border border-border flex items-center justify-center mb-[2px] disabled:opacity-50 disabled:pointer-events-none group shrink-0"
            aria-label="Envoyer le message"
          >
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin relative z-10" />
            ) : (
              <svg className="w-4 h-4 relative z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Delete message confirmation dialog */}
      <AlertDialog open={!!deleteMsgConfirm} onOpenChange={(open) => !open && setDeleteMsgConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce message ?</AlertDialogTitle>
            <AlertDialogDescription>
              LinkedIn : la suppression n'est possible que dans les 60 premières minutes après l'envoi. Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={async () => {
                if (deleteMsgConfirm && onDeleteMessage) {
                  await onDeleteMessage(deleteMsgConfirm);
                  setDeleteMsgConfirm(null);
                }
              }}
            >
              {isDeleting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
