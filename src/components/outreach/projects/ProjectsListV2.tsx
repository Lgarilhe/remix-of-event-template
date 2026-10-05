/**
 * ProjectsListV2 : liste des missions (/missions), au langage de la nouvelle
 * page mission (docs/design/01-direction.md, docs/design/06-simplicite.md).
 *
 * Deux groupes, chacun trié par dernière activité réelle (la plus récente de
 * updated_at et de la dernière entrée d'un candidat dans une étape) :
 *   En cours                 missions actives et en pause
 *   Terminées, archivées     repliable, un simple titre avec son nombre
 *
 * Une ligne par mission : le logo du client (initiales sinon), le nom, le client
 * dessous en discret, puis les effectifs « en ce moment » sous le nom de
 * l'étape (À trier, Contacté, A répondu, En entretien), les mêmes que les
 * colonnes du Pipeline, et « N profils trouvés » (jamais ouverts, au Sourcing).
 * Aucun zéro écrit : une case à zéro reste vide (lue « 0 » par un lecteur
 * d'écran), une colonne vide pour toutes les missions n'est pas affichée. Les
 * candidats en entretien montrent leur visage (useInterviewingPeople), sinon le
 * nombre. Sous 1 280 px, une phrase sous le nom reprend les nombres non nuls.
 * Chiffres lus dans get_mission_stage_counts (useMissionStageCounts) : jamais de
 * zéro inventé, une attente tant qu'ils se chargent, « indisponible » s'ils
 * manquent. La liste elle-même a son attente et son état d'erreur : une lecture
 * en échec ne s'affiche pas comme « aucune mission ».
 *
 * Dernière activité : écrite une seule fois par ligne, en discret, et
 * seulement quand elle date d'au moins une heure (missionListFormat.ts).
 * Sous 640 px : toute la ligne ouvre la mission (le nom n'a pas de zone à lui) ; « N profils
 * trouvés » a une zone de 44 px de haut prise vers le bas seulement (marge négative, bouton
 * positionné pour passer au-dessus de la phrase qui le suit), jamais au-dessus, pour ne pas voler
 * les touchers du nom ; les boutons de la ligne d'action, positionnés et plus bas, gardent leur
 * zone là où elles se recouvrent. La phrase des effectifs passe à la ligne
 * au lieu d'être coupée, les entrées du menu et les boutons de la confirmation font 44 px.
 * Le menu de la ligne apparaît au survol, au focus clavier ou au toucher
 * (REVEAL_ON_ROW : l'opacité seule change, il reste atteignable au clavier). La confirmation
 * de suppression rend le focus à ce bouton quand on l'annule (au début de la liste si la
 * mission est supprimée).
 *
 * Prochaine action (lot 3) : une ligne par mission En cours, calculée par
 * missionListAction (src/lib/missionNextAction.ts, la règle de la carte
 * « Maintenant ») à partir des compteurs ci-dessus, de get_mission_attention
 * (une seule requête pour toutes les missions) et des « Plus tard » de la
 * personne. Pas de blocage LinkedIn par ligne (il reste sur la carte de la
 * mission) ni de tri par urgence. Attente : un bloc gris de hauteur réservée ;
 * lecture impossible : « Impossible de vérifier » avec Réessayer, jamais un
 * zéro ; rien à proposer : aucun texte (la hauteur reste), jamais « Rien ne presse ».
 * Couleur du texte courant ; orange seulement quand une réponse de candidat
 * attend (rang 3 de la règle).
 */

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Plus, Search, MoreHorizontal, Play, Pause, CheckCircle, Archive, Trash2,
  ChevronRight, RefreshCw, ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSourcingProjects, SourcingProject } from '@/hooks/useSourcingProjects';
