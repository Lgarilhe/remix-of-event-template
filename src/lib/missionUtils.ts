import type { JobDetails } from '@/types/jobDetails';
import type { SourcingProject } from '@/hooks/useSourcingProjects';

/**
 * Count how many brief fields are filled vs total.
 * Single source of truth — used by ProgressBar, BentoDashboard, SourcingReadinessPanel.
 */
export function countBriefFields(jd: Partial<JobDetails>): { filled: number; total: number } {
  const fields = [
    jd.title,
    jd.mission_description || jd.context || jd.raw_brief,
    jd.seniority,
    jd.location,
    jd.contract_type,
    jd.remote_policy,
    jd.client?.name,
    jd.salary_min,
    jd.experience_min,
    jd.skills_must_have?.length ? jd.skills_must_have : null,
    jd.skills_should_have?.length ? jd.skills_should_have : null,
    jd.languages?.length ? jd.languages : null,
  ];
  return { filled: fields.filter(Boolean).length, total: fields.length };
}

/** Brief completion as a percentage (0–100). */
export function getBriefCompletionPercent(project: SourcingProject): number {
  const jd = (project.job_details || {}) as JobDetails;
  const { filled, total } = countBriefFields(jd);
  return total === 0 ? 0 : Math.round((filled / total) * 100);
}

/** Build a text summary of the brief for AI agent context. */
export function buildBriefContext(project: SourcingProject): string {
  const jd = (project.job_details ?? {}) as JobDetails;
  const parts: string[] = [];
  if (jd.title) parts.push(`Poste : ${jd.title}`);
  if (jd.client?.name) parts.push(`Client : ${jd.client.name}`);
  if (jd.client?.sector) parts.push(`Secteur : ${jd.client.sector}`);
  if (jd.location) parts.push(`Localisation : ${jd.location}`);
  if (jd.contract_type) parts.push(`Contrat : ${jd.contract_type}`);
  if (jd.skills_must_have?.length) parts.push(`Compétences clés : ${jd.skills_must_have.join(', ')}`);
  if (jd.experience_min || jd.experience_max) parts.push(`Expérience : ${jd.experience_min ?? '?'}–${jd.experience_max ?? '?'} ans`);
  if (jd.mission_description) parts.push(`Description : ${jd.mission_description.slice(0, 300)}`);
  return parts.length > 0 ? `\n\nDonnées du brief :\n${parts.join('\n')}` : '';
}
