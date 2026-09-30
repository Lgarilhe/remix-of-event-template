// Refonte mission, lots 1 et 2 : état de l'interrupteur de la nouvelle page
// mission, partagé par la mise en page, la barre latérale et l'entrée de la
// page (magasin de src/lib/missionBeta.ts). Rendu serveur : valeur par défaut.
import { useSyncExternalStore } from 'react';
import { MISSION_BETA_DEFAULT, getMissionBeta, subscribeMissionBeta } from '@/lib/missionBeta';

export function useMissionBeta(): boolean {
  return useSyncExternalStore(subscribeMissionBeta, getMissionBeta, () => MISSION_BETA_DEFAULT);
}
