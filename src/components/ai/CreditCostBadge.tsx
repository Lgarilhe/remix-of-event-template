import { estimateCredits, ACTION_COSTS, resolveModel, MODEL_CATALOG } from '@/types/aiCredits';
import { cn } from '@/lib/utils';
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
 * Small badge showing estimated credit cost for an AI action.
 * Displays "~X cr" with a tooltip explaining the estimation.
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
          <span
            className={cn(
              "inline-flex items-center px-1.5 py-0.5 text-xs font-medium rounded-sm",
              "bg-muted/80 text-muted-foreground border border-border/50",
              "select-none shrink-0",
              className
            )}
          >
            ~{cost} cr
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs max-w-[220px]">
          <p>
            Estimation : ~{cost} crédit{cost > 1 ? 's' : ''} avec le modèle {MODEL_CATALOG[resolvedModel]?.name ?? 'Avancé'}
          </p>
          <p className="text-muted-foreground mt-0.5">
            Coût réel basé sur les tokens consommés.
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
