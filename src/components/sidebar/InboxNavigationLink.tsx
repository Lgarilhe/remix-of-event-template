import { Link, useLocation } from 'react-router-dom';
import { MessageSquare } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useUnreadMessages } from '@/hooks/sidebar/useUnreadMessages';
import { useCloseMobileSidebar } from '@/hooks/sidebar/useCloseMobileSidebar';
import { badgeLabel } from '@/lib/sidebarSignals';
import { cn } from '@/lib/utils';

export function InboxNavigationLink({ compact = false }: { compact?: boolean }) {
  const { count, unavailable } = useUnreadMessages();
  const { pathname } = useLocation();
  const closeMobile = useCloseMobileSidebar();
  const unread = count !== null && count > 0;
  const description = unread ? `${count} message${count > 1 ? 's' : ''} non lu${count > 1 ? 's' : ''}` : '';
  const label = description ? `Messagerie, ${description}` : 'Messagerie';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link to="/inbox" onClick={closeMobile} aria-label={label} aria-current={pathname === '/inbox' ? 'page' : undefined}
          className={cn('relative flex min-h-11 items-center rounded-md outline-none hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-ring',
            compact ? 'min-w-11 justify-center' : 'min-w-0 flex-1 gap-2 px-2 text-sm',
            pathname === '/inbox' && 'bg-sidebar-accent text-sidebar-accent-foreground')}>
          <MessageSquare aria-hidden="true" className="h-4 w-4 shrink-0" />
          {!compact && <span>Messagerie</span>}
          {unread && <span aria-hidden="true" className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-2xs font-semibold tabular-nums text-brand-foreground',
            compact ? 'absolute right-0 top-0' : 'ml-auto')}>{badgeLabel(count)}</span>}
          <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">{description}</span>
        </Link>
      </TooltipTrigger>
      <TooltipContent side={compact ? 'right' : 'top'}>{unavailable ? 'Messagerie (compteur indisponible)' : label}</TooltipContent>
    </Tooltip>
  );
}
