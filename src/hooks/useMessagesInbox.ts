import { useCallback, useMemo, useRef, useEffect, useReducer, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { invokeUnipile } from '@/lib/invokeUnipile';
import { emitQuotaAction } from '@/lib/quotaEvents';
import { autoAnalyzeKey, runAutoAnalyzeOnce } from '@/lib/autoAnalyzeGuard';
import { toast } from 'sonner';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useNow } from '@/hooks/sidebar/useNow';
import { fetchInboxEnrollmentRows, indexInboxEnrollments } from '@/lib/inboxEnrollments';
import { CONTRACT_TYPE_LABELS, REMOTE_LABELS, type JobDetails } from '@/types/jobDetails';
import { useChatCategories } from './useChatCategories';
import { useChatStatus, getEffectiveStatus } from './useChatStatus';
import {
  getChatDisplayName,
  getChatHeadline,
  getChatJobInfo,
  getChatThreadState,
  getAttendeeProfileId,
  getMessageText,
  isRecruiterChat,
  isClassicChat,
  hasUnread,
  getUnreadCount,
  buildChatSearchText,
} from './useMessagesInboxHelpers';
import {
  RESPONSE_FILTER_STATE,
  countThreadStates,
  type ResponseFilter,
  type ThreadState,
} from '@/lib/inboxThreadState';

const CHAT_PAGE_SIZE = 25;

/** Identifiant de mission (sourcing_projects.id). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    /** Distance LinkedIn du participant quand le fournisseur la donne (FIRST_DEGREE, DISTANCE_1…). */
    network_distance?: string;
  };
  /** Distance LinkedIn parfois posée à la racine du participant. */
  network_distance?: string;
}

