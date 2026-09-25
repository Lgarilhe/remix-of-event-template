/**
 * MessageView — une conversation : en-tête, fil des messages, composeur.
 *
 * Grille à trois rangées explicites (auto / 1fr / auto) : l'en-tête et le
 * composeur gardent leur hauteur, le fil prend le reste et défile.
 *
 * Revue design, lot 6a :
 * - en-tête : statut d'inscription (EnrollmentStatusBadge), mission de
 *   l'inscription ou « Mission probable » quand elle n'est que déduite des
 *   messages ; actions sur ordinateur comme sur téléphone : sommeil, archive,
 *   « Inscrire dans une séquence », menu « Plus d'actions » (D-02, D-03,
 *   D-08, D-18) ;
 * - fil : frise d'activité tirée du catalogue des séquences, bulles sans ombre
 *   ni ressort, réagir et supprimer au doigt, au survol et au clavier (D-01,
 *   D-12, D-15) ;
 * - composeur : brouillon signalé, un seul bouton principal (D-10, D-13).
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/layout';
import { EnrollmentStatusBadge } from '@/components/outreach/SequenceBadges';
import {
  Archive, ArrowRight, Briefcase, Check, CheckCheck, ChevronLeft, CircleStop, Clock, ExternalLink,
  FileText, ListPlus, Loader2, MessageSquare, MoreHorizontal, RefreshCw, SmilePlus, Trash2,
} from 'lucide-react';
import { useTextActions, type SummarizeResult } from '@/hooks/useTextActions';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { Chat, Message, SequenceEnrollmentInfo, JobData, ActiveMissionLite } from '@/hooks/useMessagesInbox';
import { ChannelIcon, detectChannel } from '@/components/ui/ChannelIcon';
import { channelLabel } from '@/lib/channels';
import {
  getChatDisplayName, getChatHeadline, getChatSubject, getChatAvatar,
  getInitials, getMessageText, getMessageDisplayText, hasDisplayableContent,
  getChatJobInfo, getAttendeeProfileId,
  formatMessageTime,
} from '@/hooks/useMessagesInboxHelpers';
import { jobDataToBrief } from '@/lib/jobBriefForCta';
import { LINKEDIN_REACTIONS } from '@/lib/messageEmojis';

// Boutons icône de l'en-tête : 44 px au doigt, 32 px à la souris (01-direction.md, § 5)
const HEADER_ICON = 'h-11 w-11 text-muted-foreground hover:text-foreground md:h-8 md:w-8';
// Cibles de 44 px au doigt dans les menus
const MENU_ITEM = 'min-h-11 md:min-h-0';
// Action d'un message : visible au doigt, révélée au survol ou au focus à la souris (D-12)
const MESSAGE_ACTION = cn(
  'h-11 w-11 shrink-0 self-center text-muted-foreground hover:text-foreground md:h-7 md:w-7',
  '[@media(hover:hover)]:opacity-0 group-hover/msg:opacity-100 group-focus-within/msg:opacity-100 data-[state=open]:opacity-100',
);

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
  /** Missions actives (sourcing_projects) : une conversation hors séquence dont
   *  les messages citent le poste, le nom ou le client d'une mission affiche
   *  « Mission probable ». */
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
  /** Place une suggestion dans le composeur (jamais d'envoi direct, D-14). */
  onSuggestionClick: (text: string) => void;
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
  /** Ouvre le choix de la séquence, puis la préparation partagée (D-02). */
  onEnrollInSequence: () => void;
  onScheduleCall: () => void;
  calendlyLink?: string | null;
  onAddReaction?: (messageId: string, reaction: string) => Promise<boolean>;
  onDeleteMessage?: (messageId: string) => Promise<boolean>;
  isReacting?: boolean;
  isDeleting?: boolean;
}

/** Séparateur de date du fil. */
const DateSeparator: React.FC<{ label: string }> = ({ label }) => (
  <div className="my-6 flex select-none items-center gap-3 px-2">
    <div className="h-px flex-1 bg-border" aria-hidden="true" />
    <span className="text-2xs font-medium text-muted-foreground">{label}</span>
    <div className="h-px flex-1 bg-border" aria-hidden="true" />
  </div>
);

