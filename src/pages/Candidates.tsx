import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { User } from '@supabase/supabase-js';
import { Navbar } from '@/components/Navbar';
import { SEOHead } from '@/components/SEOHead';
import { CandidatePipeline } from '@/components/candidates/CandidatePipeline';
import { CandidateList } from '@/components/candidates/CandidateList';
import { CandidateFilters } from '@/components/candidates/CandidateFilters';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, LayoutGrid, List, Users } from 'lucide-react';

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

// Pipeline stages in order
export const PIPELINE_STAGES = [
  { key: 'Pressenti', label: 'Pressenti', color: 'bg-gray-100 border-gray-300' },
  { key: 'CV envoyé', label: 'CV envoyé', color: 'bg-blue-50 border-blue-300' },
  { key: 'ITW en cours', label: 'ITW en cours', color: 'bg-yellow-50 border-yellow-300' },
  { key: 'Offre', label: 'Offre', color: 'bg-purple-50 border-purple-300' },
  { key: 'Gagné', label: 'Gagné', color: 'bg-green-50 border-green-300' },
  { key: 'Perdu', label: 'Perdu', color: 'bg-red-50 border-red-300' },
];

export default function Candidates() {
  const [user, setUser] = useState<User | null>(null);
  const [shortlist, setShortlist] = useState<ShortlistEntry[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'pipeline' | 'list'>('pipeline');
  
  // Filters
  const [filters, setFilters] = useState({
    search: '',
    stage: [] as string[],
    expertise: [] as string[],
    entity: [] as string[],
  });

  // Check auth
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Fetch data
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        // Fetch shortlist (pipeline view)
        const shortlistResponse = await supabase.functions.invoke('fetch-notion-candidates', {
          body: {},
        });

        if (shortlistResponse.error) throw shortlistResponse.error;
        if (!shortlistResponse.data?.success) throw new Error(shortlistResponse.data?.error || 'Failed to fetch shortlist');
        
        setShortlist(shortlistResponse.data.shortlist || []);

        // Fetch all candidates
        const candidatesResponse = await supabase.functions.invoke('fetch-notion-candidates', {
          body: {},
        });
        
        // Parse type param for candidates
        const candidatesUrl = new URL('https://dummy.com');
        candidatesUrl.searchParams.set('type', 'candidates');
        
        const candidatesData = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fetch-notion-candidates?type=candidates`,
          {
            headers: {
              'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
              'Content-Type': 'application/json',
            },
          }
        ).then(r => r.json());

        if (candidatesData.success) {
          setCandidates(candidatesData.candidates || []);
        }

      } catch (err) {
        console.error('Error fetching data:', err);
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Get unique values for filters
  const filterOptions = useMemo(() => {
    const stages = new Set<string>();
    const expertise = new Set<string>();
    const entities = new Set<string>();

    shortlist.forEach(entry => {
      if (entry.stage) stages.add(entry.stage);
      if (entry.entity) entities.add(entry.entity);
      entry.candidate?.expertise?.forEach(e => expertise.add(e));
    });

    return {
      stages: Array.from(stages),
      expertise: Array.from(expertise),
      entities: Array.from(entities),
    };
  }, [shortlist]);

  // Filter shortlist
  const filteredShortlist = useMemo(() => {
    return shortlist.filter(entry => {
      // Search filter
      if (filters.search) {
        const search = filters.search.toLowerCase();
        const matchName = entry.name?.toLowerCase().includes(search);
        const matchCandidate = entry.candidate?.name?.toLowerCase().includes(search);
        const matchEmail = entry.candidate?.email?.toLowerCase().includes(search);
        if (!matchName && !matchCandidate && !matchEmail) return false;
      }

      // Stage filter
      if (filters.stage.length > 0 && entry.stage && !filters.stage.includes(entry.stage)) {
        return false;
      }

      // Entity filter
      if (filters.entity.length > 0 && entry.entity && !filters.entity.includes(entry.entity)) {
        return false;
      }

      // Expertise filter
      if (filters.expertise.length > 0) {
        const candidateExpertise = entry.candidate?.expertise || [];
        if (!filters.expertise.some(e => candidateExpertise.includes(e))) {
          return false;
        }
      }

      return true;
    });
  }, [shortlist, filters]);

  // Group by stage for pipeline
  const pipelineData = useMemo(() => {
    const grouped: Record<string, ShortlistEntry[]> = {};
    PIPELINE_STAGES.forEach(stage => {
      grouped[stage.key] = [];
    });

    filteredShortlist.forEach(entry => {
      const stage = entry.stage || 'Pressenti';
      if (grouped[stage]) {
        grouped[stage].push(entry);
      } else {
        grouped['Pressenti'].push(entry);
      }
    });

    return grouped;
  }, [filteredShortlist]);

  // Handle stage change (optimistic update)
  const handleStageChange = (entryId: string, newStage: string) => {
    setShortlist(prev => prev.map(entry => 
      entry.id === entryId ? { ...entry, stage: newStage } : entry
    ));
  };

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <SEOHead
        title="Gestion des candidats | Konekt"
        description="Gérez vos candidats et suivez leur progression dans le pipeline de recrutement"
      />
      <Navbar />

      <main className="pt-20 pb-12">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <Users className="w-8 h-8 text-[#1A1A1A]" />
              <h1 className="text-3xl font-bold text-[#1A1A1A]">Candidats</h1>
            </div>
            <p className="text-[#1A1A1A]/60">
              {shortlist.length} candidature{shortlist.length > 1 ? 's' : ''} • {candidates.length} candidat{candidates.length > 1 ? 's' : ''} en base
            </p>
          </div>

          {/* View toggle and filters */}
          <div className="mb-6">
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'pipeline' | 'list')}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                <TabsList className="bg-white border border-[#1A1A1A]/10">
                  <TabsTrigger value="pipeline" className="gap-2 data-[state=active]:bg-[#1A1A1A] data-[state=active]:text-white">
                    <LayoutGrid className="w-4 h-4" />
                    Pipeline
                  </TabsTrigger>
                  <TabsTrigger value="list" className="gap-2 data-[state=active]:bg-[#1A1A1A] data-[state=active]:text-white">
                    <List className="w-4 h-4" />
                    Liste
                  </TabsTrigger>
                </TabsList>

                <CandidateFilters
                  filters={filters}
                  onFiltersChange={setFilters}
                  options={filterOptions}
                />
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="w-8 h-8 animate-spin text-[#1A1A1A]/40" />
                </div>
              ) : error ? (
                <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
                  <p className="text-red-600">{error}</p>
                </div>
              ) : (
                <>
                  <TabsContent value="pipeline" className="mt-0">
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
      </main>
    </div>
  );
}
