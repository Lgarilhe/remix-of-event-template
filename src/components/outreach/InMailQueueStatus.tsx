import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Mail, 
  Clock, 
  CheckCircle, 
  XCircle, 
  Loader2,
  RefreshCw,
  Calendar,
} from 'lucide-react';
import { toast } from 'sonner';

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

export const InMailQueueStatus: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(false);

  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const fetchQueueStatus = useCallback(async () => {
    setLoading(true);
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
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on mount and when dialog opens
  useEffect(() => {
    fetchQueueStatus();
  }, [fetchQueueStatus]);

  useEffect(() => {
    if (isOpen) {
      fetchQueueStatus();
    }
  }, [isOpen, fetchQueueStatus]);

  // Auto-refresh every 30 seconds when dialog is open
  useEffect(() => {
    if (!isOpen) return;
    
    const interval = setInterval(fetchQueueStatus, 30000);
    return () => clearInterval(interval);
  }, [isOpen, fetchQueueStatus]);

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

  const totalPending = queueStats 
    ? queueStats.pending + queueStats.scheduled + queueStats.sending 
    : 0;

  const hasPendingItems = totalPending > 0;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 relative"
        >
          <Mail className="w-4 h-4" />
          <span className="hidden sm:inline">File InMails</span>
          {hasPendingItems && (
            <Badge 
              variant="default" 
              className="absolute -top-2 -right-2 h-5 min-w-[20px] px-1.5 text-[10px] bg-[#0077B5] hover:bg-[#0077B5]"
            >
              {totalPending}
            </Badge>
          )}
        </Button>
      </DialogTrigger>
      
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-[#0077B5]" />
            File d'attente InMails
          </DialogTitle>
          <DialogDescription>
            Suivi des InMails planifiés et envoyés
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4">
          {/* Stats Row */}
          {queueStats && (
            <div className="grid grid-cols-5 gap-2 text-center">
              <div className="p-2 rounded-lg bg-blue-50">
                <div className="text-lg font-bold text-blue-700">
                  {queueStats.pending + queueStats.scheduled}
                </div>
                <div className="text-xs text-blue-600">Planifiés</div>
              </div>
              <div className="p-2 rounded-lg bg-amber-50">
                <div className="text-lg font-bold text-amber-700">{queueStats.sending}</div>
                <div className="text-xs text-amber-600">En cours</div>
              </div>
              <div className="p-2 rounded-lg bg-green-50">
                <div className="text-lg font-bold text-green-700">{queueStats.sent}</div>
                <div className="text-xs text-green-600">Envoyés</div>
              </div>
              <div className="p-2 rounded-lg bg-red-50">
                <div className="text-lg font-bold text-red-700">{queueStats.failed}</div>
                <div className="text-xs text-red-600">Échoués</div>
              </div>
              <div className="p-2 rounded-lg bg-gray-50">
                <div className="text-lg font-bold text-gray-700">{queueStats.cancelled}</div>
                <div className="text-xs text-gray-600">Annulés</div>
              </div>
            </div>
          )}

          {/* Refresh Button */}
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchQueueStatus}
              disabled={loading}
              className="gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Actualiser
            </Button>
          </div>

          {/* Queue Items List */}
          <ScrollArea className="flex-1 border rounded-lg">
            {queueItems.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <Mail className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p>Aucun InMail dans la file d'attente</p>
              </div>
            ) : (
              <div className="divide-y">
                {queueItems.map((item) => (
                  <div key={item.id} className="p-3 hover:bg-muted/30">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm truncate">
                          {item.recipient_name || 'Candidat inconnu'}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {item.subject}
                        </div>
                        {item.recipient_headline && (
                          <div className="text-xs text-muted-foreground truncate mt-0.5">
                            {item.recipient_headline}
                          </div>
                        )}
                        <div className="flex items-center gap-1 mt-1 text-xs text-[#0077B5]">
                          <Calendar className="w-3 h-3" />
                          {item.status === 'sent' && item.sent_at 
                            ? formatScheduledTime(item.sent_at)
                            : formatScheduledTime(item.scheduled_at)
                          }
                        </div>
                        {item.error_message && (
                          <div className="text-xs text-red-500 mt-1">
                            {item.error_message}
                          </div>
                        )}
                      </div>
                      <div className="flex-shrink-0">
                        {getStatusBadge(item.status)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          {/* Cancel Button */}
          {hasPendingItems && (
            <Button
              variant="outline"
              onClick={handleCancelPending}
              className="text-red-500 border-red-200 hover:bg-red-50 hover:text-red-600"
            >
              Annuler les envois en attente
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
