import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { User } from '@supabase/supabase-js';
import { SEOHead } from '@/components/SEOHead';
import { CandidateListView } from '@/components/candidates/CandidateListView';
import { ShortlistSpace } from '@/components/candidates/ShortlistSpace';
import { CandidateDetailModal } from '@/components/ats/CandidateDetailModal';
import { Users, Star, Loader2, Search, X } from 'lucide-react';
import { useATSData, ATSCandidate } from '@/hooks/useATSData';
import { useNotionShortlist, useNotionCandidates } from '@/hooks/useNotionCandidates';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// Keep exported types for backward compatibility (used by other components)
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

const SPACES = [
  { value: 'candidats' as const, label: 'Candidats', icon: Users },
  { value: 'shortlist' as const, label: 'Shortlist', icon: Star },
] as const;

type SpaceType = typeof SPACES[number]['value'];

export default function Candidates() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialSpace = (searchParams.get('space') as SpaceType) || 'candidats';
  const [activeSpace, setActiveSpace] = useState<SpaceType>(
    ['candidats', 'shortlist'].includes(initialSpace) ? initialSpace : 'candidats'
  );
  const [candidateSearch, setCandidateSearch] = useState('');
  const [selectedCandidate, setSelectedCandidate] = useState<ATSCandidate | null>(null);

  // ATS candidates data
  const { candidates, loading: atsLoading, isFetching, refetch, handleStageChange: atsStageChange, handleTagsChange } = useATSData();

  // Notion shortlist data
  const { data: shortlistData = [], isLoading: shortlistLoading, error: shortlistError } = useNotionShortlist();
  const { data: candidatesData = [] } = useNotionCandidates();
  const [shortlist, setShortlist] = useState<ShortlistEntry[]>([]);

  useEffect(() => {
    if (shortlistData.length > 0) setShortlist(shortlistData);
  }, [shortlistData]);

  // Update URL when space changes
  const switchSpace = (space: SpaceType) => {
    setActiveSpace(space);
    setSearchParams({ space });
  };

  // Filter candidates by search
  const filteredCandidates = React.useMemo(() => {
    if (!candidateSearch) return candidates;
    const s = candidateSearch.toLowerCase();
    return candidates.filter(c =>
      c.name?.toLowerCase().includes(s) ||
      c.headline?.toLowerCase().includes(s) ||
      c.jobTitle?.toLowerCase().includes(s)
    );
  }, [candidates, candidateSearch]);

  // Shortlist stage change
  const handleShortlistStageChange = (entryId: string, newStage: string) => {
    setShortlist(prev => prev.map(entry => entry.id === entryId ? { ...entry, stage: newStage } : entry));
  };

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Candidats & Shortlist | Skalr"
        description="Gérez vos candidats et votre shortlist de recrutement"
      />

      <div className="py-6 pb-8 sm:pb-12">
        <div className="max-w-[1600px] mx-auto px-3 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="mb-6 sm:mb-8">
            <div className="flex items-center gap-2 sm:gap-3 mb-1 sm:mb-2">
              <div className="h-8 w-8 sm:h-10 sm:w-10 bg-foreground text-background flex items-center justify-center border border-border">
                <Users className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">Candidats</h1>
              {(atsLoading || shortlistLoading) && (
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              )}
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground ml-10 sm:ml-[52px]">
              {candidates.length} candidat{candidates.length > 1 ? 's' : ''} en pipeline
              {shortlist.length > 0 && ` • ${shortlist.length} en shortlist`}
            </p>
          </div>

          {/* Space tabs */}
          <div className="flex items-center gap-0 mb-6">
            {SPACES.map((space, index) => {
              const Icon = space.icon;
              const isActive = activeSpace === space.value;
              const count = space.value === 'candidats' ? candidates.length : shortlist.length;
              return (
                <button
                  key={space.value}
                  onClick={() => switchSpace(space.value)}
                  className={cn(
                    "relative overflow-hidden flex items-center gap-2 h-10 px-5 text-xs font-medium uppercase tracking-wider border border-border transition-colors duration-200",
                    index > 0 && "border-l-0",
                    isActive
                      ? "bg-foreground text-background"
                      : "bg-background text-foreground hover:bg-accent"
                  )}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{space.label}</span>
                  <span className={cn(
                    "text-[10px] px-1.5 py-0.5 font-bold",
                    isActive ? "bg-background/20 text-background" : "bg-muted text-muted-foreground"
                  )}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Candidats space */}
          {activeSpace === 'candidats' && (
            <div>
              {/* Search bar */}
              <div className="relative mb-4 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Rechercher un candidat, une entreprise..."
                  value={candidateSearch}
                  onChange={e => setCandidateSearch(e.target.value)}
                  className="pl-9 h-9 text-sm border-border"
                />
                {candidateSearch && (
                  <button
                    onClick={() => setCandidateSearch('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {atsLoading && candidates.length === 0 ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <CandidateListView
                  candidates={filteredCandidates}
                  onCandidateClick={setSelectedCandidate}
                />
              )}
            </div>
          )}

          {/* Shortlist space */}
          {activeSpace === 'shortlist' && (
            <ShortlistSpace
              shortlist={shortlist}
              loading={shortlistLoading}
              error={shortlistError instanceof Error ? shortlistError : null}
              onStageChange={handleShortlistStageChange}
            />
          )}
        </div>
      </div>

      {/* Candidate detail modal */}
      {selectedCandidate && (
        <CandidateDetailModal
          candidate={selectedCandidate}
          onClose={() => setSelectedCandidate(null)}
          onStageChange={atsStageChange}
          onTagsChange={handleTagsChange}
          onRefresh={() => refetch()}
        />
      )}
    </div>
  );
}
