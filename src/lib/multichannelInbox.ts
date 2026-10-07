import type { LinkedInProfile } from '@/components/outreach/types';
import type { CandidateActionMessageRecord } from '@/lib/candidateActions';
import { normalizeCandidateProfile } from '@/lib/candidateProfile';
import { threadState, type ThreadState } from '@/lib/inboxThreadState';

export interface MultichannelConversation {
  key: string;
  candidateId: string;
  projectId: string | null;
  accountId: string;
  ownerUserId: string;
  candidateName: string;
  linkedinUrl: string | null;
  projectName: string | null;
  ambiguousMission: boolean;
  availableProjects: Array<{ id: string; name: string }>;
  profile: LinkedInProfile;
  messages: CandidateActionMessageRecord[];
  latest: CandidateActionMessageRecord;
  state: ThreadState;
}
export interface MultichannelCandidateLabel { candidate_id: string; candidate_name: string | null; linkedin_profile_url: string | null; linkedin_profile_data: unknown; project_id: string | null; job_id: string }
export interface MultichannelProjectLabel { id: string; name: string; job_title: string | null; job_id: string | null }

/** Une boîte personnelle, un candidat canonique et une mission exacte forment une entrée. */
export function groupMultichannelConversations(messages: CandidateActionMessageRecord[], candidates: MultichannelCandidateLabel[], projects: MultichannelProjectLabel[], now = new Date()): MultichannelConversation[] {
  const groups = new Map<string, CandidateActionMessageRecord[]>();
  const seen = new Set<string>();
  for (const row of messages) {
    if (row.audience !== 'candidate' || row.channel === 'linkedin') continue;
    const providerKey = JSON.stringify([row.organization_id, row.account_id, row.provider_message_id]);
    if (seen.has(providerKey)) continue;
    seen.add(providerKey);
    const key = JSON.stringify([row.organization_id, row.candidate_id, row.project_id, row.owner_user_id, row.account_id]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups].map(([key, rows]) => {
    rows.sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
    const latest = rows[rows.length - 1];
    const project = projects.find(item => item.id === latest.project_id);
    const matches = candidates.filter(item => item.candidate_id === latest.candidate_id);
    const matchingProject = latest.project_id ? matches.filter(item => item.project_id === latest.project_id || item.job_id === latest.project_id || (project?.job_id && item.job_id === project.job_id)) : matches;
    const names = [...new Set(matchingProject.map(item => item.candidate_name).filter((name): name is string => !!name))];
    const urls = [...new Set(matchingProject.map(item => item.linkedin_profile_url).filter((url): url is string => !!url))];
    const name = names.length === 1 ? names[0] : latest.counterpart || 'Candidat';
    const candidate = matchingProject.find(item => item.linkedin_profile_data);
    const availableProjects = projects.filter(item => matches.some(match => match.project_id === item.id || match.job_id === item.id || (item.job_id && match.job_id === item.job_id))).map(item => ({ id: item.id, name: item.job_title || item.name }));
    const ambiguousMission = !latest.project_id && new Set(matches.map(item => item.project_id || item.job_id)).size > 1;
    return { key, candidateId: latest.candidate_id, projectId: latest.project_id, accountId: latest.account_id, ownerUserId: latest.owner_user_id, candidateName: name, linkedinUrl: urls.length === 1 ? urls[0] : null, projectName: project?.job_title || project?.name || null, ambiguousMission, availableProjects, profile: normalizeCandidateProfile(candidate?.linkedin_profile_data ?? {}, latest.candidate_id, name), messages: rows, latest, state: threadState({ lastIsMine: latest.direction === 'outbound', lastAt: latest.occurred_at, sequenceActive: false }, now) };
  }).sort((a, b) => Date.parse(b.latest.occurred_at) - Date.parse(a.latest.occurred_at));
}
