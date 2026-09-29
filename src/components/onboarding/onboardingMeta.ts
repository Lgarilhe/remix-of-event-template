export type OrgType = 'enterprise' | 'agency' | 'freelance';

export type SceneKey =
  | 'hello'
  | 'profile'
  | 'structure'
  | 'role'
  | 'brief'
  | 'linkedin'
  | 'candidates'
  | 'message'
  | 'finale';

/** Les cinq actes du fil, du haut de l'écran : chacun regroupe une ou deux scènes. */
export interface ActDef {
  id: string;
  label: string;
  scenes: SceneKey[];
}

export const ACTS: ActDef[] = [
  { id: 'you', label: 'Vous', scenes: ['hello', 'profile'] },
  { id: 'space', label: 'Votre espace', scenes: ['structure'] },
  { id: 'role', label: 'Votre poste', scenes: ['role', 'brief'] },
  { id: 'linkedin', label: 'LinkedIn', scenes: ['linkedin'] },
  { id: 'results', label: 'Premiers résultats', scenes: ['candidates', 'message'] },
];

const FULL_FLOW: SceneKey[] = ['hello', 'profile', 'structure', 'role', 'brief', 'linkedin', 'candidates', 'message', 'finale'];

/**
 * Le parcours. Sans LinkedIn relié, il n'y a rien à chercher : la recherche et
 * le message sont retirés et le parcours passe de LinkedIn à la fin.
 */
export function buildFlow(opts: { linkedinSkipped: boolean }): SceneKey[] {
  return opts.linkedinSkipped ? FULL_FLOW.filter((s) => s !== 'candidates' && s !== 'message') : FULL_FLOW;
}

/** Index de l'acte d'une scène ; la fin dépasse le dernier acte (tous cochés). */
export function actIndexOf(scene: SceneKey): number {
  if (scene === 'finale') return ACTS.length;
  return Math.max(0, ACTS.findIndex((a) => a.scenes.includes(scene)));
}

/** Avancement de 0 à 100 dans le parcours en cours. */
export function progressOf(flow: SceneKey[], scene: SceneKey): number {
  const i = flow.indexOf(scene);
  if (i < 0) return 0;
  return Math.round(((i + 1) / flow.length) * 100);
}

/** Durées estimées par scène (secondes), pour annoncer le temps du parcours. */
export const STEP_DURATIONS: Record<Exclude<SceneKey, 'finale'>, number> = {
  hello: 10,
  profile: 8,
  structure: 25,
  role: 25,
  brief: 50,
  linkedin: 50,
  candidates: 30,
  message: 25,
};

export function remainingMinutes(flow: SceneKey[], from: SceneKey): number {
  const seconds = flow
    .slice(Math.max(0, flow.indexOf(from)))
    .filter((s): s is Exclude<SceneKey, 'finale'> => s !== 'finale')
    .reduce((sum, s) => sum + STEP_DURATIONS[s], 0);
  return Math.max(1, Math.ceil(seconds / 60));
}

export const ORG_TYPE_LABEL: Record<OrgType, string> = {
  enterprise: 'Entreprise',
  agency: 'Cabinet',
  freelance: 'Indépendant',
};
