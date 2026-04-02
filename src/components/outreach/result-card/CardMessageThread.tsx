import React, { useState, useCallback } from 'react';
import { emitQuotaAction } from '@/lib/quotaEvents';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MessageSquare, Loader2, Send } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { invokeUnipile } from '@/lib/invokeUnipile';
import { toast } from 'sonner';
import { ChatMessage } from './types';

interface CardMessageThreadProps {
  accountId?: string;
  profileId: string;
  profileName: string;
  onMessageSent?: () => void;
  onProfileTreated?: () => void;
}

const formatMessageTime = (timestamp?: string) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Hier';
  if (diffDays < 7) return date.toLocaleDateString('fr-FR', { weekday: 'short' });
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
};

export const CardMessageThread: React.FC<CardMessageThreadProps> = ({
  accountId,
  profileId,
  profileName,
  onMessageSent,
  onProfileTreated,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesLoaded, setMessagesLoaded] = useState(false);
  const [chatId, setChatId] = useState<string | null>(null);
  const [noConversation, setNoConversation] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [isSending, setIsSending] = useState(false);

  const loadMessages = useCallback(async () => {
    if (!accountId || messagesLoaded || messagesLoading) return;

    setMessagesLoading(true);
    setNoConversation(false);

    try {
      const { data: chatsData } = await invokeUnipile({
        body: {
          action: 'get_chats',
          account_id: accountId,
          attendee_provider_id: profileId,
          limit: 10,
        },
      });

      if (!chatsData?.success || !(chatsData?.chats as any[])?.length) {
        setNoConversation(true);
        setMessagesLoaded(true);
        return;
      }

      const foundChat = (chatsData.chats as any[])[0];
      setChatId(foundChat.id);

      const { data: msgsData } = await invokeUnipile({
        body: {
          action: 'get_messages',
          account_id: accountId,
          chat_id: foundChat.id,
          limit: 50,
        },
      });

      if (msgsData?.success && msgsData?.messages) {
        setMessages(msgsData.messages as ChatMessage[]);
      }

      setMessagesLoaded(true);
    } catch (error) {
      console.error('Error loading messages:', error);
      toast.error("Erreur lors du chargement des messages");
    } finally {
      setMessagesLoading(false);
    }
  }, [accountId, profileId, messagesLoaded, messagesLoading]);

  const handleSendReply = useCallback(async () => {
    if (!chatId || !replyText.trim() || isSending) return;

    setIsSending(true);
    try {
      const { data } = await invokeUnipile({
        body: {
          action: 'send_message',
          account_id: accountId,
          chat_id: chatId,
          text: replyText.trim(),
        },
      });

      if (!data?.success) throw new Error(data?.error as string || "Erreur lors de l'envoi");
      emitQuotaAction('messagesSent', 1, accountId);

      const newMessage: ChatMessage = {
        id: (data.message as any)?.id || Date.now().toString(),
        text: replyText.trim(),
        is_sender: true,
        timestamp: new Date().toISOString(),
      };

      setMessages(prev => [...prev, newMessage]);
      setReplyText('');
      toast.success('Message envoyé !');
      onMessageSent?.();
      onProfileTreated?.();
    } catch (error) {
      console.error('Error sending message:', error);
      toast.error("Erreur lors de l'envoi du message");
    } finally {
      setIsSending(false);
    }
  }, [chatId, replyText, isSending, accountId, onMessageSent, onProfileTreated]);

  if (!accountId) {
    return (
      <div className="text-center py-8 text-muted-foreground bg-muted/30 rounded-lg">
        <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-50" />
        <p className="text-sm font-medium mb-1">Compte non disponible</p>
        <p className="text-xs text-muted-foreground">
          Sélectionnez un compte LinkedIn pour voir l'historique des messages
        </p>
      </div>
    );
  }

  if (messagesLoading) {
    return (
      <div className="text-center py-8">
        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-primary" />
        <p className="text-sm text-muted-foreground">Chargement des messages...</p>
      </div>
    );
  }

  if (!messagesLoaded) {
    return (
      <div className="text-center py-8 text-muted-foreground bg-muted/30 rounded-lg">
        <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-50" />
        <p className="text-sm font-medium mb-1">Historique des messages</p>
        <p className="text-xs text-muted-foreground mb-4">
          Consultez l'historique des échanges avec ce candidat
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={loadMessages}
          className="text-primary border-primary/30 hover:bg-primary/10"
        >
          <MessageSquare className="w-4 h-4 mr-2" />
          Charger l'historique
        </Button>
      </div>
    );
  }

  if (noConversation) {
    return (
      <div className="text-center py-8 text-muted-foreground bg-warning/10 rounded-lg border border-warning/30">
        <MessageSquare className="w-10 h-10 mx-auto mb-3 text-amber-400" />
        <p className="text-sm font-medium mb-1 text-amber-700">Aucune conversation</p>
        <p className="text-xs text-amber-600/70">
          Vous n'avez pas encore échangé avec ce candidat
        </p>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground bg-muted/30 rounded-lg">
        <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-50" />
        <p className="text-sm font-medium mb-1">Conversation vide</p>
        <p className="text-xs text-muted-foreground">
          La conversation existe mais aucun message n'a été trouvé
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 max-h-96 overflow-y-auto">
      <div className="flex items-center justify-between pb-2 border-b border-border">
        <span className="text-xs font-medium text-muted-foreground">
          {messages.length} message{messages.length > 1 ? 's' : ''}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { setMessagesLoaded(false); setMessages([]); }}
          className="text-xs h-6 px-2 text-muted-foreground hover:text-foreground"
        >
          Actualiser
        </Button>
      </div>

      <div className="space-y-2">
        {[...messages].reverse().map((msg, index) => (
          <div
            key={msg.id || index}
            className={`flex ${msg.is_sender ? 'justify-end' : 'justify-start'}`}
          >
            <div className={`max-w-[80%] rounded-lg px-3 py-2 ${
              msg.is_sender
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-foreground'
            }`}>
              <p className="text-sm whitespace-pre-wrap break-words">
                {msg.text || '(Message sans texte)'}
              </p>
              {msg.timestamp && (
                <p className={`text-xs mt-1 ${
                  msg.is_sender ? 'text-primary-foreground/60' : 'text-muted-foreground'
                }`}>
                  {formatMessageTime(msg.timestamp)}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {chatId && (
        <div className="pt-3 border-t border-border">
          <div className="flex gap-2">
            <Textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Écrire un message..."
              className="min-h-[60px] max-h-[120px] resize-none text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendReply();
                }
              }}
            />
            <Button
              onClick={handleSendReply}
              disabled={!replyText.trim() || isSending}
              size="icon"
              className="h-auto min-h-[60px] w-12 bg-primary hover:bg-primary/90"
            >
              {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Appuyez sur Entrée pour envoyer, Shift+Entrée pour un retour à la ligne
          </p>
        </div>
      )}
    </div>
  );
};
