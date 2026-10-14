/** Persistent messaging access and a labelled menu for secondary tools. */
import { useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Calendar, Keyboard, ListTodo, MoreHorizontal, Phone, PlayCircle, Send, Settings, Store, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useOrganization } from '@/hooks/useOrganization';
import { useHasPhoneCalls } from '@/hooks/sidebar/useHasPhoneCalls';
import { useCloseMobileSidebar } from '@/hooks/sidebar/useCloseMobileSidebar';
import { useSequencesBeta } from '@/hooks/useSequencesBeta';
import { hasFeature } from '@/lib/featureGates';
import { badgeLabel } from '@/lib/sidebarSignals';
import { cn } from '@/lib/utils';
import { InboxNavigationLink } from './InboxNavigationLink';

export interface SidebarBottomRowProps {
  collapsed: boolean;
  overdueCount: number | null;
  onOpenShortcuts: () => void;
  onOpenTutorial?: () => void;
}
interface BottomLink { to: string; label: string; icon: LucideIcon }

export function SidebarBottomRow({ collapsed, overdueCount, onOpenShortcuts, onOpenTutorial }: SidebarBottomRowProps) {
  const { pathname } = useLocation();
  const { orgType } = useOrganization();
  const closeMobile = useCloseMobileSidebar();
  const showSequences = useSequencesBeta();
  const showMarketplace = hasFeature(orgType, 'marketplace_browse') || hasFeature(orgType, 'marketplace_publish');
  const showCalls = useHasPhoneCalls();
  const overdue = overdueCount !== null && overdueCount > 0 ? overdueCount : null;
  const pendingRef = useRef<'shortcuts' | 'tutorial' | 'navigation' | null>(null);
  const links: BottomLink[] = [
    { to: '/tasks', label: 'Tâches', icon: ListTodo },
    { to: '/calendar', label: 'Agenda', icon: Calendar },
    ...(showSequences ? [{ to: '/sequences', label: 'Séquences', icon: Send }] : []),
    ...(showCalls ? [{ to: '/calls', label: 'Appels', icon: Phone }] : []),
    ...(showMarketplace ? [{ to: '/marketplace', label: 'Marketplace', icon: Store }] : []),
    { to: '/settings', label: 'Paramètres', icon: Settings },
  ];
  const isActive = (to: string) => pathname === to || pathname.startsWith(`${to}/`);
  const moreActive = links.some(({ to }) => isActive(to));
  const moreLabel = overdue ? `Plus, ${overdue} tâche${overdue > 1 ? 's' : ''} en retard` : 'Plus';
  const targetClass = 'min-h-11 min-w-11';

  return (
    <div className={cn('flex gap-1', collapsed ? 'flex-col items-center' : 'items-center')}>
      <InboxNavigationLink compact={collapsed} />
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size={collapsed ? 'icon' : 'sm'} aria-label={moreLabel}
                className={cn(targetClass, 'relative shrink-0 text-sidebar-foreground', moreActive && 'bg-sidebar-accent')}>
                <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
                {!collapsed && <span>Plus</span>}
                {overdue && <span aria-hidden="true" className="absolute right-0 top-0 text-2xs tabular-nums text-muted-foreground">{badgeLabel(overdue)}</span>}
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side={collapsed ? 'right' : 'top'}>{moreLabel}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent side={collapsed ? 'right' : 'top'} align="end" sideOffset={8} className="w-64 max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto rounded-xl"
          onCloseAutoFocus={(event) => {
            const pending = pendingRef.current;
            if (!pending) return;
            pendingRef.current = null;
            event.preventDefault();
            closeMobile();
            if (pending === 'shortcuts') onOpenShortcuts();
            if (pending === 'tutorial') onOpenTutorial?.();
          }}>
          <DropdownMenuLabel>Outils</DropdownMenuLabel>
          {links.map(({ to, label, icon: Icon }) => (
            <DropdownMenuItem key={to} asChild onSelect={() => { pendingRef.current = 'navigation'; }}
              className={cn(targetClass, 'cursor-pointer', isActive(to) && 'bg-accent')}>
              <Link to={to} aria-current={isActive(to) ? 'page' : undefined} className="flex items-center gap-2">
                <Icon aria-hidden="true" className="h-4 w-4" />
                <span>{label}</span>
                {to === '/tasks' && overdue && <span className="ml-auto text-xs text-muted-foreground">{overdue} en retard</span>}
              </Link>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Aide</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => { pendingRef.current = 'shortcuts'; }} className={cn(targetClass, 'cursor-pointer gap-2')}>
            <Keyboard aria-hidden="true" className="h-4 w-4" />Raccourcis clavier
          </DropdownMenuItem>
          {onOpenTutorial && <DropdownMenuItem onSelect={() => { pendingRef.current = 'tutorial'; }} className={cn(targetClass, 'cursor-pointer gap-2')}>
            <PlayCircle aria-hidden="true" className="h-4 w-4" />Vidéo du tutoriel
          </DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
