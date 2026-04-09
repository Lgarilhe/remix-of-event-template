import { useCallback, useRef, useEffect, useReducer } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { invokeUnipile } from '@/lib/invokeUnipile';
import { emitQuotaAction } from '@/lib/quotaEvents';
import { toast } from 'sonner';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useChatCategories } from './useChatCategories';
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
  id?: string; // Unipile attendee ID (needed for fetching profile picture)
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
  // Merged chat support: when multiple threads exist for the same candidate
  _mergedChatIds?: string[];
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

// ── Merge chats by candidate ─────────────────────────────
// Groups chats with the same attendee (same LinkedIn profile) into a single entry
function mergeChatsByCandidate(chats: Chat[]): Chat[] {
  const profileMap = new Map<string, Chat[]>();
  const noProfileChats: Chat[] = [];

  for (const chat of chats) {
    const attendee = chat.attendees?.[0];
    const profileId = attendee?.attendee_provider_id || attendee?.provider_id || null;
    if (!profileId) { noProfileChats.push(chat); continue; }
    if (!profileMap.has(profileId)) profileMap.set(profileId, []);
    profileMap.get(profileId)!.push(chat);
  }

  const merged: Chat[] = [];
  for (const [, group] of profileMap) {
    if (group.length === 1) { merged.push(group[0]); continue; }
    group.sort((a, b) => (new Date(b.timestamp || '').getTime() || 0) - (new Date(a.timestamp || '').getTime() || 0));
    const primary = { ...group[0] };
    primary._mergedChatIds = group.map(c => c.id);
    primary.unread_count = group.reduce((sum, c) => sum + (c.unread_count ?? c.unread ?? 0), 0);
    primary.unread = primary.unread_count;
    const allFolders = new Set<string>();
    for (const c of group) (c.folder || []).forEach(f => allFolders.add(f));
    primary.folder = Array.from(allFolders);
    const bestLastMsg = group.reduce((best, c) => {
      if (!c.last_message?.timestamp) return best;
      if (!best?.timestamp) return c.last_message;
      return new Date(c.last_message.timestamp).getTime() > new Date(best.timestamp).getTime() ? c.last_message : best;
    }, group[0].last_message);
    primary.last_message = bestLastMsg;
    merged.push(primary);
  }
  merged.push(...noProfileChats);
  merged.sort((a, b) => (new Date(b.timestamp || '').getTime() || 0) - (new Date(a.timestamp || '').getTime() || 0));
  return merged;
}


function areMessagesEquivalent(a: Message[], b: Message[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];

    if (
      left.id !== right.id ||
      left.timestamp !== right.timestamp ||
      left.is_sender !== right.is_sender ||
      left.read !== right.read ||
      left.seen !== right.seen ||
      left.delivered !== right.delivered ||
      getMessageText(left) !== getMessageText(right)
    ) {
      return false;
    }
  }

  return true;
}

interface UseMessagesInboxOptions {
  selectedAccount: string | null;
  onUnreadCountChange?: (count: number) => void;
  initialChatId?: string | null;
  onChatChange?: (chatId: string | null) => void;
}

// ── Reducer: Chat State ─────────────────────────────────
interface ChatState {
  chats: Chat[];
  filteredChats: Chat[];
  selectedChat: Chat | null;
  messages: Message[];
  loadingChats: boolean;
  loadingMessages: boolean;
  sending: boolean;
  cursor: string | null;
  hasMore: boolean;
  chatCursors: Record<string, string | null>;
  hasMoreChats: boolean;
  loadingMoreChats: boolean;
  loadingAllChats: boolean;
}

type ChatAction =
  | { type: 'SET_CHATS'; chats: Chat[] }
  | { type: 'UPDATE_CHATS'; updater: (prev: Chat[]) => Chat[] }
  | { type: 'SET_FILTERED_CHATS'; chats: Chat[] }
  | { type: 'SELECT_CHAT'; chat: Chat | null }
  | { type: 'UPDATE_SELECTED_CHAT'; updater: (prev: Chat | null) => Chat | null }
  | { type: 'SET_MESSAGES'; messages: Message[] }
  | { type: 'UPDATE_MESSAGES'; updater: (prev: Message[]) => Message[] }
  | { type: 'LOADING_CHATS'; loading: boolean }
  | { type: 'LOADING_MESSAGES'; loading: boolean }
  | { type: 'SENDING'; sending: boolean }
  | { type: 'SET_CURSOR'; cursor: string | null; hasMore: boolean }
  | { type: 'SET_CHAT_PAGINATION'; cursors: Record<string, string | null>; hasMore: boolean }
  | { type: 'LOADING_MORE_CHATS'; loading: boolean }
  | { type: 'LOADING_ALL_CHATS'; loading: boolean }
  | { type: 'FETCH_CHATS_SUCCESS'; chats: Chat[]; cursors: Record<string, string | null>; hasMore: boolean }
  | { type: 'MARK_CHAT_READ'; chatId: string };

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'SET_CHATS': return { ...state, chats: action.chats };
    case 'UPDATE_CHATS': return { ...state, chats: action.updater(state.chats) };
    case 'SET_FILTERED_CHATS': return { ...state, filteredChats: action.chats };
    case 'SELECT_CHAT': return { ...state, selectedChat: action.chat };
    case 'UPDATE_SELECTED_CHAT': return { ...state, selectedChat: action.updater(state.selectedChat) };
    case 'SET_MESSAGES': return { ...state, messages: action.messages };
    case 'UPDATE_MESSAGES': return { ...state, messages: action.updater(state.messages) };
    case 'LOADING_CHATS': return { ...state, loadingChats: action.loading };
    case 'LOADING_MESSAGES': return { ...state, loadingMessages: action.loading };
    case 'SENDING': return { ...state, sending: action.sending };
    case 'SET_CURSOR': return { ...state, cursor: action.cursor, hasMore: action.hasMore };
    case 'SET_CHAT_PAGINATION': return { ...state, chatCursors: action.cursors, hasMoreChats: action.hasMore };
    case 'LOADING_MORE_CHATS': return { ...state, loadingMoreChats: action.loading };
    case 'LOADING_ALL_CHATS': return { ...state, loadingAllChats: action.loading };
    case 'FETCH_CHATS_SUCCESS': return {
      ...state,
      chats: action.chats,
      filteredChats: action.chats,
      chatCursors: action.cursors,
      hasMoreChats: action.hasMore,
      loadingChats: false,
    };
    case 'MARK_CHAT_READ': return {
      ...state,
      chats: state.chats.map(c => c.id === action.chatId ? { ...c, unread_count: 0, unread: 0 } : c),
      selectedChat: state.selectedChat?.id === action.chatId
        ? { ...state.selectedChat, unread_count: 0, unread: 0 }
        : state.selectedChat,
    };
    default: return state;
  }
}

