/**
 * Premiers pas (§7.2) : signaux réels des étapes, sans aucun appel au service
 * LinkedIn.
 *
 * Sources :
 * - missions de l'organisation et missions partenaires : useMyMissions (cache) ;
 * - liaison LinkedIn : useMemberLinkedInAccounts, déjà chargé par LinkedInAccountsContext ;
 * - équipe : useSubscriptionState (sièges) et useQuotaGate (invitations en attente) ;
 * - comptages sans lignes, dans une seule lecture : recherches avec résultats
 *   (cabinet, indépendant), invitations de mission et entretiens (entreprise).
 *
 * Les comptages ne tournent que si la section est visible (opts.enabled) : ni
 * masquée, ni finie. useQuotaGate lit ses propres clés à chaque appel : la
 * section ne monte ce hook que lorsqu'elle est visible.
 *
 * Ce fichier porte aussi le magasin des deux drapeaux locaux de la section
 * (masquée, finie), partagé par tous les lecteurs de la page.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { onlineManager, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useOrganization } from '@/hooks/useOrganization';
import { useSubscriptionState } from '@/hooks/useSubscriptionState';
import { useQuotaGate } from '@/hooks/useQuotaGate';
import { useSourcingProjects } from '@/hooks/useSourcingProjects';
import { useMemberLinkedInAccounts } from '@/hooks/useMemberLinkedInAccounts';
import { useMyMissions } from '@/hooks/sidebar/useMyMissions';
import { hasFeature, hasPlanFeature } from '@/lib/featureGates';
import { queryState, type SectionState } from '@/lib/sidebarSection';
import {
  evaluateFirstSteps,
  type FirstStepItem,
  type FirstStepSignals,
  type FirstStepsOrgType,
} from '@/lib/firstSteps';

// ─── Drapeaux locaux (masquée, finie), D36 ───────────────────────────────────

const flagCache = new Map<string, boolean>();
const flagListeners = new Set<() => void>();

function readFlag(key: string): boolean {
  const cached = flagCache.get(key);
  if (cached !== undefined) return cached;
  let value = false;
  try {
    value = window.localStorage.getItem(key) === '1';
  } catch {
    value = false;
  }
  flagCache.set(key, value);
  return value;
}

function notifyFlags() {
  flagListeners.forEach((listener) => listener());
}

function writeFlag(key: string) {
  try {
    window.localStorage.setItem(key, '1');
  } catch {
    // Stockage indisponible : le drapeau vaut pour cette session seulement.
  }
  flagCache.set(key, true);
  notifyFlags();
}

// Autres onglets du navigateur : l'événement storage ne se déclenche pas dans l'onglet qui écrit.
function onStorage(e: StorageEvent) {
  if (e.key === null) {
    flagCache.clear();
  } else if (flagCache.has(e.key)) {
    flagCache.set(e.key, e.newValue === '1');
  } else {
    return;
  }
  notifyFlags();
}

function subscribeFlags(listener: () => void) {
  flagListeners.add(listener);
  if (flagListeners.size === 1) window.addEventListener('storage', onStorage);
  return () => {
    flagListeners.delete(listener);
    if (flagListeners.size === 0) window.removeEventListener('storage', onStorage);
  };
}

/**
 * Drapeau local des premiers pas (FIRST_STEPS_HIDDEN_KEY ou FIRST_STEPS_DONE_KEY),
 * lu sous try/catch et partagé : une écriture met à jour tous les lecteurs.
 * Clé null (organisation ou utilisateur inconnus) : faux, écriture sans effet.
 */
export function useFirstStepsFlag(key: string | null): [boolean, () => void] {
  const value = useSyncExternalStore(
    subscribeFlags,
    () => (key ? readFlag(key) : false),
    () => false,
  );
  const set = useCallback(() => {
    if (key) writeFlag(key);
  }, [key]);
  return [value, set];
}

// ─── Signaux ─────────────────────────────────────────────────────────────────

const HUNT_PUBLISHED = new Set(['published', 'in_progress', 'filled']);

interface FirstStepCounts {
  /** Lignes sourcing_projects de l'organisation avec stats_total_found > 0 (cabinet, indépendant). */
  searches: number | null;
  /** Lignes mission_invitations de l'organisation (entreprise). */
  invitations: number | null;
  /** Lignes qualification_sessions de l'organisation (entreprise). */
  interviews: number | null;
}