/** Séquence proposée depuis la messagerie, avec ses étapes complètes triées par ordre. */
export interface InboxSequenceOption {
  id: string;
  name: string;
  steps: any[];
  stepCount: number;
  project_id: string | null;
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

export interface MessageReaction {
  /** Emoji unicode (ex: "👍", "❤️") */
  value?: string;
  /** Format alternatif que Unipile peut utiliser */
  reaction?: string;
  /** Auteur de la réaction */
  sender_id?: string;
  /** Booléen indiquant si c'est notre user qui a réagi */
  is_sender?: boolean;
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
  /** Réactions sur le message (format Unipile : Array<{ value, sender_id }>). */
  reactions?: MessageReaction[];
  /** Pièces jointes — Unipile remonte type, url, filename, mimetype, size.
      On garde le typage souple car Unipile change les détails selon le type. */
  attachments?: Array<Record<string, unknown>>;
  /** True si le message a été supprimé côté LinkedIn. */
  is_deleted?: boolean;
  /** Subject (utilisé pour les InMails). */
  subject?: string;
  /** Type Unipile : MESSAGE | INMAIL | etc. */
  message_type?: string;
}

export interface SequenceEnrollmentInfo {
  profile_id: string;
  provider_id?: string | null;
  resolved_profile_id?: string | null;
  job_title: string | null;
  job_id: string | null;
  status: string;
  replied_at: string | null;
  current_step_order: number;
  /** Raison d'une pause (compte déconnecté, limite atteinte…), dite par le badge de statut. */
  pause_reason?: string | null;
  /** tracking_data.completion_reason et tracking_data.manual_stop : statut d'un arrêt manuel (lot 5b). */
  completion_reason?: string | null;
  manual_stop?: unknown;
  /** Config outreach de la mission (incarnation IA + anonymisation).
   *  Lue depuis sourcing_projects.job_details.outreach_config. */
  outreach_config?: {
    recruitment_mode?: 'internal' | 'client';
    sender_role?: string;
    anonymize_client?: boolean;
    anonymized_alias?: string;
  } | null;
  /** Nom du client pour les sanity-checks anonymisation côté backend. */
  client_name?: string | null;
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

/**
 * Mission "lite" pour l'inbox — utilisée pour matcher une conversation
 * non-enrollée (manuelle) à une mission via le subject ou le contenu des
 * messages envoyés. Inclut le outreach_config pour pouvoir afficher le
 * contexte d'incarnation IA même sans sequence_enrollment.
 */
export interface ActiveMissionLite {
  id: string;
  name: string;
  job_id: string | null;
  job_title: string | null;
  client_name: string | null;
  status: string;
  outreach_config: {
    recruitment_mode?: 'internal' | 'client';
    sender_role?: string;
    anonymize_client?: boolean;
    anonymized_alias?: string;
  } | null;
}

// Brief d'une mission (sourcing_projects.job_details) au format JobData lu par
// les suggestions de réponse, l'analyse et le bouton « Réponse + CTA ».
// Le salaire annuel n'est pas repris : generate-reply-suggestions et
// analyze-response l'attendent en k€, jobDataToBrief en euros.
function missionToJobData(p: { id: string; name: string | null; job_title: string | null; client_name: string | null; job_details: unknown }): JobData {
  const jd: JobDetails = (p.job_details as JobDetails | null) || {};
  // Client anonymisé : l'alias remplace le vrai nom avant tout envoi à l'IA.
  const clientName = jd.outreach_config?.anonymize_client
    ? (jd.outreach_config.anonymized_alias || '').trim() || 'une entreprise tech française'
    : jd.client?.name || p.client_name;
  const mustHave = jd.skills_must_have || [];
  const shouldHave = jd.skills_should_have || [];
  const niceToHave = jd.skills_nice_to_have || [];
  const daily = jd.salary_type === 'daily';
  return {
    id: p.id,
    title: jd.title || p.job_title || p.name || 'Mission',
    client: clientName ? { name: clientName, sector: jd.client?.sector || '' } : null,
    skills: [...mustHave, ...shouldHave],
    seniority: jd.seniority,
    location: jd.location,
    remote: jd.remote_policy ? REMOTE_LABELS[jd.remote_policy] || jd.remote_policy : undefined,
    tjmMin: daily ? jd.salary_min : undefined,
    tjmMax: daily ? jd.salary_max : undefined,
    contractType: jd.contract_type ? CONTRACT_TYPE_LABELS[jd.contract_type] || jd.contract_type : undefined,
    description: jd.mission_description,
    mustHave: mustHave.length > 0 ? mustHave.join(', ') : undefined,
    shouldHave: shouldHave.length > 0 ? shouldHave.join(', ') : undefined,
    niceToHave: niceToHave.length > 0 ? niceToHave.join(', ') : undefined,
    teamInfo: jd.context,
    xpMin: jd.experience_min,
    xpMax: jd.experience_max,
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
  /** Onglet ouvert au départ (?onglet= de /inbox). */
  initialResponseFilter?: ResponseFilter;
}

// ── Reducer: Chat State ─────────────────────────────────
interface ChatState {
  chats: Chat[];
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
  | { type: 'RESET_CHAT_SCOPE'; loading: boolean; initialChatId: string | null }
  | { type: 'SET_CHATS'; chats: Chat[] }
  | { type: 'UPDATE_CHATS'; updater: (prev: Chat[]) => Chat[] }
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
    case 'RESET_CHAT_SCOPE': return {
      ...state, chats: [], messages: [],
      selectedChat: action.initialChatId ? { id: action.initialChatId, account_id: '' } : null,
      loadingChats: action.loading, loadingMessages: false, sending: false,
      cursor: null, hasMore: true, chatCursors: {}, hasMoreChats: false,
      loadingMoreChats: false, loadingAllChats: false,
    };
    case 'SET_CHATS': return { ...state, chats: action.chats };
    case 'UPDATE_CHATS': return { ...state, chats: action.updater(state.chats) };
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
  responseFilter: ResponseFilter;
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
  | { type: 'SET_RESPONSE_FILTER'; value: ResponseFilter }
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
  activeMissions: ActiveMissionLite[];
  sequences: InboxSequenceOption[];
  replySuggestions: Array<{ text: string; type: string }>;
  loadingSuggestions: boolean;
  suggestionsLoaded: boolean;
  analysisData: AnalysisData | null;
  loadingAnalysis: boolean;
}

type ContextAction =
  | { type: 'SET_ENROLLMENTS_MAP'; map: Map<string, SequenceEnrollmentInfo> }
  | { type: 'SET_AVAILABLE_JOBS'; jobs: JobData[] }
  | { type: 'SET_ACTIVE_MISSIONS'; missions: ActiveMissionLite[] }
  | { type: 'SET_SEQUENCES'; sequences: InboxSequenceOption[] }
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
    case 'SET_ACTIVE_MISSIONS': return { ...state, activeMissions: action.missions };
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

type ChatReadMode = 'refresh' | 'poll' | 'more' | 'all' | 'restore';

interface ChatListSession {
  key: string;
  active: boolean;
  rawChats: Map<string, Chat>;
  deletedIds: Set<string>;
  cursors: Record<string, string | null>;
  loaded: boolean;
  request: Promise<void> | null;
  mode: ChatReadMode | null;
  queuedReads: Map<ChatReadMode, Promise<void>>;
}

export function useMessagesInbox({ selectedAccount, onUnreadCountChange, initialChatId, onChatChange, initialResponseFilter }: UseMessagesInboxOptions) {
  const { organizationId } = useOrganization();
  const { isReady, user } = useAuthReady();
  const currentTime = useNow(30_000);
  const userId = user?.id ?? null;
  const scopeKey = JSON.stringify([userId, organizationId, selectedAccount]);
  const currentScopeRef = useRef(scopeKey);
  currentScopeRef.current = scopeKey;
  const listSessionRef = useRef<ChatListSession | null>(null);
  const contextSessionRef = useRef<{ active: boolean } | null>(null);

  // ── Chat state (useReducer #1) ──
  const [chatState, chatDispatch] = useReducer(chatReducer, {
    chats: [],
    selectedChat: initialChatId ? { id: initialChatId, account_id: '' } as Chat : null,
    messages: [],
    loadingChats: !isReady || !!selectedAccount,
    loadingMessages: false,
    sending: false,
    cursor: null,
    hasMore: true,
    chatCursors: {},
    hasMoreChats: false,
    loadingMoreChats: false,
    loadingAllChats: false,
  });
  const { chats, selectedChat, messages, loadingChats, loadingMessages, sending, cursor, hasMore, hasMoreChats, loadingMoreChats, loadingAllChats } = chatState;

  const pendingInitialChatId = useRef<string | null>(initialChatId || null);
  const chatsRef = useRef<Chat[]>([]);
  chatsRef.current = chats;
  // Échec de la dernière lecture de la liste : la messagerie affiche une
  // erreur avec « Réessayer » au lieu d'une liste vide (revue design D-09).
  const [chatsError, setChatsError] = useState<string | null>(null);
  // Id du chat affiché, lu par fetchMessages pour ignorer une réponse en
  // retard qui concerne un chat que l'utilisateur a déjà quitté.
  const selectedChatIdRef = useRef<string | null>(null);
  selectedChatIdRef.current = selectedChat?.id ?? null;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Backward-compatible set* wrappers for chat state
  const setChats = useCallback((chatsOrUpdater: Chat[] | ((prev: Chat[]) => Chat[])) => {
    if (typeof chatsOrUpdater === 'function') {
      chatDispatch({ type: 'UPDATE_CHATS', updater: chatsOrUpdater });
    } else {
      chatDispatch({ type: 'SET_CHATS', chats: chatsOrUpdater });
    }
  }, []);
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
  const setLoadingMoreChats = useCallback((v: boolean) => chatDispatch({ type: 'LOADING_MORE_CHATS', loading: v }), []);
  const setLoadingAllChats = useCallback((v: boolean) => chatDispatch({ type: 'LOADING_ALL_CHATS', loading: v }), []);

  // ── UI state (useReducer #2) ──
  const [uiState, uiDispatch] = useReducer(uiReducer, {
    searchQuery: '',
    newMessage: '',
    showUnreadOnly: false,
    sourceFilter: 'all' as const,
    responseFilter: initialResponseFilter ?? ('all' as ResponseFilter),
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

  // Sélection d'un chat. Déclarée après le reducer UI : changer de
  // conversation vide le composer dans le même rendu, pour que MessageView
  // restaure le brouillon du nouveau chat sans écraser celui de l'ancien
  // (avant : le texte rédigé pour A restait affiché, et envoyable, sur B).
  const selectChat = useCallback((chat: Chat | null) => {
    const nextId = chat?.id ?? null;
    if (nextId !== selectedChatIdRef.current) {
      uiDispatch({ type: 'SET_NEW_MESSAGE', value: '' });
    }
    selectedChatIdRef.current = nextId;
    chatDispatch({ type: 'SELECT_CHAT', chat });
  }, []);

  // Backward-compatible setSelectedChat wrapper
  const _setSelectedChat = useCallback((chatOrUpdater: Chat | null | ((prev: Chat | null) => Chat | null)) => {
    if (typeof chatOrUpdater === 'function') {
      chatDispatch({ type: 'UPDATE_SELECTED_CHAT', updater: chatOrUpdater });
    } else {
      selectChat(chatOrUpdater);
    }
  }, [selectChat]);

  const setSelectedChat = useCallback((chat: Chat | null) => {
    // Un choix explicite (y compris Retour) remplace le lien initial : une
    // page arrivée plus tard ne doit plus rouvrir cette ancienne conversation.
    pendingInitialChatId.current = null;
    selectChat(chat);
    onChatChange?.(chat?.id || null);
  }, [selectChat, onChatChange]);
  const setShowUnreadOnly = useCallback((v: boolean) => uiDispatch({ type: 'SET_SHOW_UNREAD_ONLY', value: v }), []);
  const setSourceFilter = useCallback((v: 'all' | 'classic' | 'recruiter') => uiDispatch({ type: 'SET_SOURCE_FILTER', value: v }), []);
  const setResponseFilter = useCallback((v: ResponseFilter) => uiDispatch({ type: 'SET_RESPONSE_FILTER', value: v }), []);
  const setShowSequenceSelect = useCallback((v: boolean) => uiDispatch({ type: 'SET_SHOW_SEQUENCE_SELECT', value: v }), []);
  const setShowPipelineModal = useCallback((v: boolean) => uiDispatch({ type: 'SET_SHOW_PIPELINE_MODAL', value: v }), []);
  const setPipelinePreSelectedJobId = useCallback((v: string | undefined) => uiDispatch({ type: 'SET_PIPELINE_PRE_SELECTED_JOB_ID', value: v }), []);
  const setSelectedTone = useCallback((v: 'formal' | 'casual' | 'direct' | 'empathetic') => uiDispatch({ type: 'SET_SELECTED_TONE', value: v }), []);
  const setCalendlyLink = useCallback((v: string | null) => uiDispatch({ type: 'SET_CALENDLY_LINK', value: v }), []);

  // ── Context / AI state (useReducer #3) ──
  const [ctxState, ctxDispatch] = useReducer(contextReducer, {
    enrollmentsMap: new Map(),
    availableJobs: [],
    activeMissions: [],
    sequences: [],
    replySuggestions: [],
    loadingSuggestions: false,
    suggestionsLoaded: false,
    analysisData: null,
    loadingAnalysis: false,
  });
  const { enrollmentsMap, availableJobs, activeMissions, sequences, replySuggestions, loadingSuggestions, suggestionsLoaded, analysisData, loadingAnalysis } = ctxState;

  // Backward-compatible set* wrappers for context state
  const setEnrollmentsMap = useCallback((m: Map<string, SequenceEnrollmentInfo>) => ctxDispatch({ type: 'SET_ENROLLMENTS_MAP', map: m }), []);
  const setAvailableJobs = useCallback((j: JobData[]) => ctxDispatch({ type: 'SET_AVAILABLE_JOBS', jobs: j }), []);
  const setActiveMissions = useCallback((m: ActiveMissionLite[]) => ctxDispatch({ type: 'SET_ACTIVE_MISSIONS', missions: m }), []);
  const setSequences = useCallback((s: InboxSequenceOption[]) => ctxDispatch({ type: 'SET_SEQUENCES', sequences: s }), []);
  // État de la liste des séquences du dialogue de choix (chargée à chaque ouverture).
  const [sequencesStatus, setSequencesStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const setReplySuggestions = useCallback((s: Array<{ text: string; type: string }>) => ctxDispatch({ type: 'SET_REPLY_SUGGESTIONS', suggestions: s }), []);
  const setLoadingSuggestions = useCallback((v: boolean) => ctxDispatch({ type: 'SET_LOADING_SUGGESTIONS', loading: v }), []);
  const setSuggestionsLoaded = useCallback((v: boolean) => ctxDispatch({ type: 'SET_SUGGESTIONS_LOADED', loaded: v }), []);
  const setAnalysisData = useCallback((d: AnalysisData | null) => ctxDispatch({ type: 'SET_ANALYSIS_DATA', data: d }), []);
  const setLoadingAnalysis = useCallback((v: boolean) => ctxDispatch({ type: 'SET_LOADING_ANALYSIS', loading: v }), []);

  // Chat categories
  const chatCategories = useChatCategories();

  // Chat status (snooze + archive) — Inbox refonte Phase 1
  const chatStatus = useChatStatus();

  // Fetch sequence enrollments + outreach_config de chaque mission liée.
  // Le outreach_config sert à passer le contexte d'incarnation IA aux
  // smart replies dans l'inbox (cohérence avec les messages sortants).
  const fetchEnrollments = useCallback(async () => {
    if (!organizationId) return;
    const requestContext = contextSessionRef.current;
    try {
      const data = await fetchInboxEnrollmentRows(supabase, organizationId);

      // Récupère outreach_config + client_name pour chaque job_id distinct (1 query batch)
      const jobIds = Array.from(new Set((data || []).map(e => e.job_id).filter(Boolean) as string[]));
      const projectsMap = new Map<string, { outreach_config: any; client_name: string | null }>();
      if (jobIds.length > 0) {
        const { data: projects } = await (supabase
          .from('sourcing_projects')
          .select('id, job_id, job_details, client_name')
          .or(jobIds.map(id => `id.eq.${id},job_id.eq.${id}`).join(',')) as any);
        (projects || []).forEach((p: any) => {
          const config = (p.job_details as any)?.outreach_config || null;
          const entry = { outreach_config: config, client_name: p.client_name || (p.job_details as any)?.client?.name || null };
          // Index par les 2 ids (project.id ET project.job_id) pour un lookup rapide
          if (p.id) projectsMap.set(p.id, entry);
          if (p.job_id) projectsMap.set(p.job_id, entry);
        });
      }

      const map = indexInboxEnrollments(data.map(enrollment => {
        const projectInfo = enrollment.job_id ? projectsMap.get(enrollment.job_id) : undefined;
        return {
          ...enrollment,
          outreach_config: projectInfo?.outreach_config || null,
          client_name: projectInfo?.client_name || null,
        };
      }));
      if (requestContext?.active && contextSessionRef.current === requestContext) setEnrollmentsMap(map);
    } catch (error) {
      console.error('Error fetching enrollments:', error);
    }
  }, [organizationId, setEnrollmentsMap]);

  // Fetch active missions (sourcing_projects) avec leur outreach_config.
  // Sert à afficher le contexte mission/incarnation IA dans l'inbox même
  // pour les conversations MANUELLES (pas en séquence) — typiquement un
  // InMail envoyé à la main dont le subject mentionne "Lead AI Engineer
  // chez Theodo". En matchant le subject contre mission.name / job_title /
  // client_name, on peut afficher les badges contextuels même sans
  // sequence_enrollment.
  const fetchActiveMissions = useCallback(async () => {
    if (!organizationId) return;
    const requestContext = contextSessionRef.current;
    try {
      const { data, error } = await supabase
        .from('sourcing_projects')
        .select('id, name, kind, job_id, job_title, client_name, status, job_details')
        .eq('organization_id', organizationId)
        .neq('status', 'archived')
        .order('updated_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      const missions: ActiveMissionLite[] = (data || []).map((p: any) => ({
        id: p.id,
        name: p.name || 'Mission',
        job_id: p.job_id || null,
        job_title: p.job_title || null,
        client_name: p.client_name || (p.job_details as any)?.client?.name || null,
        status: p.status || 'active',
        outreach_config: (p.job_details as any)?.outreach_config || null,
      }));
      if (!requestContext?.active || contextSessionRef.current !== requestContext) return;
      setActiveMissions(missions);
      // Postes proposés aux suggestions de réponse et à l'analyse : les missions
      // actives, identifiées par leur uuid (le job_id des inscriptions en séquence).
      setAvailableJobs((data || [])
        .filter((p) => p.status === 'active' && p.kind !== 'search')
        .map(missionToJobData));
    } catch (error) {
      console.error('Error fetching active missions:', error);
    }
  }, [organizationId, setActiveMissions, setAvailableJobs]);

  // Séquences actives de l'organisation (la RLS borne à l'organisation), comme
  // le menu Séquence du sourcing : une séquence partagée par un collègue est
  // proposée. Étapes complètes (textes des messages, heures d'envoi), triées
  // par ordre : la préparation avec aperçu montre les messages avant
  // l'inscription. Rechargée à chaque ouverture du dialogue de choix.
  const fetchSequences = useCallback(async () => {
    if (!userId) return;
    const requestContext = contextSessionRef.current;

    setSequencesStatus('loading');
    try {
      const { data, error } = await supabase
        .from('outreach_sequences')
        .select('id, name, project_id, sequence_steps (*)')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .order('step_order', { referencedTable: 'sequence_steps', ascending: true });
      
      if (error) throw error;
      if (!requestContext?.active || contextSessionRef.current !== requestContext) return;
      setSequences((data || []).map(s => {
        const steps = [...(s.sequence_steps || [])].sort((a, b) => (a.step_order ?? 0) - (b.step_order ?? 0));
        return {
          id: s.id,
          name: s.name,
          project_id: s.project_id,
          stepCount: steps.length,
          steps,
        };
      }));
      setSequencesStatus('ready');
    } catch (error) {
      console.error('Error fetching sequences:', error);
      if (requestContext?.active && contextSessionRef.current === requestContext) setSequencesStatus('error');
    }
  }, [userId, setSequences]);

  // Une seule lecture de liste en vol, partagée entre premier affichage,
  // actualisation, pagination et polling. Les fils bruts restent indexés par
  // id : replier puis déplier les conversations perdait leurs fils secondaires.
  const readChatPage = useCallback(function readChatPage(mode: ChatReadMode, showToast = false): Promise<void> {
    const session = listSessionRef.current;
    if (!isReady || !userId || !organizationId || !selectedAccount || !session?.active || session.key !== scopeKey) return Promise.resolve();
    const stillActive = () => session.active && listSessionRef.current === session && currentScopeRef.current === scopeKey;
    if (mode === 'restore' && !pendingInitialChatId.current) return Promise.resolve();
    if (session.request) {
      if (mode === 'poll' || mode === session.mode || session.mode === 'all'
        || (mode === 'refresh' && session.mode !== 'poll')) return session.request;
      // Un clic Charger la suite ou Réessayer pendant un poll doit réellement
      // avancer après celui-ci. Les doubles clics partagent la même attente.
      const queued = session.queuedReads.get(mode);
      if (queued) return queued;
      if (mode === 'refresh') setLoadingChats(true);
      const pending = session.request.then(() => {
        session.queuedReads.delete(mode);
        if (stillActive()) return readChatPage(mode, showToast);
      });
      session.queuedReads.set(mode, pending);
      return pending;
    }
    const paging = mode === 'more' || mode === 'all' || mode === 'restore';
    if (paging && !Object.values(session.cursors).some(Boolean)) return Promise.resolve();

    if (mode === 'refresh') setLoadingChats(true);
    if (mode === 'more' || mode === 'restore') setLoadingMoreChats(true);
    if (mode === 'all') setLoadingAllChats(true);
    const request = (async () => {
      let added = 0;
      try {
        do {
          const previousCursors = session.cursors;
          const { data } = await invokeUnipile({
            body: {
              action: 'get_chats',
              account_id: selectedAccount,
              organization_id: organizationId,
              limit: mode === 'all' ? 100 : CHAT_PAGE_SIZE,
              ...(paging ? { cursors: previousCursors } : {}),
            },
          });
          if (!stillActive()) return;
          if (!data?.success) throw new Error(data?.error as string);

          const page = (data.chats as Chat[]) || [];
          for (const chat of page) {
            if (session.deletedIds.has(chat.id)) continue;
            if (!session.rawChats.has(chat.id)) added += 1;
            session.rawChats.set(chat.id, chat);
          }
          // Un rafraîchissement de la première page ne remet jamais le curseur
          // avant les pages déjà chargées, et conserve l'historique consulté.
          if (!session.loaded || paging) {
            session.cursors = (data.cursors as Record<string, string | null>) || {};
            setChatCursors(session.cursors);
          }
          session.loaded = true;
          const merged = mergeChatsByCandidate(Array.from(session.rawChats.values()));
          setChats(merged);
          setChatsError(null);

          if (pendingInitialChatId.current) {
            const id = pendingInitialChatId.current;
            const match = merged.find(chat => chat.id === id || chat._mergedChatIds?.includes(id));
            if (match) {
              _setSelectedChat(match);
              pendingInitialChatId.current = null;
            }
          }
          // Un curseur identique ne doit pas boucler indéfiniment si le
          // fournisseur ne peut pas avancer. « Charger la suite » reste offert.
          if ((mode !== 'all' && mode !== 'restore') || JSON.stringify(previousCursors) === JSON.stringify(session.cursors)) break;
        } while (stillActive() && (mode !== 'restore' || !!pendingInitialChatId.current) && Object.values(session.cursors).some(Boolean));
        if (showToast) toast.success('Conversations actualisées');
        else if (paging && mode !== 'restore' && added > 0) toast.success(`${added} conversations supplémentaires chargées`);
      } catch (error) {
        if (!stillActive()) return;
        if (mode === 'poll') return;
        console.error('Error fetching chats:', error);
        setChatsError(error instanceof Error && error.message ? error.message : 'unknown');
        if (session.rawChats.size > 0) {
          toast.error(paging ? "Les conversations suivantes n'ont pas été chargées" : "Les conversations n'ont pas été actualisées", {
            description: 'Vérifiez votre connexion, puis réessayez.',
          });
        }
      } finally {
        if (stillActive()) {
          session.request = null;
          session.mode = null;
          setLoadingChats(false);
          setLoadingMoreChats(false);
          setLoadingAllChats(false);
        }
      }
    })();
    session.request = request;
    session.mode = mode;
    return request;
  }, [isReady, userId, selectedAccount, organizationId, scopeKey, setLoadingChats, setLoadingMoreChats, setLoadingAllChats, setChatCursors, setChats, _setSelectedChat]);

  const removeChatFromList = useCallback((chatId: string) => {
    const session = listSessionRef.current;
    if (!session?.active || session.key !== currentScopeRef.current) return;
    // La suppression distante concerne un seul fil. Les autres conversations
    // du même candidat restent accessibles, même si elles étaient regroupées.
    session.deletedIds.add(chatId);
    session.rawChats.delete(chatId);
    if (pendingInitialChatId.current === chatId) pendingInitialChatId.current = null;
    setChats(mergeChatsByCandidate(Array.from(session.rawChats.values())));
  }, [setChats]);

  const fetchChats = useCallback(async (showToast = false) => {
    await readChatPage('refresh', showToast);
    // Un ancien lien de notification peut viser une page ultérieure. On la
    // retrouve sans bloquer la première page ni les messages déjà affichés.
    if (pendingInitialChatId.current) void readChatPage('restore');
  }, [readChatPage]);
  const loadMoreChats = useCallback(() => readChatPage('more'), [readChatPage]);
  const loadAllChats = useCallback(() => readChatPage('all'), [readChatPage]);

  // Fetch messages for a chat - use ref for cursor to avoid stale closure
  const cursorRef = useRef<string | null>(null);
  cursorRef.current = cursor;
  
  const fetchMessages = useCallback(async (chatId: string, loadMore = false): Promise<number> => {
    if (!selectedAccount) return 0;

    const requestSession = listSessionRef.current;
    // Resolve merged IDs from current chats state (avoid stale selectedChat closure)
    const chat = chatsRef.current.find(c => c.id === chatId || c._mergedChatIds?.includes(chatId));
    const mergedIds = chat?._mergedChatIds;
    const chatIds = (mergedIds && mergedIds.length > 1) ? mergedIds : [chatId];

    // Vrai tant que le chat demandé est encore celui affiché (ou l'un de ses
    // fils fusionnés) : une réponse arrivée après un changement de
    // conversation ne doit pas écraser le fil du nouveau chat.
    const stillActive = () => {
      if (!requestSession?.active || requestSession !== listSessionRef.current || requestSession.key !== currentScopeRef.current) return false;
      const current = selectedChatIdRef.current;
      if (!current) return false;
      if (current === chatId) return true;
      const currentChat = chatsRef.current.find(c => c.id === current);
      return !!currentChat?._mergedChatIds?.includes(chatId);
    };

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
        if (!stillActive()) return 0;
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
        if (!stillActive()) return 0;

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
        const totalMessagesFetched = primaryMessages.length;
        
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
            if (extraMessages.length > 0 && stillActive()) {
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
          });
        }
        return totalMessagesFetched; // Skip the finally setLoadingMessages since we already set it
      }
      return 0;
    } catch (error) {
      console.error('Error fetching messages:', error);
      if (stillActive()) {
        toast.error("Les messages n'ont pas été chargés", {
          description: 'Vérifiez votre connexion, puis rechargez la conversation.',
        });
      }
      return 0;
    } finally {
      // Une requête périmée ne doit pas éteindre le spinner du nouveau chat.
      if (stillActive()) setLoadingMessages(false);
    }
  }, [selectedAccount]);

