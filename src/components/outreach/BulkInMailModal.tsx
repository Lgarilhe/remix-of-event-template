import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
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
import { Job } from '@/pages/JobSpace';
import { useInMailBalance } from '@/hooks/useInMailBalance';
import { LinkedInProfile } from './types';

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
    try {
      const { data, error } = await supabase.functions.invoke('process-inmail-queue', {
        body: { action: 'status' },
      });

      if (error) throw error;
      if (data?.success) {
        setQueueStats(data.stats);
        setQueueItems(data.items || []);
      }
    } catch (err) {
      console.error('Error fetching queue status:', err);
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
    
    return {
      name: recipient.name,
      headline: recipient.headline || profile.headline,
      currentRole: currentJob?.role,
      currentCompany: currentJob?.company,
      location: profile.location,
      skills: profile.skills?.map((s: any) => s.name || s).slice(0, 10) || [],
      pastPositions: pastJobs.map(p => `${p.role} chez ${p.company}`),
    };
  };

  // Generate message for a single recipient
  const generateMessageForRecipient = async (recipient: Recipient) => {
    if (!selectedJob) return null;
    
    try {
      const profileData = buildProfileData(recipient);
      
      const { data, error } = await supabase.functions.invoke('generate-outreach-message', {
        body: { 
          profile: profileData, 
          job: {
            title: selectedJob.title,
            client: selectedJob.client,
            skills: selectedJob.skills || [],
            description: selectedJob.description,
            location: selectedJob.location,
            remote: selectedJob.remote,
          },
          tone,
          senderName: senderName.trim() || undefined,
        }
      });

      if (error) throw error;
      
      return {
        subject: data?.subject || `Opportunité ${selectedJob.title}`,
        message: data?.message || '',
        personalizationPoints: data?.personalization_points || [],
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
      toast.error('Sélectionnez un poste pour générer les messages');
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
    toast.success(`${Object.keys(newMessages).length} messages générés ! Cliquez sur chaque message pour le visualiser et modifier.`);
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
    if (readyCount === 0) {
      toast.error('Générez d\'abord les messages');
      return;
    }
    
    // Check credit availability before queueing
    if (!hasEnoughCredits) {
      toast.error(`Crédits InMail insuffisants (${recruiterCredits} restants, ${creditsNeeded} requis)`);
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

      const { data, error } = await supabase.functions.invoke('process-inmail-queue', {
        body: {
          action: 'queue',
          items,
          user_timezone: userTimezone,
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erreur lors de la mise en queue');

      // Refetch balance after queueing to update credits display
      refetchBalance();
      
      toast.success(`${data.queued} InMails planifiés pour envoi`);
      setGeneratedMessages({});
      setActiveTab('queue');
      fetchQueueStatus();
    } catch (err) {
      console.error('Error queueing InMails:', err);
      toast.error(err instanceof Error ? err.message : 'Erreur lors de la planification');
    } finally {
      setIsQueueing(false);
    }
  };

  // Cancel pending items
  const handleCancelPending = async () => {
    const pendingIds = queueItems
      .filter(item => ['pending', 'scheduled'].includes(item.status))
      .map(item => item.id);

    if (pendingIds.length === 0) {
      toast.info('Aucun InMail en attente à annuler');
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke('process-inmail-queue', {
        body: { action: 'cancel', item_ids: pendingIds },
      });

      if (error) throw error;
      toast.success(`${data?.cancelled || 0} InMails annulés`);
      fetchQueueStatus();
    } catch (err) {
      console.error('Error cancelling InMails:', err);
      toast.error('Erreur lors de l\'annulation');
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
        return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200"><Clock className="w-3 h-3 mr-1" />Planifié</Badge>;
      case 'sending':
        return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Envoi...</Badge>;
      case 'sent':
        return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200"><CheckCircle className="w-3 h-3 mr-1" />Envoyé</Badge>;
      case 'failed':
        return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200"><XCircle className="w-3 h-3 mr-1" />Échoué</Badge>;
      case 'cancelled':
        return <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-200"><XCircle className="w-3 h-3 mr-1" />Annulé</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const totalInQueue = queueStats ? 
    queueStats.pending + queueStats.scheduled + queueStats.sending : 0;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-[#0077B5]" />
            InMails personnalisés
          </DialogTitle>
          <DialogDescription>
            Génération IA de messages personnalisés pour chaque candidat
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'compose' | 'queue')} className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="w-full bg-muted/50">
            <TabsTrigger value="compose" className="flex-1 gap-2">
              <PenLine className="w-4 h-4" />
              Composer ({readyCount}/{recipients.length})
            </TabsTrigger>
            <TabsTrigger value="queue" className="flex-1 gap-2">
              <Clock className="w-4 h-4" />
              File d'attente {totalInQueue > 0 && `(${totalInQueue})`}
            </TabsTrigger>
          </TabsList>

          {/* Compose Tab */}
          <TabsContent value="compose" className="flex-1 overflow-hidden flex flex-col gap-4 mt-4">
            {!selectedJob ? (
              // No job selected
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center p-8">
                  <Sparkles className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                  <h3 className="font-semibold text-lg mb-2">Sélectionnez un poste</h3>
                  <p className="text-muted-foreground text-sm">
                    Pour générer des messages personnalisés, sélectionnez d'abord un poste dans le sélecteur de jobs.
                  </p>
                </div>
              </div>
            ) : !hasGeneratedMessages ? (
              // Generation setup
              <div className="space-y-4">
                {/* Job context */}
                <div className="flex flex-wrap gap-2 p-3 bg-purple-50 rounded-lg">
                  <Badge variant="outline" className="bg-white text-purple-700 border-purple-200">
                    {selectedJob.title}
                  </Badge>
                  {selectedJob.client?.name && (
                    <Badge variant="outline" className="bg-white text-blue-700 border-blue-200">
                      {selectedJob.client.name}
                    </Badge>
                  )}
                </div>

                {/* Recipients info */}
                <div className="flex items-center gap-2 p-3 bg-[#0077B5]/10 rounded-lg">
                  <Users className="w-5 h-5 text-[#0077B5]" />
                  <span className="text-sm font-medium">{recipients.length} candidat(s) sélectionné(s)</span>
                </div>

                {/* InMail Credits Display - Real API Data */}
                <div className={cn(
                  "p-3 rounded-lg border",
                  !hasEnoughCredits 
                    ? "bg-red-50 border-red-200" 
                    : isNearLimit
                    ? "bg-amber-50 border-amber-200"
                    : "bg-green-50 border-green-200"
                )}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Mail className={cn(
                        "w-4 h-4",
                        !hasEnoughCredits ? "text-red-600" : isNearLimit ? "text-amber-600" : "text-green-600"
                      )} />
                      <span className="text-sm font-medium">Crédits InMail Recruiter</span>
                      {isLoadingBalance && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "text-sm font-bold",
                        !hasEnoughCredits ? "text-red-600" : isNearLimit ? "text-amber-600" : "text-green-600"
                      )}>
                        {recruiterCredits} crédit{recruiterCredits !== 1 ? 's' : ''} disponible{recruiterCredits !== 1 ? 's' : ''}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => refetchBalance()}
                        disabled={isLoadingBalance}
                      >
                        <RefreshCw className={cn("h-3 w-3", isLoadingBalance && "animate-spin")} />
                      </Button>
                    </div>
                  </div>
                  
                  {balanceError && (
                    <p className="text-xs text-amber-600 mb-2">
                      ⚠️ Impossible de récupérer le solde: {balanceError}
                    </p>
                  )}
                  
                  {balance && (
                    <div className="flex gap-2 flex-wrap text-xs text-muted-foreground">
                      {balance.premium !== null && (
                        <Badge variant="outline" className="text-xs">Premium: {balance.premium}</Badge>
                      )}
                      {balance.recruiter !== null && (
                        <Badge variant="outline" className="text-xs bg-purple-50">Recruiter: {balance.recruiter}</Badge>
                      )}
                      {balance.sales_navigator !== null && (
                        <Badge variant="outline" className="text-xs">Sales Nav: {balance.sales_navigator}</Badge>
                      )}
                    </div>
                  )}
                  
                  {!hasEnoughCredits && (
                    <Alert variant="destructive" className="mt-2 py-2">
                      <AlertTriangle className="w-4 h-4" />
                      <AlertDescription className="text-xs">
                        Crédits insuffisants : vous avez besoin de {creditsNeeded} crédit{creditsNeeded !== 1 ? 's' : ''} mais il n'en reste que {recruiterCredits}.
                      </AlertDescription>
                    </Alert>
                  )}
                  {hasEnoughCredits && isNearLimit && (
                    <p className="text-xs text-amber-700 mt-2">
                      ⚠️ Crédits bientôt épuisés
                    </p>
                  )}
                </div>

                {/* Sender name */}
                <div>
                  <Label htmlFor="senderName">Ton prénom (pour la signature)</Label>
                  <Input
                    id="senderName"
                    value={senderName}
                    onChange={(e) => handleSenderNameChange(e.target.value)}
                    placeholder="Ex: Marc"
                    className="max-w-[200px] mt-1"
                  />
                </div>

                {/* Tone selector */}
                <div>
                  <Label className="mb-2 block">Ton des messages</Label>
                  <div className="flex gap-2">
                    {[
                      { value: 'professional', label: 'Professionnel', emoji: '👔' },
                      { value: 'casual', label: 'Décontracté', emoji: '😊' },
                      { value: 'enthusiastic', label: 'Enthousiaste', emoji: '🚀' },
                    ].map((t) => (
                      <Button
                        key={t.value}
                        variant={tone === t.value ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setTone(t.value as Tone)}
                        className={tone === t.value ? 'bg-[#0077B5] hover:bg-[#005E93]' : ''}
                      >
                        {t.emoji} {t.label}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Business hours info */}
                <div className="flex items-start gap-2 p-3 bg-amber-50 rounded-lg text-amber-800">
                  <Info className="w-5 h-5 shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <strong>Envoi intelligent :</strong> Les InMails seront envoyés entre 8h et 19h ({userTimezone}) 
                    avec un délai de 2-5 minutes entre chaque envoi.
                  </div>
                </div>

                {/* Generate button */}
                <Button
                  onClick={handleGenerateAll}
                  disabled={isGenerating || !hasEnoughCredits}
                  className={cn(
                    "w-full",
                    !hasEnoughCredits 
                      ? "bg-gray-400 cursor-not-allowed"
                      : "bg-gradient-to-r from-purple-600 to-[#0077B5] hover:from-purple-700 hover:to-[#005E93]"
                  )}
                  size="lg"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Génération {generatingIndex + 1}/{recipients.length}...
                    </>
                  ) : !hasEnoughCredits ? (
                    <>
                      <AlertTriangle className="w-4 h-4 mr-2" />
                      Crédits insuffisants
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Générer {recipients.length} messages IA
                    </>
                  )}
                </Button>

                {/* Progress indicator */}
                {isGenerating && (
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-gradient-to-r from-purple-600 to-[#0077B5] h-2 rounded-full transition-all"
                      style={{ width: `${((generatingIndex + 1) / recipients.length) * 100}%` }}
                    />
                  </div>
                )}
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

                {/* Current recipient info */}
                {currentRecipient && (
                  <div className="flex items-center justify-between p-3 bg-[#0077B5]/10 rounded-lg">
                    <div>
                      <div className="font-medium text-[#1A1A1A]">{currentRecipient.name}</div>
                      <div className="text-sm text-muted-foreground truncate max-w-[400px]">
                        {currentRecipient.headline}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {currentMessage?.isEdited && (
                        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                          <Edit2 className="w-3 h-3 mr-1" />
                          Modifié
                        </Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleRegenerateMessage}
                        disabled={isGenerating}
                      >
                        <RefreshCw className={cn("w-4 h-4", isGenerating && "animate-spin")} />
                      </Button>
                    </div>
                  </div>
                )}

                {/* Message editor */}
                <div className="flex-1 overflow-auto space-y-4">
                  <div>
                    <Label htmlFor="subject">Objet</Label>
                    <Input
                      id="subject"
                      value={editingSubject}
                      onChange={(e) => setEditingSubject(e.target.value)}
                      placeholder="Objet du message..."
                      className="mt-1"
                    />
                  </div>

                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <Label htmlFor="message">Message</Label>
                      {currentMessage && (
                        editingSubject !== currentMessage.subject || 
                        editingMessage !== currentMessage.message
                      ) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={handleSaveEdit}
                          className="text-green-600 hover:text-green-700 h-7"
                        >
                          <Check className="w-4 h-4 mr-1" />
                          Sauvegarder
                        </Button>
                      )}
                    </div>
                    <InMailTextEditor
                      id="message"
                      value={editingMessage}
                      onChange={setEditingMessage}
                      placeholder="Le message d'approche..."
                      minHeight="180px"
                      maxCharacters={1900}
                    />
                  </div>

                  {/* Personalization points */}
                  {currentMessage?.personalizationPoints && currentMessage.personalizationPoints.length > 0 && (
                    <div className="bg-amber-50 rounded-lg p-3 border border-amber-200">
                      <div className="flex items-center gap-2 text-amber-700 font-medium text-sm mb-2">
                        <Sparkles className="w-4 h-4" />
                        Points de personnalisation
                      </div>
                      <ul className="space-y-1">
                        {currentMessage.personalizationPoints.map((point, i) => (
                          <li key={i} className="text-xs text-amber-800 flex items-start gap-2">
                            <span className="text-amber-500">•</span>
                            {point}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {/* Quick navigation dots */}
                <div className="flex justify-center gap-1 py-2">
                  {recipients.slice(0, 20).map((r, i) => (
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
                          ? "bg-[#0077B5] scale-125" 
                          : generatedMessages[r.id] 
                            ? "bg-green-400 hover:bg-green-500"
                            : "bg-gray-300 hover:bg-gray-400"
                      )}
                    />
                  ))}
                  {recipients.length > 20 && (
                    <span className="text-xs text-muted-foreground ml-2">+{recipients.length - 20}</span>
                  )}
                </div>
              </div>
            )}
          </TabsContent>

          {/* Queue Tab */}
          <TabsContent value="queue" className="flex-1 overflow-hidden flex flex-col gap-4 mt-4">
            {/* Queue Stats */}
            {queueStats && (
              <div className="bg-muted/50 rounded-lg p-4">
                <div className="grid grid-cols-5 gap-2 text-center">
                  <div>
                    <div className="text-lg font-bold text-blue-600">{queueStats.scheduled}</div>
                    <div className="text-xs text-muted-foreground">Planifiés</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-amber-600">{queueStats.sending}</div>
                    <div className="text-xs text-muted-foreground">En cours</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-green-600">{queueStats.sent}</div>
                    <div className="text-xs text-muted-foreground">Envoyés</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-red-600">{queueStats.failed}</div>
                    <div className="text-xs text-muted-foreground">Échoués</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-gray-600">{queueStats.cancelled}</div>
                    <div className="text-xs text-muted-foreground">Annulés</div>
                  </div>
                </div>
              </div>
            )}

            {/* Queue items */}
            <ScrollArea className="flex-1">
              <div className="space-y-2">
                {queueItems.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Clock className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p>Aucun InMail en file d'attente</p>
                  </div>
                ) : (
                  queueItems.map(item => (
                    <div key={item.id} className="flex items-center justify-between p-3 bg-white rounded-lg border">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{item.recipient_name || 'Inconnu'}</div>
                        <div className="text-xs text-muted-foreground truncate">{item.subject}</div>
                        {item.scheduled_at && ['pending', 'scheduled'].includes(item.status) && (
                          <div className="text-xs text-blue-600 flex items-center gap-1 mt-1">
                            <Calendar className="w-3 h-3" />
                            {formatScheduledTime(item.scheduled_at)}
                          </div>
                        )}
                        {item.error_message && (
                          <div className="text-xs text-red-600 mt-1">{item.error_message}</div>
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
                variant="outline" 
                onClick={handleCancelPending}
                className="text-red-600 border-red-200 hover:bg-red-50"
              >
                Annuler les envois en attente
              </Button>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter className="flex gap-2 pt-4 border-t">
          <Button variant="outline" onClick={onClose}>
            Fermer
          </Button>
          
          {activeTab === 'compose' && hasGeneratedMessages && (
            <Button 
              onClick={handleQueueAll} 
              disabled={isQueueing || readyCount === 0}
              className="bg-[#0077B5] hover:bg-[#005E93]"
            >
              {isQueueing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Planification...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Planifier {readyCount} InMail(s)
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
