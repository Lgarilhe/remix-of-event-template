import React, { useId } from 'react';
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { PanelLeft } from 'lucide-react';
import { useTodoSignal } from '@/hooks/sidebar/useTodoSignal';
import { badgeLabel } from '@/lib/sidebarSignals';

const TRIGGER_CLASS =
  'h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors';

function todoDescription(count: number): string {
  if (count === 1) return '1 élément à traiter';
  if (count > 9) return 'Plus de 9 éléments à traiter';
  return `${count} éléments à traiter`;
}

/**
 * Téléphone seulement (D37) : la barre est cachée dans la feuille, le bouton
 * du menu porte le chiffre d'À traiter. Mêmes clés que la barre (aucune
 * requête en plus) ; le chiffre est lu par aria-describedby, le nom du bouton
 * ne change pas (lot 8).
 */
function MobileMenuTrigger() {
  const { count } = useTodoSignal();
  const descriptionId = useId();
  const show = count !== null && count > 0;

  return (
    <span className="relative">
      <SidebarTrigger className={TRIGGER_CLASS} aria-describedby={show ? descriptionId : undefined}>
        <PanelLeft className="h-4 w-4" />
      </SidebarTrigger>
      {show && (
        <>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -top-1 -right-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold tabular-nums text-primary-foreground"
          >
            {badgeLabel(count)}
          </span>
          <span id={descriptionId} className="sr-only">
            {todoDescription(count)}
          </span>
        </>
      )}
    </span>
  );
}

export const AppHeader: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const { isMobile } = useSidebar();

  return (
    <header className="h-12 flex items-center gap-3 border-b border-border px-4 shrink-0 bg-background">
      {isMobile ? (
        <MobileMenuTrigger />
      ) : (
        <SidebarTrigger className={TRIGGER_CLASS}>
          <PanelLeft className="h-4 w-4" />
        </SidebarTrigger>
      )}
      {children}
    </header>
  );
};
