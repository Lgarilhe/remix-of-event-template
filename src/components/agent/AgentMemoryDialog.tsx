import { useEffect, useState } from 'react';
import { Archive, Brain, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useOrganization } from '@/hooks/useOrganization';
import { useAgentMemoryActions, useAgentMemoryContext, useAgentMemoryProposals } from '@/hooks/useAgentMemories';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ErrorBox } from '@/components/layout/ErrorBox';
import { Spinner } from '@/components/ui/spinner';
import { AgentMemoryFields } from './AgentMemoryFields';
import { AgentMemoryProposalCard } from './AgentMemoryProposalCard';
import { AgentMemoryAutomation } from './AgentMemoryAutomation';
import {
  AGENT_MEMORY_EFFECT_LABEL, AGENT_MEMORY_KIND_LABEL, agentMemoryScopeLabel, canManageAgentMemory, isAgentMemoryDraftValid,
  type AgentMemory, type AgentMemoryDraft,
} from '@/types/agentMemory';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: string | null;
  projectTitle?: string | null;
  contextLoading?: boolean;
  contextError?: boolean;
  onRetryContext?: () => void;
}

function MemoryRow({ memory, canManage }: { memory: AgentMemory; canManage: boolean }) {
  const { orgType } = useOrganization();
  const actions = useAgentMemoryActions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const archive = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { await actions.archive(memory); setConfirmOpen(false); toast.success('Mémoire désactivée'); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'La mémoire n’a pas pu être désactivée.'); }
    finally { setBusy(false); }
  };
  return (
    <article aria-label={memory.activation_mode === 'automatic' ? 'Mémoire automatique' : 'Mémoire confirmée'} className="rounded-lg border border-border p-3 space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="secondary">{agentMemoryScopeLabel(memory.scope, orgType)}</Badge>
        <Badge variant="outline">{AGENT_MEMORY_KIND_LABEL[memory.kind]}</Badge>
        {memory.activation_mode === 'automatic' && <Badge variant="outline">Automatique</Badge>}
      </div>
      <p className="text-sm whitespace-pre-wrap break-words">{memory.content}</p>
      <p className="text-xs text-muted-foreground">Effets : {memory.effects.map((effect) => AGENT_MEMORY_EFFECT_LABEL[effect]).join(', ')}.</p>
      <p className="text-xs text-muted-foreground">{memory.activation_mode === 'automatic' ? 'Ajoutée automatiquement le' : 'Confirmée le'} {new Date(memory.activation_mode === 'automatic' ? memory.created_at : memory.confirmed_at).toLocaleDateString('fr-FR')} · version {memory.version}
        {memory.expires_at && ` · expire le ${new Date(memory.expires_at).toLocaleDateString('fr-FR')}`}</p>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      {canManage && <Button type="button" size="sm" variant="ghost" disabled={busy} aria-busy={busy} onClick={() => setConfirmOpen(true)}>
        {busy ? <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> : <Archive aria-hidden="true" className="h-3.5 w-3.5" />}Désactiver
      </Button>}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Désactiver cette mémoire ?</AlertDialogTitle>
            <AlertDialogDescription>L’assistant cessera de l’appliquer au niveau « {agentMemoryScopeLabel(memory.scope, orgType)} ». Pour la rétablir, il faudra créer et confirmer une nouvelle proposition.</AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-sm whitespace-pre-wrap break-words">{memory.content}</p>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Annuler</AlertDialogCancel>
            <AlertDialogAction disabled={busy} aria-busy={busy} onClick={(event) => { event.preventDefault(); void archive(); }}>
              {busy && <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />}Désactiver la mémoire
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}

