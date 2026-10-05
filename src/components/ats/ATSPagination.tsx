/**
 * Barre de pagination des vues « Tableau » et « Chronologie » du pipeline
 * global : compteur à gauche, Précédent / Suivant à droite. Absente quand tout
 * tient sur une page. L'appelant ajoute la bordure selon l'endroit où elle se
 * pose (`className`). Boutons discrets, de 44 px au doigt (design simplifié).
 */
import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PAGE_SIZE } from '@/hooks/usePagination';
import { cn } from '@/lib/utils';

interface ATSPaginationProps {
  total: number;
  currentPage: number;
  pageCount: number;
  /** Indice (à partir de 0) de la première ligne de la page. */
  firstRow: number;
  /** Numéro (à partir de 1) de la dernière ligne de la page. */
  lastRow: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export const ATSPagination: React.FC<ATSPaginationProps> = ({
  total,
  currentPage,
  pageCount,
  firstRow,
  lastRow,
  onPageChange,
  className,
}) => {
  if (total <= PAGE_SIZE) return null;
  return (
    <nav
      aria-label="Pagination de la liste"
      className={cn('flex flex-wrap items-center justify-between gap-2 px-3 py-2', className)}
    >
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {firstRow + 1} à {lastRow} sur {total}
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="gap-1 max-md:h-11 [&_svg]:size-3.5"
        >
          <ChevronLeft aria-hidden="true" />
          Précédent
        </Button>
        <span className="text-xs text-muted-foreground">Page {currentPage} sur {pageCount}</span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === pageCount}
          className="gap-1 max-md:h-11 [&_svg]:size-3.5"
        >
          Suivant
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
};
