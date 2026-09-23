/**
 * Ligne mission de l'onglet Missions (§3.3).
 *
 * - pastille d'initiale neutre (aucune image réseau), nom, sous-titre client
 *   ou « Confiée par … », point neutre « nouveaux profils » ;
 * - clic sur le nom : dernière vue de la mission, sauf vue verrouillée (Vue
 *   d'ensemble et message de blocage, comme la page) ;
 * - chevron : les 8 vues groupées par phase, verrous de useMissionReadiness ;
 * - épingle : visible au survol et au focus sur ordinateur, toujours sur
 *   téléphone ; au plafond, reste focalisable (aria-disabled) et explique.
 *
 * Cibles de 44 px sur téléphone (min-h-11, min-w-11), compactes à partir de md.
 */
import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Lock, Pin, PinOff } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { computeReadiness, type ReadinessInput } from '@/hooks/useMissionReadiness';
import { useCloseMobileSidebar } from '@/hooks/sidebar/useCloseMobileSidebar';
import { MISSION_PHASES, type MissionViewId } from '@/lib/missionViews';
import {
  DEFAULT_BLOCKER_MESSAGE,
  PIN_LIMIT_MESSAGE,
  blockerOf,
  isViewLocked,
  missionInitial,
  missionViewPath,
  resolveOpenTarget,
  type MissionNavItem,
} from '@/lib/sidebarMissions';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export interface MissionNavRowProps {
  item: MissionNavItem;
  /** Source des verrous : fiche complète de la mission ouverte, sinon la ligne de liste. */
  readinessInput: ReadinessInput;
  /** Dernière vue relevée (null : Vue d'ensemble). */
  lastView: string | null;
  /** Mission de la page affichée (/missions/:id). */
  isOpenMission?: boolean;
  /** Vue affichée de la mission ouverte. */
  currentView?: MissionViewId | null;
  hasNewProfiles?: boolean;
  pinned: boolean;
  /** Faux au plafond d'épingles (sans effet sur le retrait). */
  canPinMore: boolean;
  onTogglePin: (item: MissionNavItem, pinned: boolean) => void;
}

const ICON_BUTTON_CLASS =
  'inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground min-h-11 min-w-11 md:min-h-7 md:min-w-7 ' +
  'hover:bg-sidebar-accent/60 hover:text-sidebar-foreground outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring';

export function MissionNavRow({
  item,
  readinessInput,
  lastView,
  isOpenMission = false,
  currentView = null,
  hasNewProfiles = false,
  pinned,
  canPinMore,
  onTogglePin,
}: MissionNavRowProps) {
  const closeMobile = useCloseMobileSidebar();
  const [expanded, setExpanded] = useState(false);
  const viewsId = useId();

  const readiness = useMemo(() => computeReadiness(readinessInput), [readinessInput]);
  const target = resolveOpenTarget({ projectId: item.id, lastView, readiness });

  const pinCapped = !pinned && !canPinMore;
  const pinLabel = pinned ? `Retirer ${item.name} des épinglées` : `Épingler ${item.name}`;

  const handleOpen = () => {
    closeMobile();
    if (target.blocker) toast.info(target.blocker);
  };

  const handlePin = () => {
    if (pinCapped) {
      toast.info(PIN_LIMIT_MESSAGE);
      return;
    }
    onTogglePin(item, !pinned);
  };

  const pinButton = (
    <button
      type="button"
      onClick={handlePin}
      aria-label={pinLabel}
      aria-pressed={pinned}
      aria-disabled={pinCapped ? 'true' : undefined}
      className={cn(
        ICON_BUTTON_CLASS,
        'md:opacity-0 md:group-hover/mission:opacity-100 md:focus-visible:opacity-100',
        pinCapped && 'cursor-not-allowed opacity-60',
      )}
    >
      {pinned ? <PinOff aria-hidden="true" className="h-3.5 w-3.5" /> : <Pin aria-hidden="true" className="h-3.5 w-3.5" />}
    </button>
  );

  return (
    <li className="flex flex-col">
      <div className="group/mission flex items-center gap-0.5">
        <Link
          to={target.path}
          onClick={handleOpen}
          aria-current={isOpenMission ? 'page' : undefined}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left min-h-11 md:min-h-8',
            'outline-none transition-colors hover:bg-sidebar-accent/60 active:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring',
            isOpenMission && 'bg-sidebar-accent',
          )}
        >
          <span
            aria-hidden="true"
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-semibold text-muted-foreground"
          >
            {missionInitial(item)}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px] leading-5 text-sidebar-foreground/90">{item.name}</span>
            {item.sub && <span className="truncate text-[11.5px] leading-4 text-muted-foreground">{item.sub}</span>}
          </span>
          {hasNewProfiles && (
            <>
              <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/60" />
              <span className="sr-only">Nouveaux profils depuis votre dernière visite</span>
            </>
          )}
        </Link>

        {pinCapped ? (
          <Tooltip>
            <TooltipTrigger asChild>{pinButton}</TooltipTrigger>
            <TooltipContent side="right">{PIN_LIMIT_MESSAGE}</TooltipContent>
          </Tooltip>
        ) : (
          pinButton
        )}

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={expanded ? viewsId : undefined}
          aria-label={`Afficher les vues de ${item.name}`}
          className={ICON_BUTTON_CLASS}
        >
          <ChevronRight
            aria-hidden="true"
            className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-90')}
          />
        </button>
      </div>

      {expanded && (
        <div id={viewsId} className="mb-1 ml-4 border-l border-sidebar-border pl-2">
          {MISSION_PHASES.map((phase) => (
            <div key={phase.id} className="pt-1">
              <p aria-hidden="true" className="px-2 text-[10.5px] font-medium text-muted-foreground/80">
                {phase.label}
              </p>
              <ul aria-label={phase.label} className="flex flex-col">
                {phase.views.map((view) => {
                  const locked = isViewLocked(readiness, view.id);
                  const isCurrent = isOpenMission && currentView === view.id;
                  const rowClass =
                    'flex w-full items-center gap-1.5 rounded-md px-2 text-left text-[12.5px] min-h-11 md:min-h-7 ' +
                    'outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring';
                  if (locked) {
                    const blocker = blockerOf(readiness, view.id) ?? DEFAULT_BLOCKER_MESSAGE;
                    return (
                      <li key={view.id}>
                        <button
                          type="button"
                          aria-disabled="true"
                          title={blocker}
                          onClick={() => toast.info(blocker)}
                          className={cn(rowClass, 'cursor-not-allowed text-muted-foreground/60')}
                        >
                          <span className="min-w-0 flex-1 truncate">{view.label}</span>
                          <Lock aria-hidden="true" className="h-3 w-3 shrink-0" />
                        </button>
                      </li>
                    );
                  }
                  return (
                    <li key={view.id}>
                      <Link
                        to={missionViewPath(item.id, view.id)}
                        onClick={closeMobile}
                        aria-current={isCurrent ? 'page' : undefined}
                        className={cn(
                          rowClass,
                          'text-sidebar-foreground/85 hover:bg-sidebar-accent/60',
                          isCurrent && 'bg-sidebar-accent font-medium text-sidebar-foreground',
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">{view.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}
