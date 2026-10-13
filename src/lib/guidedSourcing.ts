import { supabase } from '@/integrations/supabase/client';
import type { SourcingProject, UpdateProjectInput } from '@/hooks/useSourcingProjects';
import type { JobDetails } from '@/types/jobDetails';
import { stableScoringContextKey } from './sourcingScoringContext';

/** Avoid replacing a brief edited in Cadrage while the dialogue was open. */
export async function saveGuidedBrief(project: SourcingProject, brief: JobDetails,
  update: (input: UpdateProjectInput) => Promise<SourcingProject>): Promise<SourcingProject> {
  const { data, error } = await supabase.from('sourcing_projects').select('job_details, status, updated_at').eq('id', project.id).single();
  if (error || !data) throw new Error('La mission n’est plus accessible. Le brouillon est conservé.');
  if (data.status === 'archived' || data.status === 'completed') throw new Error('Cette mission est fermée. Réactivez-la avant de chercher.');
  if (stableScoringContextKey(data.job_details ?? {}) !== stableScoringContextKey(project.job_details ?? {})) {
    throw new Error('Le cadrage a été modifié ailleurs. Fermez ce dialogue et reprenez depuis le cadrage à jour.');
  }
  return update({ id: project.id, job_details: brief, expectedUpdatedAt: data.updated_at });
}
