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
 *   D-08, D-18). Design simplifié (lot Suite) : le statut s'écrit en mots à
 *   côté du nom, « Inscrire dans une séquence » en bouton discret, le logo
 *   LinkedIn ne se pose plus sur le visage ;
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
import { ConversationContext } from './ConversationContext';
import { conversationTimeline } from '@/lib/inboxTimeline';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { SnoozeArchiveButtons } from './SnoozeArchiveButtons';
import { MessageComposer } from './MessageComposer';
import { SmartReplies } from './SmartReplies';
import { ThreadNextStep } from './ThreadNextStep';
import type { CtaReplyButtonProps } from './CtaReplyButton';
import { buildPlaceholderContext } from '@/lib/templatePlaceholders';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useNow } from '@/hooks/sidebar/useNow';
import { useUserTemplateVariables } from '@/hooks/useUserTemplateVariables';
import { useOrganization } from '@/hooks/useOrganization';
import { useMemberName } from '@/hooks/useTeamMembers';
import { useUndoableEnrollmentAction } from '@/hooks/useUndoableEnrollmentAction';
import { pauseToastTitle } from '@/lib/sequenceErrorMessages';
import { readManualStop } from '@/lib/sequenceLabels';
import { useChatStatus } from '@/hooks/useChatStatus';
import { useChatDraft, readChatDraft } from '@/hooks/useChatDraft';
import { useProfileActivity } from '@/hooks/useProfileActivity';
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
  FileText, GitBranch, ListPlus, UserRound, Loader2, MessageSquare, MoreHorizontal, RefreshCw, SmilePlus, Trash2,
} from 'lucide-react';
import { useTextActions, type SummarizeResult } from '@/hooks/useTextActions';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { enrollmentProfileFilter } from '@/lib/enrollmentDuplicates';
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
import { businessDaysSince, latestMessage, threadState } from '@/lib/inboxThreadState';
import { useChatSuggestedAction } from '@/hooks/useChatSuggestedAction';
import { LINKEDIN_REACTIONS } from '@/lib/messageEmojis';

// Boutons icône de l'en-tête : 44 px au doigt, 32 px à la souris (01-direction.md, § 5)
const HEADER_ICON = 'h-11 w-11 md:h-8 md:w-8';
// Cibles de 44 px au doigt dans les menus
const MENU_ITEM = 'min-h-11 md:min-h-0';
// Action d'un message : visible au doigt, révélée au survol ou au focus à la souris (D-12)
const MESSAGE_ACTION = cn(
  'h-11 w-11 shrink-0 self-center md:h-7 md:w-7',
  '[@media(hover:hover)]:opacity-0 group-hover/msg:opacity-100 group-focus-within/msg:opacity-100 data-[state=open]:opacity-100',
);

