import { useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
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
  source: 'local' | 'sequence' | 'inmail';
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
  notionShortlistId?: string | null;
  notionCandidateId?: string | null;
  tags?: string[];
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
  linkedinProfileData?: any;
}

export const ATS_STAGES = [
  { key: 'Nouveau', label: 'Nouveau', color: 'bg-muted border-border' },
  { key: 'Contacté', label: 'Contacté', color: 'bg-info/10 border-info/30' },
  { key: 'Répondu', label: 'Répondu', color: 'bg-brand-cyan/10 border-brand-cyan/30' },
  { key: 'Pressenti', label: 'Pressenti', color: 'bg-muted border-border' },
  { key: 'Pré-qualif', label: 'Pré-qualif', color: 'bg-brand-cyan/10 border-brand-cyan/30' },
  { key: 'CV envoyé', label: 'CV envoyé', color: 'bg-brand-purple/10 border-brand-purple/30' },
  { key: 'ITW en cours', label: 'ITW en cours', color: 'bg-warning/10 border-warning/30' },
  { key: 'Offre', label: 'Offre', color: 'bg-brand-purple/10 border-brand-purple/30' },
  { key: 'Gagné', label: 'Gagné', color: 'bg-success/10 border-success/30' },
  { key: 'Perdu', label: 'Perdu', color: 'bg-destructive/10 border-destructive/30' },
];

// Cache configuration
const STALE_TIME = 30 * 60 * 1000;
const GC_TIME = 60 * 60 * 1000;

// Map old status values to pipeline stages
const STATUS_TO_STAGE: Record<string, string> = {
  'discovered': 'Nouveau',
  'untreated': 'Nouveau',
  'scored': 'Nouveau',
  'shortlisted': 'Pressenti',
  'messaged': 'Contacté',
  'replied': 'Répondu',
  'interested': 'Répondu',
  'not_interested': 'Répondu',
  'qualification': 'Pré-qualif',
  'dismissed': 'Perdu',
};

// Stage hierarchy index (higher = more advanced, except Perdu which is terminal)
const STAGE_ORDER: Record<string, number> = {
  'Nouveau': 0,
  'Contacté': 1,
  'Répondu': 2,
  'Pressenti': 3,
  'Pré-qualif': 4,
  'CV envoyé': 5,
  'ITW en cours': 6,
  'Offre': 7,
  'Gagné': 8,
  'Perdu': -1, // terminal, never auto-promoted out of it
};

// Compute effective stage: never downgrade from what the status implies
function computeEffectiveStage(pipelineStage: string | null, status: string): string {
  const statusDerivedStage = STATUS_TO_STAGE[status] || 'Nouveau';
  
  if (!pipelineStage) return statusDerivedStage;
  
  // If pipeline_stage is Perdu, keep it (explicit decision)
  if (pipelineStage === 'Perdu') return 'Perdu';
  
  // If status implies Perdu but pipeline says otherwise, trust pipeline
  if (statusDerivedStage === 'Perdu') return pipelineStage;
  
  const pipelineOrder = STAGE_ORDER[pipelineStage] ?? 0;
  const statusOrder = STAGE_ORDER[statusDerivedStage] ?? 0;
  
  // Take the more advanced of the two
  return statusOrder > pipelineOrder ? statusDerivedStage : pipelineStage;
}

// Columns needed for ATS display (excluding heavy linkedin_profile_data JSON)
const JCS_DISPLAY_COLUMNS = 'id, candidate_id, candidate_name, candidate_headline, linkedin_profile_url, status, pipeline_stage, score, recommendation, job_id, tags, updated_at, created_at, notion_shortlist_id, notion_candidate_id, scoring_details';

