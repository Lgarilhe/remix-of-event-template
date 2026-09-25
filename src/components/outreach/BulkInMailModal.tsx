import React, { useState, useEffect, useMemo } from 'react';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useSubscriptionState } from '@/hooks/useSubscriptionState';
import { hasPlanFeature } from '@/lib/featureGates';
import { UpgradePrompt } from '@/components/ui/UpgradePrompt';
import { normalizeNetworkDistance } from '@/lib/sequenceCompatibility';
import {
  findRecentEnrollments,
  formatRecentContactLabel,
  RECENT_CONTACT_WINDOW_DAYS,
  type RecentEnrollment,
} from '@/lib/enrollmentDuplicates';
import { SEQUENCES_PLAN_REQUIRED_MESSAGE } from './enrollment-preview/enrollmentHelpers';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InMailTextEditor } from './InMailTextEditor';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
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
import { useMissionOutreachConfig, useSenderFirstName } from '@/hooks/useEnrollmentPreview';
import { 
  Mail, 
  Clock, 
  CheckCircle, 
  XCircle, 
  Loader2,
  Users,
  Calendar,
  Info,
  Sparkles,
  PenLine,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Send,
  Edit2,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Job } from '@/types/jobs';
import { useInMailBalance } from '@/hooks/useInMailBalance';
import { LinkedInProfile } from './types';
import { getYear } from './dateUtils';

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
}

interface GeneratedMessage {
  subject: string;
  message: string;
  personalizationPoints: string[];
  isEdited: boolean;
}

type Tone = 'professional' | 'casual' | 'enthusiastic';

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

