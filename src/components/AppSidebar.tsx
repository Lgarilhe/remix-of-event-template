import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Target, Kanban, MessageSquare, Settings, LogOut, Sparkles, Search, Sun, Moon, Users, Building2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useUnreadMessageNotifications } from '@/hooks/useUnreadMessageNotifications';
import { useOrganization } from '@/hooks/useOrganization';
import { hasFeature, type Feature } from '@/lib/featureGates';
import { NotificationDropdown } from './NotificationDropdown';
import { useAICredits } from '@/hooks/useAICredits';
import { useAgent } from '@/contexts/AgentContext';
import skalrLogo from '@/assets/skalr-logo-concept-3.webp';
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
import { cn } from '@/lib/utils';

// ── Nav groups ──

const MAIN_NAV_ITEMS: { to: string; label: string; icon: React.ComponentType<any>; badgeKey?: 'unread'; feature?: Feature }[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/missions', label: 'Missions', icon: Target },
  { to: '/prospection', label: 'Prospection', icon: Building2, feature: 'prospection' },
  { to: '/pipeline', label: 'Pipeline', icon: Kanban },
  { to: '/candidates', label: 'Candidats', icon: Users },
  { to: '/inbox', label: 'Messages', icon: MessageSquare, badgeKey: 'unread' },
];

