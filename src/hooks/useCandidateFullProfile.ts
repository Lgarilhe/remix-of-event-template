import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface CandidateActivity {
  type: 'scored' | 'messaged' | 'sequence_enrolled' | 'sequence_step' | 'inmail_sent' | 'qualification_scheduled' | 'qualification_verdict' | 'stage_change' | 'note_added';
  date: string;
  title: string;
  detail?: string;
  meta?: Record<string, any>;
}

export interface QualificationSession {
  id: string;
  status: string;
  verdict: string | null;
  verdictNotes: string | null;
  eventStartAt: string | null;
  candidateName: string | null;
  jobTitle: string | null;
  notes: string | null;
  scoringSummary: any;
}

export interface SequenceEnrollmentInfo {
  id: string;
  sequenceName: string;
  status: string;
  currentStep: number;
  createdAt: string;
  repliedAt: string | null;
  completedAt: string | null;
  connectionStatus: string | null;
}

export interface ScoringRecord {
  id: string;
  jobId: string;
  jobTitle: string | null;
  score: number | null;
  recommendation: string | null;
  status: string;
  pipelineStage: string | null;
  scoringDetails: {
    match_score?: number;
    matching_skills?: string[];
    missing_skills?: string[];
    experience_match?: string;
    location_match?: boolean;
    summary?: string;
    recommendation?: string;
    salary_analysis?: any;
    strengths?: string[];
    weaknesses?: string[];
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface CandidateFullProfile {
  qualificationSessions: QualificationSession[];
  sequenceEnrollments: SequenceEnrollmentInfo[];
  inmailsSent: { id: string; subject: string; status: string; sentAt: string | null; createdAt: string }[];
  scoringHistory: ScoringRecord[];
  accountId: string | null;
  airtableMatch: { fullName: string; status: string; experience: string; skills: string[]; educationLevel: string } | null;
  airtableShortlists: { id: string; status: string; dateAdded: string; jobTitle?: string; companyName?: string }[];
  airtableNotes: { id: string; title: string; detail: string; noteDate: string; author: string }[];
  timeline: CandidateActivity[];
  loading: boolean;
}

export function useCandidateFullProfile(candidateId: string, linkedinUrl: string | null): CandidateFullProfile {
  const [qualificationSessions, setQualificationSessions] = useState<QualificationSession[]>([]);
  const [sequenceEnrollments, setSequenceEnrollments] = useState<SequenceEnrollmentInfo[]>([]);
  const [inmailsSent, setInmailsSent] = useState<any[]>([]);
  const [scoringHistory, setScoringHistory] = useState<ScoringRecord[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [airtableMatch, setAirtableMatch] = useState<any>(null);
  const [airtableShortlists, setAirtableShortlists] = useState<any[]>([]);
  const [airtableNotes, setAirtableNotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        await Promise.all([
          fetchQualifications(candidateId),
          fetchSequences(candidateId),
          fetchInmails(candidateId),
          fetchScoringHistory(candidateId),
          linkedinUrl ? fetchAirtableHistory(linkedinUrl) : Promise.resolve(),
        ]);
      } finally {
        setLoading(false);
      }
    };

    async function fetchQualifications(profileId: string) {
      const { data } = await supabase
        .from('qualification_sessions')
        .select('*')
        .eq('candidate_profile_id', profileId)
        .order('created_at', { ascending: false });
      
      setQualificationSessions((data || []).map((s: any) => ({
        id: s.id,
        status: s.status,
        verdict: s.verdict,
        verdictNotes: s.verdict_notes,
        eventStartAt: s.event_start_at,
        candidateName: s.candidate_name,
        jobTitle: s.job_title,
        notes: s.notes,
        scoringSummary: s.scoring_summary,
      })));
    }

    async function fetchSequences(profileId: string) {
      const { data } = await supabase
        .from('sequence_enrollments')
        .select('*, outreach_sequences (name)')
        .eq('profile_id', profileId)
        .order('created_at', { ascending: false });
      
      if (data && data.length > 0) {
        // Extract account_id from first enrollment for profile enrichment
        setAccountId(data[0].account_id || null);
      }

      setSequenceEnrollments((data || []).map((e: any) => ({
        id: e.id,
        sequenceName: e.outreach_sequences?.name || 'Séquence',
        status: e.status,
        currentStep: e.current_step_order,
        createdAt: e.created_at,
        repliedAt: e.replied_at,
        completedAt: e.completed_at,
        connectionStatus: e.connection_status,
      })));
    }

    async function fetchInmails(profileId: string) {
      const { data } = await supabase
        .from('inmail_queue')
        .select('*')
        .eq('recipient_profile_id', profileId)
        .order('created_at', { ascending: false });
      
      if (data && data.length > 0 && !accountId) {
        setAccountId(data[0].account_id || null);
      }

      setInmailsSent((data || []).map((i: any) => ({
        id: i.id,
        subject: i.subject,
        status: i.status,
        sentAt: i.sent_at,
        createdAt: i.created_at,
      })));
    }

    async function fetchScoringHistory(profileId: string) {
      const { data } = await supabase
        .from('job_candidate_status')
        .select('*')
        .eq('candidate_id', profileId)
        .order('updated_at', { ascending: false });
      
      if (!data || data.length === 0) {
        setScoringHistory([]);
        return;
      }

      // Fetch job titles from search_history for all unique job_ids
      const uniqueJobIds = [...new Set(data.map((r: any) => r.job_id).filter(Boolean))];
      const jobTitleMap = new Map<string, string>();

      if (uniqueJobIds.length > 0) {
        const { data: searches } = await supabase
          .from('search_history')
          .select('job_id, job_title')
          .in('job_id', uniqueJobIds);
        
        if (searches) {
          searches.forEach((s: any) => {
            if (s.job_title && !jobTitleMap.has(s.job_id)) {
              jobTitleMap.set(s.job_id, s.job_title);
            }
          });
        }
      }

      setScoringHistory(data.map((r: any) => ({
        id: r.id,
        jobId: r.job_id,
        jobTitle: jobTitleMap.get(r.job_id) || null,
        score: r.score,
        recommendation: r.recommendation,
        status: r.status,
        pipelineStage: r.pipeline_stage,
        scoringDetails: r.scoring_details,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })));
    }

    async function fetchAirtableHistory(url: string) {
      const { data: candidates } = await supabase
        .from('airtable_candidates')
        .select('*')
        .ilike('linkedin_url', `%${extractSlug(url)}%`)
        .limit(1);
      
      if (candidates && candidates.length > 0) {
        const c = candidates[0];
        setAirtableMatch({
          fullName: c.full_name,
          status: c.status,
          experience: c.experience,
          skills: c.skills || [],
          educationLevel: c.education_level,
        });

        const { data: shortlists } = await supabase
          .from('airtable_shortlists')
          .select('*, airtable_jobs(title), airtable_companies(name)')
          .eq('candidate_airtable_id', c.airtable_id)
          .order('date_added', { ascending: false });
        
        setAirtableShortlists((shortlists || []).map((s: any) => ({
          id: s.id,
          status: s.status,
          dateAdded: s.date_added,
          jobTitle: s.airtable_jobs?.title,
          companyName: s.airtable_companies?.name,
        })));

        const { data: notes } = await supabase
          .from('airtable_notes')
          .select('*')
          .eq('candidate_airtable_id', c.airtable_id)
          .order('note_date', { ascending: false });
        
        setAirtableNotes((notes || []).map((n: any) => ({
          id: n.id,
          title: n.title || '',
          detail: n.detail || '',
          noteDate: n.note_date || n.created_at,
          author: n.author || '',
        })));
      }
    }

    fetchAll();
  }, [candidateId, linkedinUrl]);