export const BulkInMailModal: React.FC<BulkInMailModalProps> = ({
  isOpen,
  onClose,
  recipients: allRecipients,
  accountId,
  selectedJob,
}) => {
  const { organizationId, isAdmin } = useOrganization();
  const { user } = useAuthReady();
  // Abonnement : sans plan autorisant l'envoi, rien ne partirait. Tant que
  // l'état n'est pas lu, on ne bloque pas (le serveur refuse aussi la file).
  const { state: subscriptionState, effectivePlanId } = useSubscriptionState();
  const canSendInMails = !subscriptionState || hasPlanFeature(effectivePlanId, 'sequences_send');

  // Anti-doublon organisation, comme les inscriptions en séquence : candidats
  // en séquence chez un collègue, contactés ces 90 derniers jours ou ayant déjà
  // un InMail groupé programmé ou envoyé. Exclus par défaut, dérogation
  // réservée aux propriétaires et administrateurs. null = pas encore vérifié.
  const [recentContacts, setRecentContacts] = useState<Map<string, RecentEnrollment> | null>(null);
  const [isCheckingDuplicates, setIsCheckingDuplicates] = useState(false);
  const [duplicateCheckFailed, setDuplicateCheckFailed] = useState(false);
  const [duplicateCheckAttempt, setDuplicateCheckAttempt] = useState(0);
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const allRecipientsKey = allRecipients.map(r => r.id).join(',');
  useEffect(() => {
    if (!isOpen || !organizationId) return;
    let cancelled = false;
    setRecentContacts(null);
    setDuplicateCheckFailed(false);
    setIncludeDuplicates(false);
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
  const allowDuplicates = isAdmin && includeDuplicates;
  const duplicateRecipients = useMemo(
    () => (recentContacts ? allRecipients.filter(r => recentContacts.has(r.id)) : []),
    [allRecipients, recentContacts],
  );
  // Destinataires réellement visés : génération, crédits, planification.
  const recipients = useMemo(
    () => (allowDuplicates || !recentContacts ? allRecipients : allRecipients.filter(r => !recentContacts.has(r.id))),
    [allRecipients, recentContacts, allowDuplicates],
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

  // Confirmations : fermeture avec une saisie non reportée, mise en file
  // (déclenche des envois) et annulation des envois en attente.
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const [confirmQueueOpen, setConfirmQueueOpen] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

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
  const freeMessageCount = recipients.filter(r => queueNetworkDistance(r) === 1).length;
  const paidInMailCount = recipients.length - freeMessageCount;
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
    try {
      const { data, error } = await invokeEdgeFunction<{ stats?: any; items?: any[] }>('process-inmail-queue', {
        action: 'status',
      });

      if (error) throw error;
      if (data?.success) {
        setQueueStats(data.stats);
        setQueueItems(data.items || []);
      }
    } catch (err) {
      console.error('Error fetching queue status:', err);
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
    if (duplicatesUnchecked) {
      toast.error(INMAIL_DUPLICATE_CHECK_FAILED_MESSAGE);
      return;
    }
    if (recipients.length === 0) {
      toast.error('Aucun candidat à contacter : tous ont déjà été contactés par votre organisation.');
      return;
    }
    if (!selectedJob) {
      toast.error('Sélectionnez un poste pour générer les messages');
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
      toast.error('Aucun message n’a pu être généré. Réessayez.');
    } else if (failedCount > 0) {
      toast.warning(`${generated} message${generated > 1 ? 's' : ''} généré${generated > 1 ? 's' : ''} sur ${recipients.length}. ${failedCount} ${failedCount > 1 ? 'ont' : 'a'} échoué.`, {
        description: failedCount > 1 ? 'Ces candidats ne seront pas planifiés.' : 'Ce candidat ne sera pas planifié.',
      });
    } else {
      toast.success(`${generated} message${generated > 1 ? 's' : ''} généré${generated > 1 ? 's' : ''}. Relisez et modifiez chaque message avant de planifier.`);
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
    
    toast.success('Message sauvegardé');
  };

  // Navigate to previous/next recipient
  const goToRecipient = (direction: 'prev' | 'next') => {
    // Auto-save if edited
    if (currentMessage && (
      editingSubject !== currentMessage.subject || 
      editingMessage !== currentMessage.message
    )) {
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
    if (duplicatesUnchecked) {
      toast.error(INMAIL_DUPLICATE_CHECK_FAILED_MESSAGE);
      return;
    }
    if (readyCount === 0) {
      toast.error('Générez d\'abord les messages');
      return;
    }
    
    // Check credit availability before queueing
    if (!hasEnoughCredits) {
      toast.error(`Crédits InMail insuffisants (${recruiterCredits} restants, ${creditsNeeded} requis)`);
      return;
    }

    // La saisie en cours du destinataire affiché est reportée ici, de façon
    // synchrone : setGeneratedMessages (via « Sauvegarder ») est asynchrone et
    // la version d'origine partait si l'on planifiait sans sauvegarder.
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
            recipient_name: r.name,
            recipient_headline: r.headline,
            subject: messages[r.id].subject,
            message: messages[r.id].message,
            network_distance: networkDistance,
          };
        });

      const { data, error } = await invokeEdgeFunction<{ queued?: number; skipped_duplicates?: number; message?: string }>('process-inmail-queue', {
        action: 'queue',
        items,
        user_timezone: userTimezone,
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
      if (queued === 0) {
        // Rien en file : les messages restent affichés pour réessayer.
        toast.error('Aucun InMail n’a été planifié', {
          description: skippedDuplicates > 0
            ? `Ces candidats ont déjà un InMail en file ou ont été contactés par votre organisation ces ${RECENT_CONTACT_WINDOW_DAYS} derniers jours.`
            : 'Réessayez.',
        });
        return;
      }
      if (queued < items.length) {
        toast.warning(`${queued} InMail${queued > 1 ? 's' : ''} planifié${queued > 1 ? 's' : ''} sur ${items.length}`, {
          description: skippedDuplicates > 0
            ? `${skippedDuplicates} candidat${skippedDuplicates > 1 ? 's' : ''} déjà contacté${skippedDuplicates > 1 ? 's' : ''} par votre organisation, exclu${skippedDuplicates > 1 ? 's' : ''}.`
            : 'Consultez la file d’attente pour vérifier les envois prévus.',
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
        toast.success(`${cancelled} InMail${cancelled > 1 ? 's' : ''} annulé${cancelled > 1 ? 's' : ''}`);
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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
      case 'scheduled':
        return <Badge variant="outline" className="bg-info/10 text-info-foreground border-info/20"><Clock className="w-3 h-3 mr-1" />Planifié</Badge>;
      case 'sending':
        return <Badge variant="outline" className="bg-warning/10 text-warning-foreground border-warning/20"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Envoi...</Badge>;
      case 'sent':
        return <Badge variant="outline" className="bg-success/10 text-success-foreground border-success/20"><CheckCircle className="w-3 h-3 mr-1" />Envoyé</Badge>;
      case 'failed':
        return <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20"><XCircle className="w-3 h-3 mr-1" />Échoué</Badge>;
      case 'cancelled':
        return <Badge variant="outline" className="bg-muted text-muted-foreground border-border"><XCircle className="w-3 h-3 mr-1" />Annulé</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const totalInQueue = queueStats ? 
    queueStats.pending + queueStats.scheduled + queueStats.sending : 0;
  // InMails pas encore envoyés, toute la file de l'utilisateur (comptage en base).
  const pendingCount = queueStats ? queueStats.pending + queueStats.scheduled : 0;

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
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) requestClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col p-0">
        {/* Clean header — icône en colonne, titre + sous-titre alignés ensemble.
            Avant : le sous-titre était flush-left sous l'icône, créant un décalage
            visuel avec le titre qui commence après l'icône. */}
        <div className="px-6 py-4 border-b border-border bg-background shrink-0">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-linkedin flex items-center justify-center shrink-0">
                <Mail className="w-4 h-4 text-white" />
              </div>
              <div className="flex flex-col gap-0.5 min-w-0">
                <DialogTitle className="text-lg leading-tight">
                  InMails personnalisés
                </DialogTitle>
                <DialogDescription className="text-sm leading-tight">
                  Messages rédigés par l'IA Konekt pour {recipients.length} candidat{recipients.length > 1 ? 's' : ''}
                  {recipients.length !== allRecipients.length && ` sur ${allRecipients.length}`}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'compose' | 'queue')} className="flex-1 overflow-hidden flex flex-col">
          <div className="px-6 pt-4 shrink-0">
            <TabsList className="w-full bg-muted/80 p-1 h-10">
              <TabsTrigger value="compose" className="flex-1 gap-2 text-sm data-[state=active]:bg-background data-[state=active]:shadow-sm">
                <PenLine className="w-3.5 h-3.5" />
                Composer ({readyCount}/{recipients.length})
              </TabsTrigger>
              <TabsTrigger value="queue" className="flex-1 gap-2 text-sm data-[state=active]:bg-background data-[state=active]:shadow-sm">
                <Clock className="w-3.5 h-3.5" />
                File d'attente {totalInQueue > 0 && `(${totalInQueue})`}
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Compose Tab */}
          <TabsContent value="compose" className="flex-1 overflow-y-auto px-6 pb-6 mt-0">
            {/* Plan gratuit : rien ne partirait, on le dit avant toute génération. */}
            {!canSendInMails && (
              <UpgradePrompt title="InMails" description={SEQUENCES_PLAN_REQUIRED_MESSAGE} className="mt-4" />
            )}
            {/* Anti-doublon organisation */}
            {isCheckingDuplicates && (
              <p className="flex items-center gap-2 text-[11px] text-muted-foreground mt-3" role="status">
                <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                Vérification des contacts récents de l'organisation
              </p>
            )}
            {duplicateCheckFailed && !isCheckingDuplicates && (
              <div className="mt-3 flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm" role="alert">
                <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="flex-1">{INMAIL_DUPLICATE_CHECK_FAILED_MESSAGE}</span>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setDuplicateCheckAttempt(a => a + 1)}>
                  Réessayer
                </Button>
              </div>
            )}
            {recentContacts && duplicateRecipients.length > 0 && (
              <div className="mt-3 p-3 border border-warning/40 bg-warning/5 rounded-lg space-y-2">
                <p className="text-xs font-semibold text-warning flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  {duplicateRecipients.length} candidat{duplicateRecipients.length > 1 ? 's' : ''} déjà contacté{duplicateRecipients.length > 1 ? 's' : ''} par votre organisation
                  {allowDuplicates ? ', inclus quand même' : ', exclu' + (duplicateRecipients.length > 1 ? 's' : '')}
                </p>
                <ul className="text-[11px] text-muted-foreground space-y-0.5 max-h-20 overflow-y-auto">
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
                    <li className="italic">et {duplicateRecipients.length - 5} autre{duplicateRecipients.length - 5 > 1 ? 's' : ''}</li>
                  )}
                </ul>
                {isAdmin ? (
                  <label className="flex items-center gap-2 text-[11px] cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={includeDuplicates}
                      onChange={(e) => setIncludeDuplicates(e.target.checked)}
                      className="h-3 w-3 rounded border-border"
                    />
                    <span className="text-foreground">Contacter quand même ({duplicateRecipients.length})</span>
                  </label>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    Seuls les propriétaires et administrateurs peuvent les contacter quand même.
                  </p>
                )}
              </div>
            )}
            {!selectedJob ? (
              // No job selected
              <div className="flex-1 flex items-center justify-center py-12">
                <div className="text-center">
                  <Sparkles className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                  <h3 className="font-medium text-foreground mb-1">Sélectionnez un poste</h3>
                  <p className="text-sm text-muted-foreground max-w-xs">
                    Pour générer des messages personnalisés, sélectionnez d'abord un poste.
                  </p>
                </div>
              </div>
            ) : !hasGeneratedMessages ? (
              // Generation setup - clean design
              <div className="space-y-5 pt-4">
                {/* Context row: Job + Recipients + Credits - compact */}
                <div className="flex items-center justify-between gap-4 pb-4 border-b border-border">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs font-medium truncate max-w-[180px]">
                        {selectedJob.title}
                      </Badge>
                      {selectedJob.client?.name && (
                        <Badge variant="secondary" className="text-xs">
                          {selectedJob.client.name}
                        </Badge>
                      )}
                    </div>
                  </div>
                  
                  {/* Credits indicator - compact */}
                  <div className="flex items-center gap-2 shrink-0">
                    <div className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
                      !hasEnoughCredits
                        ? "bg-destructive/10 text-destructive"
                        : isNearLimit
                        ? "bg-warning/10 text-warning-foreground"
                        : "bg-success/10 text-success-foreground"
                    )}>
                      <Mail className="w-3 h-3" />
                      {recruiterCredits} crédit{recruiterCredits > 1 ? 's' : ''}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => refetchBalance()}
                      disabled={isLoadingBalance}
                      aria-label="Rafraîchir le solde de crédits InMail"
                    >
                      <RefreshCw className={cn("h-3 w-3", isLoadingBalance && "animate-spin")} aria-hidden="true" />
                    </Button>
                  </div>
                </div>

                {/* Crédits requis : seuls les destinataires hors relation consomment un InMail. */}
                <p className="text-xs text-muted-foreground">{creditsBreakdown}</p>

                {/* Error message for credits if needed */}
                {!hasEnoughCredits && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>Crédits insuffisants ({recruiterCredits} restants, {creditsNeeded} requis)</span>
                  </div>
                )}

                {/* Réglages d'approche de la mission illisibles : pas de
                    génération, le nom d'un client à anonymiser pourrait sortir. */}
                {missionConfigStatus === 'error' && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm" role="alert">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span className="flex-1">Impossible de lire les réglages d’approche de la mission.</span>
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={retryMissionConfig}>
                      Réessayer
                    </Button>
                  </div>
                )}

                {/* Configuration section */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Sender name */}
                  <div>
                    <Label htmlFor="senderName" className="text-xs font-medium text-muted-foreground mb-1.5 block">
                      Votre prénom (signature)
                    </Label>
                    <Input
                      id="senderName"
                      value={senderName}
                      onChange={(e) => handleSenderNameChange(e.target.value)}
                      placeholder={defaultSenderName ? `Par défaut : ${defaultSenderName}` : 'Ex : Marc'}
                      className="h-9"
                    />
                  </div>
                  
                  {/* Tone selector */}
                  <div>
                    <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">Ton</Label>
                    <div className="flex gap-1.5">
                      {[
                        { value: 'professional', label: 'Pro', emoji: '👔' },
                        { value: 'casual', label: 'Cool', emoji: '😊' },
                        { value: 'enthusiastic', label: 'Wow', emoji: '🚀' },
                      ].map((t) => (
                        <Button
                          key={t.value}
                          variant={tone === t.value ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setTone(t.value as Tone)}
                          className={cn(
                            "flex-1 h-9 text-xs",
                            tone === t.value ? 'bg-linkedin hover:bg-linkedin-hover' : ''
                          )}
                        >
                          {t.emoji} {t.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Generate button - clean */}
                <Button
                  onClick={handleGenerateAll}
                  disabled={isGenerating || !hasEnoughCredits || !canSendInMails || duplicatesUnchecked || recipients.length === 0 || missionConfigStatus === 'loading' || missionConfigStatus === 'error'}
                  className={cn(
                    "w-full h-11",
                    !hasEnoughCredits 
                      ? "bg-muted cursor-not-allowed"
                      : "bg-linkedin hover:bg-linkedin-hover"
                  )}
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Génération {generatingIndex + 1}/{recipients.length}...
                    </>
                  ) : !hasEnoughCredits ? (
                    'Crédits insuffisants'
                  ) : missionConfigStatus === 'loading' ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Chargement des réglages de la mission…
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Générer {recipients.length} message{recipients.length > 1 ? 's' : ''}
                    </>
                  )}
                </Button>

                {/* Progress bar */}
                {isGenerating && (
                  <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                    <div 
                      className="bg-linkedin h-full transition-all duration-300"
                      style={{ width: `${((generatingIndex + 1) / recipients.length) * 100}%` }}
                    />
                  </div>
                )}

                {/* Info text - subtle */}
                <p className="text-xs text-muted-foreground text-center">
                  {SEND_PACE_TEXT}
                </p>
              </div>
            ) : (
              // Message editing view
              <div className="flex-1 overflow-hidden flex flex-col gap-4">
                {/* Navigation header */}
                <div className="flex items-center justify-between bg-muted/50 rounded-lg p-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => goToRecipient('prev')}
                    disabled={currentRecipientIndex === 0}
                  >
                    <ChevronLeft className="w-4 h-4 mr-1" />
                    Précédent
                  </Button>
                  <div className="text-sm font-medium">
                    {currentRecipientIndex + 1} / {recipients.length}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => goToRecipient('next')}
                    disabled={currentRecipientIndex === recipients.length - 1}
                  >
                    Suivant
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>

                {/* Current recipient info - clean */}
                {currentRecipient && (
                  <div className="flex items-center justify-between py-3 border-b border-border">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-foreground text-sm">{currentRecipient.name}</div>
                      <div className="text-xs text-muted-foreground truncate max-w-[350px]">
                        {currentRecipient.headline}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {currentMessage?.isEdited && (
                        <span className="text-xs text-warning-foreground flex items-center gap-1">
                          <Edit2 className="w-3 h-3" />
                          modifié
                        </span>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleRegenerateMessage}
                        disabled={isGenerating}
                        className="h-8 w-8 p-0"
                        aria-label={`Régénérer le message de ${currentRecipient.name}`}
                        title="Régénérer ce message"
                      >
                        <RefreshCw className={cn("w-3.5 h-3.5", isGenerating && "animate-spin")} aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                )}

                {/* Message editor - clean */}
                <div className="flex-1 overflow-auto space-y-3 pt-3">
                  <div>
                    <Label htmlFor="subject" className="text-xs font-medium text-muted-foreground">Objet</Label>
                    <Input
                      id="subject"
                      value={editingSubject}
                      onChange={(e) => setEditingSubject(e.target.value)}
                      placeholder="Objet du message..."
                      className="mt-1 h-9"
                    />
                  </div>

                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <Label htmlFor="message" className="text-xs font-medium text-muted-foreground">Message</Label>
                      {currentMessage && (
                        editingSubject !== currentMessage.subject || 
                        editingMessage !== currentMessage.message
                      ) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={handleSaveEdit}
                          className="text-success-foreground hover:text-success-foreground/80 h-7 text-xs"
                        >
                          <Check className="w-3 h-3 mr-1" />
                          Sauvegarder
                        </Button>
                      )}
                    </div>
                    <InMailTextEditor
                      id="message"
                      value={editingMessage}
                      onChange={setEditingMessage}
                      placeholder="Le message d'approche..."
                      minHeight="150px"
                      maxCharacters={1900}
                    />
                  </div>

                  {/* Personalization points - subtle */}
                  {currentMessage?.personalizationPoints && currentMessage.personalizationPoints.length > 0 && (
                    <div className="text-xs text-muted-foreground pt-2 border-t border-border">
                      <span className="font-medium text-muted-foreground flex items-center gap-1 mb-1">
                        <Sparkles className="w-3 h-3" />
                        Points de personnalisation
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {currentMessage.personalizationPoints.map((point, i) => (
                          <span key={i} className="bg-muted px-2 py-0.5 rounded text-muted-foreground">
                            {point}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Quick navigation dots */}
                <div className="flex justify-center gap-1 py-2 border-t border-border">
                  {recipients.slice(0, 15).map((r, i) => (
                    <button
                      key={r.id}
                      onClick={() => {
                        if (currentMessage && (
                          editingSubject !== currentMessage.subject || 
                          editingMessage !== currentMessage.message
                        )) {
                          handleSaveEdit();
                        }
                        setCurrentRecipientIndex(i);
                      }}
                      className={cn(
                        "w-2 h-2 rounded-full transition-all",
                        i === currentRecipientIndex 
                          ? "bg-linkedin scale-125" 
                          : generatedMessages[r.id] 
                            ? "bg-success"
                            : "bg-muted"
                      )}
                      aria-label={`Afficher le message de ${r.name}`}
                      aria-current={i === currentRecipientIndex ? 'true' : undefined}
                    />
                  ))}
                  {recipients.length > 15 && (
                    <span className="text-xs text-muted-foreground ml-1">+{recipients.length - 15}</span>
                  )}
                </div>
              </div>
            )}
          </TabsContent>

          {/* Queue Tab */}
          <TabsContent value="queue" className="flex-1 overflow-hidden flex flex-col px-6 pb-6 mt-0">
            {/* Queue Stats - compact */}
            {queueStats && (
              <div className="grid grid-cols-5 gap-2 text-center py-3 border-b border-border mb-3">
                <div>
                  <div className="text-lg font-semibold text-info-foreground">{pendingCount}</div>
                  <div className="text-xs text-muted-foreground uppercase">Planifiés</div>
                </div>
                <div>
                  <div className="text-lg font-semibold text-warning-foreground">{queueStats.sending}</div>
                  <div className="text-xs text-muted-foreground uppercase">En cours</div>
                </div>
                <div>
                  <div className="text-lg font-semibold text-success-foreground">{queueStats.sent}</div>
                  <div className="text-xs text-muted-foreground uppercase">Envoyés</div>
                </div>
                <div>
                  <div className="text-lg font-semibold text-destructive">{queueStats.failed}</div>
                  <div className="text-xs text-muted-foreground uppercase">Échoués</div>
                </div>
                <div>
                  <div className="text-lg font-semibold text-muted-foreground">{queueStats.cancelled}</div>
                  <div className="text-xs text-muted-foreground uppercase">Annulés</div>
                </div>
              </div>
            )}

            {queueItems.length >= 100 && (
              <p className="text-[11px] text-muted-foreground mb-2">
                Les 100 derniers InMails sont listés ; les compteurs portent sur toute votre file.
              </p>
            )}
            {/* Queue items */}
            <ScrollArea className="flex-1">
              <div className="space-y-2">
                {queueItems.length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground">
                    <Clock className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">Aucun InMail en file d'attente</p>
                  </div>
                ) : (
                  queueItems.map(item => (
                    <div key={item.id} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm text-foreground truncate">{item.recipient_name || 'Inconnu'}</div>
                        <div className="text-xs text-muted-foreground truncate">{item.subject}</div>
                        {item.scheduled_at && ['pending', 'scheduled'].includes(item.status) && (
                          <div className="text-xs text-info-foreground flex items-center gap-1 mt-1">
                            <Calendar className="w-3 h-3" />
                            {formatScheduledTime(item.scheduled_at)}
                          </div>
                        )}
                        {item.error_message && (
                          <div className="text-xs text-destructive mt-1">{item.error_message}</div>
                        )}
                      </div>
                      {getStatusBadge(item.status)}
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>

            {totalInQueue > 0 && (
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => {
                  if (pendingCount === 0) {
                    toast.info('Aucun InMail en attente à annuler');
                    return;
                  }
                  setConfirmCancelOpen(true);
                }}
                className="text-destructive hover:text-destructive/80 hover:bg-destructive/10 mt-3"
              >
                Annuler les envois en attente
              </Button>
            )}
          </TabsContent>
        </Tabs>

        {/* Footer — aligné avec le body : même bg-background, juste un
            border-t pour séparer. Avant : bg-muted créait une bande grise
            visuellement détachée du reste de la modal. */}
        <div className="px-6 py-3 border-t border-border bg-background flex justify-end gap-2 shrink-0">
          <Button variant="outline" onClick={requestClose} disabled={isQueueing}>
            Fermer
          </Button>

          {activeTab === 'compose' && hasGeneratedMessages && (
            <Button
              onClick={() => setConfirmQueueOpen(true)}
              disabled={isQueueing || readyCount === 0 || !canSendInMails || duplicatesUnchecked}
              className="bg-linkedin hover:bg-linkedin-hover text-white"
            >
              {isQueueing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Planification...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Planifier {readyCount} InMail{readyCount > 1 ? 's' : ''}
                </>
              )}
            </Button>
          )}
        </div>

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
        <AlertDialog open={confirmCancelOpen} onOpenChange={setConfirmCancelOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Annuler {pendingCount} InMail{pendingCount > 1 ? 's' : ''} en attente ?</AlertDialogTitle>
              <AlertDialogDescription>
                Tous vos InMails programmés et pas encore envoyés seront annulés, y compris ceux d'autres sélections. Cette action est irréversible.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Garder</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  setConfirmCancelOpen(false);
                  void handleCancelPending();
                }}
              >
                Annuler les envois
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
};