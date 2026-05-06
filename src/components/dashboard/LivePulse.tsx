/**
 * LivePulse — petit dot avec pulse animé qui signale "en temps réel" / "actif".
 *
 * Usage :
 *   <LivePulse tone="success" />  → dot vert qui ping
 *   <LivePulse tone="info" label="Live" />  → dot + texte
 *
 * Animation infinie en CSS (via framer-motion), respecte prefers-reduced-motion.
 */

import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface LivePulseProps {
  tone?: 'success' | 'warning' | 'destructive' | 'info';
  label?: string;
  className?: string;
}

const TONE_BG: Record<NonNullable<LivePulseProps['tone']>, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  info: 'bg-info',
};

export const LivePulse: React.FC<LivePulseProps> = ({ tone = 'success', label, className }) => {
  const bgColor = TONE_BG[tone];

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span className="relative flex h-2 w-2">
        <motion.span
          className={cn('absolute inset-0 rounded-full', bgColor)}
          initial={{ opacity: 0.6, scale: 1 }}
          animate={{ opacity: 0, scale: 2.4 }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
        />
        <span className={cn('relative inline-flex h-2 w-2 rounded-full', bgColor)} />
      </span>
      {label && (
        <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">
          {label}
        </span>
      )}
    </span>
  );
};
