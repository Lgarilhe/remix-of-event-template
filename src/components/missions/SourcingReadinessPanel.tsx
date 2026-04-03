import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { useAICredits } from '@/hooks/useAICredits';
import { ShimmerButton } from '@/components/magicui/shimmer-button';
import {
  Sparkle, Search, ChevronDown, Target,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { countBriefFields } from '@/lib/missionUtils';
import type { JobDetails } from '@/types/jobDetails';

/* ─── Props ─── */
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

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="w-full max-w-sm mx-auto flex flex-col items-center gap-6 py-6"
    >
      {/* ── Icon ── */}
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.1, type: 'spring' }}
        className="w-14 h-14 rounded-2xl bg-muted/20 border border-border flex items-center justify-center"
      >
        <Target className="w-6 h-6 text-muted-foreground" />
      </motion.div>

      {/* ── Title ── */}
      <div className="text-center space-y-1">
        <p className="text-sm font-medium text-foreground">
          Prêt à sourcer
        </p>
        <p className="text-xs text-muted-foreground max-w-[260px]">
          Générez vos filtres depuis le brief ou configurez-les manuellement, puis lancez la recherche.
        </p>
      </div>

      {/* ── Brief + Credits inline ── */}
      <div className="flex items-center gap-2">
        <span className={cn(
          'inline-flex items-center gap-1.5 text-xs py-1 px-2.5 rounded-full border',
          brief.filled >= 8
            ? 'text-accent border-accent/20 bg-accent/5'
            : briefReady
              ? 'text-primary border-primary/20 bg-primary/5'
              : 'text-destructive border-destructive/20 bg-destructive/5',
        )}>
          <span className={cn(
            'w-1.5 h-1.5 rounded-full',
            brief.filled >= 8 ? 'bg-accent' : briefReady ? 'bg-primary' : 'bg-destructive',
          )} />
          Brief {brief.filled}/{brief.total}
        </span>
        <span className={cn(
          'inline-flex items-center gap-1.5 text-xs py-1 px-2.5 rounded-full border',
          creditsOk
            ? 'text-accent border-accent/20 bg-accent/5'
            : 'text-destructive border-destructive/20 bg-destructive/5',
        )}>
          <span className={cn('w-1.5 h-1.5 rounded-full', creditsOk ? 'bg-accent' : 'bg-destructive')} />
          {creditsLoading ? '...' : `${creditsRemaining.toLocaleString('fr-FR')} cr`}
        </span>
      </div>

      {/* ── CTA ── */}
      <div className="w-full space-y-3">
        {onAutoFill && (
          <ShimmerButton
            onClick={onAutoFill}
            disabled={autoFillLoading || !briefReady}
            className="w-full h-11 text-xs rounded-xl"
            shimmerDuration="1.5s"
          >
            {autoFillLoading ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              >
                <Sparkle className="w-4 h-4" />
              </motion.div>
            ) : (
              <Sparkle className="w-4 h-4" />
            )}
            <span className="font-bold">Générer les filtres</span>
            <span className="text-xs opacity-70">~4 cr</span>
          </ShimmerButton>
        )}

        <button
          onClick={() => setShowManual(!showManual)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mx-auto"
        >
          <span>configurer manuellement</span>
          <ChevronDown className={cn('w-3 h-3 transition-transform', showManual && 'rotate-180')} />
        </button>

        <AnimatePresence>
          {showManual && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="border border-border rounded-xl p-3 bg-muted/10">
                <p className="text-xs text-muted-foreground text-center">
                  Utilisez le panneau de filtres pour configurer votre recherche.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Search ── */}
      {(filtersReady || onSearch) && (
        <button
          onClick={onSearch}
          disabled={!filtersReady}
          className={cn(
            'w-full h-11 flex items-center justify-center gap-2 text-sm font-semibold rounded-xl border transition-all',
            filtersReady
              ? 'border-accent bg-accent text-accent-foreground hover:bg-accent/90 shadow-md'
              : 'border-border bg-muted/30 text-muted-foreground cursor-not-allowed',
          )}
        >
          <Search className="w-4 h-4" />
          Lancer la recherche
        </button>
      )}
    </motion.div>
  );
};
