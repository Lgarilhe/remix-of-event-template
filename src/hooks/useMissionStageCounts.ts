// Refonte mission, lot 0c : compteurs d'étapes des missions, lus dans
// get_mission_stage_counts (une seule définition, la même que les stats_*).
//
// Effectifs « en ce moment » (to_sort ... rejected, sous le nom de l'étape) pour
// la carte de mission et le kanban ; cumuls ever_* (« au total ») ailleurs.
// Les profils jamais ouverts sont à part (unopened), hors du Pipeline.
//
// Jamais de zéros inventés : une mission que la base ne rend pas (autre
// organisation, mission supprimée) est absente du résultat, et une erreur de
// lecture donne l'état d'erreur de la requête, pas des compteurs à zéro.
// Rafraîchi après 30 s et au retour sur l'onglet : une réponse reçue par le
// serveur apparaît sans geste (plan 0c, section 6.6).

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface MissionStageCounts {
  projectId: string;
  /** Profils trouvés par une recherche, jamais ouverts (hors Pipeline). */
  unopened: number;
  toSort: number;
  retained: number;
  contacted: number;
  replied: number;
  interviewing: number;
  hired: number;
  rejected: number;
  /** En entretien par étape de la mission (process_step_id), « none » sans étape. */
  interviewingByStep: Record<string, number>;
  scored: number;
  everRetained: number;
  everContacted: number;
  everReplied: number;
  everInterviewed: number;
  everPresented: number;
  everHired: number;
  triagedByUser: number;
  /** Dernière entrée dans une étape (hors jamais ouverts), chaîne de la base ; null sans candidat. */
  lastStageMoveAt: string | null;
}

/** Compteurs par identifiant de mission ; une mission absente n'a pas été rendue par la base. */
export type MissionStageCountsById = Record<string, MissionStageCounts>;

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};

function byStep(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, n] of Object.entries(v as Record<string, unknown>)) out[k] = num(n);
  }
  return out;
}

/**
 * Lignes rendues par get_mission_stage_counts vers un index par mission.
 * Seules les missions rendues y figurent (aucune ligne à zéro ajoutée).
 */
export function parseMissionStageCounts(rows: unknown): MissionStageCountsById {
  const out: MissionStageCountsById = {};
  if (!Array.isArray(rows)) return out;
  for (const raw of rows) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const projectId = typeof r.project_id === 'string' && r.project_id !== '' ? r.project_id : null;
    if (!projectId) continue;
    out[projectId] = {
      projectId,
      unopened: num(r.unopened),
      toSort: num(r.to_sort),
      retained: num(r.retained),
      contacted: num(r.contacted),
      replied: num(r.replied),
      interviewing: num(r.interviewing),
      hired: num(r.hired),
      rejected: num(r.rejected),
      interviewingByStep: byStep(r.interviewing_by_step),
      scored: num(r.scored),
      everRetained: num(r.ever_retained),
      everContacted: num(r.ever_contacted),
      everReplied: num(r.ever_replied),
      everInterviewed: num(r.ever_interviewed),
      everPresented: num(r.ever_presented),
      everHired: num(r.ever_hired),
      triagedByUser: num(r.triaged_by_user),
      lastStageMoveAt: typeof r.last_stage_move_at === 'string' && r.last_stage_move_at !== '' ? r.last_stage_move_at : null,
    };
  }
  return out;
}

/** Identifiants distincts, non vides, triés : une clé stable quel que soit l'ordre d'appel. */
export function missionStageCountIds(projectIds: readonly (string | null | undefined)[]): string[] {
  return [...new Set(projectIds.filter((id): id is string => typeof id === 'string' && id !== ''))].sort();
}

export const MISSION_STAGE_COUNTS_STALE_TIME = 30_000;

/**
 * Compteurs d'étapes d'une ou plusieurs missions. data : index par mission
 * (absente = non rendue, jamais zéro) ; isError : lecture en échec, à afficher
 * comme telle.
 */
export function useMissionStageCounts(projectIds: readonly (string | null | undefined)[]) {
  const key = missionStageCountIds(projectIds).join(',');
  const ids = useMemo(() => (key ? key.split(',') : []), [key]);

  return useQuery({
    queryKey: ['mission-stage-counts', ids],
    queryFn: async (): Promise<MissionStageCountsById> => {
      const { data, error } = await supabase.rpc('get_mission_stage_counts', { p_project_ids: ids });
      if (error) throw error;
      return parseMissionStageCounts(data);
    },
    enabled: ids.length > 0,
    staleTime: MISSION_STAGE_COUNTS_STALE_TIME,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}