interface MessageViewProps {
  overview?: React.ReactNode;
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
  /** Recharge les inscriptions de la messagerie (badges, liste) après une mise en pause. */
  onEnrollmentsChanged?: () => void;
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
  overview,
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
  onEnrollmentsChanged,
  onScheduleCall,
  calendlyLink,
  onAddReaction,
  onDeleteMessage,
  onRefetchMessages,
  onAutoSyncIfEmpty,
  isReacting,
  isDeleting,
}) => {
  const currentTime = useNow(30_000);
  const { organization, organizationId } = useOrganization();
  const replySuggestions = Array.isArray(replySuggestionsRaw) ? replySuggestionsRaw : [];
  const [localTone, setLocalTone] = useState<AITone>(selectedTone);
  const currentTone = onToneChange ? selectedTone : localTone;
  const handleToneChange = onToneChange || setLocalTone;
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
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

  const profileId = selectedChat ? getAttendeeProfileId(selectedChat) : null;
  const profileUrl = selectedChat?.attendees?.[0]?.profile_url || null;
  const profileName = selectedChat ? getChatDisplayName(selectedChat) : null;
  const profileAliases = [selectedChat?.attendees?.[0]?.provider_id, selectedChat?.attendees?.[0]?.attendee_provider_id, selectedChat?.attendee_provider_id].filter((id): id is string => !!id);
  const { events: activityEvents, loading: loadingActivity, error: activityError, retry: retryActivity } = useProfileActivity(profileId, profileUrl, profileName, profileAliases);
  const timeline = useMemo(() => conversationTimeline(
    messages.filter(message => hasDisplayableContent(message) || !!message.reactions?.length), activityEvents, new Date(currentTime),
  ), [messages, activityEvents, currentTime]);

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
    if (loadingMessages || !timeline.some(item => item.kind !== 'date')) return;
    const container = messagesScrollRef.current;
    if (!container) return;

    const chatChanged = lastChatIdForScrollRef.current !== selectedChat?.id;
    const newMessagesCount = messages.length + activityEvents.length;
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
  }, [messages, timeline, loadingMessages, selectedChat?.id]);

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

  // User connecté + org + variables custom pour les placeholders templates
  const { user } = useAuthReady();

  // Action IA : résumer la conversation
  const { summarize, summarizeLoading } = useTextActions();
  const [summary, setSummary] = useState<SummarizeResult | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);

  // Mise en pause depuis la messagerie : quand on reprend l'échange à la main,
  // les relances automatiques ne partent plus. Les inscriptions actives du
  // candidat sont lues à l'ouverture de la conversation (pas dans la carte des
  // 500 dernières inscriptions, ni déduites du statut d'une mission).
  // Lot 5b : sans fenêtre, « Annuler » dans le toast (reprise serveur).
  const [stoppingSeq, setStoppingSeq] = useState(false);
  const { offerUndoPause } = useUndoableEnrollmentAction();
  const [seqStoppedLocal, setSeqStoppedLocal] = useState(false);
  const [activeEnrollments, setActiveEnrollments] = useState<Array<{ id: string; current_step_order: number | null }>>([]);
  const [activeEnrollmentsKey, setActiveEnrollmentsKey] = useState(0);
  const [activeEnrollmentOwner, setActiveEnrollmentOwner] = useState<string | null>(null);

  // Nouvelle conversation : la pause affichée ne concerne que la précédente
  useEffect(() => {
    setSeqStoppedLocal(false);
  }, [selectedChat?.id]);

  const chatProfileId = selectedChat ? getAttendeeProfileId(selectedChat) : null;
  useEffect(() => {
    if (!chatProfileId || !organizationId) {
      setActiveEnrollments([]);
      return;
    }
    let cancelled = false;
    (async () => {
      // Identifiant de la messagerie (ACo...) : une inscription faite depuis
      // Recruiter porte un autre profile_id (AE...), retrouvée par provider_id
      // ou resolved_profile_id.
      const { data, error } = await supabase
        .from('sequence_enrollments')
        .select('id, current_step_order')
        .eq('organization_id', organizationId)
        .or(enrollmentProfileFilter(chatProfileId))
        .eq('status', 'active')
        .order('created_at', { ascending: false });
      if (cancelled) return;
      if (error) {
        // Lecture impossible : pas d'action de pause (on n'invente pas d'inscription).
        console.warn('[MessageView] active enrollments lookup failed:', error);
        setActiveEnrollments([]);
        return;
      }
      setActiveEnrollments(data ?? []);
      setActiveEnrollmentOwner(`${organizationId}:${chatProfileId}`);
    })();
    return () => { cancelled = true; };
  }, [chatProfileId, organizationId, activeEnrollmentsKey]);
  const hasActiveEnrollment = activeEnrollments.length > 0 && activeEnrollmentOwner === `${organizationId}:${chatProfileId}` && !seqStoppedLocal;

  // Mise en pause (contrat de pause) : seules les inscriptions changent de
  // statut ; les étapes programmées gardent leur date et le moteur les ignore
  // tant que l'inscription n'est pas reprise.
  const handleStopSequence = async () => {
    if (!selectedChat) return;
    const profileId = getAttendeeProfileId(selectedChat);
    if (!profileId) {
      toast.error('Profil du candidat introuvable', { description: "La séquence n'a pas été mise en pause." });
      return;
    }
    setStoppingSeq(true);
    try {
      const { data: active, error: fetchErr } = await supabase
        .from('sequence_enrollments')
        .select('id')
        .eq('organization_id', organizationId)
        .or(enrollmentProfileFilter(profileId))
        .eq('status', 'active')
        .order('created_at', { ascending: false });
      if (fetchErr) throw fetchErr;
      const ids = (active || []).map(e => e.id);
      if (ids.length === 0) {
        toast.info('Aucune séquence en cours pour ce candidat');
        setActiveEnrollmentsKey(k => k + 1);
        return;
      }
      // Toutes les inscriptions actives (cas rare où il y en aurait plusieurs),
      // relues pour détecter un refus silencieux (0 ligne).
      const { data: paused, error: pauseErr } = await supabase
        .from('sequence_enrollments')
        .update({ status: 'paused', pause_reason: 'manual' })
        .eq('organization_id', organizationId)
        .in('id', ids)
        .eq('status', 'active')
        .select('id');
      if (pauseErr) throw pauseErr;
      const pausedCount = paused?.length ?? 0;
      if (pausedCount === 0) {
        toast.error('Mise en pause impossible', { description: "La séquence n'a pas été mise en pause. Réessayez." });
        return;
      }
      setSeqStoppedLocal(true);
      setActiveEnrollmentsKey(k => k + 1);
      onEnrollmentsChanged?.();
      const name = getChatDisplayName(selectedChat) || null;
      const partial = pausedCount < ids.length;
      // « Annuler » ne reprend que les inscriptions que cette pause a touchées,
      // y compris quand elle n'en a touché qu'une partie (le titre le dit).
      offerUndoPause({
        title: partial
          ? `${pausedCount} séquence${pausedCount > 1 ? 's' : ''} sur ${ids.length} mise${pausedCount > 1 ? 's' : ''} en pause`
          : pausedCount > 1
            ? `${pausedCount} séquences mises en pause pour ${name || 'ce candidat'}.`
            : pauseToastTitle(name),
        ...(partial ? { description: 'Les autres n’ont pas pu être mises en pause. Réessayez.', tone: 'warning' as const } : {}),
        enrollmentIds: (paused ?? []).map(e => e.id),
        candidateName: name,
        onSettled: () => {
          setSeqStoppedLocal(false);
          setActiveEnrollmentsKey(k => k + 1);
          onEnrollmentsChanged?.();
        },
      });
    } catch (err) {
      console.error('[MessageView] pause sequence error:', err);
      toast.error('Mise en pause impossible', { description: 'Réessayez dans un instant.' });
    } finally {
      setStoppingSeq(false);
    }
  };

  /** Wrapper du re-fetch : la première tentative lit le cache ; à vide, le
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
  const memberName = useMemberName();
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

  // Ligne « À faire » : même règle que les onglets (src/lib/inboxThreadState.ts),
  // avec le dernier message lu dans le fil (à jour dès l'envoi) et l'inscription
  // active lue en base à l'ouverture.
  const nextStep = useMemo(() => {
    if (!selectedChat) return null;
    const last = latestMessage(messages) ?? selectedChat.last_message ?? null;
    const lastAt = last?.timestamp ?? null;
    const now = new Date(currentTime);
    const state = threadState(
      {
        lastIsMine: last && typeof last.is_sender === 'boolean' ? last.is_sender : null,
        lastAt,
        sequenceActive: hasActiveEnrollment || jobInfo?.status === 'active',
      },
      now,
    );
    if (state !== 'to_reply' && state !== 'to_follow_up') return null;
    return { state, lastAt, days: lastAt ? businessDaysSince(lastAt, now) : null };
  }, [selectedChat, messages, hasActiveEnrollment, jobInfo, currentTime]);

  // Action déjà mise en cache par l'analyse IA (lecture seule), pour « À répondre » :
  // écartée si le candidat a écrit depuis l'analyse.
  const cachedSuggestion = useChatSuggestedAction(selectedChat, nextStep?.state === 'to_reply');
  const nextStepSuggestion = useMemo(() => {
    const cached = cachedSuggestion.data;
    if (!cached?.action) return null;
    if (nextStep?.lastAt && cached.analyzedAt && new Date(nextStep.lastAt) > new Date(cached.analyzedAt)) return null;
    return cached.action;
  }, [cachedSuggestion.data, nextStep?.lastAt]);

  // Aucune conversation ouverte (ordinateur)
  if (!selectedChat) {
    if (overview) return <>{overview}</>;
    return (
      <div className="grid h-full place-items-center bg-background p-6">
        <EmptyState
          illustration="conversation"
          title="Sélectionnez une conversation"
          description="Retrouvez les échanges, les envois de séquences et les entretiens du candidat dans un même fil."
          className="w-full max-w-sm border-0"
        />
      </div>
    );
  }

  const displayName = getChatDisplayName(selectedChat);
  const headline = getChatHeadline(selectedChat);
  const subject = getChatSubject(selectedChat);
  const channel = detectChannel(selectedChat.account_type);

  // Statut de l'inscription : « En pause » juste après une mise en pause ;
  // « En cours » pour une inscription active lue à l'ouverture ; sinon la
  // dernière inscription connue du candidat, « A répondu » dès qu'une réponse
  // est notée sur une inscription encore active.
  const enrollmentStatus = seqStoppedLocal
    ? 'paused'
    : hasActiveEnrollment
      ? 'active'
      : jobInfo
        ? jobInfo.status === 'active' && jobInfo.replied_at
          ? 'replied'
          : jobInfo.status
        : null;
  const enrollmentPauseReason = seqStoppedLocal ? 'manual' : jobInfo?.pause_reason ?? null;
  // Lot 5b : « Arrêtée par Claire Dubois le 05/10 » pour un arrêt manuel.
  const enrollmentManualStop = jobInfo ? readManualStop(enrollmentStatus, jobInfo.completion_reason, jobInfo.manual_stop) : null;
  // Mise en pause seulement si une inscription ACTIVE du candidat a été lue en
  // base (jamais d'après le statut d'une mission, ni d'une mission déduite).
  const canStopSequence = hasActiveEnrollment;
  const activeStepOrder = hasActiveEnrollment ? activeEnrollments[0]?.current_step_order ?? null : null;
  const isSnoozedOrArchived = chatStatus.isSnoozed(selectedChat.id) || chatStatus.isArchived(selectedChat.id);

  // Contexte de la mission, quand l'inscription le donne ; l'étape vient de
  // l'inscription active lue à l'ouverture.
  const contextItems: React.ReactNode[] = [];
  if (jobInfo?.job_title) {
    contextItems.push(
      <span key="title" className="inline-flex min-w-0 items-center gap-1 text-foreground-secondary">
        <Briefcase className="h-3 w-3 shrink-0 text-foreground" aria-hidden="true" />
        <span className="truncate">{jobInfo.job_title}</span>
      </span>,
    );
  }
  if (activeStepOrder != null) {
    contextItems.push(<span key="step">Étape {activeStepOrder + 1}</span>);
  }
  if (jobInfo) {
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

  const linkedMission = activeMissions.find(mission => mission.id === jobInfo?.job_id || mission.job_id === jobInfo?.job_id);
  const contextProps = {
    name: displayName, profileUrl, events: activityEvents, now: currentTime,
    mission: jobInfo?.job_title || inferredMission?.job_title || inferredMission?.name || null,
    missionUrl: linkedMission ? `/missions/${linkedMission.id}` : inferredMission ? `/missions/${inferredMission.id}` : undefined,
    probableMission: !jobInfo?.job_title && !!inferredMission,
    sequenceStatus: enrollmentStatus ? <EnrollmentStatusBadge status={enrollmentStatus} pauseReason={enrollmentPauseReason} manualStop={enrollmentManualStop} stoppedByName={memberName(enrollmentManualStop?.by)} plain /> : undefined,
    onEnroll: onEnrollInSequence, onAddToPipeline: () => onAddToPipeline(),
  };

  // ─── Mise en page : grille à trois rangées (auto / 1fr / auto) ──────────
  return (
    <div className="flex h-full min-w-0 overflow-hidden" data-component="conversation-workspace">
    <div
      className="h-full min-w-0 flex-1 overflow-hidden bg-background"
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

          {/* Avatar ; la pastille du canal seulement hors LinkedIn */}
          <span className="relative mt-0.5 hidden shrink-0 sm:block">
            <Avatar className="h-10 w-10">
              <AvatarImage src={avatar} alt="" />
              <AvatarFallback className="text-xs font-semibold text-foreground-secondary">
                {getInitials(displayName)}
              </AvatarFallback>
            </Avatar>
            {channel !== 'linkedin' && (
              <span
                aria-hidden="true"
                className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full bg-background ring-1 ring-border"
              >
                <ChannelIcon channel={channel} size="xs" />
              </span>
            )}
          </span>

          <div className="min-w-0 flex-1 py-0.5">
            {/* Le nom, puis l'état de l'inscription en mots, sans pastille (design simplifié) */}
            <div className="flex min-w-0 items-baseline gap-x-2">
              <h2 className="min-w-0 truncate text-md font-semibold text-foreground">{displayName}</h2>
              {enrollmentStatus && (
                <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground md:inline-flex">
                  <GitBranch className="h-3 w-3 self-center text-foreground" aria-hidden="true" />
                  <span className="sr-only">Séquence : </span>
                  <EnrollmentStatusBadge
                    status={enrollmentStatus}
                    pauseReason={enrollmentPauseReason}
                    manualStop={enrollmentManualStop}
                    stoppedByName={memberName(enrollmentManualStop?.by)}
                    plain
                  />
                </span>
              )}
            </div>
            {headline && <p className="truncate text-xs text-muted-foreground">{headline}</p>}
            {contextItems.length > 0 ? (
              <p className="mt-1 hidden min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground md:flex">
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
                <Briefcase className="h-3 w-3 shrink-0 text-foreground" aria-hidden="true" />
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
            <Tooltip>
              <TooltipTrigger asChild><Button variant="ghost" size="icon-sm" className={cn(HEADER_ICON, '2xl:hidden')} aria-label="Afficher le contexte candidat" onClick={() => setContextOpen(true)}><UserRound aria-hidden="true" /></Button></TooltipTrigger>
              <TooltipContent>Contexte candidat</TooltipContent>
            </Tooltip>
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
                <DropdownMenuItem className={MENU_ITEM} onSelect={onEnrollInSequence}>
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
                    {/* Lot 5b : pause immédiate, « Annuler » dans le toast. */}
                    <DropdownMenuItem className={MENU_ITEM} disabled={stoppingSeq} onSelect={() => { void handleStopSequence(); }}>
                      <CircleStop className="mr-2 h-4 w-4" aria-hidden="true" />
                      Mettre en pause pour ce candidat
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
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-background text-foreground">
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
                    <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-foreground" aria-hidden="true" />
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
        <div className="mx-auto min-w-0 w-full max-w-5xl px-3 py-6 md:px-6">
          {loadingActivity && <p role="status" className="mb-3 text-xs text-muted-foreground">Chargement de l’historique candidat…</p>}
          {activityError && <div role="status" className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">Certains événements n’ont pas pu être chargés.<Button variant="ghost" size="sm" className="max-md:min-h-11" onClick={retryActivity}>Réessayer</Button></div>}
          {messages.length === 0 && activityEvents.length > 0 && selectedChat.last_message?.text && <section className="mb-4 rounded-lg border border-border p-3">
            <p className="text-xs font-medium text-foreground">Dernier message LinkedIn connu</p>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground-secondary">{selectedChat.last_message.is_sender ? 'Vous : ' : ''}{selectedChat.last_message.text}</p>
            {onRefetchMessages && <Button variant="ghost" size="sm" className="mt-2 max-md:min-h-11" onClick={handleRefetch} loading={loadingMessages}>Recharger les messages</Button>}
          </section>}
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
          ) : !timeline.some(item => item.kind !== 'date') ? (
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
                            className={cn(MESSAGE_ACTION, 'text-muted-foreground hover:text-danger')}
                          >
                            <Trash2 aria-hidden="true" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Supprimer ce message</TooltipContent>
                      </Tooltip>
                    )}

                    {/* Bulle : 85 % de large au plus sur téléphone, 75 % au-delà */}
                    <div className={cn('flex min-w-0 max-w-[85%] flex-col md:max-w-[min(80%,40rem)]', isSender ? 'items-end' : 'items-start')}>
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
                      {item.sequenceEvent && <p className="mt-1 text-xs text-muted-foreground">{item.sequenceEvent.sequenceName || 'Séquence'} · Étape {item.sequenceEvent.stepOrder + 1}</p>}
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
                              <CheckCheck className="h-3 w-3 text-foreground" aria-hidden="true" />
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

      {/* RANGÉE 3 : ligne « À faire », suggestions, panneau IA et composeur */}
      <div className="group/compose">
        {nextStep && (
          <ThreadNextStep
            key={selectedChat.id}
            state={nextStep.state}
            days={nextStep.days}
            suggestion={nextStepSuggestion}
            chatHistory={ctaChatHistory}
            candidateName={getChatDisplayName(selectedChat)}
            recruiterName={ctaRecruiterName}
            jobTitle={currentJobData?.title}
            jobBrief={ctaJobBrief as CtaReplyButtonProps['jobBrief']}
            calendlyLink={calendlyLink || undefined}
            tone={currentTone}
            // Même règle que le composeur : champ vide, le texte le remplace ; sinon il s'ajoute à la fin.
            onInsert={(text) => onNewMessageChange(newMessage.trim() ? `${newMessage.trimEnd()}\n\n${text}` : text)}
          />
        )}
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

    </div>
    <aside aria-label="Contexte candidat" className="hidden h-full w-72 shrink-0 overflow-y-auto border-l border-border bg-muted 2xl:block">
      <ConversationContext {...contextProps} />
    </aside>
    <Sheet open={contextOpen} onOpenChange={setContextOpen}>
      <SheetContent className="w-full max-w-sm overflow-y-auto p-0 [&>button]:h-11 [&>button]:w-11">
        <SheetHeader className="px-5 pt-6"><SheetTitle>Contexte candidat</SheetTitle><SheetDescription>Mission, séquence et prochain entretien.</SheetDescription></SheetHeader>
        <ConversationContext {...contextProps} onEnroll={() => { setContextOpen(false); onEnrollInSequence(); }} onAddToPipeline={() => { setContextOpen(false); onAddToPipeline(); }} />
      </SheetContent>
    </Sheet>
    </div>
  );
};
