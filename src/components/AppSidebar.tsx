import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Target, Kanban, MessageSquare, Settings, LogOut, Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useUnreadMessageNotifications } from '@/hooks/useUnreadMessageNotifications';
import { useOrganization } from '@/hooks/useOrganization';
import { hasFeature } from '@/lib/featureGates';
import { CreditBalanceIndicator } from './ai/CreditBalanceIndicator';
import { NotificationDropdown } from './NotificationDropdown';
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

// ── Logo (same animated face from old Navbar) ──

type FaceState = 'idle' | 'wink' | 'surprise' | 'happy' | 'look-left' | 'look-right';

const EXPRESSIONS: { state: FaceState; duration: number }[] = [
  { state: 'wink', duration: 400 },
  { state: 'look-left', duration: 600 },
  { state: 'look-right', duration: 600 },
  { state: 'surprise', duration: 500 },
  { state: 'happy', duration: 700 },
  { state: 'wink', duration: 400 },
];

const SidebarLogo: React.FC = () => {
  const [face, setFace] = useState<FaceState>('idle');
  const indexRef = useRef(0);
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';

  useEffect(() => {
    const interval = setInterval(() => {
      const expr = EXPRESSIONS[indexRef.current % EXPRESSIONS.length];
      setFace(expr.state);
      setTimeout(() => setFace('idle'), expr.duration);
      indexRef.current++;
    }, 3500);
    return () => clearInterval(interval);
  }, []);

  const lookX = face === 'look-left' ? -0.8 : face === 'look-right' ? 0.8 : 0;
  const eyeL = { cx: 5, cy: 5.5 };
  const eyeR = { cx: 9, cy: 5.5 };

  const leftEye = <circle cx={eyeL.cx + lookX * 0.3} cy={eyeL.cy} r="1.15" fill="currentColor" />;
  const rightEye = face === 'wink' ? (
    <path d={`M${eyeR.cx - 1.1} ${eyeR.cy} Q${eyeR.cx} ${eyeR.cy + 1} ${eyeR.cx + 1.1} ${eyeR.cy}`} stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" fill="none" />
  ) : (
    <circle cx={eyeR.cx + lookX * 0.3} cy={eyeR.cy} r="1.15" fill="currentColor" />
  );

  let mouth: React.ReactNode;
  if (face === 'surprise') {
    mouth = <circle cx="7" cy="9.8" r="0.9" fill="none" stroke="currentColor" strokeWidth="0.9" />;
  } else if (face === 'happy') {
    mouth = <path d="M4.2 8.6 Q7 11.8 9.8 8.6" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" fill="none" />;
  } else {
    mouth = <path d="M5.8 9 Q7.5 10.6 9.8 8.8" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" fill="none" />;
  }

  const eyebrows = face === 'surprise' ? (
    <>
      <path d="M3.6 3.8 Q5 3 6.2 3.8" stroke="currentColor" strokeWidth="0.7" strokeLinecap="round" fill="none" />
      <path d="M7.8 3.8 Q9 3 10.4 3.8" stroke="currentColor" strokeWidth="0.7" strokeLinecap="round" fill="none" />
    </>
  ) : null;

  const blush = face === 'happy' ? (
    <>
      <circle cx="3.5" cy="7.5" r="1" fill="hsl(var(--brutal-accent))" opacity="0.35" />
      <circle cx="10.5" cy="7.5" r="1" fill="hsl(var(--brutal-accent))" opacity="0.35" />
    </>
  ) : null;

  return (
    <Link to="/dashboard" className="flex items-center gap-2.5 px-1">
      <div
        className="bg-foreground text-background h-8 w-8 flex items-center justify-center shrink-0 cursor-pointer"
        onClick={(e) => {
          e.preventDefault();
          const rand = EXPRESSIONS[Math.floor(Math.random() * EXPRESSIONS.length)];
          setFace(rand.state);
          setTimeout(() => setFace('idle'), rand.duration);
        }}
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14" className="w-5 h-5" style={{ transition: 'transform 0.15s ease-out', transform: face === 'surprise' ? 'scale(1.08)' : 'scale(1)', color: 'hsl(var(--foreground))' }}>
          <circle cx="7" cy="7" r="6.2" fill="hsl(var(--background))" stroke="currentColor" strokeWidth="1.2" />
          {eyebrows}
          {leftEye}
          {rightEye}
          {blush}
          {mouth}
        </svg>
      </div>
      {!collapsed && (
        <span className="text-sm font-bold tracking-tight text-sidebar-foreground">Skalr</span>
      )}
    </Link>
  );
};

