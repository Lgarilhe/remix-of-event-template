import { useEffect, useRef, useState } from 'react';
import { Brain, Check, Loader2, Pencil, X } from 'lucide-react';
import { toast } from 'sonner';
import { useOrganization } from '@/hooks/useOrganization';
import { useAgentMemoryActions, useAgentMemoryContext } from '@/hooks/useAgentMemories';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AgentMemoryFields } from './AgentMemoryFields';
import {
  AGENT_MEMORY_EFFECT_LABEL, AGENT_MEMORY_KIND_LABEL, agentMemoryScopeLabel, canManageAgentMemory, isAgentMemoryDraftValid,
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
    <article aria-label="Proposition de mémoire" className="rounded-lg border border-border bg-card p-3 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium"><Brain aria-hidden="true" className="h-4 w-4 shrink-0" />À garder en mémoire ?</div>
      {proposal.legacy_insight_id && <p className="text-xs text-muted-foreground">Ancienne mémoire automatique : à vérifier avant de la confirmer.</p>}
      {editing ? (
        <AgentMemoryFields value={draft} onChange={setDraft} projectId={proposal.project_id} orgType={orgType}
          canManageOrganization={context.data?.can_manage_organization === true}
          canManageProject={context.data?.can_manage_project === true} disabled={Boolean(busy)} />
      ) : (
        <>
          <p className="text-sm whitespace-pre-wrap break-words">{draft.content}</p>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="secondary">{agentMemoryScopeLabel(draft.scope, orgType)}</Badge>
            <Badge variant="outline">{AGENT_MEMORY_KIND_LABEL[draft.kind]}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">Effet : {draft.effects.map((effect) => AGENT_MEMORY_EFFECT_LABEL[effect]).join(', ')}.</p>
        </>
      )}
      {proposal.source_excerpt && (
        <details className="text-xs text-muted-foreground">
          <summary className="min-h-11 content-center cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0">{proposal.legacy_insight_id ? 'Voir l’ancien résumé' : 'Voir l’origine'}</summary>
          <p className="mt-1 whitespace-pre-wrap break-words">{proposal.source_excerpt}</p>
        </details>
      )}
      <p className="text-xs text-muted-foreground">Rien n’est appliqué avant votre confirmation.</p>
      {context.isError && <p role="alert" className="text-xs text-danger">Les droits n’ont pas pu être chargés. <Button type="button" variant="link" size="sm" className="min-h-11 sm:min-h-0" onClick={() => void context.refetch()}>Réessayer</Button></p>}
      {!context.isPending && !context.isError && !canApprove && <p className="text-xs text-muted-foreground">La validation à ce niveau est réservée à la personne responsable de la mission ou à un administrateur.</p>}
      {!isAgentMemoryDraftValid(draft) && !editing && <p className="text-xs text-muted-foreground">Modifiez cette proposition pour choisir les effets disponibles.</p>}
      {error && <div role="alert" className="text-xs text-danger">{error}
        {onReload && <Button type="button" variant="link" size="sm" className="min-h-11 sm:min-h-0" disabled={Boolean(busy)} onClick={onReload}>Recharger la proposition</Button>}
      </div>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" className="min-h-11 sm:min-h-0" onClick={() => void submit('approve')}
          disabled={Boolean(busy) || context.isPending || context.isError || !canApprove || !isAgentMemoryDraftValid(draft)} aria-busy={busy === 'approve'}>
          {busy === 'approve' ? <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> : <Check aria-hidden="true" className="h-3.5 w-3.5" />}
          {editing ? 'Garder les modifications' : 'Garder'}
        </Button>
        <Button type="button" size="sm" variant="ghost" className="min-h-11 sm:min-h-0" disabled={Boolean(busy)} onClick={() => setEditing((current) => !current)}>
          <Pencil aria-hidden="true" className="h-3.5 w-3.5" />{editing ? 'Fermer l’édition' : 'Modifier'}
        </Button>
        <Button type="button" size="sm" variant="ghost" className="min-h-11 sm:min-h-0" disabled={Boolean(busy)} onClick={() => void submit('dismiss')} aria-busy={busy === 'dismiss'}>
          {busy === 'dismiss' ? <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> : <X aria-hidden="true" className="h-3.5 w-3.5" />}Ignorer
        </Button>
      </div>
    </article>
  );
}
