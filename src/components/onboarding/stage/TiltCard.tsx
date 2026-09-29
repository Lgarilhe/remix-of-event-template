import React from 'react';
import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion';
import { cn } from '@/lib/utils';
import { SPRING_SOFT } from './springs';

interface Props extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'> {
  /** Inclinaison maximale, en degrés. */
  tilt?: number;
  selected?: boolean;
  /** Vrai : la carte s'efface (les autres réponses quand l'une est choisie). */
  dimmed?: boolean;
}

/**
 * Carte tactile : elle s'incline vers le pointeur, une lueur suit le curseur
 * sur sa surface, et elle s'enfonce à l'appui. Sans souris (téléphone,
 * mouvement réduit), elle reste à plat.
 */
export const TiltCard = React.forwardRef<HTMLDivElement, Props>(function TiltCard(
  { tilt = 6, selected, dimmed, className, children, ...rest },
  ref,
) {
  const reduced = useReducedMotion();
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rotY = useSpring(useTransform(px, [0, 1], [-tilt, tilt]), { stiffness: 180, damping: 18 });
  const rotX = useSpring(useTransform(py, [0, 1], [tilt, -tilt]), { stiffness: 180, damping: 18 });
  const lx = useTransform(px, (v) => `${v * 100}%`);
  const ly = useTransform(py, (v) => `${v * 100}%`);
  const glow = useMotionTemplate`radial-gradient(260px circle at ${lx} ${ly}, hsl(var(--brand) / 0.16), transparent 62%)`;

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (reduced || e.pointerType === 'touch') return;
    const r = e.currentTarget.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width);
    py.set((e.clientY - r.top) / r.height);
  };
  const leave = () => {
    px.set(0.5);
    py.set(0.5);
  };

  return (
    <motion.div
      ref={ref}
      onPointerMove={move}
      onPointerLeave={leave}
      style={reduced ? undefined : { rotateX: rotX, rotateY: rotY, transformPerspective: 900 }}
      animate={{ opacity: dimmed ? 0.28 : 1, scale: dimmed ? 0.96 : 1 }}
      whileTap={reduced ? undefined : { scale: 0.975 }}
      transition={SPRING_SOFT}
      className={cn(
        'group relative overflow-hidden rounded-xl border bg-card transition-colors duration-200',
        selected ? 'border-brand' : 'border-border hover:border-border-strong',
        className,
      )}
      {...rest}
    >
      {!reduced && (
        <motion.span
          aria-hidden="true"
          style={{ background: glow }}
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        />
      )}
      {children}
    </motion.div>
  );
});
