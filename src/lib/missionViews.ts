/**
 * Phases et vues d'une mission (§3.2, D11). Module pur, sans import.
 *
 * Source unique des libellés et de l'ordre, partagée par la page mission
 * (MissionWorkspaceV2, PhaseStepper) et la barre latérale : une vue porte le
 * même nom partout, et un renommage se fait ici, le même jour pour tous.
 */

export type MissionViewId =
  | 'overview'
  | 'brief'
  | 'process'
  | 'config'
  | 'sourcing'
  | 'outreach'
  | 'pipeline'
  | 'insights';

export type MissionPhaseId = 1 | 2 | 3;

export interface MissionPhase {
  id: MissionPhaseId;
  label: string;
  desc: string;
  views: ReadonlyArray<{ id: MissionViewId; label: string }>;
}

export const MISSION_PHASES: ReadonlyArray<MissionPhase> = [
  {
    id: 1,
    label: 'Cadrage',
    desc: 'Brief & process',
    views: [
      { id: 'overview', label: "Vue d'ensemble" },
      { id: 'brief', label: 'Brief' },
      { id: 'process', label: 'Process' },
      { id: 'config', label: 'Configuration' },
    ],
  },
  {
    id: 2,
    label: 'Sourcing & Outreach',
    desc: 'Recherche & contact',
    views: [
      { id: 'sourcing', label: 'Sourcing' },
      { id: 'outreach', label: 'Outreach' },
    ],
  },
  {
    id: 3,
    label: 'Pipeline',
    desc: 'Entretiens & embauche',
    views: [
      { id: 'pipeline', label: 'Pipeline' },
      { id: 'insights', label: 'Insights' },
    ],
  },
];

/** Les 8 vues, aplaties dans l'ordre des phases. */
export const MISSION_VIEW_IDS: readonly MissionViewId[] = MISSION_PHASES.flatMap((phase) =>
  phase.views.map((view) => view.id),
);

/** Phase de chaque vue. */
export const VIEW_TO_PHASE: Readonly<Record<MissionViewId, MissionPhaseId>> = Object.fromEntries(
  MISSION_PHASES.flatMap((phase) => phase.views.map((view) => [view.id, phase.id])),
) as Record<MissionViewId, MissionPhaseId>;

/**
 * Vue lue dans `?tab=`, avec la règle de la page : une valeur absente ou
 * inconnue donne la Vue d'ensemble.
 */
export function parseMissionView(raw: string | null | undefined): MissionViewId {
  if (!raw) return 'overview';
  return (MISSION_VIEW_IDS as readonly string[]).includes(raw) ? (raw as MissionViewId) : 'overview';
}
