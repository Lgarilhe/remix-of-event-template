// Refonte mission, lots 1 et 2 : contexte de la nouvelle page mission.
// Fourni par MissionWorkspaceV3 (piste coquille), lu par les écrans et les
// panneaux (pistes pipeline et panneaux). Forme : MissionV3ContextValue (types.ts).
import { createContext, useContext } from 'react';
import type { MissionV3ContextValue } from './types';

export const MissionV3Context = createContext<MissionV3ContextValue | null>(null);

/** Contexte de la mission ouverte ; lève hors de MissionWorkspaceV3 (erreur de montage). */
export function useMissionV3(): MissionV3ContextValue {
  const value = useContext(MissionV3Context);
  if (!value) throw new Error('useMissionV3 : composant monté hors de MissionWorkspaceV3');
  return value;
}
