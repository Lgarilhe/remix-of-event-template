/**
 * Rangée basse de la barre (§2.4, D3, D38) : Tâches, Agenda, Séquences
 * (lot 5c-2, décision 8 du 05/10 ; pour tous depuis le lot 5h, absente avec le
 * secours ?sequences-v2=0),
 * Appels (une fois un premier appel reçu de l'opérateur relié), Marketplace
 * (selon le type d'organisation), Paramètres, Aide.
 *
 * Quatre liens (jusqu'à six avec Séquences et Appels) et un bouton (Aide) ; nom au survol (infobulle) et aria-label,
 * aria-current="page" sur la route active. Déplié : une ligne de cibles de
 * 36 px sur ordinateur, 44 px sur téléphone ; à sept cibles, deux lignes sur
 * téléphone et des cibles de 32 px de large sur ordinateur. Replié : une pile de 32 px.
 * Tâches porte le nombre de mes tâches en retard, en gris (jamais rouge), au
 * palier de 10 px au plus petit (lot 12, A-18). Aide ne propose la vidéo que
 * sur une page qui en a une (onOpenTutorial absent sinon, A-15).
 */
import { Link, useLocation } from 'react-router-dom';
import { Calendar, ListTodo, Phone, Send, Settings, Store, type LucideIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useOrganization } from '@/hooks/useOrganization';
import { useHasPhoneCalls } from '@/hooks/sidebar/useHasPhoneCalls';
import { useCloseMobileSidebar } from '@/hooks/sidebar/useCloseMobileSidebar';
import { useSequencesBeta } from '@/hooks/useSequencesBeta';
import { hasFeature } from '@/lib/featureGates';
import { badgeLabel } from '@/lib/sidebarSignals';
import { cn } from '@/lib/utils';
import { HelpMenu } from './HelpMenu';

export interface SidebarBottomRowProps {
  collapsed: boolean;
  /** Mes tâches en retard ; null : inconnu, rien d'affiché. */
  overdueCount: number | null;
  onOpenShortcuts: () => void;
  /** Vidéo de la page affichée ; absent : pas d'entrée vidéo dans l'Aide. */
  onOpenTutorial?: () => void;
}

interface BottomLink {
  to: string;
  label: string;
  icon: LucideIcon;
}

const TARGET_BASE =
  'relative inline-flex items-center justify-center rounded-md text-sidebar-foreground outline-none transition-colors ' +
  'hover:bg-sidebar-accent/60 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring';

export function SidebarBottomRow({ collapsed, overdueCount, onOpenShortcuts, onOpenTutorial }: SidebarBottomRowProps) {
  const { pathname } = useLocation();
  const { orgType } = useOrganization();
  const closeMobile = useCloseMobileSidebar();
  const showSequences = useSequencesBeta();

  const showMarketplace = hasFeature(orgType, 'marketplace_browse') || hasFeature(orgType, 'marketplace_publish');
  // Téléphonie : le lien n'existe qu'une fois un premier appel reçu de l'opérateur relié.
  const showCalls = useHasPhoneCalls();
  const overdue = overdueCount !== null && overdueCount > 0 ? overdueCount : null;

  const links: BottomLink[] = [
    { to: '/tasks', label: 'Tâches', icon: ListTodo },
    { to: '/calendar', label: 'Agenda', icon: Calendar },
    ...(showSequences ? [{ to: '/sequences', label: 'Séquences', icon: Send }] : []),
    ...(showCalls ? [{ to: '/calls', label: 'Appels', icon: Phone }] : []),
    ...(showMarketplace ? [{ to: '/marketplace', label: 'Marketplace', icon: Store }] : []),
    { to: '/settings', label: 'Paramètres', icon: Settings },
  ];

  const isActive = (to: string) => pathname === to || pathname.startsWith(`${to}/`);
  // Cibles de la rangée dépliée : les liens et l'Aide. Six (Séquences ou Appels,
  // avec Marketplace) : 6 × 44 px tiennent dans les 271 px du tiroir sans
  // espace fixe entre elles, et le chiffre des tâches en retard se place dans
  // l'angle au lieu d'élargir sa cible.
  const targetCount = links.length + 1;
  const tight = !collapsed && targetCount >= 6;
  // Sept (Séquences, Appels et Marketplace ensemble) : 7 × 44 px dépassent le
  // tiroir. Téléphone : deux lignes de quatre colonnes de 44 px, bords alignés.
  // Ordinateur : une ligne de cibles de 32 px de large, Aide comprise (7 × 32 = 224 px dans
  // les 239 px de la barre), le chiffre des tâches dans l'angle.
  const dense = !collapsed && targetCount >= 7;
  const targetClass = collapsed ? 'h-8 w-8' : cn('min-h-11 min-w-11 md:min-h-9 px-1', dense ? 'md:w-8 md:min-w-8' : 'md:min-w-9');
  const tooltipSide = collapsed ? 'right' : 'top';

  return (
    <div
      className={cn(
        collapsed
          ? 'flex flex-col items-center gap-1'
          : cn(
              'flex items-center justify-between',
              dense ? 'max-md:grid max-md:grid-cols-[repeat(4,2.75rem)] max-md:gap-y-1' : tight ? 'md:gap-0.5' : 'gap-0.5',
            ),
      )}
    >
      {links.map(({ to, label, icon: Icon }) => {
        const isTasks = to === '/tasks';
        const name = isTasks && overdue !== null ? `Tâches, ${overdue} en retard` : label;
        const active = isActive(to);
        return (
          <Tooltip key={to}>
            <TooltipTrigger asChild>
              <Link
                to={to}
                onClick={closeMobile}
                aria-label={name}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  TARGET_BASE,
                  targetClass,
                  isTasks && !collapsed && overdue !== null && !dense && (tight ? 'md:gap-1 md:px-2' : 'gap-1 px-2'),
                  active && 'bg-sidebar-accent text-sidebar-accent-foreground',
                )}
              >
                <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                {isTasks && overdue !== null && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      'tabular-nums text-muted-foreground',
                      collapsed ? 'absolute bottom-0 right-0 text-3xs leading-none' : 'text-2xs',
                      // Six cibles sur téléphone, sept partout : dans l'angle, au plancher de 10 px.
                      dense
                        ? 'absolute right-0.5 top-0.5 leading-none'
                        : tight && 'max-md:absolute max-md:right-0.5 max-md:top-0.5 max-md:leading-none',
                    )}
                  >
                    {badgeLabel(overdue)}
                  </span>
                )}
              </Link>
            </TooltipTrigger>
            <TooltipContent side={tooltipSide}>{name}</TooltipContent>
          </Tooltip>
        );
      })}
      <HelpMenu
        onOpenShortcuts={onOpenShortcuts}
        onOpenTutorial={onOpenTutorial}
        triggerClassName={cn(TARGET_BASE, targetClass)}
        tooltipSide={tooltipSide}
        collapsed={collapsed}
      />
    </div>
  );
}
