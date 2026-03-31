import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Target, Kanban, MessageSquare, Settings, LogOut, Plus, Sparkles } from 'lucide-react';
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

// ── Logo ──

type FaceState = 'idle' | 'wink' | 'surprise' | 'happy' | 'look-left' | 'look-right';

const EXPRESSIONS: { state: FaceState; duration: number }[] = [
  { state: 'wink', duration: 400 },
  { state: 'look-left', duration: 600 },
  { state: 'look-right', duration: 600 },
  { state: 'surprise', duration: 500 },
  { state: 'happy', duration: 700 },
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

  const leftEye = <circle cx={5 + lookX * 0.3} cy={5.5} r="1.15" fill="currentColor" />;
  const rightEye = face === 'wink' ? (
    <path d="M7.9 5.5 Q9 6.5 10.1 5.5" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" fill="none" />
  ) : (
    <circle cx={9 + lookX * 0.3} cy={5.5} r="1.15" fill="currentColor" />
  );

  const mouth = face === 'surprise'
    ? <circle cx="7" cy="9.8" r="0.9" fill="none" stroke="currentColor" strokeWidth="0.9" />
    : face === 'happy'
    ? <path d="M4.2 8.6 Q7 11.8 9.8 8.6" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" fill="none" />
    : <path d="M5.8 9 Q7.5 10.6 9.8 8.8" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" fill="none" />;

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
    <Link to="/dashboard" className="flex items-center gap-3 group">
      <div
        className="bg-foreground text-background h-9 w-9 flex items-center justify-center shrink-0"
        onClick={(e) => {
          e.preventDefault();
          const rand = EXPRESSIONS[Math.floor(Math.random() * EXPRESSIONS.length)];
          setFace(rand.state);
          setTimeout(() => setFace('idle'), rand.duration);
        }}
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14" className="w-[18px] h-[18px]" style={{ transition: 'transform 0.15s', transform: face === 'surprise' ? 'scale(1.08)' : 'scale(1)' }}>
          <circle cx="7" cy="7" r="6.2" fill="hsl(var(--background))" stroke="hsl(var(--foreground))" strokeWidth="1.2" />
          {eyebrows}{leftEye}{rightEye}{blush}{mouth}
        </svg>
      </div>
      {!collapsed && (
        <span className="text-base font-black tracking-tight text-foreground uppercase">Skalr</span>
      )}
    </Link>
  );
};

// ── Compact credit display for sidebar ──

const SidebarCredits: React.FC<{ collapsed: boolean }> = ({ collapsed }) => {
  const navigate = useNavigate();
  const { creditsRemaining, isLow, isOut, isLoading } = useAICredits();
  if (isLoading) return null;

  const display = creditsRemaining > 9999
    ? `${Math.round(creditsRemaining / 1000)}k`
    : creditsRemaining.toLocaleString();

  return (
    <button
      onClick={() => navigate('/settings?tab=credits')}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-2 text-xs font-medium transition-colors",
        isOut ? "text-destructive" : isLow ? "text-orange-500" : "text-muted-foreground",
        "hover:text-foreground"
      )}
    >
      <Sparkles className="h-3.5 w-3.5 shrink-0" />
      {!collapsed && <span>{display} crédits</span>}
    </button>
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
  const { state, setOpenMobile } = useSidebar();
  const collapsed = state === 'collapsed';
  const location = useLocation();
  const navigate = useNavigate();
  const unreadMsgCount = useUnreadMessageNotifications();
  const { orgType, organization } = useOrganization();

  const isActive = (path: string) => {
    if (path === '/missions') return location.pathname === '/missions' || location.pathname.startsWith('/missions/');
    return location.pathname === path || location.pathname.startsWith(path + '/');
  };

  const handleNav = (to: string) => {
    navigate(to);
    setOpenMobile(false);
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-foreground/10 bg-background">
      {/* Header — Logo */}
      <SidebarHeader className="px-4 py-5 border-b border-foreground/10">
        <SidebarLogo />
      </SidebarHeader>

      <SidebarContent className="px-3 pt-4">
        {/* Create mission CTA */}
        {hasFeature(orgType, 'create_missions') && (
          <div className="mb-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className={cn(
                  "w-full flex items-center gap-2.5 h-9 px-3 text-xs font-bold uppercase tracking-wider",
                  "bg-foreground text-background",
                  "hover:bg-brutal-accent hover:text-foreground transition-colors",
                  collapsed && "justify-center px-0"
                )}>
                  <Plus className="h-4 w-4 shrink-0" />
                  {!collapsed && <span>Nouvelle mission</span>}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="right" sideOffset={8}>
                <DropdownMenuItem onClick={() => handleNav('/missions?create=brief')}>
                  📋 Brief IA
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleNav('/missions?create=import')}>
                  📥 Importer
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleNav('/missions?create=manual')}>
                  ✏️ Manuelle
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {/* Navigation */}
        <SidebarGroup className="p-0">
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {NAV_ITEMS.map((item) => {
                const active = isActive(item.to);
                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={item.label}
                      className={cn(
                        "rounded-none h-10 text-sm font-medium transition-all duration-150",
                        active
                          ? "bg-foreground text-background font-semibold"
                          : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"
                      )}
                    >
                      <Link to={item.to} onClick={() => setOpenMobile(false)} className="flex items-center gap-3">
                        <item.icon className={cn("h-[18px] w-[18px] shrink-0", active && "text-brutal-accent")} />
                        {!collapsed && (
                          <>
                            <span>{item.label}</span>
                            {item.badgeKey === 'unread' && unreadMsgCount > 0 && (
                              <span className="ml-auto min-w-[20px] h-5 flex items-center justify-center px-1.5 text-xs font-bold bg-destructive text-destructive-foreground rounded-full">
                                {unreadMsgCount > 99 ? '99+' : unreadMsgCount}
                              </span>
                            )}
                          </>
                        )}
                        {item.badgeKey === 'unread' && unreadMsgCount > 0 && collapsed && (
                          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-destructive rounded-full" />
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
                      "rounded-none h-10 text-sm font-medium transition-all duration-150",
                      isActive('/marketplace')
                        ? "bg-foreground text-background font-semibold"
                        : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"
                    )}
                  >
                    <Link to="/marketplace" onClick={() => setOpenMobile(false)} className="flex items-center gap-3">
                      <Target className={cn("h-[18px] w-[18px] shrink-0", isActive('/marketplace') && "text-brutal-accent")} />
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
      <SidebarFooter className="border-t border-foreground/10 px-3 py-3 space-y-1">
        <SidebarCredits collapsed={collapsed} />

        <div className={cn("flex items-center", collapsed ? "justify-center" : "px-1")}>
          <NotificationDropdown />
        </div>

        {/* Org name + sign out */}
        <div className={cn(
          "flex items-center gap-2 px-3 py-2",
          collapsed && "justify-center px-0"
        )}>
          {!collapsed && organization?.name && (
            <span className="text-xs text-muted-foreground truncate flex-1">{organization.name}</span>
          )}
          <button
            onClick={async () => { await supabase.auth.signOut(); }}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
            title="Déconnexion"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
