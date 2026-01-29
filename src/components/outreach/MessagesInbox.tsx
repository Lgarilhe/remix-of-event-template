import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { LinkedInAccount } from '@/pages/Outreach';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
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
  Check,
  Briefcase,
  Reply,
  Hourglass,
  Sparkles,
  Zap
} from 'lucide-react';
import { format, formatDistanceToNow, isToday, isYesterday, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

interface MessagesInboxProps {
  accounts: LinkedInAccount[];
  selectedAccount: string | null;
  onAccountChange: (accountId: string | null) => void;
  onUnreadCountChange?: (count: number) => void;
}

interface ChatAttendee {
  name?: string;
  display_name?: string;
  profile_picture_url?: string;
  picture_url?: string; // Unipile uses this field name
  profile_url?: string;
  attendee_provider_id?: string;
  provider_id?: string;
  headline?: string;
  occupation?: string; // Unipile uses this for headline
  first_name?: string;
  last_name?: string;
  public_identifier?: string;
  specifics?: {
    occupation?: string;
  };
}

interface Chat {
  id: string;
  account_id: string;
  account_type?: string;
  name?: string;
  subject?: string;
  timestamp?: string;
  unread_count?: number;
  unread?: number; // Alternative field name
  attendees?: ChatAttendee[];
  attendee_provider_id?: string;
  folder?: string[];
  content_type?: string; // 'inmail' for InMails
  last_message?: {
    text?: string;
    text_content?: string;
    sender_id?: string;
    timestamp?: string;
    is_sender?: boolean;
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
  seen?: number; // Unipile uses 0/1
  delivered?: boolean;
}

interface SequenceEnrollmentInfo {
  profile_id: string;
  job_title: string | null;
  job_id: string | null;
  status: string;
  replied_at: string | null;
  current_step_order: number;
}

export const MessagesInbox: React.FC<MessagesInboxProps> = ({
  accounts,
  selectedAccount,
  onUnreadCountChange,
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
  const [enrollmentsMap, setEnrollmentsMap] = useState<Map<string, SequenceEnrollmentInfo>>(new Map());
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  
  // Reply suggestions state
  const [replySuggestions, setReplySuggestions] = useState<Array<{ text: string; type: string }>>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [suggestionsLoaded, setSuggestionsLoaded] = useState(false);

  // Fetch sequence enrollments to get job context for profiles
  const fetchEnrollments = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('sequence_enrollments')
        .select('profile_id, job_title, job_id, status, replied_at, current_step_order')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      
      // Create a map from profile_id to enrollment info
      const map = new Map<string, SequenceEnrollmentInfo>();
      data?.forEach(enrollment => {
        // Only keep the most recent enrollment per profile
        if (!map.has(enrollment.profile_id)) {
          map.set(enrollment.profile_id, enrollment);
        }
      });
      setEnrollmentsMap(map);
    } catch (error) {
      console.error('Error fetching enrollments:', error);
    }
  }, []);

  // Fetch all chats for the selected account
  const fetchChats = useCallback(async (showToast = false) => {
    if (!selectedAccount) return;

    setLoadingChats(true);
    try {
      const response = await supabase.functions.invoke('unipile-search', {
        body: { 
          action: 'get_chats', 
          account_id: selectedAccount,
          limit: 250, // Max limit to get all recent conversations (Classic + Recruiter)
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

  // Filter chats based on search query and unread filter
  useEffect(() => {
    let result = chats;
    
    // Apply unread filter first
    if (showUnreadOnly) {
      result = result.filter(chat => hasUnread(chat));
    }
    
    // Then apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(chat => {
        const chatName = chat.name?.toLowerCase() || '';
        const attendeeNames = chat.attendees?.map(a => a.name?.toLowerCase()).join(' ') || '';
        return chatName.includes(query) || attendeeNames.includes(query);
      });
    }
    
    setFilteredChats(result);
  }, [searchQuery, chats, showUnreadOnly]);

  // Calculate and report total unread count
  useEffect(() => {
    const totalUnread = chats.reduce((acc, chat) => acc + getUnreadCount(chat), 0);
    onUnreadCountChange?.(totalUnread);
  }, [chats, onUnreadCountChange]);

  // Load chats and enrollments when account changes
  useEffect(() => {
    if (selectedAccount) {
      fetchChats();
      fetchEnrollments();
      setSelectedChat(null);
      setMessages([]);
    }
  }, [selectedAccount, fetchChats, fetchEnrollments]);

  // Load messages when chat is selected
  useEffect(() => {
    if (selectedChat) {
      fetchMessages(selectedChat.id);
      // Reset suggestions when chat changes
      setReplySuggestions([]);
      setSuggestionsLoaded(false);
    }
  }, [selectedChat, fetchMessages]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (!loadingMessages && messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loadingMessages]);

  // Fetch AI reply suggestions
  const fetchReplySuggestions = useCallback(async () => {
    if (!selectedChat || messages.length === 0 || loadingSuggestions || suggestionsLoaded) return;
    
    setLoadingSuggestions(true);
    try {
      const recipientName = getChatDisplayName(selectedChat);
      const recipientHeadline = getChatHeadline(selectedChat);
      const jobInfo = getChatJobInfo(selectedChat);
      
      const response = await supabase.functions.invoke('generate-reply-suggestions', {
        body: {
          context: {
            recipientName,
            recipientHeadline,
            messages: messages.slice(-10).map(m => ({
              text: getMessageText(m),
              is_sender: m.is_sender,
              timestamp: m.timestamp,
            })),
            jobContext: jobInfo ? {
              title: jobInfo.job_title || 'Poste non spécifié',
            } : undefined,
          },
        },
      });

      if (response.error) throw response.error;
      
      if (response.data?.success && response.data?.suggestions) {
        setReplySuggestions(response.data.suggestions);
      }
      setSuggestionsLoaded(true);
    } catch (error) {
      console.error('Error fetching suggestions:', error);
      // Don't show error toast, just silently fail
      setSuggestionsLoaded(true);
    } finally {
      setLoadingSuggestions(false);
    }
  }, [selectedChat, messages, loadingSuggestions, suggestionsLoaded]);

  // Handle suggestion click
  const handleSuggestionClick = (text: string) => {
    setNewMessage(text);
  };

  // Send suggestion directly
  const handleSuggestionSend = async (text: string) => {
    if (!selectedAccount || !selectedChat || sending) return;
    
    setSending(true);
    try {
      const response = await supabase.functions.invoke('unipile-search', {
        body: { 
          action: 'send_message', 
          account_id: selectedAccount,
          chat_id: selectedChat.id,
          text: text.trim(),
        },
      });

      if (response.error) throw response.error;
      if (!response.data?.success) throw new Error(response.data?.error);

      // Add the message optimistically
      const sentMessage: Message = {
        id: Date.now().toString(),
        text: text.trim(),
        timestamp: new Date().toISOString(),
        is_sender: true,
      };
      setMessages(prev => [...prev, sentMessage]);
      setReplySuggestions([]);
      setSuggestionsLoaded(false);
      
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
    // First try attendees array - this is the actual contact name
    const attendee = chat.attendees?.[0];
    
    if (attendee) {
      // Try different name formats from Unipile API
      if (attendee.display_name) return attendee.display_name;
      if (attendee.name) return attendee.name;
      if (attendee.first_name || attendee.last_name) {
        return `${attendee.first_name || ''} ${attendee.last_name || ''}`.trim();
      }
      // Try to extract from public_identifier (e.g., john-doe-12345 -> John Doe)
      if (attendee.public_identifier) {
        const cleanId = attendee.public_identifier.replace(/-\d+$/, '').replace(/-/g, ' ');
        if (cleanId.length > 2) {
          return cleanId.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        }
      }
      // Try profile URL to extract identifier
      if (attendee.profile_url) {
        const match = attendee.profile_url.match(/\/in\/([^\/]+)/);
        if (match && match[1]) {
          const cleanId = match[1].replace(/-\d+$/, '').replace(/-/g, ' ');
          if (cleanId.length > 2 && !/^[A-Z]{20,}$/i.test(cleanId)) {
            return cleanId.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
          }
        }
      }
    }
    // Then try chat name (for group chats or InMail subjects)
    if (chat.name) return chat.name;
    // Try subject for InMails
    if (chat.subject) return chat.subject;
    // Show timestamp as identifier if available
    if (chat.timestamp) {
      const date = new Date(chat.timestamp);
      return `Conversation du ${date.toLocaleDateString('fr-FR')}`;
    }
    return 'Conversation';
  };

  // Get headline for chat - show subject for InMails
  const getChatSubject = (chat: Chat) => {
    if (chat.content_type === 'inmail' && chat.subject) {
      return chat.subject;
    }
    return null;
  };

  // Get headline for chat
  const getChatHeadline = (chat: Chat) => {
    const attendee = chat.attendees?.[0];
    // Unipile stores occupation in specifics.occupation
    return attendee?.headline || attendee?.occupation || attendee?.specifics?.occupation;
  };

  // Get avatar for chat - Unipile uses picture_url
  const getChatAvatar = (chat: Chat) => {
    const attendee = chat.attendees?.find(a => a.picture_url || a.profile_picture_url);
    return attendee?.picture_url || attendee?.profile_picture_url;
  };

  // Check if chat has unread messages - MUST return boolean to avoid React rendering "0"
  const hasUnread = (chat: Chat): boolean => {
    const count = chat.unread_count ?? chat.unread ?? 0;
    return count > 0;
  };

  const getUnreadCount = (chat: Chat): number => {
    return chat.unread_count ?? chat.unread ?? 0;
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

  // Get the profile_id from chat attendee (for matching with sequence enrollments)
  const getChatProfileId = (chat: Chat): string | null => {
    const attendee = chat.attendees?.[0];
    return attendee?.provider_id || attendee?.attendee_provider_id || chat.attendee_provider_id || null;
  };

  // Get job info for a chat if the profile is in a sequence
  const getChatJobInfo = (chat: Chat): SequenceEnrollmentInfo | null => {
    const profileId = getChatProfileId(chat);
    if (!profileId) return null;
    return enrollmentsMap.get(profileId) || null;
  };

  // Get conversation status text and icon for chat preview
  const getChatStatusInfo = (chat: Chat): { text: string; icon: React.ReactNode; color: string } | null => {
    const jobInfo = getChatJobInfo(chat);
    
    // Priority 1: Check if we have unread messages (they sent something, we need to reply)
    if (hasUnread(chat)) {
      // Show job info alongside if available
      const suffix = jobInfo?.job_title ? ` · ${jobInfo.job_title}` : '';
      return {
        text: `À répondre${suffix}`,
        icon: <Reply className="w-3 h-3" />,
        color: 'text-amber-600'
      };
    }
    
    // Priority 2: Check if we're in an active sequence waiting for their reply
    if (jobInfo && jobInfo.status === 'active' && !jobInfo.replied_at && jobInfo.current_step_order > 0) {
      return {
        text: `En attente · ${jobInfo.job_title || 'Séquence'}`,
        icon: <Hourglass className="w-3 h-3" />,
        color: 'text-blue-600'
      };
    }
    
    // Priority 3: Just show job info if available
    if (jobInfo?.job_title) {
      return {
        text: jobInfo.job_title,
        icon: <Briefcase className="w-3 h-3" />,
        color: 'text-violet-600'
      };
    }
    
    // No useful info to show
    return null;
  };

  // Get message source type (Classic, Recruiter, or InMail)
  const getMessageSourceType = (chat: Chat): { label: string; color: string } | null => {
    const folders = chat.folder || [];
    
    // Check for InMail first
    if (chat.content_type === 'inmail') {
      return { label: 'InMail', color: 'bg-purple-100 text-purple-700 border-purple-200' };
    }
    
    // Check folder names for Recruiter
    const hasRecruiter = folders.some(f => 
      f.toLowerCase().includes('recruiter') || 
      f.toLowerCase().includes('talent')
    );
    if (hasRecruiter) {
      return { label: 'Recruiter', color: 'bg-amber-100 text-amber-700 border-amber-200' };
    }
    
    // Check for Sales Navigator
    const hasSalesNav = folders.some(f => 
      f.toLowerCase().includes('sales') || 
      f.toLowerCase().includes('navigator')
    );
    if (hasSalesNav) {
      return { label: 'Sales Nav', color: 'bg-blue-100 text-blue-700 border-blue-200' };
    }
    
    // Default to Classic for regular LinkedIn messages
    const hasClassic = folders.some(f => 
      f.toLowerCase().includes('classic') || 
      f.toLowerCase().includes('inbox')
    );
    if (hasClassic || folders.length > 0) {
      return { label: 'Classic', color: 'bg-slate-100 text-slate-600 border-slate-200' };
    }
    
    return null;
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
          {/* Unread filter toggle */}
          <Button
            variant={showUnreadOnly ? "default" : "outline"}
            size="sm"
            className={cn(
              "w-full h-8 text-xs gap-2",
              showUnreadOnly && "bg-[#0077B5] hover:bg-[#005E93]"
            )}
            onClick={() => setShowUnreadOnly(!showUnreadOnly)}
          >
            <Reply className="w-3 h-3" />
            Non lus uniquement
            {chats.filter(c => hasUnread(c)).length > 0 && (
              <Badge variant="secondary" className={cn(
                "ml-auto h-5 px-1.5 text-[10px]",
                showUnreadOnly && "bg-white/20 text-white"
              )}>
                {chats.filter(c => hasUnread(c)).length}
              </Badge>
            )}
          </Button>
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
                    selectedChat?.id === chat.id && "bg-[#0077B5]/5",
                    hasUnread(chat) && "bg-[#0077B5]/3"
                  )}
                >
                  {/* Avatar with unread indicator */}
                  <div className="relative shrink-0">
                    <Avatar className="w-12 h-12">
                      <AvatarImage src={getChatAvatar(chat)} />
                      <AvatarFallback className="bg-[#0077B5]/10 text-[#0077B5] font-medium">
                        {getInitials(getChatDisplayName(chat))}
                      </AvatarFallback>
                    </Avatar>
                    {hasUnread(chat) && (
                      <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-[#0077B5] rounded-full flex items-center justify-center text-[9px] text-white font-bold">
                        {getUnreadCount(chat)}
                      </span>
                    )}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className={cn(
                          "text-sm truncate",
                          hasUnread(chat) ? "font-semibold text-[#1A1A1A]" : "font-medium text-[#1A1A1A]"
                        )}>
                          {getChatDisplayName(chat)}
                        </span>
                        {/* Source type badge */}
                        {(() => {
                          const sourceType = getMessageSourceType(chat);
                          if (sourceType) {
                            return (
                              <span className={cn(
                                "shrink-0 px-1.5 py-0.5 text-[9px] font-medium rounded border",
                                sourceType.color
                              )}>
                                {sourceType.label}
                              </span>
                            );
                          }
                          return null;
                        })()}
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {formatChatTime(chat.timestamp)}
                      </span>
                    </div>
                    
                    {/* Show headline or InMail subject */}
                    {(getChatHeadline(chat) || getChatSubject(chat)) && (
                      <p className="text-[10px] text-muted-foreground truncate">
                        {getChatSubject(chat) ? (
                          <span className="italic">📧 {getChatSubject(chat)}</span>
                        ) : (
                          getChatHeadline(chat)
                        )}
                      </p>
                    )}
                    
                    {/* Status info: Job reference or response status */}
                    {(() => {
                      const statusInfo = getChatStatusInfo(chat);
                      if (statusInfo) {
                        return (
                          <p className={cn("text-xs truncate mt-0.5 flex items-center gap-1", statusInfo.color)}>
                            {statusInfo.icon}
                            <span>{statusInfo.text}</span>
                          </p>
                        );
                      }
                      return null;
                    })()}
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
                <AvatarFallback className="bg-[#0077B5]/10 text-[#0077B5] font-medium">
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
                {getChatSubject(selectedChat) && (
                  <p className="text-[10px] text-[#0077B5] truncate flex items-center gap-1">
                    <span>📧</span> {getChatSubject(selectedChat)}
                  </p>
                )}
              </div>
              
              {/* Link to LinkedIn profile */}
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

            {/* Reply Suggestions */}
            <div className="px-3 pt-2 border-t border-[#1A1A1A]/10">
              {/* Generate suggestions button */}
              {!suggestionsLoaded && messages.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={fetchReplySuggestions}
                  disabled={loadingSuggestions}
                  className="w-full h-8 text-xs gap-2 text-[#0077B5] hover:text-[#005E93] hover:bg-[#0077B5]/5 mb-2"
                >
                  {loadingSuggestions ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Sparkles className="w-3 h-3" />
                  )}
                  {loadingSuggestions ? 'Génération en cours...' : 'Proposer des réponses IA'}
                </Button>
              )}
              
              {/* Suggestions chips */}
              {replySuggestions.length > 0 && (
                <div className="flex flex-col gap-1.5 mb-2">
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Sparkles className="w-3 h-3 text-[#0077B5]" />
                    <span>Réponses suggérées</span>
                    <button 
                      onClick={() => { setReplySuggestions([]); setSuggestionsLoaded(false); }}
                      className="ml-auto text-muted-foreground hover:text-foreground"
                    >
                      ✕
                    </button>
                  </div>
                  {replySuggestions.map((suggestion, idx) => (
                    <div
                      key={idx}
                      className="group flex items-start gap-2 p-2 bg-[#0077B5]/5 hover:bg-[#0077B5]/10 rounded-lg cursor-pointer transition-colors"
                      onClick={() => handleSuggestionClick(suggestion.text)}
                    >
                      <p className="flex-1 text-xs text-[#1A1A1A] line-clamp-2">
                        {suggestion.text}
                      </p>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSuggestionSend(suggestion.text);
                        }}
                        disabled={sending}
                        title="Envoyer directement"
                      >
                        {sending ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Zap className="w-3 h-3 text-[#0077B5]" />
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Message Input */}
            <div className="px-3 pb-3">
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
