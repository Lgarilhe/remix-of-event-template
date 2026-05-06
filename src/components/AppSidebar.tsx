/**
 * AppSidebar — sidebar principale de l'app.
 *
 * Pattern Linear / Notion / Vercel : header simple (org), search/AI agent,
 * groupes nav avec eyebrow labels, widget crédits compact, footer = profil
 * user en card avec menu dropdown (settings/theme/logout).
 *
 * V2 (mai 2026) : refonte complète — footer cramée d'icônes remplacée par
 * un user menu dropdown propre, credits passe en widget visuel avec progress
 * bar, hiérarchie des sections clarifiée.
 */

import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Target,
  Kanban,
  MessageSquare,
  Sparkles,
  Search,
  CalendarDays,
  CheckSquare,
} from 'lucide-react';
import { useUnreadMessageNotifications } from '@/hooks/useUnreadMessageNotifications';
import { useOrganization } from '@/hooks/useOrganization';
import { hasFeature, type Feature } from '@/lib/featureGates';
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
import { SidebarUserMenu } from './sidebar/SidebarUserMenu';
import { SidebarCreditsWidget } from './sidebar/SidebarCreditsWidget';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<any>;
  badgeKey?: 'unread';
  feature?: Feature;
}

const MAIN_NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/missions', label: 'Missions', icon: Target },
  { to: '/pipeline', label: 'Pipeline', icon: Kanban },
  { to: '/calendar', label: 'Calendrier', icon: CalendarDays },
  { to: '/tasks', label: 'Tâches', icon: CheckSquare },
  { to: '/inbox', label: 'Messages', icon: MessageSquare, badgeKey: 'unread' },
];

const TOOLS_NAV_ITEMS: NavItem[] = [
  { to: '/marketplace', label: 'Marketplace', icon: Sparkles, feature: 'marketplace_browse' },
];

const NavItemRow: React.FC<{
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  badgeCount?: number;
  onNavigate?: () => void;
}> = ({ item, active, collapsed, badgeCount, onNavigate }) => {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        tooltip={item.label}
        className={cn(
          'h-9 rounded-lg text-[13px] font-medium transition-colors relative',
          collapsed ? 'w-9 px-0 justify-center' : 'px-2.5',
          active
            ? 'bg-sidebar-accent text-sidebar-foreground'
            : 'text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50',
        )}
      >
        <Link
          to={item.to}
          onClick={onNavigate}
          className={cn(
            'flex items-center',
            collapsed ? 'justify-center' : 'gap-2.5 w-full',
          )}
        >
          {/* Active indicator — barre verticale gauche */}
          {active && !collapsed && (
            <span
              className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r-full bg-sidebar-foreground"
              aria-hidden="true"
            />
          )}
          <item.icon
            className={cn(
              'h-4 w-4 shrink-0',
              active ? 'text-sidebar-foreground' : 'text-muted-foreground',
            )}
            strokeWidth={1.75}
          />
          {!collapsed && (
            <>
              <span className="flex-1 truncate">{item.label}</span>
              {item.badgeKey === 'unread' && badgeCount && badgeCount > 0 && (
                <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 text-[10px] font-bold tabular-nums bg-sidebar-foreground text-sidebar-background rounded-full">
                  {badgeCount > 99 ? '99+' : badgeCount}
                </span>
              )}
            </>
          )}
          {item.badgeKey === 'unread' && collapsed && badgeCount && badgeCount > 0 && (
            <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-destructive rounded-full ring-2 ring-sidebar" />
          )}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
};