import { useQuotaGate } from '@/hooks/useQuotaGate';
import { UnifiedProject, toUnifiedProjects } from '@/types/projects';
import { useMissionStageCounts, type MissionStageCounts } from '@/hooks/useMissionStageCounts';
import { useMissionAttention } from '@/hooks/useMissionAttention';
import { useMissionActionSnoozes } from '@/hooks/useMissionActionSnoozes';
import { GENERAL_STAGE_LABEL, missionActivityAt } from '@/lib/stageDisplay';
import {
  missionListAction, sourceOk, SOURCE_LOADING, SOURCE_UNAVAILABLE,
  type ActionIntent, type MissionListAction, type SourceState,
} from '@/lib/missionNextAction';
import { snoozeChecker } from '@/lib/missionSnooze';
import { missionV3Path, V3_PARAM } from '@/lib/missionBeta';
import { plural } from '@/lib/plural';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { AvatarStack } from '@/components/ui/person-avatar';
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
import { MissionCompanyLogo } from '@/components/dashboard/MissionCompanyLogo';
import { REVEAL_ON_ROW } from '@/components/missions/v3/cadrage/sectionUi';
import { CreateMissionV2 } from '@/components/missions/v2/CreateMissionV2';
import { EmptyMissionState } from '@/components/missions/EmptyMissionState';
import { PartnerMissionsSection } from '@/components/marketplace/PartnerMissionsSection';
import { MissionQuotaNotice } from '@/components/missions/MissionQuotaNotice';
import { missionQuotaMessage } from '@/lib/sidebarMissions';
import { toast } from 'sonner';
import { activityLabel, countsPhrase, missionsSentence, type ListCounts } from './missionListFormat';
import { useInterviewingPeople, type InterviewingPerson } from './useInterviewingPeople';

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

interface CountColumn {
  label: string;
  of: (c: MissionStageCounts) => number;
  /** Colonne des candidats en entretien : leurs visages quand on les connaît, sinon le nombre. */
  faces?: boolean;
}

const COUNT_COLUMNS: ReadonlyArray<CountColumn> = [
  { label: GENERAL_STAGE_LABEL.to_sort, of: (c) => c.toSort },
  { label: GENERAL_STAGE_LABEL.contacted, of: (c) => c.contacted },
  { label: GENERAL_STAGE_LABEL.replied, of: (c) => c.replied },
  { label: GENERAL_STAGE_LABEL.interviewing, of: (c) => c.interviewing, faces: true },
];

/** Les effectifs affichés d'une mission, sous la forme que lit missionListFormat. */
const listCountsOf = (c: MissionStageCounts): ListCounts => ({
  toSort: c.toSort, contacted: c.contacted, replied: c.replied, interviewing: c.interviewing,
});

/**
 * Colonnes d'un groupe. Colonnes à partir de 1 280 px : dessous, une phrase
 * et la date prennent place sous le nom. Une colonne vide
 * pour toutes les missions du groupe n'est pas affichée.
 */
interface ListLayout {
  columns: ReadonlyArray<CountColumn>;
  /** Groupe replié des terminées : les effectifs non nuls en une phrase à droite, sans en-têtes. */
  phrase: boolean;
  activity: boolean;
}

/**
 * Nombre ; une attente tant qu'il se charge, une cellule vide (lue « indisponible »)
 * si la lecture a échoué ou ne rend pas la mission, une cellule vide (lue « 0 »)
 * pour un zéro. Jamais un zéro écrit ni inventé.
 */
const CountCell: React.FC<{ value: number | null; pending: boolean }> = ({ value, pending }) => {
  if (value === null) {
    return pending
      ? <Skeleton className="ml-auto h-4 w-6" aria-hidden="true" />
      : <span className="sr-only">Indisponible</span>;
  }
  if (value === 0) return <span className="sr-only">0</span>;
  return <span className="tabular-nums text-foreground">{value}</span>;
};

/** Candidats en entretien : leurs visages (le nombre total en « +N »), sinon le nombre. */
const InterviewingCell: React.FC<{ value: number | null; pending: boolean; people?: InterviewingPerson[] }> = ({
  value, pending, people,
}) => {
  if (value === null || value === 0 || !people || people.length === 0) {
    return <CountCell value={value} pending={pending} />;
  }
  return <AvatarStack people={people} total={value} size={30} className="justify-end" />;
};

// ── Prochaine action ──

const LOADING_ACTION: MissionListAction = {
  state: 'loading', rank: null, text: null, note: null, intent: null, snoozeKey: null,
};

