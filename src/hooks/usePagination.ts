/**
 * Page courante d'une liste affichée par tranches (vues « Tableau » et
 * « Chronologie » du pipeline global). La page reste dans les bornes quand la
 * liste rétrécit et revient à la première quand `resetKey` change (les filtres
 * de la page). `containerRef` pointe le haut de la liste : un changement de page
 * l'y ramène s'il est sorti de la fenêtre.
 */
import { useEffect, useRef, useState } from 'react';

export const PAGE_SIZE = 25;

export function usePagination(total: number, resetKey?: unknown) {
  const [page, setPage] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setPage(1); }, [resetKey]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Une liste qui rétrécit (filtre, candidat sorti de l'étape) ne laisse jamais une page vide.
  const currentPage = Math.min(page, pageCount);
  const firstRow = (currentPage - 1) * PAGE_SIZE;

  const goToPage = (next: number) => {
    setPage(Math.min(Math.max(next, 1), pageCount));
    // Le bouton est sous les lignes : on remonte en haut de la liste si besoin.
    const container = containerRef.current;
    if (container && container.getBoundingClientRect().top < 0) container.scrollIntoView({ block: 'start' });
  };

  return {
    containerRef,
    currentPage,
    pageCount,
    firstRow,
    lastRow: Math.min(firstRow + PAGE_SIZE, total),
    goToPage,
    resetPage: () => setPage(1),
  };
}
