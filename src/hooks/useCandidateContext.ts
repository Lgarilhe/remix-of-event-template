/**
 * Aggregates ALL available context for a candidate + job pair.
 * Used by the AI scorecard chatbot for contextual conversations.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { getActiveOrganizationId } from '@/lib/orgContext';

export interface CandidateFullContext {
  // Candidate identity
  name: string;
  headline: string | null;
  linkedinUrl: string | null;

  // LinkedIn profile (enriched)
  linkedinProfile: {
    about?: string;
    skills?: Array<{ name: string }>;
    positions?: Array<{ title: string; company: string; description?: string; startDate?: string; endDate?: string }>;
    education?: Array<{ school: string; degree?: string; field?: string }>;
    languages?: string[];
    location?: string;
  } | null;

  // AI scoring
  score: number | null;
  recommendation: string | null;
  scoringDetails: {
    match_score?: number;
    matching_skills?: string[];
    missing_skills?: string[];
    summary?: string;
    strengths?: string[];
    gaps?: string[];
  } | null;

  // Notes from recruiters
  notes: string[];

  // Call transcripts
  callTranscripts: Array<{
    transcript: string;
    report: any;
    duration_seconds: number;
    created_at: string;
  }>;

  // Previous evaluations
  previousEvaluations: Array<{
    job_title: string | null;
    interview_stage: string | null;
    overall_score: number | null;
    recommendation: string | null;
    summary: string | null;
    created_at: string;
  }>;

  // RAG knowledge chunks
  knowledgeChunks: Array<{
    chunk_type: string;
    content: string;
  }>;

  // Job context
  jobTitle: string | null;
  jobDescription: string | null;
  jobSkills: string[];
  jobClient: string | null;
}

export const useCandidateContext = (candidateId: string | undefined, jobId: string | undefined) => {
  return useQuery({
    queryKey: ['candidate-full-context', candidateId, jobId],
    queryFn: async (): Promise<CandidateFullContext> => {
      if (!candidateId) throw new Error('No candidate');
      const orgId = await getActiveOrganizationId();

      // Fetch everything in parallel
      const [
        candidateResult,
        notesResult,
        callsResult,
        evalsResult,
        knowledgeResult,
        jobResult,
      ] = await Promise.all([
        // 1. Candidate + LinkedIn + scoring
        supabase
          .from('job_candidate_status')
          .select('candidate_name, candidate_headline, linkedin_profile_url, linkedin_profile_data, score, recommendation, scoring_details')
          .eq('candidate_id', candidateId)
          .order('updated_at', { ascending: false })
          .limit(1),

        // 2. Notes
        supabase
          .from('candidate_notes')
          .select('content')
          .eq('candidate_id', candidateId)
          .order('created_at', { ascending: false })
          .limit(10),

        // 3. Call transcripts
        supabase
          .from('call_coaching_sessions')
          .select('transcript, report, duration_seconds, created_at')
          .eq('candidate_id', candidateId)
          .order('created_at', { ascending: false })
          .limit(3),

        // 4. Previous evaluations
        supabase
          .from('candidate_evaluations')
          .select('job_title, interview_stage, overall_score, recommendation, summary, created_at')
          .eq('candidate_id', candidateId)
          .order('created_at', { ascending: false })
          .limit(5),

        // 5. RAG knowledge chunks
        orgId ? supabase
          .from('knowledge_chunks')
          .select('chunk_type, content')
          .eq('entity_id', candidateId)
          .eq('organization_id', orgId)
          .order('created_at', { ascending: false })
          .limit(20) : Promise.resolve({ data: null }),

        // 6. Job context
        jobId ? supabase
          .from('sourcing_projects')
          .select('name, job_title, client_name, description, job_details')
          .eq('id', jobId)
          .maybeSingle() : Promise.resolve({ data: null }),
      ]);

      const candidate = candidateResult.data?.[0] as any;
      const linkedinData = candidate?.linkedin_profile_data;
      const jobData = jobResult.data as any;
      const jd = jobData?.job_details || {};

      return {
        name: candidate?.candidate_name || 'Candidat',
        headline: candidate?.candidate_headline || null,
        linkedinUrl: candidate?.linkedin_profile_url || null,

        linkedinProfile: linkedinData ? {
          about: linkedinData.about || linkedinData.summary,
          skills: linkedinData.skills || [],
          positions: (linkedinData.positions || linkedinData.experiences || []).slice(0, 5),
          education: (linkedinData.education || []).slice(0, 3),
          languages: linkedinData.languages || [],
          location: linkedinData.location || linkedinData.city,
        } : null,

        score: candidate?.score ?? null,
        recommendation: candidate?.recommendation ?? null,
        scoringDetails: candidate?.scoring_details || null,

        notes: (notesResult.data || []).map((n: any) => n.content),

        callTranscripts: (callsResult.data || []).map((c: any) => ({
          transcript: c.transcript || '',
          report: c.report,
          duration_seconds: c.duration_seconds || 0,
          created_at: c.created_at,
        })),

        previousEvaluations: (evalsResult.data || []).map((e: any) => ({
          job_title: e.job_title,
          interview_stage: e.interview_stage,
          overall_score: e.overall_score,
          recommendation: e.recommendation,
          summary: e.summary,
          created_at: e.created_at,
        })),

        knowledgeChunks: (knowledgeResult.data || []).map((k: any) => ({
          chunk_type: k.chunk_type,
          content: k.content,
        })),

        jobTitle: jd.title || jobData?.job_title || jobData?.name || null,
        jobDescription: jd.mission_description || jd.context || jobData?.description || null,
        jobSkills: [...(jd.skills_must_have || []), ...(jd.skills_should_have || [])],
        jobClient: jd.client?.name || jobData?.client_name || null,
      };
    },
    enabled: !!candidateId,
    staleTime: 5 * 60 * 1000,
  });
};

/** Build a text summary of the candidate context for the AI prompt */
export function buildContextPrompt(ctx: CandidateFullContext): string {
  const parts: string[] = [];

  parts.push(`## Candidat: ${ctx.name}`);
  if (ctx.headline) parts.push(`Headline: ${ctx.headline}`);
  if (ctx.score != null) parts.push(`Score IA: ${ctx.score}/100 — Recommandation: ${ctx.recommendation || 'N/A'}`);

  if (ctx.linkedinProfile) {
    const lp = ctx.linkedinProfile;
    if (lp.about) parts.push(`\n### À propos\n${lp.about.slice(0, 500)}`);
    if (lp.skills?.length) parts.push(`\n### Compétences\n${lp.skills.slice(0, 15).map(s => s.name || s).join(', ')}`);
    if (lp.positions?.length) {
      parts.push(`\n### Expériences récentes`);
      lp.positions.slice(0, 3).forEach(p => {
        parts.push(`- ${p.title} chez ${p.company}${p.description ? ` — ${p.description.slice(0, 150)}` : ''}`);
      });
    }
  }

  if (ctx.scoringDetails) {
    const sd = ctx.scoringDetails;
    if (sd.matching_skills?.length) parts.push(`\n### Skills correspondants: ${sd.matching_skills.join(', ')}`);
    if (sd.missing_skills?.length) parts.push(`### Skills manquants: ${sd.missing_skills.join(', ')}`);
    if (sd.summary) parts.push(`### Analyse IA: ${sd.summary}`);
  }

  if (ctx.notes.length > 0) {
    parts.push(`\n### Notes des recruteurs`);
    ctx.notes.slice(0, 3).forEach(n => parts.push(`- ${n.slice(0, 200)}`));
  }

  if (ctx.callTranscripts.length > 0) {
    parts.push(`\n### Appels précédents (${ctx.callTranscripts.length})`);
    ctx.callTranscripts.slice(0, 1).forEach(c => {
      if (c.report?.summary) parts.push(`Résumé: ${c.report.summary}`);
      if (c.report?.recommendation) parts.push(`Recommandation: ${c.report.recommendation}`);
    });
  }

  if (ctx.previousEvaluations.length > 0) {
    parts.push(`\n### Évaluations précédentes`);
    ctx.previousEvaluations.slice(0, 3).forEach(e => {
      parts.push(`- ${e.job_title || 'Poste'} (${e.interview_stage || '?'}): ${e.overall_score}/5 — ${e.recommendation || 'N/A'}`);
    });
  }

  if (ctx.knowledgeChunks.length > 0) {
    const relevantChunks = ctx.knowledgeChunks
      .filter(k => ['experience', 'post', 'notes'].includes(k.chunk_type))
      .slice(0, 5);
    if (relevantChunks.length > 0) {
      parts.push(`\n### Informations supplémentaires (RAG)`);
      relevantChunks.forEach(k => parts.push(`[${k.chunk_type}] ${k.content.slice(0, 200)}`));
    }
  }

  parts.push(`\n## Poste: ${ctx.jobTitle || 'Non défini'}`);
  if (ctx.jobClient) parts.push(`Client: ${ctx.jobClient}`);
  if (ctx.jobDescription) parts.push(`Description: ${ctx.jobDescription.slice(0, 300)}`);
  if (ctx.jobSkills.length > 0) parts.push(`Skills requis: ${ctx.jobSkills.join(', ')}`);

  return parts.join('\n');
}