/** Une donnée lue, sinon une attente, sinon « indisponible » (jamais un zéro). */
function sourceOfValue<T>(value: T | null, pending: boolean): SourceState<T> {
  if (value !== null) return sourceOk(value);
  return pending ? SOURCE_LOADING : SOURCE_UNAVAILABLE;
}

/**
 * Adresse que vise la ligne d'action : la fiche d'un candidat quand l'intention
 * est d'ouvrir une ligne, sinon l'écran de la mission qui convient. Les
 * intentions que la liste ne produit pas (blocage, formule, e-mail) ouvrent la
 * mission. « Trier » ouvre le Pipeline filtré sur À trier (?etape=to_sort) :
 * la section À trier de la liste sans filtre est repliée et sous les autres
 * étapes, et son ouverture n'a pas d'adresse.
 */
function actionPath(missionId: string, intent: ActionIntent | null): string {
  switch (intent?.type) {
    case 'open_row':
      return missionV3Path(missionId, 'pipeline', { [V3_PARAM.panel]: 'fiche', [V3_PARAM.candidate]: intent.rowId });
    case 'open_conversation':
      return `/inbox?chatId=${encodeURIComponent(intent.chatId)}`;
    case 'filter_stage':
      return missionV3Path(missionId, 'pipeline', { [V3_PARAM.stage]: intent.stage });
    case 'open_to_sort':
      return missionV3Path(missionId, 'pipeline', { [V3_PARAM.stage]: 'to_sort' });
    case 'contact_retained':
      return missionV3Path(missionId, 'pipeline', { [V3_PARAM.stage]: 'retained' });
    case 'open_sourcing':
      return missionV3Path(missionId, 'sourcing');
    case 'open_cadrage':
      return missionV3Path(missionId, 'cadrage', { [V3_PARAM.section]: intent.section });
    default:
      return missionV3Path(missionId);
  }
}

/**
 * La ligne d'action d'une mission. Même hauteur dans tous les états, y compris
 * quand il n'y a rien à proposer (un espace sans texte) : la liste ne saute pas
 * quand les lectures arrivent. Sous 640 px, 44 px de haut pour le doigt.
 * Couleur du texte courant ; orange seulement quand une réponse de candidat
 * attend (rang 3 de la règle).
 * L'élément racine reste le même d'un état à l'autre : « Réessayer » lui passe
 * le focus avant de relire, sinon le bouton démonté le ferait tomber sur la page.
 */
const ActionLine: React.FC<{
  action: MissionListAction;
  missionName: string;
  onAction: () => void;
  onRetry: () => void;
}> = ({ action, missionName, onAction, onRetry }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const retry = () => {
    rootRef.current?.focus();
    onRetry();
  };

  let content: React.ReactNode = null;
  if (action.state === 'loading') {
    content = (
      <>
        <Skeleton className="h-3.5 w-44 max-w-full" aria-hidden="true" />
        <span className="sr-only">Chargement de la prochaine action</span>
      </>
    );
  } else if (action.state === 'unavailable') {
    content = (
      <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <span>Impossible de vérifier.</span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); retry(); }}
          className="relative rounded-sm text-foreground-secondary underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:min-h-11"
        >
          Réessayer
        </button>
      </div>
    );
  } else if (action.state !== 'none') {
    content = (
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onAction(); }}
          aria-label={`${action.text ?? ''}, ${missionName}`}
          className={cn(
            'relative inline-flex min-w-0 items-center gap-1.5 rounded-sm text-left font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:min-h-11',
            action.rank === '3' ? 'text-warning' : 'text-foreground',
          )}
        >
          <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{action.text}</span>
        </button>
        {action.note && <span className="shrink-0 text-muted-foreground">{action.note}</span>}
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      tabIndex={action.state === 'none' ? undefined : -1}
      role={action.state === 'loading' ? 'status' : undefined}
      aria-hidden={action.state === 'none' ? true : undefined}
      className="mt-1 flex h-5 min-w-0 items-center text-sm outline-none max-sm:h-11"
    >
      {content}
    </div>
  );
};

