/**
 * DashboardMissionsPanel — liste des missions actives avec progress visuelle.
 *
 * Pattern Pipedrive : on affiche jusqu'à 5 missions actives sous forme de
 * cards cliquables avec :
 * - Nom + client + status pill
 * - Mini progress bar visuelle des stats clés (sourced → contacted → replied → won)
 * - Compteurs inline
 * - Dernière activité (relative time)
 *
 * CTA en bas : "Voir toutes mes missions" si > 5, sinon "Créer une mission".
 */

import React, { useMemo } from 'react';
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
import type { SourcingProject } from '@/hooks/useSourcingProjects';

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

const MissionCard: React.FC<{
  project: SourcingProject;
  onClick: () => void;
}> = ({ project, onClick }) => {
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

  return (
    <button
      onClick={onClick}
      className="group w-full text-left rounded-xl bg-card border border-border p-4 transition-all hover:shadow-md hover:border-foreground/20"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
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
        <div className="flex items-center gap-2 text-xs">
          <Users className="w-3 h-3 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground flex-shrink-0">Sourcés</span>
          <div className="flex-1 h-1.5 bg-muted/60 rounded-full overflow-hidden">
            <div
              className="h-full bg-foreground/60 rounded-full transition-all"
              style={{ width: `${sourcedPct}%` }}
            />
          </div>
          <span className="font-bold tabular-nums w-8 text-right shrink-0">{total}</span>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <Send className="w-3 h-3 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground flex-shrink-0">Contactés</span>
          <div className="flex-1 h-1.5 bg-muted/60 rounded-full overflow-hidden">
            <div
              className="h-full bg-info/60 rounded-full transition-all"
              style={{ width: `${messagedPct}%` }}
            />
          </div>
          <span className="font-bold tabular-nums w-8 text-right shrink-0">{messaged}</span>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <CheckCircle2 className="w-3 h-3 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground flex-shrink-0">Shortlist</span>
          <div className="flex-1 h-1.5 bg-muted/60 rounded-full overflow-hidden">
            <div
              className="h-full bg-success/60 rounded-full transition-all"
              style={{ width: `${shortlistedPct}%` }}
            />
          </div>
          <span className="font-bold tabular-nums w-8 text-right shrink-0">{shortlisted}</span>
        </div>
      </div>

      {lastActivityLabel && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground/70 mt-3 pt-3 border-t border-border">
          <Clock className="w-3 h-3" />
          {lastActivityLabel}
        </div>
      )}
    </button>
  );
};

export const DashboardMissionsPanel: React.FC<DashboardMissionsPanelProps> = ({
  projects,
  isLoading,
}) => {
  const navigate = useNavigate();

  const activeProjects = useMemo(() => {
    return projects
      .filter(p => p.status === 'active')
      .sort((a, b) => {
        const aTime = new Date(a.last_search_at || a.updated_at).getTime();
        const bTime = new Date(b.last_search_at || b.updated_at).getTime();
        return bTime - aTime;
      })
      .slice(0, 5);
  }, [projects]);

  return (
    <div className="rounded-xl bg-card border border-border overflow-hidden">
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

      <div className="p-3 space-y-2">
        {isLoading ? (
          <>
            {[1, 2, 3].map(i => (
              <div key={i} className="h-[140px] rounded-xl bg-muted/40 animate-pulse" />
            ))}
          </>
        ) : activeProjects.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <div className="h-10 w-10 rounded-full bg-foreground/[0.06] text-muted-foreground flex items-center justify-center mx-auto mb-3">
              <Sparkles className="w-5 h-5" />
            </div>
            <p className="text-sm text-foreground font-medium">
              Aucune mission active
            </p>
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
          </div>
        ) : (
          activeProjects.map(project => (
            <MissionCard
              key={project.id}
              project={project}
              onClick={() => navigate(`/missions/${project.id}`)}
            />
          ))
        )}
      </div>
    </div>
  );
};
