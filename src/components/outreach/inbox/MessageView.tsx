/**
 * MessageView — Conversation active avec layout CSS Grid indestructible.
 *
 * Architecture (refonte 2026-04-28) :
 *
 *   .root [grid grid-rows-[auto_1fr_auto] h-full overflow-hidden]
 *   ├── HEADER  (row auto)        — sticky top, avatar + nom + actions
 *   ├── BODY    (row 1fr)         — overflow-y-auto, messages timeline
 *   └── COMPOSER (row auto)       — toujours visible, MessageComposer
 *
 * Pourquoi CSS Grid au lieu de flex column ?
 *  - Les rangées `auto` ne peuvent JAMAIS être compressées sous leur contenu
 *  - La rangée `1fr` prend exactement le reste, ni plus ni moins
 *  - Pas de risque qu'un overflow:hidden parent cache une zone shrink
 *  - Pas de magic flex-1 + min-h-0 + shrink-0 fragile
 *
 * Le composer (MessageComposer) est extrait dans son propre composant et
 * a son propre bg-card + border-top — visuellement distinct, garanti visible.
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useAttendeePicturesContext } from '@/contexts/AttendeePicturesContext';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { ToneSelector, AITone } from './ToneSelector';
import { InlineAIPanel } from './InlineAIPanel';
import { ActivityEventCard } from './ActivityEventCard';
import { SnoozeArchiveButtons } from './SnoozeArchiveButtons';
import { MessageComposer } from './MessageComposer';
import { useChatStatus } from '@/hooks/useChatStatus';
import { useChatDraft } from '@/hooks/useChatDraft';
import { useProfileActivity, ActivityEvent } from '@/hooks/useProfileActivity';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  ChevronLeft, User, Loader2, MessageSquare, Clock, CheckCheck, Check, Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Chat, Message, SequenceEnrollmentInfo, JobData } from '@/hooks/useMessagesInbox';
import { ChannelIcon, detectChannel } from '@/components/ui/ChannelIcon';
import {
  getChatDisplayName, getChatHeadline, getChatSubject, getChatAvatar,
  getInitials, getMessageText, getChatJobInfo, getAttendeeProfileId,
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
  onAddToPipeline,
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

  // Snooze + archive
  const chatStatus = useChatStatus();

  // Draft auto-save : restore au changement de chat, jamais d'écrasement.
  const { draft, setDraft, clearDraft } = useChatDraft(selectedChat?.id);
  const lastChatIdRef = useRef<string | null>(null);
  useEffect(() => {
    const id = selectedChat?.id || null;
    if (id === lastChatIdRef.current) return;
    lastChatIdRef.current = id;
    if (id && draft && !newMessage) {
      onNewMessageChange(draft);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChat?.id]);

  useEffect(() => {
    if (!selectedChat?.id) return;
    if (!newMessage) return;
    setDraft(newMessage);
  }, [newMessage, selectedChat?.id, setDraft]);

  const wasSendingRef = useRef(sending);
  useEffect(() => {
    if (wasSendingRef.current && !sending && !newMessage) clearDraft();
    wasSendingRef.current = sending;
  }, [sending, newMessage, clearDraft]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (!loadingMessages && messages.length > 0) {
      const container = localContainerRef.current;
      if (container) {
        const t = setTimeout(() => {
          requestAnimationFrame(() => {
            try {
              container.scrollTo({ top: container.scrollHeight, behavior: 'auto' });
            } catch {
              container.scrollTop = container.scrollHeight;
            }
          });
        }, 80);
        return () => clearTimeout(t);
      }
    }
  }, [messages, loadingMessages]);

  const profileId = selectedChat ? getAttendeeProfileId(selectedChat) : null;
  const profileUrl = selectedChat?.attendees?.[0]?.profile_url || null;
  const profileName = selectedChat ? getChatDisplayName(selectedChat) : null;
  const { events: activityEvents } = useProfileActivity(profileId, profileUrl, profileName);

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

  // ─── Empty state ──────────────────────────────────────────────────────
  if (!selectedChat) {
    return (
      <div className="h-full grid place-items-center bg-background text-muted-foreground">
        <div className="text-center max-w-xs px-6">
          <div className="h-14 w-14 bg-foreground/5 text-foreground/40 grid place-items-center mx-auto mb-4 rounded-md">
            <MessageSquare className="w-6 h-6" />
          </div>
          <p className="text-sm font-medium text-foreground/70">
            Sélectionnez une conversation
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Vos messages LinkedIn et InMail apparaîtront ici.
          </p>
        </div>
      </div>
    );
  }

  const displayName = getChatDisplayName(selectedChat);
  const headline = getChatHeadline(selectedChat);
  const subject = getChatSubject(selectedChat);
  const jobInfo = getChatJobInfo(selectedChat, enrollmentsMap);
  const channel = detectChannel(selectedChat.account_type);

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
      headline,
      currentRole: headline?.split(' at ')[0] || headline?.split(' chez ')[0],
      currentCompany: headline?.split(' at ')[1] || headline?.split(' chez ')[1],
      skills: headline?.split(/[|,·]/).map(s => s.trim()).filter(Boolean) || [],
    },
    availableJobs,
    calendlyLink: calendlyLink || undefined,
  };

  // ─── Layout principal — POSITION ABSOLUTE ────────────────────────────
  // Le composer est rendu en absolute bottom-0 → impossible à cacher,
  // peu importe le bug que pourrait avoir un parent flex/grid.
  // Le header est en absolute top-0, les messages en absolute middle.
  return (
    <div
      className="h-full min-h-0 relative bg-background overflow-hidden"
      data-component="message-view"
    >
      {/* ═══ HEADER (absolute top) ═════════════════════════════════════ */}
      <header
        className="absolute top-0 left-0 right-0 z-20 border-b border-border bg-background/95 backdrop-blur-sm"
      >
        <div className="flex items-center gap-3 px-4 py-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 md:hidden"
            onClick={onBack}
            aria-label="Retour"
          >
            <ChevronLeft className="w-5 h-5" />
          </Button>

          <Avatar className="w-10 h-10 rounded-md shrink-0">
            <AvatarImage src={avatar} />
            <AvatarFallback className="bg-foreground/10 text-foreground font-semibold rounded-md text-sm">
              {getInitials(displayName)}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <ChannelIcon channel={channel} size="sm" />
              <h2 className="font-semibold text-foreground truncate text-sm">
                {displayName}
              </h2>
              {jobInfo?.job_title && (
                <span className="hidden md:inline text-[10px] uppercase tracking-wider text-muted-foreground border border-border px-1.5 py-0.5">
                  {jobInfo.job_title}
                </span>
              )}
            </div>
            {headline && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {headline}
              </p>
            )}
            {subject && (
              <p className="hidden md:block text-[11px] text-muted-foreground/80 truncate mt-0.5">
                Objet : {subject}
              </p>
            )}
          </div>

          {/* Actions header (desktop only) */}
          <div className="hidden md:flex items-center gap-1 shrink-0">
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
            <div className="w-px h-5 bg-border mx-1" aria-hidden="true" />
            <ToneSelector selectedTone={currentTone} onToneChange={handleToneChange} />
            {selectedChat.attendees?.[0]?.profile_url && (
              <a
                href={selectedChat.attendees[0].profile_url}
                target="_blank"
                rel="noopener noreferrer"
                className="h-7 px-2 inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider border border-border text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                title="Voir le profil LinkedIn"
              >
                <User className="w-3 h-3" />
                <span>Profil</span>
              </a>
            )}
          </div>
        </div>
      </header>

      {/* ═══ BODY — Messages timeline (absolute middle, scrollable) ════
           top-[72px] = sous le header (~72px de hauteur typique)
           bottom-[148px] = au-dessus du composer + AI panel space
           Tailwind ne supporte pas les arbitrary values < 80, on utilise style. */}
      <div
        ref={localContainerRef}
        className="absolute left-0 right-0 overflow-y-auto overscroll-y-contain bg-background"
        style={{
          top: '72px',
          bottom: aiPanelOpen ? '40vh' : '140px',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <div className="px-4 py-6 max-w-4xl mx-auto">
          {loadingMessages && messages.length === 0 ? (
            <div className="flex flex-col gap-3">
              {[40, 32, 64, 40, 28].map((w, i) => (
                <div
                  key={i}
                  className={cn(
                    'h-10 bg-muted/50 animate-pulse rounded-md',
                    i % 2 === 0 ? 'self-start' : 'self-end',
                  )}
                  style={{ width: `${w}%`, animationDelay: `${i * 80}ms` }}
                />
              ))}
            </div>
          ) : messages.length === 0 ? (
            <div className="grid place-items-center min-h-[40vh] text-muted-foreground">
              <div className="text-center max-w-xs">
                <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium">Aucun message</p>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  Démarrez la conversation depuis le composer ci-dessous.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {timeline.map((item, idx) => {
                if (item.kind === 'event') {
                  return <ActivityEventCard key={`evt-${item.data.id}`} event={item.data} />;
                }
                const msg = item.data;
                const isSender = !!msg.is_sender;
                return (
                  <div
                    key={msg.id ?? idx}
                    className={cn(
                      'flex group/msg relative',
                      isSender ? 'justify-end' : 'justify-start',
                    )}
                  >
                    <div className="relative max-w-[85%] md:max-w-[70%]">
                      <div
                        className={cn(
                          'px-4 py-2.5 rounded-lg text-sm leading-relaxed',
                          isSender
                            ? 'bg-foreground text-background rounded-br-sm'
                            : 'bg-muted text-foreground border border-border/40 rounded-bl-sm',
                        )}
                      >
                        <p className="whitespace-pre-wrap break-words">
                          {getMessageText(msg)}
                        </p>
                        <div
                          className={cn(
                            'flex items-center gap-1 mt-1.5 text-[10px]',
                            isSender ? 'justify-end' : 'justify-start',
                          )}
                        >
                          <span
                            className={cn(
                              isSender ? 'text-background/60' : 'text-muted-foreground',
                            )}
                          >
                            {formatMessageTime(msg.timestamp)}
                          </span>
                          {isSender && (msg.read || msg.seen === 1 ? (
                            <CheckCheck className="w-3 h-3 text-background/60" />
                          ) : msg.delivered ? (
                            <Check className="w-3 h-3 text-background/60" />
                          ) : (
                            <Clock className="w-3 h-3 text-background/40" />
                          ))}
                        </div>
                      </div>

                      {/* Reactions (received messages) */}
                      {!isSender && onAddReaction && msg.id != null && (
                        <div className="absolute -bottom-3 left-2 opacity-0 group-hover/msg:opacity-100 transition-opacity z-10 flex gap-0.5 bg-background border border-border px-1 py-0.5 rounded-md shadow-md">
                          {REACTION_EMOJIS.map(emoji => (
                            <button
                              key={emoji}
                              disabled={isReacting && reactingMsgId === msg.id}
                              onClick={async () => {
                                setReactingMsgId(msg.id);
                                await onAddReaction(msg.id, emoji);
                                setReactingMsgId(null);
                              }}
                              className="h-6 w-6 grid place-items-center text-sm hover:bg-accent/50 transition-colors disabled:opacity-50 rounded-sm"
                              aria-label={`Réagir avec ${emoji}`}
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

                      {/* Delete button (sent messages) */}
                      {isSender && onDeleteMessage && msg.id != null && (
                        <button
                          onClick={() => setDeleteMsgConfirm(msg.id)}
                          className="absolute -top-2 -right-2 opacity-0 group-hover/msg:opacity-100 transition-opacity z-10 h-6 w-6 grid place-items-center bg-destructive text-destructive-foreground border border-border shadow-md hover:bg-destructive/80 rounded-sm"
                          aria-label="Supprimer ce message"
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
      </div>

      {/* ═══ AI Panel (absolute, juste au-dessus du composer) ═══════════
           Quand ouvert, il pousse l'espace du body messages via le bottom
           dynamique du container messages (cf style ci-dessus). */}
      {aiPanelOpen && (
        <div
          className="absolute left-0 right-0 z-10 max-h-[calc(40vh-140px)] overflow-y-auto bg-background border-t border-border"
          style={{ bottom: '140px' }}
        >
          <InlineAIPanel
            open={aiPanelOpen}
            onClose={() => setAiPanelOpen(false)}
            context={aiContext}
            chatId={selectedChat.id}
            accountId={selectedChat.account_id}
            onSuggestionSelect={(text) => onSuggestionClick(text)}
            onSuggestionSend={(text) => onSuggestionSend(text)}
            onAddToPipeline={onAddToPipeline}
            sending={sending}
          />
        </div>
      )}

      {/* ═══ COMPOSER (absolute bottom-0) — INDESTRUCTIBLE ══════════════
           Position absolute → ne dépend ni du parent flex/grid, ni du
           contenu des messages. Toujours visible en bas, garantie CSS. */}
      <div className="absolute bottom-0 left-0 right-0 z-20" style={{ minHeight: '140px' }}>
        <MessageComposer
          value={newMessage}
          onChange={onNewMessageChange}
          onSend={onSendMessage}
          sending={sending}
          onOpenAI={() => setAiPanelOpen(!aiPanelOpen)}
          hasAISuggestions={replySuggestions.length > 0}
          aiSuggestionsCount={replySuggestions.length}
          onScheduleCall={onScheduleCall}
          hasCalendlyLink={!!calendlyLink}
          channel={channel?.toUpperCase()}
        />
      </div>

      {/* ─── Delete confirmation ─────────────────────────────────────── */}
      <AlertDialog open={!!deleteMsgConfirm} onOpenChange={(open) => !open && setDeleteMsgConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce message ?</AlertDialogTitle>
            <AlertDialogDescription>
              LinkedIn : la suppression n'est possible que dans les 60 premières minutes
              après l'envoi. Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              className="bg-destructive hover:bg-destructive/90"
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
