/**
 * SidebarUserMenu — bloc profil utilisateur en bas du sidebar avec menu
 * dropdown pour les actions secondaires.
 *
 * Pattern Linear / Notion : avatar + nom + role visible, click → dropdown
 * avec settings, theme, help, logout. Évite la footer cramée d'icônes.
 *
 * Avatar prioritaire : LinkedIn (photo réelle via Unipile) > profile.avatar_url
 * (custom upload) > initiales sur palette deterministe.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings, LogOut, Sun, Moon, ChevronsUpDown, User as UserIcon, Bell } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import { useDashboardConnections } from '@/hooks/useDashboardConnections';
import { useOrganization } from '@/hooks/useOrganization';
import { useNotifications } from '@/hooks/useNotifications';
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

const ROLE_LABEL: Record<string, string> = {
  owner: 'Propriétaire',
  admin: 'Admin',
  member: 'Membre',
  collaborator: 'Collaborateur',
};

export const SidebarUserMenu: React.FC<SidebarUserMenuProps> = ({
  collapsed,
  isDark,
  onToggleTheme,
}) => {
  const navigate = useNavigate();
  const { displayName, avatarUrl: profileAvatarUrl } = useCurrentProfile();
  const connections = useDashboardConnections();
  const { userRole, organizationName } = useOrganization();
  const { unreadCount } = useNotifications();

  const avatarUrl = connections.linkedin.avatarUrl || profileAvatarUrl || null;
  const roleLabel = userRole ? ROLE_LABEL[userRole] || userRole : null;
  const subtitle = [organizationName, roleLabel].filter(Boolean).join(' · ');

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'group w-full flex items-center rounded-lg transition-colors hover:bg-sidebar-accent/60',
            collapsed ? 'h-10 w-10 justify-center mx-auto' : 'gap-2.5 p-2',
          )}
          aria-label="Menu utilisateur"
        >
          {/* Avatar (relatif pour le badge unread) */}
          <div className="relative shrink-0">
            <CandidateAvatar
              name={displayName || '?'}
              avatarUrl={avatarUrl}
              size={collapsed ? 28 : 32}
            />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-1 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold tabular-nums ring-2 ring-sidebar">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </div>

          {!collapsed && (
            <>
              <div className="min-w-0 flex-1 text-left">
                <div className="text-xs font-semibold text-sidebar-foreground truncate leading-tight">
                  {displayName || 'Utilisateur'}
                </div>
                {subtitle && (
                  <div className="text-[10.5px] text-muted-foreground truncate leading-tight mt-0.5">
                    {subtitle}
                  </div>
                )}
              </div>
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
              {subtitle && (
                <div className="text-xs text-muted-foreground truncate">{subtitle}</div>
              )}
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate('/settings')} className="cursor-pointer">
          <UserIcon className="w-4 h-4 mr-2" />
          Mon profil
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate('/settings')} className="cursor-pointer">
          <Settings className="w-4 h-4 mr-2" />
          Paramètres
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => navigate('/settings?tab=notifications')}
          className="cursor-pointer"
        >
          <Bell className="w-4 h-4 mr-2" />
          Notifications
          {unreadCount > 0 && (
            <span className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold tabular-nums">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
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