export function AgentMemoryDialog({ open, onOpenChange, projectId = null, projectTitle, contextLoading = false, contextError = false, onRetryContext }: Props) {
  const { orgType } = useOrganization();
  const context = useAgentMemoryContext(projectId, open);
  const proposals = useAgentMemoryProposals({ projectId, enabled: open });
  const actions = useAgentMemoryActions();
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<AgentMemoryDraft>({ content: '', scope: 'user', kind: 'preference', effects: ['assistant'] });

  // Isolate drafts between missions and organization/context changes.
  const { organizationId } = useOrganization();
  useEffect(() => { setAdding(false); setError(null); setDraft({ content: '', scope: 'user', kind: 'preference', effects: ['assistant'] }); }, [projectId, organizationId, open]);

  const startAdding = () => {
    setDraft({ content: '', scope: projectId && context.data?.can_manage_project ? 'project' : 'user', kind: 'preference', effects: ['assistant'] });
    setError(null);
    setAdding(true);
  };
  const create = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await actions.createProposal(draft, projectId);
      setAdding(false);
      toast.success('Proposition créée', { description: 'Confirmez-la pour l’appliquer.' });
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'La proposition n’a pas pu être créée.'); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-2xl max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-7"><Brain aria-hidden="true" className="h-4 w-4" />{projectId ? orgType === 'enterprise' ? 'Mémoire appliquée au poste' : 'Mémoire appliquée à la mission' : 'Mémoire de l’assistant'}</DialogTitle>
          <DialogDescription>{projectId && projectTitle ? `${projectTitle}. ` : ''}Les mémoires actives guident l’assistant. Vos propositions restent privées jusqu’à leur confirmation.</DialogDescription>
        </DialogHeader>
        <AgentMemoryAutomation enabled={open} />
        <p className="text-xs text-muted-foreground">Une contrainte prime sur une préférence. Les règles de l’organisation encadrent celles de la mission ; vos préférences personnelles ne les remplacent pas.</p>
        {contextLoading ? <Spinner label="Chargement du contexte de la conversation" /> : contextError ? (
          <ErrorBox title="Le contexte de la conversation n’a pas pu être chargé." onRetry={onRetryContext} />
        ) : context.isPending ? <Spinner label="Chargement des mémoires" /> : context.isError ? (
          <ErrorBox title="Les mémoires n’ont pas pu être chargées." onRetry={() => void context.refetch()} />
        ) : (
          <>
            <section aria-label="Mémoires actives" className="space-y-2">
              <h3 className="text-sm font-semibold">Mémoires actives {context.data?.memories.length ? `(${context.data.memories.length})` : ''}</h3>
              {context.data?.memories.length ? context.data.memories.map((memory) => (
                <MemoryRow key={`${memory.id}:${memory.version}`} memory={memory} canManage={canManageAgentMemory(memory.scope, context.data)} />
              )) : <p className="text-sm text-muted-foreground">Aucune mémoire confirmée pour ce contexte.</p>}
            </section>
            <section aria-label="Propositions à confirmer" className="space-y-2">
              <h3 className="text-sm font-semibold">À confirmer</h3>
              {proposals.isPending ? <Spinner label="Chargement des propositions" /> : proposals.isError ? (
                <ErrorBox title="Les propositions n’ont pas pu être chargées." onRetry={() => void proposals.refetch()} />
              ) : proposals.data?.length ? proposals.data.map((proposal) => (
                <AgentMemoryProposalCard key={proposal.id} proposal={proposal} onReload={() => void proposals.refetch()} />
              )) : <p className="text-sm text-muted-foreground">Aucune proposition en attente.</p>}
            </section>
            {adding ? (
              <section aria-label="Ajouter une proposition" className="rounded-lg border border-border p-3 space-y-3">
                <h3 className="text-sm font-semibold">Proposer une mémoire</h3>
                <AgentMemoryFields value={draft} onChange={setDraft} projectId={projectId} orgType={orgType}
                  canManageOrganization={context.data?.can_manage_organization === true}
                  canManageProject={context.data?.can_manage_project === true} disabled={saving} />
                {error && <p role="alert" className="text-xs text-danger">{error}</p>}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" onClick={() => void create()} aria-busy={saving}
                    disabled={saving || !isAgentMemoryDraftValid(draft) || !canManageAgentMemory(draft.scope, context.data)}>
                    {saving && <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />}Créer la proposition
                  </Button>
                  <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setAdding(false)}>Annuler</Button>
                </div>
                <p className="text-xs text-muted-foreground">Vous pourrez relire et confirmer cette proposition avant son application.</p>
              </section>
            ) : <Button type="button" size="sm" variant="outline" onClick={startAdding}><Plus aria-hidden="true" className="h-4 w-4" />Proposer une mémoire</Button>}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
