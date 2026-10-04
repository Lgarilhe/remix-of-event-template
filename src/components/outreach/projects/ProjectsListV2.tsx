/**
 * ProjectsListV2 : liste des missions (/missions), au langage de la nouvelle
 * page mission (docs/design/01-direction.md).
 *
 * Deux groupes, chacun trié par dernière activité réelle (la plus récente de
 * updated_at et de la dernière entrée d'un candidat dans une étape) :
 *   En cours                 missions actives et en pause
 *   Terminées, archivées     repliable
 *
 * Une ligne par mission : nom, poste, client et lieu du brief, puis les
 * effectifs « en ce moment » sous le nom de l'étape (À trier, Contacté,
 * A répondu, En entretien), les mêmes que les colonnes du Pipeline, et
 * « N profils trouvés » (jamais ouverts, au Sourcing). Chiffres lus dans
 * get_mission_stage_counts (useMissionStageCounts) : jamais de zéro inventé,
 * une attente tant qu'ils se chargent, « indisponible » s'ils manquent. La
 * liste elle-même a son attente et son état d'erreur : une lecture en échec ne
 * s'affiche pas comme « aucune mission ». Aucune prochaine étape calculée ici (lot 3).
 */

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Plus, Search, MoreHorizontal, Play, Pause, CheckCircle, Archive, Trash2,
  ChevronRight, RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSourcingProjects, SourcingProject } from '@/hooks/useSourcingProjects';
import { useQuotaGate } from '@/hooks/useQuotaGate';
import { UnifiedProject, toUnifiedProjects } from '@/types/projects';
import { useMissionStageCounts, type MissionStageCounts } from '@/hooks/useMissionStageCounts';
import { GENERAL_STAGE_LABEL, missionActivityAt } from '@/lib/stageDisplay';
import { plural } from '@/lib/plural';
import { timeAgo } from '@/lib/relativeTime';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/layout/PageHeader';
import { ErrorState } from '@/components/layout/ErrorState';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { CreateMissionV2 } from '@/components/missions/v2/CreateMissionV2';
import { EmptyMissionState } from '@/components/missions/EmptyMissionState';
import { PartnerMissionsSection } from '@/components/marketplace/PartnerMissionsSection';
import { MissionQuotaNotice } from '@/components/missions/MissionQuotaNotice';
import { missionQuotaMessage } from '@/lib/sidebarMissions';
import { toast } from 'sonner';

// ── Statuts ──

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  paused: 'En pause',
  completed: 'Terminée',
  archived: 'Archivée',
};

/** Groupe « En cours » : missions actives et en pause. */
const isOngoing = (status: SourcingProject['status']) => status === 'active' || status === 'paused';

// ── Effectifs affichés, dans l'ordre du Pipeline ──

const COUNT_COLUMNS: ReadonlyArray<{ label: string; of: (c: MissionStageCounts) => number }> = [
  { label: GENERAL_STAGE_LABEL.to_sort, of: (c) => c.toSort },
  { label: GENERAL_STAGE_LABEL.contacted, of: (c) => c.contacted },
  { label: GENERAL_STAGE_LABEL.replied, of: (c) => c.replied },
  { label: GENERAL_STAGE_LABEL.interviewing, of: (c) => c.interviewing },
];

/**
 * Nombre ; une attente tant qu'il se charge, une cellule vide (lue « indisponible »)
 * si la lecture a échoué ou ne rend pas la mission. Jamais un zéro inventé.
 */
const CountCell: React.FC<{ value: number | null; pending: boolean }> = ({ value, pending }) => {
  if (value === null) {
    return pending
      ? <Skeleton className="ml-auto h-4 w-6" aria-hidden="true" />
      : <span className="sr-only">Indisponible</span>;
  }
  return (
    <span className={cn('tabular-nums', value ? 'text-foreground' : 'text-muted-foreground')}>{value}</span>
  );
};

// ── Ligne de mission ──

interface MissionRowProps {
  project: UnifiedProject;
  /** Compteurs de la mission ; null tant qu'ils ne sont pas lus (ou en échec). */
  counts: MissionStageCounts | null;
  /** Compteurs en cours de lecture (attente plutôt que « indisponible »). */
  countsPending: boolean;
  /** Date d'activité (updated_at ou dernière entrée dans une étape). */
  activityAt: string | null;
  onOpen: () => void;
  onOpenSourcing: () => void;
  onStatusChange: (status: SourcingProject['status']) => void;
  onDelete: () => void;
  canDelete: boolean;
}

