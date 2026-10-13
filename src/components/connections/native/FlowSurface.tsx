/**
 * Surface de l'assistant de connexion : une fenêtre sur ordinateur, un tiroir
 * qui monte du bas sur téléphone (docs/design/01-direction.md, § 6 : cibles de
 * 44 px, une seule action principale). Le titre et la description de chaque
 * étape sont ceux de la fenêtre, posés par StepFrame.
 */

import type { ReactNode } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

interface FlowSurfaceProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

/**
 * Un clic à côté ne ferme jamais l'assistant : une saisie ou une vérification
 * est peut-être en cours. La croix, Échap et « Annuler » ferment.
 */
export function FlowSurface({ open, onOpenChange, children }: FlowSurfaceProps) {
  const isMobile = useIsMobile();
  const keepOpen = (event: Event) => event.preventDefault();

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          onInteractOutside={keepOpen}
          className={cn('max-h-[92dvh] overflow-y-auto rounded-t-xl px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-6')}
        >
          {children}
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onInteractOutside={keepOpen} className="max-h-[90dvh] max-w-md overflow-y-auto">
        {children}
      </DialogContent>
    </Dialog>
  );
}