// ── Reducer: UI State ───────────────────────────────────
interface UIState {
  searchQuery: string;
  newMessage: string;
  showUnreadOnly: boolean;
  sourceFilter: 'all' | 'classic' | 'recruiter';
  responseFilter: 'all' | 'waiting_candidate' | 'waiting_me';
  showSequenceSelect: boolean;
  showPipelineModal: boolean;
  pipelinePreSelectedJobId: string | undefined;
  selectedTone: 'formal' | 'casual' | 'direct' | 'empathetic';
  calendlyLink: string | null;
}

type UIAction =
  | { type: 'SET_SEARCH_QUERY'; value: string }
  | { type: 'SET_NEW_MESSAGE'; value: string }
  | { type: 'UPDATE_NEW_MESSAGE'; updater: (prev: string) => string }
  | { type: 'SET_SHOW_UNREAD_ONLY'; value: boolean }
  | { type: 'SET_SOURCE_FILTER'; value: 'all' | 'classic' | 'recruiter' }
  | { type: 'SET_RESPONSE_FILTER'; value: 'all' | 'waiting_candidate' | 'waiting_me' }
  | { type: 'SET_SHOW_SEQUENCE_SELECT'; value: boolean }
  | { type: 'SET_SHOW_PIPELINE_MODAL'; value: boolean }
  | { type: 'SET_PIPELINE_PRE_SELECTED_JOB_ID'; value: string | undefined }
  | { type: 'SET_SELECTED_TONE'; value: 'formal' | 'casual' | 'direct' | 'empathetic' }
  | { type: 'SET_CALENDLY_LINK'; value: string | null }
  | { type: 'OPEN_PIPELINE_MODAL'; jobId?: string };

function uiReducer(state: UIState, action: UIAction): UIState {
  switch (action.type) {
    case 'SET_SEARCH_QUERY': return { ...state, searchQuery: action.value };
    case 'SET_NEW_MESSAGE': return { ...state, newMessage: action.value };
    case 'UPDATE_NEW_MESSAGE': return { ...state, newMessage: action.updater(state.newMessage) };
    case 'SET_SHOW_UNREAD_ONLY': return { ...state, showUnreadOnly: action.value };
    case 'SET_SOURCE_FILTER': return { ...state, sourceFilter: action.value };
    case 'SET_RESPONSE_FILTER': return { ...state, responseFilter: action.value };
    case 'SET_SHOW_SEQUENCE_SELECT': return { ...state, showSequenceSelect: action.value };
    case 'SET_SHOW_PIPELINE_MODAL': return { ...state, showPipelineModal: action.value };
    case 'SET_PIPELINE_PRE_SELECTED_JOB_ID': return { ...state, pipelinePreSelectedJobId: action.value };
    case 'SET_SELECTED_TONE': return { ...state, selectedTone: action.value };
    case 'SET_CALENDLY_LINK': return { ...state, calendlyLink: action.value };
    case 'OPEN_PIPELINE_MODAL': return { ...state, pipelinePreSelectedJobId: action.jobId, showPipelineModal: true };
    default: return state;
  }
}

// ── Reducer: Context / AI State ─────────────────────────
type AnalysisData = {
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
};

interface ContextState {
  enrollmentsMap: Map<string, SequenceEnrollmentInfo>;
  availableJobs: JobData[];
  sequences: Array<{ id: string; name: string; steps: any[] }>;
  replySuggestions: Array<{ text: string; type: string }>;
  loadingSuggestions: boolean;
  suggestionsLoaded: boolean;
  analysisData: AnalysisData | null;
  loadingAnalysis: boolean;
}

type ContextAction =
  | { type: 'SET_ENROLLMENTS_MAP'; map: Map<string, SequenceEnrollmentInfo> }
  | { type: 'SET_AVAILABLE_JOBS'; jobs: JobData[] }
  | { type: 'SET_SEQUENCES'; sequences: Array<{ id: string; name: string; steps: any[] }> }
  | { type: 'SET_REPLY_SUGGESTIONS'; suggestions: Array<{ text: string; type: string }> }
  | { type: 'SET_LOADING_SUGGESTIONS'; loading: boolean }
  | { type: 'SET_SUGGESTIONS_LOADED'; loaded: boolean }
  | { type: 'SET_ANALYSIS_DATA'; data: AnalysisData | null }
  | { type: 'SET_LOADING_ANALYSIS'; loading: boolean }
  | { type: 'RESET_SUGGESTIONS' };

function contextReducer(state: ContextState, action: ContextAction): ContextState {
  switch (action.type) {
    case 'SET_ENROLLMENTS_MAP': return { ...state, enrollmentsMap: action.map };
    case 'SET_AVAILABLE_JOBS': return { ...state, availableJobs: action.jobs };
    case 'SET_SEQUENCES': return { ...state, sequences: action.sequences };
    case 'SET_REPLY_SUGGESTIONS': return { ...state, replySuggestions: action.suggestions };
    case 'SET_LOADING_SUGGESTIONS': return { ...state, loadingSuggestions: action.loading };
    case 'SET_SUGGESTIONS_LOADED': return { ...state, suggestionsLoaded: action.loaded };
    case 'SET_ANALYSIS_DATA': return { ...state, analysisData: action.data };
    case 'SET_LOADING_ANALYSIS': return { ...state, loadingAnalysis: action.loading };
    case 'RESET_SUGGESTIONS': return { ...state, replySuggestions: [], suggestionsLoaded: false };
    default: return state;
  }
}

