import { Brain, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CreditCostBadge } from '@/components/ai/CreditCostBadge';
import { AGENT_MEMORY_EFFECT_LABEL, AGENT_MEMORY_KIND_LABEL, agentMemoryScopeLabel, type AgentMemory } from '@/types/agentMemory';

interface Props {
  memories: AgentMemory[];
  orgType: 'agency' | 'enterprise' | 'freelance' | null;
  loading: boolean;
  error: boolean;
  filtersOutdated: boolean;
  staleScoreCount: number;
  regenerating: boolean;
  onRetry: () => void;
  onManage: () => void;
  onRegenerate: () => void;
}

/** The confirmed rules are visible; applying new search criteria remains a deliberate action. */
export function SourcingMemoryNotice({ memories, orgType, loading, error, filtersOutdated, staleScoreCount, regenerating, onRetry, onManage, onRegenerate }: Props) {
  const recruiting = memories.filter(memory => memory.scope !== 'user'
    && memory.effects.some(effect => effect === 'search' || effect === 'scoring'));
  return (
    <div className="shrink-0 space-y-2 border-b border-border py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <Brain aria-hidden="true" className="h-4 w-4" />
          <span className="font-medium">Mémoire de recrutement</span>
          {loading ? <Loader2 aria-label="Chargement des mémoires" className="h-4 w-4 animate-spin" />
            : !error && <Badge variant="muted">{recruiting.length} règle{recruiting.length === 1 ? '' : 's'}</Badge>}
        </div>
        <Button type="button" size="sm" variant="ghost" className="min-h-11 md:min-h-0" onClick={onManage}>Gérer la mémoire</Button>
      </div>
      {error ? <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger">
        <p>Les mémoires n’ont pas pu être vérifiées. La génération et la notation attendent leur chargement.</p>
        <Button type="button" size="sm" variant="outline" className="min-h-11 md:min-h-0" onClick={onRetry}>Réessayer</Button>
      </div> : <>
        {(filtersOutdated || staleScoreCount > 0) && <div role="status" className="flex flex-wrap items-center justify-between gap-2 text-sm text-foreground-secondary">
          <div className="space-y-1">
            {filtersOutdated && <p>Les filtres actuels n’intègrent pas les dernières mémoires. Régénérez-les, puis vérifiez-les avant de relancer.</p>}
            {staleScoreCount > 0 && <p>{staleScoreCount} note{staleScoreCount === 1 ? '' : 's'} à recalculer : les critères ont changé.</p>}
          </div>
          {filtersOutdated && <Button type="button" size="sm" variant="outline" className="min-h-11 md:min-h-0" disabled={loading || regenerating} aria-busy={regenerating} onClick={onRegenerate}>
            {regenerating && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}Régénérer les filtres<CreditCostBadge actionId="filter_generation" />
          </Button>}
        </div>}
        {recruiting.length > 0 && <details>
          <summary className="min-h-11 cursor-pointer rounded-lg py-3 text-sm text-foreground-secondary outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-0 md:py-1">Voir les règles confirmées</summary>
          <ul className="divide-y divide-border">
            {recruiting.map(memory => <li key={memory.id} className="space-y-1 py-3">
              <p className="whitespace-pre-wrap break-words text-sm">{memory.content}</p>
              <p className="text-xs text-muted-foreground">{agentMemoryScopeLabel(memory.scope, orgType)} · {AGENT_MEMORY_KIND_LABEL[memory.kind]} · {memory.effects.filter(effect => effect === 'search' || effect === 'scoring').map(effect => AGENT_MEMORY_EFFECT_LABEL[effect]).join(', ')}</p>
            </li>)}
          </ul>
          <p className="py-2 text-xs text-muted-foreground">Les contraintes encadrent les préférences. Les préférences orientent les suggestions ; elles ne deviennent pas des exclusions.</p>
        </details>}
      </>}
    </div>
  );
}
