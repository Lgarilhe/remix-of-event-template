// Refonte mission : la fiche d'un profil du Sourcing s'ouvre dans le même
// panneau de droite que celle du Pipeline (PanelHost : 440 px, sans voile, la
// liste reste visible). Le Sourcing n'est pas une ligne de mission : sa fiche
// n'est pas lue dans l'adresse. Il réserve le panneau (claim) puis y dépose sa
// fiche par un portail (React garde ainsi ses données à jour).
// Hors de la coquille (anciennes pages), le contexte est absent : la fiche
// garde sa fenêtre latérale d'origine.
import { createContext, useCallback, useContext, useId, useMemo, useState, type ReactNode } from 'react';

interface SourcingPanelSlotValue {
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

const SourcingPanelSlotContext = createContext<SourcingPanelSlotValue | null>(null);

export function SourcingPanelSlotProvider({ children }: { children: ReactNode }) {
  const titleId = useId();
  const [onClose, setOnClose] = useState<(() => void) | null>(null);
  const [element, setElement] = useState<HTMLElement | null>(null);

  const claim = useCallback((close: () => void) => {
    setOnClose(() => close);
    return () => {
      setOnClose(null);
      setElement(null);
    };
  }, []);

  const value = useMemo<SourcingPanelSlotValue>(
    () => ({ titleId, open: onClose !== null, onClose, element, setElement, claim }),
    [titleId, onClose, element, claim],
  );
  return <SourcingPanelSlotContext.Provider value={value}>{children}</SourcingPanelSlotContext.Provider>;
}

/** null hors de la coquille de la nouvelle page mission. */
export function useSourcingPanelSlot(): SourcingPanelSlotValue | null {
  return useContext(SourcingPanelSlotContext);
}
