import React from 'react';
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

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

/**
 * F3 : confirmation explicite avant la création d'un second espace. L'action ne
 * détruit rien : le bouton reste neutre (pas de rouge).
 */
export const SecondWorkspaceDialog: React.FC<Props> = ({ open, onOpenChange, onConfirm }) => (
  <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Vous avez déjà un espace de travail</AlertDialogTitle>
        <AlertDialogDescription>
          Votre compte fait déjà partie d'un espace Konekt. Créer un nouvel espace le rendra actif à la place de
          l'actuel : vos missions, crédits et comptes LinkedIn resteront dans l'espace existant. Voulez-vous vraiment
          créer un second espace ?
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Annuler</AlertDialogCancel>
        <AlertDialogAction
          onClick={() => {
            onOpenChange(false);
            onConfirm();
          }}
        >
          Créer un second espace
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
