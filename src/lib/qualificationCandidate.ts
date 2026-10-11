import type { ATSCandidate } from '@/hooks/useATSData';
import type { Tables } from '@/integrations/supabase/types';

export const QUALIFICATION_CANDIDATE_FIELDS = 'id, candidate_profile_id, project_id, manager_id, created_by, candidate_name, candidate_headline, candidate_linkedin_url, invitee_email, job_title, created_at, updated_at';

type InterviewCandidate = Pick<Tables<'qualification_sessions'>,
  'id' | 'candidate_profile_id' | 'project_id' | 'candidate_name' | 'candidate_headline' |
  'candidate_linkedin_url' | 'invitee_email' | 'job_title' | 'created_at' | 'updated_at'>;

/** Identité d'un entretien vérifié, sans inventer de ligne ni de mission au pipeline. */
export function candidateFromUnassignedInterview(event: InterviewCandidate, identity?: ATSCandidate): ATSCandidate | null {
  if (event.project_id || !event.candidate_profile_id) return null;
  const samePerson = identity?.candidateId === event.candidate_profile_id ? identity : undefined;
  return {
    id: `qualification:${event.id}`,
    candidateId: event.candidate_profile_id,
    name: event.candidate_name || samePerson?.name || 'Candidat',
    headline: event.candidate_headline || samePerson?.headline || null,
    email: event.invitee_email || samePerson?.email || null,
    phone: samePerson?.phone || null,
    linkedin: event.candidate_linkedin_url || samePerson?.linkedin || null,
    pictureUrl: samePerson?.pictureUrl || null,
    linkedinProfileData: samePerson?.linkedinProfileData ?? null,
    expertise: [], entity: null, source: 'local', sourceId: event.id,
    stage: 'Nouveau', generalStage: null, processStepId: null,
    projectId: null, jobId: null, jobTitle: event.job_title,
    createdAt: event.created_at, lastActivity: event.updated_at,
    tags: [], score: null, recommendation: null, scoringDetails: null,
  };
}
