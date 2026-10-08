import { Pause } from 'lucide-react';
import { useSourcingAgent } from '@/hooks/useSourcingAgent';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorBox } from '@/components/layout/ErrorBox';
import { Spinner } from '@/components/ui/spinner';
import { sourcingAgentDate, sourcingAgentReason, sourcingAgentStateLabel } from '@/types/sourcingAgent';

interface Props {
  projectId: string;
  projectName?: string;
  missionStatus?: string;
  onManage: () => void;
}

export function SourcingAgentStatus({ projectId, missionStatus, onManage }: Props) {
  const agentQuery = useSourcingAgent(projectId, { enabled: missionStatus !== 'archived' });
  if (missionStatus === 'archived') return null;
  if (agentQuery.isPending) return <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground"><Spinner size="sm" label="Chargement de l’agent de sourcing" />Agent de sourcing</div>;
  if (agentQuery.isError) return <ErrorBox title="L’état de l’agent de sourcing n’a pas pu être chargé." onRetry={() => void agentQuery.refetch()} />;
  const agent = agentQuery.data?.agent;
  if (!agent) return null;
  const canPause = agent.last_reason !== 'SCORING_UNCERTAIN' && ['active', 'calibrating', 'awaiting_review', 'blocked'].includes(agent.status);
  const reason = sourcingAgentReason(agent.last_reason);
  const nextDate = sourcingAgentDate(agent.next_run_at);
  const pending = agentQuery.data?.candidates.filter((candidate) => candidate.state === 'proposed' && !candidate.decision).length ?? 0;
  return <section aria-label="Agent de sourcing" className="space-y-2 border-b border-border py-3">
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium">Agent de sourcing</span>
      <Badge variant={agent.status === 'blocked' || agent.status === 'awaiting_review' ? 'warning' : agent.status === 'active' ? 'info' : 'muted'}>{sourcingAgentStateLabel(agent)}</Badge>
      {pending > 0 && <span className="text-xs text-muted-foreground">{pending} profil{pending > 1 ? 's' : ''} à relire</span>}
      <div className="ml-auto flex flex-wrap gap-1">
        {canPause && <Button type="button" size="sm" variant="ghost" className="max-sm:min-h-11 text-muted-foreground" disabled={agentQuery.isSaving} aria-busy={agentQuery.pendingAction === 'pause'} onClick={() => { void agentQuery.mutate({ action: 'pause' }).catch(() => {}); }}><Pause className="h-3.5 w-3.5" aria-hidden="true" />Mettre en pause</Button>}
        <Button type="button" size="sm" variant="outline" className="max-sm:min-h-11" onClick={onManage}>Gérer l’agent</Button>
      </div>
    </div>
    {reason ? <p className="text-xs text-muted-foreground">{reason}</p> : nextDate && ['active', 'calibrating'].includes(agent.status) ? <p className="text-xs text-muted-foreground">Prochain passage : {nextDate}</p> : null}
    {agentQuery.actionError && <p role="alert" className="text-xs text-danger">{agentQuery.actionError}</p>}
  </section>;
}
