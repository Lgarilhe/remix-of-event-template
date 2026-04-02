import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { useAICredits } from '@/hooks/useAICredits';
import { useUnipileQuota } from '@/hooks/useUnipileQuota';
import { ShimmerButton } from '@/components/magicui/shimmer-button';
import {
  CheckCircle2, AlertCircle, XCircle, Globe, Linkedin,
  Sparkle, Search, ChevronDown, Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { countBriefFields } from '@/lib/missionUtils';
import type { JobDetails } from '@/types/jobDetails';

/* ─── Props ─── */
interface SourcingReadinessPanelProps {
  project: SourcingProject;
  selectedAccount: string | null;
  /** Current source: 'linkedin' or 'database' */
  searchSource?: 'linkedin' | 'database';
  /** Switch source at parent level */
  onSourceChange?: (source: 'linkedin' | 'database') => void;
  /** Trigger auto-fill from brief */
  onAutoFill?: () => void;
  autoFillLoading?: boolean;
  /** Trigger search */
  onSearch?: () => void;
  /** Are filters ready (has at least keywords or role) */
  filtersReady?: boolean;
  /** Account display name */
  accountName?: string | null;
  /** Account status */
  accountStatus?: string | null;
}

/* ─── Check item ─── */
type CheckStatus = 'ok' | 'warning' | 'error';

const statusIcon = {
  ok: <CheckCircle2 className="w-4 h-4 text-accent" />,
  warning: <AlertCircle className="w-4 h-4 text-brutal-accent" />,
  error: <XCircle className="w-4 h-4 text-destructive" />,
};

const CheckItem: React.FC<{
  status: CheckStatus;
  label: string;
  detail?: string;
  highlight?: boolean;
  delay?: number;
}> = ({ status, label, detail, highlight = false, delay = 0 }) => (
  <motion.div
    initial={{ opacity: 0, x: -8 }}
    animate={{ opacity: 1, x: 0 }}
    transition={{ delay, duration: 0.3 }}
    className={cn(
      'flex items-center gap-2.5 py-2 px-3 transition-colors',
      highlight ? 'bg-accent/5' : '',
      status === 'ok' && !highlight && 'opacity-60',
    )}
  >
    {statusIcon[status]}
    <div className="min-w-0 flex-1">
      <p className={cn(
        'text-xs font-medium leading-tight',
        highlight ? 'text-foreground' : 'text-foreground/80',
      )}>{label}</p>
      {detail && <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>}
    </div>
  </motion.div>
);

/* ─── Source Card ─── */
const SourceCard: React.FC<{
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
  badge: React.ReactNode;
  delay: number;
}> = ({ selected, onClick, icon, title, description, badge, delay }) => (
  <motion.button
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay, duration: 0.4, type: 'spring' }}
    onClick={onClick}
    className={cn(
      'flex-1 text-left border p-4 transition-all group relative overflow-hidden',
      selected
        ? 'border-accent bg-accent/5 shadow-[4px_4px_0px_0px_hsl(var(--brutal-accent))]'
        : 'border-border bg-background hover:border-border',
    )}
  >
    {selected && (
      <motion.div
        layoutId="source-selected-indicator"
        className="absolute top-0 left-0 w-full h-0.5 bg-accent"
      />
    )}
    <div className="flex items-start gap-3">
      <div className={cn(
        'w-10 h-10 flex items-center justify-center border shrink-0',
        selected
          ? 'bg-accent/10 border-accent/30'
          : 'bg-foreground/5 border-border',
      )}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="text-xs font-bold uppercase tracking-wider text-foreground mb-0.5">{title}</h4>
        <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
        <div className="mt-2">{badge}</div>
      </div>
    </div>
  </motion.button>
);

