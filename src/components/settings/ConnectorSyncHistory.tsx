import React from 'react';
import { useConnectorSyncRuns, useTriggerSync, SyncRun } from '@/hooks/useConnectors';
import { RefreshCw, CheckCircle2, AlertCircle, Clock, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

interface ConnectorSyncHistoryProps {
  instanceId: string;
  connectorName: string;
}

const STATUS_CONFIG: Record<string, { label: string; icon: typeof CheckCircle2; color: string }> = {
  pending: { label: 'En attente', icon: Clock, color: 'text-muted-foreground' },
  running: { label: 'En cours', icon: Loader2, color: 'text-foreground' },
  success: { label: 'Réussi', icon: CheckCircle2, color: 'text-foreground' },
  partial: { label: 'Partiel', icon: AlertCircle, color: 'text-amber-600' },
  failed: { label: 'Échoué', icon: AlertCircle, color: 'text-red-600' },
};

export const ConnectorSyncHistory: React.FC<ConnectorSyncHistoryProps> = ({ instanceId, connectorName }) => {
  const { data: runs = [], isLoading } = useConnectorSyncRuns(instanceId);
  const triggerSync = useTriggerSync();

  const handleSync = async () => {
    try {
      await triggerSync.mutateAsync({ instanceId, entityType: 'all' });
    } catch {
      // Error toasted
    }
  };

  return (
    <div className="border border-foreground/20 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Historique de synchronisation — {connectorName}
        </p>
        <button
          onClick={handleSync}
          disabled={triggerSync.isPending}
          className="flex items-center gap-1 h-[28px] px-3 text-[9px] font-bold uppercase tracking-wider border border-foreground/20 text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
        >
          {triggerSync.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Synchroniser
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <div className="w-4 h-4 border-2 border-foreground/20 border-t-foreground animate-spin" />
        </div>
      ) : runs.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">Aucune synchronisation effectuée.</p>
      ) : (
        <div className="space-y-1.5">
          {runs.slice(0, 10).map(run => {
            const cfg = STATUS_CONFIG[run.status] || STATUS_CONFIG.pending;
            const Icon = cfg.icon;
            return (
              <div key={run.id} className="flex items-center gap-3 px-3 py-2 border border-foreground/10">
                <Icon className={cn("w-3.5 h-3.5 shrink-0", cfg.color, run.status === 'running' && "animate-spin")} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-medium text-foreground">{run.entity_type}</span>
                    <span className={cn("text-[9px] font-bold uppercase tracking-wider", cfg.color)}>{cfg.label}</span>
                  </div>
                  {run.status === 'success' || run.status === 'partial' ? (
                    <p className="text-[9px] text-muted-foreground">
                      {run.records_processed} traités · {run.records_created} créés · {run.records_updated} mis à jour
                      {run.records_failed > 0 && ` · ${run.records_failed} échoués`}
                    </p>
                  ) : run.error_message ? (
                    <p className="text-[9px] text-red-500 truncate">{run.error_message}</p>
                  ) : null}
                </div>
                <span className="text-[9px] text-muted-foreground shrink-0">
                  {formatDistanceToNow(new Date(run.started_at), { addSuffix: true, locale: fr })}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
