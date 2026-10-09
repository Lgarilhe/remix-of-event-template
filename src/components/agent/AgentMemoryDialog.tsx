import { useEffect, useRef, useState } from 'react';
import { Archive, Brain, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useAgentMemoryIntroduction } from '@/hooks/useAgentMemoryIntroduction';
import { useAgentMemoryActions, useAgentMemoryContext, useAgentMemoryProposals } from '@/hooks/useAgentMemories';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ErrorBox } from '@/components/layout/ErrorBox';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/layout/EmptyState';
import { AgentMemoryFields } from './AgentMemoryFields';
import { AgentMemoryProposalCard } from './AgentMemoryProposalCard';
import { AgentMemoryConfirmedFrame, AgentMemorySummary } from './AgentMemoryPresentation';
import { AgentMemoryAutomation } from './AgentMemoryAutomation';
import { AgentMemoryScopeGuide } from './AgentMemoryScopeGuide';
import { AgentMemoryIntro } from './AgentMemoryIntro';
import {
  agentMemoryScopeLabel, canManageAgentMemory, isAgentMemoryDraftValid,
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
  const archiveTitleRef = useRef<HTMLHeadingElement>(null);
  const archive = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { await actions.archive(memory); setConfirmOpen(false); toast.success('Mémoire désactivée'); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'La mémoire n’a pas pu être désactivée.'); }
    finally { setBusy(false); }
  };
  return (
    <AgentMemoryConfirmedFrame automatic={memory.activation_mode === 'automatic'}>
      <AgentMemorySummary value={memory} orgType={orgType} variant="confirmed" automatic={memory.activation_mode === 'automatic'}
        date={{ at: memory.activation_mode === 'automatic' ? memory.created_at : memory.confirmed_at, expiresAt: memory.expires_at }} />
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      {canManage && <Button type="button" size="sm" variant="ghost" className="min-h-11 text-muted-foreground md:min-h-0" disabled={busy} aria-busy={busy} onClick={() => setConfirmOpen(true)}>
        {busy ? <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> : <Archive aria-hidden="true" className="h-3.5 w-3.5" />}Désactiver
      </Button>}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="w-[calc(100%-2rem)] max-h-[85dvh] overflow-y-auto" onOpenAutoFocus={(event) => {
          event.preventDefault();
          archiveTitleRef.current?.focus();
        }}>
          <AlertDialogHeader>
            <AlertDialogTitle ref={archiveTitleRef} tabIndex={-1}>Désactiver cette mémoire ?</AlertDialogTitle>
            <AlertDialogDescription>L’assistant cessera de l’appliquer au niveau « {agentMemoryScopeLabel(memory.scope, orgType)} ». Pour la rétablir, il faudra créer et confirmer une nouvelle proposition.</AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-sm whitespace-pre-wrap break-words">{memory.content}</p>
          {memory.effects.some((effect) => effect === 'search' || effect === 'scoring') && <p className="text-sm text-foreground-secondary">La désactivation s’applique aux prochaines recherches et évaluations. Les résultats déjà produits ne sont pas recalculés automatiquement.</p>}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11 md:min-h-0" disabled={busy}>Annuler</AlertDialogCancel>
            <AlertDialogAction className="min-h-11 md:min-h-0" disabled={busy} aria-busy={busy} onClick={(event) => { event.preventDefault(); void archive(); }}>
              {busy && <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />}Désactiver la mémoire
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AgentMemoryConfirmedFrame>
  );
}

