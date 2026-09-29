/** Ressorts et courbes communs : une même physique pour tout le tunnel. */
export const SPRING_SOFT = { type: 'spring', stiffness: 170, damping: 22, mass: 0.9 } as const;
export const SPRING_SNAP = { type: 'spring', stiffness: 420, damping: 30 } as const;
export const SPRING_DROP = { type: 'spring', stiffness: 210, damping: 13, mass: 1 } as const;
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
