import { useEffect, useState } from 'react';

/** Heure courante (millisecondes), rafraîchie toutes les `intervalMs` tant que le composant est monté. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