/* ─── Status Badge ─── */
const StatusBadge: React.FC<{ status: CheckStatus; label: string }> = ({ status, label }) => (
  <span className={cn(
    'inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wider px-2 py-0.5 border',
    status === 'ok' && 'text-accent border-accent/30 bg-accent/10',
    status === 'warning' && 'text-brutal-accent border-accent/30 bg-accent/10',
    status === 'error' && 'text-destructive border-destructive/30 bg-destructive/10',
  )}>
    {statusIcon[status]}
    {label}
  </span>
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
  const quota = useUnipileQuota(selectedAccount);
  const jd = (project.job_details || {}) as Partial<JobDetails>;
  const brief = countBriefFields(jd);
  const [showManualFilters, setShowManualFilters] = useState(false);

  // Account status derivation
  const isAccountOk = accountStatus === 'OK' || accountStatus === 'CONNECTED';
  const hasAccount = !!selectedAccount;
  const accountStatusCheck: CheckStatus = !hasAccount ? 'error' : isAccountOk ? 'ok' : 'warning';

  // Brief status
  const briefStatus: CheckStatus = brief.filled >= 8 ? 'ok' : brief.filled >= 4 ? 'warning' : 'error';

  // Credits status
  const creditsOk = !creditsLoading && creditsRemaining > 0;

  // Quota for invitations
  const invitationQuota = quota.getQuotaUsage('invitationsSent');
  const invitationNearLimit = quota.isNearLimit('invitationsSent');

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="w-full max-w-2xl space-y-6"
    >
      {/* ── Section 1: Source Choice ── */}
      <div>
        <motion.h3
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2"
        >
          <Zap className="w-3.5 h-3.5 text-brutal-accent" />
          Choisissez votre source
        </motion.h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <SourceCard
            selected={searchSource === 'linkedin'}
            onClick={() => onSourceChange?.('linkedin')}
            delay={0.1}
            icon={<Linkedin className="w-5 h-5 text-[#0A66C2]" />}
            title="LinkedIn"
            description="Recherche directe via votre compte"
            badge={
              <StatusBadge
                status={accountStatusCheck}
                label={
                  !hasAccount ? 'Non configuré'
                    : isAccountOk ? `Connecté${accountName ? ` · ${accountName}` : ''}`
                    : 'Déconnecté'
                }
              />
            }
          />

          <SourceCard
            selected={searchSource === 'database'}
            onClick={() => onSourceChange?.('database')}
            delay={0.2}
            icon={<Globe className="w-5 h-5 text-foreground" />}
            title="Base Konekt"
            description="200M+ profils, sans licence LinkedIn"
            badge={
              <StatusBadge status="ok" label="Aucun conflit de session" />
            }
          />
        </div>
      </div>

      {/* ── Section 2: Checklist ── */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">
          Vérifications
        </h3>
        <div className="border border-border divide-y divide-foreground/5">
          <CheckItem
            status={briefStatus}
            label={`Brief complété (${brief.filled}/${brief.total} champs)`}
            detail={brief.filled < 4 ? 'Complétez le brief pour de meilleurs résultats' : undefined}
            highlight={briefStatus !== 'ok'}
            delay={0.15}
          />
          <CheckItem
            status={creditsOk ? 'ok' : 'error'}
            label={creditsLoading
              ? 'Chargement des crédits...'
              : `Crédits IA disponibles (${creditsRemaining.toLocaleString('fr-FR')} cr)`}
            highlight={!creditsOk}
            delay={0.25}
          />
          {searchSource === 'linkedin' && (
            <>
              <CheckItem
                status={invitationNearLimit ? 'warning' : 'ok'}
                label={`Quotas LinkedIn : ${invitationQuota.current}/${invitationQuota.limit} invitations aujourd'hui`}
                highlight={invitationNearLimit}
                delay={0.35}
              />
              <CheckItem
                status={accountStatusCheck}
                label={
                  hasAccount
                    ? `Compte LinkedIn actif${accountName ? ` : ${accountName}` : ''}`
                    : 'Aucun compte LinkedIn connecté'
                }
                detail={!hasAccount ? 'Connectez un compte dans Paramètres' : undefined}
                highlight={accountStatusCheck !== 'ok'}
                delay={0.45}
              />
            </>
          )}
        </div>
      </div>

      {/* ── Section 3: Filters ── */}
      <div className="space-y-3">
        {onAutoFill && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
          >
            <ShimmerButton
              onClick={onAutoFill}
              disabled={autoFillLoading || brief.filled < 3}
              className="w-full h-[44px] text-xs"
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
          transition={{ delay: 0.6 }}
          onClick={() => setShowManualFilters(!showManualFilters)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground uppercase tracking-wider transition-colors mx-auto"
        >
          <span>ou configurez manuellement</span>
          <ChevronDown
            className={cn(
              'w-3 h-3 transition-transform',
              showManualFilters && 'rotate-180',
            )}
          />
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
              <div className="border border-border p-4 bg-muted/20">
                <p className="text-xs text-muted-foreground text-center">
                  Utilisez le panneau de filtres à gauche pour configurer manuellement votre recherche.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Sticky Search CTA ── */}
      {(filtersReady || onSearch) && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7, type: 'spring' }}
          className="sticky bottom-4 pt-2"
        >
          <button
            onClick={onSearch}
            disabled={!filtersReady}
            className={cn(
              'w-full h-[48px] flex items-center justify-center gap-2.5 text-sm font-bold uppercase tracking-wider border-2 transition-all',
              filtersReady
                ? 'border-border bg-foreground text-background hover:bg-foreground/90 shadow-[4px_4px_0px_0px_hsl(var(--brutal-accent))] hover:shadow-[2px_2px_0px_0px_hsl(var(--brutal-accent))] active:shadow-none active:translate-x-[4px] active:translate-y-[4px]'
                : 'border-border bg-foreground/5 text-muted-foreground cursor-not-allowed',
            )}
          >
            <Search className="w-5 h-5" />
            Lancer la recherche
          </button>
        </motion.div>
      )}
    </motion.div>
  );
};
