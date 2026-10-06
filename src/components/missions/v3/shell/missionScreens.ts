// Refonte mission, lot 1 : noms des trois écrans et adresse d'un écran depuis
// l'adresse courante (onglets, goToScreen). Module pur.
import { MISSION_BETA_PARAM, V3_PARAM, missionV3Path, type CadrageSection, type MissionScreen } from '@/lib/missionBeta';

export const MISSION_SCREEN_LABEL: Readonly<Record<MissionScreen, string>> = {
  pipeline: 'Pipeline',
  sourcing: 'Sourcing',
  cadrage: 'Cadrage',
};

/** Paramètres qui ne valent que pour leur écran : retirés quand on change d'écran. */
const SCREEN_SCOPED_PARAMS: readonly string[] = [V3_PARAM.section, V3_PARAM.view, V3_PARAM.stage];

/**
 * Adresse d'un écran de la mission depuis l'adresse courante : panneau, fiche,
 * Bilan et paramètres étrangers gardés ; section, affichage et filtre d'étape
 * retirés ; section posée pour Cadrage seulement.
 */
export function missionScreenTarget(
  id: string,
  screen: MissionScreen,
  search: string,
  section?: CadrageSection | null,
): string {
  const params = new URLSearchParams(search);
  for (const name of SCREEN_SCOPED_PARAMS) params.delete(name);
  params.delete('tab');
  params.delete(MISSION_BETA_PARAM);
  if (screen === 'cadrage' && section) params.set(V3_PARAM.section, section);
  const query = params.toString();
  return `${missionV3Path(id, screen)}${query ? `?${query}` : ''}`;
}
