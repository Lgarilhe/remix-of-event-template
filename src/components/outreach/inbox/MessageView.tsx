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
import { motion } from 'framer-motion';
import { useAttendeePicturesContext } from '@/contexts/AttendeePicturesContext';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { ToneSelector, AITone } from './ToneSelector';
import { InlineAIPanel } from './InlineAIPanel';
import { ActivityEventCard } from './ActivityEventCard';
import { SnoozeArchiveButtons } from './SnoozeArchiveButtons';
import { MessageComposer } from './MessageComposer';
import { SmartReplies } from './SmartReplies';
import { buildPlaceholderContext } from '@/lib/templatePlaceholders';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useUserTemplateVariables } from '@/hooks/useUserTemplateVariables';
import { useOrganization } from '@/hooks/useOrganization';
import { useChatStatus } from '@/hooks/useChatStatus';
import { useChatDraft, readChatDraft } from '@/hooks/useChatDraft';
import { useProfileActivity, ActivityEvent } from '@/hooks/useProfileActivity';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  ChevronLeft, User, Loader2, MessageSquare, Clock, CheckCheck, Check, Trash2,
  FileText, ChevronDown, ArrowRight, Briefcase, StopCircle,
} from 'lucide-react';
import { useTextActions, type SummarizeResult } from '@/hooks/useTextActions';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { Chat, Message, SequenceEnrollmentInfo, JobData, ActiveMissionLite } from '@/hooks/useMessagesInbox';
import { ChannelIcon, detectChannel } from '@/components/ui/ChannelIcon';
import {
  getChatDisplayName, getChatHeadline, getChatSubject, getChatAvatar,
  getInitials, getMessageText, getMessageDisplayText, hasDisplayableContent,
  getChatJobInfo, getAttendeeProfileId,
  formatMessageTime,
} from '@/hooks/useMessagesInboxHelpers';
import { jobDataToBrief } from '@/lib/jobBriefForCta';

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
  /** Liste des missions actives (sourcing_projects) avec leur outreach_config.
   *  Utilisée pour afficher le contexte mission même quand le candidat n'est
   *  pas dans une séquence (conv manuelle), via matching subject/contenu. */
  activeMissions?: ActiveMissionLite[];
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
  /** Re-fetch les messages du chat actuel (utilisé par le bouton "Recharger").
      Retourne le nombre de messages fetchés (0 = vide → toast info). */
  onRefetchMessages?: () => Promise<number> | void;
  /** Auto-sync silencieux quand un chat s'ouvre vide. Pas de toast, pas de
      spinner, juste un sync en arrière-plan qui re-fetch quand prêt.
      Appelé avec le chat_id concerné. Retourne le nombre de messages
      finalement chargés (0 = échec silencieux). */
  onAutoSyncIfEmpty?: (chatId: string) => Promise<number>;
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
  activeMissions = [],
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
  onRefetchMessages,
  onAutoSyncIfEmpty,
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
  const { setDraft, clearDraft } = useChatDraft(selectedChat?.id);
  const lastChatIdRef = useRef<string | null>(null);
  useEffect(() => {
    const id = selectedChat?.id || null;
    if (id === lastChatIdRef.current) return;
    lastChatIdRef.current = id;
    // Lecture synchrone du stockage : la valeur `draft` du rendu courant est
    // encore celle du chat précédent quand cet effet s'exécute.
    const stored = readChatDraft(id);
    if (id && stored && !newMessage) onNewMessageChange(stored);
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

  // ─── Auto-scroll intelligent (style Slack/iMessage) ─────────────────
  // Scroll en bas UNIQUEMENT si :
  //   1. C'est l'ouverture initiale du chat (premier rendu de messages)
  //   2. OU l'user était déjà près du bas (< 150px) ET un NOUVEAU message arrive
  // Sinon (user en train de lire en haut/milieu) → pas de scroll (sinon
  // le poll auto le ramènerait en bas toutes les 20s — chiant).
  const lastMessageCountRef = useRef(0);
  const lastChatIdForScrollRef = useRef<string | null>(null);
  const isNearBottomRef = useRef(true);

  // Track scroll position pour détecter si l'user est en bas
  useEffect(() => {
    const container = messagesScrollRef.current;
    if (!container) return;
    const handleScroll = () => {
      const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      isNearBottomRef.current = distFromBottom < 150;
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [selectedChat?.id]);

  // Scroll conditionnel
  useEffect(() => {
    if (loadingMessages || messages.length === 0) return;
    const container = messagesScrollRef.current;
    if (!container) return;

    const chatChanged = lastChatIdForScrollRef.current !== selectedChat?.id;
    const newMessagesCount = messages.length;
    const hasNewMessage = newMessagesCount > lastMessageCountRef.current;

    lastChatIdForScrollRef.current = selectedChat?.id || null;
    lastMessageCountRef.current = newMessagesCount;

    // Premier rendu du chat OU user en bas + nouveau message → scroll
    const shouldScroll = chatChanged || (hasNewMessage && isNearBottomRef.current);
    if (!shouldScroll) return;

    const t = setTimeout(() => {
      requestAnimationFrame(() => {
        try {
          container.scrollTo({
            top: container.scrollHeight,
            behavior: chatChanged ? 'auto' : 'smooth',
          });
          isNearBottomRef.current = true;
        } catch {
          container.scrollTop = container.scrollHeight;
        }
      });
    }, 80);
    return () => clearTimeout(t);
  }, [messages, loadingMessages, selectedChat?.id]);

  // ─── Auto-sync silencieux à l'ouverture d'un chat vide ──────────────
  // Quand on ouvre un chat dont le fetch normal renvoie 0 messages, on
  // déclenche automatiquement sync_chat_history en arrière-plan. Le sync
  // poll Unipile pendant 5-30s puis re-fetch les messages quand prêt.
  // Pas de toast, juste un petit indicateur "Synchronisation…" dans
  // l'écran vide pour montrer que ça travaille.
  //
  // Guard via Set de chat_ids déjà tentés, persisté dans sessionStorage
  // pour résister aux remounts (route change /inbox → /missions → /inbox).
  // Sans ce persist, on retentait inlassablement les mêmes chats vides à
  // chaque navigation → quota Unipile gaspillé sur des conv vraiment
  // vides (ex: leads froids avec un seul InMail sans réponse).
  const SESSION_KEY = 'inbox.autoSyncedChats';
  const loadSyncedSet = (): Set<string> => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return new Set(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set();
    }
  };
  const persistSyncedSet = (set: Set<string>) => {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify([...set]));
    } catch {
      // Quota dépassé ou storage désactivé → on continue en mémoire seule
    }
  };
  const autoSyncedRef = useRef<Set<string>>(loadSyncedSet());
  const [autoSyncing, setAutoSyncing] = useState(false);
  useEffect(() => {
    if (!onAutoSyncIfEmpty) return;
    if (!selectedChat?.id) return;
    if (loadingMessages) return;
    if (messages.length > 0) return;
    if (autoSyncedRef.current.has(selectedChat.id)) return;
    const chatId = selectedChat.id;
    autoSyncedRef.current.add(chatId);
    persistSyncedSet(autoSyncedRef.current);
    setAutoSyncing(true);
    onAutoSyncIfEmpty(chatId)
      .catch(() => {
        // Silencieux : si le sync échoue (chat supprimé, timeout, etc.)
        // l'utilisateur peut toujours cliquer sur "Recharger" pour avoir
        // un message d'erreur explicite.
      })
      .finally(() => {
        // Ne décroche que si on est encore sur ce chat (l'user a peut-
        // être switché entre temps).
        if (selectedChat?.id === chatId) setAutoSyncing(false);
      });
  }, [selectedChat?.id, messages.length, loadingMessages, onAutoSyncIfEmpty]);

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
    // Skip les messages sans contenu affichable (Unipile remonte parfois
    // des messages "fantômes" sans texte ni attachment — ex. anciennes
    // réactions désynchro, payloads partiels). Sinon ils créent des
    // bulles vides chelou dans le thread.
    messages.forEach(m => {
      if (!hasDisplayableContent(m) && (!m.reactions || m.reactions.length === 0)) return;
      items.push({ kind: 'message', data: m });
    });
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

  // User connecté + org + variables custom pour les placeholders templates
  const { user } = useAuthReady();

  // Action IA : Résumer la conversation
  const { summarize, summarizeLoading } = useTextActions();
  const [summary, setSummary] = useState<SummarizeResult | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);

  // Stop séquence depuis l'inbox : workflow naturel quand on prend la
  // conversation à la main et qu'on veut éviter les relances auto qui
  // partent encore. Lookup l'enrollment actif via profile_id (pas dans
  // SequenceEnrollmentInfo qui ne porte pas l'ID), update status='paused'
  // + cancel les executions schedulées.
  const [stopSeqConfirm, setStopSeqConfirm] = useState(false);
  const [stoppingSeq, setStoppingSeq] = useState(false);
  const [seqStoppedLocal, setSeqStoppedLocal] = useState(false);

  // Reset le flag local quand on change de chat (sinon on garde "stoppé"
  // affiché en allant sur un autre candidat actif)
  useEffect(() => {
    setSeqStoppedLocal(false);
  }, [selectedChat?.id]);

  const handleStopSequence = async () => {
    if (!selectedChat) return;
    const profileId = getAttendeeProfileId(selectedChat);
    if (!profileId) {
      toast.error('Profil candidat introuvable');
      return;
    }
    setStoppingSeq(true);
    try {
      const { data: active, error: fetchErr } = await supabase
        .from('sequence_enrollments')
        .select('id')
        .eq('profile_id', profileId)
        .eq('status', 'active')
        .order('created_at', { ascending: false });
      if (fetchErr) throw fetchErr;
      const ids = (active || []).map(e => e.id);
      if (ids.length === 0) {
        toast.info('Aucune séquence active pour ce candidat');
        setStopSeqConfirm(false);
        return;
      }
      // Pause toutes les inscriptions actives (cas rare où il y en aurait plusieurs)
      const { error: pauseErr } = await supabase
        .from('sequence_enrollments')
        .update({ status: 'paused' })
        .in('id', ids);
      if (pauseErr) throw pauseErr;
      // Cancel les executions schedulées
      await supabase
        .from('sequence_step_executions')
        .update({ status: 'cancelled', skip_reason: 'Stoppé depuis Inbox' })
        .in('enrollment_id', ids)
        .eq('status', 'scheduled');
      setSeqStoppedLocal(true);
      toast.success(ids.length > 1 ? `${ids.length} séquences arrêtées` : 'Séquence arrêtée');
    } catch (err) {
      console.error('[MessageView] stopSequence error:', err);
      toast.error("Erreur lors de l'arrêt");
    } finally {
      setStoppingSeq(false);
      setStopSeqConfirm(false);
    }
  };

  /** Wrapper du re-fetch qui toaste selon le résultat.
      Si la 1ère tentative (fetch normal) renvoie 0, le parent enchaîne
      automatiquement avec un sync_chat_history (peut prendre 10-30s). */
  const handleRefetch = async () => {
    if (!onRefetchMessages) return;
    toast.info('Synchronisation en cours...', {
      description: 'Si l\'historique n\'est pas en cache, on force une resync (~10-30s)',
      duration: 4000,
    });
    const result = await onRefetchMessages();
    if (typeof result === 'number' && result === 0) {
      toast.warning(
        "LinkedIn n'a pas pu récupérer les messages",
        {
          description:
            'Cette conversation a été supprimée côté LinkedIn ou son historique n\'est plus accessible.',
          duration: 6000,
        }
      );
    } else if (typeof result === 'number' && result > 0) {
      toast.success(`${result} message${result > 1 ? 's' : ''} chargé${result > 1 ? 's' : ''}`);
    }
  };

  const handleSummarize = async () => {
    if (messages.length === 0) return;
    // Build conversation text
    const convText = messages
      .slice(-30) // 30 derniers max
      .map(m => `${m.is_sender ? 'RECRUTEUR' : (selectedChat ? getChatDisplayName(selectedChat) : 'CANDIDAT')}: ${getMessageText(m)}`)
      .join('\n');
    const result = await summarize(convText);
    if (result) {
      setSummary(result);
      setSummaryOpen(true);
    }
  };

  // Reset le résumé quand on change de chat
  useEffect(() => {
    setSummary(null);
    setSummaryOpen(false);
  }, [selectedChat?.id]);
  const { organization } = useOrganization();
  const { asMap: customVariablesMap } = useUserTemplateVariables();

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

  // ─── Calculs hoisted AVANT le early return ────────────────────────
  // Tous les hooks (useMemo / useEffect / useState) doivent être appelés
  // dans le même ordre à chaque render, donc PAS après un return
  // conditionnel. On hoist aussi les const dépendantes pour que les
  // useMemo aient leurs deps disponibles.
  const jobInfo = selectedChat ? getChatJobInfo(selectedChat, enrollmentsMap) : null;
  const currentJobData = jobInfo?.job_id
    ? availableJobs.find(j => j.id === jobInfo.job_id)
    : undefined;

  // Si pas d'enrollment (conv manuelle), on essaie d'inférer la mission à
  // partir du subject InMail et des premiers messages envoyés. Permet
  // d'afficher le contexte (mission + outreach_config) même sans séquence.
  const inferredMission = useMemo<ActiveMissionLite | null>(() => {
    if (jobInfo) return null; // Déjà couvert par enrollment
    if (!activeMissions.length || !selectedChat) return null;

    const sentTexts = messages
      .filter(m => m.is_sender)
      .slice(0, 8)
      .map(m => (m.text || m.text_content || ''))
      .filter(Boolean);
    const haystack = [
      selectedChat.subject,
      selectedChat.name,
      ...sentTexts,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    const norm = (s: string | null | undefined) => (s || '').toLowerCase().trim();

    if (haystack.length >= 5) {
      // 1. Match exact sur job_title (>4 chars pour éviter "AI")
      const byJobTitle = activeMissions.find(m => {
        const t = norm(m.job_title);
        return t.length > 4 && haystack.includes(t);
      });
      if (byJobTitle) return byJobTitle;

      // 2. Match sur le name de la mission
      const byName = activeMissions.find(m => {
        const n = norm(m.name);
        return n.length > 4 && haystack.includes(n);
      });
      if (byName) return byName;

      // 3. Match par client_name (ex: "Theodo Group" mentionné dans le msg)
      const byClient = activeMissions.find(m => {
        const c = norm(m.client_name);
        return c.length > 3 && haystack.includes(c);
      });
      if (byClient) return byClient;

      // 4. Match fuzzy : >=2 mots significatifs (>3 chars) du job_title
      //    présents dans le haystack — capture les variantes de titres
      //    ("Lead AI Engineer" vs "Senior AI Engineer Lead")
      const byFuzzyTitle = activeMissions.find(m => {
        const t = norm(m.job_title);
        if (t.length < 5) return false;
        const words = t.split(/\s+/).filter(w => w.length > 3);
        if (words.length < 2) return false;
        const hits = words.filter(w => haystack.includes(w)).length;
        return hits >= 2;
      });
      if (byFuzzyTitle) return byFuzzyTitle;
    }

    // 5. Fallback : une seule mission active dans l'org → on l'utilise
    //    par défaut. Hypothèse safe : si le user n'a qu'une seule mission,
    //    toutes les conv portent dessus.
    return activeMissions.length === 1 ? activeMissions[0] : null;
  }, [jobInfo, activeMissions, selectedChat, messages]);

  // Source unifiée pour les badges contextuels. Préfère jobInfo (séquence)
  // sinon utilise inferredMission (conv manuelle matchée).
  const displayContext = jobInfo
    ? {
        title: jobInfo.job_title,
        stepOrder: jobInfo.current_step_order,
        status: jobInfo.status,
        repliedAt: jobInfo.replied_at,
        outreachConfig: jobInfo.outreach_config || null,
        clientName: jobInfo.client_name || null,
        inSequence: true,
      }
    : inferredMission
    ? {
        title: inferredMission.job_title || inferredMission.name,
        stepOrder: null,
        status: inferredMission.status,
        repliedAt: null,
        outreachConfig: inferredMission.outreach_config,
        clientName: inferredMission.client_name,
        inSequence: false,
      }
    : null;

  // Données mémoïsées pour le bouton "Réponse + CTA". Sans memo, ces
  // structures sont recalculées à chaque render (poll auto 20s,
  // keystroke dans le composer) → MessageComposer et CtaReplyButton
  // re-renderent pour rien.
  const ctaChatHistory = useMemo(() => (
    messages
      .filter(m => getMessageText(m).trim().length > 0)
      .slice(-12)
      .map(m => ({
        text: getMessageText(m),
        is_sender: !!m.is_sender,
        timestamp: m.timestamp,
      }))
  ), [messages]);

  const ctaJobBrief = useMemo(
    () => jobDataToBrief(currentJobData),
    [currentJobData],
  );

  const ctaRecruiterName = useMemo(() => (
    user?.user_metadata?.full_name
    || [user?.user_metadata?.first_name, user?.user_metadata?.last_name].filter(Boolean).join(' ')
    || undefined
  ), [user?.user_metadata?.full_name, user?.user_metadata?.first_name, user?.user_metadata?.last_name]);

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
  const channel = detectChannel(selectedChat.account_type);

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
    tone: currentTone, // Passe le tone choisi par l'user au prompt Claude
  };

  // ─── LAYOUT — CSS Grid 3 rangées (auto / 1fr / auto) ─────────────────
  return (
    <div
      className="h-full min-w-0 bg-background overflow-hidden"
      style={{
        display: 'grid',
        gridTemplateRows: 'auto minmax(0, 1fr) auto',
        gridTemplateColumns: 'minmax(0, 1fr)',
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
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-semibold text-foreground truncate text-[15px] tracking-tight">
                {displayName}
              </h2>
              {/* Badge statut séquence si enrollment actif/passé */}
              {jobInfo && jobInfo.status && (
                <SequenceStatusBadge status={jobInfo.status} repliedAt={jobInfo.replied_at} />
              )}
              {/* Si pas en séquence mais mission inférée → badge "Hors séquence" */}
              {!jobInfo && inferredMission && (
                <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-md border bg-muted/40 text-muted-foreground border-border whitespace-nowrap">
                  Hors séquence
                </span>
              )}
            </div>
            {headline && (
              <p className="text-[13px] text-muted-foreground truncate mt-0.5 leading-tight">
                {headline}
              </p>
            )}
            {/* Bandeau contexte mission : poste + statut séquence + mode outreach + anonymisation */}
            {displayContext && (
              <div className="flex items-center gap-2 flex-wrap mt-1.5">
                {displayContext.title && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-foreground bg-foreground/8 border border-border px-2 py-0.5 rounded-md">
                    <Briefcase className="w-3 h-3 text-muted-foreground" />
                    {displayContext.title}
                  </span>
                )}
                {displayContext.stepOrder != null && displayContext.status === 'active' && !seqStoppedLocal && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-info bg-info/10 border border-info/30 px-2 py-0.5 rounded-md">
                    Étape {(displayContext.stepOrder ?? 0) + 1}
                  </span>
                )}
                {/* Bouton Stop séquence inline — visible uniquement si une
                    séquence est ACTIVE pour ce candidat. UX : workflow
                    naturel quand l'user veut prendre la conv à la main et
                    couper les relances auto qui partent encore. */}
                {displayContext.status === 'active' && !seqStoppedLocal && (
                  <button
                    type="button"
                    onClick={() => setStopSeqConfirm(true)}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-destructive bg-destructive/8 border border-destructive/30 px-2 py-0.5 rounded-md hover:bg-destructive/15 transition-colors"
                    title="Arrêter la séquence — annule toutes les relances programmées pour ce candidat"
                  >
                    <StopCircle className="w-3 h-3" />
                    Arrêter
                  </button>
                )}
                {seqStoppedLocal && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground bg-muted/40 border border-border px-2 py-0.5 rounded-md">
                    <StopCircle className="w-3 h-3" />
                    Séquence stoppée
                  </span>
                )}
                {displayContext.outreachConfig?.recruitment_mode && (
                  <span
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground bg-muted/40 border border-border px-2 py-0.5 rounded-md"
                    title={displayContext.outreachConfig.recruitment_mode === 'internal'
                      ? 'L\'IA parle en "on / nous / chez nous"'
                      : 'L\'IA parle en cabinet externe'}
                  >
                    {displayContext.outreachConfig.recruitment_mode === 'internal' ? '🏢 Interne' : '🤝 Cabinet'}
                  </span>
                )}
                {displayContext.outreachConfig?.anonymize_client && (
                  <span
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-warning bg-warning/10 border border-warning/30 px-2 py-0.5 rounded-md"
                    title={`Le nom du client est masqué dans les réponses générées (alias : ${displayContext.outreachConfig.anonymized_alias || 'défaut'})`}
                  >
                    🕶 Anonyme
                  </span>
                )}
                {displayContext.clientName && !displayContext.outreachConfig?.anonymize_client && (
                  <span
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground bg-muted/30 border border-border px-2 py-0.5 rounded-md"
                    title="Client de la mission"
                  >
                    {displayContext.clientName}
                  </span>
                )}
              </div>
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
            {/* Bouton Résumer (visible si conv >= 4 messages) */}
            {messages.length >= 4 && (
              <button
                type="button"
                onClick={handleSummarize}
                disabled={summarizeLoading}
                className={cn(
                  'h-8 px-3 inline-flex items-center gap-1.5 text-xs font-medium rounded-lg transition-colors',
                  summarizeLoading
                    ? 'text-muted-foreground cursor-wait'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                )}
                title="Générer un résumé de la conversation"
              >
                {summarizeLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <FileText className="w-3.5 h-3.5" />
                )}
                <span>Résumer</span>
              </button>
            )}
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

        {/* Panneau Résumé — affiché juste sous le header quand summary dispo */}
        {summary && summaryOpen && (
          <div className="border-t border-border bg-gradient-to-br from-foreground/5 to-foreground/[0.02] px-5 py-3">
            <div className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-md bg-foreground/10 grid place-items-center shrink-0">
                <FileText className="w-4 h-4 text-foreground/70" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <h3 className="text-xs font-semibold text-foreground">
                    Résumé IA
                  </h3>
                  <button
                    type="button"
                    onClick={() => setSummaryOpen(false)}
                    className="text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    Fermer
                  </button>
                </div>
                <p className="text-[13px] text-foreground/80 leading-relaxed">
                  {summary.summary}
                </p>
                {summary.key_points && summary.key_points.length > 0 && (
                  <ul className="mt-2 space-y-0.5">
                    {summary.key_points.map((p, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-[12px] text-muted-foreground">
                        <span className="mt-1.5 h-1 w-1 rounded-full bg-muted-foreground/50 shrink-0" />
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {summary.next_action && (
                  <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-foreground/5 text-[11px] text-foreground/80">
                    <ArrowRight className="w-3 h-3 text-foreground/50" />
                    <span className="font-medium">Prochaine étape :</span>
                    <span>{summary.next_action}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </header>

      {/* ROW 2 — MESSAGES (scrollable, design moderne avec grouping)
          overflow-x-hidden + min-w-0 pour empêcher tout débordement
          horizontal (ex: long URL non-coupable dans un message) */}
      <div
        ref={messagesScrollRef}
        className="overflow-y-auto overflow-x-hidden overscroll-y-contain bg-background min-w-0"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {/* Container utilise pleine largeur avec padding latéral généreux.
            Les bulles ont leur propre max-width en pourcentage. */}
        <div className="px-6 py-6 min-w-0 max-w-full">
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
              <div className="text-center max-w-md px-4">
                <div className="h-16 w-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-muted to-muted/40 grid place-items-center">
                  <MessageSquare className="w-7 h-7 opacity-40" />
                </div>
                {selectedChat.last_message?.text ? (
                  <>
                    {/* On a un last_message en DB mais Unipile ne renvoie pas l'historique
                        (conv ancienne, archivée, ou rate limit) — on l'affiche au moins */}
                    <p className="text-base font-medium text-foreground/80">
                      Historique indisponible
                    </p>
                    <p className="text-sm text-muted-foreground/70 mt-1 mb-4">
                      LinkedIn n'a pas renvoyé les messages de cette conversation.
                      Voici le dernier message connu :
                    </p>
                    <div className={cn(
                      "px-4 py-3 rounded-2xl text-sm leading-relaxed text-left mt-4 inline-block max-w-full",
                      selectedChat.last_message.is_sender
                        ? "bg-foreground text-background rounded-br-sm"
                        : "bg-muted text-foreground rounded-bl-sm"
                    )}>
                      <p className="whitespace-pre-wrap break-words">
                        {selectedChat.last_message.text || selectedChat.last_message.text_content}
                      </p>
                      {selectedChat.last_message.timestamp && (
                        <p className="text-[10px] text-muted-foreground/70 mt-1">
                          {formatMessageTime(selectedChat.last_message.timestamp)}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={handleRefetch}
                      disabled={loadingMessages}
                      className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-foreground text-background hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                      {loadingMessages ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : null}
                      <span>Recharger les messages</span>
                    </button>
                  </>
                ) : autoSyncing ? (
                  <>
                    <p className="text-base font-medium text-foreground/80 inline-flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Synchronisation de l'historique…
                    </p>
                    <p className="text-sm text-muted-foreground/70 mt-1 mb-3">
                      LinkedIn récupère les messages de cette conversation. Ça peut prendre quelques secondes.
                    </p>
                    {/* Escape hatch : si le sync prend trop de temps,
                        l'user peut forcer un refetch manuel (avec toast
                        d'erreur explicite si fail). */}
                    {onRefetchMessages && (
                      <button
                        type="button"
                        onClick={handleRefetch}
                        disabled={loadingMessages}
                        className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-background text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                      >
                        <span>Forcer le rechargement</span>
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-base font-medium text-foreground/80">Aucun message</p>
                    <p className="text-sm text-muted-foreground/70 mt-1 mb-3">
                      Cette conversation est vide ou LinkedIn n'a pas encore renvoyé l'historique.
                    </p>
                    {onRefetchMessages && (
                      <button
                        type="button"
                        onClick={handleRefetch}
                        disabled={loadingMessages}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-foreground text-background hover:opacity-90 transition-opacity disabled:opacity-50"
                      >
                        {loadingMessages ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : null}
                        <span>Recharger les messages</span>
                      </button>
                    )}
                  </>
                )}
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
                      <span className="text-[11px] font-medium text-muted-foreground/70 px-2">
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
                  <motion.div
                    key={msg.id ?? idx}
                    // Entrée spring par bulle : un message envoyé ou une
                    // réponse qui arrive se pose au lieu d'apparaître d'un
                    // coup. Au premier rendu du thread, toutes les bulles
                    // montent ensemble (pas de stagger — resterait lourd sur
                    // les longues conversations).
                    initial={{ opacity: 0, y: 6, scale: 0.985 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ type: 'spring', stiffness: 480, damping: 38, mass: 0.7 }}
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
                        gauche/droite lisible. min-w-0 pour permettre le shrink. */}
                    <div className="relative max-w-[85%] md:max-w-[75%] min-w-0">
                      <div
                        className={cn(
                          'px-4 py-2.5 text-sm leading-relaxed shadow-sm transition-shadow',
                          'group-hover/msg:shadow-md min-w-0 overflow-hidden',
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
                        {/* overflow-wrap:anywhere force le wrap même pour les
                            URLs/strings longs sans espace. break-words seul
                            ne suffit pas pour les URLs ultra-longues. */}
                        <p
                          className={cn(
                            "whitespace-pre-wrap break-words text-pretty",
                            // Italic + dim pour les placeholders (pièce jointe,
                            // message supprimé) pour les distinguer du texte réel.
                            !getMessageText(msg) && "italic opacity-75",
                          )}
                          style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
                        >
                          {getMessageDisplayText(msg)}
                        </p>
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
                  </motion.div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* ROW 3 — COMPOSER + Smart Replies + AI panel optionnel */}
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
        {/* Smart Replies — quick suggestions style Gmail. Affiché si on a
            des suggestions ET que le panel n'est pas déjà ouvert (pour
            éviter la redondance). */}
        {!aiPanelOpen && replySuggestions.length > 0 && (
          <SmartReplies
            suggestions={replySuggestions}
            onPick={(text) => onSuggestionClick(text)}
            onSeeMore={() => setAiPanelOpen(true)}
          />
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
          placeholderContext={buildPlaceholderContext({
            chat: selectedChat,
            messages,
            currentJob: currentJobData,
            user: user ? {
              email: user.email,
              full_name: user.user_metadata?.full_name,
              first_name: user.user_metadata?.first_name,
              last_name: user.user_metadata?.last_name,
              job_title: user.user_metadata?.job_title,
            } : undefined,
            organizationName: organization?.name,
            calendlyLink,
            customVariables: customVariablesMap(),
          })}
          // Données pour le bouton "Réponse + CTA" (mémoïsées plus haut
          // pour éviter les re-renders du composer à chaque keystroke).
          ctaChatHistory={ctaChatHistory}
          ctaCandidateName={selectedChat ? getChatDisplayName(selectedChat) : undefined}
          ctaRecruiterName={ctaRecruiterName}
          ctaJobTitle={currentJobData?.title}
          ctaJobBrief={ctaJobBrief}
          ctaCalendlyLink={calendlyLink || undefined}
          ctaTone={currentTone}
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

      {/* Stop sequence confirmation dialog */}
      <AlertDialog open={stopSeqConfirm} onOpenChange={(open) => !open && setStopSeqConfirm(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arrêter la séquence ?</AlertDialogTitle>
            <AlertDialogDescription>
              Toutes les actions programmées pour ce candidat (relances, InMails, emails) seront annulées.
              Tu pourras reprendre la séquence depuis l'écran de gestion outreach si besoin.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              disabled={stoppingSeq}
              onClick={handleStopSequence}
            >
              {stoppingSeq ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <StopCircle className="w-4 h-4 mr-2" />}
              Arrêter la séquence
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

/**
 * SequenceStatusBadge — petit badge coloré qui rend visible l'état de
 * l'enrollment du candidat dans la séquence outreach. Affiché dans le
 * header de la conversation à côté du nom.
 *
 * Statuts possibles :
 *  - active     : candidat en cours de séquence (étapes pas encore toutes envoyées)
 *  - replied    : a répondu (la séquence s'arrête automatiquement)
 *  - paused     : en pause (raison: crédits InMail = 0, profil bloqué 403, etc.)
 *  - completed  : toutes les étapes ont été exécutées
 *  - cancelled / stopped : interrompu manuellement
 */
const SequenceStatusBadge: React.FC<{ status: string; repliedAt: string | null }> = ({ status, repliedAt }) => {
  // Si répondu, override le statut pour l'affichage (même si le DB dit "active")
  const effectiveStatus = repliedAt ? 'replied' : status;
  const config: Record<string, { label: string; className: string }> = {
    active: { label: 'En séquence', className: 'bg-info/10 text-info border-info/30' },
    replied: { label: '✓ A répondu', className: 'bg-success/10 text-success border-success/30' },
    paused: { label: '⏸ En pause', className: 'bg-warning/10 text-warning border-warning/30' },
    completed: { label: 'Terminé', className: 'bg-muted/40 text-muted-foreground border-border' },
    cancelled: { label: 'Annulé', className: 'bg-destructive/10 text-destructive border-destructive/30' },
    stopped: { label: 'Stoppé', className: 'bg-destructive/10 text-destructive border-destructive/30' },
  };
  const cfg = config[effectiveStatus] || config.active;
  return (
    <span
      className={cn(
        'inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-md border whitespace-nowrap',
        cfg.className,
      )}
    >
      {cfg.label}
    </span>
  );
};
