// Refonte mission, lot 1 : les trois onglets de la mission (conception, 3.1).
// Liens à plat, sans verrou ni coche : un écran sans objet s'ouvre sur son état
// vide. Changer d'onglet pousse une entrée d'historique (Retour revient à
// l'écran précédent) et garde les panneaux ouverts.
//
// Sur ordinateur, les onglets sont au centre de l'en-tête (MissionTabsNav dans
// MissionHeader, à partir de lg) ; en dessous, une bande à part sous l'en-tête
// (MissionTabs).
// « Revenir à l'ancienne page » est dans le menu « ... ».
import type React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import type { MissionScreen } from '@/lib/missionBeta';
import { useMissionV3 } from '../MissionV3Context';
import { MISSION_SCREEN_LABEL, missionScreenTarget } from './missionScreens';

const TAB_ORDER: readonly MissionScreen[] = ['pipeline', 'sourcing', 'cadrage'];

/** Liens des trois écrans, soulignés de 2 px sous l'onglet actif. */
export function MissionTabsNav({ className, linkClassName }: { className?: string; linkClassName?: string }) {
  const { project, location } = useMissionV3();
  const { search } = useLocation();

  return (
    <nav aria-label="Écrans de la mission" className={cn('flex gap-1 self-stretch', className)}>
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
              'inline-flex shrink-0 items-center border-b-2 px-3 text-sm outline-none',
              'transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              active
                ? 'border-foreground font-semibold text-foreground'
                : 'border-transparent font-medium text-muted-foreground hover:text-foreground',
              linkClassName,
            )}
          >
            {MISSION_SCREEN_LABEL[screen]}
          </Link>
        );
      })}
    </nav>
  );
}

/** Bande des onglets du téléphone et de la tablette (sous lg). */
export function MissionTabs({ className }: { className?: string }) {
  return (
    <div className={cn('flex h-11 shrink-0 items-stretch border-b border-border px-2 sm:px-4', className)}>
      <MissionTabsNav className="-mb-px min-w-0 flex-1 overflow-x-auto scrollbar-hide" linkClassName="min-h-11" />
    </div>
  );
}
