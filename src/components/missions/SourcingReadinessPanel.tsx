import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { useAICredits } from '@/hooks/useAICredits';
import { ShimmerButton } from '@/components/magicui/shimmer-button';
import {
  Sparkle, Search, Users, UserCheck, Send, Star,
  ChevronDown, FileText, ArrowRight,
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

/* ─── Stat Card ─── */
const StatCard: React.FC<{
  icon: React.ReactNode;
  value: number;
  label: string;
  accent?: boolean;
  delay?: number;
}> = ({ icon, value, label, accent = false, delay = 0 }) => (
  <motion.div
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay, duration: 0.3 }}
    className={cn(
      'flex flex-col items-center gap-1.5 p-3 rounded-xl border',
      accent
        ? 'border-accent/20 bg-accent/5'
        : 'border-border bg-muted/10',
    )}
  >
    <div className={cn(
      'w-8 h-8 rounded-lg flex items-center justify-center',
      accent ? 'bg-accent/10 text-accent' : 'bg-muted/30 text-muted-foreground',
    )}>
      {icon}
    </div>
    <span className="text-lg font-semibold text-foreground">{value}</span>
    <span className="text-xs text-muted-foreground text-center leading-tight">{label}</span>
  </motion.div>
);

/* ═══════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════ */

export const SourcingReadinessPanel: React.FC<SourcingReadinessPanelProps> = ({
  project,
  selectedAccount,
  searchSource = 'linkedin',
  onSourceChange,
  onAutoFill,
  autoFillLoading = false,
  onSearch,
  filtersReady = false,
  accountName,
  accountStatus,
}) => {
  const { creditsRemaining, isLoading: creditsLoading } = useAICredits();
  const jd = (project.job_details || {}) as Partial<JobDetails>;
  const brief = countBriefFields(jd);
  const [showManualFilters, setShowManualFilters] = useState(false);

  const stats = [
    { icon: <Users className="w-4 h-4" />, value: project.stats_total_found, label: 'Trouvés', accent: project.stats_total_found > 0 },
    { icon: <Star className="w-4 h-4" />, value: project.stats_scored, label: 'Évalués', accent: false },
    { icon: <Send className="w-4 h-4" />, value: project.stats_messaged, label: 'Contactés', accent: false },
    { icon: <UserCheck className="w-4 h-4" />, value: project.stats_shortlisted, label: 'Shortlistés', accent: project.stats_shortlisted > 0 },
  ];

  const hasActivity = project.stats_total_found > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="w-full max-w-md mx-auto space-y-5"
    >
      {/* ── Mission Header ── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="text-center space-y-1"
      >
        <h3 className="text-base font-semibold text-foreground">
          {jd.title || project.name}
        </h3>
        {project.client_name && (
          <p className="text-xs text-muted-foreground">{project.client_name}</p>
        )}
      </motion.div>

      {/* ── Stats Grid ── */}
      <div className="grid grid-cols-4 gap-2">
        {stats.map((s, i) => (
          <StatCard
            key={i}
            icon={s.icon}
            value={s.value}
            label={s.label}
            accent={s.accent}
            delay={0.1 + i * 0.05}
          />
        ))}
      </div>

      {/* ── Brief Status ── */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className={cn(
          'flex items-center gap-3 px-4 py-3 rounded-xl border',
          brief.filled >= 8
            ? 'border-accent/20 bg-accent/5'
            : 'border-primary/20 bg-primary/5',
        )}
      >
        <div className={cn(
          'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
          brief.filled >= 8 ? 'bg-accent/10 text-accent' : 'bg-primary/10 text-primary',
        )}>
          <FileText className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground">
            Brief {brief.filled}/{brief.total} champs
          </p>
          <p className="text-xs text-muted-foreground">
            {brief.filled >= 8
              ? 'Prêt pour la génération de filtres'
              : 'Complétez le brief pour de meilleurs résultats'}
          </p>
        </div>
        {brief.filled >= 8 && (
          <span className="w-2 h-2 rounded-full bg-accent shrink-0" />
        )}
      </motion.div>

      {/* ── Auto-fill CTA ── */}
      {onAutoFill && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
        >
          <ShimmerButton
            onClick={onAutoFill}
            disabled={autoFillLoading || brief.filled < 3}
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
        </motion.div>
      )}

      {/* Manual toggle */}
      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        onClick={() => setShowManualFilters(!showManualFilters)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mx-auto"
      >
        <span>ou configurez manuellement</span>
        <ChevronDown className={cn('w-3 h-3 transition-transform', showManualFilters && 'rotate-180')} />
      </motion.button>

      <AnimatePresence>
        {showManualFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="border border-border rounded-xl p-4 bg-muted/10">
              <p className="text-xs text-muted-foreground text-center">
                Utilisez le panneau de filtres à gauche pour configurer manuellement votre recherche.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Search CTA ── */}
      {(filtersReady || onSearch) && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45, type: 'spring' }}
          className="sticky bottom-4 pt-1"
        >
          <button
            onClick={onSearch}
            disabled={!filtersReady}
            className={cn(
              'w-full h-11 flex items-center justify-center gap-2 text-sm font-semibold rounded-xl border transition-all',
              filtersReady
                ? 'border-foreground/20 bg-foreground text-background hover:bg-foreground/90 shadow-md'
                : 'border-border bg-muted/30 text-muted-foreground cursor-not-allowed',
            )}
          >
            <Search className="w-4 h-4" />
            Lancer la recherche
          </button>
        </motion.div>
      )}
    </motion.div>
  );
};
