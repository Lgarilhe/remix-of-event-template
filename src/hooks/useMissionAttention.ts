// Refonte mission, lot 3 : signaux d'attention d'une ou plusieurs missions, lus
// dans get_mission_attention (réponses reçues sur votre compte, candidats en
// entretien depuis longtemps, profils notés à trier, poste décrit). Alimente la
// carte « Maintenant », la colonne « Prochaine action » et la liste des missions.
//
// Jamais de zéros inventés : une mission que la base ne rend pas (autre
// organisation, mission supprimée) est absente du résultat, et une erreur de
// lecture donne l'état d'erreur de la requête, pas des compteurs à zéro.
// Clé sous ['mission-stage-counts', …] : les gestes d'étape la relisent avec
// les effectifs (invalidateStageReaders). Rafraîchi après 30 s et au retour sur
// l'onglet : une réponse reçue par le serveur apparaît sans geste.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { missionStageCountIds } from '@/hooks/useMissionStageCounts';
import { parseAttentionRow, type MissionAttention } from '@/lib/missionNextAction';

/** Éléments demandés par mission dans la liste des missions : la règle en veut au moins 5 (sinon les rangs 3 et 6 sont indisponibles). */
export const MISSION_ATTENTION_ITEM_LIMIT = 5;

/**
 * Éléments demandés pour une seule mission (carte, colonne « Prochaine action »,
 * en-tête de la fiche) : le maximum de la fonction. Avec 5, les réponses au-delà
 * de la cinquième ne seraient pas marquées « Répondre » dans la colonne, et
 * reporter les cinq premières ne ferait pas apparaître la sixième sur la carte.
 */
export const MISSION_ATTENTION_DETAIL_ITEM_LIMIT = 200;

export const MISSION_ATTENTION_STALE_TIME = 30_000;

/** Signaux par identifiant de mission ; une mission absente n'a pas été rendue par la base. */
export type MissionAttentionById = Record<string, MissionAttention>;

/** Lignes rendues par get_mission_attention vers un index par mission (lignes illisibles ignorées). */
export function parseMissionAttention(rows: unknown): MissionAttentionById {
  const out: MissionAttentionById = {};
  if (!Array.isArray(rows)) return out;
  for (const raw of rows) {
    const row = parseAttentionRow(raw);
    if (row) out[row.projectId] = row;
  }
  return out;
}

/**
 * Signaux d'attention des missions demandées. data : index par mission
 * (absente = non rendue, jamais zéro) ; isError : lecture en échec, à afficher
 * comme telle.
 */
export function useMissionAttention(
  projectIds: readonly (string | null | undefined)[],
  options?: { enabled?: boolean },
) {
  const key = missionStageCountIds(projectIds).join(',');
  const ids = useMemo(() => (key ? key.split(',') : []), [key]);

  return useQuery({
    queryKey: ['mission-stage-counts', 'attention', ids],
    queryFn: async (): Promise<MissionAttentionById> => {
      const { data, error } = await supabase.rpc('get_mission_attention', {
        p_project_ids: ids,
        p_item_limit: MISSION_ATTENTION_ITEM_LIMIT,
      });
      if (error) throw error;
      return parseMissionAttention(data);
    },
    enabled: ids.length > 0 && (options?.enabled ?? true),
    staleTime: MISSION_ATTENTION_STALE_TIME,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Signaux d'attention d'une seule mission, avec tous les éléments utiles :
 * mêmes états que useMissionAttention (absente = non rendue, jamais zéro).
 * Clé voisine, sous le même préfixe : relue avec les effectifs. La carte et la
 * colonne la partagent, une seule requête par mission.
 */
export function useMissionAttentionDetail(projectId: string | null | undefined) {
  const id = projectId ?? null;

  return useQuery({
    queryKey: ['mission-stage-counts', 'attention', 'detail', id],
    queryFn: async (): Promise<MissionAttentionById> => {
      const { data, error } = await supabase.rpc('get_mission_attention', {
        p_project_ids: id ? [id] : [],
        p_item_limit: MISSION_ATTENTION_DETAIL_ITEM_LIMIT,
      });
      if (error) throw error;
      return parseMissionAttention(data);
    },
    enabled: id !== null,
    staleTime: MISSION_ATTENTION_STALE_TIME,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}
