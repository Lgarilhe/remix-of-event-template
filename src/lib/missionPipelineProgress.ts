import type { MissionStageCounts } from '@/hooks/useMissionStageCounts';

/** Current pipeline stages, ordered from selection to hiring. Historical totals do not determine the dot. */
export const MISSION_PIPELINE_STAGES = [
  { key: 'toSort', label: 'À trier', color: 'bg-muted-foreground' },
  { key: 'retained', label: 'Retenus', color: 'bg-mission-violet' },
  { key: 'contacted', label: 'Contactés', color: 'bg-mission-blue' },
  { key: 'replied', label: 'Réponses reçues', color: 'bg-mission-teal' },
  { key: 'interviewing', label: 'Entretiens', color: 'bg-mission-amber' },
  { key: 'hired', label: 'Embauche', color: 'bg-mission-green' },
] as const;

export interface MissionPipelineProgress {
  key: string;
  label: string;
  color: string | null;
  count: number | null;
}

export function missionPipelineProgress(counts: MissionStageCounts | null | undefined): MissionPipelineProgress {
  if (!counts) return { key: 'unknown', label: 'Avancement indisponible', color: null, count: null };
  for (const stage of [...MISSION_PIPELINE_STAGES].reverse()) {
    if (counts[stage.key] > 0) return { ...stage, count: counts[stage.key] };
  }
  if (counts.unopened > 0) {
    return { key: 'sourcing', label: 'Sourcing : profils à ouvrir', color: 'bg-muted-foreground', count: counts.unopened };
  }
  return {
    key: 'empty',
    label: counts.rejected > 0 ? 'Aucun candidat actif' : 'Aucun candidat dans le pipeline',
    color: 'bg-muted-foreground',
    count: 0,
  };
}