async function fetchFirstStepCounts(organizationId: string, orgType: FirstStepsOrgType): Promise<FirstStepCounts> {
  if (orgType === 'enterprise') {
    // La policy de mission_invitations couvre toutes mes organisations : filtre explicite.
    const [invitations, interviews] = await Promise.all([
      supabase.from('mission_invitations').select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId),
      supabase.from('qualification_sessions').select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId),
    ]);
    if (invitations.error) throw invitations.error;
    if (interviews.error) throw interviews.error;
    return { searches: null, invitations: invitations.count ?? 0, interviews: interviews.count ?? 0 };
  }
  // Tous kind confondus : une recherche hors mission compte aussi.
  const [searches] = await Promise.all([
    supabase.from('sourcing_projects').select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId).gt('stats_total_found', 0),
  ]);
  if (searches.error) throw searches.error;
  return { searches: searches.count ?? 0, invitations: null, interviews: null };
}

/**
 * État d'une clé lue par un autre hook (ici les invitations de useQuotaGate),
 * sans en relancer la lecture : abonné au cache, pour ne pas rester en
 * chargement sans fin sur une erreur ou hors ligne.
 */
function useCachedQueryState(queryKey: readonly unknown[]): SectionState {
  const queryClient = useQueryClient();
  const subscribe = useCallback(
    (listener: () => void) => queryClient.getQueryCache().subscribe(listener),
    [queryClient],
  );
  const getSnapshot = (): SectionState => {
    const s = queryClient.getQueryState(queryKey);
    if (!s) return onlineManager.isOnline() ? 'loading' : 'offline';
    return queryState({ data: s.data, isError: s.status === 'error', fetchStatus: s.fetchStatus }).state;
  };
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

const subscribeOnline = (listener: () => void) => onlineManager.subscribe(() => listener());
const getOnline = () => onlineManager.isOnline();
const getServerOnline = () => true;

function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, getOnline, getServerOnline);
}

export interface FirstStepsView {
  status: SectionState;
  stale: boolean;
  retry: () => void;
  steps: FirstStepItem[];
  allDone: boolean;
  /** Mission de l'organisation vers laquelle mènent « première recherche » et « inviter un cabinet ». */
  firstOwnMissionId: string | null;
  /** Vrai tant que le plafond de missions n'est pas connu (useQuotaGate). */
  canCreateJob: boolean;
}

interface PendingSource {
  pending: boolean;
  state: SectionState;
}

/** Une source attendue en erreur l'emporte, puis hors ligne, sinon chargement. */
function pendingStatus(sources: PendingSource[]): SectionState {
  const waiting = sources.filter((s) => s.pending);
  if (waiting.some((s) => s.state === 'error')) return 'error';
  if (waiting.some((s) => s.state === 'offline')) return 'offline';
  return 'loading';
}

