import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { useAICredits } from '@/hooks/useAICredits';
import { ShimmerButton } from '@/components/magicui/shimmer-button';
import {
  Sparkle, Search, ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { countBriefFields } from '@/lib/missionUtils';
import type { JobDetails } from '@/types/jobDetails';

interface SourcingReadinessPanelProps {
  project: SourcingProject;
  selectedAccount: string | null;
  searchSource?: 'linkedin' | 'database';
  onSourceChange?: (source: 'linkedin' | 'database') => void;
  onAutoFill?: () => void;
  autoFillLoading?: boolean;
  onSearch?: () => void;
  filtersReady?: boolean;
  accountName?: string | null;
  accountStatus?: string | null;
}

export const SourcingReadinessPanel: React.FC<SourcingReadinessPanelProps> = ({
  project,
  onAutoFill,
  autoFillLoading = false,
  onSearch,
  filtersReady = false,
}) => {
  const { creditsRemaining, isLoading: creditsLoading } = useAICredits();
  const jd = (project.job_details || {}) as Partial<JobDetails>;
  const brief = countBriefFields(jd);
  const [showManual, setShowManual] = useState(false);

  const creditsOk = !creditsLoading && creditsRemaining > 0;
  const briefReady = brief.filled >= 4;
  const briefDone = brief.filled >= 8;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="w-full max-w-sm mx-auto space-y-3 py-1"
    >
      <div className="text-center space-y-1">
        <p className="text-sm font-semibold text-foreground">Prêt à lancer la recherche</p>
        <p className="text-xs text-muted-foreground">
          Générez les filtres depuis le brief puis lancez la recherche.
        </p>
      </div>

      <div className="flex items-center justify-center gap-2 flex-wrap">
        <span className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
          briefDone
            ? 'border-accent/20 bg-accent/5 text-accent'
            : briefReady
              ? 'border-primary/20 bg-primary/5 text-primary'
              : 'border-destructive/20 bg-destructive/5 text-destructive',
        )}>
          <span className={cn(
            'h-1.5 w-1.5 rounded-full',
            briefDone ? 'bg-accent' : briefReady ? 'bg-primary' : 'bg-destructive',
          )} />
          Brief {brief.filled}/{brief.total}
        </span>

        <span className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
          creditsOk
            ? 'border-accent/20 bg-accent/5 text-accent'
            : 'border-destructive/20 bg-destructive/5 text-destructive',
        )}>
          <span className={cn('h-1.5 w-1.5 rounded-full', creditsOk ? 'bg-accent' : 'bg-destructive')} />
          {creditsLoading ? '...' : `${creditsRemaining.toLocaleString('fr-FR')} cr`}
        </span>
      </div>

      <div className="space-y-2">
        {onAutoFill && (
          <ShimmerButton
            onClick={onAutoFill}
            disabled={autoFillLoading || !briefReady}
            className="h-11 w-full rounded-xl text-xs"
            shimmerDuration="1.5s"
          >
            {autoFillLoading ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              >
                <Sparkle className="h-4 w-4" />
              </motion.div>
            ) : (
              <Sparkle className="h-4 w-4" />
            )}
            <span className="font-bold">Générer les filtres</span>
            <span className="text-xs opacity-70">~4 cr</span>
          </ShimmerButton>
        )}

        {onSearch && (
          <button
            onClick={onSearch}
            disabled={!filtersReady}
            className={cn(
              'flex h-11 w-full items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition-all',
              filtersReady
                ? 'border-accent bg-accent text-accent-foreground shadow-md hover:bg-accent/90'
                : 'cursor-not-allowed border-border bg-muted/30 text-muted-foreground',
            )}
          >
            <Search className="h-4 w-4" />
            Lancer la recherche
          </button>
        )}

        <button
          onClick={() => setShowManual(!showManual)}
          className="mx-auto flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <span>configurer manuellement</span>
          <ChevronDown className={cn('h-3 w-3 transition-transform', showManual && 'rotate-180')} />
        </button>

        <AnimatePresence>
          {showManual && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="rounded-xl border border-border bg-muted/10 p-3">
                <p className="text-center text-xs text-muted-foreground">
                  Utilisez le panneau de filtres pour ajuster la recherche.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};
