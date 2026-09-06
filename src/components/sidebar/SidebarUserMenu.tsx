/**
 * SidebarUserMenu — bloc profil utilisateur en bas du sidebar.
 *
 * V3 minimaliste : juste avatar + nom + chevron. Tout le reste (settings,
 * theme, logout, notifs) dans un dropdown qui s'ouvre vers le haut.
 *
 * Pattern Linear / Vercel : 1 ligne, pas de sous-titre encombrant.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings, LogOut, Sun, Moon, ChevronsUpDown, User as UserIcon, Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import { useDashboardConnections } from '@/hooks/useDashboardConnections';
import { useOrganization } from '@/hooks/useOrganization';
import { useNotifications } from '@/hooks/useNotifications';
import { useAICredits } from '@/hooks/useAICredits';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CandidateAvatar } from '@/components/dashboard/CandidateAvatar';
import { cn } from '@/lib/utils';

interface SidebarUserMenuProps {
  collapsed: boolean;
  isDark: boolean;
  onToggleTheme: () => void;
}

export const SidebarUserMenu: React.FC<SidebarUserMenuProps> = ({
  collapsed,
  isDark,
  onToggleTheme,
}) => {
  const navigate = useNavigate();
  const { displayName, avatarUrl: profileAvatarUrl } = useCurrentProfile();
  const connections = useDashboardConnections();
  const { organizationName } = useOrganization();
  const { unreadCount } = useNotifications();
  const { creditsRemaining, isLow, isOut } = useAICredits();

  const avatarUrl = connections.linkedin.avatarUrl || profileAvatarUrl || null;

  const compactCredits = creditsRemaining > 9999
    ? `${(creditsRemaining / 1000).toFixed(creditsRemaining > 99999 ? 0 : 1)}k`
    : creditsRemaining.toLocaleString('fr-FR');

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'group w-full flex items-center rounded-lg transition-colors hover:bg-sidebar-accent/60',
            collapsed ? 'h-10 w-10 justify-center mx-auto' : 'gap-2.5 px-2 py-1.5',
          )}
          aria-label="Menu utilisateur"
        >
          <div className="relative shrink-0">
            <CandidateAvatar
              name={displayName || '?'}
              avatarUrl={avatarUrl}
              size={collapsed ? 28 : 28}
            />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-1 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-3xs font-bold tabular-nums ring-2 ring-sidebar">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </div>

          {!collapsed && (
            <>
              <span className="text-[13px] font-medium text-sidebar-foreground truncate flex-1 text-left">
                {displayName || 'Utilisateur'}
              </span>
              <ChevronsUpDown
                className="w-3.5 h-3.5 text-muted-foreground shrink-0 opacity-50 group-hover:opacity-100 transition-opacity"
                aria-hidden="true"
              />
            </>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align={collapsed ? 'start' : 'end'}
        side="top"
        sideOffset={8}
        className="w-60 rounded-xl"
      >
        <DropdownMenuLabel className="font-normal">
          <div className="flex items-center gap-2.5">
            <CandidateAvatar
              name={displayName || '?'}
              avatarUrl={avatarUrl}
              size={36}
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-foreground truncate">
                {displayName || 'Utilisateur'}
              </div>
              {organizationName && (
                <div className="text-xs text-muted-foreground truncate">{organizationName}</div>
              )}
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* Credits inline */}
        <DropdownMenuItem
          onClick={() => navigate('/settings?tab=credits')}
          className="cursor-pointer"
        >
          <Sparkles
            className={cn(
              'w-4 h-4 mr-2',
              isOut ? 'text-destructive' : isLow ? 'text-warning' : '',
            )}
          />
          <span className="flex-1">Crédits IA</span>
          <span
            className={cn(
              'text-xs font-bold tabular-nums',
              isOut ? 'text-destructive' : isLow ? 'text-warning' : 'text-muted-foreground',
            )}
          >
            {compactCredits}
          </span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate('/settings')} className="cursor-pointer">
          <UserIcon className="w-4 h-4 mr-2" />
          Mon profil
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate('/settings')} className="cursor-pointer">
          <Settings className="w-4 h-4 mr-2" />
          Paramètres
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onToggleTheme} className="cursor-pointer">
          {isDark ? (
            <Sun className="w-4 h-4 mr-2" />
          ) : (
            <Moon className="w-4 h-4 mr-2" />
          )}
          {isDark ? 'Mode clair' : 'Mode sombre'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handleSignOut}
          className="cursor-pointer text-destructive focus:text-destructive"
        >
          <LogOut className="w-4 h-4 mr-2" />
          Déconnexion
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
