/**
 * DashboardMissionsPanel — liste des missions actives avec progress visuelle.
 *
 * Pattern Pipedrive : on affiche jusqu'à 5 missions actives sous forme de
 * cards cliquables avec :
 * - Nom + client + status pill
 * - Mini progress bar visuelle des stats clés (sourced → contacted → replied → won)
 * - Compteurs inline (animés à l'entrée)
 * - Dernière activité (relative time)
 *
 * V2 anim : stagger entrance des cards, progress bars qui se remplissent
 * en glissant à l'entrée (clip-path animation), hover lift.
 */

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNowStrict, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Briefcase,
  ArrowRight,
  Plus,
  Clock,
  Sparkles,
  Users,
  Send,
  CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCountUp } from '@/hooks/useCountUp';
import type { SourcingProject } from '@/hooks/useSourcingProjects';
import { MissionCompanyLogo } from './MissionCompanyLogo';

interface DashboardMissionsPanelProps {
  projects: SourcingProject[];
  isLoading?: boolean;
}

const STATUS_LABELS: Record<SourcingProject['status'], { label: string; tone: string }> = {
  active: { label: 'Active', tone: 'border-success/40 bg-success/10 text-success' },
  paused: { label: 'En pause', tone: 'border-warning/40 bg-warning/10 text-warning' },
  completed: { label: 'Terminée', tone: 'border-info/40 bg-info/10 text-info' },
  archived: { label: 'Archivée', tone: 'border-border bg-muted/40 text-muted-foreground' },
};

const ProgressRow: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: number;
  pct: number;
  barColor: string;
  delay: number;
}> = ({ icon, label, value, pct, barColor, delay }) => {
  const animValue = useCountUp(value, { duration: 700 });
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="text-muted-foreground flex-shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-muted/60 rounded-full overflow-hidden">
        <motion.div
          className={cn('h-full rounded-full', barColor)}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.7, ease: 'easeOut', delay }}
        />
      </div>
      <span className="font-bold tabular-nums w-8 text-right shrink-0">{animValue}</span>
    </div>
  );
};

const MissionCard: React.FC<{
  project: SourcingProject;
  onClick: () => void;
  index: number;
}> = ({ project, onClick, index }) => {
  const status = STATUS_LABELS[project.status];
  const total = project.stats_total_found || 0;
  const messaged = project.stats_messaged || 0;
  const shortlisted = project.stats_shortlisted || 0;
  const sourcedPct = total > 0 ? 100 : 0;
  const messagedPct = total > 0 ? Math.min((messaged / total) * 100, 100) : 0;
  const shortlistedPct = total > 0 ? Math.min((shortlisted / total) * 100, 100) : 0;

  const lastActivity = project.last_search_at || project.updated_at;
  const lastActivityLabel = (() => {
    try {
      return `il y a ${formatDistanceToNowStrict(parseISO(lastActivity), { locale: fr })}`;
    } catch {
      return null;
    }
  })();

  const baseDelay = 0.1 + index * 0.07;

  return (
    <motion.button
      onClick={onClick}
      variants={{
        hidden: { opacity: 0, y: 10 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } },
      }}
      whileHover={{ y: -2, transition: { duration: 0.15 } }}
      whileTap={{ scale: 0.99 }}
      className="group w-full text-left rounded-xl bg-card border border-border p-4 transition-shadow hover:shadow-md hover:border-foreground/20"
    >
      <div className="flex items-start gap-3 mb-2">
        {/* Logo société client — Clearbit/Google avec fallback initiales colorées */}
        <MissionCompanyLogo
          company={project.client_name || project.name}
          size={44}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-display font-bold text-foreground text-[14px] tracking-tight leading-tight truncate">
              {project.name}
            </h3>
            <span
              className={cn(
                'inline-flex items-center text-[10px] px-2 py-0.5 rounded-full border uppercase tracking-wider font-semibold shrink-0',
                status.tone,
              )}
            >
              {status.label}
            </span>
          </div>
          {project.client_name && (
            <p className="text-xs text-muted-foreground truncate">{project.client_name}</p>
          )}
        </div>
        <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all shrink-0 mt-0.5" />
      </div>

      {/* Progress strip */}
      <div className="space-y-1.5 mt-3">
        <ProgressRow
          icon={<Users className="w-3 h-3" />}
          label="Sourcés"
          value={total}
          pct={sourcedPct}
          barColor="bg-foreground/60"
          delay={baseDelay}
        />
        <ProgressRow
          icon={<Send className="w-3 h-3" />}
          label="Contactés"
          value={messaged}
          pct={messagedPct}
          barColor="bg-info/60"
          delay={baseDelay + 0.1}
        />
        <ProgressRow
          icon={<CheckCircle2 className="w-3 h-3" />}
          label="Shortlist"
          value={shortlisted}
          pct={shortlistedPct}
          barColor="bg-success/60"
          delay={baseDelay + 0.2}
        />
      </div>

      {lastActivityLabel && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground/70 mt-3 pt-3 border-t border-border">
          <Clock className="w-3 h-3" />
          {lastActivityLabel}
        </div>
      )}
    </motion.button>
  );
};

