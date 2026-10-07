import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useOrganization } from '@/hooks/useOrganization';
import { useAgentMemoryActions, useAgentMemoryContext } from '@/hooks/useAgentMemories';
import { Button } from '@/components/ui/button';
import { AgentMemoryFields } from './AgentMemoryFields';
import { AgentMemoryProposalActions, AgentMemoryProposalFrame, AgentMemorySummary } from './AgentMemoryPresentation';
import {
  canManageAgentMemory, isAgentMemoryDraftValid,
  type AgentMemoryDraft, type AgentMemoryProposal,
} from '@/types/agentMemory';

export function AgentMemoryProposalCard({ proposal, onReload }: { proposal: AgentMemoryProposal; onReload?: () => void }) {
  const { orgType } = useOrganization();
  const context = useAgentMemoryContext(proposal.project_id);
  const actions = useAgentMemoryActions();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<AgentMemoryDraft>({ content: proposal.content, scope: proposal.scope, kind: proposal.kind, effects: proposal.effects });
  const [busy, setBusy] = useState<'approve' | 'dismiss' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seenVersion = useRef(proposal.version);
  const canApprove = canManageAgentMemory(draft.scope, context.data);
  useEffect(() => {
    if (seenVersion.current === proposal.version) return;
    seenVersion.current = proposal.version;
    // A concurrent edit must not destroy the recruiter's unsaved correction.
    if (!editing) setDraft({ content: proposal.content, scope: proposal.scope, kind: proposal.kind, effects: proposal.effects });
  }, [proposal, editing]);

  const submit = async (action: 'approve' | 'dismiss') => {
    if (busy) return;
    setBusy(action);
    setError(null);
    try {
      if (action === 'approve') await actions.approve(proposal, draft);
      else await actions.dismiss(proposal);
      toast.success(action === 'approve' ? 'Mémoire confirmée' : 'Proposition ignorée');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'L’action a échoué. Réessayez.');
    } finally { setBusy(null); }
  };

  return (
    <AgentMemoryProposalFrame legacy={Boolean(proposal.legacy_insight_id)}>
      {editing ? (
        <AgentMemoryFields value={draft} onChange={setDraft} projectId={proposal.project_id} orgType={orgType} autoFocus
          canManageOrganization={context.data?.can_manage_organization === true}
          canManageProject={context.data?.can_manage_project === true} disabled={Boolean(busy)} />
      ) : (
        <AgentMemorySummary value={draft} orgType={orgType} variant="proposal" />
      )}
      {proposal.source_excerpt && (
        <details className="text-xs">
          <summary className="min-h-11 content-center cursor-pointer rounded-lg text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:min-h-0">{proposal.legacy_insight_id ? 'Voir l’ancien résumé' : 'Voir l’origine'}</summary>
          <p className="mt-1 whitespace-pre-wrap break-words text-foreground-secondary">{proposal.source_excerpt}</p>
        </details>
      )}
      <p className="text-xs text-muted-foreground">Rien n’est appliqué avant votre confirmation.</p>
      {context.isError && <p role="alert" className="text-xs text-danger">Les droits n’ont pas pu être chargés. <Button type="button" variant="link" size="sm" className="min-h-11 md:min-h-0" onClick={() => void context.refetch()}>Réessayer</Button></p>}
      {!context.isPending && !context.isError && !canApprove && <p className="text-xs text-muted-foreground">La validation à ce niveau est réservée aux personnes autorisées à gérer ce recrutement ou l’organisation.</p>}
      {!isAgentMemoryDraftValid(draft) && !editing && <p className="text-xs text-muted-foreground">Modifiez cette proposition pour choisir un niveau et des utilisations compatibles.</p>}
      {error && <div role="alert" className="text-xs text-danger">{error}
        {onReload && <Button type="button" variant="link" size="sm" className="min-h-11 md:min-h-0" disabled={Boolean(busy)} onClick={onReload}>Recharger la proposition</Button>}
      </div>}
      <AgentMemoryProposalActions editing={editing} busy={busy} disabled={Boolean(busy)}
        approveDisabled={context.isPending || context.isError || !canApprove || !isAgentMemoryDraftValid(draft)}
        onApprove={() => void submit('approve')} onEdit={() => setEditing((current) => !current)} onDismiss={() => void submit('dismiss')} />
    </AgentMemoryProposalFrame>
  );
}
