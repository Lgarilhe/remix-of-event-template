/**
 * AppSidebar — sidebar principale de l'app, version minimaliste.
 *
 * Pattern Linear / Vercel : pas de décorations superflues, juste le strict
 * nécessaire — logo org, search, nav (sans labels eyebrow), footer = user
 * menu en 1 ligne.
 *
 * V3 (mai 2026) : refonte minimaliste. Avant trop d'éléments visuels (eyebrow
 * labels, tagline, "Powered by", credits en card, branding en bas), maintenant
 * tout est inline ou dans le dropdown user.
 */

import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Home,
  Briefcase,
  Columns3,
  Inbox,
  Search,
  Calendar,
  ListTodo,
  Store,
} from 'lucide-react';
import { useUnreadMessageNotifications } from '@/hooks/useUnreadMessageNotifications';
import { useOrganization } from '@/hooks/useOrganization';
import { hasFeature, type Feature } from '@/lib/featureGates';
import { useAgent } from '@/contexts/AgentContext';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { SidebarUserMenu } from './sidebar/SidebarUserMenu';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<any>;
  badgeKey?: 'unread';
  feature?: Feature;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: Home },
  { to: '/missions', label: 'Missions', icon: Briefcase },
  { to: '/pipeline', label: 'Pipeline', icon: Columns3 },
  { to: '/calendar', label: 'Calendrier', icon: Calendar },
  { to: '/tasks', label: 'Tâches', icon: ListTodo },
  { to: '/inbox', label: 'Messages', icon: Inbox, badgeKey: 'unread' },
  { to: '/marketplace', label: 'Marketplace', icon: Store, feature: 'marketplace_browse' },
];

export function AppSidebar() {
  const { state, setOpenMobile } = useSidebar();
  const collapsed = state === 'collapsed';
  const location = useLocation();
  const unreadMsgCount = useUnreadMessageNotifications();
  const { orgType, organization } = useOrganization();
  const { toggleAgent } = useAgent();

  const isActive = (path: string) => {
    if (path === '/missions') {
      return location.pathname === '/missions' || location.pathname.startsWith('/missions/');
    }
    return location.pathname === path || location.pathname.startsWith(path + '/');
  };

  const orgName = organization?.name || 'Konekt';
  const orgInitial = orgName.charAt(0).toUpperCase();

  const [isDark, setIsDark] = React.useState(
    () => !document.documentElement.classList.contains('light'),
  );
  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    if (next) document.documentElement.classList.remove('light');
    else document.documentElement.classList.add('light');
  };

  const closeMobile = () => setOpenMobile(false);

  const filteredItems = NAV_ITEMS.filter(
    (item) => !item.feature || hasFeature(orgType, item.feature),
  );

  return (
    <Sidebar collapsible="icon" className="border-r border-border bg-sidebar">
      {/* Header — logo org seulement */}
      <SidebarHeader className={cn(collapsed ? 'px-2 py-3' : 'px-3 py-3')}>
        <Link
          to="/dashboard"
          onClick={closeMobile}
          className={cn(
            'flex items-center rounded-lg transition-colors hover:bg-sidebar-accent/40',
            collapsed ? 'h-9 w-9 justify-center mx-auto' : 'gap-2.5 px-1.5 py-1',
          )}
        >
          {organization?.logo_url ? (
            <img
              src={organization.logo_url}
              alt={orgName}
              className={cn(
                'rounded-md object-cover shrink-0',
                collapsed ? 'h-7 w-7' : 'h-7 w-7',
              )}
            />
          ) : (
            <div
              className={cn(
                'rounded-md bg-foreground text-background flex items-center justify-center shrink-0 font-display font-bold text-xs',
                collapsed ? 'h-7 w-7' : 'h-7 w-7',
              )}
            >
              {orgInitial}
            </div>
          )}
          {!collapsed && (
            <span className="text-[13px] font-display font-bold tracking-tight text-sidebar-foreground truncate">
              {orgName}
            </span>
          )}
        </Link>
      </SidebarHeader>

      {/* Content */}
      <SidebarContent className={cn(collapsed ? 'px-1.5' : 'px-2')}>
        {/* Search */}
        {!collapsed ? (
          <button
            onClick={() => toggleAgent()}
            className="w-full flex items-center gap-2 h-9 px-2.5 mb-2 rounded-md bg-sidebar-accent/40 text-muted-foreground text-[12px] hover:bg-sidebar-accent/60 transition-colors"
            aria-label="Rechercher (Ctrl+K)"
          >
            <Search className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
            <span className="flex-1 text-left">Rechercher…</span>
            <kbd className="text-[10px] font-mono text-muted-foreground/70">⌘K</kbd>
          </button>
        ) : (
          <button
            onClick={() => toggleAgent()}
            className="h-9 w-9 mx-auto flex items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground transition-colors mb-2"
            aria-label="Rechercher"
            title="Rechercher (⌘K)"
          >
            <Search className="h-5 w-5" strokeWidth={1.5} />
          </button>
        )}

        {/* Nav — pas d'eyebrow, juste les items */}
        <SidebarMenu className={cn('gap-0.5', collapsed ? 'px-0 items-center' : 'px-0')}>
          {filteredItems.map((item) => {
            const active = isActive(item.to);
            const showBadge = item.badgeKey === 'unread' && unreadMsgCount > 0;
            return (
              <SidebarMenuItem key={item.to}>
                <SidebarMenuButton
                  asChild
                  isActive={active}
                  tooltip={item.label}
                  className={cn(
                    'h-9 rounded-md text-[13px] font-medium transition-colors',
                    collapsed ? 'w-9 px-0 justify-center' : 'px-2.5',
                    active
                      ? 'bg-sidebar-accent text-sidebar-foreground'
                      : 'text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/40',
                  )}
                >
                  <Link
                    to={item.to}
                    onClick={closeMobile}
                    className={cn(
                      'flex items-center',
                      collapsed ? 'justify-center' : 'gap-2.5 w-full',
                    )}
                  >
                    <item.icon
                      className="h-5 w-5 shrink-0"
                      strokeWidth={1.5}
                      aria-hidden="true"
                    />
                    {!collapsed && (
                      <>
                        <span className="flex-1 truncate">{item.label}</span>
                        {showBadge && (
                          <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] font-bold tabular-nums bg-sidebar-foreground text-sidebar-background rounded">
                            {unreadMsgCount > 99 ? '99+' : unreadMsgCount}
                          </span>
                        )}
                      </>
                    )}
                    {showBadge && collapsed && (
                      <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-destructive rounded-full" />
                    )}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarContent>

      {/* Footer — juste user menu */}
      <SidebarFooter className={cn(collapsed ? 'px-2 py-2' : 'px-2 py-2')}>
        <SidebarUserMenu collapsed={collapsed} isDark={isDark} onToggleTheme={toggleTheme} />
      </SidebarFooter>
    </Sidebar>
  );
}
