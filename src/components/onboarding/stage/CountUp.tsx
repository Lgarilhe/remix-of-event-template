import React, { useEffect, useRef, useState } from 'react';
import { animate, useInView, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { EASE_OUT } from './springs';

/** Nombre qui monte jusqu'à sa valeur quand il entre à l'écran. */
export const CountUp: React.FC<{ value: number; className?: string; duration?: number; suffix?: string }> = ({
  value,
  className,
  duration = 1.4,
  suffix = '',
}) => {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const [display, setDisplay] = useState(reduced ? value : 0);

  useEffect(() => {
    if (!inView) return;
    if (reduced) {
      setDisplay(value);
      return;
    }
    const controls = animate(0, value, { duration, ease: EASE_OUT, onUpdate: setDisplay });
    return () => controls.stop();
  }, [inView, value, duration, reduced]);

  return (
    <span ref={ref} className={cn('tabular-nums', className)}>
      {Math.round(display).toLocaleString('fr-FR')}
      {suffix}
    </span>
  );
};
