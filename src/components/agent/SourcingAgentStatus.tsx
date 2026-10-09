import { Pause } from 'lucide-react';
import { useSourcingAgent } from '@/hooks/useSourcingAgent';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorBox } from '@/components/layout/ErrorBox';
import { Spinner } from '@/components/ui/spinner';
import { sourcingAgentDate, sourcingAgentReason, sourcingAgentStateLabel } from '@/types/sourcingAgent';
import { AgentOrb } from './AgentOrb';

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
  if (agentQuery.isError && !agentQuery.data) return <ErrorBox title="L’état de l’agent de sourcing n’a pas pu être chargé." onRetry={() => void agentQuery.refetch()} />;
  const agent = agentQuery.data?.agent;
  if (!agent) return <section aria-label="Agent de sourcing" className="mb-4 grid grid-cols-[48px_1fr] sm:flex sm:flex-wrap sm:items-center gap-3 rounded-xl border border-border bg-card p-4">
    <AgentOrb size="md" tone="amber" className="self-start sm:self-auto" />
    <div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">Un agent pour cette mission</h2><p className="mt-1 text-xs text-muted-foreground">Calibrez cinq profils, puis activez une recherche qui suit vos critères.</p></div>
    <Button type="button" variant="outline" className="min-h-11 col-span-2 w-full sm:w-auto" onClick={onManage}>Configurer l’agent</Button>
  </section>;
  const canPause = agent.last_reason !== 'SCORING_UNCERTAIN' && ['active', 'calibrating', 'awaiting_review', 'blocked'].includes(agent.status);
  const reason = sourcingAgentReason(agent.last_reason);
  const nextDate = sourcingAgentDate(agent.next_run_at);
  const pending = !agentQuery.data?.requires_refresh ? agentQuery.data?.candidates.filter((candidate) => candidate.state === 'proposed' && !candidate.decision && candidate.context_key === agentQuery.data.context_key).length ?? 0 : 0;
  return <section aria-label="Agent de sourcing" className="space-y-2 border-b border-border py-3">
    <div className="flex flex-wrap items-center gap-2">
      <AgentOrb size="sm" tone={agent.status === 'active' ? 'teal' : agent.status === 'calibrating' || agent.status === 'awaiting_review' ? 'violet' : agent.status === 'draft' || agent.status === 'blocked' ? 'amber' : 'slate'} />
      <span className="text-sm font-medium">Agent de sourcing</span>
      <Badge variant={agent.status === 'blocked' || agent.status === 'awaiting_review' ? 'warning' : agent.status === 'active' ? 'info' : 'muted'}>{sourcingAgentStateLabel(agent)}</Badge>
      {pending > 0 && <span className="text-xs text-muted-foreground">{pending} profil{pending > 1 ? 's' : ''} à relire</span>}
      <div className="flex basis-full flex-wrap gap-1 sm:ml-auto sm:basis-auto">
        {canPause && <Button type="button" size="sm" variant="ghost" className="max-sm:min-h-11 text-muted-foreground" disabled={agentQuery.isSaving} aria-busy={agentQuery.pendingAction === 'pause'} onClick={() => { void agentQuery.mutate({ action: 'pause' }).catch(() => {}); }}><Pause className="h-3.5 w-3.5" aria-hidden="true" />Mettre en pause</Button>}
        <Button type="button" size="sm" variant="outline" className="max-sm:min-h-11" onClick={onManage}>Gérer l’agent</Button>
      </div>
    </div>
    {reason ? <p className="text-xs text-muted-foreground">{reason}</p> : nextDate && ['active', 'calibrating'].includes(agent.status) ? <p className="text-xs text-muted-foreground">Prochain passage : {nextDate}</p> : null}
    {agentQuery.actionError && <p role="alert" className="text-xs text-danger">{agentQuery.actionError}</p>}
    {agentQuery.isError && <ErrorBox title="L’actualisation a échoué. Dernier état connu affiché." onRetry={() => void agentQuery.refetch()} />}
  </section>;
}
