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
// 🐛 TUNING Opus A4 : avant, staleTime=30min + refetchOnWindowFocus=false =
// données ATS périmées si un collègue (ou soi-même autre onglet) bouge un
// candidat. Pour un ATS temps-réel, 2min + refetchOnWindowFocus=true est plus
// raisonnable. L'user qui revient sur l'onglet après une pause voit toujours
// l'état à jour.
const STALE_TIME = 2 * 60 * 1000;
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

// Compute effective stage.
// 🐛 BUG FIX (Opus audit) : avant, on prenait le max entre pipeline_stage et
// STATUS_TO_STAGE[status] → si recruteur remettait manuellement "Contacté"
// alors que status='replied' (rang 2 > Contacté rang 1), le next fetch
// écrasait le choix manuel en "Répondu". User's explicit choice silencieusement
// annulé.
//
// Nouveau comportement : pipeline_stage > status mapping DANS TOUS LES CAS quand
// pipeline_stage est explicitement set. STATUS_TO_STAGE n'est qu'un FALLBACK
// quand pipeline_stage est null/vide (première découverte).
//
// Edge case : si status='dismissed' (explicite, dismissCandidate a été appelé),
// on force 'Perdu' — signal fort qui override tout (sinon un candidat dismissed
// resterait affiché à "Contacté" par erreur).
function computeEffectiveStage(pipelineStage: string | null, status: string): string {
  // Cas 1 : pas de pipeline_stage → on dérive depuis status
  if (!pipelineStage) return STATUS_TO_STAGE[status] || 'Nouveau';

  // Cas 2 : dismissed explicite → force Perdu (sécurité)
  if (status === 'dismissed') return 'Perdu';

  // Cas 3 : pipeline_stage explicite → source de vérité
  return pipelineStage;
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
    refetchOnWindowFocus: true, // Fix Opus A4 — voir commentaire sur STALE_TIME
  });

  // Handle stage change: update local DB first, then propagate to Notion
  const handleStageChange = useCallback(async (candidateId: string, newStage: string) => {
    const candidate = candidates.find(c => c.id === candidateId);
    if (!candidate) return;

    const oldStage = candidate.stage;
    const oldLastActivity = candidate.lastActivity;
    const nowIso = new Date().toISOString();

    // 1. Optimistic UI update
    // 🐛 BUG FIX (Opus audit) : avant, l'optimistic ne mettait à jour que `stage`,
    // pas `lastActivity`. Du coup la bordure rouge "stagnant" (calculée depuis
    // daysSince(lastActivity)) restait affichée pendant 30min (staleTime)
    // après qu'on a explicitement bougé le candidat. Signal visuel incohérent.
    queryClient.setQueryData<ATSCandidate[]>(['ats-candidates'], (old) =>
      old?.map(c => c.id === candidateId ? { ...c, stage: newStage, lastActivity: nowIso } : c) ?? []
    );

    try {
      // 🐛 BUG FIX Opus A3 (source of truth ambiguous) : avant, handleStageChange
      // ne persistait QUE pour source='local'. Les candidats de source sequence/inmail
      // voyaient leur stage revert au prochain refetch (car stage dérivé de status
      // sans écriture en DB). Fix : upsert dans job_candidate_status pour
      // sequence/inmail aussi → source de vérité unifiée.
      if (candidate.source === 'local') {
        const { error: updateError } = await supabase
          .from('job_candidate_status')
          .update({ pipeline_stage: newStage })
          .eq('id', candidate.sourceId);

        if (updateError) throw updateError;
      } else if (candidate.source === 'sequence' || candidate.source === 'inmail') {
        // Récup user + org pour la row upsert
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Non authentifié');

        // jobId peut être null pour inmail — on upsert quand même, la row
        // tient juste le stage manuel sans job associé (edge case).
        const upsertPayload: Record<string, unknown> = {
          candidate_id: candidate.candidateId,
          candidate_name: candidate.name,
          candidate_headline: candidate.headline,
          linkedin_profile_url: candidate.linkedin,
          pipeline_stage: newStage,
          status: 'messaged', // minimum pour passer le check NOT NULL
          created_by: user.id,
        };
        if (candidate.jobId) {
          upsertPayload.job_id = candidate.jobId;
        }

        const { error: upsertError } = await supabase
          .from('job_candidate_status')
          .upsert(upsertPayload, {
            onConflict: candidate.jobId
              ? 'job_id,candidate_id,created_by'
              : 'candidate_id,created_by',
            ignoreDuplicates: false,
          });

        if (upsertError) {
          console.warn('[handleStageChange] upsert failed for sequence/inmail, falling back:', upsertError);
          // Ne throw pas — on garde l'optimistic UI même si la persistence échoue
          // (le toast informera l'user). Alternative : throw pour revert.
        }
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

      // Toast avec action Undo (Opus audit idée #E)
      toast.success(`Candidat déplacé vers "${newStage}"`, {
        action: {
          label: 'Annuler',
          onClick: () => {
            // Re-run le change avec l'ancien stage (revert)
            void handleStageChange(candidateId, oldStage);
          },
        },
      });
    } catch (error) {
      console.error('Error updating stage:', error);
      toast.error('Erreur lors de la mise à jour');
      // Revert optimistic update — restaurer stage ET lastActivity
      queryClient.setQueryData<ATSCandidate[]>(['ats-candidates'], (old) =>
        old?.map(c => c.id === candidateId ? { ...c, stage: oldStage, lastActivity: oldLastActivity } : c) ?? []
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
