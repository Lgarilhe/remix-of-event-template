/**
 * useCountUp — hook qui anime un nombre de 0 (ou valeur précédente) jusqu'à
 * une cible avec easing. Léger (raf-based), sans dépendance externe.
 *
 * Usage :
 *   const display = useCountUp(123, { duration: 800 });
 *   <span>{display}</span>
 *
 * On respecte `prefers-reduced-motion` : si l'user a désactivé les animations,
 * on saute directement à la valeur cible (UX accessibilité).
 */

import { useEffect, useRef, useState } from 'react';

export interface UseCountUpOptions {
  /** Durée totale en ms. Default: 800. */
  duration?: number;
  /** Si true, ne s'anime qu'à la première render (re-runs ignorés). */
  runOnce?: boolean;
  /** Décimales à afficher. Default 0. */
  decimals?: number;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

const prefersReducedMotion = (): boolean => {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
};

export function useCountUp(target: number, options: UseCountUpOptions = {}): number {
  const { duration = 800, runOnce = false, decimals = 0 } = options;
  const [value, setValue] = useState(target);
  const previousTargetRef = useRef(target);
  const ranOnceRef = useRef(false);

  useEffect(() => {
    // First mount: animate from 0 → target unless runOnce already fired.
    // Subsequent updates: animate from previous value → new target.
    if (runOnce && ranOnceRef.current) {
      setValue(target);
      previousTargetRef.current = target;
      return;
    }

    if (prefersReducedMotion()) {
      setValue(target);
      previousTargetRef.current = target;
      ranOnceRef.current = true;
      return;
    }

    const start = previousTargetRef.current;
    const delta = target - start;
    if (Math.abs(delta) < 0.01) {
      setValue(target);
      return;
    }

    const startTime = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeOutCubic(progress);
      const current = start + delta * eased;
      const factor = Math.pow(10, decimals);
      setValue(Math.round(current * factor) / factor);

      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        setValue(target);
        previousTargetRef.current = target;
        ranOnceRef.current = true;
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, runOnce, decimals]);

  return value;
}
