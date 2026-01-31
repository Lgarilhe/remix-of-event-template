import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { User } from '@supabase/supabase-js';
import { Navbar } from '@/components/Navbar';
import { SEOHead } from '@/components/SEOHead';
import { ATSKanban } from '@/components/ats/ATSKanban';
import { ATSTable } from '@/components/ats/ATSTable';
import { ATSTimeline } from '@/components/ats/ATSTimeline';
import { ATSFilters } from '@/components/ats/ATSFilters';
import { ATSStats } from '@/components/ats/ATSStats';
import { RemindersSidebar } from '@/components/ats/RemindersSidebar';
import { CandidateDetailModal } from '@/components/ats/CandidateDetailModal';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Loader2, LayoutGrid, Table, Clock, Bell, Users } from 'lucide-react';
import { toast } from 'sonner';

// Types
export interface ATSCandidate {
  id: string; // Unique identifier (shortlist ID or sequence enrollment ID)
  candidateId: string; // Notion candidate ID or LinkedIn profile ID
  name: string;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  headline: string | null;
  expertise: string[];
  stage: string;
  entity: string | null;
  source: 'shortlist' | 'sequence' | 'inmail';
  sourceId: string; // Original ID in source system
  jobId: string | null;
  jobTitle: string | null;
  sequenceId?: string;
  sequenceName?: string;
  sequenceStatus?: string;
  connectionStatus?: string;
  lastActivity: string | null;
  createdAt: string;
  notesCount?: number;
  hasReminder?: boolean;
}

export interface ATSActivity {
  id: string;
  candidateId: string;
  type: 'stage_change' | 'message_sent' | 'message_received' | 'note_added' | 'reminder_set' | 'sequence_enrolled' | 'inmail_sent';
  description: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  createdBy?: string;
}

export const ATS_STAGES = [
  { key: 'Nouveau', label: 'Nouveau', color: 'bg-slate-100 border-slate-300' },
  { key: 'Contacté', label: 'Contacté', color: 'bg-blue-50 border-blue-300' },
  { key: 'Répondu', label: 'Répondu', color: 'bg-cyan-50 border-cyan-300' },
  { key: 'Pressenti', label: 'Pressenti', color: 'bg-gray-100 border-gray-300' },
  { key: 'CV envoyé', label: 'CV envoyé', color: 'bg-indigo-50 border-indigo-300' },
  { key: 'ITW en cours', label: 'ITW en cours', color: 'bg-yellow-50 border-yellow-300' },
  { key: 'Offre', label: 'Offre', color: 'bg-purple-50 border-purple-300' },
  { key: 'Gagné', label: 'Gagné', color: 'bg-green-50 border-green-300' },
  { key: 'Perdu', label: 'Perdu', color: 'bg-red-50 border-red-300' },
];