  // Build unified timeline
  const timeline: CandidateActivity[] = [];

  qualificationSessions.forEach(qs => {
    if (qs.eventStartAt) {
      timeline.push({
        type: 'qualification_scheduled',
        date: qs.eventStartAt,
        title: `Entretien planifié`,
        detail: qs.jobTitle ? `Pour ${qs.jobTitle}` : undefined,
        meta: { sessionId: qs.id },
      });
    }
    if (qs.verdict && qs.verdict !== 'pending') {
      timeline.push({
        type: 'qualification_verdict',
        date: qs.eventStartAt || '',
        title: `Verdict : ${qs.verdict === 'go' ? '✅ Go' : qs.verdict === 'no_go' ? '❌ No-Go' : '🤔 Maybe'}`,
        detail: qs.verdictNotes || undefined,
      });
    }
  });

  sequenceEnrollments.forEach(se => {
    timeline.push({
      type: 'sequence_enrolled',
      date: se.createdAt,
      title: `Inscrit à "${se.sequenceName}"`,
      detail: se.status === 'completed' ? 'Séquence terminée' : se.repliedAt ? 'A répondu' : `Étape ${se.currentStep}`,
    });
  });

  inmailsSent.forEach(im => {
    timeline.push({
      type: 'inmail_sent',
      date: im.sentAt || im.createdAt,
      title: `InMail : ${im.subject}`,
      detail: im.status === 'sent' ? 'Envoyé' : im.status === 'replied' ? 'Répondu' : im.status,
    });
  });

  scoringHistory.forEach(sr => {
    if (sr.score != null) {
      timeline.push({
        type: 'scored',
        date: sr.updatedAt,
        title: `Scoring : ${sr.score}%`,
        detail: sr.scoringDetails?.recommendation || sr.recommendation || undefined,
      });
    }
  });

  timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return {
    qualificationSessions,
    sequenceEnrollments,
    inmailsSent,
    scoringHistory,
    accountId,
    airtableMatch,
    airtableShortlists,
    airtableNotes,
    timeline,
    loading,
  };
}

function extractSlug(url: string): string {
  const match = url.match(/\/in\/([^/?]+)/);
  return match ? match[1] : url;
}
