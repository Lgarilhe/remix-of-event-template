/**
 * LivePulse — point fixe qui signale un état en cours (« en direct », « en
 * cours »). Il ne pulse pas : une animation en boucle distrait et ne dit rien
 * de plus (docs/design/01-direction.md, § 7). Le sens passe par le texte qui
 * l'accompagne, jamais par la couleur seule.
 *
 * Usage :
 *   <LivePulse tone="success" label="En cours" />
 */

import React from 'react';
import { cn } from '@/lib/utils';

interface LivePulseProps {
  tone?: 'success' | 'warning' | 'destructive' | 'info';
  label?: string;
  className?: string;
}

const TONE: Record<NonNullable<LivePulseProps['tone']>, { dot: string; text: string }> = {
  success: { dot: 'bg-success', text: 'text-success' },
  warning: { dot: 'bg-warning', text: 'text-warning' },
  destructive: { dot: 'bg-danger', text: 'text-danger' },
  info: { dot: 'bg-info', text: 'text-info' },
};

export const LivePulse: React.FC<LivePulseProps> = ({ tone = 'success', label, className }) => (
  <span className={cn('inline-flex items-center gap-1.5', className)}>
    <span className={cn('inline-flex h-1.5 w-1.5 shrink-0 rounded-full', TONE[tone].dot)} aria-hidden="true" />
    {label && <span className={cn('text-2xs font-medium', TONE[tone].text)}>{label}</span>}
  </span>
);