export function useFirstSteps(opts: { enabled: boolean }): FirstStepsView {
  const { enabled } = opts;
  const { organizationId, orgType, isAdmin } = useOrganization();
  const { user } = useAuthReady();
  const userId = user?.id ?? null;
  const online = useOnline();

  const isEnterprise = orgType === 'enterprise';
  const teamFeature = hasFeature(orgType, 'team_management');

  // Missions de l'organisation (tous statuts) et missions partenaires.
  const missions = useMyMissions({ enabled });

  // Liaison LinkedIn : liste des liaisons en base, déjà chargée par le contexte.
  const links = useMemberLinkedInAccounts();

  // Équipe : sièges (état d'abonnement) et invitations en attente (useQuotaGate).
  const subscription = useSubscriptionState();
  const quota = useQuotaGate();
  const invitationsState = useCachedQueryState(['quota-pending-invitations', organizationId]);

  // Entreprise : une mission publiée coche « inviter un cabinet ou publier ».
  const orgMissions = useSourcingProjects('mission', { enabled: enabled && isEnterprise });

  const counts = useQuery({
    queryKey: ['sidebar', 'first-steps', organizationId, orgType],
    queryFn: () => {
      if (!organizationId || !orgType) throw new Error('Organisation inconnue');
      return fetchFirstStepCounts(organizationId, orgType);
    },
    enabled: enabled && !!organizationId && !!orgType,
    staleTime: 60_000,
    retry: 1,
    refetchInterval: 5 * 60_000,
  });
  const countsState = queryState({ data: counts.data, isError: counts.isError, fetchStatus: counts.fetchStatus });

  // ── Signaux ──
  const missionCount = missions.ownOrgMissionCount;
  const partnerMissionCount = missions.partnerMissionCount;

  const linkedinLinked = links.isReady && userId
    ? links.mappings.some((m) => m.user_id === userId)
    : null;

  const searchWithResults = counts.data?.searches == null ? null : counts.data.searches > 0;
  const interviewScheduled = counts.data?.interviews == null ? null : counts.data.interviews > 0;

  const huntPublished = orgMissions.hasData
    ? orgMissions.projects.some((p) => HUNT_PUBLISHED.has(p.hunt_status ?? ''))
    : null;
  const invitationCount = counts.data?.invitations ?? null;
  const partnerInvitedOrPublished =
    invitationCount !== null && invitationCount > 0
      ? true
      : huntPublished === true
        ? true
        : invitationCount === null || huntPublished === null
          ? null
          : false;

  // Sans droit d'équipe (type d'organisation ou rôle), l'étape n'existe pas :
  // inutile d'attendre l'abonnement. Sinon, le plan effectif ne vaut qu'une fois l'état reçu.
  const canInviteTeam: boolean | null = !teamFeature || !isAdmin
    ? false
    : subscription.state === null
      ? null
      : hasPlanFeature(subscription.effectivePlanId, 'team');

  // seatCount vaut 0 tant que l'état est inconnu : jamais lu avant réception (state === null → null).
  let teamInvited: boolean | null = null;
  if (canInviteTeam === true && subscription.state !== null) {
    if (subscription.seatCount > 1) teamInvited = true;
    else if (quota.pendingInvitationsLoaded) teamInvited = quota.pendingInvitations > 0;
  }

  const signals: FirstStepSignals = {
    missionCount,
    partnerMissionCount,
    linkedinLinked,
    searchWithResults,
    teamInvited,
    partnerInvitedOrPublished,
    interviewScheduled,
    canInviteTeam,
  };

  const evaluation = orgType ? evaluateFirstSteps(orgType, signals) : null;

  // ── État de la section ──
  const waitState = (isError: boolean): SectionState => (isError ? 'error' : online ? 'loading' : 'offline');

  let status: SectionState;
  let stale = false;
  if (evaluation && evaluation.status === 'ok') {
    status = 'ok';
    stale = missions.stale || countsState.stale;
  } else if (!orgType || !organizationId || !userId) {
    status = 'loading';
  } else {
    status = pendingStatus([
      {
        pending: missionCount === null || (missionCount === 0 && partnerMissionCount === null),
        state: missions.status === 'ok' ? waitState(false) : missions.status,
      },
      { pending: !isEnterprise && linkedinLinked === null, state: waitState(links.isError) },
      {
        pending: isEnterprise ? invitationCount === null || interviewScheduled === null : searchWithResults === null,
        state: countsState.state === 'ok' ? waitState(false) : countsState.state,
      },
      {
        pending: isEnterprise && huntPublished === null && invitationCount === 0,
        state: waitState(orgMissions.isError),
      },
      {
        pending: teamFeature && isAdmin && subscription.state === null,
        state: waitState(subscription.isLoadingError),
      },
      {
        pending: canInviteTeam === true && teamInvited === null && subscription.state !== null,
        state: invitationsState === 'ok' ? waitState(false) : invitationsState,
      },
    ]);
  }

  const queryClient = useQueryClient();
  const retry = () => {
    const ignore = () => undefined;
    if (missions.status === 'error' || missions.stale) missions.retry();
    if (links.isError) links.refetch().catch(ignore);
    if (counts.isError) counts.refetch().catch(ignore);
    if (orgMissions.isError) orgMissions.refetch().catch(ignore);
    if (subscription.isLoadingError) subscription.refetch().catch(ignore);
    if (invitationsState === 'error') {
      queryClient.invalidateQueries({ queryKey: ['quota-pending-invitations', organizationId] }).catch(ignore);
    }
  };

  return {
    status,
    stale,
    retry,
    steps: evaluation?.status === 'ok' ? evaluation.steps : [],
    allDone: evaluation?.status === 'ok' ? evaluation.allDone : false,
    firstOwnMissionId: missions.firstOwnMissionId,
    canCreateJob: quota.canCreateJob,
  };
}
