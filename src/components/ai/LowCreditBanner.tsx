import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAICredits } from '@/hooks/useAICredits';
import { AlertTriangle, X, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Banner shown when credits < 20% of plan.
 * Dismissible — reappears if credits drop below 10%.
 */
export const LowCreditBanner = () => {
  const navigate = useNavigate();
  const { creditsRemaining, creditsTotal, isLow, isOut, isLoading } = useAICredits();
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  if (isLoading || (!isLow && !isOut)) return null;

  const percent = creditsTotal > 0 ? creditsRemaining / creditsTotal : 0;
  const isCritical = percent < 0.1 || isOut;

  // If dismissed and not yet critical, stay hidden
  if (dismissedAt && !isCritical) return null;
  // If dismissed at critical level, stay hidden (user actively dismissed)
  if (dismissedAt && isCritical && dismissedAt > Date.now() - 30 * 60 * 1000) return null;

  return (
    <div
      className={cn(
        "relative flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium",
        isCritical
          ? "bg-destructive/10 text-destructive border-b border-destructive/20"
          : "bg-warning/10 text-warning border-b border-warning/20"
      )}
    >
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
      <span>
        {isOut
          ? "Plus de crédits IA disponibles — les fonctionnalités IA sont désactivées."
          : `Il vous reste ${creditsRemaining} crédits IA (${Math.round(percent * 100)}% du plan).`}
      </span>
      <button
        onClick={() => navigate('/settings?tab=credits')}
        className={cn(
          "inline-flex items-center gap-1 font-bold underline underline-offset-2 hover:no-underline",
          isCritical ? "text-destructive" : "text-warning"
        )}
      >
        Acheter des crédits
        <ArrowUpRight className="w-3 h-3" />
      </button>
      <button
        onClick={() => setDismissedAt(Date.now())}
        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-black/5 rounded"
        aria-label="Fermer"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
