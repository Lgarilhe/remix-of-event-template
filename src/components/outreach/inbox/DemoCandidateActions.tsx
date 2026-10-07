import { useRef, useState } from 'react';
import { Check, ChevronDown, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ServiceLogo } from '@/components/ui/ServiceLogo';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { DemoCandidateAction } from '@/lib/inboxDemoActions';

export type DemoActionStatus = 'created' | 'dismissed' | 'completed';

const dateLabel = (value: string) => new Date(value).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** La proposition et la tâche restent locales ; le raisonnement se lit à la demande. */
export function DemoCandidateActions({ actions, statuses, onStatusChange }: {
  actions: DemoCandidateAction[];
  statuses: Record<string, DemoActionStatus>;
  onStatusChange: (id: string, status: DemoActionStatus | undefined) => void;
}) {
  const [detailId, setDetailId] = useState<string | null>(null);
  const detailTriggerRef = useRef<HTMLButtonElement | null>(null);
  const restoreRef = useRef<HTMLButtonElement>(null);
  const detail = actions.find(action => action.id === detailId);
  const visible = actions.filter(action => statuses[action.id] !== 'dismissed');

  function updateStatus(id: string, status: DemoActionStatus) {
    onStatusChange(id, status);
    setDetailId(null);
  }

  return <section aria-label="Prochaine action" data-component="demo-candidate-actions">
    {visible.map(action => {
      const status = statuses[action.id];
      return <article key={action.id} className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between" aria-label={action.title}>
        <div className="min-w-0 space-y-1">
          <p className="text-xs text-muted-foreground">{status ? 'Votre tâche' : 'Prochaine action'}</p>
          <h4 className="break-words text-sm font-semibold text-foreground">{action.title}</h4>
          {status ? <p className="flex flex-wrap items-center gap-1.5 text-xs text-foreground" role="status"><Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{status === 'completed' ? 'Tâche terminée' : 'Ajoutée à vos tâches'}<span className="text-muted-foreground">· {action.owner} · {dateLabel(action.dueAt)}</span></p> : <p className="break-words text-xs leading-relaxed text-foreground-secondary">{action.reason}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!status && <Button variant="outline" size="sm" className="min-h-11 md:min-h-8" onClick={() => updateStatus(action.id, 'created')}>Ajouter à mes tâches</Button>}
          {status === 'created' && <Button variant="outline" size="sm" className="min-h-11 md:min-h-8" onClick={() => updateStatus(action.id, 'completed')}>Marquer terminée</Button>}
          <Button variant="ghost" size="sm" className="min-h-11 md:min-h-8" onClick={event => { detailTriggerRef.current = event.currentTarget; setDetailId(action.id); }}>Pourquoi ?</Button>
        </div>
      </article>;
    })}
    {visible.length === 0 && <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-muted-foreground" role="status">Vous avez ignoré cette suggestion.</p>
      <Button ref={restoreRef} variant="ghost" size="sm" className="min-h-11 md:min-h-8" onClick={() => actions.forEach(action => onStatusChange(action.id, undefined))}>Revoir la suggestion</Button>
    </div>}
    <Dialog open={!!detail} onOpenChange={open => { if (!open) setDetailId(null); }}>
      {detail && <DialogContent className="flex max-h-[90dvh] max-w-lg flex-col overflow-hidden p-0 [&>button]:h-11 [&>button]:w-11" onCloseAutoFocus={event => {
        const target = detailTriggerRef.current?.isConnected ? detailTriggerRef.current : restoreRef.current;
        if (target?.isConnected) { event.preventDefault(); target.focus(); }
      }}>
        <DialogHeader className="shrink-0 px-5 pb-3 pt-5 pr-14 text-left">
          <p className="text-xs text-muted-foreground">Suggestion de l’assistant</p>
          <DialogTitle>{detail.title}</DialogTitle>
          <DialogDescription>{detail.reason}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-5 overflow-y-auto px-5 pb-4">
          <dl className="grid grid-cols-2 gap-3 border-y border-border py-3 text-xs">
            <div><dt className="text-muted-foreground">Responsable proposé</dt><dd className="mt-1 font-medium text-foreground">{detail.owner}</dd></div>
            <div><dt className="text-muted-foreground">À faire avant le</dt><dd className="mt-1 font-medium text-foreground">{dateLabel(detail.dueAt)}</dd></div>
          </dl>
          <section aria-label="Contexte de la suggestion">
            <h5 className="mb-1 text-xs font-semibold text-foreground">Ce qui motive cette action</h5>
            <div className="divide-y divide-border">{detail.sources.map(source => <Collapsible key={source.id}>
              <div className="py-3">
                <div className="flex items-start gap-2">
                  {source.service ? <ServiceLogo service={source.service} decorative /> : <FileText className="h-4 w-4 shrink-0 text-foreground" aria-hidden="true" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground">{source.title}</p>
                    <p className="mt-1 text-2xs text-muted-foreground">{source.author} · {dateLabel(source.timestamp)}</p>
                  </div>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-foreground-secondary">{source.summary}</p>
                <CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="mt-1 min-h-11 gap-1 md:min-h-8">Lire l’extrait<ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /></Button></CollapsibleTrigger>
                <CollapsibleContent><p className="mt-1 whitespace-pre-line break-words border-l border-border pl-3 text-xs leading-relaxed text-foreground-secondary">{source.detail}</p></CollapsibleContent>
              </div>
            </Collapsible>)}</div>
          </section>
          <p className="text-xs text-muted-foreground">Les tâches de cet aperçu restent dans la démo.</p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border px-5 py-3">
          {!statuses[detail.id] ? <>
            <Button variant="ghost" size="sm" className="min-h-11 text-muted-foreground md:min-h-8" onClick={() => updateStatus(detail.id, 'dismissed')}>Ignorer la suggestion</Button>
            <Button variant="primary" size="sm" className="min-h-11 md:min-h-8" onClick={() => updateStatus(detail.id, 'created')}>Ajouter à mes tâches</Button>
          </> : <Button variant="outline" size="sm" className="min-h-11 md:min-h-8" onClick={() => setDetailId(null)}>Fermer le détail</Button>}
        </div>
      </DialogContent>}
    </Dialog>
  </section>;
}