export const DashboardMissionsPanel: React.FC<DashboardMissionsPanelProps> = ({
  projects,
  isLoading,
}) => {
  const navigate = useNavigate();

  const activeProjects = useMemo(() => {
    return projects
      .filter((p) => p.status === 'active')
      .sort((a, b) => {
        const aTime = new Date(a.last_search_at || a.updated_at).getTime();
        const bTime = new Date(b.last_search_at || b.updated_at).getTime();
        return bTime - aTime;
      })
      .slice(0, 5);
  }, [projects]);

  return (
    <motion.div
      className="rounded-xl bg-card border border-border overflow-hidden"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut', delay: 0.1 }}
    >
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border bg-muted/20">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-lg bg-foreground/[0.06] text-foreground flex items-center justify-center shrink-0">
            <Briefcase className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display font-bold text-foreground text-[15px] tracking-tight leading-none">
              Mes missions
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              {activeProjects.length === 0
                ? 'Aucune mission active'
                : `${activeProjects.length} mission${activeProjects.length > 1 ? 's' : ''} active${activeProjects.length > 1 ? 's' : ''}`}
            </p>
          </div>
        </div>
        <button
          onClick={() => navigate('/missions')}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground font-medium transition-colors shrink-0"
        >
          Voir tout
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      <motion.div
        className="p-3 space-y-2"
        initial="hidden"
        animate="visible"
        variants={{
          hidden: {},
          visible: { transition: { staggerChildren: 0.06, delayChildren: 0.1 } },
        }}
      >
        {isLoading ? (
          <>
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-[140px] rounded-xl bg-muted/40 animate-pulse" />
            ))}
          </>
        ) : activeProjects.length === 0 ? (
          <motion.div
            className="rounded-xl border border-dashed border-border p-8 text-center"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4 }}
          >
            <div className="h-10 w-10 rounded-full bg-foreground/[0.06] text-muted-foreground flex items-center justify-center mx-auto mb-3">
              <Sparkles className="w-5 h-5" />
            </div>
            <p className="text-sm text-foreground font-medium">Aucune mission active</p>
            <p className="text-xs text-muted-foreground mt-1 mb-4">
              Créez une mission pour commencer à sourcer
            </p>
            <button
              onClick={() => navigate('/missions?new=1')}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-foreground text-background text-[12px] font-medium hover:opacity-90 transition-opacity"
            >
              <Plus className="w-3.5 h-3.5" />
              Créer une mission
            </button>
          </motion.div>
        ) : (
          activeProjects.map((project, i) => (
            <MissionCard
              key={project.id}
              project={project}
              index={i}
              onClick={() => navigate(`/missions/${project.id}`)}
            />
          ))
        )}
      </motion.div>
    </motion.div>
  );
};
