import React, { useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { InMailTextEditor } from '../InMailTextEditor';
import { NurturingPanel } from '../NurturingPanel';
import { ToneSelector, AITone } from './ToneSelector';
import { ConversationSummary } from './ConversationSummary';
import { 
  ChevronLeft,
  User,
  Loader2,
  MessageSquare,
  Clock,
  CheckCheck,
  Check,
  Sparkles,
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

interface AnalysisData {
  intent: string;
  intentConfidence: number;
  sentiment: 'positive' | 'neutral' | 'negative';
  engagement: 'high' | 'medium' | 'low';
  summary: string;
  qualificationQuestions?: string[];
  detectedLanguage?: 'fr' | 'en' | 'other';
  topJobMatch?: {
    jobId: string;
    jobTitle: string;
    clientName?: string;
    matchScore: number;
    recommendation: 'go' | 'maybe' | 'skip';
  };
}

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
  analysisData?: AnalysisData | null;
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
  replySuggestions,
  loadingSuggestions,
  suggestionsLoaded,
  enrollmentsMap,
  availableJobs,
  messagesEndRef,
  messagesContainerRef,
  analysisData,
  loadingAnalysis,
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
}) => {
  // Local tone state if not controlled
  const [localTone, setLocalTone] = useState<AITone>(selectedTone);
  const currentTone = onToneChange ? selectedTone : localTone;
  const handleToneChange = onToneChange || setLocalTone;
  if (!selectedChat) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p>Sélectionnez une conversation</p>
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

  return (
    <div className={cn(
      "flex-1 flex flex-col",
      !selectedChat && "hidden md:flex"
    )}>
      {/* Chat Header */}
      <div className="p-3 border-b border-[#1A1A1A]/10 flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden h-8 w-8"
          onClick={onBack}
        >
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <Avatar className="w-10 h-10">
          <AvatarImage src={avatar} />
          <AvatarFallback className="bg-[#0077B5]/10 text-[#0077B5] font-medium">
            {getInitials(displayName)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-[#1A1A1A] truncate">
            {displayName}
          </h4>
          {headline && (
            <p className="text-xs text-muted-foreground truncate">
              {headline}
            </p>
          )}
          {subject && (
            <p className="text-[10px] text-[#0077B5] truncate flex items-center gap-1">
              <span>📧</span> {subject}
            </p>
          )}
        </div>
        
        {/* Tone Selector */}
        <ToneSelector
          selectedTone={currentTone}
          onToneChange={handleToneChange}
        />

        {selectedChat.attendees?.[0]?.profile_url && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => window.open(selectedChat.attendees?.[0]?.profile_url, '_blank')}
          >
            <User className="w-3 h-3 mr-1" />
            Profil
          </Button>
        )}
      </div>

      {/* AI Conversation Summary */}
      {analysisData && (
        <ConversationSummary
          summary={analysisData.summary}
          intent={analysisData.intent}
          intentConfidence={analysisData.intentConfidence}
          sentiment={analysisData.sentiment}
          engagement={analysisData.engagement}
          detectedLanguage={analysisData.detectedLanguage}
          topJobMatch={analysisData.topJobMatch}
          qualificationQuestions={analysisData.qualificationQuestions}
          loading={loadingAnalysis}
        />
      )}

      {/* Messages Area */}
      <ScrollArea 
        className="flex-1 p-4"
        ref={messagesContainerRef}
      >
        {loadingMessages && messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-6 h-6 animate-spin text-[#0077B5]" />
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
                className={cn(
                  "flex",
                  msg.is_sender ? "justify-end" : "justify-start"
                )}
              >
                <div
                  className={cn(
                    "max-w-[75%] rounded-2xl px-4 py-2.5",
                    msg.is_sender
                      ? "bg-[#0077B5] text-white rounded-br-md"
                      : "bg-[#1A1A1A]/5 text-[#1A1A1A] rounded-bl-md"
                  )}
                >
                  <p className="text-sm whitespace-pre-wrap break-words">
                    {getMessageText(msg)}
                  </p>
                  <div className={cn(
                    "flex items-center gap-1 mt-1",
                    msg.is_sender ? "justify-end" : "justify-start"
                  )}>
                    <span className={cn(
                      "text-[10px]",
                      msg.is_sender ? "text-white/70" : "text-muted-foreground"
                    )}>
                      {formatMessageTime(msg.timestamp)}
                    </span>
                    {msg.is_sender && (
                      (msg.read || msg.seen === 1) ? (
                        <CheckCheck className="w-3 h-3 text-white/70" />
                      ) : msg.delivered ? (
                        <Check className="w-3 h-3 text-white/70" />
                      ) : (
                        <Clock className="w-3 h-3 text-white/50" />
                      )
                    )}
                  </div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>

      {/* AI Nurturing Panel */}
      {messages.length > 0 && selectedChat && (
        <NurturingPanel
          context={{
            recipientName: displayName,
            recipientHeadline: headline,
            messages: messages.map(m => ({
              text: getMessageText(m),
              is_sender: !!m.is_sender,
              timestamp: m.timestamp,
            })),
            jobContext: jobInfo ? {
              title: jobInfo.job_title || 'Poste non spécifié',
            } : undefined,
            profileData: {
              name: displayName,
              headline: headline,
              currentRole: headline?.split(' at ')[0] || headline?.split(' chez ')[0],
              currentCompany: headline?.split(' at ')[1] || headline?.split(' chez ')[1],
              skills: headline?.split(/[|,·]/).map(s => s.trim()).filter(Boolean) || [],
            },
            availableJobs: availableJobs,
          }}
          onSuggestionSelect={onSuggestionClick}
          onSuggestionSend={onSuggestionSend}
          onJobSelect={onAddToPipeline}
          onAddToPipeline={onAddToPipeline}
          onEnrollInSequence={onEnrollInSequence}
          onScheduleCall={onScheduleCall}
          profileId={profileId || undefined}
          profileUrl={selectedChat.attendees?.[0]?.profile_url}
          sending={sending}
        />
      )}

      {/* Separator before input */}
      <div className="border-t border-[#1A1A1A]/10" />

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
          <Button
            onClick={onSendMessage}
            disabled={sending || !newMessage.trim()}
            className="bg-[#0077B5] hover:bg-[#005E93] h-10 w-10 p-0 mb-[2px]"
          >
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};