export function AppSidebar() {
  const { state, setOpenMobile } = useSidebar();
  const collapsed = state === 'collapsed';
  const location = useLocation();
  const navigate = useNavigate();
  const unreadMsgCount = useUnreadMessageNotifications();
  const { orgType, organization } = useOrganization();
  const { creditsRemaining, isLow, isOut, isLoading: creditsLoading } = useAICredits();
  const { toggleAgent } = useAgent();

  const isActive = (path: string) => {
    if (path === '/missions') return location.pathname === '/missions' || location.pathname.startsWith('/missions/');
    return location.pathname === path || location.pathname.startsWith(path + '/');
  };

  const creditDisplay = creditsRemaining > 9999
    ? `${Math.round(creditsRemaining / 1000)}k`
    : creditsRemaining.toLocaleString();

  const orgName = organization?.name || 'Skalr';
  const orgInitial = orgName.charAt(0).toUpperCase();

  // Theme toggle
  const [isDark, setIsDark] = React.useState(() => !document.documentElement.classList.contains('light'));
  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    if (next) {
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.add('light');
    }
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-border bg-sidebar">
      {/* Header — Org avatar + name */}
      <SidebarHeader className={cn("py-4", collapsed ? "px-0 flex items-center justify-center" : "px-4")}>
        <Link to="/dashboard" className={cn("flex items-center", collapsed ? "justify-center" : "gap-2.5")} onClick={() => setOpenMobile(false)}>
          <div className="h-8 w-8 rounded-full bg-sidebar-accent flex items-center justify-center shrink-0">
            <span className="text-sidebar-foreground font-semibold text-sm">{orgInitial}</span>
          </div>
          {!collapsed && (
            <span className="text-sm font-semibold tracking-tight text-sidebar-foreground truncate">
              {orgName}
            </span>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent className={cn("pt-0", collapsed ? "px-1" : "px-3")}>
        {/* Search bar — opens AI Agent drawer */}
        {!collapsed ? (
          <div className="mb-4 px-1">
            <button onClick={() => toggleAgent()} className="w-full flex items-center gap-2.5 h-9 px-3 rounded-lg bg-sidebar-accent text-muted-foreground text-xs cursor-pointer hover:bg-sidebar-accent/80 transition-colors">
              <Search className="h-4 w-4 shrink-0" strokeWidth={1.5} />
              <span className="flex-1 text-left">Rechercher</span>
              <kbd className="text-[10px] font-mono bg-sidebar-background px-1.5 py-0.5 rounded border border-border">
                Ctrl+K
              </kbd>
            </button>
          </div>
        ) : (
          <div className="mb-3 flex justify-center">
            <button onClick={() => toggleAgent()} className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground cursor-pointer hover:bg-sidebar-accent/50 transition-colors">
              <Search className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
        )}

        {/* Main nav group */}
        <SidebarGroup className="p-0">
          {!collapsed && (
            <div className="px-3 pb-1.5">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Main</span>
            </div>
          )}
          <SidebarGroupContent>
            <SidebarMenu className={cn("gap-0.5", collapsed ? "px-0 items-center" : "px-1")}>
              {MAIN_NAV_ITEMS.filter(item => !item.feature || hasFeature(orgType, item.feature)).map((item) => {
                const active = isActive(item.to);
                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={item.label}
                      className={cn(
                        "h-9 rounded-lg text-xs font-medium transition-colors",
                        collapsed ? "w-9 px-0 justify-center" : "px-3",
                        active
                          ? "bg-sidebar-accent text-sidebar-foreground"
                          : "text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                      )}
                    >
                      <Link to={item.to} onClick={() => setOpenMobile(false)} className={cn("flex items-center", collapsed ? "justify-center" : "gap-3")}>
                        <item.icon className={cn(
                          "h-[18px] w-[18px] shrink-0",
                          active ? "text-sidebar-foreground" : "text-muted-foreground"
                        )} strokeWidth={1.5} />
                        {!collapsed && (
                          <div className="flex items-center justify-between flex-1 min-w-0">
                            <span>{item.label}</span>
                            {item.badgeKey === 'unread' && unreadMsgCount > 0 && (
                              <span className="ml-auto min-w-[20px] h-5 flex items-center justify-center px-1.5 text-[11px] font-semibold bg-sidebar-foreground text-sidebar-background rounded-full">
                                {unreadMsgCount > 99 ? '99+' : unreadMsgCount}
                              </span>
                            )}
                          </div>
                        )}
                        {item.badgeKey === 'unread' && unreadMsgCount > 0 && collapsed && (
                          <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-sidebar-foreground rounded-full" />
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Tools nav group */}
        {hasFeature(orgType, 'marketplace_browse') && (
          <SidebarGroup className="p-0 mt-4">
            {!collapsed && (
              <div className="px-3 pb-1.5">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Outils</span>
              </div>
            )}
            <SidebarGroupContent>
              <SidebarMenu className={cn("gap-0.5", collapsed ? "px-0 items-center" : "px-1")}>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive('/marketplace')}
                    tooltip="Marketplace"
                    className={cn(
                      "h-9 rounded-lg text-xs font-medium transition-colors",
                      collapsed ? "w-9 px-0 justify-center" : "px-3",
                      isActive('/marketplace')
                        ? "bg-sidebar-accent text-sidebar-foreground"
                        : "text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                    )}
                  >
                    <Link to="/marketplace" onClick={() => setOpenMobile(false)} className={cn("flex items-center", collapsed ? "justify-center" : "gap-3")}>
                      <Target className={cn(
                        "h-[18px] w-[18px] shrink-0",
                        isActive('/marketplace') ? "text-sidebar-foreground" : "text-muted-foreground"
                      )} strokeWidth={1.5} />
                      {!collapsed && <span>Marketplace</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      {/* Footer */}
      <SidebarFooter className={cn("border-t border-border py-3", collapsed ? "px-1" : "px-3", "space-y-1")}>
        {/* AI Credits */}
        {!creditsLoading && (
          <button
            onClick={() => navigate('/settings?tab=credits')}
            className={cn(
              "flex items-center rounded-lg text-xs font-medium transition-colors hover:bg-sidebar-accent/50",
              collapsed ? "h-8 w-8 justify-center mx-auto" : "w-full gap-2.5 px-3 py-2",
              isOut ? "text-destructive" : isLow ? "text-warning" : "text-muted-foreground",
            )}
          >
            <Sparkles className="h-4 w-4 shrink-0" strokeWidth={1.5} />
            {!collapsed && <span>{creditDisplay} crédits</span>}
          </button>
        )}

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className={cn(
            "flex items-center rounded-lg text-xs font-medium transition-colors hover:bg-sidebar-accent/50 text-muted-foreground",
            collapsed ? "h-8 w-8 justify-center mx-auto" : "w-full gap-2.5 px-3 py-2",
          )}
          aria-label={isDark ? "Passer en mode clair" : "Passer en mode sombre"}
        >
          {isDark ? <Sun className="h-4 w-4 shrink-0" strokeWidth={1.5} /> : <Moon className="h-4 w-4 shrink-0" strokeWidth={1.5} />}
          {!collapsed && <span>{isDark ? 'Mode clair' : 'Mode sombre'}</span>}
        </button>

        {/* Notifications */}
        <div className={cn("flex items-center", collapsed ? "justify-center" : "px-1")}>
          <NotificationDropdown />
        </div>

        {/* Bottom bar: Skalr logo + org name + settings + logout */}
        {!collapsed ? (
          <div className="flex items-center gap-2 pt-1 px-1">
            <img src={skalrLogo} alt="Skalr" className="h-5 w-5 shrink-0 object-contain" />
            <span className="text-xs text-muted-foreground truncate flex-1">{orgName}</span>
            <button
              onClick={() => { navigate('/settings'); setOpenMobile(false); }}
              className="text-muted-foreground hover:text-sidebar-foreground transition-colors shrink-0 p-1 rounded-lg hover:bg-sidebar-accent/50"
              aria-label="Paramètres"
            >
              <Settings className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
            <button
              onClick={async () => { await supabase.auth.signOut(); }}
              className="text-muted-foreground hover:text-sidebar-foreground transition-colors shrink-0 p-1 rounded-lg hover:bg-sidebar-accent/50"
              aria-label="Déconnexion"
            >
              <LogOut className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1 pt-1">
            <button
              onClick={() => { navigate('/settings'); setOpenMobile(false); }}
              className="h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-sidebar-foreground transition-colors rounded-lg hover:bg-sidebar-accent/50"
              aria-label="Paramètres"
            >
              <Settings className="h-4 w-4" strokeWidth={1.5} />
            </button>
            <button
              onClick={async () => { await supabase.auth.signOut(); }}
              className="h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-sidebar-foreground transition-colors rounded-lg hover:bg-sidebar-accent/50"
              aria-label="Déconnexion"
            >
              <LogOut className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
