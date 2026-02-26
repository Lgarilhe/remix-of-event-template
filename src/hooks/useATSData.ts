import { useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// Types
export interface ATSCandidate {
  id: string;
  candidateId: string;
  name: string;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  headline: string | null;
  expertise: string[];
  stage: string;
  entity: string | null;
  source: 'shortlist' | 'sequence' | 'inmail' | 'outreach';
  sourceId: string;
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
  score?: number | null;
  recommendation?: string | null;
  outreachStatus?: string | null;
  scoringDetails?: {
    match_score: number;
    matching_skills: string[];
    missing_skills: string[];
    experience_match: string;
    location_match: boolean;
    summary: string;
    recommendation: string;
    salary_analysis?: any;
  } | null;
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

// Cache configuration
const STALE_TIME = 30 * 60 * 1000; // 30 minutes - use cached data aggressively
const GC_TIME = 60 * 60 * 1000; // 1 hour - keep in cache

// Transform shortlist response to ATSCandidate format
function transformShortlist(data: any): ATSCandidate[] {
  if (!data?.success || !data.shortlist) {
    return [];
  }

  return data.shortlist.map((entry: any) => ({
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
}

// Fetch functions - uses stale-while-revalidate pattern
async function fetchShortlist(forceRefresh = false): Promise<ATSCandidate[]> {
  const response = await supabase.functions.invoke('fetch-notion-candidates', {
    body: {},
    // Pass refresh param via query string
  });

  return transformShortlist(response.data);
}

async function fetchSequences(): Promise<ATSCandidate[]> {
  const { data: enrollments, error } = await supabase
    .from('sequence_enrollments')
    .select(`*, outreach_sequences (id, name)`)
    .order('created_at', { ascending: false });

  if (error || !enrollments) return [];

  return enrollments.map((enrollment: any) => {
    let stage = 'Contacté';
    if (enrollment.replied_at) {
      stage = 'Répondu';
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
}

async function fetchInMails(existingProfileIds: Set<string>): Promise<ATSCandidate[]> {
  const { data: inmails, error } = await supabase
    .from('inmail_queue')
    .select('*')
    .order('created_at', { ascending: false });

  if (error || !inmails) return [];

  return inmails
    .filter((inmail: any) => !existingProfileIds.has(inmail.recipient_profile_id))
    .map((inmail: any) => ({
      id: `inmail-${inmail.id}`,
      candidateId: inmail.recipient_profile_id,
      name: inmail.recipient_name || 'Profil LinkedIn',
      email: null,
      phone: null,
      linkedin: null,
      headline: inmail.recipient_headline || null,
      expertise: [],
      stage: inmail.status === 'replied' ? 'Répondu' : inmail.status === 'sent' ? 'Contacté' : 'Nouveau',
      entity: null,
      source: 'inmail' as const,
      sourceId: inmail.id,
      jobId: null,
      jobTitle: null,
      lastActivity: inmail.sent_at || inmail.created_at,
      createdAt: inmail.created_at,
    }));
}

// Fetch outreach candidates (scored, messaged, etc.) from job_candidate_status
async function fetchOutreachCandidates(existingProfileIds: Set<string>): Promise<ATSCandidate[]> {
  const { data: records, error } = await supabase
    .from('job_candidate_status')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(500);

  if (error || !records) return [];

  const STATUS_TO_STAGE: Record<string, string> = {
    'scored': 'Nouveau',
    'shortlisted': 'Pressenti',
    'messaged': 'Contacté',
    'replied': 'Répondu',
    'interested': 'Répondu',
    'not_interested': 'Perdu',
    'dismissed': 'Perdu',
  };

  return records
    .filter((r: any) => !existingProfileIds.has(r.candidate_id))
    .map((r: any) => ({
      id: `outreach-${r.id}`,
      candidateId: r.candidate_id,
      name: r.candidate_name || 'Profil LinkedIn',
      email: null,
      phone: null,
      linkedin: r.linkedin_profile_url || null,
      headline: r.candidate_headline || null,
      expertise: [],
      stage: STATUS_TO_STAGE[r.status] || 'Nouveau',
      entity: null,
      source: 'outreach' as const,
      sourceId: r.id,
      jobId: r.job_id || null,
      jobTitle: null,
      lastActivity: r.updated_at || r.created_at,
      createdAt: r.created_at,
      score: r.score,
      recommendation: r.recommendation,
      outreachStatus: r.status,
      scoringDetails: r.scoring_details || null,
    }));
}

async function fetchMetadata(candidates: ATSCandidate[]): Promise<ATSCandidate[]> {
  const [notesResult, remindersResult] = await Promise.all([
    supabase.from('candidate_notes').select('candidate_id'),
    supabase.from('candidate_reminders').select('candidate_id').is('completed_at', null),
  ]);

  const notesMap = new Map<string, number>();
  if (notesResult.data) {
    notesResult.data.forEach((note: any) => {
      const count = notesMap.get(note.candidate_id) || 0;
      notesMap.set(note.candidate_id, count + 1);
    });
  }

  const reminderSet = new Set<string>();
  if (remindersResult.data) {
    remindersResult.data.forEach((r: any) => reminderSet.add(r.candidate_id));
  }

  return candidates.map(candidate => ({
    ...candidate,
    notesCount: notesMap.get(candidate.candidateId) || 0,
    hasReminder: reminderSet.has(candidate.candidateId),
  }));
}

// Main fetch function that combines all sources
async function fetchAllCandidates(): Promise<ATSCandidate[]> {
  // Fetch shortlist, sequences, and outreach scores in parallel
  const [shortlistCandidates, sequenceCandidates, allOutreachRecords] = await Promise.all([
    fetchShortlist(),
    fetchSequences(),
    // Fetch ALL outreach records (including those that overlap) for score enrichment
    (async () => {
      const { data } = await supabase
        .from('job_candidate_status')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(500);
      return data || [];
    })(),
  ]);

  // Build a score lookup map from outreach records
  const scoreLookup = new Map<string, { score: number | null; recommendation: string | null; status: string; scoringDetails: any }>();
  for (const r of allOutreachRecords) {
    // Keep the highest score per candidate
    const existing = scoreLookup.get(r.candidate_id);
    if (!existing || (r.score && (!existing.score || r.score > existing.score))) {
      scoreLookup.set(r.candidate_id, { 
        score: r.score, 
        recommendation: r.recommendation, 
        status: r.status,
        scoringDetails: (r as any).scoring_details || null,
      });
    }
  }

  // Enrich shortlist and sequence candidates with scores
  const enrichedShortlist = shortlistCandidates.map(c => {
    const scoreData = scoreLookup.get(c.candidateId);
    return scoreData ? { ...c, score: scoreData.score, recommendation: scoreData.recommendation, outreachStatus: scoreData.status, scoringDetails: scoreData.scoringDetails } : c;
  });
  const enrichedSequences = sequenceCandidates.map(c => {
    const scoreData = scoreLookup.get(c.candidateId);
    return scoreData ? { ...c, score: scoreData.score, recommendation: scoreData.recommendation, outreachStatus: scoreData.status, scoringDetails: scoreData.scoringDetails } : c;
  });

  // Combine for deduplication before fetching inmails + outreach-only candidates
  const combined = [...enrichedShortlist, ...enrichedSequences];
  const existingProfileIds = new Set(combined.map(c => c.candidateId));

  // Fetch inmails and outreach-only candidates (those not in shortlist/sequences)
  const [inmailCandidates, outreachOnlyCandidates] = await Promise.all([
    fetchInMails(existingProfileIds),
    fetchOutreachCandidates(existingProfileIds),
  ]);

  // Enrich inmails too
  const enrichedInmails = inmailCandidates.map(c => {
    const scoreData = scoreLookup.get(c.candidateId);
    return scoreData ? { ...c, score: scoreData.score, recommendation: scoreData.recommendation, outreachStatus: scoreData.status, scoringDetails: scoreData.scoringDetails } : c;
  });

  // Combine all
  const allCandidates = [...combined, ...enrichedInmails, ...outreachOnlyCandidates];

  // Fetch and apply metadata
  return fetchMetadata(allCandidates);
}

export function useATSData() {
  const queryClient = useQueryClient();

  // Main query with caching
  const {
    data: candidates = [],
    isLoading: loading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ['ats-candidates'],
    queryFn: fetchAllCandidates,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    refetchOnWindowFocus: false, // Don't refetch on tab focus
  });

  // Handle stage change with optimistic update
  const handleStageChange = useCallback(async (candidateId: string, newStage: string) => {
    const candidate = candidates.find(c => c.id === candidateId);
    if (!candidate) return;

    const oldStage = candidate.stage;

    // Optimistic update in cache
    queryClient.setQueryData<ATSCandidate[]>(['ats-candidates'], (old) => 
      old?.map(c => c.id === candidateId ? { ...c, stage: newStage } : c) ?? []
    );

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
        // Revert optimistic update
        queryClient.setQueryData<ATSCandidate[]>(['ats-candidates'], (old) => 
          old?.map(c => c.id === candidateId ? { ...c, stage: oldStage } : c) ?? []
        );
      }
    } else {
      toast.success(`Candidat déplacé vers "${newStage}"`);
    }
  }, [candidates, queryClient]);

  // Check if data is from cache (instant load)
  const isFromCache = !loading && !isFetching && candidates.length > 0;

  return {
    candidates,
    loading,
    isFetching, // True when background refetch is happening
    isFromCache,
    error: error ? (error instanceof Error ? error.message : 'Failed to load data') : null,
    refetch: () => refetch(),
    handleStageChange,
  };
}