const NavGroup: React.FC<{
  label?: string;
  items: NavItem[];
  collapsed: boolean;
  isActive: (path: string) => boolean;
  unreadCount: number;
  onNavigate?: () => void;
}> = ({ label, items, collapsed, isActive, unreadCount, onNavigate }) => {
  if (items.length === 0) return null;
  return (
    <SidebarGroup className="p-0">
      {!collapsed && label && (
        <div className="px-3 pb-1.5 pt-1">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
            {label}
          </span>
        </div>
      )}
      <SidebarGroupContent>
        <SidebarMenu className={cn('gap-0.5', collapsed ? 'px-0 items-center' : 'px-1.5')}>
          {items.map((item) => (
            <NavItemRow
              key={item.to}
              item={item}
              active={isActive(item.to)}
              collapsed={collapsed}
              badgeCount={item.badgeKey === 'unread' ? unreadCount : undefined}
              onNavigate={onNavigate}
            />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
};

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

  // Theme toggle (lifted up so SidebarUserMenu can call it via prop)
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

  const filteredTools = TOOLS_NAV_ITEMS.filter(
    (item) => !item.feature || hasFeature(orgType, item.feature),
  );

  return (
    <Sidebar collapsible="icon" className="border-r border-border bg-sidebar">
      {/* ── Header — Org branding ───────────────────────────────────── */}
      <SidebarHeader
        className={cn(
          'border-b border-border/60',
          collapsed ? 'px-2 py-3' : 'px-3 py-3.5',
        )}
      >
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
                'rounded-lg object-cover ring-1 ring-border shrink-0',
                collapsed ? 'h-7 w-7' : 'h-8 w-8',
              )}
            />
          ) : (
            <div
              className={cn(
                'rounded-lg bg-sidebar-foreground text-sidebar-background flex items-center justify-center shrink-0 font-display font-bold',
                collapsed ? 'h-7 w-7 text-xs' : 'h-8 w-8 text-sm',
              )}
            >
              {orgInitial}
            </div>
          )}
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-display font-bold tracking-tight text-sidebar-foreground truncate leading-tight">
                {orgName}
              </div>
              <div className="text-[10px] text-muted-foreground truncate leading-tight">
                Recrutement intelligent
              </div>
            </div>
          )}
        </Link>
      </SidebarHeader>

      {/* ── Content ─────────────────────────────────────────────────── */}
      <SidebarContent className={cn('pt-3', collapsed ? 'px-1.5' : 'px-2')}>
        {/* Search / AI agent trigger */}
        {!collapsed ? (
          <button
            onClick={() => toggleAgent()}
            className="w-full flex items-center gap-2 h-9 px-3 mb-3 mx-1.5 rounded-lg bg-sidebar-accent/40 border border-border/60 text-muted-foreground text-[12px] hover:bg-sidebar-accent/70 hover:border-border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            style={{ width: 'calc(100% - 12px)' }}
            aria-label="Rechercher ou ouvrir le copilot IA (Ctrl+K)"
          >
            <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            <span className="flex-1 text-left">Chercher, agir…</span>
            <kbd className="text-[10px] font-mono text-muted-foreground bg-background px-1.5 py-0.5 rounded border border-border/60">
              ⌘K
            </kbd>
          </button>
        ) : (
          <button
            onClick={() => toggleAgent()}
            className="h-9 w-9 mx-auto flex items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground transition-colors mb-3"
            aria-label="Recherche / IA"
            title="Recherche (⌘K)"
          >
            <Search className="h-4 w-4" strokeWidth={1.75} />
          </button>
        )}

        {/* Main nav */}
        <NavGroup
          label="Navigation"
          items={MAIN_NAV_ITEMS.filter((i) => !i.feature || hasFeature(orgType, i.feature))}
          collapsed={collapsed}
          isActive={isActive}
          unreadCount={unreadMsgCount}
          onNavigate={closeMobile}
        />

        {/* Tools nav */}
        {filteredTools.length > 0 && (
          <div className="mt-4">
            <NavGroup
              label="Outils"
              items={filteredTools}
              collapsed={collapsed}
              isActive={isActive}
              unreadCount={0}
              onNavigate={closeMobile}
            />
          </div>
        )}
      </SidebarContent>

      {/* ── Footer ─────────────────────────────────────────────────── */}
      <SidebarFooter
        className={cn(
          'border-t border-border/60 space-y-2',
          collapsed ? 'px-2 py-3' : 'px-2 py-3',
        )}
      >
        {/* Credits widget */}
        <SidebarCreditsWidget collapsed={collapsed} />

        {/* User profile + dropdown menu */}
        <SidebarUserMenu collapsed={collapsed} isDark={isDark} onToggleTheme={toggleTheme} />

        {/* Subtle Skalr branding */}
        {!collapsed && (
          <div className="flex items-center justify-center gap-1.5 pt-1 opacity-50 hover:opacity-100 transition-opacity">
            <img src={skalrLogo} alt="Skalr" className="h-3 w-3 object-contain" />
            <span className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground">
              Powered by Skalr
            </span>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
