import React, { useState, useEffect, useMemo, useId } from 'react';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useSubscriptionState } from '@/hooks/useSubscriptionState';
import { hasPlanFeature } from '@/lib/featureGates';
import { UpgradePrompt } from '@/components/ui/UpgradePrompt';
import { Spinner } from '@/components/ui/spinner';
import { normalizeNetworkDistance } from '@/lib/sequenceCompatibility';
import {
  findRecentEnrollments,
  formatRecentContactLabel,
  RECENT_CONTACT_WINDOW_DAYS,
  type RecentEnrollment,
} from '@/lib/enrollmentDuplicates';
import { SEQUENCES_PLAN_REQUIRED_MESSAGE } from './enrollment-preview/enrollmentHelpers';
import {
  DISCONNECTED_ACCOUNT_MESSAGE,
  NO_ACCOUNT_MESSAGE,
  OTHER_MEMBER_ACCOUNT_MESSAGE,
  useSendingAccount,
} from './enrollment-preview/useSendingAccount';
import { SendingAccountNotice } from './enrollment-preview/SendingAccountNotice';
import { RecipientsConfirm } from './enrollment-preview/RecipientsConfirm';
import { useRecipientsConfirm } from './enrollment-preview/useRecipientsConfirm';
import { executionStatusMeta, MESSAGE_TONES, type MessageTone } from '@/lib/sequenceCatalog';
import { formatSequenceError } from '@/lib/sequenceErrorMessages';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InMailTextEditor } from './InMailTextEditor';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ChannelIcon } from '@/components/ui/ChannelIcon';
import { EmptyState, ErrorState } from '@/components/layout';
import { missionIdOfJob, useMissionOutreachConfig, useSenderFirstName } from '@/hooks/useEnrollmentPreview';
import {
  Clock,
  PenLine,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Send,
  Edit2,
  Check,
  AlertTriangle,
  Briefcase,
  Lightbulb,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Job } from '@/types/jobs';
import { useInMailBalance } from '@/hooks/useInMailBalance';
import { LinkedInProfile } from './types';
import { getYear } from './dateUtils';
import { plural } from '@/lib/plural';

interface Recipient {
  id: string;
  name: string;
  headline?: string;
  profile_id: string;
  network_distance?: number | string; // 1=1st degree, 2=2nd degree, 3=3rd degree
  profile?: LinkedInProfile;
}

interface BulkInMailModalProps {
  isOpen: boolean;
  onClose: () => void;
  recipients: Recipient[];
  accountId: string;
  selectedJob?: Job | null;
  /** Mission des InMails (uuid). Prioritaire sur l'id du poste, qui n'est pas
   *  celui de la mission pour une mission ancienne (job_id hérité). */
  projectId?: string;
}

interface GeneratedMessage {
  subject: string;
  message: string;
  personalizationPoints: string[];
  isEdited: boolean;
}

type Tone = MessageTone;

interface QueueStats {
  pending: number;
  scheduled: number;
  sending: number;
  sent: number;
  failed: number;
  cancelled: number;
}

/** Rythme réel de la file (process-inmail-queue) : plages de l'utilisateur, jours ouvrés, 1 à 2 minutes. */
const SEND_PACE_TEXT = "Envoi pendant vos heures d'envoi, les jours ouvrés, 1 à 2 minutes entre chaque InMail.";
const INMAIL_DUPLICATE_CHECK_FAILED_MESSAGE =
  'Impossible de vérifier les contacts récents de votre organisation. Réessayez avant de planifier.';
/** Décision 24 : la file refuse tout candidat déjà contacté, InMail groupé ou séquence, sans dérogation (process-inmail-queue). */
const RECENT_CONTACT_REFUSED_MESSAGE =
  `Sans dérogation possible : la file InMail refuse tout candidat inscrit en séquence ou contacté par votre organisation ces ${RECENT_CONTACT_WINDOW_DAYS} derniers jours, séquence arrêtée comprise.`;
/** Refus du compte d'envoi (liaison stricte), formulés pour l'InMail groupé. */
const INMAIL_ACCOUNT_BLOCK_MESSAGES: Record<string, string> = {
  [NO_ACCOUNT_MESSAGE]: "Aucun compte LinkedIn n'est sélectionné. Connectez votre compte avant d'envoyer des InMails.",
  [OTHER_MEMBER_ACCOUNT_MESSAGE]: "Ce compte LinkedIn est relié à un autre membre de l'équipe. Envoyez les InMails depuis votre propre compte.",
  [DISCONNECTED_ACCOUNT_MESSAGE]: "Votre compte LinkedIn est déconnecté. Reconnectez-le avant d'envoyer des InMails.",
};

/** Distance LinkedIn envoyée à la file : 1 = déjà en relation (message gratuit), 2, 3, sinon inconnue. */
function queueNetworkDistance(r: Recipient): number | null {
  const normalized = normalizeNetworkDistance(r.network_distance ?? r.profile?.network_distance);
  if (normalized === 'FIRST_DEGREE') return 1;
  if (normalized === 'SECOND_DEGREE') return 2;
  if (normalized === 'THIRD_DEGREE') return 3;
  return null;
}

interface QueueItem {
  id: string;
  recipient_name: string | null;
  recipient_headline: string | null;
  subject: string;
  status: string;
  scheduled_at: string | null;
  sent_at: string | null;
  error_message: string | null;
}

/**
 * Statuts de la file InMail : le ton du badge vient du catalogue des séquences
 * (même statut, même couleur partout) ; le libellé s'accorde avec « InMail »,
 * masculin, là où le catalogue qualifie une étape.
 */
const QUEUE_STATUS_LABELS: Record<string, string> = {
  pending: 'Planifié',
  scheduled: 'Planifié',
  sending: "En cours d'envoi",
  sent: 'Envoyé',
  failed: 'En échec',
  cancelled: 'Annulé',
};

const QueueStatusBadge: React.FC<{ status: string }> = ({ status }) => (
  <Badge variant={executionStatusMeta(status === 'pending' ? 'scheduled' : status).tone} className="shrink-0">
    {QUEUE_STATUS_LABELS[status] || 'Statut inconnu'}
  </Badge>
);

