// Contexte du panneau de fiche du Sourcing (voir sourcingPanelSlot.tsx).
import { createContext, useContext } from 'react';

export interface SourcingPanelSlotValue {
  /** Identifiant du titre de la fiche (focus et nom accessible du panneau). */
  titleId: string;
  /** Une fiche du Sourcing est ouverte. */
  open: boolean;
  /** Ferme la fiche (Échap, croix). */
  onClose: (() => void) | null;
  /** Conteneur du panneau, présent une fois le panneau affiché. */
  element: HTMLElement | null;
  setElement: (element: HTMLElement | null) => void;
  /** Réserve le panneau ; rend la fonction qui le libère. */
  claim: (onClose: () => void) => () => void;
}

export const SourcingPanelSlotContext = createContext<SourcingPanelSlotValue | null>(null);

/** null hors de la coquille de la nouvelle page mission. */
export function useSourcingPanelSlot(): SourcingPanelSlotValue | null {
  return useContext(SourcingPanelSlotContext);
}
