/**
 * AppSidebar : barre latérale à onglets (lots 5 et 6).
 *
 * Haut : organisation (→ /dashboard) et « Aller à… » (palette Ctrl J).
 * Onglets : À traiter (par défaut), Missions, Assistant ; l'onglet est mémorisé.
 * Panneau : celui de l'onglet actif, seul monté ; masqué en mode replié.
 * Bas : rangée Tâches, Agenda, Marketplace, Paramètres, Aide ; menu de l'avatar ;
 * marque Konekt.
 *
 * Toujours montés, hors du contenu de la feuille mobile (démonté à sa
 * fermeture) : les hooks de signal (chiffre d'À traiter, agent au travail,
 * tâches en retard, canal temps réel) et le relevé de la mission ouverte.
 * Les fenêtres du menu Aide sont rendues hors de <Sidebar>, pour survivre à la
 * fermeture de la feuille.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useOrganization } from '@/hooks/useOrganization';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  useSidebar,
} from '@/components/ui/sidebar';
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
import { TodoPanel } from './sidebar/todo/TodoPanel';
import { MissionsPanel } from './sidebar/missions/MissionsPanel';
import { MissionVisitTracker } from './sidebar/missions/MissionVisitTracker';
import { AssistantPanel } from './sidebar/assistant/AssistantPanel';
import { TutorialVideoDialog } from './help/TutorialVideoDialog';
import { PIPELINE_TUTORIAL } from './help/tutorials';
import { KonektLogo } from './KonektLogo';
import { setAppTheme, useAppTheme } from '@/lib/theme';

export function AppSidebar() {
  const { state, isMobile, setOpenMobile } = useSidebar();
  // Le tiroir mobile s'affiche toujours déplié ; l'état replié (cookie) vaut pour le bureau.
  const collapsed = state === 'collapsed' && !isMobile;
  const { organization } = useOrganization();
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const paletteShortcut = isMac ? '⌘J' : 'Ctrl J';

  // Onglet unique : passé en props aux onglets, il choisit aussi le panneau.
  const [tab, setTab] = useSidebarTab();
  const { count: todoCount } = useTodoSignal();
  const { running } = useAgentSignals();
  const overdueCount = useOverdueTasksCount();
  useSidebarRealtime();
  const { offline } = useSidebarOffline();

  // Fenêtres du menu Aide : état tenu ici, rendu hors de <Sidebar>.
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);

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
        'flex items-center rounded-lg transition-colors hover:bg-sidebar-accent/40',
        collapsed ? 'h-9 w-9 justify-center mx-auto' : 'gap-2.5 px-1.5 py-1',
      )}
    >
      {organization?.logo_url ? (
        <img
          src={organization.logo_url}
          alt={orgName}
          className="h-7 w-7 rounded-md object-cover shrink-0"
        />
      ) : (
        <div className="h-7 w-7 rounded-md bg-foreground text-background flex items-center justify-center shrink-0 font-display font-bold text-xs">
          {orgInitial}
        </div>
      )}
      {!collapsed && (
        <span className="text-[13px] font-display font-bold tracking-tight text-sidebar-foreground truncate">
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
        {/* Haut : organisation, « Aller à… », onglets */}
        <SidebarHeader className={cn(collapsed ? 'px-2 py-3 gap-2' : 'px-3 py-3 gap-2')}>
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>{orgLink}</TooltipTrigger>
              <TooltipContent side="right">Tableau de bord</TooltipContent>
            </Tooltip>
          ) : (
            orgLink
          )}

          {/* Aller à… : palette de navigation */}
          {!collapsed ? (
            <button
              onClick={openPalette}
              className="w-full flex items-center gap-2 h-9 px-2.5 rounded-md bg-sidebar-accent/40 text-muted-foreground text-[12px] hover:bg-sidebar-accent/60 transition-colors"
              aria-label={`Aller à (${paletteShortcut})`}
            >
              <Search className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
              <span className="flex-1 text-left">Aller à…</span>
              <kbd className="text-[10px] font-mono text-muted-foreground/70">{paletteShortcut}</kbd>
            </button>
          ) : (
            <button
              onClick={openPalette}
              className="h-9 w-9 mx-auto flex items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground transition-colors"
              aria-label="Aller à"
              title={`Aller à (${paletteShortcut})`}
            >
              <Search className="h-5 w-5" strokeWidth={1.5} />
            </button>
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
                <h2 className="px-2 pb-1 text-[12px] font-semibold text-muted-foreground">
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
            onOpenTutorial={() => setTutorialOpen(true)}
          />
          <SidebarUserMenu collapsed={collapsed} isDark={isDark} onToggleTheme={toggleTheme} />
          {/* Branding Konekt — pattern Linear / Vercel : marque produit en
              tout bas, après l'identité user. Subtil, n'écrase pas l'org. */}
          <div className={cn(
            'flex items-center pt-2 mt-2 border-t border-sidebar-border',
            collapsed ? 'justify-center' : 'gap-1.5 px-1',
          )}>
            <KonektLogo
              variant="mark"
              theme={isDark ? 'light' : 'dark'}
              size={14}
              className="opacity-50"
            />
            {!collapsed && (
              <span className="text-[10px] uppercase tracking-wider text-sidebar-foreground/40 font-medium">
                Konekt
              </span>
            )}
          </div>
        </SidebarFooter>
      </Sidebar>

      <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <TutorialVideoDialog
        {...PIPELINE_TUTORIAL}
        open={tutorialOpen}
        onOpenChange={setTutorialOpen}
        hideTrigger
      />
    </>
  );
}
