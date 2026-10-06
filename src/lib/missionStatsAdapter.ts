// Refonte mission, lot 0c-3 : adaptateur des Analyses d'une mission.
//
// Remplit l'ancienne forme ProjectStats (celle de get_project_stats) à partir
// de get_mission_stage_counts, pour que MissionInsights et ProjectFunnel n'appellent
// plus l'ancienne fonction. Module pur : aucune lecture de base ici. Les
// Analyses sont refaites au lot 1, l'adaptateur part avec elles.

import type { MissionStageCounts } from '@/hooks/useMissionStageCounts';

/** Chiffres des Analyses d'une mission. */
export interface ProjectStats {
  /** Sourcés : candidats de la mission, profils jamais ouverts compris (égal à stats_total_found). */
  total: number;
  /** Profils notés. */
  scored: number;
  /** Contactés au total (cumul depuis le début). */
  messaged: number;
  /** Retenus au total (cumul depuis le début). */
  shortlisted: number;
  /** Écartés en ce moment. */
  dismissed: number;
  /** À trier en ce moment (colonne À trier du Pipeline, jamais ouverts exclus). */
  untreated: number;
}

/** Compteurs de la mission vers les chiffres des Analyses ; null sans compteurs. */
export function toProjectStats(c: MissionStageCounts | null | undefined): ProjectStats | null {
  if (!c) return null;
  return {
    total: c.unopened + c.toSort + c.retained + c.contacted + c.replied + c.interviewing + c.hired + c.rejected,
    scored: c.scored,
    messaged: c.everContacted,
    shortlisted: c.everRetained,
    dismissed: c.rejected,
    untreated: c.toSort,
  };
}
