import React from 'react';
import { motion } from 'framer-motion';
import { WARMUP_BASE_DAILY_ACTIONS, WARMUP_WEEKS } from '@/lib/onboarding/ramp';
import { cn } from '@/lib/utils';
import { CountUp } from '../stage/CountUp';
import { EASE_OUT } from '../stage/springs';
import { useDelay } from '../stage/useDelay';

/**
 * La montée en charge du compte, en quatre barres : ce que LinkedIn tolère les
 * premières semaines. Les chiffres sont ceux du serveur (lib/onboarding/ramp.ts).
 */
export const WarmupChart: React.FC<{ delay?: number }> = ({ delay = 0 }) => {
  const d = useDelay();
  return (
    <figure className="rounded-xl border border-border bg-card p-4">
      <figcaption className="mb-4 text-sm font-medium text-foreground">Montée en charge de votre compte</figcaption>
      <ul className="grid grid-cols-4 items-end gap-3" aria-label="Actions visibles par jour, semaine par semaine">
        {WARMUP_WEEKS.map((w, i) => {
          const last = i === WARMUP_WEEKS.length - 1;
          return (
            <li key={w.week} className="flex flex-col items-center gap-2">
              <span className="text-sm font-semibold text-foreground">
                <CountUp value={w.dailyActions} duration={1.1} />
              </span>
              <div className="flex h-24 w-full items-end">
                <motion.div
                  className={cn('w-full origin-bottom rounded-t-md', last ? 'bg-brand' : 'bg-foreground/15')}
                  style={{ height: `${(w.dailyActions / WARMUP_BASE_DAILY_ACTIONS) * 100}%` }}
                  initial={{ scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={{ duration: 0.8, ease: EASE_OUT, delay: d(delay + i * 0.12) }}
                />
              </div>
              <span className="text-2xs text-muted-foreground">{last ? 'Semaine 4+' : `Sem. ${w.week}`}</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">
        Actions visibles par jour (invitations, messages, InMails), du lundi au vendredi, de 8 h à 19 h, heure de Paris. LinkedIn surveille les comptes récents : Konekt monte par paliers.
      </p>
    </figure>
  );
};
