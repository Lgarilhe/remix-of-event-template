import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface BentoItemProps {
  children: React.ReactNode;
  className?: string;
  colSpan?: 1 | 2 | 3;
  rowSpan?: 1 | 2;
  delay?: number;
}

export const BentoItem: React.FC<BentoItemProps> = ({
  children,
  className,
  colSpan = 1,
  rowSpan = 1,
  delay = 0,
}) => (
  <motion.div
    initial={{ opacity: 0, y: 20, scale: 0.97 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    transition={{ delay, duration: 0.5, type: 'spring', stiffness: 200, damping: 25 }}
    className={cn(
      'relative overflow-hidden border border-foreground/20 bg-background',
      colSpan === 2 && 'md:col-span-2',
      colSpan === 3 && 'md:col-span-3',
      rowSpan === 2 && 'md:row-span-2',
      className,
    )}
  >
    {children}
  </motion.div>
);

interface BentoGridProps {
  children: React.ReactNode;
  className?: string;
  columns?: 2 | 3 | 4;
}

export const BentoGrid: React.FC<BentoGridProps> = ({
  children,
  className,
  columns = 3,
}) => (
  <div
    className={cn(
      'grid gap-3',
      columns === 2 && 'grid-cols-1 md:grid-cols-2',
      columns === 3 && 'grid-cols-1 md:grid-cols-3',
      columns === 4 && 'grid-cols-1 md:grid-cols-4',
      className,
    )}
  >
    {children}
  </div>
);