// ── Nav items ──

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/missions', label: 'Missions', icon: Target },
  { to: '/pipeline', label: 'Pipeline', icon: Kanban },
  { to: '/inbox', label: 'Messages', icon: MessageSquare, badgeKey: 'unread' as const },
  { to: '/settings', label: 'Paramètres', icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const location = useLocation();
  const navigate = useNavigate();
  const unreadMsgCount = useUnreadMessageNotifications();
  const { orgType } = useOrganization();

  const isActive = (path: string) => {
    if (path === '/missions') return location.pathname === '/missions' || location.pathname.startsWith('/missions/');
    return location.pathname === path || location.pathname.startsWith(path + '/');
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="p-3">
        <SidebarLogo />
      </SidebarHeader>

      <SidebarContent className="px-2">
        {/* Create mission button */}
        {hasFeature(orgType, 'create_missions') && (
          <div className="px-1 mb-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className={cn(
                  "w-full flex items-center gap-2 px-2 py-2 text-xs font-semibold",
                  "bg-sidebar-primary text-sidebar-primary-foreground",
                  "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors",
                  collapsed && "justify-center"
                )}>
                  <Plus className="h-4 w-4 shrink-0" />
                  {!collapsed && <span>Nouvelle mission</span>}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align={collapsed ? "center" : "start"} side="right">
                <DropdownMenuItem onClick={() => navigate('/missions?create=brief')}>
                  📋 Brief IA
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/missions?create=import')}>
                  📥 Importer
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/missions?create=manual')}>
                  ✏️ Manuelle
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => {
                const active = isActive(item.to);
                // Skip marketplace — handled separately if needed
                if (item.to === '/marketplace' && !hasFeature(orgType, 'marketplace_browse')) return null;

                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={item.label}
                      className={cn(
                        "rounded-none h-9 text-xs font-medium transition-colors",
                        active
                          ? "bg-sidebar-primary text-sidebar-primary-foreground border-l-2 border-brutal-accent"
                          : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      )}
                    >
                      <Link to={item.to} className="flex items-center gap-2">
                        <item.icon className="h-4 w-4 shrink-0" />
                        {!collapsed && <span>{item.label}</span>}
                        {item.badgeKey === 'unread' && unreadMsgCount > 0 && !collapsed && (
                          <span className="ml-auto min-w-[18px] h-[18px] flex items-center justify-center px-1 text-xs font-bold bg-destructive text-destructive-foreground rounded-full">
                            {unreadMsgCount > 99 ? '99+' : unreadMsgCount}
                          </span>
                        )}
                        {item.badgeKey === 'unread' && unreadMsgCount > 0 && collapsed && (
                          <span className="absolute top-1 right-1 w-2 h-2 bg-destructive rounded-full" />
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
                      "rounded-none h-9 text-xs font-medium transition-colors",
                      isActive('/marketplace')
                        ? "bg-sidebar-primary text-sidebar-primary-foreground border-l-2 border-brutal-accent"
                        : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    )}
                  >
                    <Link to="/marketplace" className="flex items-center gap-2">
                      <Target className="h-4 w-4 shrink-0" />
                      {!collapsed && <span>Marketplace</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="px-2 pb-3 space-y-1">
        {!collapsed && (
          <div className="px-2">
            <CreditBalanceIndicator />
          </div>
        )}
        <div className={cn("flex items-center", collapsed ? "justify-center" : "px-2")}>
          <NotificationDropdown />
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Déconnexion"
              className="rounded-none h-9 text-xs font-medium hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              onClick={async () => { await supabase.auth.signOut(); }}
            >
              <LogOut className="h-4 w-4 shrink-0" />
              {!collapsed && <span>Déconnexion</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
