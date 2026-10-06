import { estimateCredits, ACTION_COSTS, resolveModel, MODEL_CATALOG } from '@/types/aiCredits';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface CreditCostBadgeProps {
  /** The AI action ID (e.g. "scoring", "outreach_message") */
  actionId: string;
  /** Optional model override (from ModelPicker) */
  modelId?: string | null;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Coût estimé d'une action IA, en toutes lettres (« 2 crédits »), avec une
 * infobulle qui dit qu'il s'agit d'une estimation (revue design E-51).
 *
 * Usage: place next to any button that triggers an AI action.
 */
export const CreditCostBadge = ({ actionId, modelId, className }: CreditCostBadgeProps) => {
  const action = ACTION_COSTS[actionId];
  if (!action) return null;

  const resolvedModel = resolveModel(action.routingTier, modelId, undefined, actionId);
  const cost = estimateCredits(actionId, resolvedModel);

  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="muted" className={cn('shrink-0 select-none tabular-nums', className)}>
            {cost} crédit{cost > 1 ? 's' : ''}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs max-w-[220px]">
          <p>
            Environ {cost} crédit{cost > 1 ? 's' : ''} avec le modèle {MODEL_CATALOG[resolvedModel]?.name ?? 'Avancé'}.
          </p>
          <p className="mt-0.5 text-muted-foreground">Le coût réel dépend de la longueur du texte traité.</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