// Fetch all candidates from local job_candidate_status table (primary source)
async function fetchLocalCandidates(): Promise<ATSCandidate[]> {
  // Fetch with selective columns (no linkedin_profile_data) — paginate to avoid 1000-row limit
  const allRecords: any[] = [];
  let from = 0;
  const PAGE_SIZE = 1000;
  const MAX_PAGES = 100; // Safety cap: 100 × 1000 = 100k rows max
  for (let page_i = 0; page_i < MAX_PAGES; page_i++) {
    const { data: page, error: pageError } = await supabase
      .from('job_candidate_status')
      .select(JCS_DISPLAY_COLUMNS)
      .order('updated_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (pageError || !page || page.length === 0) break;
    allRecords.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
    if (page_i === MAX_PAGES - 1) {
      console.warn(`[useATSData] fetchLocalCandidates hit max page cap (${MAX_PAGES}), ${allRecords.length} rows loaded`);
    }
  }
  const records = allRecords;
  const error = null;

  if (error || !records) return [];

  return records.map((r: any) => {
    // Use pipeline_stage if set, otherwise derive from status
    const stage = computeEffectiveStage(r.pipeline_stage, r.status);

    return {
      id: `local-${r.id}`,
      candidateId: r.candidate_id,
      name: r.candidate_name || 'Profil LinkedIn',
      email: null,
      phone: null,
      linkedin: r.linkedin_profile_url && r.linkedin_profile_url.includes('/in/') ? r.linkedin_profile_url : null,
      headline: r.candidate_headline || null,
      expertise: [],
      stage,
      entity: null,
      source: 'local' as const,
      sourceId: r.id,
      jobId: r.job_id || null,
      jobTitle: null,
      lastActivity: r.updated_at || r.created_at,
      createdAt: r.created_at,
      score: r.score,
      recommendation: r.recommendation,
      outreachStatus: r.status,
      notionShortlistId: r.notion_shortlist_id || null,
      notionCandidateId: r.notion_candidate_id || null,
      tags: r.tags || [],
      scoringDetails: r.scoring_details || null,
      linkedinProfileData: r.linkedin_profile_data || null,
    };
  });
}

// Fetch sequence enrollments for enrichment
async function fetchSequenceEnrichment(): Promise<Map<string, { sequenceId: string; sequenceName: string; sequenceStatus: string; connectionStatus: string }>> {
  const { data: enrollments, error } = await supabase
    .from('sequence_enrollments')
    .select('profile_id, sequence_id, status, connection_status, job_id, job_title, outreach_sequences (id, name)')
    .order('created_at', { ascending: false });

  const map = new Map();
  if (!error && enrollments) {
    for (const e of enrollments) {
      if (!map.has(e.profile_id)) {
        map.set(e.profile_id, {
          sequenceId: e.sequence_id,
          sequenceName: (e as any).outreach_sequences?.name || null,
          sequenceStatus: e.status,
          connectionStatus: e.connection_status,
          jobId: e.job_id || null,
          jobTitle: e.job_title || null,
        });
      }
    }
  }
  return map;
}

// Fetch standalone sequence candidates not in job_candidate_status
async function fetchSequenceOnlyCandidates(existingIds: Set<string>): Promise<ATSCandidate[]> {
  const { data: enrollments, error } = await supabase
    .from('sequence_enrollments')
    .select('id, sequence_id, profile_id, profile_name, profile_headline, profile_url, status, connection_status, job_id, job_title, replied_at, updated_at, created_at, outreach_sequences (id, name)')
    .order('created_at', { ascending: false });

  if (error || !enrollments) return [];

  return enrollments
    .filter((e: any) => !existingIds.has(e.profile_id))
    .map((enrollment: any) => {
      let stage = 'Contacté';
      if (enrollment.replied_at) stage = 'Répondu';
      else if (enrollment.status === 'paused') stage = 'Nouveau';

      return {
        id: `sequence-${enrollment.id}`,
        candidateId: enrollment.profile_id,
        name: enrollment.profile_name || 'Profil LinkedIn',
        email: null,
        phone: null,
        linkedin: enrollment.profile_url && enrollment.profile_url.includes('/in/') ? enrollment.profile_url : null,
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

// Fetch standalone InMail candidates not in job_candidate_status
async function fetchInMailOnlyCandidates(existingIds: Set<string>): Promise<ATSCandidate[]> {
  const { data: inmails, error } = await supabase
    .from('inmail_queue')
    .select('id, recipient_profile_id, recipient_name, recipient_headline, status, sent_at, created_at')
    .order('created_at', { ascending: false });

  if (error || !inmails) return [];

  return inmails
    .filter((inmail: any) => !existingIds.has(inmail.recipient_profile_id))
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

// Fetch metadata (notes & reminders)
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

// Fetch job titles from sourcing_projects
async function fetchJobTitlesMap(): Promise<Map<string, string>> {
  const { data } = await supabase
    .from('sourcing_projects')
    .select('job_id, job_title')
    .not('job_id', 'is', null)
    .not('job_title', 'is', null);

  const map = new Map<string, string>();
  if (data) {
    data.forEach((p: any) => {
      if (p.job_id && p.job_title) map.set(p.job_id, p.job_title);
    });
  }
  return map;
}

// Main fetch: local table is primary, sequences & inmails fill gaps
async function fetchAllCandidates(): Promise<ATSCandidate[]> {
  const [localCandidates, sequenceEnrichment, jobTitlesMap] = await Promise.all([
    fetchLocalCandidates(),
    fetchSequenceEnrichment(),
    fetchJobTitlesMap(),
  ]);

  // Enrich local candidates with sequence data AND job titles
  const enrichedLocal = localCandidates.map(c => {
    const seqData = sequenceEnrichment.get(c.candidateId);
    const jobTitle = c.jobTitle || (c.jobId ? jobTitlesMap.get(c.jobId) : null) || (seqData as any)?.jobTitle || null;
    const enriched = seqData ? { ...c, ...seqData } : c;
    return { ...enriched, jobTitle: enriched.jobTitle || jobTitle };
  });

  const existingIds = new Set(enrichedLocal.map(c => c.candidateId));

  // Fetch candidates only in sequences/inmails (not in local table)
  const [seqOnly, inmailOnly] = await Promise.all([
    fetchSequenceOnlyCandidates(existingIds),
    fetchInMailOnlyCandidates(existingIds),
  ]);

  const all = [...enrichedLocal, ...seqOnly, ...inmailOnly];
  return fetchMetadata(all);
}

export function useATSData() {
  const queryClient = useQueryClient();

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
    refetchOnWindowFocus: false,
  });

  // Handle stage change: update local DB first, then propagate to Notion
  const handleStageChange = useCallback(async (candidateId: string, newStage: string) => {
    const candidate = candidates.find(c => c.id === candidateId);
    if (!candidate) return;

    const oldStage = candidate.stage;

    // 1. Optimistic UI update
    queryClient.setQueryData<ATSCandidate[]>(['ats-candidates'], (old) =>
      old?.map(c => c.id === candidateId ? { ...c, stage: newStage } : c) ?? []
    );

    try {
      // 2. Update local database (source of truth)
      if (candidate.source === 'local') {
        const { error: updateError } = await supabase
          .from('job_candidate_status')
          .update({ pipeline_stage: newStage })
          .eq('id', candidate.sourceId);

        if (updateError) throw updateError;
      }

      // 3. Propagate to Notion in background (fire-and-forget)
      const notionShortlistId = candidate.notionShortlistId;
      if (notionShortlistId) {
        invokeEdgeFunction('update-candidate-stage', {
          shortlistId: notionShortlistId, newStage,
        }).catch(err => {
          console.warn('[ATS] Notion propagation failed (non-blocking):', err);
        });
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
  }, [candidates, queryClient]);

  // Handle tags update
  const handleTagsChange = useCallback(async (candidateId: string, tags: string[]) => {
    const candidate = candidates.find(c => c.id === candidateId);
    if (!candidate || candidate.source !== 'local') return;

    // Optimistic update
    queryClient.setQueryData<ATSCandidate[]>(['ats-candidates'], (old) =>
      old?.map(c => c.id === candidateId ? { ...c, tags } : c) ?? []
    );

    try {
      const { error: updateError } = await supabase
        .from('job_candidate_status')
        .update({ tags })
        .eq('id', candidate.sourceId);
      if (updateError) throw updateError;
    } catch (error) {
      console.error('Error updating tags:', error);
      toast.error('Erreur lors de la mise à jour des tags');
      queryClient.invalidateQueries({ queryKey: ['ats-candidates'] });
    }
  }, [candidates, queryClient]);

  const isFromCache = !loading && !isFetching && candidates.length > 0;

  return {
    candidates,
    loading,
    isFetching,
    isFromCache,
    error: error ? (error instanceof Error ? error.message : 'Failed to load data') : null,
    refetch: () => refetch(),
    handleStageChange,
    handleTagsChange,
  };
}