const MissionRow: React.FC<MissionRowProps> = ({
  project, counts, countsPending, activityAt, onOpen, onOpenSourcing, onStatusChange, onDelete, canDelete,
}) => {
  const activity = timeAgo(activityAt);
  const showJobTitle = !!project.jobTitle && project.jobTitle.trim().toLowerCase() !== project.name.trim().toLowerCase();
  const subline = [showJobTitle ? project.jobTitle : null, project.clientName, project.location].filter(Boolean).join(' · ');
  const statusLabel = project.status !== 'active' ? STATUS_LABEL[project.status] : null;

  return (
    <tr
      data-testid="mission-row"
      onClick={onOpen}
      className="group h-[60px] cursor-pointer border-b border-border/50 transition-colors duration-150 hover:bg-muted/40"
    >
      <td className="min-w-0 py-2 pl-3 pr-3 sm:pl-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpen(); }}
            className="min-w-0 truncate rounded-sm text-left text-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={project.name}
          >
            {project.name}
          </button>
          {statusLabel && (
            <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{statusLabel}</span>
          )}
        </div>
        <p className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          {subline && <span className="truncate">{subline}</span>}
          {activity && <span className="shrink-0 lg:hidden">Activité {activity}</span>}
          {counts && counts.unopened > 0 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onOpenSourcing(); }}
              className="shrink-0 rounded-sm text-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {plural(counts.unopened, 'profil trouvé', 'profils trouvés')}
            </button>
          )}
        </p>
        {/* Sous 768 px les colonnes d'effectifs disparaissent : une seule phrase les reprend. */}
        <p className="mt-0.5 truncate text-xs text-muted-foreground md:hidden">
          {counts
            ? COUNT_COLUMNS.map(({ label, of }) => `${label} ${of(counts)}`).join(' · ')
            : countsPending ? 'Chargement des effectifs' : 'Effectifs indisponibles'}
        </p>
      </td>
      {COUNT_COLUMNS.map(({ label, of }) => (
        <td key={label} className="hidden py-2 pr-3 text-right text-sm md:table-cell">
          <CountCell value={counts ? of(counts) : null} pending={countsPending} />
        </td>
      ))}
      <td className="hidden py-2 pr-3 text-right text-xs tabular-nums text-muted-foreground lg:table-cell">
        {activity ?? ''}
      </td>
      <td className="py-2 pr-2 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={(e) => e.stopPropagation()}
              aria-label={`Actions pour ${project.name}`}
              title="Plus d'actions"
            >
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          {/* Le contenu du menu est dans un portail, mais l'évènement remonte par l'arbre React
              jusqu'à la ligne : sans cet arrêt, chaque action ouvrirait aussi la mission. */}
          <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
            {project.status !== 'active' && (
              <DropdownMenuItem onClick={() => onStatusChange('active')}>
                <Play className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Activer
              </DropdownMenuItem>
            )}
            {project.status !== 'paused' && (
              <DropdownMenuItem onClick={() => onStatusChange('paused')}>
                <Pause className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Mettre en pause
              </DropdownMenuItem>
            )}
            {project.status !== 'completed' && (
              <DropdownMenuItem onClick={() => onStatusChange('completed')}>
                <CheckCircle className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Marquer terminée
              </DropdownMenuItem>
            )}
            {project.status !== 'archived' && (
              <DropdownMenuItem onClick={() => onStatusChange('archived')}>
                <Archive className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Archiver
              </DropdownMenuItem>
            )}
            {canDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onDelete} className="text-danger focus:text-danger">
                  <Trash2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Supprimer
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
};

// ── Tableau d'un groupe ──

