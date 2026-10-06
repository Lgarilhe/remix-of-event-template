/**
 * SidebarUserMenu : bloc profil de la personne en bas de la barre latérale.
 *
 * Une ligne : avatar, nom, chevron. Le reste (crédits IA, compte, thème,
 * déconnexion) est dans un menu qui s'ouvre vers le haut. Les Paramètres sont
 * dans la rangée basse de la barre ; les notifications sont dans l'onglet
 * À traiter (lots 5 et 6).
 *
 * Revue design (lot 12) : déclencheur et entrées de 44 px sur téléphone
 * (A-20) ; solde de crédits « … » pendant le chargement, « Indisponible » si
 * la lecture échoue, jamais « n/d » (A-21).
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Sun, Moon, ChevronsUpDown, User as UserIcon, Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import { useDashboardConnections } from '@/hooks/useDashboardConnections';
import { useOrganization } from '@/hooks/useOrganization';
import { useAICredits } from '@/hooks/useAICredits';
import { Button } from '@/components/ui/button';
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
import { SIDEBAR_GHOST_CLASS } from './sidebarButtonClass';

interface SidebarUserMenuProps {
  collapsed: boolean;
  isDark: boolean;
  onToggleTheme: () => void;
}

/** Entrée du menu : 44 px sur téléphone, compacte sur ordinateur (comme le menu Aide). */
const ITEM_CLASS = 'cursor-pointer min-h-11 md:min-h-8';

/** Solde abrégé, écrit à la française (« 12,5 k »). */
function formatCredits(credits: number): string {
  if (credits <= 9999) return credits.toLocaleString('fr-FR');
  const thousands = (credits / 1000).toLocaleString('fr-FR', {
    maximumFractionDigits: credits > 99999 ? 0 : 1,
  });
  return `${thousands}\u202Fk`;
}

export const SidebarUserMenu: React.FC<SidebarUserMenuProps> = ({
  collapsed,
  isDark,
  onToggleTheme,
}) => {
  const navigate = useNavigate();
  const { displayName } = useCurrentProfile();
  const connections = useDashboardConnections();
  const { organizationName } = useOrganization();
  const { creditsRemaining, isLow, isOut, hasBalance: hasCredits, isLoading: creditsLoading } = useAICredits();

  // Photo LinkedIn si un compte est connecté, sinon initiales (aucun avatar
  // n'est stocké dans le profil).
  const avatarUrl = connections.linkedin.avatarUrl || null;

  // Solde non chargé : on l'annonce comme tel plutôt que d'afficher un zéro,
  // qui se lirait « plus aucun crédit » alors que le solde est peut-être intact.
  // Le chargement, organisation comprise, se distingue de l'échec de lecture.
  const creditsText = creditsLoading ? null : !hasCredits ? 'Indisponible' : formatCredits(creditsRemaining);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          aria-label="Menu utilisateur"
          className={cn(
            SIDEBAR_GHOST_CLASS,
            'rounded-lg font-normal',
            collapsed
              ? 'mx-auto h-10 w-10 p-0'
              : 'h-auto min-h-11 w-full justify-start gap-2.5 px-2 py-1.5 md:min-h-10',
          )}
        >
          <CandidateAvatar
            name={displayName || '?'}
            avatarUrl={avatarUrl}
            size={28}
          />

          {!collapsed && (
            <>
              <span className="text-sm font-medium text-sidebar-foreground truncate flex-1 text-left">
                {displayName || 'Utilisateur'}
              </span>
              <ChevronsUpDown className="text-muted-foreground" aria-hidden="true" />
            </>
          )}
        </Button>
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

        {/* Crédits IA : le solde dans l'entrée */}
        <DropdownMenuItem
          onClick={() => navigate('/settings/org/billing#credits')}
          className={ITEM_CLASS}
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
              'text-xs font-semibold tabular-nums',
              isOut ? 'text-destructive' : isLow ? 'text-warning' : 'text-muted-foreground',
            )}
          >
            {creditsText ?? (
              <>
                <span aria-hidden="true">…</span>
                <span className="sr-only">Chargement</span>
              </>
            )}
          </span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate('/settings/account/connections')} className={ITEM_CLASS}>
          <UserIcon className="w-4 h-4 mr-2" />
          Mon compte
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onToggleTheme} className={ITEM_CLASS}>
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
          className={cn(ITEM_CLASS, 'text-destructive focus:text-destructive')}
        >
          <LogOut className="w-4 h-4 mr-2" />
          Déconnexion
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
