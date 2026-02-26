import type { Job } from '@/types/jobs';
import type { SourcingProject } from '@/hooks/useSourcingProjects';

/**
 * Unified project type that merges Notion jobs and manual sourcing projects.
 * - A Notion job is always a project (with optional sourcing_project metadata)
 * - A manual project exists only in sourcing_projects (no Notion job)
 */
export interface UnifiedProject {
  /** Unique key: job.id for Notion jobs, sourcing_project.id for manual projects */
  key: string;
  /** Source type */
  source: 'notion' | 'manual';
  /** Notion job data (null for manual projects) */
  job: Job | null;
  /** Sourcing project metadata (null if not yet created for a Notion job) */
  sourcingProject: SourcingProject | null;
  /** Display fields */
  name: string;
  clientName: string | null;
  status: SourcingProject['status'];
  location: string | null;
  contractType: string | null;
  priority: string | null;
  skills: string[];
  description: string | null;
  createdAt: string;
  lastSearchAt: string | null;
}

/**
 * Merge Notion jobs and sourcing projects into a unified list.
 * Each Notion job becomes a project. Manual projects (no job_id) are appended.
 */
export function mergeProjectsAndJobs(
  jobs: Job[],
  sourcingProjects: SourcingProject[]
): UnifiedProject[] {
  // Index sourcing projects by job_id for fast lookup
  const spByJobId = new Map<string, SourcingProject>();
  const manualProjects: SourcingProject[] = [];

  for (const sp of sourcingProjects) {
    if (sp.job_id) {
      spByJobId.set(sp.job_id, sp);
    } else {
      manualProjects.push(sp);
    }
  }

  // Create unified projects from Notion jobs
  const unified: UnifiedProject[] = jobs.map((job) => {
    const sp = spByJobId.get(job.id) || null;
    return {
      key: job.id,
      source: 'notion' as const,
      job,
      sourcingProject: sp,
      name: job.title,
      clientName: job.client?.name || null,
      status: sp?.status || 'active',
      location: job.location || null,
      contractType: job.contractType || null,
      priority: job.priority || null,
      skills: job.skills || [],
      description: job.description || null,
      createdAt: sp?.created_at || job.openingDate || new Date().toISOString(),
      lastSearchAt: sp?.last_search_at || null,
    };
  });

  // Append manual projects (those without a job_id)
  for (const sp of manualProjects) {
    unified.push({
      key: sp.id,
      source: 'manual',
      job: null,
      sourcingProject: sp,
      name: sp.name,
      clientName: sp.client_name,
      status: sp.status,
      location: null,
      contractType: null,
      priority: null,
      skills: [],
      description: sp.description,
      createdAt: sp.created_at,
      lastSearchAt: sp.last_search_at,
    });
  }

  return unified;
}
