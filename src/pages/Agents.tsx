import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { BrutalLoader } from '@/components/ui/brutal-loader';
import { useOrganization } from '@/hooks/useOrganization';
import { Bot, Play, Pause, CheckCircle, Clock, AlertCircle, ChevronRight, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAgent } from '@/contexts/AgentContext';

const STATUS_CONFIG: Record<string, { label: string; icon: typeof Play; cls: string }> = {
  calibrating: { label: 'Calibration', icon: Clock, cls: 'text-warning bg-warning/10 border-warning/30' },
  plan_proposed: { label: 'Plan proposé', icon: AlertCircle, cls: 'text-primary bg-primary/10 border-primary/30' },
  running: { label: 'En cours', icon: Play, cls: 'text-accent bg-accent/10 border-accent/30' },
  completed: { label: 'Terminé', icon: CheckCircle, cls: 'text-muted-foreground bg-muted border-border' },
  paused: { label: 'En pause', icon: Pause, cls: 'text-warning bg-warning/10 border-warning/30' },
  failed: { label: 'Erreur', icon: AlertCircle, cls: 'text-destructive bg-destructive/10 border-destructive/30' },
};

const AgentsPage = () => {
  const navigate = useNavigate();
  const { organizationId } = useOrganization();
  const { openAgent } = useAgent();

  const { data: conversations, isLoading, isError } = useQuery({
    queryKey: ['agent-conversations', organizationId],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('agent_conversations')
        .select('*')
        .eq('organization_id', organizationId)
        .is('archived_at', null)
        .order('updated_at', { ascending: false }) as any);
      if (error) throw error;
      return data || [];
    },
    enabled: !!organizationId,
    staleTime: 30_000,
  });

  const activeAgents = useMemo(() =>
    (conversations || []).filter((c: any) => c.status === 'running'),
  [conversations]);

  const otherAgents = useMemo(() =>
    (conversations || []).filter((c: any) => c.status !== 'running'),
  [conversations]);

  if (isLoading) {
    return (
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6">
        <BrutalLoader variant="default" rows={3} messages={['Chargement des agents...']} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6">
        <div className="border border-destructive/30 bg-destructive/10 p-6 text-center">
          <p className="text-sm text-destructive">Erreur lors du chargement des agents.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-xl font-bold text-foreground uppercase tracking-tight">Agents IA</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Vos agents de sourcing autonomes
              </p>
            </div>
            <button
              onClick={() => navigate('/missions')}
              className="flex items-center gap-2 h-9 px-4 text-xs font-medium border border-border bg-foreground text-background hover:bg-foreground/90 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Nouvel agent
            </button>
          </div>

          {/* Active agents */}
          {activeAgents.length > 0 && (
            <div className="mb-6">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                Agents actifs ({activeAgents.length})
              </p>
              <div className="space-y-2">
                {activeAgents.map((agent: any) => (
                  <AgentCard key={agent.id} agent={agent} onOpen={openAgent} />
                ))}
              </div>
            </div>
          )}

          {/* Other agents */}
          {otherAgents.length > 0 && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
                Historique ({otherAgents.length})
              </p>
              <div className="space-y-2">
                {otherAgents.map((agent: any) => (
                  <AgentCard key={agent.id} agent={agent} onOpen={openAgent} />
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {(!conversations || conversations.length === 0) && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-14 h-14 border border-border flex items-center justify-center mb-4">
                <Bot className="w-6 h-6 text-muted-foreground" />
              </div>
              <h2 className="text-sm font-bold uppercase tracking-wider mb-2">Aucun agent</h2>
              <p className="text-xs text-muted-foreground max-w-md mb-6">
                Créez un agent depuis une mission pour lancer le sourcing autonome.
              </p>
              <button
                onClick={() => navigate('/missions')}
                className="h-9 px-5 text-xs font-medium border border-border bg-foreground text-background"
              >
                Aller aux missions
              </button>
            </div>
          )}
      </div>
    </div>
  );
};

function AgentCard({ agent, onOpen }: { agent: any; onOpen: (jobId?: string) => void }) {
  const config = STATUS_CONFIG[agent.status] || STATUS_CONFIG.calibrating;
  const Icon = config.icon;
  const results = agent.results_summary || {};
  const goCount = results.go_count || 0;
  const totalScanned = results.total_scanned || 0;
  const title = agent.job_title || agent.search_config?.summary || 'Agent sans titre';
  const updatedAt = agent.updated_at ? new Date(agent.updated_at) : null;

  return (
    <button
      onClick={() => onOpen(agent.job_id || undefined)}
      className="w-full flex items-center gap-4 p-4 border border-border bg-card hover:bg-muted/30 transition-colors text-left rounded-lg group"
    >
      <div className="w-10 h-10 flex items-center justify-center border border-border shrink-0 rounded-lg bg-muted/30">
        <Bot className="w-5 h-5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="text-sm font-semibold text-foreground truncate">{title}</p>
          <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium border rounded-full shrink-0", config.cls)}>
            <Icon className="w-2.5 h-2.5" />
            {config.label}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {goCount > 0 && <span className="font-medium text-accent">{goCount} shortlistés</span>}
          {totalScanned > 0 && <span>{totalScanned} scannés</span>}
          {updatedAt && (
            <span>{updatedAt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
          )}
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-foreground transition-colors shrink-0" />
    </button>
  );
}

export default AgentsPage;
