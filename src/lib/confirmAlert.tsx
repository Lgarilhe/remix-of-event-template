import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
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

export interface ConfirmAlertOptions {
  title: string;
  /** Description affichée sous le titre. Peut contenir des sauts de ligne `\n`. */
  description?: string;
  /** Texte du bouton confirmation. Défaut : "Continuer" */
  confirmLabel?: string;
  /** Texte du bouton annulation. Défaut : "Annuler" */
  cancelLabel?: string;
  /** Si true, le bouton confirmation prend les couleurs `destructive`. Défaut : false. */
  destructive?: boolean;
}

interface ImperativeAlertProps extends ConfirmAlertOptions {
  onResolve: (value: boolean) => void;
}

const ImperativeAlert = ({
  title,
  description,
  confirmLabel = 'Continuer',
  cancelLabel = 'Annuler',
  destructive = false,
  onResolve,
}: ImperativeAlertProps) => {
  const [open, setOpen] = useState(true);

  // Si l'utilisateur ferme via Escape ou clic outside, considère ça comme cancel
  useEffect(() => {
    if (!open) onResolve(false);
  }, [open, onResolve]);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription className="whitespace-pre-line">
              {description}
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => onResolve(false)}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            className={destructive ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : undefined}
            onClick={() => onResolve(true)}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

/**
 * Remplace `window.confirm()` par un AlertDialog shadcn.
 *
 * Usage :
 *   const ok = await confirmAlert({
 *     title: 'Supprimer cet enrollment ?',
 *     description: 'Cette action est irréversible.',
 *     destructive: true,
 *   });
 *   if (!ok) return;
 *
 * Le dialog est monté dans un div temporaire dans `document.body`, puis
 * démonté/cleanup au resolve. Pas besoin de provider au top-level.
 */
export function confirmAlert(options: ConfirmAlertOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    const handleResolve = (value: boolean) => {
      // Délai pour laisser l'animation Radix se terminer proprement
      setTimeout(() => {
        root.unmount();
        if (container.parentNode) container.parentNode.removeChild(container);
      }, 200);
      resolve(value);
    };

    root.render(<ImperativeAlert {...options} onResolve={handleResolve} />);
  });
}
