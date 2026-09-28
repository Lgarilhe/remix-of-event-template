import type { SourcingProject } from '@/hooks/useSourcingProjects';

/**
 * Mission affichée dans la liste /missions : une ligne de sourcing_projects.
 */
export interface UnifiedProject {
  /** Unique key: sourcing_project.id */
  key: string;
  sourcingProject: SourcingProject;
  /** Display fields */
  name: string;
  clientName: string | null;
  status: SourcingProject['status'];
  location: string | null;
  skills: string[];
  description: string | null;
  createdAt: string;
  lastSearchAt: string | null;
}

/** Toutes les missions, y compris celles dont job_id est renseigné. */
export function toUnifiedProjects(sourcingProjects: SourcingProject[]): UnifiedProject[] {
  return sourcingProjects.map((sp) => ({
    key: sp.id,
    sourcingProject: sp,
    name: sp.name,
    clientName: sp.client_name,
    status: sp.status,
    location: null,
    skills: [],
    description: sp.description,
    createdAt: sp.created_at,
    lastSearchAt: sp.last_search_at,
  }));
}
