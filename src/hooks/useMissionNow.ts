// Refonte mission, lot 3 : assemble les sources de la carte « Maintenant » et de
// la colonne « Prochaine action », puis appelle la règle (src/lib/missionNextAction.ts).
//
// Chaque source arrive en trois états, jamais confondus avec un zéro :
// chargement, indisponible (erreur de lecture, ou hors ligne sans donnée), lue.
// - effectifs : get_mission_stage_counts (useMissionStageCounts) ;
// - attention : get_mission_attention (useMissionAttention) ;
// - LinkedIn : état strict de la personne (resolveMyLinkedInStatus), jamais le
//   compte d'un collègue ;
// - type d'organisation : chargement tant que l'organisation se lit, « absent »
//   seulement une fois lue ;
// - formule : état lu de get_subscription_state, jamais le plan par défaut
//   « gratuit » d'un état pas encore lu ;
// - reports : useMissionActionSnoozes ; interlocuteur : job_details.client.
// Aucune lecture ni écriture de la barre latérale : « Plus tard » n'agit jamais
// sur le chiffre d'À traiter.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useMemberLinkedInAccounts } from '@/hooks/useMemberLinkedInAccounts';
import { useMissionActionSnoozes } from '@/hooks/useMissionActionSnoozes';
import { useMissionAttentionDetail } from '@/hooks/useMissionAttention';
import { useMissionStageCounts, type MissionStageCounts } from '@/hooks/useMissionStageCounts';
import { useOrgManagerName } from '@/hooks/useOrgManagerName';
import { useOrganization } from '@/hooks/useOrganization';
import type { SourcingProject } from '@/hooks/useSourcingProjects';
import { useSubscriptionState } from '@/hooks/useSubscriptionState';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { hasPlanFeature } from '@/lib/featureGates';
import { resolveMyLinkedInStatus } from '@/lib/linkedinStatus';
import {
  SOURCE_LOADING,
  SOURCE_UNAVAILABLE,
  buildRowSignals,
  computeNowCard,
  linkedinSource,
  sourceOf,
  sourceOk,
  type MissionAttention,
  type NextAction,
  type NowCardResult,
  type OrgRole,
  type OrgType,
  type RowSignals,
  type SnoozeTest,
  type SourceState,
} from '@/lib/missionNextAction';
import { snoozeChecker } from '@/lib/missionSnooze';
import { useMediaQuery } from '@/components/missions/v3/shell/useMediaQuery';

/** Téléphone : sous le point de rupture sm de Tailwind. */
const PHONE_QUERY = '(max-width: 639px)';

const ROLES: readonly string[] = ['owner', 'admin', 'member', 'collaborator'];

/** La carte lit l'heure à la minute ; les lignes d'une liste, à cinq minutes (un jour entier est leur plus petite unité). */
const CARD_CLOCK_MS = 60_000;
const ROWS_CLOCK_MS = 5 * 60_000;

/**
 * Heure arrondie au pas donné, relue au retour de focus et à chaque pas : un
 * report échu fait revenir l'action, « hier » ne reste pas « hier » toute la
 * nuit. L'état ne change que d'un pas à l'autre (pas de rendu inutile).
 */
