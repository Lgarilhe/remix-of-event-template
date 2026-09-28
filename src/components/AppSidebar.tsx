/**
 * AppSidebar : barre latérale à onglets (lots 5 et 6 ; revue design, lot 12).
 *
 * Haut : organisation (→ /dashboard) et, sur ordinateur, le bouton
 * « Afficher ou masquer la navigation » (Ctrl B) : il remplace la bande
 * d'en-tête de 48 px qui ne portait que lui (A-01). Puis « Aller à… » (palette
 * Ctrl J). Le bouton reste au même rang dans les deux états (déplié, replié) :
 * le focus clavier le suit.
 * Onglets : À traiter (par défaut), Missions, Assistant ; l'onglet est mémorisé.
 * Panneau : celui de l'onglet actif, seul monté ; masqué en mode replié.
 * Bas : rangée Tâches, Agenda, Marketplace, Paramètres, Aide ; menu de l'avatar ;
 * marque Konekt.
 *
 * Toujours montés, hors du contenu de la feuille mobile (démonté à sa
 * fermeture) : les hooks de signal (chiffre d'À traiter, agent au travail,
 * tâches en retard, canal temps réel) et le relevé de la mission ouverte.
 * Les fenêtres du menu Aide sont rendues hors de <Sidebar>, pour survivre à la
 * fermeture de la feuille. La vidéo proposée est celle de la page affichée
 * (tutorialForRoute, A-15) ; sans vidéo, le menu n'offre que les raccourcis.
 */

import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useOrganization } from '@/hooks/useOrganization';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SIDEBAR_TABS } from '@/lib/sidebarTabs';
import { useSidebarTab } from '@/hooks/sidebar/useSidebarTab';
import { useTodoSignal } from '@/hooks/sidebar/useTodoSignal';
import { useAgentSignals } from '@/hooks/sidebar/useAgentSignals';
import { useOverdueTasksCount } from '@/hooks/sidebar/useOverdueTasksCount';
import { useSidebarRealtime } from '@/hooks/sidebar/useSidebarRealtime';
import { useSidebarOffline } from '@/hooks/sidebar/useSidebarOffline';
import { SidebarUserMenu } from './sidebar/SidebarUserMenu';
import { SidebarTabs } from './sidebar/SidebarTabs';
import { SidebarBottomRow } from './sidebar/SidebarBottomRow';
import { OfflineBanner } from './sidebar/OfflineBanner';
import { KeyboardShortcutsDialog } from './sidebar/KeyboardShortcutsDialog';
import { SIDEBAR_GHOST_CLASS } from './sidebar/sidebarButtonClass';
import { TodoPanel } from './sidebar/todo/TodoPanel';
import { MissionsPanel } from './sidebar/missions/MissionsPanel';
import { MissionVisitTracker } from './sidebar/missions/MissionVisitTracker';
import { AssistantPanel } from './sidebar/assistant/AssistantPanel';
import { TutorialVideoDialog } from './help/TutorialVideoDialog';
import { tutorialForRoute, type Tutorial } from './help/tutorials';
import { KonektLogo } from './KonektLogo';
import { setAppTheme, useAppTheme } from '@/lib/theme';

