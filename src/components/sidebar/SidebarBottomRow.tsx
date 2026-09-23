/**
 * Rangée basse de la barre (§2.4, D3, D38) : Tâches, Agenda, Marketplace
 * (selon le type d'organisation), Paramètres, Aide.
 *
 * Quatre liens et un bouton (Aide) ; nom au survol (infobulle) et aria-label,
 * aria-current="page" sur la route active. Déplié : une ligne de cibles de
 * 36 px sur ordinateur, 44 px sur téléphone. Replié : une pile de 32 px.
 * Tâches porte le nombre de mes tâches en retard, en gris (jamais rouge).
 */
import { Link, useLocation } from 'react-router-dom';
import { Calendar, ListTodo, Settings, Store, type LucideIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useOrganization } from '@/hooks/useOrganization';
import { useCloseMobileSidebar } from '@/hooks/sidebar/useCloseMobileSidebar';
import { hasFeature } from '@/lib/featureGates';
import { badgeLabel } from '@/lib/sidebarSignals';
import { cn } from '@/lib/utils';
import { HelpMenu } from './HelpMenu';

export interface SidebarBottomRowProps {
  collapsed: boolean;
  /** Mes tâches en retard ; null : inconnu, rien d'affiché. */
  overdueCount: number | null;
  onOpenShortcuts: () => void;
  onOpenTutorial: () => void;
}

interface BottomLink {
  to: string;
  label: string;
  icon: LucideIcon;
}

const TARGET_BASE =
  'relative inline-flex items-center justify-center rounded-md text-sidebar-foreground/70 outline-none transition-colors ' +
  'hover:bg-sidebar-accent/60 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring';

export function SidebarBottomRow({ collapsed, overdueCount, onOpenShortcuts, onOpenTutorial }: SidebarBottomRowProps) {
  const { pathname } = useLocation();
  const { orgType } = useOrganization();
  const closeMobile = useCloseMobileSidebar();

  const showMarketplace = hasFeature(orgType, 'marketplace_browse') || hasFeature(orgType, 'marketplace_publish');
  const overdue = overdueCount !== null && overdueCount > 0 ? overdueCount : null;

  const links: BottomLink[] = [
    { to: '/tasks', label: 'Tâches', icon: ListTodo },
    { to: '/calendar', label: 'Agenda', icon: Calendar },
    ...(showMarketplace ? [{ to: '/marketplace', label: 'Marketplace', icon: Store }] : []),
    { to: '/settings', label: 'Paramètres', icon: Settings },
  ];

  const isActive = (to: string) => pathname === to || pathname.startsWith(`${to}/`);
  const targetClass = collapsed ? 'h-8 w-8' : 'min-h-11 min-w-11 md:min-h-9 md:min-w-9 px-1';
  const tooltipSide = collapsed ? 'right' : 'top';

  return (
    <div className={cn(collapsed ? 'flex flex-col items-center gap-1' : 'flex items-center justify-between gap-0.5')}>
      {links.map(({ to, label, icon: Icon }) => {
        const isTasks = to === '/tasks';
        const name = isTasks && overdue !== null ? `Tâches, ${overdue} en retard` : label;
        const active = isActive(to);
        return (
          <Tooltip key={to}>
            <TooltipTrigger asChild>
              <Link
                to={to}
                onClick={closeMobile}
                aria-label={name}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  TARGET_BASE,
                  targetClass,
                  isTasks && !collapsed && overdue !== null && 'gap-1 px-2',
                  active && 'bg-sidebar-accent text-sidebar-foreground',
                )}
              >
                <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                {isTasks && overdue !== null && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      'tabular-nums text-muted-foreground',
                      collapsed ? 'absolute bottom-0 right-0 text-[9px] leading-none' : 'text-[11px]',
                    )}
                  >
                    {badgeLabel(overdue)}
                  </span>
                )}
              </Link>
            </TooltipTrigger>
            <TooltipContent side={tooltipSide}>{name}</TooltipContent>
          </Tooltip>
        );
      })}
      <HelpMenu
        onOpenShortcuts={onOpenShortcuts}
        onOpenTutorial={onOpenTutorial}
        triggerClassName={cn(TARGET_BASE, targetClass)}
        tooltipSide={tooltipSide}
        collapsed={collapsed}
      />
    </div>
  );
}
