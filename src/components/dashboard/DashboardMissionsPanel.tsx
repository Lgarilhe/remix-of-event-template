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
 * V2 anim : stagger entrance des cards, progress bars qui se remplissent,
 * hover lift, AnimatePresence pour l'expand/collapse fluide.
 *
 * V3 (mai 2026) : mode compact par défaut + chevron par card pour expand,
 * + bouton "Tout déplier / Tout réduire" en header. Persistance localStorage
 * de la préférence (compact vs détaillé) ET du set des cards expanded.
 */

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
  ChevronDown,
  Maximize2,
  Minimize2,
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
  expanded: boolean;
  onToggleExpand: () => void;
}> = ({ project, onClick, index, expanded, onToggleExpand }) => {
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
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 10 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } },
      }}
      whileHover={{ y: -2, transition: { duration: 0.15 } }}
      className="group rounded-xl bg-card border border-border transition-shadow hover:shadow-md hover:border-foreground/20 overflow-hidden"
    >
      {/* Row principale — toujours visible, cliquable pour ouvrir la mission */}
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left p-3 flex items-center gap-3"
      >
        {/* Logo société client */}
        <MissionCompanyLogo
          company={project.client_name || project.name}
          size={40}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
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
          {/* Compact summary inline — visible quand collapsed */}
          {!expanded ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {project.client_name && (
                <>
                  <span className="truncate">{project.client_name}</span>
                  <span className="text-muted-foreground/40">·</span>
                </>
              )}
              <span className="inline-flex items-center gap-1 tabular-nums shrink-0">
                <Users className="w-3 h-3" />
                {total}
              </span>
              <span className="inline-flex items-center gap-1 tabular-nums shrink-0">
                <Send className="w-3 h-3" />
                {messaged}
              </span>
              <span className="inline-flex items-center gap-1 tabular-nums shrink-0">
                <CheckCircle2 className="w-3 h-3 text-success/70" />
                {shortlisted}
              </span>
            </div>
          ) : (
            project.client_name && (
              <p className="text-xs text-muted-foreground truncate">{project.client_name}</p>
            )
          )}
        </div>

        <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all shrink-0" />
      </button>

      {/* Bouton chevron — toggle expand, séparé pour ne pas trigger le navigate */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleExpand();
        }}
        aria-label={expanded ? 'Réduire' : 'Voir le détail'}
        aria-expanded={expanded}
        className="absolute right-3 bottom-3 h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-muted/60 transition-colors opacity-0 group-hover:opacity-100"
      >
        <ChevronDown className={cn('w-4 h-4 transition-transform', expanded && 'rotate-180')} />
      </button>

      {/* Détails expandables — progress bars + last activity */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-1.5 pt-1 border-t border-border">
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
              {lastActivityLabel && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground/70 pt-2 mt-2 border-t border-border/60">
                  <Clock className="w-3 h-3" />
                  {lastActivityLabel}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

// ─── Persistance des préférences (localStorage) ───────────────────────────
const STORAGE_KEY = 'dashboard-missions-expanded';
const readExpanded = (): Set<string> => {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch {
    return new Set();
  }
};
const writeExpanded = (ids: Set<string>) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // localStorage plein → ignore
  }
};

export const DashboardMissionsPanel: React.FC<DashboardMissionsPanelProps> = ({
  projects,
  isLoading,
}) => {
  const navigate = useNavigate();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => readExpanded());

  // Persiste à chaque changement
  useEffect(() => {
    writeExpanded(expandedIds);
  }, [expandedIds]);

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

  const allExpanded =
    activeProjects.length > 0 && activeProjects.every((p) => expandedIds.has(p.id));

  const toggleAll = useCallback(() => {
    setExpandedIds((prev) => {
      if (allExpanded) return new Set();
      return new Set(activeProjects.map((p) => p.id));
    });
  }, [allExpanded, activeProjects]);

  const toggleOne = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

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
        <div className="flex items-center gap-1.5 shrink-0">
          {activeProjects.length > 0 && (
            <button
              onClick={toggleAll}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-border bg-background hover:bg-accent text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
              aria-label={allExpanded ? 'Tout réduire' : 'Tout déplier'}
              title={allExpanded ? 'Tout réduire' : 'Tout déplier'}
            >
              {allExpanded ? (
                <>
                  <Minimize2 className="w-3 h-3" />
                  Réduire
                </>
              ) : (
                <>
                  <Maximize2 className="w-3 h-3" />
                  Déplier
                </>
              )}
            </button>
          )}
          <button
            onClick={() => navigate('/missions')}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground font-medium transition-colors"
          >
            Voir tout
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>
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
              <div key={i} className="h-[60px] rounded-xl bg-muted/40 animate-pulse" />
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
            <div key={project.id} className="relative">
              <MissionCard
                project={project}
                index={i}
                expanded={expandedIds.has(project.id)}
                onToggleExpand={() => toggleOne(project.id)}
                onClick={() => navigate(`/missions/${project.id}`)}
              />
            </div>
          ))
        )}
      </motion.div>
    </motion.div>
  );
};