export function AppSidebar() {
  const { state, isMobile, setOpenMobile } = useSidebar();
  // Le tiroir mobile s'affiche toujours déplié ; l'état replié (cookie) vaut pour le bureau.
  const collapsed = state === 'collapsed' && !isMobile;
  const { organization } = useOrganization();
  const { pathname, search } = useLocation();
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const paletteShortcut = isMac ? '⌘J' : 'Ctrl J';
  const toggleShortcut = isMac ? '⌘B' : 'Ctrl B';

  // Onglet unique : passé en props aux onglets, il choisit aussi le panneau.
  const [tab, setTab] = useSidebarTab();
  const { count: todoCount } = useTodoSignal();
  const { running } = useAgentSignals();
  const overdueCount = useOverdueTasksCount();
  useSidebarRealtime();
  const { offline } = useSidebarOffline();

  // Fenêtres du menu Aide : état tenu ici, rendu hors de <Sidebar>.
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Aide contextuelle (A-15) : la vidéo de la page affichée, ou aucune.
  const tutorial = tutorialForRoute(pathname, search);
  // Contenu de la fenêtre, gardé à la fermeture (animation de sortie) et si la page change.
  const [shownTutorial, setShownTutorial] = useState<Tutorial | null>(null);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const openTutorial = tutorial
    ? () => {
        setShownTutorial(tutorial);
        setTutorialOpen(true);
      }
    : undefined;

  const orgName = organization?.name || 'Konekt';
  const orgInitial = orgName.charAt(0).toUpperCase();

  // Thème partagé avec la palette Ctrl J (src/lib/theme.ts) : une bascule
  // faite ailleurs met à jour le libellé du menu et la variante du logo.
  const isDark = useAppTheme() === 'dark';
  const toggleTheme = () => setAppTheme(isDark ? 'light' : 'dark');

  const closeMobile = () => setOpenMobile(false);
  // « Aller à… » ouvre la palette Ctrl J (NavigationPalette), pas l'assistant.
  const openPalette = () => {
    closeMobile();
    window.dispatchEvent(new CustomEvent('konekt:open-palette'));
  };

  const orgLink = (
    <Link
      to="/dashboard"
      onClick={closeMobile}
      aria-label={`${orgName}, tableau de bord`}
      className={cn(
        'flex items-center rounded-lg outline-none transition-colors hover:bg-sidebar-accent/40 focus-visible:ring-2 focus-visible:ring-sidebar-ring',
        collapsed ? 'h-9 w-9 justify-center' : 'min-w-0 flex-1 gap-2.5 px-1.5 py-1',
      )}
    >
      {organization?.logo_url ? (
        <img
          src={organization.logo_url}
          alt={orgName}
          className="h-7 w-7 rounded-md object-cover shrink-0"
        />
      ) : (
        <div className="h-7 w-7 rounded-md bg-foreground text-background flex items-center justify-center shrink-0 font-semibold text-xs">
          {orgInitial}
        </div>
      )}
      {!collapsed && (
        <span className="text-sm font-semibold tracking-tight text-sidebar-foreground truncate">
          {orgName}
        </span>
      )}
    </Link>
  );

  const activeTab = SIDEBAR_TABS.find((t) => t.id === tab) ?? SIDEBAR_TABS[0];

  return (
    <>
      <MissionVisitTracker />

      <Sidebar collapsible="icon" className="border-r border-border bg-sidebar">
        {/* Haut : organisation et bouton de la barre, « Aller à… », onglets */}
        <SidebarHeader className={cn(collapsed ? 'px-2 py-3 gap-2' : 'px-3 py-3 gap-2')}>
          <div className={cn('flex items-center', collapsed ? 'flex-col gap-2' : 'gap-1')}>
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>{orgLink}</TooltipTrigger>
                <TooltipContent side="right">Tableau de bord</TooltipContent>
              </Tooltip>
            ) : (
              orgLink
            )}
            {/* Ordinateur : replier ou déplier la barre (A-01). Sur téléphone, le
                bouton de la bande d'en-tête ouvre la feuille (AppHeader). */}
            {!isMobile && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <SidebarTrigger className={cn(SIDEBAR_GHOST_CLASS, 'h-8 w-8 shrink-0 rounded-md text-muted-foreground')} />
                </TooltipTrigger>
                <TooltipContent side="right">
                  {collapsed ? 'Déplier la barre' : 'Replier la barre'} ({toggleShortcut})
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          {/* Aller à… : palette de navigation */}
          {!collapsed ? (
            <Button
              type="button"
              variant="ghost"
              onClick={openPalette}
              aria-label={`Aller à (${paletteShortcut})`}
              className={cn(
                SIDEBAR_GHOST_CLASS,
                'w-full min-h-11 justify-start gap-2 rounded-md bg-sidebar-accent/40 px-2.5 text-xs font-normal text-muted-foreground md:min-h-9',
              )}
            >
              <Search className="shrink-0" strokeWidth={1.5} aria-hidden="true" />
              <span className="flex-1 text-left">Aller à…</span>
              <kbd className="font-mono text-3xs text-muted-foreground">{paletteShortcut}</kbd>
            </Button>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={openPalette}
                  aria-label="Aller à"
                  className={cn(SIDEBAR_GHOST_CLASS, 'mx-auto rounded-md text-muted-foreground')}
                >
                  <Search strokeWidth={1.5} aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Aller à ({paletteShortcut})</TooltipContent>
            </Tooltip>
          )}

          <SidebarTabs
            tab={tab}
            onSelect={setTab}
            collapsed={collapsed}
            todoCount={todoCount}
            agentWorking={running.length > 0}
            offline={offline}
          />
        </SidebarHeader>

        {/* Panneau de l'onglet actif (seul monté), masqué en mode replié */}
        <SidebarContent className={cn('overflow-hidden', collapsed ? 'px-1.5' : 'px-2')}>
          <div
            role="tabpanel"
            id="sidebar-panel"
            aria-labelledby={`sidebar-tab-${tab}`}
            hidden={collapsed}
            className="flex min-h-0 flex-1 flex-col"
          >
            {!collapsed && (
              <>
                <OfflineBanner />
                <h2 className="px-2 pb-1 text-xs font-semibold text-muted-foreground">
                  {activeTab.page ? (
                    <Link
                      to={activeTab.page}
                      onClick={closeMobile}
                      className="inline-flex items-center rounded-md min-h-11 md:min-h-7 hover:text-sidebar-foreground outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                    >
                      {activeTab.label}
                    </Link>
                  ) : (
                    activeTab.label
                  )}
                </h2>
                <div className="min-h-0 flex-1 overflow-y-auto pb-2">
                  {tab === 'todo' && <TodoPanel />}
                  {tab === 'missions' && <MissionsPanel />}
                  {tab === 'assistant' && <AssistantPanel />}
                </div>
              </>
            )}
          </div>
        </SidebarContent>

        {/* Bas : rangée basse, menu de l'avatar, marque Konekt */}
        <SidebarFooter className="px-2 py-2">
          <SidebarBottomRow
            collapsed={collapsed}
            overdueCount={overdueCount}
            onOpenShortcuts={() => setShortcutsOpen(true)}
            onOpenTutorial={openTutorial}
          />
          <SidebarUserMenu collapsed={collapsed} isDark={isDark} onToggleTheme={toggleTheme} />
          {/* Marque Konekt tout en bas, après l'identité de la personne : discrète
              mais lisible, en gris et sans capitales (A-21). Le logo est décoratif
              quand le nom est écrit à côté. */}
          <div className={cn(
            'flex items-center pt-2 mt-2 border-t border-sidebar-border',
            collapsed ? 'justify-center' : 'gap-1.5 px-1',
          )}>
            <KonektLogo
              variant="mark"
              theme={isDark ? 'light' : 'dark'}
              size={14}
              className="opacity-50"
              ariaLabel={collapsed ? 'Konekt' : ''}
            />
            {!collapsed && (
              <span className="text-2xs font-medium text-muted-foreground">
                Konekt
              </span>
            )}
          </div>
        </SidebarFooter>
      </Sidebar>

      <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      {shownTutorial && (
        <TutorialVideoDialog
          {...shownTutorial}
          open={tutorialOpen}
          onOpenChange={setTutorialOpen}
          hideTrigger
        />
      )}
    </>
  );
}
