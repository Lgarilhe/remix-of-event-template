import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Target, Kanban, MessageSquare, Settings, LogOut, Plus, Sparkles, Bell } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useUnreadMessageNotifications } from '@/hooks/useUnreadMessageNotifications';
import { useOrganization } from '@/hooks/useOrganization';
import { hasFeature } from '@/lib/featureGates';
import { NotificationDropdown } from './NotificationDropdown';
import { useAICredits } from '@/hooks/useAICredits';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

// ── Nav items ──

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/missions', label: 'Missions', icon: Target },
  { to: '/pipeline', label: 'Pipeline', icon: Kanban },
  { to: '/inbox', label: 'Messages', icon: MessageSquare, badgeKey: 'unread' as const },
  { to: '/settings', label: 'Paramètres', icon: Settings },
];

export function AppSidebar() {
  const { state, setOpenMobile } = useSidebar();
  const collapsed = state === 'collapsed';
  const location = useLocation();
  const navigate = useNavigate();
  const unreadMsgCount = useUnreadMessageNotifications();
  const { orgType, organization } = useOrganization();
  const { creditsRemaining, isLow, isOut, isLoading: creditsLoading } = useAICredits();

  const isActive = (path: string) => {
    if (path === '/missions') return location.pathname === '/missions' || location.pathname.startsWith('/missions/');
    return location.pathname === path || location.pathname.startsWith(path + '/');
  };

  const handleNav = (to: string) => {
    navigate(to);
    setOpenMobile(false);
  };

  const creditDisplay = creditsRemaining > 9999
    ? `${Math.round(creditsRemaining / 1000)}k`
    : creditsRemaining.toLocaleString();

  return (
    <Sidebar collapsible="icon" className="border-r border-border bg-sidebar">
      {/* Header — Logo */}
      <SidebarHeader className="px-4 py-4">
        <Link to="/dashboard" className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
            <span className="text-primary-foreground font-bold text-sm">S</span>
          </div>
          {!collapsed && (
            <span className="text-[15px] font-semibold tracking-tight text-foreground">Skalr</span>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-3 pt-1">
        {/* Create mission CTA */}
        {hasFeature(orgType, 'create_missions') && (
          <div className="mb-2 px-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className={cn(
                  "w-full flex items-center gap-2 h-9 px-3 text-sm font-medium rounded-lg",
                  "bg-primary text-primary-foreground",
                  "hover:bg-primary/90 transition-colors",
                  collapsed && "justify-center px-0"
                )}>
                  <Plus className="h-4 w-4 shrink-0" />
                  {!collapsed && <span>Nouvelle mission</span>}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="right" sideOffset={8} className="rounded-lg">
                <DropdownMenuItem onClick={() => handleNav('/missions?create=brief')} className="rounded-md">
                  📋 Brief IA
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleNav('/missions?create=import')} className="rounded-md">
                  📥 Importer
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleNav('/missions?create=manual')} className="rounded-md">
                  ✏️ Manuelle
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {/* Navigation */}
        <SidebarGroup className="p-0">
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5 px-1">
              {NAV_ITEMS.map((item) => {
                const active = isActive(item.to);
                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={item.label}
                      className={cn(
                        "h-9 rounded-lg text-[13px] font-medium transition-colors",
                        active
                          ? "bg-accent text-accent-foreground font-semibold"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                      )}
                    >
                      <Link to={item.to} onClick={() => setOpenMobile(false)} className="flex items-center gap-3">
                        <item.icon className={cn(
                          "h-[18px] w-[18px] shrink-0",
                          active ? "text-primary" : "text-muted-foreground"
                        )} />
                        {!collapsed && (
                          <div className="flex items-center justify-between flex-1 min-w-0">
                            <span>{item.label}</span>
                            {item.badgeKey === 'unread' && unreadMsgCount > 0 && (
                              <span className="ml-auto min-w-[20px] h-5 flex items-center justify-center px-1.5 text-[11px] font-semibold bg-primary text-primary-foreground rounded-full">
                                {unreadMsgCount > 99 ? '99+' : unreadMsgCount}
                              </span>
                            )}
                          </div>
                        )}
                        {item.badgeKey === 'unread' && unreadMsgCount > 0 && collapsed && (
                          <span className="absolute top-1 right-1 w-2 h-2 bg-primary rounded-full" />
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}

              {hasFeature(orgType, 'marketplace_browse') && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive('/marketplace')}
                    tooltip="Marketplace"
                    className={cn(
                      "h-9 rounded-lg text-[13px] font-medium transition-colors",
                      isActive('/marketplace')
                        ? "bg-accent text-accent-foreground font-semibold"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                    )}
                  >
                    <Link to="/marketplace" onClick={() => setOpenMobile(false)} className="flex items-center gap-3">
                      <Target className={cn(
                        "h-[18px] w-[18px] shrink-0",
                        isActive('/marketplace') ? "text-primary" : "text-muted-foreground"
                      )} />
                      {!collapsed && <span>Marketplace</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Footer */}
      <SidebarFooter className="border-t border-border px-3 py-3 space-y-1">
        {/* AI Credits */}
        {!creditsLoading && (
          <button
            onClick={() => navigate('/settings?tab=credits')}
            className={cn(
              "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors",
              "hover:bg-accent/50",
              isOut ? "text-destructive" : isLow ? "text-status-warning" : "text-muted-foreground",
            )}
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0" />
            {!collapsed && <span>{creditDisplay} crédits</span>}
          </button>
        )}

        {/* Notifications */}
        <div className={cn("flex items-center", collapsed ? "justify-center" : "px-1")}>
          <NotificationDropdown />
        </div>

        {/* Org + Sign out */}
        <div className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-lg",
          collapsed && "justify-center px-0"
        )}>
          {!collapsed && organization?.name && (
            <span className="text-xs text-muted-foreground truncate flex-1">{organization.name}</span>
          )}
          <button
            onClick={async () => { await supabase.auth.signOut(); }}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0 p-1 rounded-md hover:bg-accent/50"
            title="Déconnexion"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
