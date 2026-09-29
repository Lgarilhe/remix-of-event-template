// Refonte mission, lot 1 : les trois onglets de la mission (conception, 3.1).
// Liens à plat, sans verrou ni coche : un écran sans objet s'ouvre sur son état
// vide. Changer d'onglet pousse une entrée d'historique (Retour revient à
// l'écran précédent) et garde les panneaux ouverts.
import type React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { MissionScreen } from '@/lib/missionBeta';
import { useMissionV3 } from '../MissionV3Context';
import { MISSION_SCREEN_LABEL, missionScreenTarget } from './missionScreens';

const TAB_ORDER: readonly MissionScreen[] = ['pipeline', 'sourcing', 'cadrage'];

export function MissionTabs() {
  const { project, location, leaveBeta } = useMissionV3();
  const { search } = useLocation();

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-2 sm:px-4">
      <nav aria-label="Écrans de la mission" className="-mb-px flex min-w-0 flex-1 items-stretch self-stretch overflow-x-auto scrollbar-hide">
        {TAB_ORDER.map((screen) => {
          const active = location.screen === screen;
          const onClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
            if (active && !event.metaKey && !event.ctrlKey && !event.shiftKey) event.preventDefault();
          };
          return (
            <Link
              key={screen}
              to={missionScreenTarget(project.id, screen, search)}
              onClick={onClick}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex shrink-0 items-center border-b-2 px-3 text-sm font-medium outline-none',
                'transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                active
                  ? 'border-brand text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {MISSION_SCREEN_LABEL[screen]}
            </Link>
          );
        })}
      </nav>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={leaveBeta}
        className="hidden shrink-0 font-normal text-muted-foreground hover:text-foreground sm:inline-flex"
      >
        Revenir à l'ancienne page
      </Button>
    </div>
  );
}