// ── Ligne de mission ──

interface MissionRowProps {
  project: UnifiedProject;
  /** Groupe replié des terminées et archivées : la ligne garde sa forme, en plus discret. */
  archived?: boolean;
  layout: ListLayout;
  /** Compteurs de la mission ; null tant qu'ils ne sont pas lus (ou en échec). */
  counts: MissionStageCounts | null;
  /** Compteurs en cours de lecture (attente plutôt que « indisponible »). */
  countsPending: boolean;
  /** Candidats en entretien, quand on connaît leurs visages. */
  people?: InterviewingPerson[];
  /** Date d'activité (updated_at ou dernière entrée dans une étape). */
  activityAt: string | null;
  /** Heure de la liste (avance à la minute) : sert à écrire l'activité. */
  now: number;
  /** Prochaine action ; null pour une mission qui n'est pas En cours (pas de ligne). */
  action: MissionListAction | null;
  onAction: () => void;
  onRetryAction: () => void;
  onOpen: () => void;
  onOpenSourcing: () => void;
  onStatusChange: (status: SourcingProject['status']) => void;
  /** Ouvre la confirmation ; reçoit le bouton « ... » de la ligne, à qui rendre le focus si on annule. */
  onDelete: (opener: HTMLElement | null) => void;
  canDelete: boolean;
}

