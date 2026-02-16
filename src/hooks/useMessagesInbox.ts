import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  getChatDisplayName,
  getChatHeadline,
  getChatJobInfo,
  getAttendeeProfileId,
  getMessageText,
  isRecruiterChat,
  isClassicChat,
  hasUnread,
  getUnreadCount,
  buildChatSearchText,
} from './useMessagesInboxHelpers';

// Types
export interface ChatAttendee {
  name?: string;
  display_name?: string;
  profile_picture_url?: string;
  picture_url?: string;
  profile_url?: string;
  attendee_provider_id?: string;
  provider_id?: string;
  headline?: string;
  occupation?: string;
  first_name?: string;
  last_name?: string;
  public_identifier?: string;
  specifics?: {
    occupation?: string;
  };
}

export interface Chat {
  id: string;
  account_id: string;
  account_type?: string;
  name?: string;
  subject?: string;
  timestamp?: string;
  unread_count?: number;
  unread?: number;
  attendees?: ChatAttendee[];
  attendee_provider_id?: string;
  folder?: string[];
  content_type?: string;
  last_message?: {
    text?: string;
    text_content?: string;
    sender_id?: string;
    timestamp?: string;
    is_sender?: boolean;
  };
}

export interface Message {
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
  seen?: number;
  delivered?: boolean;
}

export interface SequenceEnrollmentInfo {
  profile_id: string;
  job_title: string | null;
  job_id: string | null;
  status: string;
  replied_at: string | null;
  current_step_order: number;
}

export interface JobData {
  id: string;
  title: string;
  client?: { name: string; sector: string } | null;
  skills: string[];
  seniority?: string;
  location?: string;
  remote?: string;
  salaryMin?: number;
  salaryMax?: number;
  tjmMin?: number;
  tjmMax?: number;
  contractType?: string;
  description?: string;
  requirements?: string;
  mustHave?: string;
  shouldHave?: string;
  niceToHave?: string;
  sourcingCriteria?: string;
  teamInfo?: string;
  xpMin?: number;
  xpMax?: number;
  transversalCriteria?: {
    must?: string;
    should?: string;
    niceToHave?: string;
    context?: string;
  };
}

interface UseMessagesInboxOptions {
  selectedAccount: string | null;
  onUnreadCountChange?: (count: number) => void;
}

