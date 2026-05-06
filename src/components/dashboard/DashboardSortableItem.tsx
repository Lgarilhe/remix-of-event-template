/**
 * DashboardSortableItem — wrapper pour les sections du Dashboard, ajoute :
 * - Drag-to-reorder via framer-motion `Reorder.Item` (parent gère Reorder.Group)
 * - Handle visible au hover (icône grip à gauche, en absolute)
 * - Curseur grab/grabbing pendant le drag
 * - Animation lift pendant le drag (shadow + scale subtle)
 *
 * Pattern Notion/Linear : pas de bouton "edit layout", le user hover, voit
 * le handle, drag, c'est rangé.
 */

import React from 'react';
import { Reorder, useDragControls, useMotionValue } from 'framer-motion';
import { GripVertical } from 'lucide-react';
import type { DashboardSectionKey } from '@/hooks/useDashboardLayout';

interface DashboardSortableItemProps {
  value: DashboardSectionKey;
  children: React.ReactNode;
}

export const DashboardSortableItem: React.FC<DashboardSortableItemProps> = ({
  value,
  children,
}) => {
  const dragControls = useDragControls();
  const y = useMotionValue(0);

  return (
    <Reorder.Item
      value={value}
      dragListener={false}
      dragControls={dragControls}
      style={{ y }}
      whileDrag={{
        scale: 1.01,
        boxShadow: '0 20px 40px -12px rgba(0, 0, 0, 0.18)',
        zIndex: 50,
        cursor: 'grabbing',
      }}
      transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      className="group/sortable relative"
    >
      {/* Drag handle — visible au hover de la section, à gauche en absolute */}
      <button
        type="button"
        onPointerDown={(e) => dragControls.start(e)}
        className="absolute -left-7 top-3 z-20 hidden lg:flex h-7 w-5 items-center justify-center rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-muted/60 opacity-0 group-hover/sortable:opacity-100 transition-opacity cursor-grab active:cursor-grabbing touch-none"
        aria-label="Réorganiser cette section"
        title="Glisser pour réorganiser"
      >
        <GripVertical className="w-4 h-4" aria-hidden="true" />
      </button>

      {/* Mobile : handle inline en haut, plus discret */}
      <button
        type="button"
        onPointerDown={(e) => dragControls.start(e)}
        className="lg:hidden absolute right-2 top-2 z-20 h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-muted/60 cursor-grab active:cursor-grabbing touch-none"
        aria-label="Réorganiser cette section"
      >
        <GripVertical className="w-4 h-4" aria-hidden="true" />
      </button>

      {children}
    </Reorder.Item>
  );
};