export function useMessagesInbox({ selectedAccount, onUnreadCountChange, initialChatId, onChatChange }: UseMessagesInboxOptions) {
  const { organizationId } = useOrganization();
  const { isReady, user } = useAuthReady();

  // ── Chat state (useReducer #1) ──
  const [chatState, chatDispatch] = useReducer(chatReducer, {
    chats: [],
    filteredChats: [],
    selectedChat: initialChatId ? { id: initialChatId, account_id: '' } as Chat : null,
    messages: [],
    loadingChats: false,
    loadingMessages: false,
    sending: false,
    cursor: null,
    hasMore: true,
    chatCursors: {},
    hasMoreChats: false,
    loadingMoreChats: false,
    loadingAllChats: false,
  });
  const { chats, filteredChats, selectedChat, messages, loadingChats, loadingMessages, sending, cursor, hasMore, chatCursors, hasMoreChats, loadingMoreChats, loadingAllChats } = chatState;

  const pendingInitialChatId = useRef<string | null>(initialChatId || null);
  const chatsRef = useRef<Chat[]>([]);
  chatsRef.current = chats;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Backward-compatible setSelectedChat wrapper
  const _setSelectedChat = useCallback((chatOrUpdater: Chat | null | ((prev: Chat | null) => Chat | null)) => {
    if (typeof chatOrUpdater === 'function') {
      chatDispatch({ type: 'UPDATE_SELECTED_CHAT', updater: chatOrUpdater });
    } else {
      chatDispatch({ type: 'SELECT_CHAT', chat: chatOrUpdater });
    }
  }, []);

  const setSelectedChat = useCallback((chat: Chat | null) => {
    chatDispatch({ type: 'SELECT_CHAT', chat });
    onChatChange?.(chat?.id || null);
  }, [onChatChange]);

  // Backward-compatible set* wrappers for chat state
  const setChats = useCallback((chatsOrUpdater: Chat[] | ((prev: Chat[]) => Chat[])) => {
    if (typeof chatsOrUpdater === 'function') {
      chatDispatch({ type: 'UPDATE_CHATS', updater: chatsOrUpdater });
    } else {
      chatDispatch({ type: 'SET_CHATS', chats: chatsOrUpdater });
    }
  }, []);
  const setFilteredChats = useCallback((c: Chat[]) => chatDispatch({ type: 'SET_FILTERED_CHATS', chats: c }), []);
  const setMessages = useCallback((msgsOrUpdater: Message[] | ((prev: Message[]) => Message[])) => {
    if (typeof msgsOrUpdater === 'function') {
      chatDispatch({ type: 'UPDATE_MESSAGES', updater: msgsOrUpdater });
    } else {
      chatDispatch({ type: 'SET_MESSAGES', messages: msgsOrUpdater });
    }
  }, []);
  const setLoadingChats = useCallback((v: boolean) => chatDispatch({ type: 'LOADING_CHATS', loading: v }), []);
  const setLoadingMessages = useCallback((v: boolean) => chatDispatch({ type: 'LOADING_MESSAGES', loading: v }), []);
  const setSending = useCallback((v: boolean) => chatDispatch({ type: 'SENDING', sending: v }), []);
  const setCursor = useCallback((c: string | null) => chatDispatch({ type: 'SET_CURSOR', cursor: c, hasMore: !!c }), []);
  const setHasMore = useCallback((_v: boolean) => { /* handled by SET_CURSOR */ }, []);
  const setChatCursors = useCallback((c: Record<string, string | null>) => {
    chatDispatch({ type: 'SET_CHAT_PAGINATION', cursors: c, hasMore: Object.values(c).some(v => v !== null) });
  }, []);
  const setHasMoreChats = useCallback((_v: boolean) => { /* handled by SET_CHAT_PAGINATION */ }, []);
  const setLoadingMoreChats = useCallback((v: boolean) => chatDispatch({ type: 'LOADING_MORE_CHATS', loading: v }), []);
  const setLoadingAllChats = useCallback((v: boolean) => chatDispatch({ type: 'LOADING_ALL_CHATS', loading: v }), []);

  // ── UI state (useReducer #2) ──
  const [uiState, uiDispatch] = useReducer(uiReducer, {
    searchQuery: '',
    newMessage: '',
    showUnreadOnly: false,
    sourceFilter: 'all' as const,
    responseFilter: 'all' as const,
    showSequenceSelect: false,
    showPipelineModal: false,
    pipelinePreSelectedJobId: undefined,
    selectedTone: 'casual' as const,
    calendlyLink: null,
  });
  const { searchQuery, newMessage, showUnreadOnly, sourceFilter, responseFilter, showSequenceSelect, showPipelineModal, pipelinePreSelectedJobId, selectedTone, calendlyLink } = uiState;

  // Backward-compatible set* wrappers for UI state
  const setSearchQuery = useCallback((v: string) => uiDispatch({ type: 'SET_SEARCH_QUERY', value: v }), []);
  const setNewMessage = useCallback((vOrUpdater: string | ((prev: string) => string)) => {
    if (typeof vOrUpdater === 'function') {
      uiDispatch({ type: 'UPDATE_NEW_MESSAGE', updater: vOrUpdater });
    } else {
      uiDispatch({ type: 'SET_NEW_MESSAGE', value: vOrUpdater });
    }
  }, []);
  const setShowUnreadOnly = useCallback((v: boolean) => uiDispatch({ type: 'SET_SHOW_UNREAD_ONLY', value: v }), []);
  const setSourceFilter = useCallback((v: 'all' | 'classic' | 'recruiter') => uiDispatch({ type: 'SET_SOURCE_FILTER', value: v }), []);
  const setResponseFilter = useCallback((v: 'all' | 'waiting_candidate' | 'waiting_me') => uiDispatch({ type: 'SET_RESPONSE_FILTER', value: v }), []);
  const setShowSequenceSelect = useCallback((v: boolean) => uiDispatch({ type: 'SET_SHOW_SEQUENCE_SELECT', value: v }), []);
  const setShowPipelineModal = useCallback((v: boolean) => uiDispatch({ type: 'SET_SHOW_PIPELINE_MODAL', value: v }), []);
  const setPipelinePreSelectedJobId = useCallback((v: string | undefined) => uiDispatch({ type: 'SET_PIPELINE_PRE_SELECTED_JOB_ID', value: v }), []);
  const setSelectedTone = useCallback((v: 'formal' | 'casual' | 'direct' | 'empathetic') => uiDispatch({ type: 'SET_SELECTED_TONE', value: v }), []);
  const setCalendlyLink = useCallback((v: string | null) => uiDispatch({ type: 'SET_CALENDLY_LINK', value: v }), []);

  // ── Context / AI state (useReducer #3) ──
  const [ctxState, ctxDispatch] = useReducer(contextReducer, {
    enrollmentsMap: new Map(),
    availableJobs: [],
    sequences: [],
    replySuggestions: [],
    loadingSuggestions: false,
    suggestionsLoaded: false,
    analysisData: null,
    loadingAnalysis: false,
  });
  const { enrollmentsMap, availableJobs, sequences, replySuggestions, loadingSuggestions, suggestionsLoaded, analysisData, loadingAnalysis } = ctxState;

  // Backward-compatible set* wrappers for context state
  const setEnrollmentsMap = useCallback((m: Map<string, SequenceEnrollmentInfo>) => ctxDispatch({ type: 'SET_ENROLLMENTS_MAP', map: m }), []);
  const setAvailableJobs = useCallback((j: JobData[]) => ctxDispatch({ type: 'SET_AVAILABLE_JOBS', jobs: j }), []);
  const setSequences = useCallback((s: Array<{ id: string; name: string; steps: any[] }>) => ctxDispatch({ type: 'SET_SEQUENCES', sequences: s }), []);
  const setReplySuggestions = useCallback((s: Array<{ text: string; type: string }>) => ctxDispatch({ type: 'SET_REPLY_SUGGESTIONS', suggestions: s }), []);
  const setLoadingSuggestions = useCallback((v: boolean) => ctxDispatch({ type: 'SET_LOADING_SUGGESTIONS', loading: v }), []);
  const setSuggestionsLoaded = useCallback((v: boolean) => ctxDispatch({ type: 'SET_SUGGESTIONS_LOADED', loaded: v }), []);
  const setAnalysisData = useCallback((d: AnalysisData | null) => ctxDispatch({ type: 'SET_ANALYSIS_DATA', data: d }), []);
  const setLoadingAnalysis = useCallback((v: boolean) => ctxDispatch({ type: 'SET_LOADING_ANALYSIS', loading: v }), []);

  // Chat categories
  const chatCategories = useChatCategories();

  // Fetch sequence enrollments
  const fetchEnrollments = useCallback(async () => {
    try {
      let query = supabase
        .from('sequence_enrollments')
        .select('profile_id, job_title, job_id, status, replied_at, current_step_order')
        .order('created_at', { ascending: false })
        .limit(500);
      
      if (organizationId) {
        query = query.eq('organization_id', organizationId);
      }

      const { data, error } = await query;
      
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
  }, [organizationId]);

  // Fetch available jobs from Notion
  const fetchAvailableJobs = useCallback(async () => {
    try {
      const response = await invokeEdgeFunction<{ jobs?: any[] }>('fetch-notion-jobs', { status: 'Publié' });
      
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
    if (!user) return;

    try {
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
        .eq('created_by', user.id)
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
  }, [user]);

  // Fetch all chats
  const fetchChats = useCallback(async (showToast = false) => {
    if (!selectedAccount) return;

    setLoadingChats(true);
    try {
      const { data } = await invokeUnipile({
        body: { 
          action: 'get_chats', 
          account_id: selectedAccount,
          limit: 250,
        },
      });

      if (!data?.success) throw new Error(data?.error as string);

      const fetchedChats = data.chats as Chat[] || [];
      const mergedChats = mergeChatsByCandidate(fetchedChats);
      setChats(mergedChats);
      setFilteredChats(mergedChats);
      
      // Store per-folder cursors for pagination
      if (data.cursors) {
        setChatCursors(data.cursors as Record<string, string | null>);
        setHasMoreChats(Object.values(data.cursors as Record<string, string | null>).some(c => c !== null));
      } else {
        setChatCursors({});
        setHasMoreChats(false);
      }
      
      // Replace placeholder with full chat object (without triggering onChatChange)
      if (pendingInitialChatId.current) {
        const match = mergedChats.find((c: Chat) => c.id === pendingInitialChatId.current || c._mergedChatIds?.includes(pendingInitialChatId.current!));
        if (match) {
          _setSelectedChat(match);
        }
        pendingInitialChatId.current = null;
      }
      
      if (showToast) toast.success('Conversations actualisées');
    } catch (error) {
      console.error('Error fetching chats:', error);
      toast.error('Erreur lors du chargement des conversations');
    } finally {
      setLoadingChats(false);
    }
  }, [selectedAccount]);

  // Load more chats using per-folder cursors
  const loadMoreChats = useCallback(async () => {
    if (!selectedAccount || !hasMoreChats || loadingMoreChats) return;

    setLoadingMoreChats(true);
    try {
      const { data } = await invokeUnipile({
        body: { 
          action: 'get_chats', 
          account_id: selectedAccount,
          limit: 250,
          cursors: chatCursors,
        },
      });

      if (!data?.success) throw new Error(data?.error as string);

      const newChats = data.chats as Chat[] || [];
      
      // Merge with existing chats, deduplicating by ID, then re-merge by candidate
      setChats(prev => {
        // Expand previously merged chats back to their originals for proper re-merge
        const allExisting: Chat[] = [];
        for (const c of prev) {
          if (c._mergedChatIds && c._mergedChatIds.length > 1) {
            // We only have the primary — keep it as-is since we don't have the originals anymore
            allExisting.push({ ...c, _mergedChatIds: undefined });
          } else {
            allExisting.push(c);
          }
        }
        const existingIds = new Set(allExisting.map(c => c.id));
        const uniqueNew = newChats.filter(c => !existingIds.has(c.id));
        const combined = [...allExisting, ...uniqueNew];
        return mergeChatsByCandidate(combined);
      });
      
      // Update cursors
      if (data.cursors) {
        setChatCursors(data.cursors as Record<string, string | null>);
        setHasMoreChats(Object.values(data.cursors as Record<string, string | null>).some(c => c !== null));
      } else {
        setChatCursors({});
        setHasMoreChats(false);
      }
      
      toast.success(`${newChats.length} conversations supplémentaires chargées`);
    } catch (error) {
      console.error('Error loading more chats:', error);
      toast.error('Erreur lors du chargement');
    } finally {
      setLoadingMoreChats(false);
    }
  }, [selectedAccount, chatCursors, hasMoreChats, loadingMoreChats]);

  // Load ALL remaining chats (for exhaustive search)
  const loadAllChats = useCallback(async () => {
    if (!selectedAccount || !hasMoreChats || loadingAllChats) return;

    setLoadingAllChats(true);
    let currentCursors = { ...chatCursors };
    const allNewChats: Chat[] = [];

    try {
      while (Object.values(currentCursors).some(c => c !== null)) {
        const { data } = await invokeUnipile({
          body: {
            action: 'get_chats',
            account_id: selectedAccount,
            limit: 250,
            cursors: currentCursors,
          },
        });

        if (!data?.success) break;

        const newChats = data.chats as Chat[] || [];
        allNewChats.push(...newChats);

        if (data.cursors) {
          currentCursors = data.cursors as Record<string, string | null>;
        } else {
          currentCursors = {};
        }

        if (newChats.length === 0) break;
      }

      // Single state update with all accumulated chats
      if (allNewChats.length > 0) {
        setChats(prev => {
          const allExisting = prev.map(c => ({ ...c, _mergedChatIds: undefined }));
          const existingIds = new Set(allExisting.map(c => c.id));
          const uniqueNew = allNewChats.filter(c => !existingIds.has(c.id));
          const combined = [...allExisting, ...uniqueNew];
          return mergeChatsByCandidate(combined);
        });
      }

      setChatCursors(currentCursors);
      setHasMoreChats(Object.values(currentCursors).some(c => c !== null));
      if (allNewChats.length > 0) {
        toast.success(`${allNewChats.length} conversations supplémentaires chargées`);
      }
    } catch (error) {
      console.error('Error loading all chats:', error);
      toast.error('Erreur lors du chargement complet');
    } finally {
      setLoadingAllChats(false);
    }
  }, [selectedAccount, chatCursors, hasMoreChats, loadingAllChats]);

  // Fetch messages for a chat - use ref for cursor to avoid stale closure
  const cursorRef = useRef<string | null>(null);
  cursorRef.current = cursor;
  
  const fetchMessages = useCallback(async (chatId: string, loadMore = false) => {
    if (!selectedAccount) return;

    // Resolve merged IDs from current chats state (avoid stale selectedChat closure)
    const chat = chatsRef.current.find(c => c.id === chatId || c._mergedChatIds?.includes(chatId));
    const mergedIds = chat?._mergedChatIds;
    const chatIds = (mergedIds && mergedIds.length > 1) ? mergedIds : [chatId];

    setLoadingMessages(true);
    try {
      if (loadMore) {
        // For load-more, only paginate the primary chat
        const { data } = await invokeUnipile({
          body: { 
            action: 'get_messages', 
            account_id: selectedAccount,
            chat_id: chatId,
            limit: 50,
            cursor: cursorRef.current,
          },
        });
        if (!data?.success) throw new Error(data?.error as string);
        const newMessages = (data.messages as Message[]) || [];
        setMessages(prev => [...newMessages, ...prev]);
        setCursor(data.cursor as string | null);
        setHasMore(!!data.cursor);
      } else {
        // Fetch primary chat first for instant display
        const primaryChatId = chatIds[0];
        const { data: primaryData } = await invokeUnipile({
          body: { action: 'get_messages', account_id: selectedAccount, chat_id: primaryChatId, limit: 50 },
        });
        if (!primaryData?.success) throw new Error(primaryData?.error as string);
        
        const primaryMessages = (primaryData.messages as Message[]) || [];
        const primaryCursor = primaryData.cursor as string | null;
        
        // Sort and display primary messages immediately
        primaryMessages.sort((a, b) => {
          const tA = new Date(a.timestamp || '').getTime() || 0;
          const tB = new Date(b.timestamp || '').getTime() || 0;
          return tA - tB;
        });
        setMessages(primaryMessages);
        setCursor(primaryCursor);
        setHasMore(!!primaryCursor);
        setLoadingMessages(false);
        
        // Backfill secondary threads in background (non-blocking)
        const secondaryChatIds = chatIds.slice(1);
        if (secondaryChatIds.length > 0) {
          Promise.allSettled(
            secondaryChatIds.map(cid =>
              invokeUnipile({
                body: { action: 'get_messages', account_id: selectedAccount, chat_id: cid, limit: 50 },
              })
            )
          ).then(results => {
            const extraMessages: Message[] = [];
            for (const result of results) {
              if (result.status === 'fulfilled' && result.value.data?.success) {
                const msgs = (result.value.data.messages as Message[]) || [];
                extraMessages.push(...msgs);
              }
            }
            if (extraMessages.length > 0) {
              setMessages(prev => {
                const seen = new Set(prev.map(m => m.id));
                const newMsgs = extraMessages.filter(m => !seen.has(m.id));
                if (newMsgs.length === 0) return prev;
                const combined = [...prev, ...newMsgs];
                combined.sort((a, b) => {
                  const tA = new Date(a.timestamp || '').getTime() || 0;
                  const tB = new Date(b.timestamp || '').getTime() || 0;
                  return tA - tB;
                });
                return combined;
              });
            }
          }).catch(() => {});
        }
        return; // Skip the finally setLoadingMessages since we already set it
      }
    } catch (error) {
      console.error('Error fetching messages:', error);
      toast.error('Erreur lors du chargement des messages');
    } finally {
      setLoadingMessages(false);
    }
  }, [selectedAccount]);

  // Fire-and-forget: update status to 'messaged' + sync Notion after sending from inbox
  const syncAfterInboxSend = useCallback(async (chat: Chat) => {
    if (!user) return;

    try {
      const profileId = getAttendeeProfileId(chat);
      const profileUrl = chat.attendees?.[0]?.profile_url || null;
      const candidateName = getChatDisplayName(chat);
      const candidateHeadline = getChatHeadline(chat);

      // Find job context from enrollments or job_candidate_status
      const enrollmentProfileId = profileId || (profileUrl ? profileUrl.split('/').filter(Boolean).pop() : null);
      const enrollment = enrollmentProfileId ? enrollmentsMap.get(enrollmentProfileId) : null;
      const jobId = enrollment?.job_id || null;
      const jobTitle = enrollment?.job_title || null;
      const job = jobId ? availableJobs.find(j => j.id === jobId) : null;

      // 1. Update job_candidate_status to 'messaged' if we have a candidate id + job
      if (profileId && jobId) {
        await supabase
          .from('job_candidate_status')
          .upsert({
            job_id: jobId,
            candidate_id: profileId,
            linkedin_profile_url: profileUrl || null,
            candidate_name: candidateName || null,
            candidate_headline: candidateHeadline || null,
            status: 'messaged',
            created_by: user.id,
            organization_id: organizationId,
          }, {
            onConflict: 'job_id,candidate_id,created_by',
          });
        console.log('[Inbox] Status updated to messaged for', candidateName);
      }

      // 2. Sync to Notion via add-to-shortlist (create/update candidate + shortlist)
      if (candidateName) {
        // Determine accompagnement from job data
        const accompagnementRaw = (job as any)?.accompagnement || [];
        let accompagnement: string | undefined;
        if (accompagnementRaw.some?.((a: string) => a.toLowerCase().includes('rpo') || a.toLowerCase().includes('embedded'))) {
          accompagnement = 'RPO';
        } else if (accompagnementRaw.some?.((a: string) => a.toLowerCase().includes('succès') || a.toLowerCase().includes('succes'))) {
          accompagnement = 'Succès';
        }

        await invokeEdgeFunction('add-to-shortlist', {
          name: candidateName,
          headline: candidateHeadline,
          linkedinUrl: profileUrl || undefined,
          jobId: jobId || undefined,
          jobTitle: jobTitle || undefined,
          clientName: job?.client?.name || undefined,
          clientId: (job?.client as any)?.id || undefined,
          entity: 'Skalr',
          accompagnement,
          etape: 'Contacté',
          etat: 'En attente de réponse',
        });
        console.log('[Inbox] Notion sync done for', candidateName);
      }
    } catch (err) {
      console.error('[Inbox] Post-send sync error (non-blocking):', err);
    }
  }, [availableJobs, enrollmentsMap, organizationId, user]);

  // Scroll to bottom helper
  const scrollToBottom = useCallback((smooth = true) => {
    const container = messagesContainerRef.current;
    if (container) {
      requestAnimationFrame(() => {
        try {
          container.scrollTo({
            top: container.scrollHeight,
            behavior: smooth ? 'smooth' : 'auto',
          });
        } catch {
          container.scrollTop = container.scrollHeight;
        }
      });
    }
  }, []);

  // Send a message
  const sendMessage = useCallback(async () => {
    if (!selectedAccount || !selectedChat || !newMessage.trim()) return;

    setSending(true);
    try {
      const { data } = await invokeUnipile({
        body: { 
          action: 'send_message', 
          account_id: selectedAccount,
          chat_id: selectedChat.id,
          text: newMessage.trim(),
        },
      });

      if (!data?.success) throw new Error(data?.error as string);

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
      
      // Fire-and-forget: sync status + Notion
      syncAfterInboxSend(selectedChat);
      
      setTimeout(() => scrollToBottom(true), 100);

      emitQuotaAction('messagesSent', 1, selectedAccount);
      toast.success('Message envoyé');
    } catch (error) {
      console.error('Error sending message:', error);
      toast.error("Erreur lors de l'envoi du message");
    } finally {
      setSending(false);
    }
  }, [selectedAccount, selectedChat, newMessage, syncAfterInboxSend]);

  // Send suggestion directly
  const handleSuggestionSend = useCallback(async (text: string) => {
    if (!selectedAccount || !selectedChat || sending) return;
    
    setSending(true);
    try {
      const { data } = await invokeUnipile({
        body: { 
          action: 'send_message', 
          account_id: selectedAccount,
          chat_id: selectedChat.id,
          text: text.trim(),
        },
      });

      if (!data?.success) throw new Error(data?.error as string);

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
      
      // Fire-and-forget: sync status + Notion
      syncAfterInboxSend(selectedChat);
      
      setTimeout(() => scrollToBottom(true), 100);

      emitQuotaAction('messagesSent', 1, selectedAccount);
      toast.success('Message envoyé');
    } catch (error) {
      console.error('Error sending message:', error);
      toast.error("Erreur lors de l'envoi du message");
    } finally {
      setSending(false);
    }
  }, [selectedAccount, selectedChat, sending, syncAfterInboxSend]);

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
      
      const response = await invokeEdgeFunction<{ suggestions?: any[] }>('generate-reply-suggestions', {
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
          calendlyLink: calendlyLink || undefined,
          candidateProfileUrl: selectedChat.attendees?.[0]?.profile_url || undefined,
          candidateName: getChatDisplayName(selectedChat) || undefined,
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
  }, [selectedChat, messages, loadingSuggestions, suggestionsLoaded, availableJobs, enrollmentsMap, calendlyLink]);

  // Handle suggestion click
  const handleSuggestionClick = useCallback((text: string) => {
    setNewMessage(text);
  }, []);

  // Enroll in sequence
  const enrollInSequence = useCallback(async (sequence: { id: string; name: string; steps: any[] }) => {
    if (!selectedChat || !selectedAccount || !user) return;
    
    const profileId = getAttendeeProfileId(selectedChat);
    if (!profileId) {
      toast.error('Impossible d\'identifier le profil');
      return;
    }
    
    try {
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
          created_by: user.id,
          organization_id: organizationId,
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
  }, [fetchEnrollments, organizationId, selectedAccount, selectedChat, user]);

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

  // Resolve Calendly link when a chat is selected
  useEffect(() => {
    if (!selectedChat) {
      setCalendlyLink(null);
      return;
    }
    const profileId = getAttendeeProfileId(selectedChat);
    const profileUrl = selectedChat.attendees?.[0]?.profile_url || null;
    if (!profileId && !profileUrl) {
      setCalendlyLink(null);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        // Helper to fetch calendly_link from a project id
        const fetchCalendlyFromProject = async (projectId: string): Promise<string | null> => {
          const { data: project } = await supabase
            .from('sourcing_projects')
            .select('calendly_link')
            .eq('id', projectId)
            .maybeSingle();
          return project?.calendly_link || null;
        };

        // Strategy 1: via job_candidate_status → project_id
        if (profileId) {
          const { data } = await supabase
            .from('job_candidate_status')
            .select('project_id')
            .eq('candidate_id', profileId)
            .not('project_id', 'is', null)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (cancelled) return;
          if (data?.project_id) {
            const link = await fetchCalendlyFromProject(data.project_id);
            if (cancelled) return;
            if (link) { setCalendlyLink(link); return; }
          }
        }

        // Strategy 2: via sequence_enrollments → job_id → sourcing_projects
        const enrollmentProfileId = profileId || (profileUrl ? profileUrl.split('/').filter(Boolean).pop() : null);
        if (enrollmentProfileId) {
          const { data: enrollment } = await supabase
            .from('sequence_enrollments')
            .select('job_id')
            .eq('profile_id', enrollmentProfileId)
            .not('job_id', 'is', null)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (cancelled) return;
          if (enrollment?.job_id) {
            const { data: project } = await supabase
              .from('sourcing_projects')
              .select('calendly_link')
              .eq('job_id', enrollment.job_id)
              .not('calendly_link', 'is', null)
              .limit(1)
              .maybeSingle();
            if (cancelled) return;
            if (project?.calendly_link) { setCalendlyLink(project.calendly_link); return; }
          }
        }

        // Strategy 3: fallback to any active project with a calendly_link
        const { data: anyProject } = await supabase
          .from('sourcing_projects')
          .select('calendly_link')
          .eq('status', 'active')
          .not('calendly_link', 'is', null)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (cancelled) return;
        setCalendlyLink(anyProject?.calendly_link || null);
      } catch {
        if (cancelled) return;
        setCalendlyLink(null);
      }
    })();

    return () => { cancelled = true; };
  }, [selectedChat?.id]);

  // Handle scheduling call
  const handleScheduleCall = useCallback(() => {
    if (!selectedChat) return;
    
    const profileName = getChatDisplayName(selectedChat);
    
    if (calendlyLink) {
      // Build Calendly link with LinkedIn URL + name pre-fill
      const profileUrl = selectedChat.attendees?.[0]?.profile_url;
      const candidateName = getChatDisplayName(selectedChat);
      const params = new URLSearchParams();
      if (profileUrl) params.set('a1', profileUrl);
      if (candidateName) {
        const parts = candidateName.trim().split(/\s+/);
        if (parts.length >= 2) {
          params.set('first_name', parts[0]);
          params.set('last_name', parts.slice(1).join(' '));
        } else if (parts.length === 1) {
          params.set('first_name', parts[0]);
        }
      }
      const calendlyWithPrefill = params.toString()
        ? `${calendlyLink}${calendlyLink.includes('?') ? '&' : '?'}${params.toString()}`
        : calendlyLink;
      const calendlyMessage = `Voici un lien pour réserver un créneau afin de discuter du poste avec notre équipe : ${calendlyWithPrefill}`;
      setNewMessage(prev => prev ? `${prev}\n\n${calendlyMessage}` : calendlyMessage);
      toast.success('📅 Lien Calendly inséré dans le message');
      return;
    }
    
    toast.info('📅 Aucun lien Calendly configuré', {
      description: `Ajoutez un lien Calendly dans les paramètres du projet pour ${profileName}`,
      action: {
        label: 'Copier le nom',
        onClick: () => {
          navigator.clipboard.writeText(profileName);
          toast.success('Nom copié !');
        },
      },
    });
  }, [selectedChat, calendlyLink]);

  // Helper: mark a chat as read locally AND via the Unipile API
  // For merged chats, marks ALL underlying threads as read
  const markChatAsReadLocally = (chatId: string) => {
    // Single dispatch updates both chats[] and selectedChat atomically (1 render instead of 2)
    chatDispatch({ type: 'MARK_CHAT_READ', chatId });

    // Find merged chat IDs — mark all underlying threads as read
    const chat = chats.find(c => c.id === chatId);
    const chatIdsToMark = chat?._mergedChatIds || [chatId];

    // Fire-and-forget: tell Unipile to mark each chat as read server-side
    for (const cid of chatIdsToMark) {
      invokeUnipile({
        body: {
          action: 'mark_as_read',
          account_id: selectedAccount,
          chat_id: cid,
        },
      }).then(({ data }) => {
        if (!data?.success) {
          console.warn('Failed to mark chat as read via API:', data?.error);
        }
      }).catch(err => {
        console.warn('Error marking chat as read:', err);
      });
    }
  };

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

    // Category filter
    if (chatCategories.categoryFilter !== 'all') {
      result = result.filter(chat => chatCategories.categoriesMap.get(chat.id) === chatCategories.categoryFilter);
    }

    // Response status filter: based on who sent the last message
    if (responseFilter === 'waiting_candidate') {
      // I sent the last message → candidate hasn't replied yet
      result = result.filter(chat => chat.last_message?.is_sender === true);
    } else if (responseFilter === 'waiting_me') {
      // Candidate sent the last message → I need to respond
      result = result.filter(chat => chat.last_message?.is_sender === false);
    }
    
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(chat => buildChatSearchText(chat).includes(query));
    }
    
    setFilteredChats(result);
  }, [searchQuery, chats, showUnreadOnly, sourceFilter, responseFilter, chatCategories.categoryFilter, chatCategories.categoriesMap]);

  // Unread count effect
  useEffect(() => {
    const totalUnread = chats.reduce((acc, chat) => acc + getUnreadCount(chat), 0);
    onUnreadCountChange?.(totalUnread);
  }, [chats, onUnreadCountChange]);

  // Load chats on account change
  useEffect(() => {
    if (isReady && user && selectedAccount) {
      fetchChats();
      fetchEnrollments();
      fetchAvailableJobs();
      fetchSequences();

      // Don't reset chat/messages if we have an initial chat to restore
      if (!pendingInitialChatId.current) {
        setSelectedChat(null);
        setMessages([]);
      }
    }
  }, [isReady, selectedAccount, fetchChats, fetchEnrollments, fetchAvailableJobs, fetchSequences, user]);

  // Auto-poll chat list every 30s to detect new messages / conversations
  useEffect(() => {
    if (!isReady || !user || !selectedAccount) return;

    const pollChats = async () => {
      try {
        const { data } = await invokeUnipile({
          body: {
            action: 'get_chats',
            account_id: selectedAccount,
            limit: 250,
          },
        });

        if (!data?.success) return;

        const freshChats = data.chats as Chat[] || [];
        setChats(prev => {
          // Expand merged chats for proper re-merge
          const prevFlat = prev.map(c => ({ ...c, _mergedChatIds: undefined }));
          const freshIds = new Set(freshChats.map(c => c.id));
          const extraChats = prevFlat.filter(c => !freshIds.has(c.id));
          if (extraChats.length === 0) {
            const prevUnread = prev.reduce((a, c) => a + getUnreadCount(c), 0);
            const freshMerged = mergeChatsByCandidate(freshChats);
            const freshUnread = freshMerged.reduce((a, c) => a + getUnreadCount(c), 0);
            if (prev.length === freshMerged.length && prevUnread === freshUnread) {
              const prevFirst = prev[0];
              const freshFirst = freshMerged[0];
              if (prevFirst?.id === freshFirst?.id && prevFirst?.timestamp === freshFirst?.timestamp) return prev;
            }
            return freshMerged;
          }
          const combined = [...freshChats, ...extraChats];
          return mergeChatsByCandidate(combined);
        });
      } catch {
        // Silently ignore polling errors
      }
    };

    const intervalId = setInterval(pollChats, 30_000);
    return () => clearInterval(intervalId);
  }, [isReady, selectedAccount, user]);

  // Load messages on chat selection & mark as read
  useEffect(() => {
    if (selectedChat) {
      // Clear previous messages immediately to avoid stale content bleed
      setMessages([]);
      setCursor(null);
      setHasMore(false);
      fetchMessages(selectedChat.id);
      setReplySuggestions([]);
      setSuggestionsLoaded(false);
      // Mark as read locally when opening a conversation
      markChatAsReadLocally(selectedChat.id);
    }
  }, [selectedChat?.id, fetchMessages]);

  // Auto-poll messages every 5s when a chat is selected
  useEffect(() => {
    if (!isReady || !user || !selectedChat || !selectedAccount) return;

    const chatId = selectedChat.id;
    let active = true;

    const poll = async () => {
      if (!active) return;
      try {
        const { data } = await invokeUnipile({
          body: {
            action: 'get_messages',
            account_id: selectedAccount,
            chat_id: chatId,
            limit: 50,
          },
        });

        if (!active) return;
        if (!data?.success) return;

        const freshMessages: Message[] = ((data.messages as Message[]) || []);
        // Sort chronologically
        freshMessages.sort((a, b) => {
          const tA = new Date(a.timestamp || '').getTime() || 0;
          const tB = new Date(b.timestamp || '').getTime() || 0;
          return tA - tB;
        });
        
        setMessages(prev => {
          // Merge fresh messages with existing (preserves backfilled secondary thread messages)
          const existingIds = new Set(freshMessages.map(m => m.id));
          // Keep messages from secondary threads that aren't in the primary poll
          // Filter out optimistic messages (numeric-only IDs from Date.now()) — they are now in the fresh data
          const secondaryMsgs = prev.filter(m => !existingIds.has(m.id) && !/^\d+$/.test(m.id));
          if (secondaryMsgs.length === 0) {
            return areMessagesEquivalent(prev, freshMessages) ? prev : freshMessages;
          }
          // Merge and re-sort
          const combined = [...freshMessages, ...secondaryMsgs];
          combined.sort((a, b) => {
            const tA = new Date(a.timestamp || '').getTime() || 0;
            const tB = new Date(b.timestamp || '').getTime() || 0;
            return tA - tB;
          });
          return areMessagesEquivalent(prev, combined) ? prev : combined;
        });
      } catch {
        // Silently ignore polling errors
      }
    };

    const intervalId = setInterval(poll, 5000);

    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [isReady, selectedChat?.id, selectedAccount, user]);

  // Scroll to bottom helper

  useEffect(() => {
    if (!loadingMessages && messages.length > 0) {
      // Use instant scroll on first load, smooth on updates
      const timeout = setTimeout(() => scrollToBottom(false), 50);
      return () => clearTimeout(timeout);
    }
  }, [messages, loadingMessages, scrollToBottom]);

  return {
    // Organization
    organizationId,
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
    responseFilter,
    setResponseFilter,
    
    // Categories
    chatCategories,
    
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
    loadMoreChats,
    loadAllChats,
    hasMoreChats,
    loadingMoreChats,
    loadingAllChats,
    fetchMessages,
    sendMessage,
    handleSuggestionClick,
    handleSuggestionSend,
    fetchReplySuggestions,
    enrollInSequence,
    handleAddToPipeline,
    handleEnrollInSequence,
    handleScheduleCall,
    calendlyLink,
  };
}
