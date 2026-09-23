/**
 * Section générique des panneaux de la barre latérale (§1.4, §2.3, D9, D42).
 *
 * États, dérivés de queryState (src/lib/sidebarSection.ts) :
 * - loading : lignes grises, aria-busy, « Chargement » pour le lecteur d'écran ;
 * - offline : aucune donnée, requête en pause ; une ligne grise, sans bouton
 *   (le bandeau du panneau porte « Réessayer ») ;
 * - error : aucune donnée ; message et « Réessayer » ;
 * - ok : la liste ; avec `stale`, une ligne discrète « Données peut-être
 *   anciennes. » et « Réessayer » ; vide : masquée si `hideWhenEmpty` (défaut),
 *   sinon `emptyText` puis `emptyAction`.
 *
 * En-tête : <h3 id="sidebar-section-{id}">, qui nomme la liste
 * (<ul aria-labelledby>). Les enfants sont des SidebarRow (chacun rend son <li>).
 * Section repliable : le titre devient un bouton avec aria-expanded ; le corps
 * n'est pas monté tant qu'elle est repliée.
 */
import type React from 'react';
import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SectionState } from '@/lib/sidebarSection';
import { useCloseMobileSidebar } from '@/hooks/sidebar/useCloseMobileSidebar';
import { SidebarRow } from './SidebarRow';

export interface SidebarSectionProps {
  /** Sert à l'id du titre (sidebar-section-{id}), qui nomme la liste. */
  id: string;
  /** Absent : pas d'en-tête. */
  title?: string;
  /** Titre cliquable vers cette page (ferme la barre sur téléphone). */
  titleTo?: string;
  state: SectionState;
  /** Erreur avec données gardées (en ligne seulement). */
  stale?: boolean;
  onRetry?: () => void;
  isEmpty: boolean;
  /** Défaut true : une section vide et chargée n'est pas affichée. */
  hideWhenEmpty?: boolean;
  emptyText?: string;
  /** Ligne affichée sous emptyText. */
  emptyAction?: { label: string; to: string };
  collapsible?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  headerAction?: React.ReactNode;
  /** Des SidebarRow. */
  children?: React.ReactNode;
  /** Message d'erreur sans données, propre à la section. Défaut : « Impossible de charger cette liste. » */
  errorText?: string;
  /** Nombre de lignes grises au chargement. Défaut : 2. */
  loadingRows?: number;
  /** SidebarRow toujours affichées en fin de liste, quel que soit l'état (ex. « Ouvrir la messagerie »). */
  footer?: React.ReactNode;
}

const DEFAULT_ERROR_TEXT = 'Impossible de charger cette liste.';

const RETRY_CLASS =
  'inline-flex items-center justify-center rounded-md px-2 min-h-11 md:min-h-7 text-[12px] font-medium ' +
  'text-sidebar-foreground underline-offset-2 hover:underline hover:bg-sidebar-accent/60 ' +
  'outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring';

