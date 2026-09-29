// Refonte mission, lot 2 : candidats d'une mission pour la nouvelle page
// (liste de Pipeline, section À trier, kanban), lus dans la vue
// mission_candidate_rows : une ligne par candidat, doublons réunis, profils
// jamais ouverts exclus (ils restent au Sourcing).
//
// Clés sous le préfixe ['project-candidates', id, …] : invalidées par
// invalidateStageReaders (src/lib/stageDisplay.ts) après chaque geste d'étape,
// et par les invalidations existantes de la mission.

import { useSyncExternalStore } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  IN_PROGRESS_STAGES,
  MISSION_ROW_LIGHT_COLUMNS,
  NO_STEP,
  PIPELINE_PAGE_SIZE,
  stageFilterKey,
  toMissionCandidateRow,
  type MissionCandidateRow,
  type StageFilter,
} from '@/components/missions/v3/types';
import { getKnownStagesVersion, subscribeKnownStages } from '@/components/missions/v3/pipeline/frozenOrder';

// La vue n'a pas de clé primaire déclarée : lecture non typée, lignes validées
// par toMissionCandidateRow.
const db = supabase as unknown as {
  from: (table: 'mission_candidate_rows') => any;
};

function toRows(data: unknown): MissionCandidateRow[] {
  if (!Array.isArray(data)) return [];
  const out: MissionCandidateRow[] = [];
  for (const raw of data) {
    const row = toMissionCandidateRow(raw);
    if (row) out.push(row);
  }
  return out;
}

/** Base commune : la mission, sans les profils jamais ouverts, colonnes légères. */
function baseQuery(projectId: string, options?: { count?: 'exact' }) {
  return db
    .from('mission_candidate_rows')
    .select(MISSION_ROW_LIGHT_COLUMNS, options)
    .eq('project_id', projectId)
    .eq('is_unopened', false);
}

/** Ordre de comparePipelineRows : plus longtemps dans l'étape, puis la note, puis l'id. */
function ordered(query: any) {
  return query
    .order('stage_entered_at', { ascending: true, nullsFirst: false })
    .order('score', { ascending: false, nullsFirst: false })
    .order('id', { ascending: true });
}

function filtered(query: any, filter: StageFilter | null) {
  if (filter === null) return query.in('general_stage', [...IN_PROGRESS_STAGES]);
  let q = query.eq('general_stage', filter.stage);
  if (filter.stage === 'interviewing' && filter.stepId !== null) {
    q = filter.stepId === NO_STEP ? q.is('process_step_id', null) : q.eq('process_step_id', filter.stepId);
  }
  return q;
}

export function missionCandidateRowsKey(projectId: string, filter: StageFilter | null) {
  return ['project-candidates', projectId, 'v3-rows', stageFilterKey(filter)] as const;
}

/**
 * Liste de Pipeline (filtre null : candidats en cours) ou d'une étape, par
 * pages de PIPELINE_PAGE_SIZE. hasNextPage tant qu'une page est pleine.
 */
export function useMissionCandidateRows(
  projectId: string,
  filter: StageFilter | null,
  options?: { enabled?: boolean },
) {
  return useInfiniteQuery({
    queryKey: missionCandidateRowsKey(projectId, filter),
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<MissionCandidateRow[]> => {
      const from = pageParam as number;
      const { data, error } = await ordered(filtered(baseQuery(projectId), filter)).range(
        from,
        from + PIPELINE_PAGE_SIZE - 1,
      );
      if (error) throw error;
      return toRows(data);
    },
    getNextPageParam: (lastPage, pages) =>
      lastPage.length >= PIPELINE_PAGE_SIZE ? pages.reduce((n, page) => n + page.length, 0) : undefined,
    enabled: !!projectId && (options?.enabled ?? true),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

/** Taille d'une page du kanban, et plafond d'affichage. */
export const BOARD_PAGE_SIZE = 1000;
export const BOARD_MAX_ROWS = 2000;

export interface MissionBoardRows {
  rows: MissionCandidateRow[];
  /** Plus de BOARD_MAX_ROWS candidats : le kanban n'en montre qu'une partie. */
  limited: boolean;
}

/** Kanban : tous les candidats de la mission (écartés compris), jusqu'à BOARD_MAX_ROWS. */
export function useMissionBoardRows(projectId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['project-candidates', projectId, 'v3-board'],
    queryFn: async (): Promise<MissionBoardRows> => {
      const rows: MissionCandidateRow[] = [];
      let total: number | null = null;
      for (let from = 0; from < BOARD_MAX_ROWS; from += BOARD_PAGE_SIZE) {
        const { data, error, count } = await ordered(
          baseQuery(projectId, from === 0 ? { count: 'exact' } : undefined),
        ).range(from, from + BOARD_PAGE_SIZE - 1);
        if (error) throw error;
        if (from === 0 && typeof count === 'number') total = count;
        const page = toRows(data);
        rows.push(...page);
        if ((Array.isArray(data) ? data.length : 0) < BOARD_PAGE_SIZE) break;
      }
      const seen = new Set<string>();
      const unique = rows.filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true)));
      return { rows: unique, limited: total !== null ? total > BOARD_MAX_ROWS : unique.length >= BOARD_MAX_ROWS };
    },
    enabled: !!projectId && (options?.enabled ?? true),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

/** Version des étapes connues après un geste (frozenOrder.ts) : relit l'écran dès l'écriture confirmée. */
export function useKnownStagesVersion(): number {
  return useSyncExternalStore(subscribeKnownStages, getKnownStagesVersion, getKnownStagesVersion);
}