export function AgentMemoryDialog({ open, onOpenChange, projectId = null, projectTitle, contextLoading = false, contextError = false, onRetryContext }: Props) {
  const { orgType, organizationId } = useOrganization();
  const { user } = useAuthReady();
  const introduction = useAgentMemoryIntroduction(organizationId, user?.id);
  const [replayKey, setReplayKey] = useState<string | null>(null);
  const [closingIntroKey, setClosingIntroKey] = useState<string | null>(null);
  const showingIntroduction = Boolean(introduction.key) && (introduction.shouldIntroduce || replayKey === introduction.key
    || (!open && closingIntroKey === introduction.key));
  const titleRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const context = useAgentMemoryContext(projectId, open);
  const proposals = useAgentMemoryProposals({ projectId, enabled: open });
  const actions = useAgentMemoryActions();
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<AgentMemoryDraft>({ content: '', scope: 'user', kind: 'preference', effects: ['assistant'] });

  // Isolate drafts between missions and organization/context changes.
  useEffect(() => { setAdding(false); setError(null); setDraft({ content: '', scope: 'user', kind: 'preference', effects: ['assistant'] }); }, [projectId, organizationId, open]);
  useEffect(() => {
    setReplayKey(null);
    if (open) setClosingIntroKey(null);
  }, [organizationId, user?.id, open]);
  useEffect(() => {
    if (!open) return;
    // Keep focus in the dialog when the introduction replaces its action buttons.
    const frame = requestAnimationFrame(() => titleRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, showingIntroduction]);

  const finishIntroduction = () => {
    introduction.markSeen();
    setReplayKey(null);
  };
  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen) {
      // Keep the outgoing view intact during the dialog's 200 ms exit transition.
      setClosingIntroKey(showingIntroduction ? introduction.key : null);
      if (showingIntroduction) finishIntroduction();
    }
    onOpenChange(nextOpen);
  };

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
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className={`w-[calc(100%-2rem)] max-w-2xl max-h-[85dvh] max-md:[&>button:last-child]:min-h-11 max-md:[&>button:last-child]:min-w-11 ${showingIntroduction ? 'max-md:p-4 flex flex-col overflow-hidden' : 'overflow-y-auto'}`}
        onOpenAutoFocus={(event) => {
          openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          event.preventDefault();
          titleRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (openerRef.current?.isConnected) openerRef.current.focus();
        }}>
        <DialogHeader className="shrink-0 text-left">
          <DialogTitle ref={titleRef} tabIndex={-1} className="flex items-center gap-2 pr-7">{!showingIntroduction && <Brain aria-hidden="true" className="h-4 w-4 shrink-0" />}{showingIntroduction ? 'Découvrir la mémoire' : projectId ? orgType === 'enterprise' ? 'Mémoire appliquée au poste' : 'Mémoire appliquée à la mission' : 'Mémoire de l’assistant'}</DialogTitle>
          <DialogDescription>{showingIntroduction ? 'Vous décidez ce qui est retenu.' : <>{projectId && projectTitle ? `${projectTitle}. ` : ''}Les mémoires actives s’appliquent selon les utilisations choisies. Vos propositions restent privées jusqu’à leur confirmation.</>}</DialogDescription>
        </DialogHeader>
        {showingIntroduction ? <AgentMemoryIntro key={introduction.key} orgType={orgType} hasProject={Boolean(projectId)} onDone={finishIntroduction} onSkip={finishIntroduction} /> : <>
        <AgentMemoryAutomation enabled={open} />
        {contextLoading ? <Spinner label="Chargement du contexte de la conversation" /> : contextError ? (
          <ErrorBox title="Le contexte de la conversation n’a pas pu être chargé." onRetry={onRetryContext} />
        ) : context.isPending ? <Spinner label="Chargement des mémoires" /> : context.isError ? (
          <ErrorBox title="Les mémoires n’ont pas pu être chargées." onRetry={() => void context.refetch()} />
        ) : (
          <>
            <section aria-label="Mémoires actives" className="space-y-2">
              <h3 className="text-sm font-semibold">Mémoires actives {context.data?.memories.length ? `(${context.data.memories.length})` : ''}</h3>
              {context.data?.memories.length ? <Card className="divide-y divide-border overflow-hidden">{context.data.memories.map((memory) => (
                <MemoryRow key={`${memory.id}:${memory.version}`} memory={memory} canManage={canManageAgentMemory(memory.scope, context.data)} />
              ))}</Card> : <EmptyState title="Aucune mémoire confirmée pour ce contexte." variant="compact" headingLevel={4} className="items-start border-0 p-0 text-left"
                description="Confirmez une proposition dans la conversation ou ajoutez une règle ici." />}
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
              <Card role="region" aria-label="Ajouter une proposition" className="p-4 space-y-3">
                <h3 className="text-sm font-semibold">Proposer une mémoire</h3>
                <AgentMemoryFields value={draft} onChange={setDraft} projectId={projectId} orgType={orgType} autoFocus
                  canManageOrganization={context.data?.can_manage_organization === true}
                  canManageProject={context.data?.can_manage_project === true} disabled={saving} />
                {error && <p role="alert" className="text-xs text-danger">{error}</p>}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="primary" className="min-h-11 md:min-h-0" onClick={() => void create()} aria-busy={saving}
                    disabled={saving || !isAgentMemoryDraftValid(draft) || !canManageAgentMemory(draft.scope, context.data)}>
                    {saving && <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />}Créer la proposition
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="min-h-11 md:min-h-0" disabled={saving} onClick={() => setAdding(false)}>Annuler</Button>
                </div>
                <p className="text-xs text-muted-foreground">Vous pourrez relire et confirmer cette proposition avant son application.</p>
              </Card>
            ) : <Button type="button" size="sm" variant={context.data?.memories.length || proposals.data?.length ? 'outline' : 'primary'} className="min-h-11 md:min-h-0" onClick={startAdding}><Plus aria-hidden="true" className="h-4 w-4" />Proposer une mémoire</Button>}
          </>
        )}
        <AgentMemoryScopeGuide orgType={orgType} hasProject={Boolean(projectId)} onReplay={() => setReplayKey(introduction.key)} />
        </>}
      </DialogContent>
    </Dialog>
  );
}
