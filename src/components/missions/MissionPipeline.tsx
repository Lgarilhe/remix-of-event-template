import React, { useState, useMemo } from 'react';
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, useSensor, useSensors, useDroppable, useDraggable,
  rectIntersection,
} from '@dnd-kit/core';
import { useQueryClient } from '@tanstack/react-query';
import { SourcingProject, useProjectCandidates } from '@/hooks/useSourcingProjects';
import { useProjectStats } from '@/hooks/useProjectStats';
import { ProjectCandidatesTableEnhanced } from '@/components/outreach/projects/ProjectCandidatesTableEnhanced';
import { BrutalLoader } from '@/components/ui/brutal-loader';
import { supabase } from '@/integrations/supabase/client';
import { List, LayoutGrid, ExternalLink } from 'lucide-react';
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
  score: number | null;
  recommendation: string | null;
  skip_reason: string | null;
  created_at: string;
  updated_at: string;
}

const PIPELINE_COLUMNS = [
  { key: 'untreated', label: 'Sourcé', color: 'bg-gray-100', textColor: 'text-gray-600' },
  { key: 'messaged', label: 'Contacté', color: 'bg-blue-50', textColor: 'text-blue-700' },
  { key: 'shortlisted', label: 'Shortlisté', color: 'bg-purple-50', textColor: 'text-purple-700' },
  { key: 'dismissed', label: 'Écarté', color: 'bg-red-50', textColor: 'text-red-600' },
];

// ── Kanban Card ──