const MissionTable: React.FC<{ caption: string; children: React.ReactNode }> = ({ caption, children }) => (
  <div className="-mx-3 overflow-x-auto sm:mx-0">
    <table className="w-full table-fixed border-collapse text-sm">
      <caption className="sr-only">{caption}</caption>
      <colgroup>
        <col />
        {COUNT_COLUMNS.map(({ label }) => <col key={label} className="hidden w-24 md:table-column" />)}
        <col className="hidden w-24 lg:table-column" />
        <col className="w-12" />
      </colgroup>
      <thead>
        <tr className="h-[34px] border-b border-border text-left text-xs text-muted-foreground">
          <th scope="col" className="pl-3 pr-3 font-normal sm:pl-2">Mission</th>
          {COUNT_COLUMNS.map(({ label }) => (
            <th key={label} scope="col" className="hidden pr-3 text-right font-normal md:table-cell">{label}</th>
          ))}
          <th scope="col" className="hidden pr-3 text-right font-normal lg:table-cell">Activité</th>
          <th scope="col" className="pr-2 text-right font-normal"><span className="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  </div>
);

const LoadingRows: React.FC = () => (
  <div className="space-y-0" aria-busy="true" aria-label="Chargement des missions">
    {[0, 1, 2, 3].map((i) => (
      <div key={i} className="flex h-[60px] items-center gap-4 border-b border-border/50 px-2">
        <div className="min-w-0 flex-1">
          <Skeleton className="h-4 w-56 max-w-full" />
          <Skeleton className="mt-1.5 h-3 w-40 max-w-full" />
        </div>
        <Skeleton className="hidden h-4 w-40 md:block" />
      </div>
    ))}
  </div>
);

// ─────────────────────────────────────────────────────────────────
// Composant principal
// ─────────────────────────────────────────────────────────────────

