/**
 * SidebarCreditsWidget — affiche les crédits IA restants avec une mini
 * progress bar visuelle.
 *
 * Format compact (collapsed sidebar) : juste l'icône Sparkles avec un badge
 * coloré si low/out.
 *
 * Format expanded : card avec label "Crédits IA", chiffre en font-display,
 * mini progress bar (creditsRemaining / creditsTotal), et CTA "Recharger"
 * si low/out.
 */

import React from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Sparkles, AlertTriangle, ArrowRight } from 'lucide-react';
import { useAICredits } from '@/hooks/useAICredits';
import { cn } from '@/lib/utils';

interface SidebarCreditsWidgetProps {
  collapsed: boolean;
}

export const SidebarCreditsWidget: React.FC<SidebarCreditsWidgetProps> = ({ collapsed }) => {
  const navigate = useNavigate();
  const { creditsRemaining, creditsTotal, isLow, isOut, isLoading } = useAICredits();

  if (isLoading) return null;

  // Pas de quota défini (organisation sans plan, ou crédits illimités)
  const showProgress = creditsTotal > 0;
  const usagePct = showProgress
    ? Math.max(0, Math.min(100, ((creditsTotal - creditsRemaining) / creditsTotal) * 100))
    : 0;
  const remainingPct = 100 - usagePct;

  const tone = isOut ? 'destructive' : isLow ? 'warning' : 'success';

  const compactValue = creditsRemaining > 9999
    ? `${(creditsRemaining / 1000).toFixed(creditsRemaining > 99999 ? 0 : 1)}k`
    : creditsRemaining.toLocaleString('fr-FR');

  if (collapsed) {
    return (
      <button
        onClick={() => navigate('/settings?tab=credits')}
        className={cn(
          'h-9 w-9 flex items-center justify-center mx-auto rounded-lg relative transition-colors',
          isOut
            ? 'bg-destructive/10 text-destructive hover:bg-destructive/15'
            : isLow
            ? 'bg-warning/10 text-warning hover:bg-warning/15'
            : 'text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/60',
        )}
        aria-label={`${compactValue} crédits IA restants`}
        title={`${creditsRemaining.toLocaleString('fr-FR')} crédits IA`}
      >
        <Sparkles className="h-4 w-4" strokeWidth={1.5} />
        {(isLow || isOut) && (
          <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-destructive ring-2 ring-sidebar" />
        )}
      </button>
    );
  }

  return (
    <button
      onClick={() => navigate('/settings?tab=credits')}
      className={cn(
        'group w-full text-left rounded-xl border p-3 transition-colors',
        isOut
          ? 'bg-destructive/[0.04] border-destructive/20 hover:bg-destructive/[0.08]'
          : isLow
          ? 'bg-warning/[0.04] border-warning/20 hover:bg-warning/[0.08]'
          : 'bg-sidebar-accent/30 border-border hover:bg-sidebar-accent/60',
      )}
      aria-label="Voir les crédits IA dans les paramètres"
    >
      <div className="flex items-center gap-2 mb-2">
        <div
          className={cn(
            'h-6 w-6 rounded-md flex items-center justify-center shrink-0',
            isOut
              ? 'bg-destructive/15 text-destructive'
              : isLow
              ? 'bg-warning/15 text-warning'
              : 'bg-foreground/[0.08] text-foreground',
          )}
        >
          {isOut || isLow ? (
            <AlertTriangle className="w-3 h-3" />
          ) : (
            <Sparkles className="w-3 h-3" />
          )}
        </div>
        <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground flex-1">
          Crédits IA
        </span>
        <ArrowRight
          className="w-3 h-3 text-muted-foreground opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all"
          aria-hidden="true"
        />
      </div>

      <div className="flex items-baseline gap-1.5 mb-2">
        <span className="font-display text-base font-bold text-sidebar-foreground tabular-nums leading-none">
          {compactValue}
        </span>
        {showProgress && (
          <span className="text-[10px] text-muted-foreground tabular-nums">
            / {creditsTotal.toLocaleString('fr-FR')}
          </span>
        )}
      </div>

      {showProgress ? (
        <div className="h-1 bg-muted/60 rounded-full overflow-hidden">
          <motion.div
            className={cn(
              'h-full rounded-full',
              tone === 'destructive'
                ? 'bg-destructive'
                : tone === 'warning'
                ? 'bg-warning'
                : 'bg-foreground/60',
            )}
            initial={{ width: 0 }}
            animate={{ width: `${remainingPct}%` }}
            transition={{ duration: 0.7, ease: 'easeOut' }}
          />
        </div>
      ) : (
        <div className="text-[10px] text-muted-foreground">Illimités sur ce plan</div>
      )}

      {(isLow || isOut) && (
        <div
          className={cn(
            'mt-2 text-[10.5px] font-medium',
            isOut ? 'text-destructive' : 'text-warning',
          )}
        >
          {isOut ? 'Crédits épuisés — recharger' : 'Bientôt épuisés — recharger'}
        </div>
      )}
    </button>
  );
};
