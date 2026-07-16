export type OrgType = 'enterprise' | 'agency' | 'freelance';

export type SceneKey =
  | 'orgtype'
  | 'goal'
  | 'orgdetails'
  | 'stack'
  | 'discovery'
  | 'specializations'
  | 'icp'
  | 'org'
  | 'audit'
  | 'profile'
  | 'aitone'
  | 'integrations'
  | 'quotas'
  | 'team'
  | 'preparing'
  | 'launch';

export const FLOWS: Record<OrgType, SceneKey[]> = {
  enterprise: ['orgtype', 'goal', 'orgdetails', 'stack', 'discovery', 'specializations', 'icp', 'org', 'audit', 'profile', 'aitone', 'integrations', 'quotas', 'team', 'preparing', 'launch'],
  agency:     ['orgtype', 'goal', 'orgdetails', 'stack', 'discovery', 'specializations', 'icp', 'org', 'audit', 'profile', 'aitone', 'integrations', 'quotas', 'team', 'preparing', 'launch'],
  freelance:  ['orgtype', 'goal', 'orgdetails', 'stack', 'discovery', 'specializations', 'icp', 'profile', 'aitone', 'integrations', 'quotas', 'preparing', 'launch'],
};

export const DEFAULT_FLOW: SceneKey[] = FLOWS.enterprise;

export interface ChapterDef {
  id: string;
  title: string;
  tagline: string;
  scenes: SceneKey[];
}

export const CHAPTERS: ChapterDef[] = [
  {
    id: 'activity',
    title: 'Votre activité',
    tagline: 'Quelques questions pour adapter Konekt à votre métier.',
    scenes: ['orgtype', 'goal', 'orgdetails', 'stack', 'discovery', 'specializations', 'icp'],
  },
  {
    id: 'company',
    title: 'Votre société',
    tagline: 'On construit votre espace de travail automatiquement.',
    scenes: ['org', 'audit'],
  },
  {
    id: 'you',
    title: 'Votre profil',
    tagline: 'Vous êtes le visage de vos messages. Soignons-le.',
    scenes: ['profile', 'aitone'],
  },
  {
    id: 'tools',
    title: 'Vos outils',
    tagline: 'Connectez vos canaux et réglez votre rythme de prospection.',
    scenes: ['integrations', 'quotas'],
  },
  {
    id: 'team',
    title: 'Votre équipe',
    tagline: 'Invitez vos collègues, tout le monde avance ensemble.',
    scenes: ['team'],
  },
];

/** Durées estimées par étape (secondes) — affichage du temps restant. */
export const STEP_DURATIONS: Record<Exclude<SceneKey, 'launch'>, number> = {
  orgtype: 10,
  goal: 10,
  orgdetails: 20,
  stack: 15,
  discovery: 5,
  specializations: 20,
  icp: 30,
  org: 45,
  audit: 60,
  profile: 60,
  aitone: 40,
  integrations: 120,
  quotas: 20,
  team: 60,
  preparing: 8,
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

/** Index du chapitre contenant une scène (-1 si hors chapitre, ex. launch). */
export function chapterIndexOfScene(scene: SceneKey, chapters: ChapterDef[]): number {
  return chapters.findIndex((c) => c.scenes.includes(scene));
}
