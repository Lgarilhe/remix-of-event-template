/**
 * DashboardMissionsPanel — « Missions en cours » : les missions actives, les
 * plus récentes d'abord (5 au plus), en tableau (design simplifié,
 * docs/design/06-simplicite.md).
 *
 * Une ligne par mission : initiales du client, nom, visages des candidats en
 * entretien en ce moment, puis trois chiffres. Ces chiffres sont des cumuls
 * depuis le début de la mission (stats_*, lot 0c-1) : un candidat qui avance
 * ou qu'on écarte ne les fait pas baisser, d'où « au total ». Sur téléphone,
 * ils tiennent en une ligne : « 140 sourcés · 12 retenus au total · 24
 * contactés au total ».
 *
 * Dernière activité (lot 0c) : la plus récente de updated_at et de la
 * dernière entrée d'un candidat dans une étape (get_mission_stage_counts),
 * comme la liste des missions. Elle range les missions.
 */

import React, { useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Briefcase, Plus } from 'lucide-react';
import { EmptyState, ErrorState } from '@/components/layout';
import { texturedCard } from '@/components/layout/texturedCard';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AvatarStack } from '@/components/ui/person-avatar';
import type { SourcingProject } from '@/hooks/useSourcingProjects';
import { useMissionStageCounts } from '@/hooks/useMissionStageCounts';
import { missionActivityAt } from '@/lib/stageDisplay';
import { MissionCompanyLogo } from './MissionCompanyLogo';
import { plural } from '@/lib/plural';

export interface InterviewingPeople {
  people: Array<{ name: string; src?: string | null; candidateId?: string | null }>;
  total: number;
}

interface DashboardMissionsPanelProps {
  projects: SourcingProject[];
  /** Candidats en entretien en ce moment, par mission (id nu). */
  interviewing?: Record<string, InterviewingPeople>;
  isLoading?: boolean;
  /** Message technique si la lecture des missions a échoué. */
  error?: string | null;
  onRetry?: () => void;
  /** Zone « Aucune mission active » texturée : seulement quand rien d'autre ne bloque l'accueil (un seul emplacement texturé à la fois). */
  highlightEmpty?: boolean;
}

// Colonnes à partir de 768 px : mission, en entretien, puis les trois cumuls.
const ROW_GRID = 'md:grid-cols-[minmax(0,1fr)_9.5rem_5.5rem_7rem_7.5rem]';

const NumberHeader: React.FC<{ label: string }> = ({ label }) => <span className="text-right">{label}</span>;

const NumberCell: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <span className="hidden text-right text-md tabular-nums text-foreground md:block">
    <span className="sr-only">{label} : </span>
    {value}
  </span>
);

const MissionRow: React.FC<{ project: SourcingProject; interviewing?: InterviewingPeople }> = ({ project, interviewing }) => {
  const total = project.stats_total_found || 0;
  const messaged = project.stats_messaged || 0;
  const shortlisted = project.stats_shortlisted || 0;
  // Client du brief, sinon celui de la mission (comme la liste des missions).
  const clientName = project.jd_client || project.client_name;

  return (
    <li>
      <Link
        to={`/missions/${project.id}`}
        className={`-mx-2 grid grid-cols-1 items-center gap-x-6 gap-y-2 rounded-lg px-2 py-3.5 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${ROW_GRID}`}
      >
        <span className="flex min-w-0 items-center gap-3.5">
          <MissionCompanyLogo company={clientName || project.name} logoUrl={project.jd_client_logo} size={40} />
          <span className="min-w-0">
            <span className="block truncate text-md font-medium text-foreground">{project.name}</span>
            {clientName && <span className="block truncate text-sm text-muted-foreground">{clientName}</span>}
            <span className="block text-pretty text-sm text-muted-foreground md:hidden">
              {plural(total, 'sourcé')} · {plural(shortlisted, 'retenu')} au total · {plural(messaged, 'contacté')} au total
            </span>
          </span>
        </span>
        {interviewing && interviewing.total > 0 ? (
          <span className="flex min-h-7 items-center gap-2.5 pl-[3.375rem] md:pl-0">
            <span className="text-sm text-muted-foreground md:sr-only">En entretien</span>
            <AvatarStack people={interviewing.people} total={interviewing.total} size={30} />
          </span>
        ) : (
          // Sur téléphone, rien à dire : la ligne s'arrête au nom.
          <span className="hidden text-sm text-muted-foreground md:block">Personne pour l'instant</span>
        )}
        <NumberCell label="Sourcés" value={total} />
        <NumberCell label="Retenus au total" value={shortlisted} />
        <NumberCell label="Contactés au total" value={messaged} />
      </Link>
    </li>
  );
};

export const DashboardMissionsPanel: React.FC<DashboardMissionsPanelProps> = ({
  projects,
  interviewing,
  isLoading,
  error,
  onRetry,
  highlightEmpty = false,
}) => {
  const active = useMemo(() => projects.filter((p) => p.status === 'active'), [projects]);
  const { data: counts } = useMissionStageCounts(active.map((p) => p.id));
  const activityOf = useCallback(
    (p: SourcingProject) => missionActivityAt(p.updated_at, counts?.[p.id]?.lastStageMoveAt ?? null),
    [counts],
  );

  const activeProjects = useMemo(() => {
    const time = (p: SourcingProject) => {
      const t = new Date(activityOf(p) ?? 0).getTime();
      return Number.isNaN(t) ? 0 : t;
    };
    return [...active].sort((a, b) => time(b) - time(a)).slice(0, 5);
  }, [active, activityOf]);

  return (
    <section aria-labelledby="dashboard-missions">
      <div className="flex flex-wrap items-baseline justify-between gap-4 pb-3">
        <h2 id="dashboard-missions" className="text-lg font-semibold text-foreground">
          Missions en cours
        </h2>
        <Button asChild variant="link" size="sm" className="min-h-11 px-0 text-muted-foreground md:min-h-0">
          <Link to="/missions">Toutes les missions</Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2" role="status" aria-label="Chargement des missions">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
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
          variant={highlightEmpty ? 'default' : 'compact'}
          className={highlightEmpty ? texturedCard('teal', 'border-0 py-10') : 'border-0'}
          icon={Briefcase}
          title="Aucune mission active"
          description="Créez une mission pour commencer à sourcer."
          action={
            <Button asChild variant={highlightEmpty ? 'primary' : 'outline'} size="sm" className="min-h-11 md:min-h-0">
              <Link to="/missions?create=brief">
                <Plus aria-hidden="true" />
                Créer une mission
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          {/* En-tête de colonnes à partir de 768 px ; chaque cellule se lit aussi seule. */}
          <div aria-hidden="true" className={`hidden gap-x-6 pb-2.5 text-xs font-medium text-muted-foreground md:grid ${ROW_GRID}`}>
            <span>Mission</span>
            <span>En entretien</span>
            <NumberHeader label="Sourcés" />
            <NumberHeader label="Retenus au total" />
            <NumberHeader label="Contactés au total" />
          </div>
          <ul className="divide-y divide-border border-y border-border">
            {activeProjects.map((project) => (
              <MissionRow key={project.id} project={project} interviewing={interviewing?.[project.id]} />
            ))}
          </ul>
          <p className="pt-2.5 text-xs text-muted-foreground">Chiffres depuis le début de chaque mission.</p>
        </>
      )}
    </section>
  );
};
