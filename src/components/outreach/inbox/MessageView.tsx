/**
 * MessageView — Vue d'une conversation (header + messages + composer).
 *
 * Architecture CSS Grid avec rangées explicites :
 *
 *   .root [grid h-full overflow-hidden]
 *     gridTemplateRows: 'auto 1fr auto'
 *   ├── HEADER   (auto)  ← hauteur intrinsèque
 *   ├── MESSAGES (1fr)   ← prend le reste, scrollable
 *   └── COMPOSER (auto)  ← hauteur intrinsèque, TOUJOURS visible
 *
 * Pourquoi grid avec template-rows explicite ?
 *  - Les rangées `auto` ont leur hauteur intrinsèque (jamais 0)
 *  - La rangée `1fr` prend exactement le reste
 *  - Pas de magic flex-1 + min-h-0 + shrink-0 fragile
 *  - Pas de position fixed/absolute hacky
 *
 * Refonte from scratch — 2026-04-28.
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useAttendeePicturesContext } from '@/contexts/AttendeePicturesContext';
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
import { Button } from '@/components/ui/button';
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
  replySuggestions: replySuggestionsRaw,
  enrollmentsMap,
  availableJobs,
  messagesEndRef,
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
  const replySuggestions = Array.isArray(replySuggestionsRaw) ? replySuggestionsRaw : [];
  const [localTone, setLocalTone] = useState<AITone>(selectedTone);
  const currentTone = onToneChange ? selectedTone : localTone;
  const handleToneChange = onToneChange || setLocalTone;
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [reactingMsgId, setReactingMsgId] = useState<string | null>(null);
  const [deleteMsgConfirm, setDeleteMsgConfirm] = useState<string | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);

  // Snooze + archive
  const chatStatus = useChatStatus();

  // Draft auto-save : restore au changement de chat
  const { draft, setDraft, clearDraft } = useChatDraft(selectedChat?.id);
  const lastChatIdRef = useRef<string | null>(null);
  useEffect(() => {
    const id = selectedChat?.id || null;
    if (id === lastChatIdRef.current) return;
    lastChatIdRef.current = id;
    if (id && draft && !newMessage) onNewMessageChange(draft);
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

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (!loadingMessages && messages.length > 0) {
      const container = messagesScrollRef.current;
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
    | { kind: 'event'; data: ActivityEvent }
    | { kind: 'date'; date: string; label: string };

  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [];
    messages.forEach(m => items.push({ kind: 'message', data: m }));
    activityEvents.forEach(e => items.push({ kind: 'event', data: e }));
    items.sort((a, b) => {
      const tA = (a.kind === 'message' ? a.data.timestamp : a.kind === 'event' ? a.data.timestamp : '') || '';
      const tB = (b.kind === 'message' ? b.data.timestamp : b.kind === 'event' ? b.data.timestamp : '') || '';
      return tA.localeCompare(tB);
    });

    // Insertion des date separators entre items de jours différents
    const withSeparators: TimelineItem[] = [];
    let lastDate: string | null = null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const formatLabel = (d: Date): string => {
      const dStart = new Date(d);
      dStart.setHours(0, 0, 0, 0);
      if (dStart.getTime() === today.getTime()) return "Aujourd'hui";
      if (dStart.getTime() === yesterday.getTime()) return 'Hier';
      const diff = (today.getTime() - dStart.getTime()) / (1000 * 60 * 60 * 24);
      if (diff < 7) {
        return d.toLocaleDateString('fr-FR', { weekday: 'long' });
      }
      if (d.getFullYear() === today.getFullYear()) {
        return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
      }
      return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    };

    for (const item of items) {
      const ts = item.kind === 'message' ? item.data.timestamp : item.kind === 'event' ? item.data.timestamp : '';
      if (!ts) {
        withSeparators.push(item);
        continue;
      }
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) {
        withSeparators.push(item);
        continue;
      }
      const dateKey = d.toISOString().split('T')[0];
      if (dateKey !== lastDate) {
        withSeparators.push({ kind: 'date', date: dateKey, label: formatLabel(d) });
        lastDate = dateKey;
      }
      withSeparators.push(item);
    }
    return withSeparators;
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

  // Empty state
  if (!selectedChat) {
    return (
      <div className="h-full grid place-items-center bg-background text-muted-foreground">
        <div className="text-center max-w-xs px-6">
          <div className="h-14 w-14 bg-foreground/5 text-foreground/40 grid place-items-center mx-auto mb-4 rounded-md">
            <MessageSquare className="w-6 h-6" />
          </div>
          <p className="text-sm font-medium text-foreground/70">Sélectionnez une conversation</p>
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

  // ─── LAYOUT — CSS Grid 3 rangées (auto / 1fr / auto) ─────────────────
  return (
    <div
      className="h-full bg-background overflow-hidden"
      style={{
        display: 'grid',
        gridTemplateRows: 'auto minmax(0, 1fr) auto',
      }}
      data-component="message-view"
    >
      {/* ROW 1 — HEADER moderne avec backdrop blur */}
      <header className="border-b border-border bg-background/95 backdrop-blur-md">
        <div className="flex items-center gap-3 px-5 py-3.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 md:hidden rounded-full"
            onClick={onBack}
            aria-label="Retour"
          >
            <ChevronLeft className="w-5 h-5" />
          </Button>

          {/* Avatar circulaire avec ring subtil + badge channel */}
          <div className="relative shrink-0">
            <Avatar className="w-11 h-11 rounded-full ring-2 ring-background">
              <AvatarImage src={avatar} className="rounded-full" />
              <AvatarFallback className="bg-gradient-to-br from-foreground/15 to-foreground/5 text-foreground font-semibold rounded-full text-sm">
                {getInitials(displayName)}
              </AvatarFallback>
            </Avatar>
            <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-background grid place-items-center ring-1 ring-border">
              <ChannelIcon channel={channel} size="sm" />
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-foreground truncate text-[15px] tracking-tight">
                {displayName}
              </h2>
              {jobInfo?.job_title && (
                <span className="hidden md:inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-full">
                  <span className="w-1 h-1 rounded-full bg-muted-foreground/40" />
                  {jobInfo.job_title}
                </span>
              )}
            </div>
            {headline && (
              <p className="text-[13px] text-muted-foreground truncate mt-0.5 leading-tight">
                {headline}
              </p>
            )}
            {subject && (
              <p className="hidden md:block text-xs text-muted-foreground/70 truncate mt-1 italic">
                Objet : {subject}
              </p>
            )}
          </div>

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
            <div className="w-px h-5 bg-border mx-1.5" aria-hidden="true" />
            <ToneSelector selectedTone={currentTone} onToneChange={handleToneChange} />
            {selectedChat.attendees?.[0]?.profile_url && (
              <a
                href={selectedChat.attendees[0].profile_url}
                target="_blank"
                rel="noopener noreferrer"
                className="h-8 px-3 inline-flex items-center gap-1.5 text-xs font-medium rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                title="Voir le profil LinkedIn"
              >
                <User className="w-3.5 h-3.5" />
                <span>Profil</span>
              </a>
            )}
          </div>
        </div>
      </header>

      {/* ROW 2 — MESSAGES (scrollable, design moderne avec grouping) */}
      <div
        ref={messagesScrollRef}
        className="overflow-y-auto overscroll-y-contain bg-background"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {/* Container utilise pleine largeur avec padding latéral généreux.
            Les bulles ont leur propre max-width en pourcentage. */}
        <div className="px-6 py-6">
          {loadingMessages && messages.length === 0 ? (
            <div className="flex flex-col gap-4">
              {[
                { width: 40, side: 'left' },
                { width: 28, side: 'right' },
                { width: 56, side: 'left' },
                { width: 36, side: 'right' },
                { width: 32, side: 'left' },
              ].map((s, i) => (
                <div
                  key={i}
                  className={cn(
                    'h-12 bg-muted/40 animate-pulse rounded-2xl',
                    s.side === 'left' ? 'self-start rounded-bl-sm' : 'self-end rounded-br-sm',
                  )}
                  style={{ width: `${s.width}%`, animationDelay: `${i * 80}ms` }}
                />
              ))}
            </div>
          ) : messages.length === 0 ? (
            <div className="grid place-items-center min-h-[40vh] text-muted-foreground">
              <div className="text-center max-w-xs">
                <div className="h-16 w-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-muted to-muted/40 grid place-items-center">
                  <MessageSquare className="w-7 h-7 opacity-40" />
                </div>
                <p className="text-base font-medium text-foreground/80">Aucun message</p>
                <p className="text-sm text-muted-foreground/70 mt-1">
                  Démarrez la conversation ci-dessous.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              {timeline.map((item, idx) => {
                // Date separator (sticky-like, entre groupes de jours)
                if (item.kind === 'date') {
                  return (
                    <div
                      key={`date-${item.date}`}
                      className="flex items-center gap-3 my-6 px-2 select-none"
                    >
                      <div className="flex-1 h-px bg-border/60" />
                      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70 px-2">
                        {item.label}
                      </span>
                      <div className="flex-1 h-px bg-border/60" />
                    </div>
                  );
                }

                if (item.kind === 'event') {
                  return <ActivityEventCard key={`evt-${item.data.id}`} event={item.data} />;
                }
                const msg = item.data;
                const isSender = !!msg.is_sender;

                // Détection groupage : message précédent du même expéditeur ?
                // Skip les date separators et events dans la détection.
                const prev = idx > 0 ? timeline[idx - 1] : null;
                const prevIsSameSender =
                  prev?.kind === 'message' && !!prev.data.is_sender === isSender;
                const next = idx < timeline.length - 1 ? timeline[idx + 1] : null;
                const nextIsSameSender =
                  next?.kind === 'message' && !!next.data.is_sender === isSender;

                // Border-radius modulaire selon position dans le groupe
                const isFirstOfGroup = !prevIsSameSender;
                const isLastOfGroup = !nextIsSameSender;

                return (
                  <div
                    key={msg.id ?? idx}
                    className={cn(
                      'flex group/msg relative',
                      isSender ? 'justify-end' : 'justify-start',
                      // Espacement plus large entre groupes différents
                      isFirstOfGroup && idx > 0 && 'mt-4',
                    )}
                  >
                    {/* Avatar à gauche pour messages reçus, uniquement sur le LAST of group */}
                    {!isSender && (
                      <div className="w-8 h-8 mr-2 shrink-0">
                        {isLastOfGroup && (
                          <Avatar className="w-8 h-8 rounded-full ring-1 ring-border">
                            <AvatarImage src={avatar} className="rounded-full" />
                            <AvatarFallback className="bg-gradient-to-br from-foreground/15 to-foreground/5 text-foreground text-[10px] font-semibold rounded-full">
                              {getInitials(displayName)}
                            </AvatarFallback>
                          </Avatar>
                        )}
                      </div>
                    )}

                    {/* Bulles : 85% sur mobile, 75% sur md+ — utilise mieux
                        la largeur sur grand écran tout en gardant un asymétrie
                        gauche/droite lisible. */}
                    <div className="relative max-w-[85%] md:max-w-[75%]">
                      <div
                        className={cn(
                          'px-4 py-2.5 text-sm leading-relaxed shadow-sm transition-shadow',
                          'group-hover/msg:shadow-md',
                          isSender
                            ? 'bg-foreground text-background'
                            : 'bg-muted text-foreground',
                          // Border radius modulaire selon group position
                          isSender
                            ? cn(
                                'rounded-2xl',
                                isFirstOfGroup && 'rounded-tr-md',
                                isLastOfGroup && 'rounded-br-md',
                              )
                            : cn(
                                'rounded-2xl',
                                isFirstOfGroup && 'rounded-tl-md',
                                isLastOfGroup && 'rounded-bl-md',
                              ),
                        )}
                      >
                        <p className="whitespace-pre-wrap break-words">{getMessageText(msg)}</p>
                      </div>

                      {/* Réactions sur le message — affichées juste sous la
                          bulle, groupées par emoji avec count si > 1 */}
                      {msg.reactions && msg.reactions.length > 0 && (
                        <div className={cn(
                          "flex gap-1 mt-1 flex-wrap",
                          isSender ? "justify-end" : "justify-start",
                        )}>
                          {Object.entries(
                            msg.reactions.reduce<Record<string, number>>((acc, r) => {
                              const emoji = r.value || r.reaction || '';
                              if (!emoji) return acc;
                              acc[emoji] = (acc[emoji] || 0) + 1;
                              return acc;
                            }, {})
                          ).map(([emoji, count]) => (
                            <span
                              key={emoji}
                              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs bg-background border border-border rounded-full shadow-sm"
                            >
                              <span>{emoji}</span>
                              {count > 1 && (
                                <span className="text-[10px] text-muted-foreground tabular-nums font-medium">
                                  {count}
                                </span>
                              )}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Timestamp + read receipts UNIQUEMENT sur le last of group */}
                      {isLastOfGroup && (
                        <div
                          className={cn(
                            'flex items-center gap-1 mt-1 px-1 text-[10.5px] text-muted-foreground/80',
                            isSender ? 'justify-end' : 'justify-start',
                          )}
                        >
                          <span className="tabular-nums">{formatMessageTime(msg.timestamp)}</span>
                          {isSender && (msg.read || msg.seen === 1 ? (
                            <CheckCheck className="w-3 h-3 text-foreground/70" />
                          ) : msg.delivered ? (
                            <Check className="w-3 h-3 text-muted-foreground/60" />
                          ) : (
                            <Clock className="w-3 h-3 text-muted-foreground/40" />
                          ))}
                        </div>
                      )}

                      {/* Reactions au hover (received only) */}
                      {!isSender && onAddReaction && msg.id != null && (
                        <div
                          className={cn(
                            'absolute opacity-0 group-hover/msg:opacity-100 transition-opacity z-10',
                            'flex gap-0.5 bg-background border border-border px-1 py-0.5 rounded-full shadow-md',
                            '-bottom-3 left-2',
                          )}
                        >
                          {REACTION_EMOJIS.map(emoji => (
                            <button
                              key={emoji}
                              disabled={isReacting && reactingMsgId === msg.id}
                              onClick={async () => {
                                setReactingMsgId(msg.id);
                                await onAddReaction(msg.id, emoji);
                                setReactingMsgId(null);
                              }}
                              className="h-7 w-7 grid place-items-center text-base hover:bg-accent rounded-full transition-colors disabled:opacity-50"
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

                      {/* Delete (sent only) au hover */}
                      {isSender && onDeleteMessage && msg.id != null && (
                        <button
                          onClick={() => setDeleteMsgConfirm(msg.id)}
                          className="absolute -top-2 -right-2 opacity-0 group-hover/msg:opacity-100 transition-opacity z-10 h-6 w-6 grid place-items-center bg-destructive text-destructive-foreground shadow-md hover:bg-destructive/80 rounded-full"
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

      {/* ROW 3 — COMPOSER + AI panel optionnel */}
      <div>
        {aiPanelOpen && (
          <div className="max-h-[40vh] overflow-y-auto border-t border-border">
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

      {/* Delete confirmation dialog */}
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
