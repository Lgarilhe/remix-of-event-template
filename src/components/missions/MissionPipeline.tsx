import React, { useState, useMemo } from 'react';
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
import { BrutalLoader } from '@/components/ui/brutal-loader';
import { supabase } from '@/integrations/supabase/client';
import { List, LayoutGrid, ExternalLink, Clock, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

interface MissionPipelineProps {
  project: SourcingProject;
}

interface ProjectCandidate {
  id: string;
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

interface PipelineColumn {
  key: string;
  label: string;
  isProcessStep?: boolean;
}

// ── Static fallback columns (used when no process steps defined) ──

const STATIC_COLUMNS: PipelineColumn[] = [
  { key: 'untreated', label: 'Sourcé' },
  { key: 'messaged', label: 'Contacté' },
  { key: 'shortlisted', label: 'Shortlisté' },
];

const DISMISSED_COLUMN: PipelineColumn = { key: 'dismissed', label: 'Écarté' };

// Palette des colonnes (barre de progression + dots des headers) — une seule
// source de vérité, indexée par position de colonne
const COLUMN_COLORS = ['bg-muted-foreground/40', 'bg-info', 'bg-cyan-400', 'bg-teal-400', 'bg-indigo-400', 'bg-brand-purple', 'bg-emerald-400'];
const colColor = (i: number) => COLUMN_COLORS[i % COLUMN_COLORS.length];

// ── Kanban Card ──

const KanbanCard = ({ candidate, isDragging }: { candidate: ProjectCandidate; isDragging?: boolean }) => {
  const timeInStage = candidate.updated_at
    ? formatDistanceToNow(new Date(candidate.updated_at), { locale: fr })
    : null;

  return (
    <div className={cn(
      "bg-card border border-border rounded-lg p-2.5 cursor-grab active:cursor-grabbing transition-all",
      "hover:border-foreground/30 hover:shadow-sm hover:-translate-y-px",
      isDragging && "shadow-md border-foreground/30"
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-medium text-foreground truncate">
            {candidate.candidate_name || 'Candidat inconnu'}
          </p>
          {candidate.candidate_headline && (
            <p className="text-[11px] text-muted-foreground truncate mt-0.5">
              {candidate.candidate_headline}
            </p>
          )}
        </div>
        {candidate.score != null && (
          <span className={cn(
            "text-[11px] font-bold tabular-nums px-1.5 py-0.5 rounded-full shrink-0",
            candidate.score >= 70 ? "bg-success/10 text-success" :
            candidate.score >= 40 ? "bg-warning/10 text-warning" :
            "bg-destructive/10 text-destructive"
          )}>
            {candidate.score}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 mt-2">
        {candidate.linkedin_profile_url && (
          <a
            href={candidate.linkedin_profile_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10.5px] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 transition-colors"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <ExternalLink className="w-3 h-3" /> LinkedIn
          </a>
        )}
        {candidate.status === 'replied' && (
          <span className="inline-flex items-center gap-1 text-[10.5px] text-success">
            <MessageSquare className="w-3 h-3" /> A répondu
          </span>
        )}
        {timeInStage && (
          <span className="text-[10.5px] text-muted-foreground/70 inline-flex items-center gap-0.5 ml-auto tabular-nums">
            <Clock className="w-3 h-3" /> {timeInStage}
          </span>
        )}
      </div>
    </div>
  );
};

// ── Draggable Card ──

const DraggableKanbanCard = ({ candidate, columnId }: { candidate: ProjectCandidate; columnId: string }) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: candidate.id,
    data: { type: 'card', columnId },
  });

  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={isDragging ? 'opacity-40' : ''}>
      <KanbanCard candidate={candidate} />
    </div>
  );
};

// ── Kanban Column ──

const KanbanColumn = ({ column, candidates, colorClass, isDismissed }: {
  column: PipelineColumn;
  candidates: ProjectCandidate[];
  colorClass?: string;
  isDismissed?: boolean;
}) => {
  const { setNodeRef, isOver } = useDroppable({
    id: column.key,
    data: { type: 'column' },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex-shrink-0 rounded-xl border border-border bg-card/50 transition-all",
        isDismissed ? "w-[200px]" : "w-[260px]",
        isOver && "border-foreground/40 bg-muted/30"
      )}
    >
      <div className="px-3 py-2 border-b border-border">
        <div className="flex items-center gap-1.5">
          <span className={cn(
            "w-2 h-2 rounded-full shrink-0",
            isDismissed ? "bg-destructive/60" : colorClass
          )} />
          <h3 className={cn(
            "text-[11.5px] font-semibold truncate",
            isDismissed ? "text-destructive" : "text-foreground"
          )}>
            {column.label}
          </h3>
          <span className="ml-auto text-[11px] tabular-nums text-muted-foreground bg-muted/60 rounded-full px-1.5 py-0.5 font-medium">
            {candidates.length}
          </span>
        </div>
      </div>
      <div className="p-1.5 space-y-1.5 min-h-[110px] max-h-[58vh] overflow-y-auto">
        {candidates.map(c => (
          <DraggableKanbanCard key={c.id} candidate={c} columnId={column.key} />
        ))}
        {candidates.length === 0 && (
          <div className="m-1 py-6 rounded-lg border border-dashed border-border text-center">
            <p className="text-[11px] text-muted-foreground/60">Déposer ici</p>
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
  const queryClient = useQueryClient();

  const { data: candidates = [], isLoading } = useProjectCandidates(project.id);
  const { data: stats } = useProjectStats(project.id);
  const { steps, loadingSteps } = useMissionProcess(project.id);

  // Build dynamic columns from process steps.
  // 'Contacté' est présent aussi en mode dynamique : les candidats touchés par
  // l'outreach (messaged/replied) restaient sinon noyés dans « Sourcé ».
  const columns = useMemo<PipelineColumn[]>(() => {
    if (steps.length === 0) return STATIC_COLUMNS;
    return [
      { key: 'sourced', label: 'Sourcé' },
      { key: 'messaged', label: 'Contacté' },
      ...steps.map(s => ({ key: s.id, label: s.name, isProcessStep: true })),
      { key: 'hired', label: 'Embauché' },
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

  const handleDragStart = (event: DragStartEvent) => {
    const c = (candidates as ProjectCandidate[]).find(c => c.id === event.active.id);
    setDraggedCandidate(c || null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
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
    toast.success(`Candidat déplacé vers "${colLabel}"`);
  };

  if (isLoading || loadingSteps) {
    return <BrutalLoader variant="default" rows={3} messages={['Chargement du pipeline…']} />;
  }

  const totalCandidates = stats?.total || candidates.length;
  const dismissedCount = candidatesByColumn['dismissed']?.length || 0;

  return (
    <div className="space-y-3">
      {/* Barre de répartition + légende */}
      {totalCandidates > 0 && (
        <div className="bg-card border border-border rounded-xl px-4 py-3">
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted/40">
            {columns.map((col, i) => {
              const count = candidatesByColumn[col.key]?.length || 0;
              if (count === 0) return null;
              return (
                <div
                  key={col.key}
                  className={cn("h-full", colColor(i))}
                  style={{ width: `${(count / totalCandidates) * 100}%` }}
                  title={`${count} ${col.label}`}
                />
              );
            })}
            {dismissedCount > 0 && (
              <div
                className="bg-destructive/50 h-full"
                style={{ width: `${(dismissedCount / totalCandidates) * 100}%` }}
                title={`${dismissedCount} écartés`}
              />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2.5">
            {columns.map((col, i) => {
              const count = candidatesByColumn[col.key]?.length || 0;
              return (
                <span key={col.key} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className={cn("w-2 h-2 rounded-full", colColor(i))} />
                  <span className="tabular-nums font-medium text-foreground">{count}</span> {col.label}
                </span>
              );
            })}
            <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="w-2 h-2 rounded-full bg-destructive/50" />
              <span className="tabular-nums font-medium text-foreground">{dismissedCount}</span> écartés
            </span>
            <span className="ml-auto flex items-baseline gap-1 text-[12px]">
              <span className="font-display font-bold tabular-nums text-foreground">{totalCandidates}</span>
              <span className="text-muted-foreground">total</span>
            </span>
          </div>
        </div>
      )}

      {/* Compteur + toggle de vue */}
      <div className="flex items-center gap-3">
        <div className="flex items-baseline gap-1.5 text-[12.5px]">
          <span className="font-display font-bold tabular-nums text-foreground">{totalCandidates}</span>
          <span className="text-muted-foreground">candidat{totalCandidates > 1 ? 's' : ''}</span>
          {steps.length > 0 && (
            <span className="text-muted-foreground/60">· {steps.length} étapes de process</span>
          )}
        </div>
        <div className="flex-1" />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold hidden lg:inline">
          Affichage
        </span>
        <div className="flex items-center gap-0.5 bg-muted/40 p-0.5 rounded-full border border-border" role="group">
          <button
            onClick={() => setViewMode('table')}
            aria-pressed={viewMode === 'table'}
            className={cn(
              "inline-flex items-center gap-1.5 h-6 px-2 text-[11.5px] rounded-full transition-colors",
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
              "inline-flex items-center gap-1.5 h-6 px-2 text-[11.5px] rounded-full transition-colors",
              viewMode === 'kanban'
                ? "bg-foreground text-background font-semibold"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            )}
          >
            <LayoutGrid className="w-3 h-3" /> Kanban
          </button>
        </div>
      </div>

      {/* Content */}
      {totalCandidates === 0 ? (
        <div className="bg-card border border-border rounded-xl flex flex-col items-center justify-center py-16 text-center">
          <span className="text-3xl mb-3">📊</span>
          <h3 className="font-display text-[14px] font-bold mb-1">Pipeline vide</h3>
          <p className="text-[12px] text-muted-foreground max-w-sm">
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
              <div className="flex gap-3 overflow-x-auto pb-4">
                {columns.map((column, i) => (
                  <KanbanColumn
                    key={column.key}
                    column={column}
                    candidates={candidatesByColumn[column.key] || []}
                    colorClass={colColor(i)}
                  />
                ))}
                {/* Dismissed column — always last, transversal */}
                <KanbanColumn
                  column={DISMISSED_COLUMN}
                  candidates={candidatesByColumn['dismissed'] || []}
                  isDismissed
                />
              </div>
              <DragOverlay dropAnimation={null}>
                {draggedCandidate ? <KanbanCard candidate={draggedCandidate} isDragging /> : null}
              </DragOverlay>
            </DndContext>
          )}
        </>
      )}
    </div>
  );
};
