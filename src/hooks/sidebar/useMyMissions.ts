import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useOrganization } from '@/hooks/useOrganization';
import { sourcingProjectQueryOptions, useSourcingProjects } from '@/hooks/useSourcingProjects';
import type { PartnerMission } from '@/hooks/useMarketplace';
import type { SectionState } from '@/lib/sidebarSection';
import {
  buildMyMissions,
  needsPartnerNames,
  type MissionNavItem,
  type TeamRow,
} from '@/lib/sidebarMissions';
import { useMissionPins } from './useMissionPins';

/**
 * Données de l'onglet Missions (§3.4, D20, D21, D22). Une requête par source,
 * toutes bornées, aucune par mission :
 * 1. liste de l'organisation : useSourcingProjects('mission') à l'identique
 *    (même clé, aucun appel si le cache est chaud), relue toutes les 5 min ;
 * 2. mes lignes d'équipe avec la mission jointe ;
 * 3. noms des partenaires (get_partner_missions), seulement si la jointure
 *    contient une mission d'une autre organisation ;
 * 4. épingles, si l'appelant les demande (panneau Missions).
 */

const SIDEBAR_REFRESH_MS = 5 * 60_000;

const TEAM_SELECT =
  'project_id, sourcing_projects(id, name, client_name, organization_id, kind, status, job_title, created_by, updated_at, stats_total_found, stats_messaged, hunt_mode, hunt_status)';

export function missionTeamQueryKey(userId: string | null, organizationId: string | null) {
  return ['sidebar', 'mission-team', userId, organizationId] as const;
}

export interface UseMyMissionsOptions {
  enabled: boolean;
  /** Lit aussi les épingles (panneau Missions). Défaut : non. */
  withPins?: boolean;
  /** Mission ouverte, exclue des épinglées et de « Mes missions ». */
  openMissionId?: string | null;
}

export interface MyMissions {
  status: SectionState;
  stale: boolean;
  retry: () => void;
  mine: MissionNavItem[];
  pinned: MissionNavItem[];
  /** Missions de l'organisation (tous statuts), null si inconnu. */
  ownOrgMissionCount: number | null;
  /** Missions partenaires, null si inconnu. */
  partnerMissionCount: number | null;
  firstOwnMissionId: string | null;
  /** État propre de la section Épinglées. */
  pinsStatus: SectionState;
  pinsStale: boolean;
  retryPins: () => void;
  /** Épingles résolues, mission ouverte comprise. */
  pinnedIds: string[];
  resolvedPinCount: number;
  setPinned: (projectId: string, pinned: boolean) => void;
  /** Ligne de liste ou de jointure de la mission ouverte. */
  open: MissionNavItem | null;
}

function refetchQuietly(refetch: () => Promise<unknown>): void {
  refetch().catch(() => undefined);
}

