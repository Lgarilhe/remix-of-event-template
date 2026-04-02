import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { User } from '@supabase/supabase-js';
import { SEOHead } from '@/components/SEOHead';
import { CandidatePipeline } from '@/components/candidates/CandidatePipeline';
import { PipelineStats } from '@/components/candidates/PipelineStats';
import { CandidateList } from '@/components/candidates/CandidateList';
import { CandidateFilters } from '@/components/candidates/CandidateFilters';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Loader2, LayoutGrid, List, Users } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { useNotionShortlist, useNotionCandidates } from '@/hooks/useNotionCandidates';
import { cn } from '@/lib/utils';

export interface Candidate {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  expertise: string[];
  seniority: string | null;
  source: string | null;
  sourceUrl: string | null;
  location: string | null;
  availability: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  tjm: number | null;
  firstContactDate: string | null;
  createdAt: string | null;
  positionIds: string[];
  shortlistIds: string[];
}

export interface ShortlistEntry {
  id: string;
  name: string;
  stage: string | null;
  entity: string | null;
  presentiComments: string | null;
  cycle: string | null;
  preQualifDate: string | null;
  cvPresentationDate: string | null;
  managerReturnDate: string | null;
  managerDecisionDate: string | null;
  offerValidationDate: string | null;
  startDate: string | null;
  createdAt: string | null;
  positionIds: string[];
  positions: { id: string; name: string }[];
  candidate: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    linkedin: string | null;
    expertise: string[];
    seniority: string | null;
  } | null;
}

export const PIPELINE_STAGES = [
  { key: 'Pressenti', label: 'Pressenti', color: 'bg-muted border-border' },
  { key: 'CV envoyé', label: 'CV envoyé', color: 'bg-info/10 border-info/30' },
  { key: 'ITW en cours', label: 'ITW en cours', color: 'bg-warning/10 border-warning/30' },
  { key: 'Offre', label: 'Offre', color: 'bg-brand-purple/10 border-brand-purple/30' },
  { key: 'Gagné', label: 'Gagné', color: 'bg-success/10 border-success/30' },
  { key: 'Perdu', label: 'Perdu', color: 'bg-destructive/10 border-destructive/30' },
];

const viewTabs = [
  { value: 'pipeline', label: 'Pipeline', icon: LayoutGrid },
  { value: 'list', label: 'Liste', icon: List },
] as const;

