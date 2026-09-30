import { useReducedMotion } from 'framer-motion';

/** Retards d'entrée : nuls avec le mouvement réduit, où rien ne doit attendre son tour. */
export function useDelay(): (seconds: number) => number {
  const reduced = useReducedMotion();
  return (seconds) => (reduced ? 0 : seconds);
}
