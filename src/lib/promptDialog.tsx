import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface PromptDialogOptions {
  title: string;
  /** Texte d'aide affiché sous le titre. */
  description?: string;
  /** Valeur initiale du champ. */
  defaultValue?: string;
  placeholder?: string;
  /** Texte du bouton de validation. Défaut : "Valider" */
  confirmLabel?: string;
  /** Texte du bouton d'annulation. Défaut : "Annuler" */
  cancelLabel?: string;
}

interface ImperativePromptProps extends PromptDialogOptions {
  onResolve: (value: string | null) => void;
}

const ImperativePrompt = ({
  title,
  description,
  defaultValue = '',
  placeholder,
  confirmLabel = 'Valider',
  cancelLabel = 'Annuler',
  onResolve,
}: ImperativePromptProps) => {
  const [open, setOpen] = useState(true);
  const [value, setValue] = useState(defaultValue);
  const resolvedRef = useRef(false);

  const resolve = (next: string | null) => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    setOpen(false);
    onResolve(next);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) resolve(null); }}>
      <DialogContent className="sm:max-w-md">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            resolve(value);
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className={description ? undefined : 'sr-only'}>
              {description ?? title}
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => resolve(null)}>
              {cancelLabel}
            </Button>
            <Button type="submit">{confirmLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

/**
 * Remplace `window.prompt()` par un Dialog shadcn.
 *
 * Usage :
 *   const url = await promptDialog({ title: 'Insérer un lien', defaultValue: 'https://' });
 *   if (!url) return;
 *
 * Résout avec la valeur saisie, ou `null` si l'utilisateur annule (bouton,
 * Escape ou clic en dehors). Même mécanique que `confirmAlert` : monté dans
 * un conteneur temporaire, démonté après l'animation de fermeture.
 */
export function promptDialog(options: PromptDialogOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    const handleResolve = (value: string | null) => {
      setTimeout(() => {
        root.unmount();
        if (container.parentNode) container.parentNode.removeChild(container);
      }, 200);
      resolve(value);
    };

    root.render(<ImperativePrompt {...options} onResolve={handleResolve} />);
  });
}