  /**
   * Force la re-synchronisation de l'historique d'un chat depuis le début
   * (utile quand Unipile a perdu le cache des vieilles conversations).
   *
   * Flow :
   * 1. POST sync → démarre le sync (status SYNC_STARTED)
   * 2. Polling toutes les 2.5s du même endpoint pour suivre le status
   * 3. Quand SYNC_DONE → re-fetch les messages (qui devraient maintenant
   *    être dispo)
   * 4. Si SYNC_ERROR ou timeout 60s → retourne false
   *
   * Retourne le nombre de messages fetchés après sync (0 si échec).
   */
  const syncChatHistory = useCallback(async (
    chatId: string,
    options?: { silent?: boolean },
  ): Promise<number> => {
    if (!selectedAccount) return 0;
    const silent = options?.silent === true;
    // En mode silent (auto-sync arrière-plan) on ne montre PAS le spinner
    // global pour ne pas faire flasher l'UI ; le re-fetch final met à jour
    // les messages quand prêts.
    if (!silent) setLoadingMessages(true);

    try {
      // Étape 1 : démarre le sync
      const start = await invokeUnipile({
        body: { action: 'sync_chat_history', account_id: selectedAccount, chat_id: chatId },
      });
      if (!start.data?.success) {
        console.warn('[syncChatHistory] start failed:', start.data?.error);
        if (!silent) toast.error("La conversation n'a pas été synchronisée", { description: 'Réessayez dans quelques minutes.' });
        return 0;
      }

      let status = (start.data as { status?: string }).status;
      // Si déjà DONE ou ERROR au 1er appel → pas besoin de polling
      if (status === 'CHAT_DELETED') {
        if (!silent) toast.error('Conversation supprimée côté LinkedIn');
        return 0;
      }

      // Étape 2 : polling jusqu'à SYNC_DONE / SYNC_ERROR
      const POLL_INTERVAL_MS = 2500;
      const MAX_DURATION_MS = 60_000;
      const startedAt = Date.now();

      while (status !== 'SYNC_DONE' && status !== 'SYNC_ERROR') {
        if (Date.now() - startedAt > MAX_DURATION_MS) {
          if (!silent) toast.warning('La synchronisation prend trop de temps', {
            description: 'Elle a été interrompue. Réessayez dans quelques minutes.',
          });
          return 0;
        }
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
        const poll = await invokeUnipile({
          body: { action: 'sync_chat_history', account_id: selectedAccount, chat_id: chatId },
        });
        if (!poll.data?.success) {
          if (!silent) toast.error("La conversation n'a pas été synchronisée", { description: 'Réessayez dans quelques minutes.' });
          return 0;
        }
        status = (poll.data as { status?: string }).status;
      }

      if (status === 'SYNC_ERROR') {
        if (!silent) toast.error('LinkedIn n\'a pas pu synchroniser cette conversation');
        return 0;
      }

      // Étape 3 : SYNC_DONE — on re-fetch les messages
      // (cette fois Unipile devrait avoir l'historique en cache)
      const count = await fetchMessages(chatId, false);
      return count;
    } catch (e) {
      console.error('[syncChatHistory] error:', e);
      if (!silent) toast.error("La conversation n'a pas été synchronisée", { description: 'Réessayez dans quelques minutes.' });
      return 0;
    } finally {
      if (!silent) setLoadingMessages(false);
    }
  }, [selectedAccount, fetchMessages]);

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
      
