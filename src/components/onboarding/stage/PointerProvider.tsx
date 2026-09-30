import React, { useEffect, useMemo } from 'react';
import { useMotionValue, useReducedMotion, useSpring } from 'framer-motion';
import { PointerContext } from './pointer';

/** Suit la souris sur toute la fenêtre. Sans mouvement (téléphone, mouvement réduit), le champ reste au centre. */
export const PointerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const reduced = useReducedMotion();
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const mx = useSpring(rawX, { stiffness: 60, damping: 18, mass: 0.6 });
  const my = useSpring(rawY, { stiffness: 60, damping: 18, mass: 0.6 });

  useEffect(() => {
    if (reduced) return;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      rawX.set((e.clientX / window.innerWidth) * 2 - 1);
      rawY.set((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [reduced, rawX, rawY]);

  const value = useMemo(() => ({ mx, my }), [mx, my]);
  return <PointerContext.Provider value={value}>{children}</PointerContext.Provider>;
};
