import React, { useState, useEffect, useCallback } from 'react';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Mail, 
  Clock, 
  CheckCircle, 
  XCircle, 
  Loader2,
  RefreshCw,
  Calendar,
  Ban,
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

const STAT_BLOCKS: { key: string; label: string; getValue: (s: QueueStats) => number; color: string; iconColor: string }[] = [
  { key: 'planned', label: 'PLANIFIÉS', getValue: s => s.pending + s.scheduled, color: 'border-foreground/20', iconColor: 'text-foreground' },
  { key: 'sending', label: 'EN COURS', getValue: s => s.sending, color: 'border-foreground/20', iconColor: 'text-foreground' },
  { key: 'sent', label: 'ENVOYÉS', getValue: s => s.sent, color: 'border-emerald-500', iconColor: 'text-emerald-500' },
  { key: 'failed', label: 'ÉCHOUÉS', getValue: s => s.failed, color: 'border-destructive', iconColor: 'text-destructive' },
  { key: 'cancelled', label: 'ANNULÉS', getValue: s => s.cancelled, color: 'border-muted-foreground/40', iconColor: 'text-muted-foreground' },
];

export const InMailQueueStatus: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(false);

  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const fetchQueueStatus = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await invokeEdgeFunction<{ stats?: QueueStats; items?: QueueItem[] }>('process-inmail-queue', {
        action: 'status',
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

  useEffect(() => {
    fetchQueueStatus();
  }, [fetchQueueStatus]);

  useEffect(() => {
    if (isOpen) fetchQueueStatus();
  }, [isOpen, fetchQueueStatus]);

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
      const { data, error } = await invokeEdgeFunction<{ cancelled?: number }>('process-inmail-queue', {
        action: 'cancel', item_ids: pendingIds,
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

  const getStatusIndicator = (status: string) => {
    switch (status) {
      case 'pending':
      case 'scheduled':
        return <Clock className="w-3.5 h-3.5 text-muted-foreground" />;
      case 'sending':
        return <Loader2 className="w-3.5 h-3.5 text-foreground animate-spin" />;
      case 'sent':
        return <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />;
      case 'failed':
        return <XCircle className="w-3.5 h-3.5 text-destructive" />;
      case 'cancelled':
        return <Ban className="w-3.5 h-3.5 text-muted-foreground" />;
      default:
        return <Clock className="w-3.5 h-3.5 text-muted-foreground" />;
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
          className="gap-2 relative rounded-none border-foreground/20 hover:bg-[hsl(var(--brutal-accent)/0.1)] transition-colors"
        >
          <Mail className="w-4 h-4" />
          <span className="hidden sm:inline text-xs uppercase tracking-wider font-semibold">File InMails</span>
          {hasPendingItems && (
            <span className="absolute -top-1.5 -right-1.5 h-5 min-w-[20px] px-1 flex items-center justify-center text-[10px] font-bold bg-foreground text-background rounded-none border border-foreground">
              {totalPending}
            </span>
          )}
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col rounded-none border border-foreground bg-background p-0">
        {/* Header */}
        <div className="border-b border-foreground px-6 py-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3 text-lg uppercase tracking-wider font-bold">
              <Mail className="w-5 h-5" />
              File d'attente InMails
            </DialogTitle>
            <DialogDescription className="text-xs uppercase tracking-wider text-muted-foreground mt-1">
              Suivi des InMails planifiés et envoyés
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Stats Row */}
          {queueStats && (
            <div className="grid grid-cols-5 gap-0 border-b border-foreground">
              {STAT_BLOCKS.map((block) => {
                const value = block.getValue(queueStats);
                return (
                  <div
                    key={block.key}
                    className={`flex flex-col items-center justify-center py-4 border-r last:border-r-0 border-foreground/10 ${value > 0 ? '' : 'opacity-40'}`}
                  >
                    <span className={`text-2xl font-black tabular-nums ${block.iconColor}`}>
                      {value}
                    </span>
                    <span className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground font-semibold mt-1">
                      {block.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Actions bar */}
          <div className="flex items-center justify-between px-6 py-3 border-b border-foreground/10">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {queueItems.length} élément{queueItems.length !== 1 ? 's' : ''}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchQueueStatus}
              disabled={loading}
              className="gap-2 rounded-none text-xs uppercase tracking-wider h-7 px-3 hover:bg-[hsl(var(--brutal-accent)/0.1)]"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Actualiser
            </Button>
          </div>

          {/* Queue Items List */}
          <ScrollArea className="flex-1">
            {queueItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Mail className="w-10 h-10 mb-3 opacity-15" strokeWidth={1} />
                <p className="text-xs uppercase tracking-wider">Aucun InMail dans la file</p>
              </div>
            ) : (
              <div className="divide-y divide-foreground/5">
                {queueItems.map((item) => (
                  <div
                    key={item.id}
                    className="px-6 py-3.5 hover:bg-[hsl(var(--brutal-accent)/0.04)] transition-colors group"
                  >
                    <div className="flex items-start gap-3">
                      {/* Status icon */}
                      <div className="mt-0.5 flex-shrink-0">
                        {getStatusIndicator(item.status)}
                      </div>

                      {/* Content */}
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-sm truncate">
                          {item.recipient_name || 'Candidat inconnu'}
                        </div>
                        <div className="text-xs text-muted-foreground truncate mt-0.5">
                          {item.subject}
                        </div>
                        {item.recipient_headline && (
                          <div className="text-[11px] text-muted-foreground/70 truncate mt-0.5">
                            {item.recipient_headline}
                          </div>
                        )}
                        {item.error_message && (
                          <div className="text-[11px] text-destructive mt-1 truncate">
                            {item.error_message}
                          </div>
                        )}
                      </div>

                      {/* Timestamp */}
                      <div className="flex items-center gap-1 text-[11px] text-muted-foreground flex-shrink-0 tabular-nums">
                        <Calendar className="w-3 h-3" />
                        {item.status === 'sent' && item.sent_at
                          ? formatScheduledTime(item.sent_at)
                          : formatScheduledTime(item.scheduled_at)
                        }
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          {/* Cancel Footer */}
          {hasPendingItems && (
            <div className="border-t border-foreground px-6 py-4">
              <Button
                variant="outline"
                onClick={handleCancelPending}
                className="w-full rounded-none border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground uppercase tracking-wider text-xs font-semibold h-9"
              >
                <Ban className="w-3.5 h-3.5 mr-2" />
                Annuler les envois en attente
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
