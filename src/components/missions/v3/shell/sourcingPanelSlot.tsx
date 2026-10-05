// Refonte mission : la fiche d'un profil du Sourcing s'ouvre dans le même
// panneau de droite que celle du Pipeline (PanelHost : 440 px, sans voile, la
// liste reste visible). Le Sourcing n'est pas une ligne de mission : sa fiche
// n'est pas lue dans l'adresse. Il réserve le panneau (claim) puis y dépose sa
// fiche par un portail (React garde ainsi ses données à jour).
// Hors de la coquille (anciennes pages), le contexte est absent : la fiche
// garde sa fenêtre latérale d'origine.
import { useCallback, useId, useMemo, useState, type ReactNode } from 'react';
import { SourcingPanelSlotContext, type SourcingPanelSlotValue } from './sourcingPanelContext';

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