const MissionRow: React.FC<MissionRowProps> = ({
  project, archived, layout, counts, countsPending, people, activityAt, now, action, onAction, onRetryAction,
  onOpen, onOpenSourcing, onStatusChange, onDelete, canDelete,
}) => {
  const activity = activityLabel(activityAt, new Date(now));
  const showJobTitle = !!project.jobTitle && project.jobTitle.trim().toLowerCase() !== project.name.trim().toLowerCase();
  // Le client d'abord : c'est de lui que parle le logo.
  const subline = [project.clientName, showJobTitle ? project.jobTitle : null, project.location].filter(Boolean).join(' · ');
  const statusLabel = project.status !== 'active' ? STATUS_LABEL[project.status] : null;
  const phrase = counts ? countsPhrase(listCountsOf(counts)) : '';
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  return (
    <tr
      data-testid="mission-row"
      onClick={onOpen}
      className={cn(
        'group cursor-pointer border-b border-border transition-colors duration-150 hover:bg-muted/40',
        archived && 'text-foreground-secondary',
      )}
    >
      <td className={cn('min-w-0 pl-3 pr-3 sm:pl-2', archived ? 'py-2.5' : 'py-3.5')}>
        <div className="flex min-w-0 items-center gap-3.5">
          {/* Jamais d'opacité sur le logo : elle faisait passer ses initiales sous 4,5:1.
              Une mission terminée est atténuée par la couleur de son texte. */}
          <MissionCompanyLogo
            company={project.clientName || project.name}
            size={archived ? 32 : 40}
          />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-baseline gap-2.5">
              {/* Pas de zone agrandie sur téléphone : toute la ligne ouvre la mission, et une zone
                  de 44 px au-dessus de « N profils trouvés » lui volait ses touchers. */}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onOpen(); }}
                className={cn(
                  'min-w-0 truncate rounded-sm text-left text-md font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  archived ? 'text-foreground-secondary' : 'text-foreground',
                )}
                title={project.name}
              >
                {project.name}
              </button>
              {statusLabel && <span className="shrink-0 text-sm text-muted-foreground">{statusLabel}</span>}
            </div>
            <p className="flex min-w-0 items-center gap-x-2 text-sm text-muted-foreground">
              {/* Client, poste, lieu, puis l'activité (sous 1 280 px : au-delà, elle a sa colonne) :
                  une seule ligne, c'est la fin qui se coupe. */}
              {(subline || activity) && (
                <span className="min-w-0 truncate">
                  {subline}
                  {activity && <span className="xl:hidden">{subline ? ' · ' : ''}Activité {activity}</span>}
                </span>
              )}
              {counts && counts.unopened > 0 && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onOpenSourcing(); }}
                  className="shrink-0 rounded-sm underline decoration-muted-foreground/50 underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:relative max-sm:-mb-6 max-sm:pb-6"
                >
                  {plural(counts.unopened, 'profil trouvé', 'profils trouvés')}
                </button>
              )}
            </p>
            {/* Sous 1 280 px les colonnes d'effectifs disparaissent : une seule phrase, sans zéro, les reprend.
                Elle passe à la ligne plutôt que d'être coupée : c'est la seule trace des nombres. */}
            {counts ? (
              phrase && <p className="mt-0.5 text-sm text-muted-foreground xl:hidden">{phrase}</p>
            ) : countsPending ? (
              <div className="mt-1 xl:hidden">
                <Skeleton className="h-3.5 w-40 max-w-full" aria-hidden="true" />
                <span className="sr-only">Chargement des effectifs</span>
              </div>
            ) : (
              <p className="mt-0.5 text-sm text-muted-foreground xl:hidden">Effectifs indisponibles</p>
            )}
            {action && (
              <ActionLine action={action} missionName={project.name} onAction={onAction} onRetry={onRetryAction} />
            )}
          </div>
        </div>
      </td>
      {layout.columns.map((col) => (
        <td key={col.label} className="hidden py-3.5 pr-3 text-right text-md xl:table-cell">
          {col.faces
            ? <InterviewingCell value={counts ? col.of(counts) : null} pending={countsPending} people={people} />
            : <CountCell value={counts ? col.of(counts) : null} pending={countsPending} />}
        </td>
      ))}
      {layout.phrase && (
        <td className="hidden py-2.5 pr-3 text-right text-sm text-muted-foreground xl:table-cell">{phrase}</td>
      )}
      {layout.activity && (
        <td className="hidden py-3.5 pr-3 text-right text-sm tabular-nums text-muted-foreground xl:table-cell">
          {activity ?? ''}
        </td>
      )}
      <td className="py-2 pr-2 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              ref={menuTriggerRef}
              variant="ghost"
              size="icon-sm"
              onClick={(e) => e.stopPropagation()}
              aria-label={`Actions pour ${project.name}`}
              title="Plus d'actions"
              className={cn(REVEAL_ON_ROW, 'data-[state=open]:opacity-100 max-sm:h-11 max-sm:w-11')}
            >
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          {/* Le contenu du menu est dans un portail, mais l'évènement remonte par l'arbre React
              jusqu'à la ligne : sans cet arrêt, chaque action ouvrirait aussi la mission. */}
          <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
            {project.status !== 'active' && (
              <DropdownMenuItem onClick={() => onStatusChange('active')} className="max-sm:min-h-11">
                <Play className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Activer
              </DropdownMenuItem>
            )}
            {project.status !== 'paused' && (
              <DropdownMenuItem onClick={() => onStatusChange('paused')} className="max-sm:min-h-11">
                <Pause className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Mettre en pause
              </DropdownMenuItem>
            )}
            {project.status !== 'completed' && (
              <DropdownMenuItem onClick={() => onStatusChange('completed')} className="max-sm:min-h-11">
                <CheckCircle className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Marquer terminée
              </DropdownMenuItem>
            )}
            {project.status !== 'archived' && (
              <DropdownMenuItem onClick={() => onStatusChange('archived')} className="max-sm:min-h-11">
                <Archive className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Archiver
              </DropdownMenuItem>
            )}
            {canDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onDelete(menuTriggerRef.current)} className="text-danger focus:text-danger max-sm:min-h-11">
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

/** Largeur de la colonne des visages (trois visages et « +N ») et des nombres. */
const columnWidth = (col: CountColumn) => (col.faces ? 'w-32' : 'w-20');

/**
 * Tableau d'un groupe : une rangée d'en-têtes seulement s'il y a des colonnes
 * d'effectifs à nommer (le groupe replié des terminées n'en a pas).
 */
