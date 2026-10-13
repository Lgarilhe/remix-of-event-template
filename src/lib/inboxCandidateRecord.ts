import type { ATSCandidate } from '@/hooks/useATSData';
import type { CandidateProfileIdentity } from '@/hooks/useInboxCandidateProfile';
import { candidateLinkedInSlug } from '@/lib/candidateProfile';

export interface InboxCandidateRecordInput extends CandidateProfileIdentity {
  candidateId?: string | null;
  projectId?: string | null;
  chatId: string;
  name?: string;
  headline?: string | null;
  photo?: string | null;
}

export interface InboxCandidateRecord {
  candidates: ATSCandidate[];
  pipelineAttached: boolean;
  requiresChoice: boolean;
}

export function inboxCandidateIdentityIds(input: InboxCandidateRecordInput): string[] {
  return [...new Set([input.candidateId, input.profileId, ...(input.aliases ?? [])]
    .filter((id): id is string => typeof id === 'string' && !!id.trim()).map(id => id.trim()))];
}

/** Identité de la conversation uniquement : aucune candidature ni mission n'est créée. */
export function buildTransientInboxCandidate(input: InboxCandidateRecordInput): ATSCandidate {
  const candidateId = inboxCandidateIdentityIds(input)[0] || candidateLinkedInSlug(input.profileUrl) || `inbox:${input.chatId}`;
  return {
    id: `inbox:${input.chatId}`,
    candidateId,
    name: input.name || input.profileName || 'Candidat',
    headline: input.headline || null,
    pictureUrl: input.photo || null,
    linkedin: candidateLinkedInSlug(input.profileUrl) ? input.profileUrl! : null,
    email: null, phone: null, expertise: [], entity: null,
    source: 'local', sourceId: input.chatId,
    stage: 'Nouveau', generalStage: null, processStepId: null,
    projectId: null, jobId: null, jobTitle: null,
    createdAt: '', lastActivity: null,
    tags: [], score: null, recommendation: null, scoringDetails: null,
    linkedinProfileData: null,
  };
}

/** Une mission confirmée peut sélectionner sa ligne ; aucune autre ligne n'est choisie implicitement. */
export function selectInboxCandidateRecords(candidates: ATSCandidate[], input: InboxCandidateRecordInput): InboxCandidateRecord {
  const unique = [...new Map(candidates.map(candidate => [candidate.id, candidate])).values()];
  if (!unique.length) return { candidates: [buildTransientInboxCandidate(input)], pipelineAttached: false, requiresChoice: false };
  const matchingProject = input.projectId ? unique.filter(candidate => candidate.projectId === input.projectId) : [];
  const options = matchingProject.length ? matchingProject : unique;
  return {
    candidates: options,
    pipelineAttached: true,
    requiresChoice: options.length > 1 || (!!input.projectId && !matchingProject.length),
  };
}
