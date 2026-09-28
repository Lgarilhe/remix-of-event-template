/**
 * DashboardMissionsPanel — les missions actives, les plus récentes d'abord (5 au plus).
 *
 * Une ligne par mission : initiales du client, nom, puis « 140 sourcés ·
 * 24 contactés · 12 retenus ». Le bouton de détail, toujours visible, déplie
 * la progression (part des candidats contactés et retenus) et la date de
 * dernière activité. Préférence de dépliage mémorisée dans le navigateur.
 */

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Briefcase, ChevronDown, Plus } from 'lucide-react';
import { Section, EmptyState, ErrorState } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { SourcingProject } from '@/hooks/useSourcingProjects';
import { MissionCompanyLogo } from './MissionCompanyLogo';
import { plural } from '@/lib/plural';
import { timeAgo } from '@/lib/relativeTime';

interface DashboardMissionsPanelProps {
  projects: SourcingProject[];
  isLoading?: boolean;
  /** Message technique si la lecture des missions a échoué. */
  error?: string | null;
  onRetry?: () => void;
}

const percent = (part: number, total: number) => (total > 0 ? Math.min(Math.round((part / total) * 100), 100) : 0);

const ProgressRow: React.FC<{ label: string; value: number; total: number }> = ({ label, value, total }) => {
  const pct = percent(value, total);
  return (
    <div className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular-nums text-foreground">
        {value} <span className="text-muted-foreground">({pct} %)</span>
      </span>
    </div>
  );
};

const MissionRow: React.FC<{
  project: SourcingProject;
  expanded: boolean;
  onToggleExpand: () => void;
}> = ({ project, expanded, onToggleExpand }) => {
  const total = project.stats_total_found || 0;
  const messaged = project.stats_messaged || 0;
  const shortlisted = project.stats_shortlisted || 0;
  const detailsId = `mission-details-${project.id}`;

  const lastActivity = project.last_search_at || project.updated_at;
  const lastActivityLabel = timeAgo(lastActivity);

  return (
    <li className="rounded-lg transition-colors hover:bg-accent/60">
      <div className="flex items-center gap-2 pr-2">
        <Link
          to={`/missions/${project.id}`}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MissionCompanyLogo company={project.client_name || project.name} size={32} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-foreground">{project.name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {project.client_name && `${project.client_name} · `}
              {plural(total, 'sourcé')} · {plural(messaged, 'contacté')} · {plural(shortlisted, 'retenu')}
            </span>
          </span>
        </Link>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          aria-controls={detailsId}
          aria-label={expanded ? `Masquer le détail de ${project.name}` : `Afficher le détail de ${project.name}`}
        >
          <ChevronDown className={cn('transition-transform duration-150', expanded && 'rotate-180')} aria-hidden="true" />
        </Button>
      </div>

      {expanded && (
        <div id={detailsId} className="space-y-2 px-2.5 pb-3 pl-[3.25rem]">
          <ProgressRow label="Contactés" value={messaged} total={total} />
          <ProgressRow label="Retenus" value={shortlisted} total={total} />
          {lastActivityLabel && <p className="text-xs text-muted-foreground">Dernière activité {lastActivityLabel}</p>}
        </div>
      )}
    </li>
  );
};

// ─── Préférence de dépliage (localStorage) ───────────────────────────────
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
    // stockage plein ou indisponible : la préférence vaut pour la session
  }
};

export const DashboardMissionsPanel: React.FC<DashboardMissionsPanelProps> = ({
  projects,
  isLoading,
  error,
  onRetry,
}) => {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => readExpanded());

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

  const allExpanded = activeProjects.length > 0 && activeProjects.every((p) => expandedIds.has(p.id));

  const toggleAll = useCallback(() => {
    setExpandedIds(allExpanded ? new Set() : new Set(activeProjects.map((p) => p.id)));
  }, [allExpanded, activeProjects]);

  const toggleOne = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const showList = !isLoading && !error && activeProjects.length > 0;

  return (
    <Section
      headingLevel={2}
      title="Mes missions"
      subtitle={showList ? plural(activeProjects.length, 'active') : undefined}
      action={
        <div className="flex items-center gap-1">
          {showList && (
            <Button type="button" variant="ghost" size="xs" onClick={toggleAll}>
              {allExpanded ? 'Tout réduire' : 'Tout déplier'}
            </Button>
          )}
          <Button asChild variant="ghost" size="xs">
            <Link to="/missions">
              Voir tout
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      }
    >
      <div className="p-2">
        {isLoading ? (
          <div className="space-y-2 p-1" role="status" aria-label="Chargement des missions">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : error ? (
          <ErrorState
            variant="compact"
            className="border-0 bg-transparent"
            title="Impossible de charger vos missions"
            description="Vérifiez votre connexion, puis réessayez."
            detail={error}
            onRetry={onRetry}
          />
        ) : activeProjects.length === 0 ? (
          <EmptyState
            variant="compact"
            className="border-0"
            icon={Briefcase}
            title="Aucune mission active"
            description="Créez une mission pour commencer à sourcer."
            action={
              <Button asChild variant="outline" size="sm">
                <Link to="/missions?create=brief">
                  <Plus aria-hidden="true" />
                  Créer une mission
                </Link>
              </Button>
            }
          />
        ) : (
          <ul className="space-y-0.5">
            {activeProjects.map((project) => (
              <MissionRow
                key={project.id}
                project={project}
                expanded={expandedIds.has(project.id)}
                onToggleExpand={() => toggleOne(project.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
};
