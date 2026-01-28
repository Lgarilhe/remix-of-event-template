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
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { 
  Mail, 
  Clock, 
  CheckCircle, 
  XCircle, 
  AlertTriangle,
  Loader2,
  Users,
  Calendar,
  Info
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Recipient {
  id: string;
  name: string;
  headline?: string;
  profile_id: string;
}

interface BulkInMailModalProps {
  isOpen: boolean;
  onClose: () => void;
  recipients: Recipient[];
  accountId: string;
}

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
}) => {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [showQueue, setShowQueue] = useState(false);

  // Get user's timezone
  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

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

  useEffect(() => {
    if (isOpen) {
      fetchQueueStatus();
    }
  }, [isOpen]);

  // Format scheduled time in user's timezone
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

  // Handle queue submission
  const handleQueueInMails = async () => {
    if (!subject.trim()) {
      toast.error('Veuillez entrer un sujet');
      return;
    }
    if (!message.trim()) {
      toast.error('Veuillez entrer un message');
      return;
    }
    if (recipients.length === 0) {
      toast.error('Aucun destinataire sélectionné');
      return;
    }

    setIsLoading(true);
    try {
      const items = recipients.map(r => ({
        account_id: accountId,
        recipient_profile_id: r.profile_id,
        recipient_name: r.name,
        recipient_headline: r.headline,
        subject: subject.trim(),
        message: message.trim(),
      }));

      const { data, error } = await supabase.functions.invoke('process-inmail-queue', {
        body: {
          action: 'queue',
          items,
          user_timezone: userTimezone,
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erreur lors de la mise en queue');

      toast.success(`${data.queued} InMails planifiés pour envoi`);
      setSubject('');
      setMessage('');
      fetchQueueStatus();
      setShowQueue(true);
    } catch (err) {
      console.error('Error queueing InMails:', err);
      toast.error(err instanceof Error ? err.message : 'Erreur lors de la planification');
    } finally {
      setIsLoading(false);
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
  const completedPercent = queueStats && (queueStats.sent + queueStats.failed) > 0 ?
    Math.round((queueStats.sent / (queueStats.sent + queueStats.failed)) * 100) : 0;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-[#0077B5]" />
            Envoi InMails en masse
          </DialogTitle>
          <DialogDescription>
            Les InMails seront envoyés de façon espacée (2-5 min) pendant les heures ouvrables (8h-19h)
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4">
          {/* Queue Stats */}
          {queueStats && (
            <div className="bg-muted/50 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">File d'attente</span>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setShowQueue(!showQueue)}
                >
                  {showQueue ? 'Masquer' : 'Voir détails'}
                </Button>
              </div>
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

          {/* Queue Details */}
          {showQueue && queueItems.length > 0 && (
            <ScrollArea className="h-48 border rounded-lg">
              <div className="p-2 space-y-2">
                {queueItems.slice(0, 20).map(item => (
                  <div key={item.id} className="flex items-center justify-between p-2 bg-white rounded border">
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
                ))}
              </div>
            </ScrollArea>
          )}

          {/* New InMail Form */}
          {!showQueue && (
            <>
              {/* Recipients info */}
              <div className="flex items-center gap-2 p-3 bg-[#0077B5]/10 rounded-lg">
                <Users className="w-5 h-5 text-[#0077B5]" />
                <span className="text-sm font-medium">{recipients.length} destinataire(s) sélectionné(s)</span>
              </div>

              {/* Business hours info */}
              <div className="flex items-start gap-2 p-3 bg-amber-50 rounded-lg text-amber-800">
                <Info className="w-5 h-5 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <strong>Envoi intelligent :</strong> Les InMails seront envoyés entre 8h et 19h ({userTimezone}) 
                  avec un délai aléatoire de 2-5 minutes entre chaque envoi pour simuler une activité humaine.
                </div>
              </div>

              {/* Subject */}
              <div className="space-y-2">
                <Label htmlFor="subject">Sujet</Label>
                <Input
                  id="subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Ex: Opportunité chez [Entreprise]"
                />
              </div>

              {/* Message */}
              <div className="space-y-2">
                <Label htmlFor="message">Message</Label>
                <Textarea
                  id="message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Votre message..."
                  rows={6}
                />
                <p className="text-xs text-muted-foreground">
                  Astuce: Personnalisez le message pour de meilleurs résultats
                </p>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="flex gap-2">
          {showQueue && totalInQueue > 0 && (
            <Button 
              variant="outline" 
              onClick={handleCancelPending}
              className="text-red-600 border-red-200 hover:bg-red-50"
            >
              Annuler les envois en attente
            </Button>
          )}
          
          {showQueue ? (
            <Button onClick={() => setShowQueue(false)}>
              Nouveau message
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                Annuler
              </Button>
              <Button 
                onClick={handleQueueInMails} 
                disabled={isLoading || recipients.length === 0}
                className="bg-[#0077B5] hover:bg-[#005E93]"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Planification...
                  </>
                ) : (
                  <>
                    <Clock className="w-4 h-4 mr-2" />
                    Planifier {recipients.length} InMail(s)
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
