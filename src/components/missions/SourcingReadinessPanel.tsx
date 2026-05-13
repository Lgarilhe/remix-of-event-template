import React from 'react';
import { motion } from 'framer-motion';
import { useSearchParams } from 'react-router-dom';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { useAICredits } from '@/hooks/useAICredits';
import { Search, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { countBriefFields } from '@/lib/missionUtils';
import type { JobDetails } from '@/types/jobDetails';

interface SourcingReadinessPanelProps {
  project: SourcingProject;
  selectedAccount: string | null;
  searchSource?: 'linkedin' | 'database';
  onSourceChange?: (source: 'linkedin' | 'database') => void;
  /** @deprecated — la génération des filtres se fait depuis le brief.
   *  Conservé en optionnel pour la backward-compat des call sites. */
  onAutoFill?: () => void;
  /** @deprecated */
  autoFillLoading?: boolean;
  onSearch?: () => void;
  filtersReady?: boolean;
  accountName?: string | null;
  accountStatus?: string | null;
}

export const SourcingReadinessPanel: React.FC<SourcingReadinessPanelProps> = ({
  project,
  onSearch,
  filtersReady = false,
}) => {
  const { creditsRemaining, isLoading: creditsLoading } = useAICredits();
  const jd = (project.job_details || {}) as Partial<JobDetails>;
  const brief = countBriefFields(jd);
  const [, setSearchParams] = useSearchParams();

  const creditsOk = !creditsLoading && creditsRemaining > 0;
  const briefReady = brief.filled >= 4;
  const briefDone = brief.filled >= 8;

  // Source canonique : on regarde DIRECTEMENT le filters_snapshot persisté
  // sur la mission, pas seulement l'état local de la search (qui peut ne
  // pas avoir hydraté les filtres encore). Évite l'effet "j'ai des filtres
  // visibles mais le panneau dit qu'il faut les générer".
  const hasFilters = !!(project.filters_snapshot && Object.keys(project.filters_snapshot).length > 0);
  const canSearch = filtersReady || hasFilters;

  const goToBrief = () => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('tab', 'brief');
      return next;
    }, { replace: true });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="w-full max-w-sm mx-auto space-y-3 py-1"
    >
      {/* Motion décoratif — anime l'écran d'attente quand pas encore de
          résultats. Muted + loop + playsInline + aria-hidden pour ne pas
          gêner les lecteurs d'écran. */}
      <div className="flex items-center justify-center">
        <video
          src="/sourcing-empty-motion.mp4"
          autoPlay
          loop
          muted
          playsInline
          aria-hidden="true"
          className="w-40 h-40 sm:w-48 sm:h-48 object-cover rounded-2xl"
        />
      </div>

      <div className="text-center space-y-1">
        <p className="text-sm font-semibold text-foreground">
          {canSearch ? 'Prêt à lancer la recherche' : 'Configurez la recherche'}
        </p>
        <p className="text-xs text-muted-foreground">
          {canSearch
            ? 'Filtres prêts. Lancez la recherche quand vous voulez.'
            : 'Générez les filtres depuis le brief, ou configurez-les manuellement à gauche.'}
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
        {/* Si pas encore de filtres → renvoie au brief (point canonique
            de génération avec review modal). Plus de bouton "Générer les
            filtres" ici qui dupliquait sans review. */}
        {!canSearch && (
          <button
            onClick={goToBrief}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-foreground text-background text-sm font-semibold transition-all hover:bg-foreground/90"
          >
            <ArrowLeft className="h-4 w-4" />
            Aller au brief
          </button>
        )}

        {onSearch && (
          <button
            onClick={onSearch}
            disabled={!canSearch}
            className={cn(
              'flex h-11 w-full items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition-all',
              canSearch
                ? 'border-accent bg-accent text-accent-foreground shadow-md hover:bg-accent/90'
                : 'cursor-not-allowed border-border bg-muted/30 text-muted-foreground',
            )}
          >
            <Search className="h-4 w-4" />
            Lancer la recherche
          </button>
        )}
      </div>
    </motion.div>
  );
};
