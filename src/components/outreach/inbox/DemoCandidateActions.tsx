import { Check, FileText, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ServiceLogo } from '@/components/ui/ServiceLogo';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { DemoCandidateAction } from '@/lib/inboxDemoActions';

export type DemoActionStatus = 'created' | 'dismissed' | 'completed';

const dateLabel = (value: string) => new Date(value).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Carte illustrative : l'état des tâches appartient uniquement à la session de démo. */
export function DemoCandidateActions({ actions, statuses, onStatusChange }: {
  actions: DemoCandidateAction[];
  statuses: Record<string, DemoActionStatus>;
  onStatusChange: (id: string, status: DemoActionStatus | undefined) => void;
}) {
  const dismissed = actions.filter(action => statuses[action.id] === 'dismissed');
  return <section className="space-y-3" aria-label="Actions proposées fictives" data-component="demo-candidate-actions">
    <div>
      <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Sparkles className="h-4 w-4" aria-hidden="true" />Actions proposées</h4>
      <p className="mt-1 text-xs text-muted-foreground">Exemples de suggestions IA · Démo</p>
    </div>
    {actions.filter(action => statuses[action.id] !== 'dismissed').map(action => {
      const status = statuses[action.id];
      return <article key={action.id} className="space-y-3 rounded-lg border border-border bg-background p-3" aria-label={action.title}>
        <h5 className="break-words text-sm font-semibold text-foreground">{action.title}</h5>
        <p className="break-words text-xs leading-relaxed text-foreground-secondary">{action.reason}</p>
        <p className="text-xs text-muted-foreground">{action.owner} · Échéance suggérée : {dateLabel(action.dueAt)}</p>
        <Collapsible>
          <CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="min-h-11 w-full justify-start px-0">Voir les sources ({action.sources.length})</Button></CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-1">{action.sources.map(source => <div key={source.id} className="space-y-1 border-l border-border pl-3">
            <p className="flex items-start gap-2 text-xs font-medium text-foreground">{source.service ? <ServiceLogo service={source.service} decorative /> : <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />}<span>{source.title}</span></p>
            <p className="text-2xs text-muted-foreground">{source.author} · {dateLabel(source.timestamp)}</p>
            <p className="whitespace-pre-line break-words text-xs leading-relaxed text-foreground-secondary">{source.detail}</p>
          </div>)}</CollapsibleContent>
        </Collapsible>
        {status ? <div className="space-y-2 border-t border-border pt-3">
          <p className="flex items-center gap-2 text-xs font-medium text-foreground" role="status"><Check className="h-4 w-4" aria-hidden="true" />{status === 'completed' ? 'Tâche simulée terminée' : 'Tâche créée dans la démo'}</p>
          {status === 'created' && <Button variant="outline" size="sm" className="min-h-11 w-full" onClick={() => onStatusChange(action.id, 'completed')}>Marquer terminée</Button>}
        </div> : <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" className="min-h-11 flex-1" onClick={() => onStatusChange(action.id, 'created')}>Créer dans la démo</Button>
          <Button variant="ghost" size="sm" className="min-h-11" onClick={() => onStatusChange(action.id, 'dismissed')}>Écarter</Button>
        </div>}
      </article>;
    })}
    {dismissed.length > 0 && <Button variant="ghost" size="sm" className="min-h-11 h-auto w-full whitespace-normal" onClick={() => dismissed.forEach(action => onStatusChange(action.id, undefined))}>Réafficher les propositions écartées</Button>}
    <p className="text-2xs text-muted-foreground">Suggestions préparées pour cet aperçu. Les tâches restent fictives et aucun message n’est envoyé.</p>
  </section>;
}
