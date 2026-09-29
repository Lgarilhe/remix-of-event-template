// Refonte mission, lot 2 : confirmation de « Écarter » sur une sélection.

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { plural } from '@/lib/plural';

interface RejectConfirmDialogProps {
  open: boolean;
  count: number;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function rejectDialogTitle(count: number): string {
  return `Écarter ${plural(count, 'candidat')} ?`;
}

export function RejectConfirmDialog({ open, count, onOpenChange, onConfirm }: RejectConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{rejectDialogTitle(count)}</AlertDialogTitle>
          <AlertDialogDescription>
            {count > 1
              ? 'Ils restent visibles dans Écartés, et vous pourrez les remettre à une autre étape.'
              : 'Il reste visible dans Écartés, et vous pourrez le remettre à une autre étape.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            Écarter
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