export const BulkInMailModal: React.FC<BulkInMailModalProps> = ({
  isOpen,
  onClose,
  recipients: allRecipients,
  accountId,
  selectedJob,
  projectId,
}) => {
  const { organizationId } = useOrganization();
  const { user } = useAuthReady();
  // Compte d'envoi (liaison stricte, comme les inscriptions) : chacun envoie
  // depuis son propre compte relié. Relié à un collègue, déconnecté ou absent,
  // il bloque la génération et la planification.
  const sendingAccount = useSendingAccount(accountId);
  const accountBlockReason = sendingAccount.blockReason
    ? INMAIL_ACCOUNT_BLOCK_MESSAGES[sendingAccount.blockReason] ?? sendingAccount.blockReason
    : null;
  const sendingAccountState = { ...sendingAccount, blockReason: accountBlockReason };
  // Abonnement : sans plan autorisant l'envoi, rien ne partirait. Tant que
  // l'état n'est pas lu, on ne bloque pas (le serveur refuse aussi la file).
  const { state: subscriptionState, effectivePlanId } = useSubscriptionState();
  const canSendInMails = !subscriptionState || hasPlanFeature(effectivePlanId, 'sequences_send');

  // Anti-doublon organisation, comme les inscriptions en séquence : candidats
  // en séquence chez un collègue, contactés ces 90 derniers jours ou ayant déjà
  // un InMail groupé programmé ou envoyé. Toujours exclus : la file les refuse
  // sans dérogation (décision 24), aucune génération payée pour rien.
  // null = pas encore vérifié.
  const [recentContacts, setRecentContacts] = useState<Map<string, RecentEnrollment> | null>(null);
  const [isCheckingDuplicates, setIsCheckingDuplicates] = useState(false);
  const [duplicateCheckFailed, setDuplicateCheckFailed] = useState(false);
  const [duplicateCheckAttempt, setDuplicateCheckAttempt] = useState(0);
  const allRecipientsKey = allRecipients.map(r => r.id).join(',');
  useEffect(() => {
    if (!isOpen || !organizationId) return;
    let cancelled = false;
    setRecentContacts(null);
    setDuplicateCheckFailed(false);
    setIsCheckingDuplicates(true);
    findRecentEnrollments(supabase, organizationId, allRecipients.map(r => ({
      id: r.id,
      provider_id: r.profile?.provider_id ?? (r.profile_id !== r.id ? r.profile_id : undefined),
      public_identifier: r.profile?.public_identifier,
      profile_url: r.profile?.profile_url,
      public_profile_url: r.profile?.public_profile_url,
    })))
      .then(map => { if (!cancelled) setRecentContacts(map); })
      .catch(err => {
        console.warn('[BulkInMailModal] recent contacts check failed:', err);
        if (!cancelled) setDuplicateCheckFailed(true);
      })
      .finally(() => { if (!cancelled) setIsCheckingDuplicates(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, organizationId, allRecipientsKey, duplicateCheckAttempt]);
  const duplicateRecipients = useMemo(
    () => (recentContacts ? allRecipients.filter(r => recentContacts.has(r.id)) : []),
    [allRecipients, recentContacts],
  );
  // Destinataires réellement visés : génération, crédits, planification.
  const recipients = useMemo(
    () => (!recentContacts ? allRecipients : allRecipients.filter(r => !recentContacts.has(r.id))),
    [allRecipients, recentContacts],
  );
  // La génération et la planification attendent la fin de la vérification.
  const duplicatesUnchecked = !recentContacts;

  // Tab state: 'compose' or 'queue'
  const [activeTab, setActiveTab] = useState<'compose' | 'queue'>('compose');

  // AI generation state
  const [generatedMessages, setGeneratedMessages] = useState<Record<string, GeneratedMessage>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingIndex, setGeneratingIndex] = useState(0);
  const [tone, setTone] = useState<Tone>('professional');
  const [senderName, setSenderName] = useState(() => {
    return localStorage.getItem('outreach_sender_name') || '';
  });

  // Current message editing
  const [currentRecipientIndex, setCurrentRecipientIndex] = useState(0);
  const [editingSubject, setEditingSubject] = useState('');
  const [editingMessage, setEditingMessage] = useState('');

  // Queue state
  const [isQueueing, setIsQueueing] = useState(false);
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);

  // Confirmations : fermeture avec une saisie non reportée, mise en file
  // (déclenche des envois) et annulation des envois en attente.
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const [confirmQueueOpen, setConfirmQueueOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const senderId = useId();

  // Réglages d'approche de la mission (mode interne ou cabinet, rôle de
  // l'expéditeur, anonymisation du client) : même lecture que l'aperçu de
  // séquence. Sans eux, la génération cite le vrai nom d'un client à anonymiser.
  const {
    outreachConfig,
    missionClientName,
    status: missionConfigStatus,
    retry: retryMissionConfig,
  } = useMissionOutreachConfig(selectedJob?.id);
  // Prénom de l'expéditeur par défaut (profil), si le champ signature est vide.
  const defaultSenderName = useSenderFirstName();
  const effectiveSenderName = senderName.trim() || defaultSenderName;

  // InMail balance from real API
  const { balance, isLoading: isLoadingBalance, error: balanceError, refetch: refetchBalance, hasCredits, getCredits } = useInMailBalance(accountId);

  // Recruiter credits (primary for InMails). Un destinataire déjà en relation
  // reçoit un message gratuit (process-inmail-queue, network_distance 1) : il
  // ne consomme pas de crédit. Les soldes Sales Navigator ou Premium ne sont
  // pas additionnés : l'envoi passe par l'API Recruiter.
  const recruiterCredits = getCredits('recruiter');
  // Avant la génération (et pendant) : estimation sur tous les destinataires
  // visés. Une fois les messages générés : seuls ceux qui ont un message seront
  // planifiés, les crédits requis portent sur eux.
  const withMessage = recipients.filter(r => generatedMessages[r.id]);
  const billedRecipients = withMessage.length > 0 && !isGenerating ? withMessage : recipients;
  const freeMessageCount = billedRecipients.filter(r => queueNetworkDistance(r) === 1).length;
  const paidInMailCount = billedRecipients.length - freeMessageCount;
  const creditsNeeded = paidInMailCount;
  const hasEnoughCredits = creditsNeeded === 0 || hasCredits('recruiter', creditsNeeded);
  const creditsBreakdown = `${paidInMailCount} InMail${paidInMailCount > 1 ? 's' : ''} payant${paidInMailCount > 1 ? 's' : ''}, ${freeMessageCount} message${freeMessageCount > 1 ? 's' : ''} gratuit${freeMessageCount > 1 ? 's' : ''} (déjà en relation)`;
  const isNearLimit = recruiterCredits > 0 && recruiterCredits <= 20; // Warning when less than 20 credits

  // Get user's timezone
  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Current recipient
  const currentRecipient = recipients[currentRecipientIndex];
  const currentMessage = currentRecipient ? generatedMessages[currentRecipient.id] : null;

  // Count how many messages are ready - only count messages for CURRENT recipients
  const currentRecipientIds = new Set(recipients.map(r => r.id));
  const readyCount = Object.keys(generatedMessages).filter(id => currentRecipientIds.has(id)).length;
  const hasGeneratedMessages = readyCount > 0 && !isGenerating;
  const allGenerated = readyCount === recipients.length;
  // Saisie du destinataire affiché pas encore reportée dans les messages.
  const hasUnsavedEdit = !!(currentRecipient && currentMessage && (
    editingSubject !== currentMessage.subject ||
    editingMessage !== currentMessage.message
  ));

  // Lot 5a (décision 7 du lot 5) : dès 5 InMails, case des destinataires sur
  // le nombre du bouton (readyCount = destinataires avec un message), décochée
  // dès que la liste change, et premier InMail prêt en entier au-dessus
  // (saisie en cours comprise, comme à la planification).
  const recipientsConfirm = useRecipientsConfirm(withMessage.map(r => r.id));
  const firstReady = withMessage[0] ?? null;
  const firstReadyMessage = firstReady
    ? (hasUnsavedEdit && currentRecipient?.id === firstReady.id
        ? { subject: editingSubject, message: editingMessage }
        : generatedMessages[firstReady.id])
    : null;

  // Save sender name to localStorage
  const handleSenderNameChange = (name: string) => {
    setSenderName(name);
    localStorage.setItem('outreach_sender_name', name);
  };

  // Update editing fields when switching recipients
  useEffect(() => {
    if (currentMessage) {
      setEditingSubject(currentMessage.subject);
      setEditingMessage(currentMessage.message);
    } else {
      setEditingSubject('');
      setEditingMessage('');
    }
  }, [currentRecipientIndex, currentMessage]);

  // Compteurs de la file par comptage en base (toute la file de l'utilisateur),
  // pas sur les 100 dernières lignes renvoyées par l'action « status ».
  const countQueue = async (userId: string, statuses: string[]): Promise<number> => {
    const { count, error } = await supabase
      .from('inmail_queue')
      .select('id', { count: 'exact', head: true })
      .eq('created_by', userId)
      .in('status', statuses);
    if (error) throw error;
    return count ?? 0;
  };

  // Fetch queue status
  const fetchQueueStatus = async () => {
    setQueueLoading(true);
    setQueueError(null);
    try {
      const { data, error } = await invokeEdgeFunction<{ stats?: any; items?: any[] }>('process-inmail-queue', {
        action: 'status',
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'status');
      setQueueStats(data.stats);
      setQueueItems(data.items || []);
    } catch (err) {
      console.error('Error fetching queue status:', err);
      // Une panne ne se lit pas comme une file vide : état d'erreur avec « Réessayer ».
      setQueueError(err instanceof Error ? err.message : String(err));
    } finally {
      setQueueLoading(false);
    }
    const userId = user?.id;
    if (!userId) return;
    try {
      const [pending, sending, sent, failed, cancelled] = await Promise.all([
        countQueue(userId, ['pending', 'scheduled']),
        countQueue(userId, ['sending']),
        countQueue(userId, ['sent']),
        countQueue(userId, ['failed']),
        countQueue(userId, ['cancelled']),
      ]);
      setQueueStats({ pending: 0, scheduled: pending, sending, sent, failed, cancelled });
    } catch (err) {
      // Comptage indisponible : on garde les compteurs de l'action « status ».
      console.warn('[BulkInMailModal] queue count failed:', err);
    }
  };

  // Reset state when the selection changes (not when the duplicate check
  // narrows the recipients: generated messages stay).
  useEffect(() => {
    setGeneratedMessages({});
    setCurrentRecipientIndex(0);
  }, [allRecipientsKey]);

  // Destinataires retirés (anti-doublon) : l'index affiché reste valide.
  useEffect(() => {
    if (currentRecipientIndex > 0 && currentRecipientIndex >= recipients.length) {
      setCurrentRecipientIndex(Math.max(0, recipients.length - 1));
    }
  }, [currentRecipientIndex, recipients.length]);

  useEffect(() => {
    if (isOpen) {
      fetchQueueStatus();
    }
  }, [isOpen]);

  // Build profile data for AI generation
  const buildProfileData = (recipient: Recipient) => {
    const profile = recipient.profile;
    if (!profile) {
      return {
        name: recipient.name,
        headline: recipient.headline,
      };
    }

    const workExperience = profile.work_experience || [];
    const currentJob = workExperience.find(exp => !exp.end) || workExperience[0];
    const pastJobs = workExperience.filter(exp => exp.end).slice(0, 3);
    const education = profile.education || [];

    // Calculate years of experience
    const calcYearsOfExperience = (): number | undefined => {
      const years = workExperience
        .filter((exp: any) => exp.start?.year)
        .map((exp: any) => exp.start.year);
      if (years.length > 0) return new Date().getFullYear() - Math.min(...years);
      const eduYears = education.filter((edu: any) => edu.end?.year).map((edu: any) => edu.end.year);
      if (eduYears.length > 0) return new Date().getFullYear() - Math.max(...eduYears);
      return undefined;
    };

    return {
      name: recipient.name,
      headline: recipient.headline || profile.headline,
      currentRole: currentJob?.role,
      currentCompany: currentJob?.company,
      location: profile.location,
      skills: profile.skills?.map((s: any) => s.name || s).slice(0, 10) || [],
      pastPositions: pastJobs.map(p => { const sy = getYear(p.start); const ey = getYear(p.end); return `${p.role} chez ${p.company}${sy ? ` (${sy}${ey ? `-${ey}` : ''})` : ''}`; }),
      education: education.slice(0, 3).map((edu: any) => {
        const ey = getYear(edu.end);
        return `${edu.degree || edu.field_of_study || 'Diplôme'} – ${edu.school || 'École'}${ey ? ` (${ey})` : ''}`;
      }),
      yearsOfExperience: calcYearsOfExperience(),
      summary: profile.summary || '',
    };
  };

  // Generate message for a single recipient
  const generateMessageForRecipient = async (recipient: Recipient) => {
    if (!selectedJob) return null;

    try {
      const profileData = buildProfileData(recipient);

      const { data, error } = await invokeEdgeFunction<{ subject?: string; message?: string }>('generate-outreach-message', {
        profile: profileData,
        job: {
          title: selectedJob.title,
          client: selectedJob.client || (missionClientName ? { name: missionClientName } : undefined),
          skills: selectedJob.skills || [],
          description: selectedJob.description,
          location: selectedJob.location,
          remote: selectedJob.remote,
          accompagnement: selectedJob.accompagnement || [],
        },
        tone,
        senderName: effectiveSenderName || undefined,
        accountId,
        profileId: recipient.profile?.provider_id || recipient.profile_id,
        candidateLinkedInUrl: recipient.profile?.public_profile_url || recipient.profile?.profile_url || undefined,
        // Mode interne ou cabinet, rôle de l'expéditeur et anonymisation du
        // client, comme l'aperçu de séquence (useEnrollmentPreview).
        outreachConfig: outreachConfig || undefined,
        // Mission (préfixe « project: » accepté) : le serveur relit ses
        // réglages d'approche quand outreachConfig est absent (SEQ-051).
        missionId: selectedJob.id || undefined,
      });

      if (error) throw error;

      return {
        subject: data?.subject || `Opportunité ${selectedJob.title}`,
        message: data?.message || '',
        personalizationPoints: (data as any)?.personalization_points || [],
        isEdited: false,
      };
    } catch (err) {
      console.error('Generate message error:', err);
      return null;
    }
  };

  // Generate all messages
  const handleGenerateAll = async () => {
    if (!canSendInMails) {
      toast.error(SEQUENCES_PLAN_REQUIRED_MESSAGE);
      return;
    }
    if (accountBlockReason) {
      toast.error(accountBlockReason);
      return;
    }
    if (duplicatesUnchecked) {
      toast.error(INMAIL_DUPLICATE_CHECK_FAILED_MESSAGE);
      return;
    }
    if (recipients.length === 0) {
      toast.error('Aucun candidat à contacter : tous ont déjà été contactés par votre organisation.');
      return;
    }
    if (!selectedJob) {
      toast.error('Choisissez un poste pour générer les messages.');
      return;
    }
    if (missionConfigStatus === 'loading' || missionConfigStatus === 'error') {
      toast.error('Réglages d’approche de la mission indisponibles : réessayez dans un instant.');
      return;
    }

    setIsGenerating(true);
    setGeneratingIndex(0);

    const newMessages: Record<string, GeneratedMessage> = {};

    for (let i = 0; i < recipients.length; i++) {
      setGeneratingIndex(i);
      const recipient = recipients[i];
      const message = await generateMessageForRecipient(recipient);

      if (message) {
        newMessages[recipient.id] = message;
        // Update state progressively for UI feedback
        setGeneratedMessages(prev => ({ ...prev, [recipient.id]: message }));
      }
    }

    setIsGenerating(false);
    setCurrentRecipientIndex(0); // Reset to first recipient to show editor
    const generated = Object.keys(newMessages).length;
    const failedCount = recipients.length - generated;
    if (generated === 0) {
      toast.error("Aucun message n'a pu être généré. Réessayez dans un instant.");
    } else if (failedCount > 0) {
      toast.warning(`${generated} message${generated > 1 ? 's' : ''} généré${generated > 1 ? 's' : ''} sur ${recipients.length}. ${failedCount} ${failedCount > 1 ? 'ont' : 'a'} échoué.`, {
        description: failedCount > 1 ? 'Ces candidats ne seront pas planifiés.' : 'Ce candidat ne sera pas planifié.',
      });
    } else {
      toast.success(`${plural(generated, 'message généré', 'messages générés')} : relisez-les avant de planifier l'envoi.`);
    }
  };

  // Regenerate current message
  const handleRegenerateMessage = async () => {
    if (!currentRecipient) return;

    setIsGenerating(true);
    const message = await generateMessageForRecipient(currentRecipient);

    if (message) {
      setGeneratedMessages(prev => ({ ...prev, [currentRecipient.id]: message }));
      setEditingSubject(message.subject);
      setEditingMessage(message.message);
    } else {
      toast.error(`Le message de ${currentRecipient.name} n'a pas pu être régénéré. Réessayez.`);
    }

    setIsGenerating(false);
  };

  // Save edited message
  const handleSaveEdit = () => {
    if (!currentRecipient) return;

    setGeneratedMessages(prev => ({
      ...prev,
      [currentRecipient.id]: {
        ...prev[currentRecipient.id],
        subject: editingSubject,
        message: editingMessage,
        isEdited: true,
      }
    }));

    toast.success(`Modifications enregistrées pour ${currentRecipient.name}`);
  };

  // Navigate to previous/next recipient
  const goToRecipient = (direction: 'prev' | 'next') => {
    // Auto-save if edited
    if (hasUnsavedEdit) {
      handleSaveEdit();
    }

    if (direction === 'prev' && currentRecipientIndex > 0) {
      setCurrentRecipientIndex(i => i - 1);
    } else if (direction === 'next' && currentRecipientIndex < recipients.length - 1) {
      setCurrentRecipientIndex(i => i + 1);
    }
  };

  // Queue all messages
  const handleQueueAll = async () => {
    if (!canSendInMails) {
      toast.error(SEQUENCES_PLAN_REQUIRED_MESSAGE);
      return;
    }
    // Lot 5a : dès 5 InMails, rien ne part sans la case des destinataires.
    if (recipientsConfirm.blocked) return;
    if (accountBlockReason) {
      toast.error(accountBlockReason);
      return;
    }
    if (duplicatesUnchecked) {
      toast.error(INMAIL_DUPLICATE_CHECK_FAILED_MESSAGE);
      return;
    }
    if (readyCount === 0) {
      toast.error("Générez d'abord les messages.");
      return;
    }

    // Check credit availability before queueing
    if (!hasEnoughCredits) {
      toast.error(`Crédits InMail insuffisants (${recruiterCredits} restants, ${creditsNeeded} requis)`);
      return;
    }

    // La saisie en cours du destinataire affiché est reportée ici, de façon
    // synchrone : setGeneratedMessages (via « Enregistrer ») est asynchrone et
    // la version d'origine partait si l'on planifiait sans enregistrer.
    const messages: Record<string, GeneratedMessage> = hasUnsavedEdit && currentRecipient && currentMessage
      ? {
          ...generatedMessages,
          [currentRecipient.id]: {
            ...currentMessage,
            subject: editingSubject,
            message: editingMessage,
            isEdited: true,
          },
        }
      : generatedMessages;
    if (messages !== generatedMessages) setGeneratedMessages(messages);

    setIsQueueing(true);

    try {
      const items = recipients
        .filter(r => messages[r.id])
        .map(r => {
          // Même lecture que le décompte des crédits : 1 = déjà en relation,
          // message gratuit côté file (« FIRST_DEGREE », « DISTANCE_1 », 1).
          const networkDistance = queueNetworkDistance(r);

          return {
            account_id: accountId,
            recipient_profile_id: r.profile_id,
            // URL publique : la file rapproche les inscriptions par slug et lit
            // le registre global des effacements (décision 14).
            recipient_profile_url: r.profile?.public_profile_url || r.profile?.profile_url || null,
            recipient_name: r.name,
            recipient_headline: r.headline,
            subject: messages[r.id].subject,
            message: messages[r.id].message,
            network_distance: networkDistance,
          };
        });

      const { data, error } = await invokeEdgeFunction<{ queued?: number; skipped_duplicates?: number; skipped_erased?: number; message?: string }>('process-inmail-queue', {
        action: 'queue',
        items,
        user_timezone: userTimezone,
        // Mission des InMails (lot 0b) : le serveur y pose « Contacté » à l'envoi.
        project_id: missionIdOfJob(projectId) ?? missionIdOfJob(selectedJob?.id),
      });

      if (error || !data?.success) {
        // Refus serveur (abonnement requis, compte non autorisé…) : son
        // message en français, jamais un jeton technique.
        console.error('Error queueing InMails:', error ?? data);
        toast.error('Aucun InMail n’a été planifié', {
          description: data?.message || (error?.status === 403 ? error.message : 'La planification n’a pas abouti. Réessayez.'),
        });
        return;
      }

      // Refetch balance after queueing to update credits display
      refetchBalance();

      const queued = data.queued ?? 0;
      const skippedDuplicates = data.skipped_duplicates ?? 0;
      // Candidats effacés (RGPD) : refusés par la file, comptés à part des doublons.
      const skippedErased = data.skipped_erased ?? 0;
      const exclusions = [
        skippedDuplicates > 0
          ? `${skippedDuplicates} candidat${skippedDuplicates > 1 ? 's' : ''} déjà contacté${skippedDuplicates > 1 ? 's' : ''} par votre organisation, exclu${skippedDuplicates > 1 ? 's' : ''}.`
          : null,
        skippedErased > 0
          ? `${skippedErased} candidat${skippedErased > 1 ? 's' : ''} ayant demandé l'effacement de ${skippedErased > 1 ? 'leurs' : 'ses'} données, exclu${skippedErased > 1 ? 's' : ''}.`
          : null,
      ].filter(Boolean).join(' ');
      if (queued === 0) {
        // Rien en file : les messages restent affichés pour réessayer.
        toast.error('Aucun InMail n’a été planifié', {
          description: skippedDuplicates > 0 && skippedErased === 0
            ? `Ces candidats ont déjà un InMail en file ou ont été contactés par votre organisation ces ${RECENT_CONTACT_WINDOW_DAYS} derniers jours.`
            : exclusions || 'Réessayez.',
        });
        return;
      }
      if (queued < items.length) {
        toast.warning(`${queued} InMail${queued > 1 ? 's' : ''} planifié${queued > 1 ? 's' : ''} sur ${items.length}`, {
          description: exclusions || 'Consultez la file d’attente pour vérifier les envois prévus.',
        });
      } else {
        toast.success(`${queued} InMail${queued > 1 ? 's' : ''} planifié${queued > 1 ? 's' : ''} pour envoi`);
      }
      setGeneratedMessages({});
      setActiveTab('queue');
      fetchQueueStatus();
    } catch (err) {
      console.error('Error queueing InMails:', err);
      toast.error('Aucun InMail n’a été planifié', { description: 'La planification n’a pas abouti. Réessayez.' });
    } finally {
      setIsQueueing(false);
    }
  };

  // Cancel pending items : toute la file en attente de l'utilisateur (pas
  // seulement les 100 lignes affichées), le serveur renvoie le nombre réel.
  const handleCancelPending = async () => {
    try {
      const { data, error } = await invokeEdgeFunction<{ cancelled?: number }>('process-inmail-queue', {
        action: 'cancel',
      });

      if (error || !data?.success) throw error ?? new Error('cancel failed');
      const cancelled = data?.cancelled ?? 0;
      if (cancelled === 0) {
        toast.info('Aucun InMail n’a été annulé : ils étaient peut-être déjà en cours d’envoi.');
      } else {
        toast.success(`${plural(cancelled, 'InMail annulé', 'InMails annulés')} : ${cancelled > 1 ? 'ils ne partiront pas' : 'il ne partira pas'}.`);
      }
      fetchQueueStatus();
    } catch (err) {
      console.error('Error cancelling InMails:', err);
      toast.error('Annulation impossible', { description: 'Vos InMails en attente n’ont pas été annulés. Réessayez.' });
    }
  };

  // Format scheduled time
  const formatScheduledTime = (isoString: string | null) => {
    if (!isoString) return 'Non planifié';
    try {
      const date = new Date(isoString);
      return date.toLocaleString('fr-FR', {
        timeZone: userTimezone,
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString;
    }
  };

  const totalInQueue = queueStats ?
    queueStats.pending + queueStats.scheduled + queueStats.sending : 0;
  // InMails pas encore envoyés, toute la file de l'utilisateur (comptage en base).
  const pendingCount = queueStats ? queueStats.pending + queueStats.scheduled : 0;

  const queueCounters = queueStats
    ? [
        { label: 'Planifiés', value: pendingCount },
        { label: "En cours d'envoi", value: queueStats.sending },
        { label: 'Envoyés', value: queueStats.sent },
        { label: 'En échec', value: queueStats.failed, danger: queueStats.failed > 0 },
        { label: 'Annulés', value: queueStats.cancelled },
      ]
    : [];

  const selectRecipient = (index: number) => {
    if (hasUnsavedEdit) {
      handleSaveEdit();
    }
    setCurrentRecipientIndex(index);
  };

  // Fermeture : une saisie non reportée demande confirmation (AlertDialog).
  const requestClose = () => {
    if (isQueueing) return;
    if (activeTab === 'compose' && hasUnsavedEdit) {
      setConfirmCloseOpen(true);
      return;
    }
    onClose();
  };

  const discardEditAndClose = () => {
    if (currentMessage) {
      setEditingSubject(currentMessage.subject);
      setEditingMessage(currentMessage.message);
    }
    setConfirmCloseOpen(false);
    onClose();
  };

  return (
    <>
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) requestClose(); }}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <div className="shrink-0 border-b border-border px-6 py-4 pr-14">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted">
                <ChannelIcon channel="linkedin" size="sm" />
              </span>
              <div className="flex min-w-0 flex-col gap-0.5 text-left">
                {/* Nom de la fonction, comme le bouton qui l'ouvre (« Envoyer un InMail groupé ») ;
                    le titre reste celui que lisent les parcours e2e. */}
                <p className="eyebrow">InMail groupé</p>
                <DialogTitle>InMails personnalisés</DialogTitle>
                <DialogDescription>
                  Messages rédigés par l'IA Konekt pour {plural(recipients.length, 'candidat')}
                  {recipients.length !== allRecipients.length && ` sur ${allRecipients.length}`}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'compose' | 'queue')} className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 px-6 pt-4">
            <TabsList className="w-full">
              <TabsTrigger value="compose" className="flex-1 gap-2">
                <PenLine className="h-3.5 w-3.5" aria-hidden="true" />
                Composer ({readyCount} sur {recipients.length})
              </TabsTrigger>
              <TabsTrigger value="queue" className="flex-1 gap-2">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                File d'attente{totalInQueue > 0 && ` (${totalInQueue})`}
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Rédaction */}
          <TabsContent value="compose" className="mt-0 min-h-0 flex-1 overflow-y-auto px-6 pb-6">
            {/* Plan gratuit : rien ne partirait, on le dit avant toute génération. */}
            {!canSendInMails && (
              <UpgradePrompt title="InMails" description={SEQUENCES_PLAN_REQUIRED_MESSAGE} className="mt-4" />
            )}
            {/* Anti-doublon organisation */}
            {isCheckingDuplicates && (
              <p role="status" className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Spinner size="sm" label="Vérification en cours" />
                Vérification des contacts récents de l'organisation
              </p>
            )}
            {duplicateCheckFailed && !isCheckingDuplicates && (
              <div role="alert" className="mt-3 flex items-center gap-2 rounded-lg bg-danger-muted p-3 text-sm text-danger">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="flex-1">{INMAIL_DUPLICATE_CHECK_FAILED_MESSAGE}</span>
                <Button variant="outline" size="xs" className="max-md:h-11" onClick={() => setDuplicateCheckAttempt(a => a + 1)}>
                  Réessayer
                </Button>
              </div>
            )}
            {recentContacts && duplicateRecipients.length > 0 && (
              <div className="mt-3 space-y-2 rounded-lg border border-warning/25 bg-warning-muted p-3">
                <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
                  {duplicateRecipients.length} candidat{duplicateRecipients.length > 1 ? 's' : ''} déjà contacté{duplicateRecipients.length > 1 ? 's' : ''} par votre organisation, exclu{duplicateRecipients.length > 1 ? 's' : ''}
                </p>
                <ul className="max-h-20 space-y-0.5 overflow-y-auto text-xs text-foreground-secondary">
                  {duplicateRecipients.slice(0, 5).map(r => {
                    const entry = recentContacts.get(r.id);
                    return (
                      <li key={r.id} className="truncate">
                        <span className="font-medium text-foreground">{r.name}</span>
                        {' : '}{entry ? formatRecentContactLabel(entry) : 'Déjà contacté'}
                      </li>
                    );
                  })}
                  {duplicateRecipients.length > 5 && (
                    <li>et {plural(duplicateRecipients.length - 5, 'autre')}</li>
                  )}
                </ul>
                <p className="text-xs text-foreground-secondary">{RECENT_CONTACT_REFUSED_MESSAGE}</p>
              </div>
            )}
            {!selectedJob ? (
              <EmptyState
                className="mt-4"
                variant="compact"
                icon={Briefcase}
                title="Choisissez d'abord un poste"
                description="Les messages s'appuient sur le poste pour se personnaliser."
              />
            ) : !hasGeneratedMessages ? (
              <div className="space-y-5 pt-4">
                {/* Poste et crédits */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Badge variant="outline" className="max-w-full truncate">
                      {selectedJob.title}
                    </Badge>
                    {selectedJob.client?.name && (
                      <Badge variant="muted">{selectedJob.client.name}</Badge>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <Badge variant={!hasEnoughCredits ? 'danger' : isNearLimit ? 'warning' : 'muted'}>
                      {plural(recruiterCredits, 'crédit InMail', 'crédits InMail')}
                    </Badge>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="max-md:h-11 max-md:w-11"
                          onClick={() => refetchBalance()}
                          disabled={isLoadingBalance}
                          aria-label="Actualiser le solde de crédits InMail"
                        >
                          <RefreshCw className={cn(isLoadingBalance && 'animate-spin')} aria-hidden="true" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Actualiser le solde</TooltipContent>
                    </Tooltip>
                  </div>
                </div>

                {/* Crédits requis : seuls les destinataires hors relation consomment un InMail. */}
                <p className="text-xs text-muted-foreground">{creditsBreakdown}</p>

                {/* Crédits insuffisants */}
                {!hasEnoughCredits && (
                  <div role="alert" className="flex items-start gap-2 rounded-lg bg-danger-muted p-3 text-sm text-danger">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>
                      {balanceError
                        ? "Le solde de crédits InMail n'a pas pu être lu. Actualisez le solde, puis réessayez."
                        : `Crédits insuffisants (${recruiterCredits} restants, ${creditsNeeded} requis)`}
                    </span>
                  </div>
                )}

                {/* Réglages d'approche de la mission illisibles : pas de
                    génération, le nom d'un client à anonymiser pourrait sortir. */}
                {missionConfigStatus === 'error' && (
                  <div role="alert" className="flex items-center gap-2 rounded-lg bg-danger-muted p-3 text-sm text-danger">
                    <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="flex-1">Impossible de lire les réglages d’approche de la mission.</span>
                    <Button variant="outline" size="xs" className="max-md:h-11" onClick={retryMissionConfig}>
                      Réessayer
                    </Button>
                  </div>
                )}

                {/* Signature et ton */}
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <div className="space-y-1.5">
                    <Label htmlFor={senderId} className="text-xs font-medium text-muted-foreground">
                      Votre prénom (signature)
                    </Label>
                    <Input
                      id={senderId}
                      value={senderName}
                      onChange={(e) => handleSenderNameChange(e.target.value)}
                      placeholder={defaultSenderName ? `Par défaut : ${defaultSenderName}` : 'Ex. : Camille'}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground" aria-hidden="true">Ton</p>
                    <SegmentedControl<Tone>
                      aria-label="Ton des messages"
                      size="default"
                      value={tone}
                      onValueChange={setTone}
                      options={MESSAGE_TONES.map((t) => ({ value: t.value, label: t.label }))}
                      className="max-w-full"
                    />
                  </div>
                </div>

                {/* Générer */}
                <Button
                  variant="primary"
                  size="lg"
                  onClick={handleGenerateAll}
                  disabled={isGenerating || !hasEnoughCredits || !canSendInMails || !!accountBlockReason || duplicatesUnchecked || recipients.length === 0 || missionConfigStatus === 'loading' || missionConfigStatus === 'error'}
                  loading={isGenerating || missionConfigStatus === 'loading'}
                  className="w-full"
                >
                  {isGenerating
                    ? `Génération ${generatingIndex + 1} sur ${recipients.length}…`
                    : !hasEnoughCredits
                      ? 'Crédits insuffisants'
                      : missionConfigStatus === 'loading'
                        ? 'Chargement des réglages de la mission…'
                        : <>Générer {recipients.length} message{recipients.length > 1 ? 's' : ''}</>}
                </Button>

                {/* Progression de la génération */}
                {isGenerating && (
                  <div
                    className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-label="Génération des messages"
                    aria-valuemin={0}
                    aria-valuemax={recipients.length}
                    aria-valuenow={generatingIndex + 1}
                  >
                    <div
                      className="h-full rounded-full bg-brand transition-[width] duration-200"
                      style={{ width: `${((generatingIndex + 1) / recipients.length) * 100}%` }}
                    />
                  </div>
                )}

                <p className="text-center text-xs text-muted-foreground">
                  {SEND_PACE_TEXT}
                </p>
              </div>
            ) : (
              // Relecture message par message
              <div className="flex flex-col gap-4 pt-4">
                {/* Précédent / suivant */}
                <div className="flex items-center justify-between rounded-lg bg-muted p-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="max-md:h-11"
                    onClick={() => goToRecipient('prev')}
                    disabled={currentRecipientIndex === 0}
                  >
                    <ChevronLeft aria-hidden="true" />
                    Précédent
                  </Button>
                  <p className="text-sm font-medium tabular-nums text-foreground" aria-live="polite">
                    Message {currentRecipientIndex + 1} sur {recipients.length}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="max-md:h-11"
                    onClick={() => goToRecipient('next')}
                    disabled={currentRecipientIndex === recipients.length - 1}
                  >
                    Suivant
                    <ChevronRight aria-hidden="true" />
                  </Button>
                </div>

                {/* Destinataire */}
                {currentRecipient && (
                  <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{currentRecipient.name}</p>
                      {currentRecipient.headline && (
                        <p className="truncate text-xs text-muted-foreground">{currentRecipient.headline}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {currentMessage?.isEdited && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Edit2 className="h-3 w-3" aria-hidden="true" />
                          Modifié
                        </span>
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="max-md:h-11 max-md:w-11"
                            onClick={handleRegenerateMessage}
                            disabled={isGenerating}
                            aria-label={`Régénérer le message de ${currentRecipient.name}`}
                          >
                            <RefreshCw className={cn(isGenerating && 'animate-spin')} aria-hidden="true" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Régénérer ce message</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                )}

                {/* Objet et message (identifiants fixes : repères des parcours de bout en bout) */}
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="subject" className="text-xs font-medium text-muted-foreground">Objet</Label>
                    <Input
                      id="subject"
                      value={editingSubject}
                      onChange={(e) => setEditingSubject(e.target.value)}
                      placeholder="Objet de l'InMail"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="message" className="text-xs font-medium text-muted-foreground">Message</Label>
                      {hasUnsavedEdit && (
                        <Button size="xs" variant="ghost" onClick={handleSaveEdit} className="max-md:h-11">
                          <Check aria-hidden="true" />
                          Enregistrer les modifications
                        </Button>
                      )}
                    </div>
                    <InMailTextEditor
                      id="message"
                      value={editingMessage}
                      onChange={setEditingMessage}
                      placeholder="Le message d'approche"
                      minHeight="150px"
                      maxCharacters={1900}
                    />
                  </div>

                  {/* Points de personnalisation */}
                  {currentMessage?.personalizationPoints && currentMessage.personalizationPoints.length > 0 && (
                    <div className="border-t border-border pt-3">
                      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <Lightbulb className="h-3.5 w-3.5 text-foreground" aria-hidden="true" />
                        Points de personnalisation
                      </p>
                      <ul className="flex flex-wrap gap-1.5">
                        {currentMessage.personalizationPoints.map((point, i) => (
                          <li key={i}>
                            <Badge variant="muted">{point}</Badge>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {/* Accès direct à un message (ordinateur) : un bouton nommé par candidat */}
                <nav aria-label="Messages par candidat" className="hidden flex-wrap items-center justify-center gap-1 border-t border-border pt-3 sm:flex">
                  {recipients.slice(0, 15).map((r, i) => {
                    const isCurrent = i === currentRecipientIndex;
                    const isReady = !!generatedMessages[r.id];
                    return (
                      <Tooltip key={r.id}>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => selectRecipient(i)}
                            aria-current={isCurrent ? 'step' : undefined}
                            aria-label={`Message ${i + 1} : ${r.name}${isReady ? '' : ' (non généré)'}`}
                            className={cn(
                              'tabular-nums text-xs',
                              isCurrent ? 'bg-brand/15 text-brand hover:bg-brand/15 hover:text-brand' : 'text-muted-foreground',
                              !isReady && 'border border-dashed border-border',
                            )}
                          >
                            {i + 1}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{r.name}{isReady ? '' : ' (non généré)'}</TooltipContent>
                      </Tooltip>
                    );
                  })}
                  {recipients.length > 15 && (
                    <span className="ml-1 text-xs text-muted-foreground">et {recipients.length - 15} autres</span>
                  )}
                </nav>
              </div>
            )}
          </TabsContent>

          {/* File d'attente */}
          <TabsContent value="queue" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden px-6 pb-6">
            {queueError ? (
              <ErrorState
                className="mt-4"
                variant="compact"
                title="Impossible de charger la file d'attente"
                description="Vérifiez votre connexion, puis réessayez."
                detail={queueError}
                onRetry={fetchQueueStatus}
                retrying={queueLoading}
              />
            ) : queueLoading && !queueStats ? (
              <div className="space-y-2 pt-4" aria-hidden="true">
                <Skeleton className="h-14 w-full rounded-lg" />
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-16 w-full rounded-lg" />
                ))}
              </div>
            ) : (
              <>
                {queueStats && (
                  <dl className="mb-3 grid grid-cols-3 gap-2 border-b border-border py-3 sm:grid-cols-5">
                    {queueCounters.map((c) => (
                      <div key={c.label} className="flex flex-col-reverse items-center text-center">
                        <dt className="text-xs text-muted-foreground">{c.label}</dt>
                        <dd className={cn('text-lg font-semibold tabular-nums', c.danger ? 'text-danger' : 'text-foreground')}>
                          {c.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}

                {queueItems.length >= 100 && (
                  <p className="mb-2 text-xs text-muted-foreground">
                    Les 100 derniers InMails sont listés ; les compteurs portent sur toute votre file.
                  </p>
                )}

                <ScrollArea className="min-h-0 flex-1">
                  {queueItems.length === 0 ? (
                    <EmptyState
                      variant="compact"
                      icon={Clock}
                      title="Aucun InMail planifié"
                      description="Les InMails que vous planifiez apparaissent ici jusqu'à leur envoi."
                    />
                  ) : (
                    <ul className="space-y-2">
                      {queueItems.map(item => (
                        <li key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-foreground">{item.recipient_name || 'Candidat'}</p>
                            <p className="truncate text-xs text-muted-foreground">{item.subject}</p>
                            {item.scheduled_at && ['pending', 'scheduled'].includes(item.status) && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                Prévu le {formatScheduledTime(item.scheduled_at)}
                              </p>
                            )}
                            {item.error_message && (
                              <p className="mt-1 text-xs text-danger">{formatSequenceError(item.error_message)}</p>
                            )}
                          </div>
                          <QueueStatusBadge status={item.status} />
                        </li>
                      ))}
                    </ul>
                  )}
                </ScrollArea>

                {/* Toute la file en attente de l'utilisateur (comptage en base). */}
                {pendingCount > 0 && (
                  <div className="mt-3 flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmCancel(true)}
                      className="text-muted-foreground hover:text-danger max-md:h-11"
                    >
                      Annuler les envois en attente
                    </Button>
                  </div>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>

        {/* Pied : compte d'envoi, puis les actions ; même fond que le corps, un filet pour séparer */}
        <div className="shrink-0 space-y-2 border-t border-border px-6 py-3">
          {/* Compte d'envoi : les InMails partent de ce compte et consomment ses crédits. */}
          {activeTab === 'compose' && <SendingAccountNotice state={sendingAccountState} />}
          {activeTab === 'compose' && hasGeneratedMessages && (
            <RecipientsConfirm
              count={readyCount}
              confirmed={recipientsConfirm.confirmed}
              onConfirmedChange={recipientsConfirm.setConfirmed}
              preview={firstReady && firstReadyMessage
                ? {
                    candidateName: firstReady.name || 'ce candidat',
                    items: [{ key: firstReady.id, label: 'InMail', subject: firstReadyMessage.subject || null, text: firstReadyMessage.message }],
                  }
                : null}
            />
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={requestClose} disabled={isQueueing}>
              Fermer
            </Button>

            {activeTab === 'compose' && hasGeneratedMessages && (
              <Button
                variant="primary"
                onClick={() => setConfirmQueueOpen(true)}
                disabled={isQueueing || readyCount === 0 || !canSendInMails || !!accountBlockReason || duplicatesUnchecked || recipientsConfirm.blocked}
                loading={isQueueing}
              >
                {!isQueueing && <Send aria-hidden="true" />}
                Planifier {readyCount} InMail{readyCount > 1 ? 's' : ''}
                {!allGenerated && readyCount > 0 && <span className="sr-only"> (sur {recipients.length} candidats)</span>}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>

    {/* Fermeture avec une saisie non reportée */}
    <AlertDialog open={confirmCloseOpen} onOpenChange={setConfirmCloseOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Vos modifications ne sont pas enregistrées</AlertDialogTitle>
          <AlertDialogDescription>
            Le message de {currentRecipient?.name || 'ce candidat'} a été modifié. Fermer quand même ? Vos modifications seront perdues.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Continuer la modification</AlertDialogCancel>
          <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={discardEditAndClose}>
            Fermer sans enregistrer
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* Mise en file : déclenche des envois */}
    <AlertDialog open={confirmQueueOpen} onOpenChange={setConfirmQueueOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Planifier {readyCount} InMail{readyCount > 1 ? 's' : ''} ?</AlertDialogTitle>
          <AlertDialogDescription>
            {sendingAccount.name
              ? `Envoyés depuis le compte LinkedIn de ${sendingAccount.name}. `
              : 'Envoyés depuis le compte LinkedIn sélectionné. '}
            {SEND_PACE_TEXT} {creditsBreakdown} : chaque InMail payant consomme un crédit.{hasUnsavedEdit ? ' La modification en cours du message affiché sera prise en compte.' : ''}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              setConfirmQueueOpen(false);
              void handleQueueAll();
            }}
          >
            Planifier
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* Annulation des envois en attente */}
    <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Annuler {pendingCount} InMail{pendingCount > 1 ? 's' : ''} en attente ?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Tous vos InMails programmés et pas encore envoyés seront annulés, y compris ceux d'autres sélections. Cette action est irréversible.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Garder</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => {
              setConfirmCancel(false);
              void handleCancelPending();
            }}
          >
            {pendingCount > 1 ? 'Annuler les envois' : "Annuler l'envoi"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
};