/** Message d'état du fil (vide, historique indisponible, synchronisation). */
const ThreadNotice: React.FC<{
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}> = ({ icon, title, children, action }) => (
  <div className="mx-auto flex max-w-md flex-col items-center px-4 text-center" role="status">
    <span className="mb-3 grid h-10 w-10 place-items-center rounded-lg bg-muted text-foreground-secondary">{icon}</span>
    <p className="text-md font-semibold text-foreground">{title}</p>
    {children && <div className="mt-1 text-sm text-muted-foreground">{children}</div>}
    {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
  </div>
);

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
  onAddToPipeline,
  onEnrollInSequence,
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
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState<string | null>(null);
  const [deleteMsgConfirm, setDeleteMsgConfirm] = useState<string | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);

  // Snooze + archive
  const chatStatus = useChatStatus();

  // Draft auto-save : restore au changement de chat
  const { setDraft, clearDraft, hasDraft } = useChatDraft(selectedChat?.id);
  const lastChatIdRef = useRef<string | null>(null);
  const skipNextDraftSaveRef = useRef(false);
  useEffect(() => {
    const id = selectedChat?.id || null;
    if (id === lastChatIdRef.current) return;
    lastChatIdRef.current = id;
    skipNextDraftSaveRef.current = true;
    // Lecture synchrone du stockage : la valeur `draft` du rendu courant est
    // encore celle du chat précédent quand cet effet s'exécute.
    const stored = readChatDraft(id);
    if (id && stored && !newMessage) onNewMessageChange(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChat?.id]);

  useEffect(() => {
    if (!selectedChat?.id) return;
    // Au changement de conversation, `newMessage` est encore le texte de la
    // conversation précédente : l'écrire ici le rangerait sous le mauvais chat.
    // On saute donc ce seul passage.
    if (skipNextDraftSaveRef.current) {
      skipNextDraftSaveRef.current = false;
      return;
    }
    // La valeur vide est enregistrée elle aussi : sans ça, effacer entièrement
    // son texte laissait le brouillon précédent en place, et il réapparaissait
    // au retour dans la conversation (audit UX du 09/09/2026, constat UX04).
    setDraft(newMessage);
  }, [newMessage, selectedChat?.id, setDraft]);

  const wasSendingRef = useRef(sending);
  useEffect(() => {
    if (wasSendingRef.current && !sending && !newMessage) clearDraft();
    wasSendingRef.current = sending;
  }, [sending, newMessage, clearDraft]);

  // ─── Défilement automatique ─────────────────────────────────────────
  // En bas seulement à l'ouverture de la conversation, ou quand un nouveau
  // message arrive alors qu'on était déjà en bas (à moins de 150 px). Sinon
  // (lecture plus haut dans le fil), le rafraîchissement ne déplace rien.
  const lastMessageCountRef = useRef(0);
  const lastChatIdForScrollRef = useRef<string | null>(null);
  const isNearBottomRef = useRef(true);

  // Position de lecture : près du bas ou non
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

  // Défilement conditionnel
  useEffect(() => {
    if (loadingMessages || messages.length === 0) return;
    const container = messagesScrollRef.current;
    if (!container) return;

    const chatChanged = lastChatIdForScrollRef.current !== selectedChat?.id;
    const newMessagesCount = messages.length;
    const hasNewMessage = newMessagesCount > lastMessageCountRef.current;

    lastChatIdForScrollRef.current = selectedChat?.id || null;
    lastMessageCountRef.current = newMessagesCount;

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

  // ─── Synchronisation silencieuse d'une conversation vide ────────────
  // Une conversation qui s'ouvre sans message lance une synchronisation de
  // l'historique en arrière-plan (5 à 30 s), une fois par conversation et par
  // session : sans cette garde (gardée en sessionStorage pour survivre au
  // changement de page), chaque retour dans la messagerie relançait la même
  // synchronisation sur des conversations réellement vides.
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
        // Silencieux : « Recharger les messages » donne ensuite un message clair.
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
    // Les messages sans contenu affichable (réactions désynchronisées,
    // réponses partielles du service) donneraient des bulles vides.
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

    // Séparateurs de date entre deux jours différents
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

  // Action IA : résumer la conversation
  const { summarize, summarizeLoading } = useTextActions();
  const [summary, setSummary] = useState<SummarizeResult | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);

  // Arrêter la séquence depuis la messagerie : quand on reprend l'échange à la
  // main, les relances automatiques encore programmées sont annulées. Les
  // inscriptions actives du profil passent en pause (raison « manual ») et
  // leurs étapes programmées sont annulées.
  const [stopSeqConfirm, setStopSeqConfirm] = useState(false);
  const [stoppingSeq, setStoppingSeq] = useState(false);
  const [seqStoppedLocal, setSeqStoppedLocal] = useState(false);

  // Nouvelle conversation : l'arrêt affiché ne concerne que la précédente
  useEffect(() => {
    setSeqStoppedLocal(false);
  }, [selectedChat?.id]);

  const handleStopSequence = async () => {
    if (!selectedChat) return;
    const profileId = getAttendeeProfileId(selectedChat);
    if (!profileId) {
      toast.error('Profil du candidat introuvable', { description: "La séquence n'a pas été arrêtée." });
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
        toast.info('Aucune séquence en cours pour ce candidat');
        setStopSeqConfirm(false);
        return;
      }
      // Pause toutes les inscriptions actives (cas rare où il y en aurait plusieurs)
      const { error: pauseErr } = await supabase
        .from('sequence_enrollments')
        .update({ status: 'paused', pause_reason: 'manual' })
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
      toast.error("La séquence n'a pas été arrêtée", { description: 'Réessayez dans un instant.' });
    } finally {
      setStoppingSeq(false);
      setStopSeqConfirm(false);
    }
  };

  /** Rechargement demandé : la première tentative lit le cache ; à vide, le
      parent enchaîne une synchronisation de l'historique (10 à 30 s). */
  const handleRefetch = async () => {
    if (!onRefetchMessages) return;
    toast.info('Synchronisation de la conversation', {
      description: "Si l'historique n'est pas disponible, la synchronisation peut prendre jusqu'à 30 secondes.",
      duration: 4000,
    });
    const result = await onRefetchMessages();
    if (typeof result === 'number' && result === 0) {
      toast.warning(
        "LinkedIn n'a pas renvoyé les messages",
        {
          description:
            "Cette conversation a été supprimée sur LinkedIn ou son historique n'est plus accessible.",
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

  // ─── Calculs avant le retour anticipé (même ordre des hooks à chaque rendu)
  const jobInfo = selectedChat ? getChatJobInfo(selectedChat, enrollmentsMap) : null;
  const currentJobData = jobInfo?.job_id
    ? availableJobs.find(j => j.id === jobInfo.job_id)
    : undefined;

  // Sans inscription, la mission est déduite de l'objet de l'InMail et des
  // premiers messages envoyés. Elle reste une hypothèse : l'en-tête l'affiche
  // comme « Mission probable », sans en tirer le mode de recrutement ni le
  // client, et aucune mission n'est plus supposée par défaut (revue design D-08).
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

    if (haystack.length < 5) return null;

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

    // 4. Au moins deux mots significatifs (plus de 3 lettres) du poste
    //    présents dans les messages (« Lead AI Engineer » et « Senior AI Engineer Lead »)
    const byFuzzyTitle = activeMissions.find(m => {
      const t = norm(m.job_title);
      if (t.length < 5) return false;
      const words = t.split(/\s+/).filter(w => w.length > 3);
      if (words.length < 2) return false;
      const hits = words.filter(w => haystack.includes(w)).length;
      return hits >= 2;
    });
    return byFuzzyTitle ?? null;
  }, [jobInfo, activeMissions, selectedChat, messages]);

  // Données mémoïsées pour « Proposer une suite » : sans memo, elles seraient
  // recalculées à chaque rendu (rafraîchissement, frappe dans le composeur).
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

  // Aucune conversation ouverte (ordinateur)
  if (!selectedChat) {
    return (
      <div className="grid h-full place-items-center bg-background p-6">
        <EmptyState
          icon={MessageSquare}
          title="Sélectionnez une conversation"
          description="Vos messages LinkedIn et vos InMails s'affichent ici."
          className="w-full max-w-sm"
        />
      </div>
    );
  }

  const displayName = getChatDisplayName(selectedChat);
  const headline = getChatHeadline(selectedChat);
  const subject = getChatSubject(selectedChat);
  const channel = detectChannel(selectedChat.account_type);

  // Statut de l'inscription : « A répondu » dès qu'une réponse est notée sur
  // une inscription encore active ; « En pause » juste après un arrêt.
  const enrollmentStatus = jobInfo
    ? seqStoppedLocal
      ? 'paused'
      : jobInfo.status === 'active' && jobInfo.replied_at
        ? 'replied'
        : jobInfo.status
    : null;
  const enrollmentPauseReason = seqStoppedLocal ? 'manual' : jobInfo?.pause_reason ?? null;
  const canStopSequence = !!jobInfo && jobInfo.status === 'active' && !seqStoppedLocal;
  const isSnoozedOrArchived = chatStatus.isSnoozed(selectedChat.id) || chatStatus.isArchived(selectedChat.id);

  // Contexte de la mission, quand l'inscription le donne
  const contextItems: React.ReactNode[] = [];
  if (jobInfo) {
    if (jobInfo.job_title) {
      contextItems.push(
        <span key="title" className="inline-flex min-w-0 items-center gap-1 text-foreground-secondary">
          <Briefcase className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate">{jobInfo.job_title}</span>
        </span>,
      );
    }
    if (canStopSequence && jobInfo.current_step_order != null) {
      contextItems.push(<span key="step">Étape {jobInfo.current_step_order + 1}</span>);
    }
    const config = jobInfo.outreach_config;
    if (config?.recruitment_mode) {
      contextItems.push(
        <span
          key="mode"
          title={config.recruitment_mode === 'internal'
            ? "Les réponses IA parlent au nom de l'entreprise (« nous »)"
            : 'Les réponses IA parlent au nom du cabinet'}
        >
          {config.recruitment_mode === 'internal' ? 'Recrutement interne' : 'Cabinet'}
        </span>,
      );
    }
    if (config?.anonymize_client) {
      contextItems.push(
        <span key="anon" title={`Le nom du client est masqué dans les réponses générées (alias : ${config.anonymized_alias || 'par défaut'})`}>
          Client masqué
        </span>,
      );
    } else if (jobInfo.client_name) {
      contextItems.push(<span key="client">{jobInfo.client_name}</span>);
    }
  }

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

  const handleReaction = async (messageId: string, emoji: string) => {
    if (!onAddReaction) return;
    setReactionPickerMsgId(null);
    setReactingMsgId(messageId);
    await onAddReaction(messageId, emoji);
    setReactingMsgId(null);
  };

  // ─── Mise en page : grille à trois rangées (auto / 1fr / auto) ──────────
  return (
    <div
      className="h-full min-w-0 overflow-hidden bg-background"
      style={{
        display: 'grid',
        gridTemplateRows: 'auto minmax(0, 1fr) auto',
        gridTemplateColumns: 'minmax(0, 1fr)',
      }}
      data-component="message-view"
    >
      {/* RANGÉE 1 : en-tête */}
      <header className="border-b border-border bg-background">
        <div className="flex items-start gap-2 px-2 py-2 md:gap-3 md:px-5 md:py-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 shrink-0 md:hidden"
            onClick={onBack}
            aria-label="Retour aux conversations"
          >
            <ChevronLeft aria-hidden="true" />
          </Button>

          {/* Avatar et pastille du canal */}
          <span className="relative mt-0.5 shrink-0">
            <Avatar className="h-10 w-10">
              <AvatarImage src={avatar} alt="" />
              <AvatarFallback className="text-xs font-semibold text-foreground-secondary">
                {getInitials(displayName)}
              </AvatarFallback>
            </Avatar>
            <span
              aria-hidden="true"
              className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full bg-background ring-1 ring-border"
            >
              <ChannelIcon channel={channel} size="xs" />
            </span>
          </span>

          <div className="min-w-0 flex-1 py-0.5">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="min-w-0 truncate text-md font-semibold text-foreground">{displayName}</h2>
              {enrollmentStatus && (
                <EnrollmentStatusBadge
                  status={enrollmentStatus}
                  pauseReason={enrollmentPauseReason}
                  className="px-1.5 py-0 text-2xs"
                />
              )}
            </div>
            {headline && <p className="truncate text-xs text-muted-foreground">{headline}</p>}
            {contextItems.length > 0 ? (
              <p className="mt-1 flex min-w-0 items-center gap-x-1.5 whitespace-nowrap text-xs text-muted-foreground">
                {contextItems.map((item, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span aria-hidden="true">·</span>}
                    {item}
                  </React.Fragment>
                ))}
              </p>
            ) : inferredMission ? (
              <p
                className="mt-1 flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
                title="Déduite des messages échangés : aucune inscription en séquence ne la confirme."
              >
                <Briefcase className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  Mission probable : {inferredMission.job_title || inferredMission.name}
                </span>
              </p>
            ) : null}
            {subject && (
              <p className="mt-0.5 hidden truncate text-xs text-muted-foreground md:block">Objet : {subject}</p>
            )}
          </div>

          {/* Actions : visibles sur ordinateur et sur téléphone */}
          <div className="flex shrink-0 items-center gap-0.5 md:gap-1">
            <Button variant="outline" size="sm" onClick={onEnrollInSequence} className="hidden lg:inline-flex">
              <ListPlus aria-hidden="true" />
              Inscrire dans une séquence
            </Button>
            <SnoozeArchiveButtons
              chatId={selectedChat.id}
              accountId={selectedChat.account_id}
              isSnoozed={chatStatus.isSnoozed(selectedChat.id)}
              isArchived={chatStatus.isArchived(selectedChat.id)}
              snoozedUntil={chatStatus.getSnoozedUntil(selectedChat.id)}
              onSnooze={chatStatus.snoozeChat}
              onArchive={chatStatus.archiveChat}
              onRestore={chatStatus.restoreChat}
              archiveClassName="hidden md:inline-flex"
            />
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="Plus d'actions" className={HEADER_ICON}>
                      <MoreHorizontal aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Plus d'actions</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuItem className={cn(MENU_ITEM, 'lg:hidden')} onSelect={onEnrollInSequence}>
                  <ListPlus className="mr-2 h-4 w-4" aria-hidden="true" />
                  Inscrire dans une séquence
                </DropdownMenuItem>
                {/* Sur téléphone, l'archive passe dans ce menu pour laisser la place au nom */}
                {!isSnoozedOrArchived && (
                  <DropdownMenuItem
                    className={cn(MENU_ITEM, 'md:hidden')}
                    onSelect={() => chatStatus.archiveChat(selectedChat.id, selectedChat.account_id)}
                  >
                    <Archive className="mr-2 h-4 w-4" aria-hidden="true" />
                    Archiver la conversation
                  </DropdownMenuItem>
                )}
                <ToneSelector selectedTone={currentTone} onToneChange={handleToneChange} className={MENU_ITEM} />
                {messages.length >= 4 && (
                  <DropdownMenuItem
                    className={MENU_ITEM}
                    disabled={summarizeLoading}
                    onSelect={() => void handleSummarize()}
                  >
                    <FileText className="mr-2 h-4 w-4" aria-hidden="true" />
                    Résumer la conversation
                  </DropdownMenuItem>
                )}
                {profileUrl && (
                  <DropdownMenuItem asChild className={MENU_ITEM}>
                    <a href={profileUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
                      Voir le profil LinkedIn
                    </a>
                  </DropdownMenuItem>
                )}
                {canStopSequence && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className={cn(MENU_ITEM, 'text-destructive focus:text-destructive')}
                      onSelect={() => setStopSeqConfirm(true)}
                    >
                      <CircleStop className="mr-2 h-4 w-4" aria-hidden="true" />
                      Arrêter la séquence
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Résumé de la conversation, sous l'en-tête */}
        {summarizeLoading && !(summary && summaryOpen) && (
          <div className="flex items-center gap-2 border-t border-border bg-muted px-3 py-2 text-xs text-muted-foreground md:px-5" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Résumé de la conversation en cours…
          </div>
        )}
        {summary && summaryOpen && (
          <section aria-labelledby="conversation-summary-title" className="border-t border-border bg-muted px-3 py-3 md:px-5">
            <div className="flex items-start gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-background text-foreground-secondary">
                <FileText className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <h3 id="conversation-summary-title" className="text-xs font-semibold text-foreground">
                    Résumé de la conversation
                  </h3>
                  <Button variant="ghost" size="xs" onClick={() => setSummaryOpen(false)}>
                    Fermer le résumé
                  </Button>
                </div>
                <p className="text-sm leading-relaxed text-foreground-secondary">{summary.summary}</p>
                {summary.key_points && summary.key_points.length > 0 && (
                  <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground marker:text-muted-foreground">
                    {summary.key_points.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                )}
                {summary.next_action && (
                  <p className="mt-2 inline-flex items-start gap-1.5 rounded-md bg-background px-2 py-1 text-xs text-foreground-secondary">
                    <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span>
                      <span className="font-medium text-foreground">Prochaine étape : </span>
                      {summary.next_action}
                    </span>
                  </p>
                )}
              </div>
            </div>
          </section>
        )}
      </header>

      {/* RANGÉE 2 : fil des messages, seul à défiler */}
      <div
        ref={messagesScrollRef}
        className="min-w-0 overflow-y-auto overflow-x-hidden overscroll-y-contain bg-background"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        <div className="min-w-0 max-w-full px-3 py-6 md:px-6">
          {loadingMessages && messages.length === 0 ? (
            <div className="flex flex-col gap-4" role="status" aria-label="Chargement des messages">
              {[40, 28, 56, 36, 32].map((width, i) => (
                <Skeleton
                  key={i}
                  className={cn('h-12 rounded-xl', i % 2 ? 'self-end' : 'self-start')}
                  style={{ width: `${width}%` }}
                />
              ))}
            </div>
          ) : messages.length === 0 ? (
            <div className="grid min-h-[40vh] place-items-center">
              {selectedChat.last_message?.text ? (
                <ThreadNotice
                  icon={<MessageSquare className="h-5 w-5" aria-hidden="true" />}
                  title="Historique indisponible"
                  action={
                    onRefetchMessages ? (
                      <Button variant="outline" size="sm" onClick={handleRefetch} loading={loadingMessages}>
                        {!loadingMessages && <RefreshCw aria-hidden="true" />}
                        Recharger les messages
                      </Button>
                    ) : undefined
                  }
                >
                  <p>LinkedIn n'a pas renvoyé les messages de cette conversation. Voici le dernier message connu :</p>
                  <div
                    className={cn(
                      'mt-4 inline-block max-w-full rounded-xl px-4 py-3 text-left text-sm leading-relaxed',
                      selectedChat.last_message.is_sender
                        ? 'rounded-br-md bg-foreground text-background'
                        : 'rounded-bl-md bg-muted text-foreground',
                    )}
                  >
                    <p className="whitespace-pre-wrap break-words">
                      {selectedChat.last_message.text || selectedChat.last_message.text_content}
                    </p>
                  </div>
                  {selectedChat.last_message.timestamp && (
                    <p className="mt-1 text-3xs tabular-nums text-muted-foreground">
                      {formatMessageTime(selectedChat.last_message.timestamp)}
                    </p>
                  )}
                </ThreadNotice>
              ) : autoSyncing ? (
                <ThreadNotice
                  icon={<Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />}
                  title="Synchronisation de l'historique"
                  action={
                    onRefetchMessages ? (
                      <Button variant="outline" size="sm" onClick={handleRefetch} disabled={loadingMessages}>
                        Forcer le rechargement
                      </Button>
                    ) : undefined
                  }
                >
                  LinkedIn récupère les messages de cette conversation, ce qui peut prendre quelques secondes.
                </ThreadNotice>
              ) : (
                <ThreadNotice
                  icon={<MessageSquare className="h-5 w-5" aria-hidden="true" />}
                  title="Aucun message"
                  action={
                    onRefetchMessages ? (
                      <Button variant="outline" size="sm" onClick={handleRefetch} loading={loadingMessages}>
                        {!loadingMessages && <RefreshCw aria-hidden="true" />}
                        Recharger les messages
                      </Button>
                    ) : undefined
                  }
                >
                  Cette conversation est vide, ou LinkedIn n'a pas encore renvoyé son historique.
                </ThreadNotice>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              {timeline.map((item, idx) => {
                if (item.kind === 'date') {
                  return <DateSeparator key={`date-${item.date}`} label={item.label} />;
                }

                if (item.kind === 'event') {
                  return <ActivityEventCard key={`evt-${item.data.id}`} event={item.data} />;
                }
                const msg = item.data;
                const isSender = !!msg.is_sender;

                // Regroupement des messages consécutifs d'un même auteur
                // (les séparateurs et les événements interrompent le groupe).
                const prev = idx > 0 ? timeline[idx - 1] : null;
                const prevIsSameSender =
                  prev?.kind === 'message' && !!prev.data.is_sender === isSender;
                const next = idx < timeline.length - 1 ? timeline[idx + 1] : null;
                const nextIsSameSender =
                  next?.kind === 'message' && !!next.data.is_sender === isSender;

                const isFirstOfGroup = !prevIsSameSender;
                const isLastOfGroup = !nextIsSameSender;
                const canReact = !isSender && !!onAddReaction && msg.id != null;
                const canDelete = isSender && !!onDeleteMessage && msg.id != null;
                const reacting = isReacting && reactingMsgId === msg.id;

                return (
                  <div
                    key={msg.id ?? idx}
                    className={cn(
                      'group/msg flex items-end gap-2',
                      isSender ? 'justify-end' : 'justify-start',
                      isFirstOfGroup && idx > 0 && 'mt-4',
                    )}
                  >
                    {/* Avatar du candidat, sur le dernier message du groupe */}
                    {!isSender && (
                      <div className="h-8 w-8 shrink-0">
                        {isLastOfGroup && (
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={avatar} alt="" />
                            <AvatarFallback className="text-3xs font-semibold text-foreground-secondary">
                              {getInitials(displayName)}
                            </AvatarFallback>
                          </Avatar>
                        )}
                      </div>
                    )}

                    {/* Supprimer (message envoyé) */}
                    {canDelete && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => setDeleteMsgConfirm(msg.id)}
                            aria-label="Supprimer ce message"
                            className={MESSAGE_ACTION}
                          >
                            <Trash2 aria-hidden="true" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Supprimer ce message</TooltipContent>
                      </Tooltip>
                    )}

                    {/* Bulle : 85 % de large au plus sur téléphone, 75 % au-delà */}
                    <div className={cn('flex min-w-0 max-w-[85%] flex-col md:max-w-[75%]', isSender ? 'items-end' : 'items-start')}>
                      <div
                        className={cn(
                          'min-w-0 max-w-full overflow-hidden rounded-xl px-4 py-2.5 text-sm leading-relaxed',
                          isSender ? 'bg-foreground text-background' : 'bg-muted text-foreground',
                          isSender
                            ? cn(isFirstOfGroup && 'rounded-tr-md', isLastOfGroup && 'rounded-br-md')
                            : cn(isFirstOfGroup && 'rounded-tl-md', isLastOfGroup && 'rounded-bl-md'),
                        )}
                      >
                        {/* overflow-wrap: anywhere coupe aussi les adresses longues sans espace */}
                        <p
                          className={cn('whitespace-pre-wrap break-words text-pretty', !getMessageText(msg) && 'italic')}
                          style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
                        >
                          {getMessageDisplayText(msg)}
                        </p>
                      </div>

                      {/* Réactions reçues, groupées par emoji */}
                      {msg.reactions && msg.reactions.length > 0 && (
                        <div className={cn('mt-1 flex flex-wrap gap-1', isSender ? 'justify-end' : 'justify-start')}>
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
                              className="inline-flex items-center gap-0.5 rounded-full border border-border bg-background px-1.5 py-0.5 text-xs"
                            >
                              <span>{emoji}</span>
                              {count > 1 && (
                                <span className="text-3xs font-medium tabular-nums text-muted-foreground">{count}</span>
                              )}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Heure et accusé de lecture, sur le dernier message du groupe */}
                      {isLastOfGroup && (
                        <div
                          className={cn(
                            'mt-1 flex items-center gap-1 px-1 text-3xs text-muted-foreground',
                            isSender ? 'justify-end' : 'justify-start',
                          )}
                        >
                          <span className="tabular-nums">{formatMessageTime(msg.timestamp)}</span>
                          {isSender && (msg.read || msg.seen === 1 ? (
                            <span title="Lu" className="inline-flex">
                              <CheckCheck className="h-3 w-3 text-foreground-secondary" aria-hidden="true" />
                              <span className="sr-only">Lu</span>
                            </span>
                          ) : msg.delivered ? (
                            <span title="Distribué" className="inline-flex">
                              <Check className="h-3 w-3" aria-hidden="true" />
                              <span className="sr-only">Distribué</span>
                            </span>
                          ) : (
                            <span title="Envoi en cours" className="inline-flex">
                              <Clock className="h-3 w-3" aria-hidden="true" />
                              <span className="sr-only">Envoi en cours</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Réagir (message reçu) */}
                    {canReact && (
                      <Popover
                        open={reactionPickerMsgId === msg.id}
                        onOpenChange={(open) => setReactionPickerMsgId(open ? msg.id : null)}
                      >
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <PopoverTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label="Réagir au message"
                                disabled={reacting}
                                className={MESSAGE_ACTION}
                              >
                                {reacting ? (
                                  <Loader2 className="animate-spin" aria-hidden="true" />
                                ) : (
                                  <SmilePlus aria-hidden="true" />
                                )}
                              </Button>
                            </PopoverTrigger>
                          </TooltipTrigger>
                          <TooltipContent>Réagir au message</TooltipContent>
                        </Tooltip>
                        <PopoverContent side="top" align="start" className="w-auto p-1">
                          <div className="flex gap-0.5" role="group" aria-label="Réactions">
                            {LINKEDIN_REACTIONS.map(({ emoji, label }) => (
                              <Button
                                key={emoji}
                                variant="ghost"
                                size="icon"
                                className="h-11 w-11 text-base md:h-9 md:w-9"
                                onClick={() => void handleReaction(msg.id, emoji)}
                                aria-label={`Réagir : ${label}`}
                              >
                                {emoji}
                              </Button>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* RANGÉE 3 : suggestions, panneau IA et composeur */}
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
              onAddToPipeline={onAddToPipeline}
            />
          </div>
        )}
        {/* Suggestions rapides, tant que le panneau IA est fermé */}
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
          aiPanelOpen={aiPanelOpen}
          hasAISuggestions={replySuggestions.length > 0}
          aiSuggestionsCount={replySuggestions.length}
          onScheduleCall={onScheduleCall}
          hasCalendlyLink={!!calendlyLink}
          channel={channelLabel(channel)}
          draftSaved={hasDraft}
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
          // Données de « Proposer une suite » (mémoïsées plus haut)
          ctaChatHistory={ctaChatHistory}
          ctaCandidateName={selectedChat ? getChatDisplayName(selectedChat) : undefined}
          ctaRecruiterName={ctaRecruiterName}
          ctaJobTitle={currentJobData?.title}
          ctaJobBrief={ctaJobBrief}
          ctaCalendlyLink={calendlyLink || undefined}
          ctaTone={currentTone}
        />
      </div>

      {/* Supprimer un message */}
      <AlertDialog open={!!deleteMsgConfirm} onOpenChange={(open) => !open && setDeleteMsgConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce message ?</AlertDialogTitle>
            <AlertDialogDescription>
              LinkedIn n'autorise la suppression que dans les 60 minutes qui suivent l'envoi. Cette action est
              irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (deleteMsgConfirm && onDeleteMessage) {
                  await onDeleteMessage(deleteMsgConfirm);
                  setDeleteMsgConfirm(null);
                }
              }}
            >
              Supprimer le message
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Arrêter la séquence */}
      <AlertDialog open={stopSeqConfirm} onOpenChange={(open) => !open && setStopSeqConfirm(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arrêter la séquence ?</AlertDialogTitle>
            <AlertDialogDescription>
              Les actions programmées pour {displayName} (relances, InMails, e-mails) seront annulées. Vous pourrez
              reprendre la séquence depuis l'onglet Outreach de la mission.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction disabled={stoppingSeq} onClick={handleStopSequence}>
              {stoppingSeq ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <CircleStop aria-hidden="true" />
              )}
              Arrêter la séquence
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
