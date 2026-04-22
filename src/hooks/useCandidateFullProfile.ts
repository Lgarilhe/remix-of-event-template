import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface CandidateActivity {
  type: 'scored' | 'messaged' | 'sequence_enrolled' | 'sequence_step' | 'inmail_sent' | 'qualification_scheduled' | 'qualification_verdict' | 'stage_change' | 'note_added' | 'appointment' | 'shortlist_added' | 'aircall_call';
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

export interface ScoringDimension {
  score: number;
  weight: number;
  details: string;
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
    concerns?: string[];
    dimensions?: Record<string, ScoringDimension>;
    llmScore?: number;
    hardFilterPassed?: boolean;
    hardFilterKO?: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface SequenceStepDetail {
  id: string;
  actionType: string;
  stepOrder: number;
  status: string;
  executedAt: string | null;
  finalSubject: string | null;
  sequenceName: string | null;
}

export interface AirtableAppointment {
  id: string;
  title: string | null;
  appointmentDate: string | null;
  appointmentType: string | null;
  status: string | null;
  notes: string | null;
}

export interface CandidateFullProfile {
  qualificationSessions: QualificationSession[];
  sequenceEnrollments: SequenceEnrollmentInfo[];
  sequenceSteps: SequenceStepDetail[];
  inmailsSent: { id: string; subject: string; status: string; sentAt: string | null; createdAt: string }[];
  scoringHistory: ScoringRecord[];
  accountId: string | null;
  airtableMatch: { fullName: string; status: string; experience: string; skills: string[]; educationLevel: string } | null;
  airtableShortlists: { id: string; status: string; dateAdded: string; jobTitle?: string; companyName?: string }[];
  airtableNotes: { id: string; title: string; detail: string; noteDate: string; author: string }[];
  airtableAppointments: AirtableAppointment[];
  aircallCalls: { id: string; direction: string; status: string; startedAt: string | null; duration: number; userName: string | null; notes: string | null; tags: string[] }[];
  timeline: CandidateActivity[];
  loading: boolean;
}

export function useCandidateFullProfile(candidateId: string, linkedinUrl: string | null): CandidateFullProfile {
  const [qualificationSessions, setQualificationSessions] = useState<QualificationSession[]>([]);
  const [sequenceEnrollments, setSequenceEnrollments] = useState<SequenceEnrollmentInfo[]>([]);
  const [sequenceSteps, setSequenceSteps] = useState<SequenceStepDetail[]>([]);
  const [inmailsSent, setInmailsSent] = useState<any[]>([]);
  const [scoringHistory, setScoringHistory] = useState<ScoringRecord[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  // 🐛 BUG FIX Opus A2 (race accountId) : fetchSequences et fetchInmails
  // tournent en parallèle via Promise.all. Le check `if (!accountId)` dans
  // fetchInmails lit le state React qui n'a PAS encore re-rendu → les deux
  // peuvent set en même temps, l'un écrase l'autre non-déterministiquement.
  // Fix : ref synchronement updatable, check+set sur la ref, state juste
  // pour déclencher re-render.
  const accountIdRef = useRef<string | null>(null);
  const [airtableMatch, setAirtableMatch] = useState<any>(null);
  const [airtableShortlists, setAirtableShortlists] = useState<any[]>([]);
  const [airtableNotes, setAirtableNotes] = useState<any[]>([]);
  const [airtableAppointments, setAirtableAppointments] = useState<AirtableAppointment[]>([]);
  const [aircallCalls, setAircallCalls] = useState<any[]>([]);
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
          linkedinUrl ? fetchAircallCalls(linkedinUrl) : Promise.resolve(),
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
        // fetchSequences = source prioritaire de account_id (plus fiable que inmails)
        const newAccountId = data[0].account_id || null;
        if (newAccountId && accountIdRef.current !== newAccountId) {
          accountIdRef.current = newAccountId;
          setAccountId(newAccountId);
        }

        // Fetch detailed step executions
        const enrollmentIds = data.map((e: any) => e.id);
        const { data: executions } = await supabase
          .from('sequence_step_executions')
          .select('id, enrollment_id, step_id, step_order, status, executed_at, final_subject')
          .in('enrollment_id', enrollmentIds)
          .order('executed_at', { ascending: false });

        if (executions && executions.length > 0) {
          const stepIds = [...new Set(executions.map((e: any) => e.step_id))];
          const { data: steps } = await supabase
            .from('sequence_steps')
            .select('id, action_type')
            .in('id', stepIds);
          const stepMap = new Map((steps || []).map((s: any) => [s.id, s.action_type]));
          const enrollmentSeqMap = new Map(data.map((e: any) => [e.id, e.outreach_sequences?.name || 'Séquence']));

          setSequenceSteps(executions.filter((ex: any) => ex.executed_at).map((ex: any) => ({
            id: ex.id,
            actionType: stepMap.get(ex.step_id) || 'unknown',
            stepOrder: ex.step_order,
            status: ex.status,
            executedAt: ex.executed_at,
            finalSubject: ex.final_subject,
            sequenceName: enrollmentSeqMap.get(ex.enrollment_id) || null,
          })));
        }
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
      
      // Fallback : utilise account_id depuis inmails UNIQUEMENT si les séquences
      // n'en ont pas fourni (check sur la ref, pas le state — fix race condition)
      if (data && data.length > 0 && !accountIdRef.current) {
        const fallbackAccountId = data[0].account_id || null;
        if (fallbackAccountId) {
          accountIdRef.current = fallbackAccountId;
          setAccountId(fallbackAccountId);
        }
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
      const [{ data }, { data: matchScoresData }] = await Promise.all([
        supabase
          .from('job_candidate_status')
          .select('*')
          .eq('candidate_id', profileId)
          .order('updated_at', { ascending: false }),
        supabase
          .from('match_scores')
          .select('candidate_id, job_id, score, scoring_result')
          .eq('candidate_id', profileId)
          .order('created_at', { ascending: false }),
      ]);
      
      if (!data || data.length === 0) {
        setScoringHistory([]);
        return;
      }

      // Build a map from match_scores for richer data
      const matchScoresMap = new Map<string, any>();
      if (matchScoresData) {
        matchScoresData.forEach((ms: any) => {
          const key = `${ms.candidate_id}|${ms.job_id}`;
          if (!matchScoresMap.has(key) && ms.scoring_result) {
            matchScoresMap.set(key, ms.scoring_result);
          }
        });
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

      setScoringHistory(data.map((r: any) => {
        // Merge scoring_details from job_candidate_status with richer match_scores data
        const matchResult = matchScoresMap.get(`${r.candidate_id}|${r.job_id}`);
        const baseDetails = r.scoring_details || {};
        const mergedDetails = {
          ...baseDetails,
          // Enrich with match_scores data if available
          ...(matchResult ? {
            dimensions: matchResult.dimensions || baseDetails.dimensions,
            strengths: matchResult.strengths || baseDetails.strengths,
            concerns: matchResult.concerns || baseDetails.concerns,
            llmScore: matchResult.llmScore ?? baseDetails.llmScore,
            hardFilterPassed: matchResult.hardFilterPassed ?? baseDetails.hardFilterPassed,
            hardFilterKO: matchResult.hardFilterKO || baseDetails.hardFilterKO,
            summary: matchResult.summary || baseDetails.summary,
          } : {}),
        };

        return {
          id: r.id,
          jobId: r.job_id,
          jobTitle: jobTitleMap.get(r.job_id) || null,
          score: r.score,
          recommendation: r.recommendation,
          status: r.status,
          pipelineStage: r.pipeline_stage,
          scoringDetails: Object.keys(mergedDetails).length > 0 ? mergedDetails : null,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        };
      }));
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

        // Fetch airtable appointments
        const { data: appointments } = await supabase
          .from('airtable_appointments')
          .select('*')
          .eq('candidate_airtable_id', c.airtable_id)
          .order('appointment_date', { ascending: false });

        setAirtableAppointments((appointments || []).map((a: any) => ({
          id: a.id,
          title: a.title,
          appointmentDate: a.appointment_date,
          appointmentType: a.appointment_type,
          status: a.status,
          notes: a.notes,
        })));
      }
    }

    async function fetchAircallCalls(url: string) {
      // First try to find matched calls via airtable candidate
      const slug = extractSlug(url);
      const { data: candidates } = await supabase
        .from('airtable_candidates')
        .select('airtable_id')
        .ilike('linkedin_url', `%${slug}%`)
        .limit(1);

      if (candidates && candidates.length > 0) {
        const { data: calls } = await supabase
          .from('aircall_calls')
          .select('*')
          .eq('matched_airtable_candidate_id', candidates[0].airtable_id)
          .order('started_at', { ascending: false })
          .limit(50);

        setAircallCalls((calls || []).map((c: any) => ({
          id: c.id,
          direction: c.direction,
          status: c.status,
          startedAt: c.started_at,
          duration: c.duration || 0,
          userName: c.user_name,
          notes: c.notes,
          tags: c.tags || [],
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

  // Detailed sequence steps
  sequenceSteps.forEach(step => {
    const actionLabels: Record<string, string> = {
      send_connection: '🔗 Invitation envoyée',
      send_message: '💬 Message envoyé',
      send_inmail: '📧 InMail envoyé',
      visit_profile: '👀 Visite de profil',
      check_connection: '🔍 Vérification connexion',
    };
    timeline.push({
      type: 'sequence_step',
      date: step.executedAt || '',
      title: actionLabels[step.actionType] || `Action : ${step.actionType}`,
      detail: step.sequenceName ? `${step.sequenceName} • Étape ${step.stepOrder}` : `Étape ${step.stepOrder}`,
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
        title: `Scoring : ${sr.score}% ${sr.jobTitle ? `• ${sr.jobTitle}` : ''}`,
        detail: sr.scoringDetails?.recommendation || sr.recommendation || undefined,
      });
    }
  });

  // Airtable shortlists in timeline
  airtableShortlists.forEach(s => {
    timeline.push({
      type: 'shortlist_added',
      date: s.dateAdded || '',
      title: `Shortlist : ${s.jobTitle || s.companyName || 'Poste'}`,
      detail: s.status || undefined,
    });
  });

  // 🐛 BUG FIX (Opus audit) : airtableNotes étaient fetchées via fetchAirtableHistory
  // mais jamais intégrées au timeline → notes invisibles pour l'user dans l'onglet
  // Activité (alors qu'elles apparaissent dans l'onglet Notes). Fix : les ajouter.
  airtableNotes.forEach(n => {
    timeline.push({
      type: 'note_added',
      date: n.noteDate || '',
      title: n.title ? `📝 ${n.title}` : '📝 Note',
      detail: n.detail || undefined,
      meta: { author: n.author, source: 'airtable' },
    });
  });

  // Airtable appointments in timeline
  airtableAppointments.forEach(a => {
    timeline.push({
      type: 'appointment',
      date: a.appointmentDate || '',
      title: a.title || `RDV ${a.appointmentType || ''}`,
      detail: a.status || undefined,
    });
  });

  // Aircall calls in timeline
  aircallCalls.forEach(c => {
    const dirLabel = c.direction === 'inbound' ? '📞 Appel reçu' : '📞 Appel émis';
    const statusLabel = c.status === 'missed' || c.status === 'no-answer' ? ' (manqué)' : '';
    const durationLabel = c.duration > 0 ? ` • ${Math.floor(c.duration / 60)}min${c.duration % 60 > 0 ? ` ${c.duration % 60}s` : ''}` : '';
    timeline.push({
      type: 'aircall_call',
      date: c.startedAt || '',
      title: `${dirLabel}${statusLabel}${durationLabel}`,
      detail: [c.userName, c.notes].filter(Boolean).join(' — ') || undefined,
    });
  });

  timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return {
    qualificationSessions,
    sequenceEnrollments,
    sequenceSteps,
    inmailsSent,
    scoringHistory,
    accountId,
    airtableMatch,
    airtableShortlists,
    airtableNotes,
    airtableAppointments,
    aircallCalls,
    timeline,
    loading,
  };
}

function extractSlug(url: string): string {
  const match = url.match(/\/in\/([^/?]+)/);
  return match ? match[1] : url;
}
