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
import { List, LayoutGrid, ExternalLink, Clock } from 'lucide-react';
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

// ── Kanban Card ──

const KanbanCard = ({ candidate, isDragging }: { candidate: ProjectCandidate; isDragging?: boolean }) => {
  const timeInStage = candidate.updated_at
    ? formatDistanceToNow(new Date(candidate.updated_at), { locale: fr })
    : null;

  return (
    <div className={cn(
      "bg-background border border-border p-2.5 cursor-grab transition-all",
      "hover:border-border hover:shadow-sm",
      isDragging && "shadow-sm border-border"
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-foreground truncate">
            {candidate.candidate_name || 'Candidat inconnu'}
          </p>
          {candidate.candidate_headline && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {candidate.candidate_headline}
            </p>
          )}
        </div>
        {candidate.score != null && (
          <span className={cn(
            "text-xs font-bold px-1.5 py-0.5 shrink-0",
            candidate.score >= 70 ? "bg-success/10 text-success" :
            candidate.score >= 40 ? "bg-warning/10 text-warning" :
            "bg-destructive/10 text-destructive"
          )}>
            {candidate.score}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 mt-1.5">
        {candidate.linkedin_profile_url && (
          <a
            href={candidate.linkedin_profile_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <ExternalLink className="w-3 h-3" /> LinkedIn
          </a>
        )}
        {timeInStage && (
          <span className="text-xs text-muted-foreground inline-flex items-center gap-0.5 ml-auto">
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

const KanbanColumn = ({ column, candidates, isDismissed }: {
  column: PipelineColumn;
  candidates: ProjectCandidate[];
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
        "flex-shrink-0 border border-border bg-background transition-all",
        isDismissed ? "w-[200px]" : "w-[260px]",
        isOver && "border-border shadow-sm"
      )}
    >
      <div className={cn(
        "p-3 border-b border-border",
        isDismissed ? "bg-destructive/10" : "bg-accent/50"
      )}>
        <div className="flex items-center justify-between">
          <h3 className={cn(
            "font-medium text-xs uppercase tracking-wider",
            isDismissed && "text-destructive"
          )}>
            {column.label}
          </h3>
          <span className="text-xs bg-foreground/10 px-2 py-0.5 font-bold">
            {candidates.length}
          </span>
        </div>
      </div>
      <div className="p-2 space-y-2 min-h-[100px] max-h-[500px] overflow-y-auto">
        {candidates.map(c => (
          <DraggableKanbanCard key={c.id} candidate={c} columnId={column.key} />
        ))}
        {candidates.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">Aucun candidat</p>
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

  // Build dynamic columns from process steps
  const columns = useMemo<PipelineColumn[]>(() => {
    if (steps.length === 0) return STATIC_COLUMNS;
    return [
      { key: 'sourced', label: 'Sourcé' },
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
      const stage = c.pipeline_stage || c.status;
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

  return (
    <div className="bg-background border border-border p-4 sm:p-6">
      {/* Stats bar */}
      {totalCandidates > 0 && (
        <div className="mb-4">
          <div className="flex h-2 w-full overflow-hidden border border-border">
            {columns.map((col, i) => {
              const count = candidatesByColumn[col.key]?.length || 0;
              if (count === 0 || totalCandidates === 0) return null;
              const colors = ['bg-muted-foreground/30', 'bg-info', 'bg-cyan-400', 'bg-teal-400', 'bg-indigo-400', 'bg-brand-purple', 'bg-emerald-400'];
              return (
                <div
                  key={col.key}
                  className={cn("h-full", colors[i % colors.length])}
                  style={{ width: `${(count / totalCandidates) * 100}%` }}
                  title={`${count} ${col.label}`}
                />
              );
            })}
            {(candidatesByColumn['dismissed']?.length || 0) > 0 && (
              <div
                className="bg-destructive/40 h-full"
                style={{ width: `${((candidatesByColumn['dismissed']?.length || 0) / totalCandidates) * 100}%` }}
                title={`${candidatesByColumn['dismissed']?.length || 0} écartés`}
              />
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
            {columns.map((col, i) => {
              const count = candidatesByColumn[col.key]?.length || 0;
              const colors = ['bg-muted-foreground/30', 'bg-info', 'bg-cyan-400', 'bg-teal-400', 'bg-indigo-400', 'bg-brand-purple', 'bg-emerald-400'];
              return (
                <span key={col.key} className="text-xs text-muted-foreground uppercase tracking-wider">
                  <span className={cn("inline-block w-2 h-2 mr-1", colors[i % colors.length])} />
                  {count} {col.label}
                </span>
              );
            })}
            <span className="text-xs text-muted-foreground uppercase tracking-wider">
              <span className="inline-block w-2 h-2 bg-destructive/40 mr-1" />
              {candidatesByColumn['dismissed']?.length || 0} écartés
            </span>
            <span className="text-xs font-bold text-foreground uppercase tracking-wider ml-auto">
              {totalCandidates} total
            </span>
          </div>
        </div>
      )}

      {/* View toggle + dynamic info */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">
            {totalCandidates} candidat{totalCandidates > 1 ? 's' : ''}
          </span>
          {steps.length > 0 && (
            <span className="text-xs text-muted-foreground/60 uppercase tracking-wider">
              • {steps.length} étapes de process
            </span>
          )}
        </div>
        <div className="flex gap-0">
          <button
            onClick={() => setViewMode('table')}
            className={cn(
              "flex items-center gap-1 h-8 px-3 text-xs font-medium uppercase tracking-wider border border-border group",
              viewMode === 'table' ? "bg-foreground text-background" : "bg-background text-foreground"
            )}
          >
            <List className="w-3 h-3" /> Table
          </button>
          <button
            onClick={() => setViewMode('kanban')}
            className={cn(
              "flex items-center gap-1 h-8 px-3 text-xs font-medium uppercase tracking-wider border border-border border-l-0 group",
              viewMode === 'kanban' ? "bg-foreground text-background" : "bg-background text-foreground"
            )}
          >
            <LayoutGrid className="w-3 h-3" /> Kanban
          </button>
        </div>
      </div>

      {/* Content */}
      {totalCandidates === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <span className="text-3xl mb-3">📊</span>
          <h3 className="text-sm font-bold uppercase tracking-wider mb-2">Pipeline vide</h3>
          <p className="text-xs text-muted-foreground max-w-sm">
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
                {columns.map(column => (
                  <KanbanColumn
                    key={column.key}
                    column={column}
                    candidates={candidatesByColumn[column.key] || []}
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
