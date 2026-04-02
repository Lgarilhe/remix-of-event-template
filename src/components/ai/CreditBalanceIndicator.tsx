import { useNavigate } from 'react-router-dom';
import { useAICredits } from '@/hooks/useAICredits';
import { NumberTicker } from '@/components/magicui/number-ticker';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export const CreditBalanceIndicator = () => {
  const navigate = useNavigate();
  const { creditsRemaining, planCredits, topupCredits, isLow, isOut, isLoading, periodEnd } = useAICredits();

  if (isLoading) return null;

  const displayCredits = creditsRemaining > 9999
    ? `${Math.round(creditsRemaining / 1000)}k`
    : creditsRemaining.toLocaleString();

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => navigate('/settings?tab=credits')}
            aria-live="polite"
            aria-label={`Crédits IA : ${creditsRemaining}`}
            className={cn(
              "relative overflow-hidden h-[34px] px-2.5 flex items-center gap-1.5 text-xs font-medium border border-border leading-none transition-colors",
              isOut && "bg-destructive/10 border-destructive text-destructive",
              isLow && !isOut && "bg-warning/10 border-warning text-warning-foreground",
              !isLow && !isOut && "glass text-foreground"
            )}
          >
            <Sparkles className={cn(
              "w-3.5 h-3.5 shrink-0",
              isOut && "text-destructive",
              isLow && !isOut && "text-warning",
              !isLow && !isOut && "text-muted-foreground"
            )} />
            <NumberTicker value={creditsRemaining} className="font-bold" />
            <span className="hidden sm:inline text-xs text-muted-foreground font-normal">cr</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          <div className="space-y-1">
            <p className="font-medium">Crédits IA : {creditsRemaining.toLocaleString()}</p>
            <p className="text-muted-foreground">Plan : {planCredits.toLocaleString()}</p>
            {topupCredits > 0 && (
              <p className="text-muted-foreground">Top-up : {topupCredits.toLocaleString()}</p>
            )}
            {isOut && <p className="text-destructive font-medium">Plus de crédits disponibles</p>}
            {isLow && !isOut && <p className="text-warning font-medium">Crédits bientôt épuisés</p>}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
