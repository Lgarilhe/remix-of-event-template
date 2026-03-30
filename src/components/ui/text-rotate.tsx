import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

interface TextRotateProps {
  texts: string[];
  interval?: number;
  className?: string;
  rotationType?: 'slide' | 'flip' | 'blur';
}

const variants = {
  slide: {
    enter: (dir: number) => ({ y: dir > 0 ? 30 : -30, opacity: 0, filter: 'blur(4px)' }),
    center: { y: 0, opacity: 1, filter: 'blur(0px)' },
    exit: (dir: number) => ({ y: dir > 0 ? -30 : 30, opacity: 0, filter: 'blur(4px)' }),
  },
  flip: {
    enter: () => ({ rotateX: -90, opacity: 0 }),
    center: { rotateX: 0, opacity: 1 },
    exit: () => ({ rotateX: 90, opacity: 0 }),
  },
  blur: {
    enter: () => ({ opacity: 0, scale: 0.8, filter: 'blur(12px)' }),
    center: { opacity: 1, scale: 1, filter: 'blur(0px)' },
    exit: () => ({ opacity: 0, scale: 1.2, filter: 'blur(12px)' }),
  },
};

export const TextRotate: React.FC<TextRotateProps> = ({
  texts,
  interval = 3000,
  className,
  rotationType = 'slide',
}) => {
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);

  const advance = useCallback(() => {
    setDirection(1);
    setIndex(prev => (prev + 1) % texts.length);
  }, [texts.length]);

  useEffect(() => {
    const timer = setInterval(advance, interval);
    return () => clearInterval(timer);
  }, [advance, interval]);

  const v = variants[rotationType];

  return (
    <span className={cn('relative inline-flex overflow-hidden', className)} style={{ perspective: '500px' }}>
      <AnimatePresence mode="wait" custom={direction}>
        <motion.span
          key={`${index}-${texts[index]}`}
          custom={direction}
          variants={v}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{
            type: 'spring',
            stiffness: 300,
            damping: 30,
            mass: 0.8,
          }}
          className="inline-block whitespace-nowrap"
        >
          {texts[index]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
};
