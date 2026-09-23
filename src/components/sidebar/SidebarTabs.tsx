/**
 * Onglets de la barre latérale (§2.2, D2, D5, D8) : À traiter, Missions,
 * Assistant.
 *
 * Reçoit l'onglet actif en props (useSidebarTab est appelé une seule fois,
 * dans AppSidebar, qui choisit aussi le panneau).
 *
 * Clic :
 * - barre repliée (ordinateur) : setOpen(true) puis sélection de l'onglet ;
 * - onglet non actif : sélection, rien d'autre (aucun marquage lu) ;
 * - onglet actif avec une page (Missions, Assistant) : ouvre la page.
 * Clavier : flèches, Début et Fin déplacent le focus et activent l'onglet
 * visé ; Entrée et Espace sur l'onglet actif valent un second clic.
 *
 * Signaux : chiffre d'À traiter (badgeLabel, rien si null ou 0), point fixe
 * sur Assistant quand un agent travaille, rien sur Missions.
 */
import type React from 'react';
import { Fragment, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Briefcase, Inbox, Sparkles, type LucideIcon } from 'lucide-react';
import { useSidebar } from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { badgeLabel } from '@/lib/sidebarSignals';
import { nextTabIndex, SIDEBAR_TABS, type SidebarTabId } from '@/lib/sidebarTabs';
import { useCloseMobileSidebar } from '@/hooks/sidebar/useCloseMobileSidebar';

export interface SidebarTabsProps {
  tab: SidebarTabId;
  onSelect: (tab: SidebarTabId) => void;
  collapsed: boolean;
  /** Chiffre d'À traiter ; null : inconnu, pas de pastille. */
  todoCount: number | null;
  agentWorking: boolean;
  /** Hors ligne : la pastille est grisée (données peut-être anciennes, D42). */
  offline?: boolean;
}

const TAB_ICONS: Record<SidebarTabId, LucideIcon> = {
  todo: Inbox,
  missions: Briefcase,
  assistant: Sparkles,
};

function tabAccessibleName(id: SidebarTabId, label: string, todoCount: number | null, agentWorking: boolean): string {
  if (id === 'todo' && todoCount !== null && todoCount > 0) {
    if (todoCount === 1) return `${label}, 1 élément`;
    if (todoCount > 9) return `${label}, plus de 9 éléments`;
    return `${label}, ${todoCount} éléments`;
  }
  if (id === 'assistant' && agentWorking) return `${label}, un agent travaille`;
  return label;
}

export function SidebarTabs({ tab, onSelect, collapsed, todoCount, agentWorking, offline = false }: SidebarTabsProps) {
  const { setOpen } = useSidebar();
  const navigate = useNavigate();
  const closeMobile = useCloseMobileSidebar();
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);

  const activate = (id: SidebarTabId) => {
    if (collapsed) {
      setOpen(true);
      onSelect(id);
      return;
    }
    if (id !== tab) {
      onSelect(id);
      return;
    }
    const page = SIDEBAR_TABS.find((t) => t.id === id)?.page ?? null;
    if (page) {
      closeMobile();
      navigate(page);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextTabIndex(index, event.key, SIDEBAR_TABS.length);
    if (next === null) return;
    event.preventDefault();
    buttonsRef.current[next]?.focus();
    onSelect(SIDEBAR_TABS[next].id);
  };

  const showTodoBadge = todoCount !== null && todoCount > 0;

  return (
    <div
      role="tablist"
      aria-label="Sections de la barre latérale"
      aria-orientation={collapsed ? 'vertical' : 'horizontal'}
      className={cn(collapsed ? 'flex flex-col items-center gap-1' : 'grid grid-cols-3 gap-1')}
    >
      {SIDEBAR_TABS.map((t, index) => {
        const Icon = TAB_ICONS[t.id];
        const selected = t.id === tab;
        const name = tabAccessibleName(t.id, t.label, todoCount, agentWorking);
        const badge = t.id === 'todo' && showTodoBadge && todoCount !== null ? (
          <span
            aria-hidden="true"
            className={cn(
              // Hors du flux dans les deux modes : la pastille ne prend pas de largeur au libellé.
              'absolute inline-flex min-w-[16px] h-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold tabular-nums text-primary-foreground',
              collapsed ? 'top-0 right-0' : 'top-0.5 right-1',
              offline && 'opacity-60',
            )}
          >
            {badgeLabel(todoCount)}
          </span>
        ) : null;
        const dot = t.id === 'assistant' && agentWorking ? (
          <span
            aria-hidden="true"
            className={cn('absolute h-1.5 w-1.5 rounded-full bg-primary', collapsed ? 'top-1 right-1' : 'top-1.5 right-2')}
          />
        ) : null;

        const button = (
          <button
            ref={(el) => { buttonsRef.current[index] = el; }}
            type="button"
            role="tab"
            id={`sidebar-tab-${t.id}`}
            aria-selected={selected}
            aria-controls="sidebar-panel"
            aria-label={name}
            tabIndex={selected ? 0 : -1}
            onClick={() => activate(t.id)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              'relative flex items-center justify-center rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring',
              collapsed
                ? 'h-8 w-8'
                // Icône au-dessus du libellé : « Assistant » et « À traiter » tiennent entiers en 16rem.
                : 'min-h-11 min-w-0 flex-col gap-0.5 px-1 py-1 text-[11px] font-medium leading-tight',
              selected
                ? 'bg-sidebar-accent text-sidebar-foreground'
                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
            )}
          >
            <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
            {!collapsed && <span className="max-w-full truncate">{t.label}</span>}
            {badge}
            {dot}
          </button>
        );

        if (!collapsed) return <Fragment key={t.id}>{button}</Fragment>;
        return (
          <Tooltip key={t.id}>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent side="right">{t.label}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
