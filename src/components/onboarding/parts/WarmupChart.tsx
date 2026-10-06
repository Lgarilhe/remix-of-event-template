import React from 'react';
import { WARMUP_BASE_DAILY_ACTIONS, WARMUP_WEEKS } from '@/lib/onboarding/ramp';
import { cn } from '@/lib/utils';

/**
 * La montée en charge du compte, en quatre barres : ce que LinkedIn tolère les
 * premières semaines. Les chiffres sont ceux du serveur (lib/onboarding/ramp.ts).
 */
export const WarmupChart: React.FC = () => (
  <figure className="rounded-xl border border-border bg-card p-4">
    <figcaption className="mb-4 text-sm font-medium text-foreground">Montée en charge de votre compte</figcaption>
    <ul className="grid grid-cols-4 items-end gap-3" aria-label="Actions visibles par jour, semaine par semaine">
      {WARMUP_WEEKS.map((w, i) => {
        const last = i === WARMUP_WEEKS.length - 1;
        return (
          <li key={w.week} className="flex flex-col items-center gap-2">
            <span className="text-sm font-semibold tabular-nums text-foreground">{w.dailyActions}</span>
            <div className="flex h-24 w-full items-end">
              <div
                className={cn('w-full rounded-t-md', last ? 'bg-foreground' : 'bg-foreground/15')}
                style={{ height: `${(w.dailyActions / WARMUP_BASE_DAILY_ACTIONS) * 100}%` }}
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
