export type OrgType = 'enterprise' | 'agency' | 'freelance';

export type SceneKey =
  | 'welcome'
  | 'orgtype'
  | 'org'
  | 'orgdetails'
  | 'specializations'
  | 'linkedin'
  | 'launch';

/**
 * Un seul parcours, de même longueur pour tous : accueil → type → société (ou
 * nom de l'activité pour un indépendant) → équipe et volume → secteurs →
 * LinkedIn → fin. La longueur ne dépend pas du type choisi : la barre de
 * progression ne saute pas après le premier choix.
 */
const FULL_FLOW: SceneKey[] = ['welcome', 'orgtype', 'org', 'orgdetails', 'specializations', 'linkedin', 'launch'];

export const FLOWS: Record<OrgType, SceneKey[]> = {
  enterprise: FULL_FLOW,
  agency: FULL_FLOW,
  freelance: FULL_FLOW,
};

export const DEFAULT_FLOW: SceneKey[] = FULL_FLOW;

export interface ChapterDef {
  id: string;
  title: string;
  scenes: SceneKey[];
}

export const CHAPTERS: ChapterDef[] = [
  {
    id: 'profile',
    title: 'Votre profil',
    scenes: ['orgtype', 'org'],
  },
  {
    id: 'activity',
    title: 'Votre activité',
    scenes: ['orgdetails', 'specializations'],
  },
  {
    id: 'tools',
    title: 'Votre LinkedIn',
    scenes: ['linkedin'],
  },
];

/** Durées estimées par étape (secondes) : affichage du temps restant. */
export const STEP_DURATIONS: Record<Exclude<SceneKey, 'launch'>, number> = {
  welcome: 10,
  orgtype: 10,
  org: 40,
  orgdetails: 20,
  specializations: 20,
  linkedin: 60,
};

/** Temps restant estimé (en secondes) à partir d'un index d'étape. */
export function remainingSeconds(flow: SceneKey[], stepIndex: number): number {
  return flow
    .slice(stepIndex)
    .filter((s): s is Exclude<SceneKey, 'launch'> => s !== 'launch')
    .reduce((sum, s) => sum + STEP_DURATIONS[s], 0);
}

/** Chapitres présents dans un flow donné (scènes filtrées, chapitres vides retirés). */
export function chaptersForFlow(flow: SceneKey[]): ChapterDef[] {
  return CHAPTERS
    .map((c) => ({ ...c, scenes: c.scenes.filter((s) => flow.includes(s)) }))
    .filter((c) => c.scenes.length > 0);
}
