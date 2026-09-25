import React, { useState, useEffect, useId } from 'react';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
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
  recipients,
  accountId,
  selectedJob,
}) => {
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
  const [confirmCancel, setConfirmCancel] = useState(false);

  const senderId = useId();
  const subjectId = useId();
  const messageId = useId();

  // InMail balance from real API
  const { balance, isLoading: isLoadingBalance, error: balanceError, refetch: refetchBalance, hasCredits, getCredits } = useInMailBalance(accountId);
  
  // Recruiter credits (primary for InMails)
  const recruiterCredits = getCredits('recruiter');
  const creditsNeeded = recipients.length;
  const hasEnoughCredits = hasCredits('recruiter', creditsNeeded);
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

  const hasUnsavedEdit = !!currentMessage && (
    editingSubject !== currentMessage.subject ||
    editingMessage !== currentMessage.message
  );

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
  };

  // Reset state when recipients change (new selection)
  useEffect(() => {
    setGeneratedMessages({});
    setCurrentRecipientIndex(0);
  }, [recipients.map(r => r.id).join(',')]);

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
          client: selectedJob.client,
          skills: selectedJob.skills || [],
          description: selectedJob.description,
          location: selectedJob.location,
          remote: selectedJob.remote,
          accompagnement: selectedJob.accompagnement || [],
        },
        tone,
        senderName: senderName.trim() || undefined,
        candidateLinkedInUrl: recipient.profile?.public_profile_url || recipient.profile?.profile_url || undefined,
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
    if (!selectedJob) {
      toast.error('Choisissez un poste pour générer les messages.');
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
    if (generated === recipients.length) {
      toast.success(`${plural(generated, 'message généré', 'messages générés')} : relisez-les avant de planifier l'envoi.`);
    } else if (generated > 0) {
      toast.warning(`${generated} messages générés sur ${recipients.length} : régénérez les messages manquants avant de planifier.`);
    } else {
      toast.error("Aucun message n'a pu être généré. Réessayez dans un instant.");
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
    if (readyCount === 0) {
      toast.error("Générez d'abord les messages.");
      return;
    }
    
    // Check credit availability before queueing
    if (!hasEnoughCredits) {
      toast.error(`Crédits InMail insuffisants : ${recruiterCredits} restants pour ${creditsNeeded} candidats.`);
      return;
    }
    
    setIsQueueing(true);
    
    try {
      const items = recipients
        .filter(r => generatedMessages[r.id])
        .map(r => {
          // Parse network_distance - can be number or string like "DISTANCE_2"
          let networkDistance: number | null = null;
          if (typeof r.network_distance === 'number') {
            networkDistance = r.network_distance;
          } else if (typeof r.network_distance === 'string') {
            const match = r.network_distance.match(/(\d+)/);
            networkDistance = match ? parseInt(match[1], 10) : null;
          } else if (r.profile?.network_distance) {
            // Fallback to profile data
            if (typeof r.profile.network_distance === 'number') {
              networkDistance = r.profile.network_distance;
            } else if (typeof r.profile.network_distance === 'string') {
              const match = r.profile.network_distance.match(/(\d+)/);
              networkDistance = match ? parseInt(match[1], 10) : null;
            }
          }
          
          return {
            account_id: accountId,
            recipient_profile_id: r.profile_id,
            recipient_name: r.name,
            recipient_headline: r.headline,
            subject: generatedMessages[r.id].subject,
            message: generatedMessages[r.id].message,
            network_distance: networkDistance,
          };
        });

      const { data, error } = await invokeEdgeFunction<{ queued?: number }>('process-inmail-queue', {
        action: 'queue',
        items,
        user_timezone: userTimezone,
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'queue');

      // Refetch balance after queueing to update credits display
      refetchBalance();
      
      const queued = data.queued || 0;
      toast.success(`${plural(queued, 'InMail planifié', 'InMails planifiés')} : envoi pendant vos horaires d'envoi.`);
      setGeneratedMessages({});
      setActiveTab('queue');
      fetchQueueStatus();
    } catch (err) {
      console.error('Error queueing InMails:', err);
      toast.error("Les InMails n'ont pas pu être planifiés. Réessayez.");
    } finally {
      setIsQueueing(false);
    }
  };

  const pendingIds = queueItems
    .filter(item => ['pending', 'scheduled'].includes(item.status))
    .map(item => item.id);

  // Cancel pending items
  const handleCancelPending = async () => {
    if (pendingIds.length === 0) {
      toast.info('Aucun InMail en attente à annuler.');
      return;
    }

    try {
      const { data, error } = await invokeEdgeFunction<{ cancelled?: number }>('process-inmail-queue', {
        action: 'cancel', item_ids: pendingIds,
      });

      if (error) throw error;
      const cancelled = data?.cancelled || 0;
      toast.success(cancelled > 0
        ? `${plural(cancelled, 'InMail annulé', 'InMails annulés')} : ${cancelled > 1 ? 'ils ne partiront pas' : 'il ne partira pas'}.`
        : 'Aucun InMail annulé : ils étaient déjà partis.');
      fetchQueueStatus();
    } catch (err) {
      console.error('Error cancelling InMails:', err);
      toast.error("Les envois n'ont pas pu être annulés. Réessayez.");
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

  const timezoneCity = (userTimezone.split('/')[1] || userTimezone).replace(/_/g, ' ');

  const queueCounters = queueStats
    ? [
        { label: 'Planifiés', value: queueStats.pending + queueStats.scheduled },
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

  return (
    <>
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <div className="shrink-0 border-b border-border px-6 py-4 pr-14">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted">
                <ChannelIcon channel="linkedin" size="sm" />
              </span>
              <div className="flex min-w-0 flex-col gap-0.5 text-left">
                <DialogTitle>InMail groupé</DialogTitle>
                <DialogDescription>
                  Un message personnalisé par l'IA Konekt pour {recipients.length > 1 ? `chacun des ${recipients.length} candidats` : 'le candidat'}, à relire avant l'envoi.
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
                Rédaction ({readyCount} sur {recipients.length})
              </TabsTrigger>
              <TabsTrigger value="queue" className="flex-1 gap-2">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                File d'attente{totalInQueue > 0 && ` (${totalInQueue})`}
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Rédaction */}
          <TabsContent value="compose" className="mt-0 min-h-0 flex-1 overflow-y-auto px-6 pb-6">
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
                  
                {/* Crédits insuffisants */}
                {!hasEnoughCredits && (
                  <div role="alert" className="flex items-start gap-2 rounded-lg bg-danger-muted p-3 text-sm text-danger">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>
                      {balanceError
                        ? "Le solde de crédits InMail n'a pas pu être lu. Actualisez le solde, puis réessayez."
                        : `Crédits InMail insuffisants : ${recruiterCredits} restants pour ${creditsNeeded} candidats.`}
                    </span>
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
                      placeholder="Ex. : Camille"
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
                  disabled={!hasEnoughCredits}
                  loading={isGenerating}
                  className="w-full"
                >
                  {isGenerating
                    ? `Génération ${generatingIndex + 1} sur ${recipients.length}…`
                    : !hasEnoughCredits
                      ? 'Crédits InMail insuffisants'
                      : recipients.length > 1 ? `Générer les ${recipients.length} messages` : 'Générer le message'}
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
                  Envoi pendant vos horaires d'envoi (de 8 h à 19 h par défaut, heure de {timezoneCity}), avec quelques minutes entre deux InMails.
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

                {/* Objet et message */}
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor={subjectId} className="text-xs font-medium text-muted-foreground">Objet</Label>
                    <Input
                      id={subjectId}
                      value={editingSubject}
                      onChange={(e) => setEditingSubject(e.target.value)}
                      placeholder="Objet de l'InMail"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor={messageId} className="text-xs font-medium text-muted-foreground">Message</Label>
                      {hasUnsavedEdit && (
                        <Button size="xs" variant="ghost" onClick={handleSaveEdit} className="max-md:h-11">
                          <Check aria-hidden="true" />
                          Enregistrer les modifications
                        </Button>
                      )}
                    </div>
                    <InMailTextEditor
                      id={messageId}
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
                        <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />
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

                {pendingIds.length > 0 && (
                  <div className="mt-3 flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmCancel(true)}
                      className="text-danger hover:text-danger max-md:h-11"
                    >
                      Annuler les envois en attente
                    </Button>
                  </div>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>

        {/* Pied : même fond que le corps, un filet pour séparer */}
        <div className="flex shrink-0 justify-end gap-2 border-t border-border px-6 py-3">
          <Button variant="outline" onClick={onClose}>
            Fermer
          </Button>

          {activeTab === 'compose' && hasGeneratedMessages && (
            <Button
              variant="primary"
              onClick={handleQueueAll}
              disabled={readyCount === 0}
              loading={isQueueing}
            >
              {!isQueueing && <Send aria-hidden="true" />}
              {readyCount > 1 ? `Planifier les ${readyCount} InMails` : "Planifier l'InMail"}
              {!allGenerated && readyCount > 0 && <span className="sr-only"> (sur {recipients.length} candidats)</span>}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>

    <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {pendingIds.length > 1 ? `Annuler les ${pendingIds.length} InMails en attente ?` : "Annuler l'InMail en attente ?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {pendingIds.length > 1 ? 'Ils ne partiront pas.' : 'Il ne partira pas.'} Les InMails déjà envoyés ou en cours d'envoi ne sont pas concernés. Cette action est irréversible.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Garder les envois</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive"
            onClick={() => {
              setConfirmCancel(false);
              handleCancelPending();
            }}
          >
            {pendingIds.length > 1 ? 'Annuler les envois' : "Annuler l'envoi"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
};
