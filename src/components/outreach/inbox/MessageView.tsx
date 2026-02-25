import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { InMailTextEditor } from '../InMailTextEditor';
import { ToneSelector, AITone } from './ToneSelector';
import { MessageAISheet } from './MessageAISheet';
import { 
  ChevronLeft,
  User,
  Loader2,
  MessageSquare,
  Clock,
  CheckCheck,
  Check,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Chat, Message, SequenceEnrollmentInfo, JobData } from '@/hooks/useMessagesInbox';
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
}

export const MessageView: React.FC<MessageViewProps> = ({
  selectedChat,
  messages,
  loadingMessages,
  newMessage,
  sending,
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
  onEnrollInSequence,
  onScheduleCall,
}) => {
  const [localTone, setLocalTone] = useState<AITone>(selectedTone);
  const currentTone = onToneChange ? selectedTone : localTone;
  const handleToneChange = onToneChange || setLocalTone;

  const [aiSheetOpen, setAiSheetOpen] = useState(false);

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
  const avatar = getChatAvatar(selectedChat);
  const jobInfo = getChatJobInfo(selectedChat, enrollmentsMap);
  const profileId = getAttendeeProfileId(selectedChat);
  const hasCandidateMessage = messages.some(m => !m.is_sender);

  const aiContext = {
    recipientName: displayName,
    recipientHeadline: headline,
    messages: messages.map(m => ({
      text: getMessageText(m),
      is_sender: !!m.is_sender,
      timestamp: m.timestamp,
    })),
    jobContext: jobInfo ? { title: jobInfo.job_title || 'Poste non spécifié' } : undefined,
    profileData: {
      name: displayName,
      headline: headline,
      currentRole: headline?.split(' at ')[0] || headline?.split(' chez ')[0],
      currentCompany: headline?.split(' at ')[1] || headline?.split(' chez ')[1],
      skills: headline?.split(/[|,·]/).map(s => s.trim()).filter(Boolean) || [],
    },
    availableJobs: availableJobs,
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      {/* Chat Header */}
      <div className="p-3 border-b border-foreground flex items-center gap-3 bg-background shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={onBack}
        >
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <Avatar className="w-10 h-10 rounded-none">
          <AvatarImage src={avatar} />
          <AvatarFallback className="bg-foreground/10 text-foreground font-medium rounded-none">
            {getInitials(displayName)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-foreground truncate text-sm uppercase tracking-wide">
            {displayName}
          </h4>
          {headline && (
            <p className="text-xs text-muted-foreground truncate">{headline}</p>
          )}
          {subject && (
            <p className="text-[10px] text-muted-foreground truncate flex items-center gap-1">
              <span>📧</span> {subject}
            </p>
          )}
        </div>
        
        {/* Tone Selector */}
        <ToneSelector selectedTone={currentTone} onToneChange={handleToneChange} />

        {/* AI Sheet trigger */}
        {hasCandidateMessage && messages.length > 0 && (
          <button
            className="relative overflow-hidden h-8 px-3 text-xs font-medium uppercase tracking-wider border border-foreground bg-foreground text-background group"
            onClick={() => setAiSheetOpen(true)}
          >
            <span className="relative z-10 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5" />
              IA
            </span>
            <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
          </button>
        )}

        {selectedChat.attendees?.[0]?.profile_url && (
          <button
            className="relative overflow-hidden h-8 px-3 text-xs font-medium uppercase tracking-wider border border-foreground/20 bg-background text-foreground group"
            onClick={() => window.open(selectedChat.attendees?.[0]?.profile_url, '_blank')}
          >
            <span className="relative z-10 flex items-center gap-1">
              <User className="w-3 h-3" />
              Profil
            </span>
            <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
          </button>
        )}
      </div>

      {/* Messages Area */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain touch-pan-y p-4" ref={messagesContainerRef} style={{ WebkitOverflowScrolling: 'touch' }}>
        {loadingMessages && messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-6 h-6 animate-spin text-foreground" />
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
            {messages.map((msg, idx) => (
              <div
                key={msg.id || idx}
                className={cn("flex", msg.is_sender ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[75%] px-4 py-2.5",
                    msg.is_sender
                      ? "bg-foreground text-background"
                      : "bg-muted text-foreground border border-foreground"
                  )}
                >
                  <p className="text-sm whitespace-pre-wrap break-words">{getMessageText(msg)}</p>
                  <div className={cn(
                    "flex items-center gap-1 mt-1",
                    msg.is_sender ? "justify-end" : "justify-start"
                  )}>
                    <span className={cn(
                      "text-[10px]",
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
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Separator before input */}
      <div className="border-t border-foreground" />

      {/* Message Input */}
      <div className="px-3 pb-3">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <InMailTextEditor
              value={newMessage}
              onChange={onNewMessageChange}
              placeholder="Écrivez un message... (Ctrl+Entrée pour envoyer)"
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
            className="relative overflow-hidden h-10 w-10 bg-foreground text-background border border-foreground flex items-center justify-center mb-[2px] disabled:opacity-50 disabled:pointer-events-none group"
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

      {/* AI Side Sheet */}
      <MessageAISheet
        open={aiSheetOpen}
        onOpenChange={setAiSheetOpen}
        context={aiContext}
        profileUrl={selectedChat.attendees?.[0]?.profile_url}
        onSuggestionSelect={(text) => { onSuggestionClick(text); }}
        onSuggestionSend={(text) => { onSuggestionSend(text); }}
        onJobSelect={onAddToPipeline}
        onAddToPipeline={onAddToPipeline}
        onEnrollInSequence={onEnrollInSequence}
        onScheduleCall={onScheduleCall}
        sending={sending}
      />
    </div>
  );
};