const KanbanCard = ({ candidate, isDragging }: { candidate: ProjectCandidate; isDragging?: boolean }) => (
  <div className={cn(
    "bg-background border border-foreground/20 p-2.5 cursor-grab transition-all",
    "hover:border-foreground hover:shadow-[2px_2px_0px_0px_hsl(var(--foreground))]",
    isDragging && "shadow-[3px_3px_0px_0px_hsl(var(--brutal-accent))] border-foreground"
  )}>
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-foreground truncate">
          {candidate.candidate_name || 'Candidat inconnu'}
        </p>
        {candidate.candidate_headline && (
          <p className="text-[10px] text-muted-foreground truncate mt-0.5">
            {candidate.candidate_headline}
          </p>
        )}
      </div>
      {candidate.score !== null && (
        <span className={cn(
          "text-[10px] font-bold px-1.5 py-0.5 shrink-0",
          candidate.score >= 70 ? "bg-green-100 text-green-700" :
          candidate.score >= 40 ? "bg-yellow-100 text-yellow-700" :
          "bg-red-100 text-red-600"
        )}>
          {candidate.score}
        </span>
      )}
    </div>
    {candidate.linkedin_profile_url && (
      <a
        href={candidate.linkedin_profile_url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[10px] text-muted-foreground hover:text-foreground mt-1 inline-flex items-center gap-1"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <ExternalLink className="w-2.5 h-2.5" /> LinkedIn
      </a>
    )}
    <p className="text-[9px] text-muted-foreground mt-1">
      {formatDistanceToNow(new Date(candidate.created_at), { addSuffix: true, locale: fr })}
    </p>
  </div>
);

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

const KanbanColumn = ({ column, candidates }: {
  column: typeof PIPELINE_COLUMNS[0];
  candidates: ProjectCandidate[];
}) => {
  const { setNodeRef, isOver } = useDroppable({
    id: column.key,
    data: { type: 'column' },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "w-[260px] flex-shrink-0 border border-foreground/30 bg-background transition-all",
        isOver && "border-foreground shadow-[3px_3px_0px_0px_hsl(var(--brutal-accent))]"
      )}
    >
      <div className="p-3 border-b border-foreground/20 bg-foreground/5">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-[11px] uppercase tracking-wider">{column.label}</h3>
          <span className="text-[10px] bg-foreground/10 px-2 py-0.5 font-bold">
            {candidates.length}
          </span>
        </div>
      </div>
      <div className="p-2 space-y-2 min-h-[100px] max-h-[500px] overflow-y-auto">
        {candidates.map(c => (
          <DraggableKanbanCard key={c.id} candidate={c as ProjectCandidate} columnId={column.key} />
        ))}
        {candidates.length === 0 && (
          <p className="text-[10px] text-muted-foreground text-center py-4">Aucun candidat</p>
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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const updateStatus = async (candidateId: string, newStatus: string) => {
    const { error } = await supabase
      .from('job_candidate_status')
      .update({ status: newStatus })
      .eq('id', candidateId);
    if (error) {
      toast.error('Erreur lors de la mise à jour');
      return;
    }
    queryClient.invalidateQueries({ queryKey: ['project-candidates', project.id] });
    queryClient.invalidateQueries({ queryKey: ['project-stats', project.id] });
    queryClient.invalidateQueries({ queryKey: ['sourcing-projects'] });
  };

  const candidatesByStatus = useMemo(() => {
    const grouped: Record<string, any[]> = {};
    PIPELINE_COLUMNS.forEach(col => { grouped[col.key] = []; });
    candidates.forEach((c: any) => {
      const key = PIPELINE_COLUMNS.find(col => col.key === c.status)?.key || 'untreated';
      grouped[key].push(c);
    });
    return grouped;
  }, [candidates]);

  const handleDragStart = (event: DragStartEvent) => {
    const c = candidates.find((c: any) => c.id === event.active.id);
    setDraggedCandidate((c as ProjectCandidate) || null);
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

    const currentStatus = (candidates as any[]).find(c => c.id === candidateId)?.status;
    if (currentStatus === targetColumn) return;

    updateStatus(candidateId, targetColumn);
    toast.success(`Candidat déplacé vers "${PIPELINE_COLUMNS.find(c => c.key === targetColumn)?.label}"`);
  };

  if (isLoading) {
    return <BrutalLoader variant="default" rows={3} messages={['Chargement du pipeline…']} />;
  }

  const totalCandidates = stats?.total || candidates.length;

  return (
    <div className="bg-background border border-foreground border-t-0 p-3 sm:p-6">
      {/* Stats bar */}
      {totalCandidates > 0 && (
        <div className="mb-4">
          <div className="flex h-2 w-full overflow-hidden border border-foreground/20">
            {stats && stats.total > 0 && (
              <>
                {stats.untreated > 0 && (
                  <div className="bg-gray-300 h-full" style={{ width: `${(stats.untreated / stats.total) * 100}%` }} title={`${stats.untreated} sourcés`} />
                )}
                {stats.messaged > 0 && (
                  <div className="bg-blue-400 h-full" style={{ width: `${(stats.messaged / stats.total) * 100}%` }} title={`${stats.messaged} contactés`} />
                )}
                {stats.shortlisted > 0 && (
                  <div className="bg-purple-400 h-full" style={{ width: `${(stats.shortlisted / stats.total) * 100}%` }} title={`${stats.shortlisted} shortlistés`} />
                )}
                {stats.dismissed > 0 && (
                  <div className="bg-red-300 h-full" style={{ width: `${(stats.dismissed / stats.total) * 100}%` }} title={`${stats.dismissed} écartés`} />
                )}
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
              <span className="inline-block w-2 h-2 bg-gray-300 mr-1" />{stats?.untreated || 0} sourcés
            </span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
              <span className="inline-block w-2 h-2 bg-blue-400 mr-1" />{stats?.messaged || 0} contactés
            </span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
              <span className="inline-block w-2 h-2 bg-purple-400 mr-1" />{stats?.shortlisted || 0} shortlistés
            </span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
              <span className="inline-block w-2 h-2 bg-red-300 mr-1" />{stats?.dismissed || 0} écartés
            </span>
            <span className="text-[10px] font-bold text-foreground uppercase tracking-wider ml-auto">
              {stats?.total || 0} total
            </span>
          </div>
        </div>
      )}

      {/* View toggle */}
      <div className="flex items-center justify-between mb-4">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
          {totalCandidates} candidat{totalCandidates > 1 ? 's' : ''}
        </div>
        <div className="flex gap-0">
          <button
            onClick={() => setViewMode('table')}
            className={cn(
              "flex items-center gap-1 h-[30px] px-3 text-[10px] font-medium uppercase tracking-wider border border-foreground group",
              viewMode === 'table' ? "bg-foreground text-background" : "bg-background text-foreground"
            )}
          >
            <List className="w-3 h-3" /> Table
          </button>
          <button
            onClick={() => setViewMode('kanban')}
            className={cn(
              "flex items-center gap-1 h-[30px] px-3 text-[10px] font-medium uppercase tracking-wider border border-foreground border-l-0 group",
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
                {PIPELINE_COLUMNS.map(column => (
                  <KanbanColumn
                    key={column.key}
                    column={column}
                    candidates={candidatesByStatus[column.key] || []}
                  />
                ))}
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