const MissionTable: React.FC<{ caption: string; layout: ListLayout; children: React.ReactNode }> = ({
  caption, layout, children,
}) => (
  <div className="-mx-3 overflow-x-auto sm:mx-0">
    <table className="w-full table-fixed border-collapse text-sm">
      <caption className="sr-only">{caption}</caption>
      <colgroup>
        <col />
        {layout.columns.map((col) => <col key={col.label} className={cn('hidden xl:table-column', columnWidth(col))} />)}
        {layout.phrase && <col className="hidden w-72 xl:table-column" />}
        {layout.activity && <col className="hidden w-28 xl:table-column" />}
        <col className="w-12 max-sm:w-16" />
      </colgroup>
      {layout.columns.length > 0 && (
        <thead className="hidden xl:table-header-group">
          <tr className="h-9 border-b border-border text-left text-xs font-medium text-muted-foreground">
            <th scope="col" className="pl-3 pr-3 font-medium sm:pl-2">Mission</th>
            {layout.columns.map((col) => (
              <th key={col.label} scope="col" className="hidden pr-3 text-right font-medium xl:table-cell">{col.label}</th>
            ))}
            {layout.activity && (
              <th scope="col" className="hidden pr-3 text-right font-medium xl:table-cell">Activité</th>
            )}
            <th scope="col" className="pr-2 text-right font-medium"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
      )}
      <tbody>{children}</tbody>
    </table>
  </div>
);

const LoadingRows: React.FC = () => (
  <div aria-busy="true" aria-label="Chargement des missions">
    {[0, 1, 2, 3].map((i) => (
      <div key={i} className="flex items-center gap-3.5 border-b border-border py-3.5 pl-3 pr-3 sm:pl-2">
        <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-4 w-56 max-w-full" />
          <Skeleton className="mt-2 h-3.5 w-36 max-w-full" />
        </div>
        <Skeleton className="hidden h-4 w-40 xl:block" />
      </div>
    ))}
  </div>
);

/**
 * Colonnes d'un groupe, d'après les missions affichées. Pendant la première
 * lecture des compteurs, toutes les colonnes d'effectifs attendent (squelettes) ;
 * ensuite, seules celles qui ont un nombre non nul pour une mission au moins.
 */
