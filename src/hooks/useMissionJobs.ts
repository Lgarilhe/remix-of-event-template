import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import type { SourcingProject } from '@/hooks/useSourcingProjects';
import type { Job, TransversalCriteria } from '@/types/jobs';
import type { JobDetails } from '@/types/jobDetails';

type MissionRow = Pick<SourcingProject, 'id' | 'name' | 'description' | 'client_name' | 'job_details'>;

// Le job synthétique ne pose que les champs renseignés par le brief, plus
// quelques champs lus par le scoring hors du type Job.
type BriefClient = Partial<NonNullable<Job['client']>> & { cultureNotes?: string };
type BriefJob = Omit<Partial<Job>, 'client' | 'transversalCriteria'> & {
  client?: BriefClient | null;
  transversalCriteria?: Partial<TransversalCriteria> | null;
} & Record<string, unknown>;

/**
 * Mission → job synthétique « project:<id> », même forme que le job construit
 * depuis le brief dans useLinkedInSearch (branche sans job_id). Les concurrents
 * du client n'y figurent pas : ils sont chargés par mission dans la recherche.
 */
function missionToJob(project: MissionRow): Job {
  const jd: JobDetails = project.job_details || {};
  const job: BriefJob = {
    id: `project:${project.id}`,
    title: jd.title || project.name || 'Mission sans titre',
    description: project.description || '',
    client: project.client_name ? { name: project.client_name, sector: jd.client?.sector } : undefined,
  };

  job.skills = [...(jd.skills_must_have || []), ...(jd.skills_should_have || [])];
  const descParts = [jd.mission_description, jd.context].filter(Boolean);
  if (descParts.length) job.description = descParts.join('\n\n');
  if (jd.skills_must_have?.length) job.mustHave = jd.skills_must_have.join(', ');
  if (jd.skills_should_have?.length) job.shouldHave = jd.skills_should_have.join(', ');
  if (jd.skills_nice_to_have?.length) job.niceToHave = jd.skills_nice_to_have.join(', ');
  if (jd.seniority) job.seniority = jd.seniority;
  if (jd.location) job.location = jd.location;
  if (jd.experience_min != null) job.xpMin = jd.experience_min;
  if (jd.experience_max != null) job.xpMax = jd.experience_max;
  if (jd.remote_policy) job.remote = jd.remote_policy;
  if (jd.contract_type) job.contractType = jd.contract_type;
  if (jd.salary_min != null) job.salaryMin = jd.salary_min;
  if (jd.salary_max != null) job.salaryMax = jd.salary_max;
  if (jd.salary_type === 'daily' && jd.salary_min != null) job.tjmMin = jd.salary_min;

  const reqParts: string[] = [];
  if (jd.certifications?.length) reqParts.push(`Certifications requises : ${jd.certifications.join(', ')}`);
  if (jd.languages?.length) reqParts.push(`Langues : ${jd.languages.map((l) => `${l.language} (${l.level})`).join(', ')}`);
  if (reqParts.length) job.requirements = reqParts.join('. ');

  if (jd.evaluation_criteria?.length && Array.isArray(jd.evaluation_criteria)) {
    const criteriaText = jd.evaluation_criteria
      .filter((c) => c && c.label)
      .slice(0, 15)
      .map((c) => `[${c.category || '?'}${c.deal_breaker ? ' DEAL-BREAKER' : ''} poids:${c.weight || 1}] ${c.label}: ${(c.description || '').slice(0, 150)}${c.level_10 ? ` (10/10: ${c.level_10.slice(0, 80)})` : ''}${c.level_1 ? ` (rédhibitoire: ${c.level_1.slice(0, 80)})` : ''}`)
      .join('\n');
    job.bodyContent = (job.bodyContent ? job.bodyContent + '\n\n' : '') + `=== CRITÈRES D'ÉVALUATION DU MANAGER ===\n${criteriaText}`;
  }
  if (jd.raw_brief) job.originalBriefText = jd.raw_brief.slice(0, 4000);
  if (job.bodyContent && job.bodyContent.length > 3000) job.bodyContent = job.bodyContent.slice(0, 3000);

  if (jd.target_companies?.length) {
    const companies = jd.target_companies.flatMap((cat) => cat.companies?.map((c) => c.name) || []).filter(Boolean);
    if (companies.length && !job.transversalCriteria) {
      job.transversalCriteria = { context: `Entreprises cibles / feeders : ${companies.join(', ')}` };
    }
  }
  if (jd.outreach_config) job.outreachConfig = jd.outreach_config;

  if (jd.evaluation_criteria?.length) {
    job.evaluationCriteria = jd.evaluation_criteria.slice(0, 12).map((c) => ({
      label: c.label,
      description: c.description,
      category: c.category,
      weight: c.weight,
      dealBreaker: !!c.deal_breaker,
      level10: c.level_10,
      level1: c.level_1,
      interviewStage: c.interview_stage,
    }));
  }
  if (jd.evaluation_weights) job.evaluationWeights = jd.evaluation_weights;
  if (jd.target_companies?.length) {
    job.targetCompanies = jd.target_companies.slice(0, 6).map((cat) => ({
      category: cat.category,
      companies: (cat.companies || []).slice(0, 8).map((c) => c.name).filter(Boolean),
    }));
  }
  if (jd.calibration_profiles?.length) {
    job.calibrationProfiles = jd.calibration_profiles.slice(0, 5).map((p) => ({
      ...(typeof p.sourcing_agent_candidate_id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.sourcing_agent_candidate_id)
        ? { sourcing_agent_candidate_id: p.sourcing_agent_candidate_id } : {}),
      name: p.name,
      headline: p.headline,
      linkedinUrl: p.linkedin_url,
      whyGoodFit: p.why_good_fit,
      areasOfImprovement: p.areas_of_improvement,
    }));
  }
  if (jd.skills_to_avoid?.length) job.skillsToAvoid = jd.skills_to_avoid;
  if (jd.languages?.length) {
    job.requiredLanguages = jd.languages.map((l) => ({ language: l.language, level: l.level }));
  }
  if (jd.certifications?.length) job.requiredCertifications = jd.certifications;
  if (jd.client?.size || jd.client?.culture_notes) {
    const existingClient = job.client || (jd.client?.name ? { name: jd.client.name, sector: jd.client.sector } : null);
    if (existingClient) {
      job.client = { ...existingClient, size: jd.client?.size, cultureNotes: jd.client?.culture_notes };
    }
  }
  if (jd.urgency) job.urgency = jd.urgency;
  if (jd.team_size) job.teamSize = jd.team_size;
  if (jd.reports_to) job.reportsTo = jd.reports_to;
  if (jd.manages) job.manages = jd.manages;
  if (jd.pedigree_requirements) job.pedigreeRequirements = jd.pedigree_requirements;
  if (jd.pedigree_preset_name) job.pedigreePresetName = jd.pedigree_preset_name;

  return job as Job;
}

/**
 * Missions en cours de l'organisation (ni terminées ni archivées), au format
 * Job synthétique « project:<id> ». Sert de liste de postes au sélecteur de
 * scoring hors mission.
 */
export function useMissionJobs() {
  const { organizationId, isLoading } = useOrganization();

  return useQuery({
    queryKey: ['mission-jobs', organizationId],
    queryFn: async (): Promise<Job[]> => {
      const { data, error } = await supabase
        .from('sourcing_projects')
        .select('id, name, description, client_name, job_details')
        .eq('organization_id', organizationId)
        .eq('kind', 'mission')
        .not('status', 'in', '(completed,archived)')
        .order('updated_at', { ascending: false });

      if (error) throw error;
      return ((data || []) as MissionRow[]).map(missionToJob);
    },
    enabled: !isLoading && !!organizationId,
    staleTime: 5 * 60 * 1000,
  });
}
