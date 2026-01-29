import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { LinkedInAccount } from '@/pages/Outreach';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Search, 
  MessageSquare, 
  Send, 
  Loader2, 
  ChevronLeft,
  RefreshCw,
  User,
  Clock,
  CheckCheck,
  Check
} from 'lucide-react';
import { format, formatDistanceToNow, isToday, isYesterday, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface MessagesInboxProps {
  accounts: LinkedInAccount[];
  selectedAccount: string | null;
  onAccountChange: (accountId: string | null) => void;
}

interface ChatAttendee {
  name?: string;
  display_name?: string;
  profile_picture_url?: string;
  profile_url?: string;
  attendee_provider_id?: string;
  provider_id?: string;
  headline?: string;
}

interface Chat {
  id: string;
  account_id: string;
  account_type?: string;
  name?: string;
  subject?: string;
  timestamp?: string;
  unread_count?: number;
  attendees?: ChatAttendee[];
  attendee_provider_id?: string; // Single attendee ID from list endpoint
  last_message?: {
    text?: string;
    text_content?: string;
    sender_id?: string;
    timestamp?: string;
  };
}

interface Message {
  id: string;
  text?: string;
  text_content?: string;
  sender_id?: string;
  sender?: {
    name?: string;
    attendee_id?: string;
  };
  timestamp?: string;
  is_sender?: boolean;
  read?: boolean;
  delivered?: boolean;
}

export const MessagesInbox: React.FC<MessagesInboxProps> = ({
  accounts,
  selectedAccount,
}) => {
  const [chats, setChats] = useState<Chat[]>([]);
  const [filteredChats, setFilteredChats] = useState<Chat[]>([]);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingChats, setLoadingChats] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Fetch all chats for the selected account
  const fetchChats = useCallback(async (showToast = false) => {
    if (!selectedAccount) return;

    setLoadingChats(true);
    try {
      const response = await supabase.functions.invoke('unipile-search', {
        body: { 
          action: 'get_chats', 
          account_id: selectedAccount,
          limit: 100,
        },
      });

      if (response.error) throw response.error;
      if (!response.data?.success) throw new Error(response.data?.error);

      setChats(response.data.chats || []);
      setFilteredChats(response.data.chats || []);
      if (showToast) toast.success('Conversations actualisées');
    } catch (error) {
      console.error('Error fetching chats:', error);
      toast.error('Erreur lors du chargement des conversations');
    } finally {
      setLoadingChats(false);
    }
  }, [selectedAccount]);

  // Fetch messages for a specific chat
  const fetchMessages = useCallback(async (chatId: string, loadMore = false) => {
    if (!selectedAccount) return;

    setLoadingMessages(true);
    try {
      const response = await supabase.functions.invoke('unipile-search', {
        body: { 
          action: 'get_messages', 
          account_id: selectedAccount,
          chat_id: chatId,
          limit: 50,
          cursor: loadMore ? cursor : undefined,
        },
      });

      if (response.error) throw response.error;
      if (!response.data?.success) throw new Error(response.data?.error);

      const newMessages = response.data.messages || [];
      
      if (loadMore) {
        setMessages(prev => [...newMessages, ...prev]);
      } else {
        setMessages(newMessages.reverse()); // Reverse to show oldest first
      }
      
      setCursor(response.data.cursor);
      setHasMore(!!response.data.cursor);
    } catch (error) {
      console.error('Error fetching messages:', error);
      toast.error('Erreur lors du chargement des messages');
    } finally {
      setLoadingMessages(false);
    }
  }, [selectedAccount, cursor]);

  // Send a new message
  const sendMessage = async () => {
    if (!selectedAccount || !selectedChat || !newMessage.trim()) return;

    setSending(true);
    try {
      const response = await supabase.functions.invoke('unipile-search', {
        body: { 
          action: 'send_message', 
          account_id: selectedAccount,
          chat_id: selectedChat.id,
          text: newMessage.trim(),
        },
      });

      if (response.error) throw response.error;
      if (!response.data?.success) throw new Error(response.data?.error);

      // Add the message optimistically
      const sentMessage: Message = {
        id: Date.now().toString(),
        text: newMessage.trim(),
        timestamp: new Date().toISOString(),
        is_sender: true,
      };
      setMessages(prev => [...prev, sentMessage]);
      setNewMessage('');
      
      // Scroll to bottom
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);

      toast.success('Message envoyé');
    } catch (error) {
      console.error('Error sending message:', error);
      toast.error("Erreur lors de l'envoi du message");
    } finally {
      setSending(false);
    }
  };

  // Filter chats based on search query
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredChats(chats);
    } else {
      const query = searchQuery.toLowerCase();
      setFilteredChats(
        chats.filter(chat => {
          const chatName = chat.name?.toLowerCase() || '';
          const attendeeNames = chat.attendees?.map(a => a.name?.toLowerCase()).join(' ') || '';
          return chatName.includes(query) || attendeeNames.includes(query);
        })
      );
    }
  }, [searchQuery, chats]);

  // Load chats when account changes
  useEffect(() => {
    if (selectedAccount) {
      fetchChats();
      setSelectedChat(null);
      setMessages([]);
    }
  }, [selectedAccount, fetchChats]);

  // Load messages when chat is selected
  useEffect(() => {
    if (selectedChat) {
      fetchMessages(selectedChat.id);
    }
  }, [selectedChat, fetchMessages]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (!loadingMessages && messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loadingMessages]);

  // Format timestamp for display
  const formatMessageTime = (timestamp?: string) => {
    if (!timestamp) return '';
    try {
      const date = parseISO(timestamp);
      if (isToday(date)) {
        return format(date, 'HH:mm');
      } else if (isYesterday(date)) {
        return `Hier ${format(date, 'HH:mm')}`;
      }
      return format(date, 'dd/MM HH:mm');
    } catch {
      return '';
    }
  };

  const formatChatTime = (timestamp?: string) => {
    if (!timestamp) return '';
    try {
      const date = parseISO(timestamp);
      return formatDistanceToNow(date, { addSuffix: true, locale: fr });
    } catch {
      return '';
    }
  };

  // Get display name for chat
  const getChatDisplayName = (chat: Chat) => {
    // First try subject (for InMails)
    if (chat.subject) return chat.subject;
    // Then try chat name
    if (chat.name) return chat.name;
    // Then try attendees array
    const attendee = chat.attendees?.find(a => a.name || a.display_name);
    if (attendee) return attendee.display_name || attendee.name;
    return 'Conversation';
  };

  // Get headline for chat
  const getChatHeadline = (chat: Chat) => {
    const attendee = chat.attendees?.find(a => a.headline);
    return attendee?.headline;
  };

  // Get avatar for chat
  const getChatAvatar = (chat: Chat) => {
    const attendee = chat.attendees?.find(a => a.profile_picture_url);
    return attendee?.profile_picture_url;
  };

  // Get initials for fallback avatar
  const getInitials = (name?: string) => {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  // Get message text (handles different API response formats)
  const getMessageText = (msg: Message) => {
    return msg.text || msg.text_content || '';
  };

  // Get last message text
  const getLastMessageText = (chat: Chat) => {
    if (!chat.last_message) return 'Pas de message';
    return chat.last_message.text || chat.last_message.text_content || 'Pas de message';
  };

  // Handle keyboard shortcut for sending
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

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

  return (
    <div className="flex h-[calc(100vh-220px)] min-h-[500px] bg-white rounded-xl border border-[#1A1A1A]/10 overflow-hidden">
      {/* Chat List Sidebar */}
      <div className={cn(
        "w-80 border-r border-[#1A1A1A]/10 flex flex-col",
        selectedChat && "hidden md:flex"
      )}>
        {/* Search Header */}
        <div className="p-3 border-b border-[#1A1A1A]/10 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-[#1A1A1A]">Messages</h3>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8"
              onClick={() => fetchChats(true)}
              disabled={loadingChats}
            >
              <RefreshCw className={cn("w-4 h-4", loadingChats && "animate-spin")} />
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher une conversation..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
        </div>

        {/* Chat List */}
        <ScrollArea className="flex-1">
          {loadingChats ? (
            <div className="p-3 space-y-3">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="w-12 h-12 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredChats.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">
                {searchQuery ? 'Aucune conversation trouvée' : 'Aucune conversation'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#1A1A1A]/5">
              {filteredChats.map(chat => (
                <button
                  key={chat.id}
                  onClick={() => setSelectedChat(chat)}
                  className={cn(
                    "w-full p-3 flex items-start gap-3 text-left hover:bg-[#1A1A1A]/3 transition-colors",
                    selectedChat?.id === chat.id && "bg-[#0077B5]/5"
                  )}
                >
                  <Avatar className="w-12 h-12 shrink-0">
                    <AvatarImage src={getChatAvatar(chat)} />
                    <AvatarFallback className="bg-[#0077B5]/10 text-[#0077B5]">
                      {getInitials(getChatDisplayName(chat))}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm text-[#1A1A1A] truncate">
                        {getChatDisplayName(chat)}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {formatChatTime(chat.timestamp)}
                      </span>
                    </div>
                    {getChatHeadline(chat) && (
                      <p className="text-[10px] text-muted-foreground truncate">
                        {getChatHeadline(chat)}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {getLastMessageText(chat)}
                    </p>
                    {chat.unread_count && chat.unread_count > 0 && (
                      <Badge className="mt-1 h-5 bg-[#0077B5] text-white text-[10px]">
                        {chat.unread_count} nouveau{chat.unread_count > 1 ? 'x' : ''}
                      </Badge>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Message View */}
      <div className={cn(
        "flex-1 flex flex-col",
        !selectedChat && "hidden md:flex"
      )}>
        {selectedChat ? (
          <>
            {/* Chat Header */}
            <div className="p-3 border-b border-[#1A1A1A]/10 flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden h-8 w-8"
                onClick={() => setSelectedChat(null)}
              >
                <ChevronLeft className="w-5 h-5" />
              </Button>
              <Avatar className="w-10 h-10">
                <AvatarImage src={getChatAvatar(selectedChat)} />
                <AvatarFallback className="bg-[#0077B5]/10 text-[#0077B5]">
                  {getInitials(getChatDisplayName(selectedChat))}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <h4 className="font-medium text-[#1A1A1A] truncate">
                  {getChatDisplayName(selectedChat)}
                </h4>
                {getChatHeadline(selectedChat) && (
                  <p className="text-xs text-muted-foreground truncate">
                    {getChatHeadline(selectedChat)}
                  </p>
                )}
              </div>
            </div>

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
                            msg.read ? (
                              <CheckCheck className="w-3 h-3 text-white/70" />
                            ) : msg.delivered ? (
                              <Check className="w-3 h-3 text-white/70" />
                            ) : null
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </ScrollArea>

            {/* Message Input */}
            <div className="p-3 border-t border-[#1A1A1A]/10">
              <div className="flex items-end gap-2">
                <Input
                  placeholder="Écrivez un message..."
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="flex-1"
                  disabled={sending}
                />
                <Button
                  onClick={sendMessage}
                  disabled={sending || !newMessage.trim()}
                  className="bg-[#0077B5] hover:bg-[#005E93] h-10 w-10 p-0"
                >
                  {sending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <MessageSquare className="w-16 h-16 mx-auto mb-4 opacity-20" />
              <p className="text-lg font-medium text-[#1A1A1A]/70">
                Sélectionnez une conversation
              </p>
              <p className="text-sm mt-1">
                Choisissez un contact pour voir les messages
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