export function useClock(stepMs: number): number {
  const bucket = useCallback(() => Math.floor(Date.now() / stepMs) * stepMs, [stepMs]);
  const [now, setNow] = useState(bucket);
  useEffect(() => {
    const tick = () => setNow(bucket());
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    const timer = window.setInterval(tick, stepMs);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [bucket, stepMs]);
  return now;
}

/** Mission archivée : tout est « reporté », la colonne retombe sur son texte de repos (la carte, elle, est masquée). */
const ALL_PAUSED: SnoozeTest = () => true;

const clean = (v: string | null | undefined): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** Interlocuteur du client pour « Relancer » : nom et adresse de job_details.client.hiring_manager. */
function useInterlocutor(project: SourcingProject): { name: string | null; email: string | null } | null {
  const hiringManager = project.job_details?.client?.hiring_manager;
  const name = clean(hiringManager?.name);
  const email = clean(hiringManager?.email);
  return useMemo(() => (name || email ? { name, email } : null), [name, email]);
}

/**
 * Signaux de la colonne « Prochaine action » (liste, kanban, en-tête de la
 * fiche) : une seule construction par mission, partagée par toutes les lignes.
 * Sans lecture des signaux d'attention, aucune ligne n'est marquée « Répondre ».
 */
export function useMissionRowSignals(project: SourcingProject): RowSignals {
  const now = useClock(ROWS_CLOCK_MS);
  const attentionQuery = useMissionAttentionDetail(project.id);
  const snoozes = useMissionActionSnoozes();
  const { orgType } = useOrganization();
  const interlocutor = useInterlocutor(project);
  // Reports pas encore lus : aucune réponse n'est marquée, plutôt qu'un « Répondre » qui disparaîtrait.
  const attention = snoozes.isLoading ? null : (attentionQuery.data?.[project.id] ?? null);
  const archived = project.status === 'archived';
  const snoozed = useMemo(
    () => (archived ? ALL_PAUSED : snoozeChecker(snoozes.index, project.id, now)),
    [archived, snoozes.index, project.id, now],
  );
  return useMemo(
    () => buildRowSignals({ now, attention, snoozed, interlocutor, orgType }),
    [now, attention, snoozed, interlocutor, orgType],
  );
}

export interface MissionNow {
  result: NowCardResult;
  /** Écriture permise : « Plus tard » est grisé hors ligne, avec sa raison. */
  online: boolean;
  isPhone: boolean;
  /** Une écriture de report est en cours. */
  busy: boolean;
  /** Relit les sources en échec (« Réessayer »). */
  retry: () => void;
  /** Reporte l'action au lendemain matin ; vrai si le report est écrit. */
  snooze: (action: NextAction) => Promise<boolean>;
  /** Retire les reports qui masquent des actions de la mission (« Les reprendre »). */
  resume: (keys: readonly string[]) => Promise<boolean>;
}

export function useMissionNow({ project, isOwnMission }: { project: SourcingProject; isOwnMission: boolean }): MissionNow {
  const now = useClock(CARD_CLOCK_MS);
  const isPhone = useMediaQuery(PHONE_QUERY);
  const { user } = useAuthReady();
  const userId = user?.id ?? null;

  const countsQuery = useMissionStageCounts([project.id]);
  const attentionQuery = useMissionAttentionDetail(project.id);
  const snoozes = useMissionActionSnoozes();
  const online = snoozes.online;
  // Reports pas encore lus : la carte attend (comme la liste des missions). Une action déjà reportée
  // paraîtrait puis céderait la place à la suivante, sans annonce.
  const snoozesWaiting = snoozes.isLoading;

  // Effectifs : une mission que la base ne rend pas est une erreur, jamais des zéros.
  const countsRow = countsQuery.data?.[project.id] ?? null;
  const counts: SourceState<MissionStageCounts> = snoozesWaiting
    ? SOURCE_LOADING
    : sourceOf({
        data: countsRow,
        isError: countsQuery.isError || (countsQuery.isSuccess && countsRow === null),
        offline: !online,
      });
  const attentionRow = attentionQuery.data?.[project.id] ?? null;
  const attention: SourceState<MissionAttention> = snoozesWaiting
    ? SOURCE_LOADING
    : sourceOf({
        data: attentionRow,
        isError: attentionQuery.isError || (attentionQuery.isSuccess && attentionRow === null),
        offline: !online,
      });

  // Compte LinkedIn de la personne (liaison stricte par user_id).
  const { mappings, isReady: mappingsReady, isError: mappingsFailed, refetch: refetchMappings } = useMemberLinkedInAccounts();
  const { accounts, ready: accountsReady, loadError: accountsFailed, reload: reloadAccounts } = useLinkedInAccounts();
  const linkedinState = resolveMyLinkedInStatus({
    userId,
    mappings,
    mappingsLoaded: mappingsReady,
    mappingsFailed,
    accounts,
    accountsLoaded: accountsReady,
    accountsFailed,
  }).state;
  const linkedin = linkedinSource(linkedinState);

  // Type d'organisation : « absent » seulement une fois l'organisation lue.
  const { organization, orgType, userRole, isLoading: orgLoading, isError: orgError } = useOrganization();
  let orgTypeSource: SourceState<OrgType | null>;
  if (orgLoading) orgTypeSource = SOURCE_LOADING;
  else if (!organization) orgTypeSource = orgError ? SOURCE_UNAVAILABLE : SOURCE_LOADING;
  else orgTypeSource = sourceOk<OrgType | null>(orgType);
  const role: OrgRole | null = userRole && ROLES.includes(userRole) ? (userRole as OrgRole) : null;
  const { name: ownerName } = useOrgManagerName(orgTypeSource.state === 'ok' && orgTypeSource.value === null && role !== 'owner');

  // Formule : l'état lu de get_subscription_state. Sans ligne d'abonnement la
  // fonction rend NULL, que le serveur lit « gratuit » : une requête terminée
  // sans état vaut donc « envoi interdit », jamais un chargement sans fin.
  const subscription = useSubscriptionState();
  const settled = !subscription.isLoading && !subscription.isLoadingError && online;
  const sendAllowed = sourceOf({
    data: subscription.state
      ? hasPlanFeature(subscription.effectivePlanId, 'sequences_send')
      : settled && !!organization
        ? false
        : null,
    isError: subscription.isLoadingError,
    offline: !online,
  });

  const interlocutor = useInterlocutor(project);
  const snoozed = useMemo(() => snoozeChecker(snoozes.index, project.id, now), [snoozes.index, project.id, now]);

  const result = computeNowCard({
    now,
    mission: { id: project.id, name: project.name, status: project.status },
    rights: { ownMission: isOwnMission },
    role,
    ownerName,
    orgType: orgTypeSource,
    linkedin,
    sendAllowed,
    counts,
    attention,
    snoozed,
    interlocutor,
    isPhone,
  });

  const { refetch: refetchCounts } = countsQuery;
  const { refetch: refetchAttention } = attentionQuery;
  const { refetch: refetchSubscription } = subscription;
  const retry = useCallback(() => {
    void refetchCounts();
    void refetchAttention();
    void refetchMappings();
    void refetchSubscription();
    if (accountsFailed) void reloadAccounts();
  }, [refetchCounts, refetchAttention, refetchMappings, refetchSubscription, reloadAccounts, accountsFailed]);

  const { snooze: writeSnooze, unsnooze } = snoozes;
  const snooze = useCallback(
    (action: NextAction): Promise<boolean> =>
      action.snoozeKey === null ? Promise.resolve(false) : writeSnooze(project.id, action.snoozeKey),
    [writeSnooze, project.id],
  );
  const resume = useCallback(
    (keys: readonly string[]): Promise<boolean> => (keys.length === 0 ? Promise.resolve(false) : unsnooze(project.id, keys)),
    [unsnooze, project.id],
  );

  return { result, online, isPhone, busy: snoozes.isWriting, retry, snooze, resume };
}