export function useMyMissions(opts: UseMyMissionsOptions): MyMissions {
  const { enabled, withPins = false, openMissionId = null } = opts;
  const { user } = useAuthReady();
  const userId = user?.id ?? null;
  const { organizationId } = useOrganization();

  // 1. Liste de l'organisation (même clé et mêmes colonnes que la page /missions).
  const orgList = useSourcingProjects('mission', { enabled, refetchInterval: SIDEBAR_REFRESH_MS });

  // 2. Mes lignes d'équipe, avec la mission jointe (une jointure null est ignorée).
  const teamQuery = useQuery({
    queryKey: missionTeamQueryKey(userId, organizationId),
    queryFn: async (): Promise<TeamRow[]> => {
      if (!userId) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('mission_team')
        .select(TEAM_SELECT)
        .eq('user_id', userId)
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
    enabled: enabled && !!userId && !!organizationId,
    staleTime: 60_000,
    retry: 1,
    refetchInterval: SIDEBAR_REFRESH_MS,
  });

  // 3. Noms des partenaires : mêmes clé et options que usePartnerMissions
  //    (useMarketplace.ts), lus seulement si une mission étrangère est jointe.
  const needPartners = needsPartnerNames(teamQuery.data, organizationId);
  const partnersQuery = useQuery({
    queryKey: ['marketplace', 'partner-missions', organizationId],
    queryFn: async (): Promise<PartnerMission[]> => {
      const { data, error } = await supabase.rpc('get_partner_missions');
      if (error) throw error;
      return (data ?? []) as unknown as PartnerMission[];
    },
    enabled: enabled && needPartners && !!organizationId,
    staleTime: 60 * 1000,
  });

  // 4. Épingles.
  const pins = useMissionPins({ enabled: enabled && withPins });

  const orgRows = orgList.hasData ? orgList.projects : undefined;

  const built = useMemo(
    () =>
      buildMyMissions({
        userId,
        organizationId,
        orgList: { data: orgRows, isError: orgList.isError, paused: orgList.fetchStatus === 'paused' },
        team: {
          data: teamQuery.data,
          isError: teamQuery.isError,
          paused: teamQuery.fetchStatus === 'paused',
        },
        partners: {
          data: partnersQuery.data,
          isError: partnersQuery.isError,
          paused: partnersQuery.fetchStatus === 'paused',
        },
        pins: withPins
          ? { data: pins.data, isError: pins.isError, paused: pins.fetchStatus === 'paused' }
          : null,
        openMissionId,
      }),
    [
      userId,
      organizationId,
      orgRows,
      orgList.isError,
      orgList.fetchStatus,
      teamQuery.data,
      teamQuery.isError,
      teamQuery.fetchStatus,
      partnersQuery.data,
      partnersQuery.isError,
      partnersQuery.fetchStatus,
      withPins,
      pins.data,
      pins.isError,
      pins.fetchStatus,
      openMissionId,
    ],
  );

  const refetchOrgList = orgList.refetch;
  const refetchTeam = teamQuery.refetch;
  const refetchPartners = partnersQuery.refetch;
  const refetchPins = pins.refetch;

  const retry = useCallback(() => {
    refetchQuietly(refetchOrgList);
    refetchQuietly(refetchTeam);
    if (needPartners) refetchQuietly(refetchPartners);
  }, [refetchOrgList, refetchTeam, refetchPartners, needPartners]);

  const retryPins = useCallback(() => {
    refetchQuietly(refetchPins);
    retry();
  }, [refetchPins, retry]);

  return {
    status: built.status,
    stale: built.stale,
    retry,
    mine: built.mine,
    pinned: built.pinned,
    ownOrgMissionCount: built.ownOrgMissionCount,
    partnerMissionCount: built.partnerMissionCount,
    firstOwnMissionId: built.firstOwnMissionId,
    pinsStatus: built.pinsStatus,
    pinsStale: built.pinsStale,
    retryPins,
    pinnedIds: built.pinnedIds,
    resolvedPinCount: built.resolvedPinCount,
    setPinned: pins.setPinned,
    open: built.open,
  };
}

/**
 * Fiche complète de la mission ouverte, lue dans le cache de la page
 * (['sourcing-project', id]) sans jamais la lancer : vraies options et
 * `enabled: false`. Jamais useSourcingProject depuis la barre : son canal temps
 * réel porte le même nom que celui de la page, et le démontage de la barre le
 * couperait.
 */
export function useOpenMissionProject(projectId: string | null) {
  const { user } = useAuthReady();
  return useQuery({
    ...sourcingProjectQueryOptions(projectId ?? '', user?.id ?? null),
    enabled: false,
  });
}

/**
 * Noms des missions, pour les lignes d'À traiter et d'Assistant qui portent un
 * project_id (§3.4). Observateur de la liste de l'organisation (même clé, donc
 * aucun appel si le cache est chaud), abonné au cache : il se met à jour seul.
 * La jointure d'équipe, si elle est en cache, apporte les noms des missions
 * partenaires ; elle n'est jamais lancée d'ici.
 */
export function useMissionNames(opts: { enabled: boolean }): (projectId: string | null | undefined) => string | null {
  const { user } = useAuthReady();
  const userId = user?.id ?? null;
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();
  const { projects, hasData } = useSourcingProjects('mission', { enabled: opts.enabled });

  const listNames = useMemo(() => {
    const names = new Map<string, string>();
    if (hasData) for (const p of projects) names.set(p.id, p.name);
    return names;
  }, [hasData, projects]);

  const team = queryClient.getQueryData<TeamRow[]>(missionTeamQueryKey(userId, organizationId));

  return useCallback(
    (projectId: string | null | undefined) => {
      if (!projectId) return null;
      const own = listNames.get(projectId);
      if (own) return own;
      const joined = team?.find((t) => t.sourcing_projects?.id === projectId)?.sourcing_projects;
      return joined?.name ?? null;
    },
    [listNames, team],
  );
}
