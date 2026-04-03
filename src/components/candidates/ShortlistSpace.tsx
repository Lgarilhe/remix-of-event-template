import React, { useState, useMemo } from 'react';
import { ShortlistEntry, PIPELINE_STAGES } from '@/pages/Candidates';
import { CandidatePipeline } from './CandidatePipeline';
import { CandidateCard } from './CandidateCard';
import { PipelineStats } from './PipelineStats';
import { CandidateFilters } from './CandidateFilters';
import { LayoutGrid, List, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/ui/EmptyState';

interface ShortlistSpaceProps {
  shortlist: ShortlistEntry[];
  loading: boolean;
  error: Error | null;
  onStageChange: (entryId: string, newStage: string) => void;
}

export const ShortlistSpace: React.FC<ShortlistSpaceProps> = ({
  shortlist,
  loading,
  error,
  onStageChange,
}) => {
  const [viewMode, setViewMode] = useState<'pipeline' | 'list'>('pipeline');
  const [filters, setFilters] = useState({
    search: '',
    stage: [] as string[],
    expertise: [] as string[],
    entity: [] as string[],
    position: [] as string[],
  });

  const filterOptions = useMemo(() => {
    const stages = new Set<string>();
    const expertise = new Set<string>();
    const entities = new Set<string>();
    const positionsMap = new Map<string, string>();
    shortlist.forEach(entry => {
      if (entry.stage) stages.add(entry.stage);
      if (entry.entity) entities.add(entry.entity);
      entry.candidate?.expertise?.forEach(e => expertise.add(e));
      entry.positions?.forEach(pos => { if (!positionsMap.has(pos.id)) positionsMap.set(pos.id, pos.name); });
    });
    return {
      stages: Array.from(stages),
      expertise: Array.from(expertise),
      entities: Array.from(entities),
      positions: Array.from(positionsMap.entries()).map(([id, name]) => ({ id, name })),
    };
  }, [shortlist]);

  const filteredShortlist = useMemo(() => {
    return shortlist.filter(entry => {
      if (filters.search) {
        const s = filters.search.toLowerCase();
        if (
          !entry.name?.toLowerCase().includes(s) &&
          !entry.candidate?.name?.toLowerCase().includes(s) &&
          !entry.candidate?.email?.toLowerCase().includes(s) &&
          !entry.positions?.some(p => p.name.toLowerCase().includes(s))
        ) return false;
      }
      if (filters.stage.length > 0 && entry.stage && !filters.stage.includes(entry.stage)) return false;
      if (filters.entity.length > 0 && entry.entity && !filters.entity.includes(entry.entity)) return false;
      if (filters.expertise.length > 0) {
        const ce = entry.candidate?.expertise || [];
        if (!filters.expertise.some(e => ce.includes(e))) return false;
      }
      if (filters.position.length > 0) {
        const ep = entry.positions?.map(p => p.id) || [];
        if (!filters.position.some(pid => ep.includes(pid))) return false;
      }
      return true;
    });
  }, [shortlist, filters]);

  const pipelineData = useMemo(() => {
    const grouped: Record<string, ShortlistEntry[]> = {};
    PIPELINE_STAGES.forEach(stage => { grouped[stage.key] = []; });
    filteredShortlist.forEach(entry => {
      const stage = entry.stage || 'Pressenti';
      if (grouped[stage]) grouped[stage].push(entry);
      else grouped['Pressenti'].push(entry);
    });
    return grouped;
  }, [filteredShortlist]);

  const viewTabs = [
    { value: 'pipeline' as const, label: 'Pipeline', icon: LayoutGrid },
    { value: 'list' as const, label: 'Liste', icon: List },
  ];

  if (loading && shortlist.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-destructive/10 border border-destructive/30 p-6 text-center">
        <p className="text-destructive">{error.message}</p>
      </div>
    );
  }

  if (shortlist.length === 0) {
    return (
      <EmptyState
        icon={<LayoutGrid className="w-7 h-7" />}
        title="Aucune shortlist"
        description="Connectez Notion dans les paramètres pour synchroniser votre shortlist, ou ajoutez des candidats depuis le pipeline."
        actionLabel="Paramètres"
        actionHref="/settings?tab=integrations"
      />
    );
  }

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
        <div className="flex gap-0">
          {viewTabs.map((tab, index) => {
            const Icon = tab.icon;
            const isActive = viewMode === tab.value;
            return (
              <button
                key={tab.value}
                onClick={() => setViewMode(tab.value)}
                className={cn(
                  "relative overflow-hidden flex items-center gap-1.5 h-9 px-4 text-xs font-medium uppercase tracking-wider border border-border transition-colors duration-200",
                  index > 0 && "border-l-0",
                  isActive ? "bg-accent text-foreground" : "bg-background text-foreground"
                )}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <CandidateFilters
          filters={filters}
          onFiltersChange={setFilters}
          options={filterOptions}
        />
      </div>

      {/* Content */}
      {viewMode === 'pipeline' ? (
        <>
          <PipelineStats data={pipelineData} stages={PIPELINE_STAGES} />
          <CandidatePipeline
            data={pipelineData}
            stages={PIPELINE_STAGES}
            onStageChange={onStageChange}
          />
        </>
      ) : (
        <div className="space-y-3">
          {filteredShortlist.length === 0 ? (
            <div className="bg-background border border-border p-12 text-center">
              <p className="text-muted-foreground">Aucune candidature ne correspond à vos critères</p>
            </div>
          ) : (
            filteredShortlist.map(entry => (
              <CandidateCard key={entry.id} entry={entry} />
            ))
          )}
        </div>
      )}
    </div>
  );
};
