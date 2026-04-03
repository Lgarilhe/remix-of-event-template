import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { useAICredits } from '@/hooks/useAICredits';
import { useUnipileQuota } from '@/hooks/useUnipileQuota';
import { ShimmerButton } from '@/components/magicui/shimmer-button';
import {
  CheckCircle2, AlertCircle, XCircle, Globe,
  Sparkle, Search, ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { countBriefFields } from '@/lib/missionUtils';
import linkedinLogo from '@/assets/linkedin-logo.svg';
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

type CheckStatus = 'ok' | 'warning' | 'error';

const statusDot = {
  ok: 'bg-accent',
  warning: 'bg-primary',
  error: 'bg-destructive',
};

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
  const quota = useUnipileQuota(selectedAccount);
  const jd = (project.job_details || {}) as Partial<JobDetails>;
  const brief = countBriefFields(jd);
  const [showManualFilters, setShowManualFilters] = useState(false);

  const isAccountOk = accountStatus === 'OK' || accountStatus === 'CONNECTED';
  const hasAccount = !!selectedAccount;
  const accountCheck: CheckStatus = !hasAccount ? 'error' : isAccountOk ? 'ok' : 'warning';
  const briefStatus: CheckStatus = brief.filled >= 8 ? 'ok' : brief.filled >= 4 ? 'warning' : 'error';
  const creditsOk = !creditsLoading && creditsRemaining > 0;
  const invitationQuota = quota.getQuotaUsage('invitationsSent');
  const invitationNearLimit = quota.isNearLimit('invitationsSent');

  // Checks for the inline status strip
  const checks: { status: CheckStatus; label: string; show: boolean }[] = [
    { status: briefStatus, label: `Brief ${brief.filled}/${brief.total}`, show: true },
    { status: creditsOk ? 'ok' : 'error', label: creditsLoading ? '...' : `${creditsRemaining.toLocaleString('fr-FR')} cr`, show: true },
    { status: invitationNearLimit ? 'warning' : 'ok', label: `${invitationQuota.current}/${invitationQuota.limit} inv.`, show: searchSource === 'linkedin' },
    { status: accountCheck, label: hasAccount ? (isAccountOk ? 'Connecté' : 'Déconnecté') : 'Non lié', show: searchSource === 'linkedin' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="w-full max-w-xl mx-auto space-y-5"
    >
      {/* ── Source Toggle ── */}
      <div className="flex items-center gap-1.5 p-1 bg-muted/30 rounded-lg border border-border w-fit mx-auto">
        <button
          onClick={() => onSourceChange?.('linkedin')}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium transition-all',
            searchSource === 'linkedin'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <img src={linkedinLogo} alt="LinkedIn" className="w-4 h-4 rounded-sm" />
          LinkedIn
        </button>
        <button
          onClick={() => onSourceChange?.('database')}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium transition-all',
            searchSource === 'database'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Globe className="w-4 h-4" />
          Base Konekt
        </button>
      </div>

      {/* ── Source Info ── */}
      <motion.div
        key={searchSource}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="text-center"
      >
        {searchSource === 'linkedin' ? (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Recherche directe via votre compte LinkedIn</p>
            <p className={cn(
              'text-xs font-medium inline-flex items-center gap-1.5',
              accountCheck === 'ok' ? 'text-accent' : accountCheck === 'warning' ? 'text-primary' : 'text-destructive',
            )}>
              <span className={cn('w-1.5 h-1.5 rounded-full', statusDot[accountCheck])} />
              {!hasAccount ? 'Aucun compte connecté' : isAccountOk ? (accountName || 'Connecté') : 'Compte déconnecté'}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">200M+ profils, sans licence LinkedIn requise</p>
            <p className="text-xs font-medium text-accent inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-accent" />
              Prêt
            </p>
          </div>
        )}
      </motion.div>

      {/* ── Status Strip ── */}
      <div className="flex items-center justify-center gap-3 flex-wrap">
        {checks.filter(c => c.show).map((c, i) => (
          <span
            key={i}
            className={cn(
              'inline-flex items-center gap-1.5 text-xs py-1 px-2.5 rounded-full border',
              c.status === 'ok' && 'text-accent/80 border-accent/20 bg-accent/5',
              c.status === 'warning' && 'text-primary/80 border-primary/20 bg-primary/5',
              c.status === 'error' && 'text-destructive/80 border-destructive/20 bg-destructive/5',
            )}
          >
            <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', statusDot[c.status])} />
            {c.label}
          </span>
        ))}
      </div>

      {/* ── Auto-fill CTA ── */}
      {onAutoFill && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <ShimmerButton
            onClick={onAutoFill}
            disabled={autoFillLoading || brief.filled < 3}
            className="w-full h-11 text-xs"
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
            <span className="font-bold">Générer les filtres automatiquement</span>
            <span className="text-xs opacity-70">~4 cr</span>
          </ShimmerButton>
        </motion.div>
      )}

      {/* Manual toggle */}
      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
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
            <div className="border border-border rounded-lg p-4 bg-muted/10">
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
          transition={{ delay: 0.4, type: 'spring' }}
          className="sticky bottom-4 pt-2"
        >
          <button
            onClick={onSearch}
            disabled={!filtersReady}
            className={cn(
              'w-full h-11 flex items-center justify-center gap-2 text-sm font-semibold rounded-lg border transition-all',
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
