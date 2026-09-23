/**
 * Premiers pas de la barre latérale (§7, D13). Module pur, sans import :
 * étapes par type d'organisation, clés de stockage local et évaluation des
 * coches à partir de signaux réels (useFirstSteps).
 *
 * Règle commune (D9) : tant qu'un signal requis est inconnu (null), le statut
 * est « loading » ; on ne coche ni ne décoche rien au hasard.
 */

export type FirstStepId =
  | 'create_mission'
  | 'create_job'
  | 'link_linkedin'
  | 'first_search'
  | 'invite_team'
  | 'invite_partner'
  | 'schedule_interview';

export type FirstStepsOrgType = 'enterprise' | 'agency' | 'freelance';

/** '1' : section masquée d'un clic (bouton « Masquer »). */
export const FIRST_STEPS_HIDDEN_KEY = (orgId: string, userId: string) =>
  `konekt:nav:first-steps-hidden:${orgId}:${userId}`;

/** '1' : toutes les étapes ont été faites au moins une fois ; la section n'est plus rendue ni lue. */
export const FIRST_STEPS_DONE_KEY = (orgId: string, userId: string) =>
  `konekt:nav:first-steps-done:${orgId}:${userId}`;

export const FIRST_STEPS: Record<FirstStepsOrgType, FirstStepId[]> = {
  enterprise: ['create_job', 'invite_partner', 'schedule_interview'],
  agency: ['create_mission', 'link_linkedin', 'first_search', 'invite_team'],
  freelance: ['create_mission', 'link_linkedin', 'first_search'],
};

export interface FirstStepSignals {
  /** Missions de l'organisation, tous statuts. */
  missionCount: number | null;
  /** Missions partenaires. */
  partnerMissionCount: number | null;
  linkedinLinked: boolean | null;
  searchWithResults: boolean | null;
  /** null aussi quand l'étape n'est pas montrée. */
  teamInvited: boolean | null;
  partnerInvitedOrPublished: boolean | null;
  interviewScheduled: boolean | null;
  /**
   * isAdmin && hasFeature(orgType, 'team_management') && hasPlanFeature(effectivePlanId, 'team') ;
   * null tant que l'état d'abonnement n'est pas reçu.
   */
  canInviteTeam: boolean | null;
}

export interface FirstStepItem {
  id: FirstStepId;
  done: boolean;
}

export interface FirstStepsEvaluation {
  status: 'loading' | 'ok';
  steps: FirstStepItem[];
  allDone: boolean;
}

const LOADING: FirstStepsEvaluation = { status: 'loading', steps: [], allDone: false };

/** Coche d'une étape retenue ; null si son signal est inconnu. */
function stepDone(id: FirstStepId, s: FirstStepSignals): boolean | null {
  switch (id) {
    case 'create_mission':
    case 'create_job':
      return s.missionCount === null ? null : s.missionCount > 0;
    case 'link_linkedin':
      return s.linkedinLinked;
    case 'first_search':
      return s.searchWithResults;
    case 'invite_team':
      return s.teamInvited;
    case 'invite_partner':
      return s.partnerInvitedOrPublished;
    case 'schedule_interview':
      return s.interviewScheduled;
  }
}

/**
 * Étapes retenues pour ce type d'organisation, avec leur coche.
 * - invite_team n'est retenue que si canInviteTeam === true (null → loading) ;
 * - create_mission et create_job sont retirées si l'organisation n'a aucune
 *   mission et travaille sur des missions partenaires (D13) ; le nombre de
 *   missions partenaires n'est requis que dans ce cas (missionCount === 0) ;
 * - allDone : toutes les étapes retenues sont cochées.
 */
export function evaluateFirstSteps(orgType: FirstStepsOrgType, s: FirstStepSignals): FirstStepsEvaluation {
  const ids = FIRST_STEPS[orgType];
  if (!ids) return LOADING;

  const retained: FirstStepId[] = [];
  for (const id of ids) {
    if (id === 'invite_team') {
      if (s.canInviteTeam === null) return LOADING;
      if (s.canInviteTeam !== true) continue;
    }
    if (id === 'create_mission' || id === 'create_job') {
      if (s.missionCount === null) return LOADING;
      if (s.missionCount === 0) {
        if (s.partnerMissionCount === null) return LOADING;
        if (s.partnerMissionCount > 0) continue;
      }
    }
    retained.push(id);
  }

  const steps: FirstStepItem[] = [];
  for (const id of retained) {
    const done = stepDone(id, s);
    if (done === null) return LOADING;
    steps.push({ id, done });
  }

  return { status: 'ok', steps, allDone: steps.every((step) => step.done) };
}
