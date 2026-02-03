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
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col p-0">
        {/* Clean header */}
        <div className="px-6 py-4 border-b bg-white shrink-0">
          <DialogHeader className="space-y-1">
            <DialogTitle className="flex items-center gap-2 text-lg">
              <div className="w-8 h-8 rounded-lg bg-[#0077B5] flex items-center justify-center">
                <Mail className="w-4 h-4 text-white" />
              </div>
              InMails personnalisés
            </DialogTitle>
            <DialogDescription className="text-sm">
              Génération IA de messages pour {recipients.length} candidat{recipients.length > 1 ? 's' : ''}
            </DialogDescription>
          </DialogHeader>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'compose' | 'queue')} className="flex-1 overflow-hidden flex flex-col">
          <div className="px-6 pt-4 shrink-0">
            <TabsList className="w-full bg-gray-100/80 p-1 h-10">
              <TabsTrigger value="compose" className="flex-1 gap-2 text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm">
                <PenLine className="w-3.5 h-3.5" />
                Composer ({readyCount}/{recipients.length})
              </TabsTrigger>
              <TabsTrigger value="queue" className="flex-1 gap-2 text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm">
                <Clock className="w-3.5 h-3.5" />
                File d'attente {totalInQueue > 0 && `(${totalInQueue})`}
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Compose Tab */}
          <TabsContent value="compose" className="flex-1 overflow-y-auto px-6 pb-6 mt-0">
            {!selectedJob ? (
              // No job selected
              <div className="flex-1 flex items-center justify-center py-12">
                <div className="text-center">
                  <Sparkles className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                  <h3 className="font-medium text-gray-900 mb-1">Sélectionnez un poste</h3>
                  <p className="text-sm text-gray-500 max-w-xs">
                    Pour générer des messages personnalisés, sélectionnez d'abord un poste.
                  </p>
                </div>
              </div>
            ) : !hasGeneratedMessages ? (
              // Generation setup - clean design
              <div className="space-y-5 pt-4">
                {/* Context row: Job + Recipients + Credits - compact */}
                <div className="flex items-center justify-between gap-4 pb-4 border-b border-gray-100">
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
                        ? "bg-red-100 text-red-700" 
                        : isNearLimit
                        ? "bg-amber-100 text-amber-700"
                        : "bg-emerald-100 text-emerald-700"
                    )}>
                      <Mail className="w-3 h-3" />
                      {recruiterCredits} crédits
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => refetchBalance()}
                      disabled={isLoadingBalance}
                    >
                      <RefreshCw className={cn("h-3 w-3", isLoadingBalance && "animate-spin")} />
                    </Button>
                  </div>
                </div>

                {/* Error message for credits if needed */}
                {!hasEnoughCredits && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 text-red-700 text-sm">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>Crédits insuffisants ({recruiterCredits} restants, {creditsNeeded} requis)</span>
                  </div>
                )}

                {/* Configuration section */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Sender name */}
                  <div>
                    <Label htmlFor="senderName" className="text-xs font-medium text-gray-600 mb-1.5 block">
                      Ton prénom (signature)
                    </Label>
                    <Input
                      id="senderName"
                      value={senderName}
                      onChange={(e) => handleSenderNameChange(e.target.value)}
                      placeholder="Ex: Marc"
                      className="h-9"
                    />
                  </div>
                  
                  {/* Tone selector */}
                  <div>
                    <Label className="text-xs font-medium text-gray-600 mb-1.5 block">Ton</Label>
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
                            tone === t.value ? 'bg-[#0077B5] hover:bg-[#005E93]' : ''
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
                  disabled={isGenerating || !hasEnoughCredits}
                  className={cn(
                    "w-full h-11",
                    !hasEnoughCredits 
                      ? "bg-gray-300 cursor-not-allowed"
                      : "bg-[#0077B5] hover:bg-[#005E93]"
                  )}
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Génération {generatingIndex + 1}/{recipients.length}...
                    </>
                  ) : !hasEnoughCredits ? (
                    'Crédits insuffisants'
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Générer {recipients.length} messages
                    </>
                  )}
                </Button>

                {/* Progress bar */}
                {isGenerating && (
                  <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                    <div 
                      className="bg-[#0077B5] h-full transition-all duration-300"
                      style={{ width: `${((generatingIndex + 1) / recipients.length) * 100}%` }}
                    />
                  </div>
                )}

                {/* Info text - subtle */}
                <p className="text-xs text-gray-400 text-center">
                  Envoi entre 8h-19h ({userTimezone.split('/')[1] || userTimezone}) • Délai 2-5 min entre chaque
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
                  <div className="flex items-center justify-between py-3 border-b border-gray-100">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-gray-900 text-sm">{currentRecipient.name}</div>
                      <div className="text-xs text-gray-500 truncate max-w-[350px]">
                        {currentRecipient.headline}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {currentMessage?.isEdited && (
                        <span className="text-xs text-amber-600 flex items-center gap-1">
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
                      >
                        <RefreshCw className={cn("w-3.5 h-3.5", isGenerating && "animate-spin")} />
                      </Button>
                    </div>
                  </div>
                )}

                {/* Message editor - clean */}
                <div className="flex-1 overflow-auto space-y-3 pt-3">
                  <div>
                    <Label htmlFor="subject" className="text-xs font-medium text-gray-600">Objet</Label>
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
                      <Label htmlFor="message" className="text-xs font-medium text-gray-600">Message</Label>
                      {currentMessage && (
                        editingSubject !== currentMessage.subject || 
                        editingMessage !== currentMessage.message
                      ) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={handleSaveEdit}
                          className="text-emerald-600 hover:text-emerald-700 h-7 text-xs"
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
                    <div className="text-xs text-gray-500 pt-2 border-t border-gray-100">
                      <span className="font-medium text-gray-600 flex items-center gap-1 mb-1">
                        <Sparkles className="w-3 h-3" />
                        Points de personnalisation
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {currentMessage.personalizationPoints.map((point, i) => (
                          <span key={i} className="bg-gray-100 px-2 py-0.5 rounded text-gray-600">
                            {point}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Quick navigation dots */}
                <div className="flex justify-center gap-1 py-2 border-t border-gray-100">
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
                          ? "bg-[#0077B5] scale-125" 
                          : generatedMessages[r.id] 
                            ? "bg-emerald-400"
                            : "bg-gray-200"
                      )}
                    />
                  ))}
                  {recipients.length > 15 && (
                    <span className="text-xs text-gray-400 ml-1">+{recipients.length - 15}</span>
                  )}
                </div>
              </div>
            )}
          </TabsContent>

          {/* Queue Tab */}
          <TabsContent value="queue" className="flex-1 overflow-hidden flex flex-col px-6 pb-6 mt-0">
            {/* Queue Stats - compact */}
            {queueStats && (
              <div className="grid grid-cols-5 gap-2 text-center py-3 border-b border-gray-100 mb-3">
                <div>
                  <div className="text-lg font-semibold text-blue-600">{queueStats.scheduled}</div>
                  <div className="text-[10px] text-gray-500 uppercase">Planifiés</div>
                </div>
                <div>
                  <div className="text-lg font-semibold text-amber-500">{queueStats.sending}</div>
                  <div className="text-[10px] text-gray-500 uppercase">En cours</div>
                </div>
                <div>
                  <div className="text-lg font-semibold text-emerald-600">{queueStats.sent}</div>
                  <div className="text-[10px] text-gray-500 uppercase">Envoyés</div>
                </div>
                <div>
                  <div className="text-lg font-semibold text-red-500">{queueStats.failed}</div>
                  <div className="text-[10px] text-gray-500 uppercase">Échoués</div>
                </div>
                <div>
                  <div className="text-lg font-semibold text-gray-400">{queueStats.cancelled}</div>
                  <div className="text-[10px] text-gray-500 uppercase">Annulés</div>
                </div>
              </div>
            )}

            {/* Queue items */}
            <ScrollArea className="flex-1">
              <div className="space-y-2">
                {queueItems.length === 0 ? (
                  <div className="text-center py-10 text-gray-400">
                    <Clock className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">Aucun InMail en file d'attente</p>
                  </div>
                ) : (
                  queueItems.map(item => (
                    <div key={item.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm text-gray-900 truncate">{item.recipient_name || 'Inconnu'}</div>
                        <div className="text-xs text-gray-500 truncate">{item.subject}</div>
                        {item.scheduled_at && ['pending', 'scheduled'].includes(item.status) && (
                          <div className="text-xs text-blue-600 flex items-center gap-1 mt-1">
                            <Calendar className="w-3 h-3" />
                            {formatScheduledTime(item.scheduled_at)}
                          </div>
                        )}
                        {item.error_message && (
                          <div className="text-xs text-red-500 mt-1">{item.error_message}</div>
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
                onClick={handleCancelPending}
                className="text-red-500 hover:text-red-600 hover:bg-red-50 mt-3"
              >
                Annuler les envois en attente
              </Button>
            )}
          </TabsContent>
        </Tabs>

        {/* Footer - clean */}
        <div className="px-6 py-4 border-t bg-gray-50 flex justify-end gap-2 shrink-0">
          <Button variant="ghost" onClick={onClose} className="text-gray-600">
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
                  Planifier {readyCount} InMail{readyCount > 1 ? 's' : ''}
                </>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};