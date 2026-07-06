import React, { useState, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, useSensor, useSensors, useDroppable, useDraggable,
  rectIntersection,
} from '@dnd-kit/core';
import { useQueryClient } from '@tanstack/react-query';
import { SourcingProject, useProjectCandidates } from '@/hooks/useSourcingProjects';
import { useProjectStats } from '@/hooks/useProjectStats';
import { useMissionProcess } from '@/hooks/useMissionProcess';
import { ProjectCandidatesTableEnhanced } from '@/components/outreach/projects/ProjectCandidatesTableEnhanced';
import { CandidateDetailModal } from '@/components/ats/CandidateDetailModal';
import { ATSCandidate } from '@/hooks/useATSData';
import { BrutalLoader } from '@/components/ui/brutal-loader';
import { supabase } from '@/integrations/supabase/client';
import { List, LayoutGrid, Clock, MessageSquare, ChevronRight, Linkedin, Users, Send, ListChecks, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface MissionPipelineProps {
  project: SourcingProject;
}

interface ProjectCandidate {
  id: string;
  job_id?: string;
  candidate_id: string;
  candidate_name: string | null;
  candidate_headline: string | null;
  linkedin_profile_url: string | null;
  status: string;
  pipeline_stage: string | null;
  score: number | null;
  recommendation: string | null;
  skip_reason: string | null;
  created_at: string;
  updated_at: string;
}

// ── Thème sémantique des colonnes ──
// Sémantique, pas positionnel : « Embauché » est TOUJOURS vert, « Contacté »
// toujours info, quel que soit le nombre d'étapes de process intercalées.

type ColTheme = { dot: string; ring: string };

const NEUTRAL: ColTheme = { dot: 'bg-muted-foreground/50', ring: 'ring-foreground/25' };
const INFO: ColTheme = { dot: 'bg-info', ring: 'ring-info/40' };
const SUCCESS: ColTheme = { dot: 'bg-success', ring: 'ring-success/40' };
const DISMISSED_T: ColTheme = { dot: 'bg-destructive/60', ring: 'ring-destructive/40' };
const STEP_THEMES: ColTheme[] = [
  { dot: 'bg-brand-cyan', ring: 'ring-brand-cyan/40' },
  { dot: 'bg-teal-400', ring: 'ring-teal-400/40' },
  { dot: 'bg-indigo-400', ring: 'ring-indigo-400/40' },
  { dot: 'bg-brand-purple', ring: 'ring-brand-purple/40' },
];

interface PipelineColumn {
  key: string;
  label: string;
  theme: ColTheme;
  isProcessStep?: boolean;
}

// ── Static fallback columns (used when no process steps defined) ──

const STATIC_COLUMNS: PipelineColumn[] = [
  { key: 'untreated', label: 'Sourcé', theme: NEUTRAL },
  { key: 'messaged', label: 'Contacté', theme: INFO },
  { key: 'shortlisted', label: 'Shortlisté', theme: SUCCESS },
];

const DISMISSED_COLUMN: PipelineColumn = { key: 'dismissed', label: 'Écarté', theme: DISMISSED_T };

// ── Helpers ──

function nameHash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
const AVATAR_THEMES = [
  'bg-brand-purple/20 text-brand-purple',
  'bg-brand-blue/20 text-brand-blue',
  'bg-brand-cyan/20 text-brand-cyan',
  'bg-brand-pink/20 text-brand-pink',
  'bg-emerald-400/15 text-emerald-400',
  'bg-amber-400/15 text-amber-300',
];
const avatarTheme = (name?: string | null) => AVATAR_THEMES[nameHash(name || '?') % AVATAR_THEMES.length];
const initials = (name?: string | null) => {
  const p = (name || '').trim().split(/\s+/).filter(Boolean);
  return p.length ? ((p[0][0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() : '?';
};

const stageAgeDays = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : 0);
const formatStageAge = (d: number) => (d < 1 ? 'auj.' : d < 7 ? `${d}j` : d < 30 ? `${Math.floor(d / 7)}sem` : `${Math.floor(d / 30)}mois`);

// Le staleness ne s'applique qu'aux candidats ENGAGÉS dans le process
// (contactés, en entretien…) — pas au vivier non traité ni aux états finaux.
const STALE_EXEMPT = new Set(['sourced', 'untreated', 'discovered', 'hired', 'shortlisted', 'dismissed']);
const isStaleCandidate = (c: ProjectCandidate) => {
  const stage = c.pipeline_stage || c.status;
  return !STALE_EXEMPT.has(stage) && c.status !== 'dismissed' && stageAgeDays(c.updated_at) >= 7;
};

const EMPTY_COPY: Record<string, string> = {
  sourced: 'Aucun candidat sourcé',
  untreated: 'Aucun candidat sourcé',
  messaged: "Personne n'a encore été contacté",
  hired: 'Ça se joue à gauche',
  dismissed: 'Rien à écarter, bon signe',
};

// ── Kanban Card ──

const KanbanCard = React.memo(({ candidate, isOverlay, dimmed }: { candidate: ProjectCandidate; isOverlay?: boolean; dimmed?: boolean }) => {
  const name = candidate.candidate_name || 'Candidat inconnu';
  const days = stageAgeDays(candidate.updated_at);
  const stale = isStaleCandidate(candidate);

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
          <p className="text-2xs text-muted-foreground leading-snug truncate mt-0.5">{candidate.candidate_headline || '—'}</p>
        </div>
        {candidate.score != null && (
          <span
            title={candidate.recommendation ?? undefined}
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
        {candidate.status === 'replied' && (
          <span title="A répondu"><MessageSquare className="w-3 h-3 text-success" /></span>
        )}
        <span
          className={cn("inline-flex items-center gap-1 text-3xs tabular-nums", stale ? "text-warning font-semibold" : "text-muted-foreground/70")}
          title={stale ? `Sans mouvement depuis ${days}j` : undefined}
        >
          <Clock className="w-3 h-3" /> {formatStageAge(days)}
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

const KanbanColumn = ({ column, candidates, isDismissed, innerRef, onOpen, onGoOutreach }: {
  column: PipelineColumn;
  candidates: ProjectCandidate[];
  isDismissed?: boolean;
  innerRef?: (el: HTMLDivElement | null) => void;
  onOpen?: (c: ProjectCandidate) => void;
  onGoOutreach?: () => void;
}) => {
  const { setNodeRef, isOver } = useDroppable({
    id: column.key,
    data: { type: 'column' },
  });
  const staleInCol = useMemo(() => candidates.filter(isStaleCandidate).length, [candidates]);

  return (
    <div
      ref={(node) => { setNodeRef(node); innerRef?.(node); }}
      className={cn(
        "flex flex-col rounded-xl bg-muted/20 transition-colors",
        // Colonnes fluides : remplissent la largeur dispo, bornées pour rester
        // lisibles — fini la moitié d'écran vide à 3-4 colonnes
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
            title={`${staleInCol} candidat(s) sans mouvement depuis +7j`}
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
            {!isOver && column.key === 'messaged' && onGoOutreach ? (
              <div className="space-y-2">
                <p className="text-2xs text-muted-foreground/50">{EMPTY_COPY.messaged}</p>
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

// ── Main Component ──

export const MissionPipeline = ({ project }: MissionPipelineProps) => {
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>('table');
  const [draggedCandidate, setDraggedCandidate] = useState<ProjectCandidate | null>(null);
  const [detailCandidate, setDetailCandidate] = useState<ProjectCandidate | null>(null);
  const queryClient = useQueryClient();
  const columnRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // Après un drag, le navigateur émet un click sur la carte déposée — ne pas
  // ouvrir la fiche détail dans ce cas
  const dragHappenedRef = useRef(false);
  const [, setSearchParams] = useSearchParams();

  const goToOutreach = () => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('tab', 'outreach');
      return next;
    }, { replace: true });
  };

  const goToProcess = () => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('tab', 'process');
      return next;
    }, { replace: true });
  };

  const openCandidateDetail = (c: ProjectCandidate) => {
    if (dragHappenedRef.current) return;
    setDetailCandidate(c);
  };

  const { data: candidates = [], isLoading } = useProjectCandidates(project.id);
  const { data: stats } = useProjectStats(project.id);
  const { steps, loadingSteps } = useMissionProcess(project.id);

  // Build dynamic columns from process steps.
  // « Contacté » est présent aussi en mode dynamique : les candidats touchés
  // par l'outreach (messaged/replied) restaient sinon noyés dans « Sourcé ».
  const columns = useMemo<PipelineColumn[]>(() => {
    if (steps.length === 0) return STATIC_COLUMNS;
    return [
      { key: 'sourced', label: 'Sourcé', theme: NEUTRAL },
      { key: 'messaged', label: 'Contacté', theme: INFO },
      ...steps.map((s, i) => ({ key: s.id, label: s.name, theme: STEP_THEMES[i % STEP_THEMES.length], isProcessStep: true })),
      { key: 'hired', label: 'Embauché', theme: SUCCESS },
    ];
  }, [steps]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const updateStage = async (candidateId: string, newStage: string) => {
    // Map back to status for backward compatibility
    const statusMap: Record<string, string> = {
      sourced: 'untreated', untreated: 'untreated',
      messaged: 'messaged',
      dismissed: 'dismissed',
      hired: 'shortlisted',
    };
    const newStatus = statusMap[newStage] || 'shortlisted';

    const { error } = await supabase
      .from('job_candidate_status')
      .update({ status: newStatus, pipeline_stage: newStage })
      .eq('id', candidateId);
    if (error) {
      toast.error('Erreur lors de la mise à jour');
      return;
    }
    queryClient.invalidateQueries({ queryKey: ['project-candidates', project.id] });
    queryClient.invalidateQueries({ queryKey: ['project-stats', project.id] });
    queryClient.invalidateQueries({ queryKey: ['sourcing-projects'] });
  };

  // Group candidates by column
  const candidatesByColumn = useMemo(() => {
    const grouped: Record<string, ProjectCandidate[]> = {};
    columns.forEach(col => { grouped[col.key] = []; });
    grouped['dismissed'] = [];

    (candidates as ProjectCandidate[]).forEach(c => {
      // 'replied' n'est pas une colonne : il vit dans « Contacté »
      const stage = c.pipeline_stage || (c.status === 'replied' ? 'messaged' : c.status);
      if (stage === 'dismissed') {
        grouped['dismissed'].push(c);
      } else if (grouped[stage]) {
        grouped[stage].push(c);
      } else {
        // Fallback: map old statuses to first column
        const firstKey = columns[0]?.key || 'untreated';
        if (!grouped[firstKey]) grouped[firstKey] = [];
        grouped[firstKey].push(c);
      }
    });
    return grouped;
  }, [candidates, columns]);

  // Funnel « au moins arrivé à cette étape » : cumul depuis la droite.
  // La colonne Écarté est hors funnel (transversale).
  const reached = useMemo(() => {
    const arr = columns.map(c => candidatesByColumn[c.key]?.length || 0);
    for (let i = arr.length - 2; i >= 0; i--) arr[i] += arr[i + 1];
    return arr;
  }, [columns, candidatesByColumn]);
  const convRate = (i: number) => (reached[i - 1] > 0 ? reached[i] / reached[i - 1] : null);

  const staleCount = useMemo(
    () => (candidates as ProjectCandidate[]).filter(isStaleCandidate).length,
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
    const c = (candidates as ProjectCandidate[]).find(c => c.id === event.active.id);
    setDraggedCandidate(c || null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
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

    const candidate = (candidates as ProjectCandidate[]).find(c => c.id === candidateId);
    const currentStage = candidate?.pipeline_stage || candidate?.status;
    if (currentStage === targetColumn) return;

    updateStage(candidateId, targetColumn);
    const colLabel = columns.find(c => c.key === targetColumn)?.label || targetColumn;
    const who = candidate?.candidate_name ?? 'Candidat';
    toast.success(targetColumn === 'hired' ? `${who} embauché !` : `${who} déplacé vers « ${colLabel} »`);
  };

  if (isLoading || loadingSteps) {
    return <BrutalLoader variant="default" rows={3} messages={['Chargement du pipeline…']} />;
  }

  const totalCandidates = stats?.total || candidates.length;
  const dismissedCount = candidatesByColumn['dismissed']?.length || 0;

  return (
    <div className="space-y-3">
      {/* ── Command bar : funnel actionnable + méta + toggle ── */}
      {totalCandidates > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden konekt-fade-up">
          {/* Rangée 1 — funnel avec taux de passage */}
          <div className="flex items-stretch overflow-x-auto no-scrollbar px-2 pt-2 pb-1.5">
            {columns.map((col, i) => {
              const count = candidatesByColumn[col.key]?.length || 0;
              const conv = i > 0 ? convRate(i) : null;
              return (
                <React.Fragment key={col.key}>
                  {i > 0 && (
                    <div
                      className="flex flex-col items-center justify-center shrink-0 w-9 self-center"
                      title={`Taux de passage vers « ${col.label} »`}
                    >
                      <ChevronRight className="w-3 h-3 text-muted-foreground/30" />
                      <span className={cn(
                        "text-3xs tabular-nums font-semibold",
                        conv !== null && conv < 0.1 ? "text-warning" : "text-muted-foreground"
                      )}>
                        {conv !== null ? `${Math.round(conv * 100)}%` : '—'}
                      </span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => focusColumn(col.key)}
                    title={col.label}
                    className="flex flex-col gap-1 shrink-0 rounded-lg px-3 py-1.5 min-w-[84px] text-left transition-colors hover:bg-muted/40"
                  >
                    <span className={cn(
                      "font-display text-[20px] leading-none font-bold tabular-nums",
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
                onClick={() => focusColumn('dismissed')}
                className="flex flex-col gap-1 shrink-0 rounded-lg px-3 py-1.5 min-w-[72px] text-left transition-colors hover:bg-muted/40"
              >
                <span className="font-display text-[20px] leading-none font-bold tabular-nums text-muted-foreground">{dismissedCount}</span>
                <span className="inline-flex items-center gap-1.5 text-3xs uppercase tracking-wider font-semibold text-muted-foreground">
                  <span className="w-1.5 h-1.5 rounded-full bg-destructive/60" />Écarté
                </span>
              </button>
            </div>
          </div>
          {/* Rangée 2 — méta + staleness + toggle de vue */}
          <div className="flex items-center gap-3 px-4 h-10 border-t border-border">
            <span className="text-2xs text-muted-foreground">
              <span className="font-display text-[13px] font-bold tabular-nums text-foreground">{totalCandidates}</span> candidat{totalCandidates > 1 ? 's' : ''}
              {steps.length > 0 && <span className="text-muted-foreground/60"> · {steps.length} étapes</span>}
            </span>
            {staleCount > 0 && (
              <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-warning/10 text-warning text-2xs font-medium">
                <Clock className="w-3 h-3" /><span className="tabular-nums font-semibold">{staleCount}</span> sans mouvement +7j
              </span>
            )}
            <div className="flex-1" />
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
                <List className="w-3 h-3" /> Table
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
          </div>
        </div>
      )}

      {/* Nudge : sans étapes de process, le board reste générique
          (Sourcé/Contacté/Shortlisté) — pointer vers la configuration */}
      {steps.length === 0 && totalCandidates > 0 && (
        <div className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-2.5 konekt-fade-up">
          <span className="h-7 w-7 rounded-lg bg-brand-purple/15 text-brand-purple grid place-items-center shrink-0">
            <ListChecks className="w-3.5 h-3.5" />
          </span>
          <p className="text-2xs text-muted-foreground min-w-0 truncate">
            <span className="text-foreground font-medium">Board générique.</span>{' '}
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

      {/* Content */}
      {totalCandidates === 0 ? (
        <div className="bg-card border border-border rounded-xl flex flex-col items-center justify-center py-16 text-center konekt-fade-up">
          <span className="h-10 w-10 rounded-full bg-info/10 text-info grid place-items-center mb-3">
            <Users className="w-5 h-5" />
          </span>
          <h3 className="font-display text-[14px] font-bold mb-1">Votre pipeline attend ses premiers candidats</h3>
          <p className="text-2xs text-muted-foreground max-w-sm">
            Lancez une recherche dans l'onglet Sourcing pour ajouter des candidats à cette mission.
          </p>
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
                {columns.map(column => (
                  <KanbanColumn
                    key={column.key}
                    column={column}
                    candidates={candidatesByColumn[column.key] || []}
                    innerRef={(el) => { columnRefs.current[column.key] = el; }}
                    onOpen={openCandidateDetail}
                    onGoOutreach={column.key === 'messaged' ? goToOutreach : undefined}
                  />
                ))}
                {/* Dismissed column — always last, transversal */}
                <KanbanColumn
                  column={DISMISSED_COLUMN}
                  candidates={candidatesByColumn['dismissed'] || []}
                  isDismissed
                  innerRef={(el) => { columnRefs.current['dismissed'] = el; }}
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

      {/* Fiche candidat complète (profil, messages, notes, rappels) —
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
            stage: detailCandidate.pipeline_stage || detailCandidate.status,
            entity: null,
            source: 'local',
            sourceId: detailCandidate.id,
            jobId: detailCandidate.job_id ?? null,
            jobTitle: project.job_title || project.name,
            lastActivity: detailCandidate.updated_at,
            createdAt: detailCandidate.created_at,
            score: detailCandidate.score,
            recommendation: detailCandidate.recommendation,
            tags: (detailCandidate as ProjectCandidate & { tags?: string[] }).tags || [],
            notionShortlistId: (detailCandidate as ProjectCandidate & { notion_shortlist_id?: string | null }).notion_shortlist_id ?? null,
            linkedinProfileData: (detailCandidate as ProjectCandidate & { linkedin_profile_data?: unknown }).linkedin_profile_data,
          } as ATSCandidate}
          onClose={() => setDetailCandidate(null)}
          onStageChange={(rowId, newStage) => {
            updateStage(rowId, newStage);
            setDetailCandidate(null);
          }}
          onRefresh={() => {
            queryClient.invalidateQueries({ queryKey: ['project-candidates', project.id] });
            queryClient.invalidateQueries({ queryKey: ['project-stats', project.id] });
          }}
          stageOptions={[...columns.map(c => ({ key: c.key, label: c.label })), { key: 'dismissed', label: 'Écarté' }]}
        />
      )}
    </div>
  );
};
