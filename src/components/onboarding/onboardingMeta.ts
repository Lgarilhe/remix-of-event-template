export type OrgType = 'enterprise' | 'agency' | 'freelance';

export type SceneKey =
  | 'orgtype'
  | 'orgdetails'
  | 'specializations'
  | 'org'
  | 'linkedin'
  | 'launch';

/**
 * Tunnel réduit au strict nécessaire pour utiliser l'app : type d'organisation
 * → organisation (entreprise / cabinet) ou détails + spécialisations (freelance,
 * qui crée l'organisation en silence) → connexion LinkedIn → fin.
 */
export const FLOWS: Record<OrgType, SceneKey[]> = {
  enterprise: ['orgtype', 'org', 'linkedin', 'launch'],
  agency:     ['orgtype', 'org', 'linkedin', 'launch'],
  freelance:  ['orgtype', 'orgdetails', 'specializations', 'linkedin', 'launch'],
};

export const DEFAULT_FLOW: SceneKey[] = FLOWS.enterprise;

export interface ChapterDef {
  id: string;
  title: string;
  scenes: SceneKey[];
}

export const CHAPTERS: ChapterDef[] = [
  {
    id: 'activity',
    title: 'Votre activité',
    scenes: ['orgtype', 'orgdetails', 'specializations'],
  },
  {
    id: 'company',
    title: 'Votre société',
    scenes: ['org'],
  },
  {
    id: 'tools',
    title: 'Votre LinkedIn',
    scenes: ['linkedin'],
  },
];

/** Durées estimées par étape (secondes) — affichage du temps restant. */
export const STEP_DURATIONS: Record<Exclude<SceneKey, 'launch'>, number> = {
  orgtype: 10,
  orgdetails: 20,
  specializations: 20,
  org: 45,
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