export default function ATS() {
  const [user, setUser] = useState<User | null>(null);
  const [candidates, setCandidates] = useState<ATSCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'kanban' | 'table' | 'timeline'>('kanban');
  const [showReminders, setShowReminders] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<ATSCandidate | null>(null);
  
  // Filters
  const [filters, setFilters] = useState({
    search: '',
    stage: [] as string[],
    source: [] as string[],
    job: [] as string[],
    hasReminder: false,
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

  // Fetch all data sources
  const fetchData = async () => {
    setLoading(true);
    setError(null);

    try {
      const allCandidates: ATSCandidate[] = [];

      // 1. Fetch shortlist from Notion
      const shortlistResponse = await supabase.functions.invoke('fetch-notion-candidates', {
        body: {},
      });

      if (shortlistResponse.data?.success && shortlistResponse.data.shortlist) {
        const shortlistCandidates = shortlistResponse.data.shortlist.map((entry: any) => ({
          id: `shortlist-${entry.id}`,
          candidateId: entry.candidate?.id || entry.id,
          name: entry.candidate?.name || entry.name || 'Sans nom',
          email: entry.candidate?.email || null,
          phone: entry.candidate?.phone || null,
          linkedin: entry.candidate?.linkedin || null,
          headline: null,
          expertise: entry.candidate?.expertise || [],
          stage: entry.stage || 'Pressenti',
          entity: entry.entity || null,
          source: 'shortlist' as const,
          sourceId: entry.id,
          jobId: entry.positions?.[0]?.id || null,
          jobTitle: entry.positions?.[0]?.name || null,
          lastActivity: entry.createdAt || null,
          createdAt: entry.createdAt || new Date().toISOString(),
        }));
        allCandidates.push(...shortlistCandidates);
      }

      // 2. Fetch sequence enrollments
      const { data: enrollments, error: enrollmentsError } = await supabase
        .from('sequence_enrollments')
        .select(`
          *,
          outreach_sequences (id, name)
        `)
        .order('created_at', { ascending: false });

      if (!enrollmentsError && enrollments) {
        const sequenceCandidates = enrollments.map((enrollment: any) => {
          // Map sequence status to stage
          let stage = 'Contacté';
          if (enrollment.replied_at) {
            stage = 'Répondu';
          } else if (enrollment.status === 'active') {
            stage = 'Contacté';
          } else if (enrollment.status === 'completed') {
            stage = 'Contacté';
          } else if (enrollment.status === 'paused') {
            stage = 'Nouveau';
          }

          return {
            id: `sequence-${enrollment.id}`,
            candidateId: enrollment.profile_id,
            name: enrollment.profile_name || 'Profil LinkedIn',
            email: null,
            phone: null,
            linkedin: enrollment.profile_url || null,
            headline: enrollment.profile_headline || null,
            expertise: [],
            stage,
            entity: null,
            source: 'sequence' as const,
            sourceId: enrollment.id,
            jobId: enrollment.job_id || null,
            jobTitle: enrollment.job_title || null,
            sequenceId: enrollment.sequence_id,
            sequenceName: enrollment.outreach_sequences?.name || null,
            sequenceStatus: enrollment.status,
            connectionStatus: enrollment.connection_status,
            lastActivity: enrollment.updated_at || enrollment.created_at,
            createdAt: enrollment.created_at,
          };
        });
        allCandidates.push(...sequenceCandidates);
      }

      // 3. Fetch InMail queue items (sent or pending)
      const { data: inmails, error: inmailsError } = await supabase
        .from('inmail_queue')
        .select('*')
        .order('created_at', { ascending: false });

      if (!inmailsError && inmails) {
        const inmailCandidates = inmails
          .filter((inmail: any) => {
            // Don't duplicate if already in sequences
            const profileId = inmail.recipient_profile_id;
            return !allCandidates.some(c => c.candidateId === profileId);
          })
          .map((inmail: any) => ({
            id: `inmail-${inmail.id}`,
            candidateId: inmail.recipient_profile_id,
            name: inmail.recipient_name || 'Profil LinkedIn',
            email: null,
            phone: null,
            linkedin: null,
            headline: inmail.recipient_headline || null,
            expertise: [],
            stage: inmail.status === 'sent' ? 'Contacté' : 'Nouveau',
            entity: null,
            source: 'inmail' as const,
            sourceId: inmail.id,
            jobId: null,
            jobTitle: null,
            lastActivity: inmail.sent_at || inmail.created_at,
            createdAt: inmail.created_at,
          }));
        allCandidates.push(...inmailCandidates);
      }

      // 4. Fetch notes count per candidate
      const { data: notesCounts } = await supabase
        .from('candidate_notes')
        .select('candidate_id');

      if (notesCounts) {
        const notesMap = new Map<string, number>();
        notesCounts.forEach((note: any) => {
          const count = notesMap.get(note.candidate_id) || 0;
          notesMap.set(note.candidate_id, count + 1);
        });

        allCandidates.forEach(candidate => {
          candidate.notesCount = notesMap.get(candidate.candidateId) || 0;
        });
      }

      // 5. Fetch reminders to mark candidates
      const { data: reminders } = await supabase
        .from('candidate_reminders')
        .select('candidate_id')
        .is('completed_at', null);

      if (reminders) {
        const reminderSet = new Set(reminders.map((r: any) => r.candidate_id));
        allCandidates.forEach(candidate => {
          candidate.hasReminder = reminderSet.has(candidate.candidateId);
        });
      }

      setCandidates(allCandidates);
    } catch (err) {
      console.error('Error fetching ATS data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user]);

  // Get unique values for filters
  const filterOptions = useMemo(() => {
    const stages = new Set<string>();
    const sources = new Set<string>();
    const jobsMap = new Map<string, string>();

    candidates.forEach(candidate => {
      stages.add(candidate.stage);
      sources.add(candidate.source);
      if (candidate.jobId && candidate.jobTitle) {
        jobsMap.set(candidate.jobId, candidate.jobTitle);
      }
    });

    return {
      stages: Array.from(stages),
      sources: Array.from(sources),
      jobs: Array.from(jobsMap.entries()).map(([id, title]) => ({ id, title })),
    };
  }, [candidates]);

  // Filter candidates
  const filteredCandidates = useMemo(() => {
    return candidates.filter(candidate => {
      // Search filter
      if (filters.search) {
        const search = filters.search.toLowerCase();
        const matchName = candidate.name?.toLowerCase().includes(search);
        const matchEmail = candidate.email?.toLowerCase().includes(search);
        const matchHeadline = candidate.headline?.toLowerCase().includes(search);
        const matchJob = candidate.jobTitle?.toLowerCase().includes(search);
        if (!matchName && !matchEmail && !matchHeadline && !matchJob) return false;
      }

      // Stage filter
      if (filters.stage.length > 0 && !filters.stage.includes(candidate.stage)) {
        return false;
      }

      // Source filter
      if (filters.source.length > 0 && !filters.source.includes(candidate.source)) {
        return false;
      }

      // Job filter
      if (filters.job.length > 0 && candidate.jobId && !filters.job.includes(candidate.jobId)) {
        return false;
      }

      // Reminder filter
      if (filters.hasReminder && !candidate.hasReminder) {
        return false;
      }

      return true;
    });
  }, [candidates, filters]);

  // Group by stage for Kanban
  const kanbanData = useMemo(() => {
    const grouped: Record<string, ATSCandidate[]> = {};
    ATS_STAGES.forEach(stage => {
      grouped[stage.key] = [];
    });

    filteredCandidates.forEach(candidate => {
      const stage = candidate.stage || 'Nouveau';
      if (grouped[stage]) {
        grouped[stage].push(candidate);
      } else {
        grouped['Nouveau'].push(candidate);
      }
    });

    return grouped;
  }, [filteredCandidates]);

  // Handle stage change
  const handleStageChange = async (candidateId: string, newStage: string) => {
    const candidate = candidates.find(c => c.id === candidateId);
    if (!candidate) return;

    // Optimistic update
    setCandidates(prev => prev.map(c => 
      c.id === candidateId ? { ...c, stage: newStage } : c
    ));

    // If shortlist, update in Notion
    if (candidate.source === 'shortlist') {
      try {
        const response = await supabase.functions.invoke('update-candidate-stage', {
          body: {
            shortlistId: candidate.sourceId,
            newStage,
          },
        });

        if (response.error || !response.data?.success) {
          throw new Error(response.data?.error || 'Failed to update stage');
        }

        toast.success(`Candidat déplacé vers "${newStage}"`);
      } catch (error) {
        console.error('Error updating stage:', error);
        toast.error('Erreur lors de la mise à jour');
        // Revert
        setCandidates(prev => prev.map(c => 
          c.id === candidateId ? { ...c, stage: candidate.stage } : c
        ));
      }
    } else {
      // For sequences/inmails, just update locally (no Notion sync)
      toast.success(`Candidat déplacé vers "${newStage}"`);
    }
  };

  const handleCandidateClick = (candidate: ATSCandidate) => {
    setSelectedCandidate(candidate);
  };

  const handleRefresh = () => {
    fetchData();
  };

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <SEOHead
        title="ATS - Suivi des candidats | Konekt"
        description="Centralisez et gérez toutes vos interactions avec les candidats"
      />
      <Navbar />

      <main className="pt-20 pb-12">
        <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <Users className="w-8 h-8 text-[#1A1A1A]" />
                  <h1 className="text-3xl font-bold text-[#1A1A1A]">ATS</h1>
                </div>
                <p className="text-[#1A1A1A]/60">
                  {candidates.length} candidat{candidates.length > 1 ? 's' : ''} • Toutes sources confondues
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowReminders(!showReminders)}
                  className={showReminders ? 'bg-amber-50 border-amber-300' : ''}
                >
                  <Bell className="w-4 h-4 mr-2" />
                  Rappels
                </Button>
              </div>
            </div>
          </div>

          {/* Stats */}
          <ATSStats candidates={filteredCandidates} stages={ATS_STAGES} />

          {/* Filters and View Toggle */}
          <div className="mb-6">
            <Tabs value={activeView} onValueChange={(v) => setActiveView(v as any)}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                <TabsList className="bg-white border border-[#1A1A1A]/10">
                  <TabsTrigger value="kanban" className="gap-2 data-[state=active]:bg-[#1A1A1A] data-[state=active]:text-white">
                    <LayoutGrid className="w-4 h-4" />
                    Kanban
                  </TabsTrigger>
                  <TabsTrigger value="table" className="gap-2 data-[state=active]:bg-[#1A1A1A] data-[state=active]:text-white">
                    <Table className="w-4 h-4" />
                    Table
                  </TabsTrigger>
                  <TabsTrigger value="timeline" className="gap-2 data-[state=active]:bg-[#1A1A1A] data-[state=active]:text-white">
                    <Clock className="w-4 h-4" />
                    Timeline
                  </TabsTrigger>
                </TabsList>

                <ATSFilters
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
                  <Button variant="outline" onClick={handleRefresh} className="mt-4">
                    Réessayer
                  </Button>
                </div>
              ) : (
                <div className="flex gap-6">
                  <div className="flex-1 min-w-0">
                    <TabsContent value="kanban" className="mt-0">
                      <ATSKanban
                        data={kanbanData}
                        stages={ATS_STAGES}
                        onStageChange={handleStageChange}
                        onCandidateClick={handleCandidateClick}
                      />
                    </TabsContent>

                    <TabsContent value="table" className="mt-0">
                      <ATSTable
                        candidates={filteredCandidates}
                        onCandidateClick={handleCandidateClick}
                      />
                    </TabsContent>

                    <TabsContent value="timeline" className="mt-0">
                      <ATSTimeline
                        candidates={filteredCandidates}
                        onCandidateClick={handleCandidateClick}
                      />
                    </TabsContent>
                  </div>

                  {showReminders && (
                    <RemindersSidebar
                      onClose={() => setShowReminders(false)}
                      onReminderClick={(candidateId) => {
                        const candidate = candidates.find(c => c.candidateId === candidateId);
                        if (candidate) setSelectedCandidate(candidate);
                      }}
                    />
                  )}
                </div>
              )}
            </Tabs>
          </div>
        </div>
      </main>

      {/* Candidate Detail Modal */}
      {selectedCandidate && (
        <CandidateDetailModal
          candidate={selectedCandidate}
          onClose={() => setSelectedCandidate(null)}
          onStageChange={handleStageChange}
          onRefresh={handleRefresh}
        />
      )}
    </div>
  );
}
