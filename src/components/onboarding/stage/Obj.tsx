import React, { useMemo } from 'react';
import { motion, useReducedMotion, useTransform } from 'framer-motion';
import { SPRING_DROP } from './springs';
import { usePointerField } from './pointer';

export type ObjectEnter = 'drop' | 'left' | 'right' | 'rise' | 'pop' | 'none';

interface ObjProps {
  /** Multiplicateur de parallaxe : plus il est grand, plus l'objet est « proche ». */
  depth?: number;
  /** Retard d'entrée, en secondes. */
  delay?: number;
  enter?: ObjectEnter;
  /** Inclinaison de repos, en degrés. */
  rotate?: number;
  /** Amplitude du flottement, en pixels (0 = immobile). */
  float?: number;
  className?: string;
  children: React.ReactNode;
}

const ENTER_FROM: Record<ObjectEnter, { opacity: number; x?: number; y?: number; scale?: number; rotate?: number }> = {
  drop: { opacity: 0, y: -170, rotate: -14, scale: 0.9 },
  left: { opacity: 0, x: -150, rotate: -8 },
  right: { opacity: 0, x: 150, rotate: 8 },
  rise: { opacity: 0, y: 90, scale: 0.94 },
  pop: { opacity: 0, scale: 0.4, rotate: -6 },
  none: { opacity: 1 },
};

/**
 * Un objet posé sur le plateau : il entre avec une vraie physique (chute,
 * rebond), flotte lentement, et se déplace avec le pointeur selon sa
 * profondeur.
 */
export const Obj: React.FC<ObjProps> = ({ depth = 1, delay = 0, enter = 'drop', rotate = 0, float = 6, className, children }) => {
  const reduced = useReducedMotion();
  const { mx, my } = usePointerField();
  const px = useTransform(mx, (v) => v * 14 * depth);
  const py = useTransform(my, (v) => v * 9 * depth);
  const pr = useTransform(mx, (v) => v * 1.4 * depth);
  const floatDuration = useMemo(() => 4.2 + Math.random() * 2.2, []);

  return (
    <motion.div style={reduced ? undefined : { x: px, y: py, rotate: pr }} className={className}>
      <motion.div
        initial={reduced ? false : ENTER_FROM[enter]}
        animate={{ opacity: 1, x: 0, y: 0, scale: 1, rotate }}
        transition={{ ...SPRING_DROP, delay, opacity: { duration: 0.25, delay } }}
      >
        <motion.div
          animate={reduced || float === 0 ? undefined : { y: [0, -float, 0] }}
          transition={{ duration: floatDuration, repeat: Infinity, ease: 'easeInOut', delay: delay + 0.6 }}
        >
          {children}
        </motion.div>
      </motion.div>
    </motion.div>
  );
};
