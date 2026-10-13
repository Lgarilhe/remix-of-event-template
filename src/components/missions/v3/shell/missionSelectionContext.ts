// Contexte de la sélection du Pipeline (voir missionSelection.tsx). Contexte à
// part : la valeur de MissionV3Context a 19 abonnés, qui se re-rendraient à
// chaque case cochée.
import { createContext, useContext, type Dispatch, type SetStateAction } from 'react';
import type { MissionCandidateRow } from '../types';

export interface MissionSelectionValue {
  /** Lignes cochées, par identifiant de ligne canonique, dans l'ordre du cochage. */
  selection: ReadonlyMap<string, MissionCandidateRow>;
  setSelection: Dispatch<SetStateAction<Map<string, MissionCandidateRow>>>;
}

export const MissionSelectionContext = createContext<MissionSelectionValue | null>(null);

/** Sélection de la mission ouverte ; lève hors de la coquille de la nouvelle page (erreur de montage). */
export function useMissionSelection(): MissionSelectionValue {
  const value = useContext(MissionSelectionContext);
  if (!value) throw new Error('useMissionSelection : composant monté hors de la coquille de la mission');
  return value;
}
