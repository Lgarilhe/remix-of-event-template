// Mission association uses verified identity aliases and actual projects, never the currently opened view.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.75.1';
type ActionClient = SupabaseClient;
type Row = Record<string, unknown>;
const str = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

const projectUuid = (value: unknown): string => {
  const id = str(value).replace(/^project:/, '');
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : '';
};

export async function resolveCandidateActionMessageScope(admin: ActionClient, organizationId: string, candidateId: string, enrollmentRows: Row[] = []): Promise<{ candidate_id: string; project_id: string | null }> {
  const aliases = new Set([candidateId]);
  const links = await Promise.all([
    admin.from('mission_conversations').select('candidate_id,candidate_ids').eq('organization_id', organizationId).eq('candidate_id', candidateId).limit(100),
    admin.from('mission_conversations').select('candidate_id,candidate_ids').eq('organization_id', organizationId).contains('candidate_ids', [candidateId]).limit(100),
  ]);
  for (const result of links) {
    if (result.error) throw result.error;
    for (const row of result.data ?? []) for (const id of [row.candidate_id, ...(Array.isArray(row.candidate_ids) ? row.candidate_ids : [])]) if (str(id)) aliases.add(str(id));
  }
  for (const row of enrollmentRows) {
    const ids = [str(row.profile_id), str(row.provider_id), str(row.resolved_profile_id)].filter(Boolean);
    if (ids.some(id => aliases.has(id))) for (const id of ids) aliases.add(id);
  }
  const candidacies = await admin.from('job_candidate_status').select('candidate_id,project_id,job_id')
    .eq('organization_id', organizationId).in('candidate_id', [...aliases]).limit(101);
  if (candidacies.error) throw candidacies.error;
  const statusRows = (candidacies.data ?? []) as Row[];
  if (statusRows.length > 100) return { candidate_id: candidateId, project_id: null };
  const directIds = new Set(statusRows.map(row => projectUuid(row.project_id)).filter(Boolean));
  const jobIds = new Set(statusRows.filter(row => !str(row.project_id)).map(row => str(row.job_id)).filter(Boolean));
  // Legacy sequence job IDs are hints only when there is no candidacy. Every
  // hint is resolved against an actual project in this exact organization.
  if (!statusRows.length) for (const row of enrollmentRows) {
    const jobId = str(row.job_id);
    if (projectUuid(jobId)) directIds.add(projectUuid(jobId));
    if (jobId && !jobId.startsWith('project:')) jobIds.add(jobId);
  }
  const projects = await Promise.all([
    ...(directIds.size ? [admin.from('sourcing_projects').select('id,job_id').eq('organization_id', organizationId).in('id', [...directIds])] : []),
    ...(jobIds.size ? [admin.from('sourcing_projects').select('id,job_id').eq('organization_id', organizationId).in('job_id', [...jobIds])] : []),
  ]);
  const missionIds = new Set<string>();
  for (const result of projects) {
    if (result.error) throw result.error;
    for (const row of result.data ?? []) if (projectUuid(row.id)) missionIds.add(str(row.id));
  }
  if (missionIds.size !== 1) return { candidate_id: candidateId, project_id: null };
  const missionId = [...missionIds][0];
  const selectedProject = projects.flatMap(result => result.data ?? []).find((row: Row) => row.id === missionId);
  const canonicalIds = new Set(statusRows.filter(row => row.project_id === missionId || (!str(row.project_id) && row.job_id === selectedProject?.job_id)).map(row => str(row.candidate_id)).filter(Boolean));
  return { candidate_id: canonicalIds.size === 1 ? [...canonicalIds][0] : candidateId, project_id: missionId };
}