      // « Contacté » est posé par le serveur à l'envoi, dans la mission de la
      // conversation (lot 0b) : plus d'écriture du pipeline ici.

      setTimeout(() => scrollToBottom(true), 100);

      emitQuotaAction('messagesSent', 1, selectedAccount);
      toast.success('Message envoyé');
    } catch (error) {
      console.error('Error sending message:', error);
      toast.error("Le message n'a pas été envoyé", {
        description: 'Votre texte est conservé. Vérifiez votre connexion, puis réessayez.',
      });
    } finally {
      setSending(false);
    }
  }, [selectedAccount, selectedChat, newMessage]);

  // Une suggestion IA n'est jamais envoyée d'un clic : elle remplit le
  // composeur, où on la relit avant d'envoyer (revue design D-14).

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

      // Lit outreach_config (incarnation IA) depuis enrollmentsMap pour appliquer
      // la même config qu'à l'envoi : mode interne/client, rôle expéditeur,
      // anonymisation client. Garantit la cohérence du fil narratif.
      const enrollmentInfo = jobInfo;
      const outreachConfig = enrollmentInfo?.outreach_config || undefined;
      const outreachClientName = enrollmentInfo?.client_name || enrichedJobData?.client?.name;
      
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
          outreachConfig,
          outreachClientName,
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

  // Ouvre le choix de la séquence (revue design D-02) et recharge la liste :
  // une séquence créée ou activée depuis l'ouverture de la messagerie apparaît.
  // Sans séquence active, le dialogue le dit et mène aux missions, où les
  // séquences se créent ; une erreur de lecture s'y affiche aussi.
  const handleEnrollInSequence = useCallback(() => {
    if (!selectedChat) return;
    setShowSequenceSelect(true);
    void fetchSequences();
  }, [selectedChat, fetchSequences]);

  // Handle adding to pipeline
  const handleAddToPipeline = useCallback((jobId?: string) => {
    if (!selectedChat) return;
    setPipelinePreSelectedJobId(jobId);
    setShowPipelineModal(true);
  }, [selectedChat]);

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
            // Mission par son id ou par son job_id, préfixe « project: » retiré
            // (lot 0c-4) : un poste de mission V2 n'a pas de job_id.
            const jobKey = enrollment.job_id.replace(/^project:/, '');
            const projectQuery = supabase
              .from('sourcing_projects')
              .select('calendly_link');
            const { data: project } = await (UUID_PATTERN.test(jobKey)
              ? projectQuery.or(`id.eq.${jobKey},job_id.eq.${jobKey}`)
              : projectQuery.eq('job_id', jobKey))
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
      toast.success('Lien de rendez-vous inséré dans le message');
      return;
    }

    toast.info('Aucun lien de rendez-vous pour cette conversation', {
      description: `Ajoutez votre lien Calendly à la mission pour proposer un créneau à ${profileName}.`,
      action: {
        label: 'Copier le nom',
        onClick: () => {
          navigator.clipboard.writeText(profileName);
          toast.success('Nom copié');
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

    for (const id of chatIdsToMark) {
      const raw = listSessionRef.current?.rawChats.get(id);
      if (raw) listSessionRef.current?.rawChats.set(id, { ...raw, unread_count: 0, unread: 0 });
    }

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

  // État de chaque conversation (à répondre, à relancer, en attente), relu avec
  // la liste (toutes les 30 s) et les inscriptions.
  const threadStates = useMemo(() => {
    const now = new Date(currentTime);
    const map = new Map<string, ThreadState>();
    for (const chat of chats) map.set(chat.id, getChatThreadState(chat, enrollmentsMap, now));
    return map;
  }, [chats, enrollmentsMap, currentTime]);

  // Compteurs des onglets : conversations actives seulement, ni en sommeil ni archivées.
  const threadCounts = useMemo(() => {
    const now = currentTime;
    const active: ThreadState[] = [];
    for (const chat of chats) {
      if (getEffectiveStatus(chatStatus.statusMap.get(chat.id), now) === 'active') {
        active.push(threadStates.get(chat.id) ?? 'none');
      }
    }
    return countThreadStates(active);
  }, [chats, chatStatus.statusMap, threadStates, currentTime]);

  // Les filtres font partie du même rendu que les données : aucune frame de
  // liste vide entre la réponse réseau et l'application des filtres.
  const filteredChats = useMemo(() => {
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

    // Status filter (snooze + archive) — Inbox refonte Phase 1
    // - 'active' (default) : pas snooze actif + pas archivé
    // - 'snoozed' : snoozed_until > now()
    // - 'archived' : archived_at IS NOT NULL
    // - 'all' : aucun filtre
    if (chatStatus.statusFilter !== 'all') {
      const now = currentTime;
      result = result.filter(chat => getEffectiveStatus(chatStatus.statusMap.get(chat.id), now) === chatStatus.statusFilter);
    }

    // Onglets : un seul état par conversation (src/lib/inboxThreadState.ts)
    if (responseFilter !== 'all') {
      const wanted = RESPONSE_FILTER_STATE[responseFilter];
      result = result.filter(chat => threadStates.get(chat.id) === wanted);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(chat => buildChatSearchText(chat).includes(query));
    }

    return result;
  }, [searchQuery, chats, showUnreadOnly, sourceFilter, responseFilter, threadStates, currentTime, chatCategories.categoryFilter, chatCategories.categoriesMap, chatStatus.statusFilter, chatStatus.statusMap]);

  // Unread count effect
  useEffect(() => {
    const totalUnread = chats.reduce((acc, chat) => acc + getUnreadCount(chat), 0);
    onUnreadCountChange?.(totalUnread);
  }, [chats, onUnreadCountChange]);

  // Les changements d'objet user lors du renouvellement de session ne
  // rechargent ni la liste ni la sélection. Seul le périmètre réel la réinitialise.
  useEffect(() => {
    const session: ChatListSession = { key: scopeKey, active: true, rawChats: new Map(), deletedIds: new Set(), cursors: {}, loaded: false, request: null, mode: null, queuedReads: new Map() };
    listSessionRef.current = session;
    const restoreId = pendingInitialChatId.current;
    selectedChatIdRef.current = restoreId;
    chatsRef.current = [];
    chatDispatch({ type: 'RESET_CHAT_SCOPE', loading: !isReady || !!selectedAccount, initialChatId: restoreId });
    setChatsError(null);
    uiDispatch({ type: 'SET_NEW_MESSAGE', value: '' });
    if (isReady && userId && selectedAccount) void fetchChats();
    return () => { session.active = false; };
  }, [isReady, userId, selectedAccount, scopeKey, fetchChats]);

  // Le contexte se charge à part : ni son résultat ni un changement de
  // compte LinkedIn ne relancent la lecture des missions et des séquences.
  useEffect(() => {
    const context = { active: true };
    contextSessionRef.current = context;
    ctxDispatch({ type: 'SET_ENROLLMENTS_MAP', map: new Map() });
    ctxDispatch({ type: 'SET_ACTIVE_MISSIONS', missions: [] });
    ctxDispatch({ type: 'SET_AVAILABLE_JOBS', jobs: [] });
    ctxDispatch({ type: 'SET_SEQUENCES', sequences: [] });
    if (isReady && userId && organizationId) {
      void fetchEnrollments();
      void fetchActiveMissions();
      void fetchSequences();
    }
    return () => { context.active = false; };
  }, [isReady, userId, organizationId, fetchEnrollments, fetchActiveMissions, fetchSequences]);

  useEffect(() => {
    if (!isReady || !userId || !selectedAccount) return;
    const pollChats = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void readChatPage('poll');
    };
    const intervalId = setInterval(pollChats, 30_000);
    return () => clearInterval(intervalId);
  }, [isReady, userId, selectedAccount, readChatPage]);

  // Load messages on chat selection & mark as read + auto-load AI suggestions
  // depuis le cache (instant) ou via auto-analyze (background ~2-3s)
  useEffect(() => {
    if (selectedAccount && selectedChat && selectedChatIdRef.current === selectedChat.id) {
      // Clear previous messages immediately to avoid stale content bleed
      setMessages([]);
      setCursor(null);
      setHasMore(false);
      fetchMessages(selectedChat.id);
      setReplySuggestions([]);
      setSuggestionsLoaded(false);
      markChatAsReadLocally(selectedChat.id);

      // Try to load suggestions from cache instantly (Smart Replies inline)
      const chatId = selectedChat.id;
      const accountId = selectedChat.account_id || selectedAccount;
      (async () => {
        try {
          const { data: cached } = await supabase
            .from('message_analysis_cache')
            .select('analysis')
            .eq('chat_id', chatId)
            .eq('account_id', accountId)
            .maybeSingle();
          const analysis = cached?.analysis as Record<string, unknown> | null;
          const suggestions = (analysis?.replySuggestions as Array<{ text: string; type: string }> | undefined) || [];
          if (suggestions.length > 0) {
            setReplySuggestions(suggestions);
            setSuggestionsLoaded(true);
          } else {
            // Cache miss → trigger auto-analyze en background, UNE fois par
            // chat (et par dernier message) et par session : le webhook LinkedIn
            // couvre les nouveaux messages, le panneau IA reste disponible.
            const guardKey = autoAnalyzeKey(selectedChat);
            const senderId = selectedChat.attendees?.[0]?.id || null;
            // Partage l'analyse déjà en vol (préchargement, ré-analyse) au lieu
            // de sortir : le cache est relu à la fin dans tous les cas.
            const pending = runAutoAnalyzeOnce(guardKey, () => supabase.functions.invoke('auto-analyze-message', {
              body: {
                chat_id: chatId,
                account_id: accountId,
                sender_id: senderId,
              },
            }));
            if (!pending) return;
            pending.then((res) => {
              // Re-query le cache après l'analyse pour récupérer les suggestions
              if (res.data?.success) {
                supabase
                  .from('message_analysis_cache')
                  .select('analysis')
                  .eq('chat_id', chatId)
                  .eq('account_id', accountId)
                  .maybeSingle()
                  .then(({ data: refreshed }) => {
                    const refreshedAnalysis = refreshed?.analysis as Record<string, unknown> | null;
                    const newSuggestions = (refreshedAnalysis?.replySuggestions as Array<{ text: string; type: string }> | undefined) || [];
                    if (newSuggestions.length > 0) {
                      setReplySuggestions(newSuggestions);
                      setSuggestionsLoaded(true);
                    }
                  });
              }
            }).catch(() => {/* silent */});
          }
        } catch (e) {
          console.debug('[inbox] Cache check failed:', e);
        }
      })();
    }
  }, [selectedChat?.id, fetchMessages, selectedAccount]);

  // Auto-poll messages every 20s when a chat is selected (était 5s, trop agressif)
  // Skip si l'onglet n'est pas visible (économie de quota Unipile + UX moins
  // saccadée). 20s suffit largement pour la latence acceptable des messages LI.
  useEffect(() => {
    if (!isReady || !userId || !selectedChat || !selectedAccount) return;

    const chatId = selectedChat.id;
    let active = true;

    const poll = async () => {
      if (!active) return;
      // Skip si onglet pas visible (browser background tab)
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
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

        // SAFETY : si Unipile renvoie un tableau vide alors qu'on avait
        // des messages, c'est probablement une erreur transitoire (rate
        // limit, network glitch, conv archivée, etc.). On NE doit PAS
        // overrider les messages existants → l'user verrait "Aucun message"
        // alors qu'il en avait tout à l'heure.
        if (freshMessages.length === 0) {
          // Garde l'état précédent
          return;
        }

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

    // Poll à 30s (était 20s avant, encore plus avant à 5s) — la plupart des
    // chats LinkedIn ne reçoivent pas de message dans la minute, et ce poll
    // est doublé par le webhook Unipile qui pousse les nouveaux messages
    // en temps réel quand ils arrivent.
    const intervalId = setInterval(poll, 30_000);

    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [isReady, selectedChat?.id, selectedAccount, userId]);

  // Scroll to bottom helper

  useEffect(() => {
    if (!loadingMessages && messages.length > 0) {
      // Use instant scroll on first load, smooth on updates
      const timeout = setTimeout(() => scrollToBottom(false), 50);
      return () => clearTimeout(timeout);
    }
  }, [messages, loadingMessages, scrollToBottom]);

  // Le changement de compte est visible dès ce rendu, avant le reset de
  // l'effet : aucune conversation de l'ancien compte ne traverse cette frame.
  // Le contexte de l'organisation reste partagé avec les autres canaux.
  const currentListScope = !!listSessionRef.current?.active && listSessionRef.current.key === scopeKey;

  return {
    // Organization
    organizationId,
    // Chat state
    chats: currentListScope ? chats : [],
    filteredChats: currentListScope ? filteredChats : [],
    selectedChat: currentListScope ? selectedChat : null,
    setSelectedChat,
    messages: currentListScope ? messages : [],
    loadingChats: currentListScope ? loadingChats : !isReady || !!selectedAccount,
    /** Échec de la dernière lecture de la liste (null si elle a abouti). */
    chatsError: currentListScope ? chatsError : null,
    loadingMessages: currentListScope && loadingMessages,
    searchQuery,
    setSearchQuery,
    newMessage,
    setNewMessage,
    sending,
    hasMore: currentListScope && hasMore,
    messagesEndRef,
    messagesContainerRef,
    
    // Filters
    showUnreadOnly,
    setShowUnreadOnly,
    sourceFilter,
    setSourceFilter,
    responseFilter,
    setResponseFilter,
    threadCounts: currentListScope ? threadCounts : countThreadStates([]),
    
    // Categories
    chatCategories,

    // Status (snooze + archive) — Inbox refonte Phase 1
    chatStatus,
    
    // Context data
    enrollmentsMap,
    availableJobs,
    activeMissions,
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
    removeChatFromList,
    loadMoreChats,
    loadAllChats,
    hasMoreChats: currentListScope && hasMoreChats,
    loadingMoreChats: currentListScope && loadingMoreChats,
    loadingAllChats: currentListScope && loadingAllChats,
    fetchMessages,
    syncChatHistory,
    sendMessage,
    handleSuggestionClick,
    fetchReplySuggestions,
    // Toute inscription passe par SequenceEnrollModal (candidat, messages et
    // avertissements montrés avant d'engager quoi que ce soit, constat UX05).
    /** Recharge la liste des séquences du dialogue de choix. */
    fetchSequences,
    sequencesStatus,
    /** Rafraîchit les inscriptions après une confirmation depuis la modale. */
    fetchEnrollments,
    handleAddToPipeline,
    handleEnrollInSequence,
    handleScheduleCall,
    calendlyLink,
  };
}
