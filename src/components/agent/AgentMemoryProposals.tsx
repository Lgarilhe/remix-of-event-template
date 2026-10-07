import { useAgentMemoryProposals } from '@/hooks/useAgentMemories';
import { Button } from '@/components/ui/button';
import { AgentMemoryProposalCard } from './AgentMemoryProposalCard';

export function AgentMemoryProposals({ conversationId }: { conversationId: string | null }) {
  const query = useAgentMemoryProposals({ conversationId, conversationOnly: true });
  if (!conversationId) return null;
  if (query.isError) return (
    <div role="alert" className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
      Les propositions de mémoire n’ont pas pu être chargées.
      <Button type="button" variant="link" size="sm" onClick={() => void query.refetch()}>Réessayer</Button>
    </div>
  );
  if (!query.data?.length) return null;
  return (
    <section aria-label="Propositions de mémoire" className="max-h-[38vh] shrink-0 overflow-y-auto border-b border-border p-3 space-y-2">
      {query.data.map((proposal) => <AgentMemoryProposalCard key={proposal.id} proposal={proposal} onReload={() => void query.refetch()} />)}
    </section>
  );
}
