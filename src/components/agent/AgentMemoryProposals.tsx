import { useAgentMemoryAutomation, useAgentMemoryProposals } from '@/hooks/useAgentMemories';
import { Button } from '@/components/ui/button';
import { AgentMemoryProposalCard } from './AgentMemoryProposalCard';
import { AgentMemoryAutomation } from './AgentMemoryAutomation';

export function AgentMemoryProposals({ conversationId, onManageMemory }: { conversationId: string | null; onManageMemory: () => void }) {
  const query = useAgentMemoryProposals({ conversationId, conversationOnly: true });
  const automation = useAgentMemoryAutomation();
  const hasAutomation = automation.data?.mode === 'automatic' || automation.data?.can_suggest === true;
  if (!hasAutomation && !query.isError && !query.data?.length) return null;
  return (
    <section aria-label="Propositions de mémoire" className="max-h-[38vh] shrink-0 overflow-y-auto border-b border-border p-3 space-y-2">
      {/* One height budget for invitation and cards keeps the composer accessible. */}
      {hasAutomation && <AgentMemoryAutomation variant="invitation" onManage={onManageMemory} />}
      {query.isError && <div role="alert" className="text-xs text-muted-foreground">
        Les propositions de mémoire n’ont pas pu être chargées.
        <Button type="button" variant="link" size="sm" onClick={() => void query.refetch()}>Réessayer</Button>
      </div>}
      {query.data?.map((proposal) => <AgentMemoryProposalCard key={proposal.id} proposal={proposal} onReload={() => void query.refetch()} />)}
    </section>
  );
}
