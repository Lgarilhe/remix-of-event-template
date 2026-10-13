// Refonte mission, lot 5f-2c : la sélection du Pipeline vit au-dessus de
// l'écran et du panneau. Le panneau Contacter lit les candidats cochés dans la
// liste, et la sélection survit au changement d'écran tant qu'il est ouvert.
//
// Le fournisseur reçoit ses enfants en prop : cocher une case ne re-rend que
// les composants qui lisent la sélection, pas toute la coquille. Il est monté
// dans MissionShell, donc remonté à chaque mission (key de MissionWorkspaceV3).
import { useMemo, useState, type ReactNode } from 'react';
import type { MissionCandidateRow } from '../types';
import { MissionSelectionContext, type MissionSelectionValue } from './missionSelectionContext';

export function MissionSelectionProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<Map<string, MissionCandidateRow>>(() => new Map());
  const value = useMemo<MissionSelectionValue>(() => ({ selection, setSelection }), [selection]);
  return <MissionSelectionContext.Provider value={value}>{children}</MissionSelectionContext.Provider>;
}