export const ProjectsListV2: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    projects: sourcingProjects, isLoading: spLoading, hasData, isError: listError, refetch: refetchProjects,
    deleteProject, updateProject,
  } = useSourcingProjects();
  const { canCreateJob, jobQuotaKnown, maxJobs } = useQuotaGate();

  const [searchQuery, setSearchQuery] = useState('');
  const [showArchive, setShowArchive] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createInitialTab, setCreateInitialTab] = useState<string | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<UnifiedProject | null>(null);

  // Honor ?create=mode deep links (barre latérale, palette, tableau de bord,
  // onboarding). Attend que le plafond de missions soit connu : au plafond, le
  // formulaire ne s'ouvre pas, le paramètre est retiré et l'encart gris est déjà
  // à la place du bouton.
  const createParam = searchParams.get('create');
  useEffect(() => {
    if (!createParam || !['brief', 'import', 'manual'].includes(createParam)) return;
    if (!jobQuotaKnown) return;
    if (canCreateJob) {
      setCreateInitialTab(createParam);
      setShowCreateModal(true);
    } else if (maxJobs !== null) {
      toast.info(missionQuotaMessage(maxJobs));
    }
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete('create');
      return next;
    }, { replace: true });
  }, [createParam, jobQuotaKnown, canCreateJob, maxJobs, setSearchParams]);

  const unifiedProjects = useMemo(
    () => toUnifiedProjects(sourcingProjects),
    [sourcingProjects],
  );

  const spIds = useMemo(
    () => unifiedProjects.map(p => p.sourcingProject?.id).filter((id): id is string => !!id),
    [unifiedProjects],
  );

  // Compteurs d'étapes : une seule lecture pour toutes les missions.
  const countsQuery = useMissionStageCounts(spIds);
  const counts = countsQuery.data;
  const countsOf = useCallback(
    (project: UnifiedProject): MissionStageCounts | null => counts?.[project.sourcingProject.id] ?? null,
    [counts],
  );
  const activityOf = useCallback(
    (project: UnifiedProject): string | null =>
      missionActivityAt(project.updatedAt, countsOf(project)?.lastStageMoveAt ?? null) ?? project.createdAt,
    [countsOf],
  );

  // Recherche : nom, poste, client et lieu du brief.
  const filtered = useMemo(() => unifiedProjects.filter(p => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      p.name.toLowerCase().includes(q)
      || !!p.jobTitle?.toLowerCase().includes(q)
      || !!p.clientName?.toLowerCase().includes(q)
      || !!p.location?.toLowerCase().includes(q)
    );
  }), [unifiedProjects, searchQuery]);

  // Deux groupes, chacun trié par dernière activité.
  const groups = useMemo(() => {
    const time = (p: UnifiedProject) => {
      const t = new Date(activityOf(p) ?? 0).getTime();
      return Number.isNaN(t) ? 0 : t;
    };
    const byActivity = (a: UnifiedProject, b: UnifiedProject) => time(b) - time(a);
    return {
      ongoing: filtered.filter(p => isOngoing(p.status)).sort(byActivity),
      archive: filtered.filter(p => !isOngoing(p.status)).sort(byActivity),
    };
  }, [filtered, activityOf]);

  // Sous-titre : missions « En cours » seulement, effectifs additionnés ; rien
  // tant qu'une de ces missions n'a pas ses compteurs.
  const ongoingProjects = useMemo(() => unifiedProjects.filter(p => isOngoing(p.status)), [unifiedProjects]);
  const summary = useMemo(() => {
    const rows = ongoingProjects.map(countsOf);
    const known = rows.length > 0 && rows.every((c): c is MissionStageCounts => c !== null);
    const sum = (of: (c: MissionStageCounts) => number) =>
      known ? (rows as MissionStageCounts[]).reduce((n, c) => n + of(c), 0) : null;
    return {
      toSort: sum(c => c.toSort),
      contacted: sum(c => c.contacted),
      replied: sum(c => c.replied),
      interviewing: sum(c => c.interviewing),
    };
  }, [ongoingProjects, countsOf]);

  // La mission s'ouvre sans ?tab= ; « N profils trouvés » va droit au Sourcing
  // (MissionEntry convertit l'adresse pour l'ancienne page).
  const navigateToWorkspace = useCallback((project: UnifiedProject) => {
    navigate(`/missions/${encodeURIComponent(project.sourcingProject.id)}`);
  }, [navigate]);
  const navigateToSourcing = useCallback((project: UnifiedProject) => {
    navigate(`/missions/${encodeURIComponent(project.sourcingProject.id)}/sourcing`);
  }, [navigate]);

  const handleStatusChange = (project: UnifiedProject) => async (newStatus: SourcingProject['status']) => {
    if (!project.sourcingProject) return;
    try {
      await updateProject({ id: project.sourcingProject.id, status: newStatus });
    } catch {
      // le toast d'échec est posé par onError du hook
    }
  };

  // Liste pas encore reçue (requête en cours, en attente du réseau ou pas encore
  // activée) : une attente, jamais l'état vide. Liste en échec sans donnée : un
  // état d'erreur, jamais l'état vide non plus.
  // Une recherche déplie les terminées et archivées : sans cela, un résultat
  // qui s'y trouve resterait caché sans message.
  const searchActive = searchQuery.trim() !== '';
  const archiveOpen = showArchive || searchActive;
  const isLoading = spLoading || (!hasData && !listError);
  const loadFailed = !hasData && listError;

  // Aucune mission : état vide de l'écran entier.
  if (hasData && unifiedProjects.length === 0) {
    return (
      <>
        {/* Missions confiées par une entreprise (cabinets et indépendants) :
            affichées avant l'état vide, qui parle des missions propres. */}
        <div className="mx-auto mb-6 w-full max-w-[1200px]">
          <PartnerMissionsSection />
        </div>
        <EmptyMissionState
          onCreateAI={() => { setCreateInitialTab('brief'); setShowCreateModal(true); }}
          onCreateManual={() => { setCreateInitialTab('manual'); setShowCreateModal(true); }}
        />
        {showCreateModal && (
          <CreateMissionV2
            isOpen={showCreateModal}
            onClose={() => { setShowCreateModal(false); setCreateInitialTab(undefined); }}
            initialMode={
              createInitialTab === 'manual' ? 'manual'
              : createInitialTab === 'brief' ? 'brief'
              : 'choose'
            }
          />
        )}
      </>
    );
  }

  // Effectifs « en ce moment », sous le nom de l'étape (À trier, Contacté,
  // A répondu, En entretien), additionnés sur les missions En cours.
  const subtitle = !hasData ? undefined : [
    plural(ongoingProjects.length, 'mission en cours', 'missions en cours'),
    summary.toSort !== null ? `${summary.toSort} à trier` : null,
    summary.contacted !== null ? plural(summary.contacted, 'contacté', 'contactés') : null,
    summary.replied !== null ? plural(summary.replied, 'a répondu', 'ont répondu') : null,
    summary.interviewing !== null ? `${summary.interviewing} en entretien` : null,
  ].filter(Boolean).join(', ');

  const renderRow = (project: UnifiedProject) => (
    <MissionRow
      key={project.key}
      project={project}
      counts={countsOf(project)}
      countsPending={countsQuery.isPending}
      activityAt={activityOf(project)}
      onOpen={() => navigateToWorkspace(project)}
      onOpenSourcing={() => navigateToSourcing(project)}
      onStatusChange={handleStatusChange(project)}
      onDelete={() => setDeleteTarget(project)}
      canDelete={!!project.sourcingProject}
    />
  );

  return (
    <div className="mx-auto w-full max-w-[1200px]">
      <PageHeader
        title="Missions"
        subtitle={subtitle}
        actions={
          !canCreateJob && maxJobs !== null ? (
            <MissionQuotaNotice maxJobs={maxJobs} className="max-w-xs" />
          ) : (
            <Button
              variant="primary"
              onClick={() => { setCreateInitialTab('brief'); setShowCreateModal(true); }}
            >
              <Plus aria-hidden="true" />
              Nouvelle mission
            </Button>
          )
        }
      />

      {countsQuery.isError && (
        <p className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground" role="alert">
          Les effectifs des missions n'ont pas pu être chargés.
          <Button variant="outline" size="xs" onClick={() => { void countsQuery.refetch(); }}>
            <RefreshCw aria-hidden="true" />
            Réessayer
          </Button>
        </p>
      )}

      {/* ── Recherche ── */}
      <div className="relative mb-6 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          placeholder="Rechercher une mission, un client, un poste"
          aria-label="Rechercher une mission"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {isLoading && <LoadingRows />}

      {loadFailed && (
        <ErrorState
          variant="compact"
          title="Impossible de charger vos missions"
          description="Vérifiez votre connexion, puis réessayez."
          onRetry={() => { void refetchProjects(); }}
        />
      )}

      {/* ── En cours ── */}
      {!isLoading && groups.ongoing.length > 0 && (
        <section className="mb-8" aria-labelledby="missions-en-cours">
          <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <h2 id="missions-en-cours" className="eyebrow">En cours</h2>
            <span className="text-xs text-muted-foreground">
              {plural(groups.ongoing.length, 'mission active ou en pause', 'missions actives ou en pause')}
            </span>
          </div>
          <MissionTable caption="Missions en cours">{groups.ongoing.map(renderRow)}</MissionTable>
        </section>
      )}

      {/* ── Terminées, archivées (repliable) ── */}
      {!isLoading && groups.archive.length > 0 && (
        <section className="mb-8" aria-labelledby="missions-archivees">
          <button
            type="button"
            onClick={() => { if (!searchActive) setShowArchive(s => !s); }}
            aria-expanded={archiveOpen}
            className="mb-2 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-semibold hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight
              className={cn('h-3.5 w-3.5 transition-transform duration-150', archiveOpen && 'rotate-90')}
              aria-hidden="true"
            />
            <span id="missions-archivees">Terminées, archivées</span>
            <span className="text-xs font-normal text-muted-foreground">{plural(groups.archive.length, 'mission')}</span>
          </button>
          {archiveOpen && (
            <MissionTable caption="Missions terminées et archivées">{groups.archive.map(renderRow)}</MissionTable>
          )}
        </section>
      )}

      {/* ── Missions partenaires (cabinets et indépendants) ── */}
      {!isLoading && <PartnerMissionsSection />}

      {/* Recherche sans résultat */}
      {!isLoading && filtered.length === 0 && unifiedProjects.length > 0 && (
        <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
          <p className="text-sm text-foreground">Aucune mission trouvée.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Essayez avec d'autres mots-clés ou effacez la recherche.
          </p>
        </div>
      )}

      {/* ── Fenêtres ── */}
      {showCreateModal && (
        <CreateMissionV2
          isOpen={showCreateModal}
          onClose={() => { setShowCreateModal(false); setCreateInitialTab(undefined); }}
          initialMode={
            createInitialTab === 'manual' ? 'manual'
            : createInitialTab === 'brief' ? 'brief'
            : 'choose'
          }
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette mission ?</AlertDialogTitle>
            <AlertDialogDescription>
              « {deleteTarget?.name} » sera supprimée définitivement avec tous ses candidats sourcés et messages.
              Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (deleteTarget?.sourcingProject) {
                  try {
                    await deleteProject(deleteTarget.sourcingProject.id);
                  } catch {
                    // le toast d'échec est posé par onError du hook
                  }
                }
                setDeleteTarget(null);
              }}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
