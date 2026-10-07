// Refonte mission, lot 1 : le nom de la mission est un menu (conception, 4.2).
// Il liste les autres missions (épinglées, puis les miennes, mêmes lectures que
// l'onglet Missions de la barre) et garde l'écran en cours. Design simplifié
// (04/10/2026) : le logo du client devant le nom, et devant chaque mission du
// menu (initiales quand il n'est pas connu) ; 44 px de haut sur téléphone.
import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { missionV3Path } from '@/lib/missionBeta';
import type { MissionNavItem } from '@/lib/sidebarMissions';
import { useMyMissions } from '@/hooks/sidebar/useMyMissions';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { MissionCompanyLogo } from '@/components/dashboard/MissionCompanyLogo';
import { useMissionV3 } from '../MissionV3Context';
import { missionClientName } from './missionClient';

function MissionItem({ item, href }: { item: MissionNavItem; href: string }) {
  return (
    <DropdownMenuItem asChild className="cursor-pointer">
      <Link to={href} className="flex min-w-0 items-center gap-2.5 max-sm:min-h-11">
        <MissionCompanyLogo company={item.client_name || item.name} size={24} />
        <span className="flex min-w-0 flex-1 flex-col items-start">
          <span className="w-full truncate text-sm text-foreground">{item.name}</span>
          {item.sub && <span className="w-full truncate text-xs text-muted-foreground">{item.sub}</span>}
        </span>
      </Link>
    </DropdownMenuItem>
  );
}

export function MissionSwitcher() {
  const { project, location } = useMissionV3();
  const missions = useMyMissions({ enabled: true, withPins: true, openMissionId: project.id });
  const hrefOf = (id: string) => missionV3Path(id, location.screen);

  const pinsReady = missions.pinsStatus === 'ok';
  const listReady = missions.status === 'ok';
  const loading = missions.status === 'loading';
  const empty = listReady && missions.mine.length === 0 && (!pinsReady || missions.pinned.length === 0);

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        className={cn(
          'group inline-flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-sm font-semibold text-foreground outline-none max-sm:min-h-11',
          'transition-colors duration-150 ease-out hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        <MissionCompanyLogo
          company={missionClientName(project) || project.name}
          logoUrl={project.job_details?.client?.logo_url}
          size={24}
        />
        <span className="truncate">{project.name}</span>
        <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72 max-w-[calc(100vw-2rem)]">
        {pinsReady && missions.pinned.length > 0 && (
          <>
            <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Épinglées</DropdownMenuLabel>
            <DropdownMenuGroup>
              {missions.pinned.map((item) => (
                <MissionItem key={item.id} item={item} href={hrefOf(item.id)} />
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        )}

        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Mes missions</DropdownMenuLabel>
        {loading && (
          <div className="flex flex-col gap-2 px-2 py-1.5" aria-busy="true" aria-label="Chargement de vos missions">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        )}
        {missions.status === 'error' && (
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              missions.retry();
            }}
            className="flex flex-col items-start gap-0.5 max-sm:min-h-11"
          >
            <span className="text-sm text-foreground">Impossible de charger vos missions.</span>
            <span className="text-xs font-medium text-foreground">Réessayer</span>
          </DropdownMenuItem>
        )}
        {missions.status === 'offline' && (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">Hors ligne : liste indisponible pour l'instant.</p>
        )}
        {empty &&<p className="px-2 py-1.5 text-sm text-muted-foreground">Aucune autre mission en cours.</p>}
        {listReady && missions.mine.length > 0 && (
          <DropdownMenuGroup className="max-h-72 overflow-y-auto">
            {missions.mine.map((item) => (
              <MissionItem key={item.id} item={item} href={hrefOf(item.id)} />
            ))}
          </DropdownMenuGroup>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="cursor-pointer max-sm:min-h-11">
          <Link to="/missions">Voir toutes les missions</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
