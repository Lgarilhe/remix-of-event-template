import React, { useState, useMemo, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, useSensor, useSensors, useDroppable, useDraggable,
  rectIntersection,
} from '@dnd-kit/core';
import { useQueryClient } from '@tanstack/react-query';
import {
  PROJECT_CANDIDATES_MAX_ROWS,
  SourcingProject,
  patchProjectCandidateStages,
  useProjectCandidates,
  type ProjectCandidateRow,
} from '@/hooks/useSourcingProjects';
import { useMissionProcess } from '@/hooks/useMissionProcess';
import { useMissionStageCounts } from '@/hooks/useMissionStageCounts';
import { ProjectCandidatesTableEnhanced } from '@/components/outreach/projects/ProjectCandidatesTableEnhanced';
import { CandidateDetailModal } from '@/components/ats/CandidateDetailModal';
import { TutorialVideoDialog } from '@/components/help/TutorialVideoDialog';
import { PIPELINE_TUTORIAL } from '@/components/help/tutorials';
import { ATSCandidate } from '@/hooks/useATSData';
import { BrutalLoader } from '@/components/ui/brutal-loader';
import { Button } from '@/components/ui/button';
import { isGeneralStage, missionColumnToStage, setCandidateStages, stageErrorMessage, type StageTarget } from '@/lib/candidateStage';
import {
  GENERAL_STAGE_LABEL,
  MISSION_COLUMN_KEY,
  MISSION_STEP_MISSING_LABEL,
  STALE_AFTER_DAYS,
  invalidateStageReaders,
  isStale,
  missionColumnOf,
  stageAgeDays,
} from '@/lib/stageDisplay';
import { plural } from '@/lib/plural';
import { recommendationLabel } from '@/types/projects';
import { List, LayoutGrid, Clock, MessageSquare, ChevronRight, Linkedin, Users, Send, ListChecks, ArrowRight, UserSearch, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface MissionPipelineProps {
  project: SourcingProject;
}

// Ligne de la vue mission_candidate_rows (lot 0c) : une par candidat, doublons
// réunis ; group_ids porte toutes les lignes du candidat dans la mission, qu'un
// geste écrit ensemble (sinon un recul serait masqué par l'autre ligne).
type ProjectCandidate = ProjectCandidateRow;

/** Lignes du candidat dans la mission (la ligne affichée seule si la vue ne les rend pas). */
const groupIdsOf = (c: ProjectCandidate): string[] => (c.group_ids && c.group_ids.length > 0 ? c.group_ids : [c.id]);

// ── Thème sémantique des colonnes ──
// Sémantique, pas positionnel : « Embauché » est TOUJOURS vert, « Contacté »
// toujours info, quel que soit le nombre d'étapes de process intercalées.
// Jetons du thème seulement ; les couleurs de la pastille de l'étape suivent
// celles de la liste de la nouvelle page (retenu : warning, a répondu : brand).

type ColTheme = { dot: string; ring: string };

const NEUTRAL: ColTheme = { dot: 'bg-muted-foreground/50', ring: 'ring-foreground/25' };
const INFO: ColTheme = { dot: 'bg-info', ring: 'ring-info/40' };
const SUCCESS: ColTheme = { dot: 'bg-success', ring: 'ring-success/40' };
const REPLIED_T: ColTheme = { dot: 'bg-brand', ring: 'ring-brand/50' };
const RETAINED_T: ColTheme = { dot: 'bg-warning', ring: 'ring-warning/40' };
const INTERVIEW_T: ColTheme = { dot: 'bg-foreground/60', ring: 'ring-foreground/30' };
const STEP_MISSING_T: ColTheme = { dot: 'bg-warning', ring: 'ring-warning/40' };
const DISMISSED_T: ColTheme = { dot: 'bg-destructive/60', ring: 'ring-destructive/40' };
const STEP_THEMES: ColTheme[] = [
  { dot: 'bg-foreground/70', ring: 'ring-foreground/30' },
  { dot: 'bg-foreground/55', ring: 'ring-foreground/30' },
  { dot: 'bg-foreground/40', ring: 'ring-foreground/25' },
  { dot: 'bg-muted-foreground', ring: 'ring-foreground/25' },
];

interface PipelineColumn {
  key: string;
  label: string;
  theme: ColTheme;
}

// Colonnes (lot 0c) : À trier, Retenu, Contacté, A répondu, une colonne par
// étape d'entretien de la mission (ou « En entretien » sans étapes), Embauché,
// puis Écarté à part. Clés de MISSION_COLUMN_KEY, relues par
// missionColumnToStage ; « A répondu » garde la clé « Répondu » (décision 29).
const STAGE_COLUMN = (stage: keyof typeof MISSION_COLUMN_KEY, theme: ColTheme): PipelineColumn => ({
  key: MISSION_COLUMN_KEY[stage],
  label: GENERAL_STAGE_LABEL[stage],
  theme,
});
const HEAD_COLUMNS: PipelineColumn[] = [
  STAGE_COLUMN('to_sort', NEUTRAL),
  STAGE_COLUMN('retained', RETAINED_T),
  STAGE_COLUMN('contacted', INFO),
  STAGE_COLUMN('replied', REPLIED_T),
];
const INTERVIEWING_COLUMN = STAGE_COLUMN('interviewing', INTERVIEW_T);
const HIRED_COLUMN = STAGE_COLUMN('hired', SUCCESS);
const DISMISSED_COLUMN = STAGE_COLUMN('rejected', DISMISSED_T);
/**
 * En entretien sans étape de la mission, sur une mission qui en a : colonne
 * affichée seulement si besoin, hors de la barre, sans dépôt (la base
 * exigerait une étape).
 */
const STEP_MISSING_COLUMN: PipelineColumn = {
  key: MISSION_COLUMN_KEY.interviewing,
  label: MISSION_STEP_MISSING_LABEL,
  theme: STEP_MISSING_T,
};

// ── Helpers ──

function nameHash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
const AVATAR_THEMES = [
  'bg-muted text-foreground',
  'bg-brand/15 text-brand',
  'bg-info-muted text-info',
  'bg-success-muted text-success',
  'bg-warning-muted text-warning',
];
const avatarTheme = (name?: string | null) => AVATAR_THEMES[nameHash(name || '?') % AVATAR_THEMES.length];
const initials = (name?: string | null) => {
  const p = (name || '').trim().split(/\s+/).filter(Boolean);
  return p.length ? ((p[0][0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() : '?';
};

// Ancienneté dans l'étape : stage_entered_at (lot 0c), à défaut updated_at puis
// created_at. « Sans mouvement » : Contacté, A répondu ou En entretien depuis
// STALE_AFTER_DAYS jours ou plus (isStale, src/lib/stageDisplay.ts).
const daysInStage = (c: ProjectCandidate) => stageAgeDays(c) ?? 0;
const stageAgeText = (d: number) => (d < 1 ? "Dans cette étape depuis aujourd'hui" : `Dans cette étape depuis ${d}\u00a0j`);

const EMPTY_COPY: Record<string, string> = {
  [MISSION_COLUMN_KEY.to_sort]: 'Aucun candidat à trier',
  [MISSION_COLUMN_KEY.retained]: 'Aucun candidat retenu',
  [MISSION_COLUMN_KEY.contacted]: "Personne n'a encore été contacté",
  [MISSION_COLUMN_KEY.replied]: 'Aucune réponse pour le moment',
  [MISSION_COLUMN_KEY.interviewing]: 'Personne en entretien',
  [MISSION_COLUMN_KEY.hired]: 'Ça se joue à gauche',
  [MISSION_COLUMN_KEY.rejected]: 'Rien à écarter, bon signe',
};

// ── Kanban Card ──

const KanbanCard = React.memo(({ candidate, isOverlay, dimmed }: { candidate: ProjectCandidate; isOverlay?: boolean; dimmed?: boolean }) => {
  const name = candidate.candidate_name || 'Candidat inconnu';
  const days = daysInStage(candidate);
  const stale = isStale(candidate);

  return (
    <div className={cn(
      "group bg-card border border-border rounded-lg p-2.5 cursor-grab active:cursor-grabbing select-none interactive-card",
      dimmed && "opacity-70 hover:opacity-100",
      isOverlay && "shadow-xl ring-1 ring-foreground/20 rotate-1 scale-[1.02] cursor-grabbing"
    )}>
      <div className="flex items-start gap-2.5">
        <span className={cn(
          "w-7 h-7 rounded-full grid place-items-center font-display text-3xs font-bold shrink-0 mt-px select-none",
          avatarTheme(candidate.candidate_name)
        )}>
          {initials(candidate.candidate_name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold leading-tight text-foreground truncate">{name}</p>
          <p className="text-2xs text-muted-foreground leading-snug truncate mt-0.5">{candidate.candidate_headline || 'Sans titre'}</p>
        </div>
        {candidate.score != null && (
          <span
            title={recommendationLabel(candidate.recommendation, candidate.skip_reason)}
            className={cn(
              "inline-flex items-center h-[18px] px-1.5 rounded-full text-2xs font-bold tabular-nums shrink-0 ring-1 ring-inset",
              candidate.score >= 70 ? "bg-success/10 text-success ring-success/20" :
              candidate.score >= 40 ? "bg-warning/10 text-warning ring-warning/20" :
              "bg-destructive/10 text-destructive ring-destructive/20"
            )}
          >
            {candidate.score}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5 mt-1.5 pl-[38px] min-h-[20px]">
        {candidate.replied_at && candidate.general_stage !== 'replied' && (
          <span title="A répondu"><MessageSquare className="w-3 h-3 text-success" /></span>
        )}
        <span
          className={cn("inline-flex items-center gap-1 text-3xs tabular-nums", stale ? "text-warning font-semibold" : "text-muted-foreground/70")}
        >
          <Clock className="w-3 h-3" aria-hidden="true" /> {stageAgeText(days)}
        </span>
        {candidate.linkedin_profile_url && (
          <a
            href={candidate.linkedin_profile_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="Ouvrir le profil LinkedIn"
            className="ml-auto inline-flex items-center justify-center w-5 h-5 rounded-md text-muted-foreground/60 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-linkedin hover:bg-muted/60 transition-opacity"
          >
            <Linkedin className="w-3 h-3" />
          </a>
        )}
      </div>
    </div>
  );
});
KanbanCard.displayName = 'KanbanCard';

// ── Draggable Card ──

const DraggableKanbanCard = React.memo(({ candidate, columnId, dimmed, onOpen }: { candidate: ProjectCandidate; columnId: string; dimmed?: boolean; onOpen?: (c: ProjectCandidate) => void }) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: candidate.id,
    data: { type: 'card', columnId },
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onOpen?.(candidate)}
      className={cn("[content-visibility:auto] [contain-intrinsic-size:auto_72px]", isDragging && "opacity-30")}
    >
      <KanbanCard candidate={candidate} dimmed={dimmed} />
    </div>
  );
});
DraggableKanbanCard.displayName = 'DraggableKanbanCard';

// ── Kanban Column ──

const KanbanColumn = ({ column, candidates, isDismissed, noDrop, innerRef, onOpen, onGoOutreach }: {
  column: PipelineColumn;
  candidates: ProjectCandidate[];
  isDismissed?: boolean;
  /** Colonne sans dépôt (« Étape à choisir »). */
  noDrop?: boolean;
  innerRef?: (el: HTMLDivElement | null) => void;
  onOpen?: (c: ProjectCandidate) => void;
  onGoOutreach?: () => void;
}) => {
  const { setNodeRef, isOver } = useDroppable({
    id: column.key,
    data: { type: 'column' },
    disabled: noDrop,
  });
  const staleInCol = useMemo(() => candidates.filter((c) => isStale(c)).length, [candidates]);

  return (
    <div
      ref={(node) => { setNodeRef(node); innerRef?.(node); }}
      role="region"
      aria-label={`Colonne ${column.label}, ${candidates.length} candidat${candidates.length > 1 ? 's' : ''}`}
      className={cn(
        "flex flex-col rounded-xl bg-muted/20 transition-colors",
        // Colonnes fluides : remplissent la largeur dispo, bornées pour rester
        // lisibles (plus de moitié d'écran vide à 3 ou 4 colonnes)
        isDismissed ? "flex-none w-[216px]" : "flex-1 min-w-[248px] max-w-[340px]",
        isOver && cn("bg-muted/40 ring-1 ring-inset", column.theme.ring)
      )}
    >
      <div className="flex items-center gap-1.5 px-3 h-9 shrink-0">
        <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", column.theme.dot)} />
        <h3 className={cn(
          "text-3xs uppercase tracking-wider font-semibold truncate",
          isDismissed ? "text-destructive" : "text-muted-foreground"
        )}>
          {column.label}
        </h3>
        <span className="text-2xs tabular-nums font-semibold text-muted-foreground">{candidates.length}</span>
        {staleInCol > 0 && !isDismissed && (
          <span
            className="ml-auto inline-flex items-center gap-0.5 text-3xs tabular-nums font-semibold text-warning"
            title={`${plural(staleInCol, 'candidat')} dans cette étape depuis ${STALE_AFTER_DAYS}\u00a0j ou plus`}
          >
            <Clock className="w-2.5 h-2.5" />{staleInCol}
          </span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain thin-scrollbar px-1.5 pb-1.5 space-y-1.5">
        {candidates.map(c => (
          <DraggableKanbanCard key={c.id} candidate={c} columnId={column.key} dimmed={isDismissed} onOpen={onOpen} />
        ))}
        {candidates.length === 0 && (
          <div className={cn(
            "mx-0.5 mt-0.5 rounded-lg border border-dashed py-8 text-center transition-colors",
            isOver ? "border-foreground/30 bg-muted/30" : "border-border"
          )}>
            {!isOver && column.key === MISSION_COLUMN_KEY.contacted && onGoOutreach ? (
              <div className="space-y-2">
                <p className="text-2xs text-muted-foreground/50">{EMPTY_COPY[MISSION_COLUMN_KEY.contacted]}</p>
                <button
                  type="button"
                  onClick={onGoOutreach}
                  className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full bg-foreground text-background text-2xs font-semibold transition-transform active:scale-[0.97]"
                >
                  <Send className="w-3 h-3" /> Contacter les candidats
                </button>
              </div>
            ) : (
              <p className="text-2xs text-muted-foreground/50">{isOver ? 'Déposer ici' : (EMPTY_COPY[column.key] ?? 'Aucun candidat')}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Lecture en échec ──

const PipelineLoadError = ({ message, onRetry }: { message: string; onRetry: () => void }) => (
  <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-3">
    <p className="text-sm text-foreground">{message}</p>
    <Button variant="outline" size="sm" onClick={onRetry}>
      <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
      Réessayer
    </Button>
  </div>
);

// ── Main Component ──

export const MissionPipeline = ({ project }: MissionPipelineProps) => {
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>('table');
  const [draggedCandidate, setDraggedCandidate] = useState<ProjectCandidate | null>(null);
  const [detailCandidate, setDetailCandidate] = useState<ProjectCandidate | null>(null);
  const queryClient = useQueryClient();
  const columnRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // Après un drag, le navigateur émet un click sur la carte déposée : ne pas
  // ouvrir la fiche détail dans ce cas
  const dragHappenedRef = useRef(false);
  const [, setSearchParams] = useSearchParams();

  const goToTab = (tab: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('tab', tab);
      return next;
    }, { replace: true });
  };
  const goToOutreach = () => goToTab('outreach');
  const goToProcess = () => goToTab('process');
  const goToSourcing = () => goToTab('sourcing');

  const openCandidateDetail = (c: ProjectCandidate) => {
    if (dragHappenedRef.current) return;
    setDetailCandidate(c);
  };

  // Vue mission_candidate_rows, profils jamais ouverts exclus (useProjectCandidates).
  const candidatesQuery = useProjectCandidates(project.id);
  const { data: candidateRows, isLoading } = candidatesQuery;
  const candidates = useMemo(() => candidateRows ?? [], [candidateRows]);
  const stageCountsQuery = useMissionStageCounts([project.id]);
  // Profils trouvés par une recherche, jamais ouverts : au Sourcing. 0 tant que
  // le compteur charge ou a échoué : l'écran ne conclut « rien » qu'à la lecture
  // réussie (countsKnown). Une mission que la base ne rend pas (autre
  // organisation) n'a pas de ligne : lecture réussie, zéro profil.
  const countsKnown = stageCountsQuery.isSuccess;
  const unopened = stageCountsQuery.data?.[project.id]?.unopened ?? 0;
  const { steps, loadingSteps, stepsError, refetchSteps } = useMissionProcess(project.id);

  const stepIds = useMemo(() => new Set(steps.map(s => s.id)), [steps]);

  // Colonnes de l'entonnoir (barre du haut et kanban), Écarté à part.
  const columns = useMemo<PipelineColumn[]>(() => [
    ...HEAD_COLUMNS,
    ...(steps.length === 0
      ? [INTERVIEWING_COLUMN]
      : steps.map((s, i) => ({ key: s.id, label: s.name, theme: STEP_THEMES[i % STEP_THEMES.length] }))),
    HIRED_COLUMN,
  ], [steps]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // Colonne d'une carte : étape générale et étape d'entretien seulement
  // (missionColumnOf). La même pour le rangement, le glisser et la fiche.
  const baseColumnOf = useCallback((c: ProjectCandidate): string => missionColumnOf(c, stepIds), [stepIds]);

  // Déplacements en attente de la réponse de la base (id de carte vers colonne
  // visée) : la carte reste dans la colonne visée pendant l'écriture, et une
  // carte en cours de déplacement ne se reprend pas.
  const [pendingMoves, setPendingMoves] = useState<Record<string, string>>({});
  const displayColumnOf = useCallback(
    (c: ProjectCandidate): string => pendingMoves[c.id] ?? baseColumnOf(c),
    [pendingMoves, baseColumnOf],
  );

  // Group candidates by column
  const candidatesByColumn = useMemo(() => {
    const grouped: Record<string, ProjectCandidate[]> = {};
    columns.forEach(col => { grouped[col.key] = []; });
    grouped[DISMISSED_COLUMN.key] = [];
    grouped[STEP_MISSING_COLUMN.key] = grouped[STEP_MISSING_COLUMN.key] ?? [];

    candidates.forEach(c => {
      const key = displayColumnOf(c);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(c);
    });
    return grouped;
  }, [candidates, columns, displayColumnOf]);

  // « Étape à choisir » : seulement sur une mission à étapes, et s'il y a
  // un candidat en entretien sans étape de la mission.
  const showStepMissing = steps.length > 0 && (candidatesByColumn[STEP_MISSING_COLUMN.key]?.length ?? 0) > 0;
  const boardColumns = useMemo<PipelineColumn[]>(
    () => (showStepMissing ? [...HEAD_COLUMNS, STEP_MISSING_COLUMN, ...columns.slice(HEAD_COLUMNS.length)] : columns),
    [showStepMissing, columns],
  );

  // Lot 0b-4 : l'étape s'écrit par set_candidate_stages (origine user), jamais
  // par une écriture directe de status ou pipeline_stage. Lot 0c : sur toutes
  // les lignes du candidat dans la mission (group_ids). Renvoie true si
  // l'étape est enregistrée ; un refus est annoncé par son indice. surface :
  // écran d'où vient le geste, pour la mesure d'usage.
  const updateStage = async (ids: string[], columnKey: string, surface: 'mission-kanban' | 'fiche'): Promise<boolean> => {
    let target: StageTarget;
    try {
      target = missionColumnToStage(columnKey, stepIds);
    } catch {
      toast.error(stageErrorMessage());
      return false;
    }
    const outcome = await setCandidateStages(ids, target, undefined, { surface });
    const failure = outcome.error ?? outcome.rows.find(r => r.result === 'error') ?? null;
    if (outcome.updated + outcome.unchanged > 0) {
      // La carte reste dans la colonne visée pendant la relecture de la vue.
      patchProjectCandidateStages(queryClient, project.id, outcome.rows);
      void invalidateStageReaders(queryClient);
    }
    if (failure) {
      toast.error(stageErrorMessage(failure.hint));
      return false;
    }
    // Aucune ligne changée ni déjà à l'étape (réponse vide de la base) : pas de « déplacé ».
    if (outcome.updated + outcome.unchanged === 0) {
      toast.error(stageErrorMessage());
      return false;
    }
    return true;
  };

  const dismissedCount = candidatesByColumn[DISMISSED_COLUMN.key]?.length || 0;
  const inPipeline = candidates.length - dismissedCount;

  const staleCount = useMemo(
    () => candidates.filter((c) => isStale(c)).length,
    [candidates]
  );

  const focusColumn = (key: string) => {
    const go = () => columnRefs.current[key]?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
    if (viewMode !== 'kanban') {
      setViewMode('kanban');
      requestAnimationFrame(() => requestAnimationFrame(go));
    } else {
      go();
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    dragHappenedRef.current = true;
    const c = candidates.find(c => c.id === event.active.id);
    setDraggedCandidate(c || null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    // Relâche la garde après le click fantôme émis à la fin du drag
    setTimeout(() => { dragHappenedRef.current = false; }, 0);
    setDraggedCandidate(null);
    const { active, over } = event;
    if (!over) return;

    const candidateId = active.id as string;
    const targetColumn = over.data.current?.type === 'column'
      ? over.id as string
      : over.data.current?.columnId;

    if (!targetColumn) return;

    const candidate = candidates.find(c => c.id === candidateId);
    if (!candidate || pendingMoves[candidateId] || displayColumnOf(candidate) === targetColumn) return;

    // Carte rangée dans la colonne visée dès le dépôt ; elle revient à sa place
    // si la base refuse (le cache est alors resté tel quel).
    setPendingMoves(prev => ({ ...prev, [candidateId]: targetColumn }));
    let saved = false;
    try {
      saved = await updateStage(groupIdsOf(candidate), targetColumn, 'mission-kanban');
    } finally {
      setPendingMoves(prev => {
        const { [candidateId]: _done, ...rest } = prev;
        return rest;
      });
    }
    // Toast après l'enregistrement : jamais « déplacé » sur un déplacement refusé.
    if (!saved) return;
    const colLabel = [...boardColumns, DISMISSED_COLUMN].find(c => c.key === targetColumn)?.label || targetColumn;
    const who = candidate.candidate_name ?? 'Candidat';
    toast.success(targetColumn === HIRED_COLUMN.key ? `${who} embauché !` : `${who} déplacé vers « ${colLabel} »`);
  };

  if (isLoading || loadingSteps) {
    return <BrutalLoader variant="default" rows={3} messages={['Chargement du pipeline…']} />;
  }

  // Une lecture en échec ne passe jamais pour un pipeline vide ni pour une
  // mission sans étapes : message et « Réessayer ».
  if (candidatesQuery.isError && candidates.length === 0) {
    return <PipelineLoadError message="Impossible de charger les candidats de cette mission." onRetry={() => void candidatesQuery.refetch()} />;
  }
  // Une relecture en échec garde les étapes déjà lues : l'erreur ne remplace
  // l'écran que sans aucune étape lue.
  if (stepsError && steps.length === 0) {
    return <PipelineLoadError message="Impossible de charger les étapes d'entretien de cette mission." onRetry={() => void refetchSteps()} />;
  }

  const hasCandidates = candidates.length > 0;
  const unopenedLabel = plural(unopened, 'profil trouvé', 'profils trouvés');
  // Plafond de lecture atteint : les plus récents seulement (useProjectCandidates).
  const limited = candidates.length >= PROJECT_CANDIDATES_MAX_ROWS;

  return (
    <div className="space-y-3">
      {/* ── Command bar : effectifs par colonne + méta + toggle ── */}
      {(hasCandidates || unopened > 0) && (
        <div className="bg-card border border-border rounded-xl overflow-hidden konekt-fade-up">
          {/* Rangée 1 : effectifs en ce moment, colonne par colonne (taux
              retirés au lot 0c : le lot 2 refait la barre) */}
          <div className="flex items-stretch overflow-x-auto no-scrollbar px-2 pt-2 pb-1.5">
            {columns.map((col, i) => {
              const count = candidatesByColumn[col.key]?.length || 0;
              return (
                <React.Fragment key={col.key}>
                  {i > 0 && (
                    <div className="flex items-center justify-center shrink-0 w-6 self-center" aria-hidden="true">
                      <ChevronRight className="w-3 h-3 text-muted-foreground/30" />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => focusColumn(col.key)}
                    title={col.label}
                    className="flex flex-col gap-1 shrink-0 rounded-lg px-3 py-1.5 min-w-[84px] text-left transition-colors hover:bg-muted/40"
                  >
                    <span className={cn(
                      "font-display text-xl leading-none font-bold tabular-nums",
                      count === 0 ? "text-muted-foreground/40" : "text-foreground"
                    )}>
                      {count}
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-3xs uppercase tracking-wider font-semibold text-muted-foreground">
                      <span className={cn("w-1.5 h-1.5 rounded-full", col.theme.dot)} />
                      <span className="truncate max-w-[96px]">{col.label}</span>
                    </span>
                  </button>
                </React.Fragment>
              );
            })}
            <div className="ml-2 pl-2 border-l border-border flex">
              <button
                type="button"
                onClick={() => focusColumn(DISMISSED_COLUMN.key)}
                className="flex flex-col gap-1 shrink-0 rounded-lg px-3 py-1.5 min-w-[72px] text-left transition-colors hover:bg-muted/40"
              >
                <span className="font-display text-xl leading-none font-bold tabular-nums text-muted-foreground">{dismissedCount}</span>
                <span className="inline-flex items-center gap-1.5 text-3xs uppercase tracking-wider font-semibold text-muted-foreground">
                  <span className="w-1.5 h-1.5 rounded-full bg-destructive/60" />{DISMISSED_COLUMN.label}
                </span>
              </button>
            </div>
          </div>
          {/* Rangée 2 : méta + profils trouvés + ancienneté + toggle de vue */}
          <div className="flex items-center gap-3 px-4 min-h-10 py-1.5 flex-wrap border-t border-border">
            <span className="text-2xs text-muted-foreground">
              <span className="font-display text-sm font-bold tabular-nums text-foreground">{inPipeline}</span> dans le Pipeline
              <span className="text-muted-foreground/60"> · {plural(dismissedCount, 'écarté')}</span>
            </span>
            {unopened > 0 && (
              <button
                type="button"
                onClick={goToSourcing}
                className="inline-flex items-center gap-1 h-6 px-2 rounded-full border border-border text-2xs text-foreground hover:bg-muted/60 transition-colors"
              >
                <UserSearch className="w-3 h-3" aria-hidden="true" />{unopenedLabel}
              </button>
            )}
            {staleCount > 0 && (
              <span
                className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-warning/10 text-warning text-2xs font-medium"
                title={`Contactés, ayant répondu ou en entretien, dans la même étape depuis ${STALE_AFTER_DAYS}\u00a0j ou plus`}
              >
                <Clock className="w-3 h-3" /><span className="tabular-nums font-semibold">{staleCount}</span> dans la même étape depuis {STALE_AFTER_DAYS}{'\u00a0'}j ou plus
              </span>
            )}
            <div className="flex-1" />
            {hasCandidates && (
              <div className="flex items-center gap-0.5 bg-muted/40 p-0.5 rounded-full border border-border" role="group">
                <button
                  onClick={() => setViewMode('table')}
                  aria-pressed={viewMode === 'table'}
                  className={cn(
                    "inline-flex items-center gap-1.5 h-6 px-2 text-2xs rounded-full transition-colors",
                    viewMode === 'table'
                      ? "bg-foreground text-background font-semibold"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  )}
                >
                  <List className="w-3 h-3" /> Tableau
                </button>
                <button
                  onClick={() => setViewMode('kanban')}
                  aria-pressed={viewMode === 'kanban'}
                  className={cn(
                    "inline-flex items-center gap-1.5 h-6 px-2 text-2xs rounded-full transition-colors",
                    viewMode === 'kanban'
                      ? "bg-foreground text-background font-semibold"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  )}
                >
                  <LayoutGrid className="w-3 h-3" /> Kanban
                </button>
              </div>
            )}
            <TutorialVideoDialog {...PIPELINE_TUTORIAL} autoOpenKey="pipeline" />
          </div>
        </div>
      )}

      {/* Nudge : sans étapes de process, le board garde une seule colonne
          « En entretien » : pointer vers la configuration */}
      {steps.length === 0 && hasCandidates && (
        <div className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-2.5 konekt-fade-up">
          <span className="h-7 w-7 rounded-lg bg-brand/15 text-brand grid place-items-center shrink-0">
            <ListChecks className="w-3.5 h-3.5" />
          </span>
          <p className="text-2xs text-muted-foreground min-w-0 truncate">
            <span className="text-foreground font-medium">Kanban générique.</span>{' '}
            Définissez vos étapes d'entretien pour piloter les candidats colonne par colonne.
          </p>
          <div className="flex-1" />
          <button
            type="button"
            onClick={goToProcess}
            className="shrink-0 inline-flex items-center gap-1.5 h-7 px-3 rounded-full bg-foreground text-background text-2xs font-semibold hover:bg-foreground/90 transition-colors"
          >
            Configurer le process <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      )}

      {limited && (
        <p role="status" className="text-2xs text-muted-foreground px-1">
          Affichage limité aux {PROJECT_CANDIDATES_MAX_ROWS.toLocaleString('fr-FR')} candidats les plus récents.
        </p>
      )}

      {/* Content */}
      {!hasCandidates && !countsKnown ? (
        stageCountsQuery.isError ? (
          <PipelineLoadError message="Impossible de compter les profils de cette mission." onRetry={() => void stageCountsQuery.refetch()} />
        ) : (
          <BrutalLoader variant="default" rows={2} messages={['Chargement du pipeline…']} />
        )
      ) : !hasCandidates ? (
        <div className="bg-card border border-border rounded-xl flex flex-col items-center justify-center py-16 text-center konekt-fade-up">
          <span className="h-10 w-10 rounded-full bg-info/10 text-info grid place-items-center mb-3">
            <Users className="w-5 h-5" />
          </span>
          {unopened > 0 ? (
            <>
              <h3 className="font-display text-md font-bold mb-1">{unopenedLabel} à trier dans le Sourcing</h3>
              <p className="text-2xs text-muted-foreground max-w-sm mb-3">
                Retenez ou contactez les profils qui vous intéressent : ils rejoindront ce pipeline.
              </p>
              <button
                type="button"
                onClick={goToSourcing}
                className="inline-flex items-center gap-1.5 h-8 px-4 rounded-full bg-foreground text-background text-2xs font-semibold hover:bg-foreground/90 transition-colors"
              >
                Ouvrir le Sourcing <ArrowRight className="w-3 h-3" />
              </button>
            </>
          ) : (
            <>
              <h3 className="font-display text-md font-bold mb-1">Votre pipeline attend ses premiers candidats</h3>
              <p className="text-2xs text-muted-foreground max-w-sm">
                Lancez une recherche dans l'onglet Sourcing pour ajouter des candidats à cette mission.
              </p>
            </>
          )}
        </div>
      ) : (
        <>
          {viewMode === 'table' && (
            <ProjectCandidatesTableEnhanced
              candidates={candidates}
              isLoading={isLoading}
              projectId={project.id}
            />
          )}

          {viewMode === 'kanban' && (
            <DndContext
              sensors={sensors}
              collisionDetection={rectIntersection}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <div className="flex gap-2 overflow-x-auto thin-scrollbar pb-2 h-[calc(100dvh-340px)] min-h-[480px] items-stretch konekt-fade-up">
                {boardColumns.map(column => (
                  <KanbanColumn
                    key={column.key}
                    column={column}
                    candidates={candidatesByColumn[column.key] || []}
                    noDrop={column === STEP_MISSING_COLUMN}
                    innerRef={(el) => { columnRefs.current[column.key] = el; }}
                    onOpen={openCandidateDetail}
                    onGoOutreach={column.key === MISSION_COLUMN_KEY.contacted ? goToOutreach : undefined}
                  />
                ))}
                {/* Colonne Écarté : toujours la dernière, transversale */}
                <KanbanColumn
                  column={DISMISSED_COLUMN}
                  candidates={candidatesByColumn[DISMISSED_COLUMN.key] || []}
                  isDismissed
                  innerRef={(el) => { columnRefs.current[DISMISSED_COLUMN.key] = el; }}
                  onOpen={openCandidateDetail}
                />
              </div>
              <DragOverlay dropAnimation={null}>
                {draggedCandidate ? <KanbanCard candidate={draggedCandidate} isOverlay /> : null}
              </DragOverlay>
            </DndContext>
          )}
        </>
      )}

      {/* Fiche candidat détaillée (profil, messages, notes, rappels) :
          réutilise le modal ATS en lui passant les étapes de CE pipeline */}
      {detailCandidate && (
        <CandidateDetailModal
          candidate={{
            id: detailCandidate.id,
            candidateId: detailCandidate.candidate_id,
            name: detailCandidate.candidate_name || 'Candidat inconnu',
            email: null,
            phone: null,
            linkedin: detailCandidate.linkedin_profile_url,
            headline: detailCandidate.candidate_headline,
            expertise: [],
            stage: displayColumnOf(detailCandidate),
            entity: null,
            source: 'local',
            sourceId: detailCandidate.id,
            jobId: detailCandidate.job_id ?? null,
            jobTitle: project.job_title || project.name,
            lastActivity: detailCandidate.stage_entered_at ?? detailCandidate.updated_at,
            createdAt: detailCandidate.created_at,
            score: detailCandidate.score,
            recommendation: detailCandidate.recommendation,
            tags: detailCandidate.tags ?? [],
            // Mission de la ligne et étape : la fiche en tire le poste, les notes
            // de mission et l'ancienneté dans l'étape (stage_entered_at).
            projectId: project.id,
            missionName: project.name,
            generalStage: isGeneralStage(detailCandidate.general_stage) ? detailCandidate.general_stage : 'to_sort',
            processStepId: detailCandidate.process_step_id,
            stageEnteredAt: detailCandidate.stage_entered_at,
            groupIds: groupIdsOf(detailCandidate),
          }}
          onClose={() => setDetailCandidate(null)}
          onStageChange={(rowId, newStage) => {
            const row = candidates.find(c => c.id === rowId);
            void updateStage(row ? groupIdsOf(row) : [rowId], newStage, 'fiche');
            setDetailCandidate(null);
          }}
          onRefresh={() => {
            void invalidateStageReaders(queryClient);
          }}
          stageOptions={[...columns.map(c => ({ key: c.key, label: c.label })), { key: DISMISSED_COLUMN.key, label: DISMISSED_COLUMN.label }]}
        />
      )}
    </div>
  );
};
