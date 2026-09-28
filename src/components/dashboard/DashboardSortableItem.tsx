/**
 * DashboardSortableItem — une section du tableau de bord, réordonnable en mode
 * « Personnaliser » avec deux boutons, Monter et Descendre. Le mode remplace le
 * glisser-déposer, qui n'était ni atteignable au clavier ni utilisable sur
 * téléphone (revue design A-28).
 */

import React from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface DashboardSortableItemProps {
  /** Nom de la section, lu dans les boutons et l'annonce de déplacement. */
  label: string;
  editing: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  children: React.ReactNode;
}

export const DashboardSortableItem: React.FC<DashboardSortableItemProps> = ({
  label,
  editing,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  children,
}) => (
  <li className={cn(editing && 'rounded-xl border border-dashed border-border-strong p-2')}>
    {editing && (
      <div className="mb-2 flex items-center justify-between gap-2 pl-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <div className="flex items-center gap-1">
          <Button type="button" variant="outline" size="icon-xs" onClick={onMoveUp} disabled={isFirst} aria-label={`Monter la section ${label}`}>
            <ArrowUp aria-hidden="true" />
          </Button>
          <Button type="button" variant="outline" size="icon-xs" onClick={onMoveDown} disabled={isLast} aria-label={`Descendre la section ${label}`}>
            <ArrowDown aria-hidden="true" />
          </Button>
        </div>
      </div>
    )}
    {children}
  </li>
);