export function useMessagesInbox({ selectedAccount, onUnreadCountChange }: UseMessagesInboxOptions) {
  // Chat state
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
  
  // Filters
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'classic' | 'recruiter'>('all');
  
  // Context data
  const [enrollmentsMap, setEnrollmentsMap] = useState<Map<string, SequenceEnrollmentInfo>>(new Map());
  const [availableJobs, setAvailableJobs] = useState<JobData[]>([]);
  const [sequences, setSequences] = useState<Array<{ id: string; name: string; steps: any[] }>>([]);
  
  // Reply suggestions
  const [replySuggestions, setReplySuggestions] = useState<Array<{ text: string; type: string }>>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [suggestionsLoaded, setSuggestionsLoaded] = useState(false);
  
  // AI Tone preference
  const [selectedTone, setSelectedTone] = useState<'formal' | 'casual' | 'direct' | 'empathetic'>('casual');
  
  // Analysis data from NurturingPanel
  const [analysisData, setAnalysisData] = useState<{
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
  } | null>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  
  // Modals
  const [showSequenceSelect, setShowSequenceSelect] = useState(false);
  const [showPipelineModal, setShowPipelineModal] = useState(false);
  const [pipelinePreSelectedJobId, setPipelinePreSelectedJobId] = useState<string | undefined>();

  // Fetch sequence enrollments
  const fetchEnrollments = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('sequence_enrollments')
        .select('profile_id, job_title, job_id, status, replied_at, current_step_order')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      
      const map = new Map<string, SequenceEnrollmentInfo>();
      data?.forEach(enrollment => {
        if (!map.has(enrollment.profile_id)) {
          map.set(enrollment.profile_id, enrollment);
        }
      });
      setEnrollmentsMap(map);
    } catch (error) {
      console.error('Error fetching enrollments:', error);
    }
  }, []);

  // Fetch available jobs from Notion
  const fetchAvailableJobs = useCallback(async () => {
    try {
      const response = await supabase.functions.invoke('fetch-notion-jobs', {
        body: { status: 'Publié' },
      });
      
      if (response.error) throw response.error;
      
      if (response.data?.jobs) {
        const jobs: JobData[] = response.data.jobs.slice(0, 30).map((job: any) => ({
          id: job.id,
          title: job.title || 'Poste',
          client: job.client,
          skills: job.skills || [],
          seniority: job.seniority,
          location: job.location,
          remote: job.remote,
          salaryMin: job.salaryMin,
          salaryMax: job.salaryMax,
          tjmMin: job.tjmMin || job.tjm,
          tjmMax: job.tjmMax,
          contractType: job.contractType,
          description: job.description,
          requirements: job.requirements,
          mustHave: job.mustHave,
          shouldHave: job.shouldHave,
          niceToHave: job.niceToHave,
          sourcingCriteria: job.sourcingCriteria,
          teamInfo: job.teamInfo,
          xpMin: job.xpMin,
          xpMax: job.xpMax,
          transversalCriteria: job.transversalCriteria,
        }));
        setAvailableJobs(jobs);
      }
    } catch (error) {
      console.error('Error fetching jobs for matching:', error);
    }
  }, []);

  // Fetch active sequences
  const fetchSequences = useCallback(async () => {
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return;
      
      const { data, error } = await supabase
        .from('outreach_sequences')
        .select(`
          id,
          name,
          sequence_steps (
            id,
            step_order,
            action_type,
            delay_days,
            delay_hours
          )
        `)
        .eq('is_active', true)
        .eq('created_by', user.user.id)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      setSequences(data?.map(s => ({
        id: s.id,
        name: s.name,
        steps: s.sequence_steps || [],
      })) || []);
    } catch (error) {
      console.error('Error fetching sequences:', error);
    }
  }, []);

  // Fetch all chats
  const fetchChats = useCallback(async (showToast = false) => {
    if (!selectedAccount) return;

    setLoadingChats(true);
    try {
      const response = await supabase.functions.invoke('unipile-search', {
        body: { 
          action: 'get_chats', 
          account_id: selectedAccount,
          limit: 250,
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

  // Fetch messages for a chat - use ref for cursor to avoid stale closure
  const cursorRef = useRef<string | null>(null);
  cursorRef.current = cursor;
  
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
          cursor: loadMore ? cursorRef.current : undefined,
        },
      });

      if (response.error) throw response.error;
      if (!response.data?.success) throw new Error(response.data?.error);

      const newMessages = response.data.messages || [];
      
      if (loadMore) {
        setMessages(prev => [...newMessages, ...prev]);
      } else {
        setMessages(newMessages.reverse());
      }
      
      setCursor(response.data.cursor);
      setHasMore(!!response.data.cursor);
    } catch (error) {
      console.error('Error fetching messages:', error);
      toast.error('Erreur lors du chargement des messages');
    } finally {
      setLoadingMessages(false);
    }
  }, [selectedAccount]);

  // Send a message
  const sendMessage = useCallback(async () => {
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

      const sentMessage: Message = {
        id: Date.now().toString(),
        text: newMessage.trim(),
        timestamp: new Date().toISOString(),
        is_sender: true,
      };
      setMessages(prev => [...prev, sentMessage]);
      setNewMessage('');
      
      // Mark chat as read locally after sending
      markChatAsReadLocally(selectedChat.id);
      
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
  }, [selectedAccount, selectedChat, newMessage]);

  // Send suggestion directly
  const handleSuggestionSend = useCallback(async (text: string) => {
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

      const sentMessage: Message = {
        id: Date.now().toString(),
        text: text.trim(),
        timestamp: new Date().toISOString(),
        is_sender: true,
      };
      setMessages(prev => [...prev, sentMessage]);
      setReplySuggestions([]);
      setSuggestionsLoaded(false);
      
      // Mark chat as read locally after sending
      if (selectedChat) markChatAsReadLocally(selectedChat.id);
      
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
  }, [selectedAccount, selectedChat, sending]);

  // Fetch AI reply suggestions
  const fetchReplySuggestions = useCallback(async () => {
    if (!selectedChat || messages.length === 0 || loadingSuggestions || suggestionsLoaded) return;
    
    setLoadingSuggestions(true);
    try {
      const recipientName = getChatDisplayName(selectedChat);
      const recipientHeadline = getChatHeadline(selectedChat);
      const jobInfo = getChatJobInfo(selectedChat, enrollmentsMap);
      
      let enrichedJobData: JobData | undefined;
      if (jobInfo?.job_id) {
        enrichedJobData = availableJobs.find(j => j.id === jobInfo.job_id);
      }
      
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
              company: enrichedJobData?.client?.name,
            } : undefined,
            jobData: enrichedJobData ? {
              id: enrichedJobData.id,
              title: enrichedJobData.title,
              client: enrichedJobData.client,
              skills: enrichedJobData.skills || [],
              requirements: enrichedJobData.requirements,
              description: enrichedJobData.description,
              seniority: enrichedJobData.seniority,
              location: enrichedJobData.location,
              remote: enrichedJobData.remote,
              xpMin: enrichedJobData.xpMin,
              xpMax: enrichedJobData.xpMax,
              salaryMin: enrichedJobData.salaryMin,
              salaryMax: enrichedJobData.salaryMax,
              tjmMin: enrichedJobData.tjmMin,
              tjmMax: enrichedJobData.tjmMax,
              contractType: enrichedJobData.contractType,
              mustHave: enrichedJobData.mustHave,
              shouldHave: enrichedJobData.shouldHave,
              niceToHave: enrichedJobData.niceToHave,
              transversalCriteria: enrichedJobData.transversalCriteria,
            } : undefined,
            // Pass all available jobs to constrain AI suggestions
            availableJobs: availableJobs.map(j => ({
              id: j.id,
              title: j.title,
              skills: j.skills || [],
              client: j.client,
            })),
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
      setSuggestionsLoaded(true);
    } finally {
      setLoadingSuggestions(false);
    }
  }, [selectedChat, messages, loadingSuggestions, suggestionsLoaded, availableJobs, enrollmentsMap]);

  // Handle suggestion click
  const handleSuggestionClick = useCallback((text: string) => {
    setNewMessage(text);
  }, []);

  // Enroll in sequence
  const enrollInSequence = useCallback(async (sequence: { id: string; name: string; steps: any[] }) => {
    if (!selectedChat || !selectedAccount) return;
    
    const profileId = getAttendeeProfileId(selectedChat);
    if (!profileId) {
      toast.error('Impossible d\'identifier le profil');
      return;
    }
    
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error('Non authentifié');
      
      const { data: existing } = await supabase
        .from('sequence_enrollments')
        .select('id')
        .eq('sequence_id', sequence.id)
        .eq('profile_id', profileId)
        .eq('status', 'active')
        .single();
      
      if (existing) {
        toast.info('Déjà inscrit dans cette séquence');
        setShowSequenceSelect(false);
        return;
      }
      
      const { error } = await supabase
        .from('sequence_enrollments')
        .insert({
          sequence_id: sequence.id,
          account_id: selectedAccount,
          profile_id: profileId,
          profile_name: getChatDisplayName(selectedChat),
          profile_headline: getChatHeadline(selectedChat),
          profile_url: selectedChat.attendees?.[0]?.profile_url,
          created_by: user.user.id,
          user_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          status: 'active',
          current_step_order: 0,
        });
      
      if (error) throw error;
      
      toast.success(`✨ Inscrit dans "${sequence.name}"`, {
        description: `${getChatDisplayName(selectedChat)} va recevoir les étapes de la séquence.`,
      });
      setShowSequenceSelect(false);
      fetchEnrollments();
    } catch (error) {
      console.error('Error enrolling in sequence:', error);
      toast.error('Erreur lors de l\'inscription');
    }
  }, [selectedChat, selectedAccount, fetchEnrollments]);

  // Handle adding to pipeline
  const handleAddToPipeline = useCallback((jobId?: string) => {
    if (!selectedChat) return;
    setPipelinePreSelectedJobId(jobId);
    setShowPipelineModal(true);
  }, [selectedChat]);

  // Handle enrolling in sequence
  const handleEnrollInSequence = useCallback(() => {
    if (!selectedChat || sequences.length === 0) {
      toast.error('Aucune séquence active', {
        description: 'Créez une séquence dans l\'onglet Séquences d\'abord.',
      });
      return;
    }
    setShowSequenceSelect(true);
  }, [selectedChat, sequences.length]);

  // Handle scheduling call
  const handleScheduleCall = useCallback(() => {
    if (!selectedChat) return;
    
    const profileName = getChatDisplayName(selectedChat);
    
    toast.info('📅 Planifier un call', {
      description: `Fonctionnalité en développement pour ${profileName}`,
      action: {
        label: 'Copier le nom',
        onClick: () => {
          navigator.clipboard.writeText(profileName);
          toast.success('Nom copié !');
        },
      },
    });
  }, [selectedChat]);

  // Helper: mark a chat as read locally (set unread_count/unread to 0)
  const markChatAsReadLocally = useCallback((chatId: string) => {
    setChats(prev => prev.map(c =>
      c.id === chatId ? { ...c, unread_count: 0, unread: 0 } : c
    ));
    // Also update selectedChat if it matches
    setSelectedChat(prev =>
      prev && prev.id === chatId ? { ...prev, unread_count: 0, unread: 0 } : prev
    );
  }, []);

  // Filter chats effect
  useEffect(() => {
    let result = chats;
    
    if (sourceFilter === 'recruiter') {
      result = result.filter(chat => isRecruiterChat(chat));
    } else if (sourceFilter === 'classic') {
      result = result.filter(chat => isClassicChat(chat));
    }
    
    if (showUnreadOnly) {
      result = result.filter(chat => hasUnread(chat));
    }
    
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(chat => buildChatSearchText(chat).includes(query));
    }
    
    setFilteredChats(result);
  }, [searchQuery, chats, showUnreadOnly, sourceFilter]);

  // Unread count effect
  useEffect(() => {
    const totalUnread = chats.reduce((acc, chat) => acc + getUnreadCount(chat), 0);
    onUnreadCountChange?.(totalUnread);
  }, [chats, onUnreadCountChange]);

  // Load chats on account change
  useEffect(() => {
    if (selectedAccount) {
      fetchChats();
      fetchEnrollments();
      fetchAvailableJobs();
      fetchSequences();
      setSelectedChat(null);
      setMessages([]);
    }
  }, [selectedAccount, fetchChats, fetchEnrollments, fetchAvailableJobs, fetchSequences]);

  // Load messages on chat selection & mark as read
  useEffect(() => {
    if (selectedChat) {
      fetchMessages(selectedChat.id);
      setReplySuggestions([]);
      setSuggestionsLoaded(false);
      // Mark as read locally when opening a conversation
      markChatAsReadLocally(selectedChat.id);
    }
  }, [selectedChat?.id, fetchMessages]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (!loadingMessages && messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loadingMessages]);

  return {
    // Chat state
    chats,
    filteredChats,
    selectedChat,
    setSelectedChat,
    messages,
    loadingChats,
    loadingMessages,
    searchQuery,
    setSearchQuery,
    newMessage,
    setNewMessage,
    sending,
    hasMore,
    messagesEndRef,
    messagesContainerRef,
    
    // Filters
    showUnreadOnly,
    setShowUnreadOnly,
    sourceFilter,
    setSourceFilter,
    
    // Context data
    enrollmentsMap,
    availableJobs,
    sequences,
    
    // Suggestions
    replySuggestions,
    setReplySuggestions,
    loadingSuggestions,
    suggestionsLoaded,
    setSuggestionsLoaded,
    
    // Tone & Analysis
    selectedTone,
    setSelectedTone,
    analysisData,
    setAnalysisData,
    loadingAnalysis,
    setLoadingAnalysis,
    
    // Modals
    showSequenceSelect,
    setShowSequenceSelect,
    showPipelineModal,
    setShowPipelineModal,
    pipelinePreSelectedJobId,
    setPipelinePreSelectedJobId,
    
    // Actions
    fetchChats,
    fetchMessages,
    sendMessage,
    handleSuggestionClick,
    handleSuggestionSend,
    fetchReplySuggestions,
    enrollInSequence,
    handleAddToPipeline,
    handleEnrollInSequence,
    handleScheduleCall,
  };
}