function groupLayout(
  rows: readonly UnifiedProject[],
  countsOf: (p: UnifiedProject) => MissionStageCounts | null,
  activityOf: (p: UnifiedProject) => string | null,
  now: number,
  countsWaiting: boolean,
  archived: boolean,
): ListLayout {
  const known = rows.map(countsOf);
  const at = new Date(now);
  return {
    columns: archived ? [] : countsWaiting ? COUNT_COLUMNS : COUNT_COLUMNS.filter(col => known.some(c => c !== null && col.of(c) > 0)),
    phrase: archived && known.some(c => c !== null && countsPhrase(listCountsOf(c)) !== ''),
    activity: rows.some(p => activityLabel(activityOf(p), at) !== null),
  };
}

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
  // Focus de la confirmation de suppression : le bouton « ... » de la ligne (invisible hors
  // survol) le reprend à la fermeture ; sinon, le début de la liste. Sans cela il tombait sur <body>.
  const deleteOpenerRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

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
  const summary = useMemo((): ListCounts | null => {
    const rows = ongoingProjects.map(countsOf);
    const known = rows.length > 0 && rows.every((c): c is MissionStageCounts => c !== null);
    if (!known) return null;
    const all = rows as MissionStageCounts[];
    const sum = (of: (c: MissionStageCounts) => number) => all.reduce((n, c) => n + of(c), 0);
    return {
      toSort: sum(c => c.toSort),
      contacted: sum(c => c.contacted),
      replied: sum(c => c.replied),
      interviewing: sum(c => c.interviewing),
    };
  }, [ongoingProjects, countsOf]);

  // Prochaine action de chaque mission En cours : la règle de la carte
  // « Maintenant » en forme courte. Une seule requête d'attention pour toutes
  // les missions ; les reports sont ceux de la personne, les mêmes que sur la
  // carte. L'heure avance à la minute pour qu'un report finisse sans rechargement.
  const ongoingIds = useMemo(() => ongoingProjects.map(p => p.sourcingProject.id), [ongoingProjects]);
  const attentionQuery = useMissionAttention(ongoingIds);
  const { index: snoozes, isLoading: snoozesWaiting } = useMissionActionSnoozes();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // Hors ligne, React Query met la requête en pause : « indisponible », pas une attente sans fin.
  const countsWaiting = countsQuery.isPending && countsQuery.fetchStatus !== 'paused';
  const attentionWaiting = attentionQuery.isPending && attentionQuery.fetchStatus !== 'paused';
  const attention = attentionQuery.data;
  const actions = useMemo(() => {
    const out = new Map<string, MissionListAction>();
    for (const p of ongoingProjects) {
      const id = p.sourcingProject.id;
      // Un report non lu ferait paraître puis disparaître une action : on attend.
      out.set(id, snoozesWaiting ? LOADING_ACTION : missionListAction({
        now,
        mission: { id, name: p.name, status: p.status },
        counts: sourceOfValue(counts?.[id] ?? null, countsWaiting),
        attention: sourceOfValue(attention?.[id] ?? null, attentionWaiting),
        snoozed: snoozeChecker(snoozes, id, now),
      }));
    }
    return out;
  }, [ongoingProjects, counts, attention, snoozes, now, countsWaiting, attentionWaiting, snoozesWaiting]);

  const refetchCounts = countsQuery.refetch;
  const refetchAttention = attentionQuery.refetch;
  const retryActions = useCallback(() => {
    void refetchCounts();
    void refetchAttention();
  }, [refetchCounts, refetchAttention]);

  // Visages des candidats en entretien : une lecture, pour les missions En cours qui en ont.
  const faceIds = useMemo(
    () => ongoingProjects.map(p => p.sourcingProject.id).filter(id => (counts?.[id]?.interviewing ?? 0) > 0),
    [ongoingProjects, counts],
  );
  const interviewingPeople = useInterviewingPeople(faceIds).data;

  // Colonnes de chaque groupe, d'après les missions affichées.
  const ongoingLayout = useMemo(
    () => groupLayout(groups.ongoing, countsOf, activityOf, now, countsWaiting, false),
    [groups.ongoing, countsOf, activityOf, now, countsWaiting],
  );
  const archiveLayout = useMemo(
    () => groupLayout(groups.archive, countsOf, activityOf, now, countsWaiting, true),
    [groups.archive, countsOf, activityOf, now, countsWaiting],
  );

  // La mission s'ouvre sans ?tab= ; « N profils trouvés » va droit au Sourcing
  // (MissionEntry convertit l'adresse pour l'ancienne page).
  const navigateToWorkspace = useCallback((project: UnifiedProject) => {
    navigate(`/missions/${encodeURIComponent(project.sourcingProject.id)}`);
  }, [navigate]);
  const navigateToSourcing = useCallback((project: UnifiedProject) => {
    navigate(`/missions/${encodeURIComponent(project.sourcingProject.id)}/sourcing`);
  }, [navigate]);
  const navigateToAction = useCallback((project: UnifiedProject, action: MissionListAction | null) => {
    navigate(actionPath(project.sourcingProject.id, action?.intent ?? null));
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

  // Une phrase, seulement ce qui n'est pas nul : effectifs « en ce moment »
  // additionnés sur les missions En cours (missionListFormat.ts).
  const subtitle = !hasData ? undefined : missionsSentence(ongoingProjects.length, summary);

  const renderRow = (project: UnifiedProject, layout: ListLayout, archived = false) => {
    const id = project.sourcingProject.id;
    const action = actions.get(id) ?? null;
    return (
      <MissionRow
        key={project.key}
        project={project}
        archived={archived}
        layout={layout}
        counts={countsOf(project)}
        countsPending={countsQuery.isPending}
        people={interviewingPeople?.[id]}
        activityAt={activityOf(project)}
        now={now}
        action={action}
        onAction={() => navigateToAction(project, action)}
        onRetryAction={retryActions}
        onOpen={() => navigateToWorkspace(project)}
        onOpenSourcing={() => navigateToSourcing(project)}
        onStatusChange={handleStatusChange(project)}
        onDelete={(opener) => { deleteOpenerRef.current = opener; setDeleteTarget(project); }}
        canDelete={!!project.sourcingProject}
      />
    );
  };

  // Deux groupes : le titre « En cours » ne sert qu'à les distinguer, il est
  // seulement lu par un lecteur d'écran quand il n'y en a qu'un.
  const twoGroups = groups.ongoing.length > 0 && groups.archive.length > 0;

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
              className="max-sm:min-h-11"
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
          <Button variant="ghost" size="xs" className="max-sm:min-h-11" onClick={() => { void countsQuery.refetch(); }}>
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
          className="pl-9 max-sm:h-11"
        />
      </div>

      {isLoading && <LoadingRows />}

      {loadFailed && (
        <ErrorState
          variant="compact"
          className="border-0 bg-transparent"
          title="Impossible de charger vos missions"
          description="Vérifiez votre connexion, puis réessayez."
          onRetry={() => { void refetchProjects(); }}
        />
      )}

      {/* Les deux groupes : le début de la liste reprend le focus quand la mission supprimée n'existe plus. */}
      <div ref={listRef} tabIndex={-1} role="group" aria-label="Liste des missions" className="outline-none">
        {/* ── En cours ── */}
        {!isLoading && groups.ongoing.length > 0 && (
          <section className="mb-10" aria-labelledby="missions-en-cours">
            <h2 id="missions-en-cours" className={twoGroups ? 'mb-1 text-lg font-semibold text-foreground' : 'sr-only'}>
              En cours
            </h2>
            <MissionTable caption="Missions en cours" layout={ongoingLayout}>
              {groups.ongoing.map((project) => renderRow(project, ongoingLayout))}
            </MissionTable>
          </section>
        )}

        {/* ── Terminées, archivées (repliable) : un titre avec son nombre, sans cadre ni en-têtes ── */}
        {!isLoading && groups.archive.length > 0 && (
          <section className="mb-10" aria-labelledby="missions-archivees">
            <h2 className="mb-1">
              <button
                type="button"
                onClick={() => { if (!searchActive) setShowArchive(s => !s); }}
                aria-expanded={archiveOpen}
                className="-ml-1 inline-flex items-center gap-2 rounded-md px-1 py-1 text-lg font-semibold text-foreground hover:text-foreground-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:min-h-11"
              >
                <ChevronRight
                  className={cn('h-4 w-4 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none', archiveOpen && 'rotate-90')}
                  aria-hidden="true"
                />
                <span id="missions-archivees">Terminées, archivées</span>
                <span className="text-sm font-normal text-muted-foreground">{plural(groups.archive.length, 'mission')}</span>
              </button>
            </h2>
            {archiveOpen && (
              <MissionTable caption="Missions terminées et archivées" layout={archiveLayout}>
                {groups.archive.map((project) => renderRow(project, archiveLayout, true))}
              </MissionTable>
            )}
          </section>
        )}
      </div>

      {/* ── Missions partenaires (cabinets et indépendants) ── */}
      {!isLoading && <PartnerMissionsSection />}

      {/* Recherche sans résultat */}
      {!isLoading && filtered.length === 0 && unifiedProjects.length > 0 && (
        <div className="px-4 py-10 text-center">
          <p className="text-md text-foreground">Aucune mission trouvée.</p>
          <p className="mt-1 text-sm text-muted-foreground">
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
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            // Annuler ou Échap : retour au bouton « ... » de la ligne. Supprimer : la ligne va
            // disparaître (opener vidé au clic), le focus va au début de la liste.
            event.preventDefault();
            const opener = deleteOpenerRef.current;
            deleteOpenerRef.current = null;
            (opener && opener.isConnected ? opener : listRef.current)?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette mission ?</AlertDialogTitle>
            <AlertDialogDescription>
              « {deleteTarget?.name} » sera supprimée définitivement avec tous ses candidats sourcés et messages.
              Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="max-sm:min-h-11">Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 max-sm:min-h-11"
              onClick={async () => {
                // La fenêtre se ferme dès le clic, avant la fin de la suppression : la ligne
                // part, on ne lui rend pas le focus.
                deleteOpenerRef.current = null;
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