export default function Candidates() {
  const [user, setUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<'pipeline' | 'list'>('pipeline');
  
  const { data: shortlistData = [], isLoading: shortlistLoading, error: shortlistError } = useNotionShortlist();
  const { data: candidatesData = [] } = useNotionCandidates();
  
  const [shortlist, setShortlist] = useState<ShortlistEntry[]>([]);
  
  useEffect(() => {
    if (shortlistData.length > 0) setShortlist(shortlistData);
  }, [shortlistData]);
  
  const [filters, setFilters] = useState({
    search: '',
    stage: [] as string[],
    expertise: [] as string[],
    entity: [] as string[],
    position: [] as string[],
  });

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, []);

  // Get unique values for filters
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

  // Filter shortlist
  const filteredShortlist = useMemo(() => {
    return shortlist.filter(entry => {
      if (filters.search) {
        const search = filters.search.toLowerCase();
        const matchName = entry.name?.toLowerCase().includes(search);
        const matchCandidate = entry.candidate?.name?.toLowerCase().includes(search);
        const matchEmail = entry.candidate?.email?.toLowerCase().includes(search);
        const matchPosition = entry.positions?.some(p => p.name.toLowerCase().includes(search));
        if (!matchName && !matchCandidate && !matchEmail && !matchPosition) return false;
      }
      if (filters.stage.length > 0 && entry.stage && !filters.stage.includes(entry.stage)) return false;
      if (filters.entity.length > 0 && entry.entity && !filters.entity.includes(entry.entity)) return false;
      if (filters.expertise.length > 0) {
        const candidateExpertise = entry.candidate?.expertise || [];
        if (!filters.expertise.some(e => candidateExpertise.includes(e))) return false;
      }
      if (filters.position.length > 0) {
        const entryPositionIds = entry.positions?.map(p => p.id) || [];
        if (!filters.position.some(posId => entryPositionIds.includes(posId))) return false;
      }
      return true;
    });
  }, [shortlist, filters]);

  // Group by stage for pipeline
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

  // Handle stage change (optimistic update)
  const handleStageChange = (entryId: string, newStage: string) => {
    setShortlist(prev => prev.map(entry => entry.id === entryId ? { ...entry, stage: newStage } : entry));
  };

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Gestion des candidats | Skalr"
        description="Gérez vos candidats et suivez leur progression dans le pipeline de recrutement"
      />

      <div className="py-6 pb-8 sm:pb-12">
        <div className="max-w-[1600px] mx-auto px-3 sm:px-6 lg:px-8">
          {/* Deprecation banner */}
          <div className="mb-4 border border-border bg-accent/30 px-4 py-2.5 flex items-center gap-2 text-xs uppercase tracking-wider font-medium">
            <span>ℹ️</span>
            <span>Cette vue est aussi accessible depuis <a href="/pipeline?view=shortlist" className="underline font-bold">Pipeline → Shortlist Client</a></span>
          </div>
          {/* Header */}
          <div className="mb-4 sm:mb-8">
            <div className="flex items-center gap-2 sm:gap-3 mb-1 sm:mb-2">
              <div className="h-8 w-8 sm:h-10 sm:w-10 bg-foreground text-background flex items-center justify-center border border-border">
                <Users className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">Candidats</h1>
              {shortlistLoading && (
                <span className="text-xs sm:text-sm text-muted-foreground animate-pulse">Chargement...</span>
              )}
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground ml-10 sm:ml-[52px]">
              {shortlist.length} candidature{shortlist.length > 1 ? 's' : ''} • {candidatesData.length} candidat{candidatesData.length > 1 ? 's' : ''} en base
            </p>
          </div>

          {/* View toggle and filters */}
          <div className="mb-6">
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'pipeline' | 'list')}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                {/* Brutal tabs */}
                <div className="flex gap-0">
                  {viewTabs.map((tab, index) => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.value;
                    return (
                      <button
                        key={tab.value}
                        onClick={() => setActiveTab(tab.value as any)}
                        className={cn(
                          "relative overflow-hidden flex items-center gap-1.5 h-9 px-4 text-xs font-medium uppercase tracking-wider border border-border transition-colors duration-200 group",
                          index > 0 && "border-l-0",
                          isActive ? "bg-accent text-foreground" : "bg-background text-foreground"
                        )}
                      >
                        <Icon className="w-3.5 h-3.5 shrink-0 relative z-10" />
                        <span className="relative z-10">{tab.label}</span>
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

              {shortlistLoading && shortlist.length === 0 ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
              ) : shortlistError ? (
                <div className="bg-destructive/10 border border-destructive/30 p-6 text-center">
                  <p className="text-destructive">{shortlistError instanceof Error ? shortlistError.message : 'Error'}</p>
                </div>
              ) : shortlist.length === 0 ? (
                <EmptyState
                  icon={<Users className="w-7 h-7" />}
                  title="Aucun candidat"
                  description="Connectez Notion dans les paramètres pour synchroniser votre base candidats, ou commencez à sourcer via Outreach."
                  actionLabel="Paramètres"
                  actionHref="/settings?tab=integrations"
                />
              ) : (
                <>
                  <TabsContent value="pipeline" className="mt-0">
                    <PipelineStats data={pipelineData} stages={PIPELINE_STAGES} />
                    <CandidatePipeline 
                      data={pipelineData} 
                      stages={PIPELINE_STAGES} 
                      onStageChange={handleStageChange}
                    />
                  </TabsContent>

                  <TabsContent value="list" className="mt-0">
                    <CandidateList entries={filteredShortlist} />
                  </TabsContent>
                </>
              )}
            </Tabs>
          </div>
        </div>
      </div>
    </div>
  );
}