export function SidebarSection({
  id,
  title,
  titleTo,
  state,
  stale = false,
  onRetry,
  isEmpty,
  hideWhenEmpty = true,
  emptyText,
  emptyAction,
  collapsible = false,
  open,
  onOpenChange,
  headerAction,
  children,
  errorText = DEFAULT_ERROR_TEXT,
  loadingRows = 2,
  footer,
}: SidebarSectionProps) {
  const closeMobile = useCloseMobileSidebar();
  const bodyId = useId();
  // Repliable non contrôlée : état interne, repliée au départ.
  const [innerOpen, setInnerOpen] = useState(false);
  // Sans titre, pas de bouton pour déplier : la section reste ouverte.
  const canCollapse = collapsible && !!title;
  const isOpen = !canCollapse || (open ?? innerOpen);

  // Section masquée quand elle est vide : rien non plus pendant le chargement,
  // sinon elle apparaît en gris pour disparaître ensuite (design). Erreur et
  // hors ligne restent affichés : ils ne disent pas « vide ».
  if (hideWhenEmpty && (state === 'loading' || (state === 'ok' && isEmpty))) return null;

  const headingId = title ? `sidebar-section-${id}` : undefined;

  const toggle = () => {
    const next = !isOpen;
    if (open === undefined) setInnerOpen(next);
    onOpenChange?.(next);
  };

  let header: React.ReactNode = null;
  if (title) {
    let heading: React.ReactNode;
    if (canCollapse) {
      heading = (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={isOpen}
          aria-controls={isOpen ? bodyId : undefined}
          className="flex w-full min-w-0 items-center gap-1 rounded-md px-1 text-left min-h-11 md:min-h-7 hover:text-sidebar-foreground outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <ChevronRight
            aria-hidden="true"
            className={cn('h-3.5 w-3.5 shrink-0 transition-transform', isOpen && 'rotate-90')}
          />
          <span className="truncate">{title}</span>
        </button>
      );
    } else if (titleTo) {
      heading = (
        <Link
          to={titleTo}
          onClick={closeMobile}
          className="flex min-w-0 items-center rounded-md px-1 min-h-11 md:min-h-7 hover:text-sidebar-foreground hover:underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <span className="truncate">{title}</span>
        </Link>
      );
    } else {
      heading = <span className="block truncate px-1 py-1">{title}</span>;
    }

    header = (
      // Titre à sa largeur naturelle : si l'action d'en-tête ne tient pas à côté,
      // elle passe à la ligne au lieu de couper le titre (« Pour v… »).
      <div className="flex flex-wrap items-center gap-x-1 px-1">
        <h3
          id={headingId}
          className="min-w-0 flex-auto text-[11.5px] font-semibold text-muted-foreground"
        >
          {heading}
        </h3>
        {headerAction != null && <div className="flex shrink-0 items-center">{headerAction}</div>}
      </div>
    );
  }

  let message: React.ReactNode = null;
  let rows: React.ReactNode = null;
  let staleLine: React.ReactNode = null;

  if (state === 'loading') {
    message = (
      <div aria-busy="true" className="space-y-1.5 px-2 py-1.5">
        <span className="sr-only">Chargement</span>
        {Array.from({ length: Math.max(1, loadingRows) }, (_, i) => (
          <div key={i} aria-hidden="true" className="flex items-center gap-2 min-h-8">
            <div className="h-4 w-4 shrink-0 animate-pulse rounded bg-muted" />
            <div className={cn('h-3 animate-pulse rounded bg-muted', i % 2 === 0 ? 'w-3/4' : 'w-1/2')} />
          </div>
        ))}
      </div>
    );
  } else if (state === 'offline') {
    message = (
      <p className="px-2 py-1.5 text-[12px] text-muted-foreground">Disponible au retour de la connexion.</p>
    );
  } else if (state === 'error') {
    message = (
      <div className="flex flex-wrap items-center gap-x-1 px-2 py-1">
        <p className="text-[12px] text-muted-foreground">{errorText}</p>
        {onRetry && (
          <button type="button" onClick={onRetry} className={RETRY_CLASS}>
            Réessayer
          </button>
        )}
      </div>
    );
  } else {
    if (!isEmpty) {
      rows = children;
    } else {
      if (emptyText) {
        message = <p className="px-2 py-1.5 text-[12px] text-muted-foreground">{emptyText}</p>;
      }
      if (emptyAction) {
        rows = <SidebarRow title={emptyAction.label} to={emptyAction.to} />;
      }
    }
    if (stale) {
      staleLine = (
        <div className="flex flex-wrap items-center gap-x-1 px-2 py-0.5">
          <p className="text-[11.5px] text-muted-foreground">Données peut-être anciennes.</p>
          {onRetry && (
            <button type="button" onClick={onRetry} className={RETRY_CLASS}>
              Réessayer
            </button>
          )}
        </div>
      );
    }
  }

  const hasList = rows != null || footer != null;

  return (
    <div className="py-1" data-sidebar-section={id}>
      {header}
      {isOpen && (
        <div id={bodyId}>
          {message}
          {hasList && (
            <ul aria-labelledby={headingId} className="flex flex-col gap-px">
              {rows}
              {footer}
            </ul>
          )}
          {staleLine}
        </div>
      )}
    </div>
  );
}
