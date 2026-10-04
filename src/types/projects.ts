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
  /** Intitulé du poste : celui du brief, sinon job_title. */
  jobTitle: string | null;
  /** Client : celui du brief, sinon client_name. */
  clientName: string | null;
  status: SourcingProject['status'];
  /** Lieu du brief. */
  location: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

const text = (v: string | null | undefined): string | null => {
  const t = typeof v === 'string' ? v.trim() : '';
  return t ? t : null;
};

/** Toutes les missions, y compris celles dont job_id est renseigné. */
export function toUnifiedProjects(sourcingProjects: SourcingProject[]): UnifiedProject[] {
  return sourcingProjects.map((sp) => ({
    key: sp.id,
    sourcingProject: sp,
    name: sp.name,
    jobTitle: text(sp.jd_title) ?? text(sp.job_title),
    clientName: text(sp.jd_client) ?? text(sp.client_name),
    status: sp.status,
    location: text(sp.jd_location),
    description: sp.description,
    createdAt: sp.created_at,
    updatedAt: sp.updated_at,
  }));
}

/**
 * Libellé d'une recommandation de note. Les notes actuelles portent
 * STRONG_MATCH, GOOD_MATCH, POSSIBLE_MATCH, WEAK_MATCH ou NO_MATCH
 * (score-profile-job) ; top, good, maybe et skip restent pour les lignes anciennes.
 * undefined si la valeur est inconnue ou absente.
 */
export function recommendationLabel(recommendation: string | null | undefined, skipReason?: string | null): string | undefined {
  switch (recommendation) {
    case 'STRONG_MATCH':
    case 'top':
      return 'Profil top : très bon match';
    case 'GOOD_MATCH':
    case 'good':
      return 'Profil prometteur';
    case 'POSSIBLE_MATCH':
    case 'maybe':
      return 'À considérer';
    case 'WEAK_MATCH':
      return 'Correspondance faible';
    case 'NO_MATCH':
      return skipReason || 'Ne correspond pas à la mission';
    case 'skip':
      return skipReason || undefined;
    default:
      return undefined;
  }
}
