/**
 * Ligne générique des panneaux de la barre latérale (§1.4, §2.3).
 *
 * Rend son propre <li> : à placer dans la liste <ul> que pose SidebarSection.
 * La cible principale (lien ou bouton) et l'action secondaire sont sœurs,
 * jamais imbriquées. Cibles de 44 px sur téléphone (min-h-11, et min-w-11 pour
 * les boutons de l'action), tailles compactes à partir de md (ordinateur).
 *
 * Signaux (D8) : `strong` (gras) est réservé à ce qui compte dans le chiffre
 * d'À traiter ; `dotLabel` pose un point neutre, lu par le lecteur d'écran.
 */
import type React from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useCloseMobileSidebar } from '@/hooks/sidebar/useCloseMobileSidebar';

export interface SidebarRowProps {
  /** Icône 16 px ou initiales, décorative (le titre porte le sens). */
  leading?: React.ReactNode;
  title: string;
  sub?: string | null;
  /** Heure ou mention courte, en gris à droite. */
  right?: string | null;
  /** Gras : l'élément compte dans le chiffre d'À traiter, et rien d'autre. */
  strong?: boolean;
  /** Point neutre, avec ce texte pour le lecteur d'écran (ex. « Non lu »). */
  dotLabel?: string | null;
  /** Lien interne ; ferme la barre sur téléphone avant de naviguer. */
  to?: string;
  /** Bouton, si pas de `to`. À l'appelant de fermer la barre au besoin. */
  onSelect?: () => void;
  /** Bouton secondaire (Rejoindre, Retirer, épingle), hors de la cible principale. */
  action?: React.ReactNode;
  /** Élément présent mais hors du chiffre : texte grisé. */
  muted?: boolean;
}

const TARGET_CLASS =
  'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left min-h-11 md:min-h-8 ' +
  'outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring';

const INTERACTIVE_CLASS = 'hover:bg-sidebar-accent/60 active:bg-sidebar-accent';

export function SidebarRow({
  leading,
  title,
  sub,
  right,
  strong = false,
  dotLabel,
  to,
  onSelect,
  action,
  muted = false,
}: SidebarRowProps) {
  const closeMobile = useCloseMobileSidebar();
  // Texte complet au survol : titres et sous-titres peuvent être coupés.
  const fullText = sub ? `${title} · ${sub}` : title;

  const content = (
    <>
      {leading != null && (
        <span
          aria-hidden="true"
          className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground [&>svg]:h-4 [&>svg]:w-4"
        >
          {leading}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            // Deux lignes au plus : une panne ou une action à valider reste lisible.
            'line-clamp-2 break-words text-[13px] leading-5',
            strong ? 'font-semibold text-sidebar-foreground' : 'font-normal',
            !strong && (muted ? 'text-muted-foreground' : 'text-sidebar-foreground/90'),
          )}
        >
          {title}
        </span>
        {sub && (
          <span className="truncate text-[11.5px] leading-4 text-muted-foreground">{sub}</span>
        )}
      </span>
      {dotLabel && (
        <>
          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" />
          <span className="sr-only">{dotLabel}</span>
        </>
      )}
      {right && (
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{right}</span>
      )}
    </>
  );

  let target: React.ReactNode;
  if (to) {
    target = (
      <Link to={to} onClick={closeMobile} title={fullText} className={cn(TARGET_CLASS, INTERACTIVE_CLASS)}>
        {content}
      </Link>
    );
  } else if (onSelect) {
    target = (
      <button type="button" onClick={onSelect} title={fullText} className={cn(TARGET_CLASS, INTERACTIVE_CLASS)}>
        {content}
      </button>
    );
  } else {
    target = <div title={fullText} className={TARGET_CLASS}>{content}</div>;
  }

  return (
    <li className="flex items-center gap-0.5">
      {target}
      {action != null && (
        <div
          className={cn(
            'flex shrink-0 items-center',
            // Tout bouton de l'action : 44 px sur téléphone, compact sur ordinateur.
            '[&_button]:min-h-11 [&_button]:min-w-11 md:[&_button]:min-h-7 md:[&_button]:min-w-7',
          )}
        >
          {action}
        </div>
      )}
    </li>
  );
}
