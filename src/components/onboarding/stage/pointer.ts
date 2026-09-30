import { createContext, useContext } from 'react';
import { motionValue, type MotionValue } from 'framer-motion';

/** Position du pointeur sur la fenêtre, lissée, de -1 (gauche, haut) à 1 (droite, bas). */
export interface PointerField {
  mx: MotionValue<number>;
  my: MotionValue<number>;
}

/** Champ immobile au centre : ce que lit un objet posé hors du plateau (tests, aperçus isolés). */
const IDLE_FIELD: PointerField = { mx: motionValue(0), my: motionValue(0) };

export const PointerContext = createContext<PointerField>(IDLE_FIELD);

export function usePointerField(): PointerField {
  return useContext(PointerContext);
}
