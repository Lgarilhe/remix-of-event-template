import { useEffect, useId, useState } from 'react';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { APPLY, CONFIRM_WORD, ROLLBACK, ROLLBACK_CONFIRM_WORD } from './basculeCopy';

/**
 * Confirmations de la page « Bascule de la connexion » (AlertDialog, règle des actions à effet).
 * - Conversion : le mot BASCULER à saisir, et la case des comptes sans correspondance quand il y en a.
 * - Annulation : une confirmation à part, qui nomme le lot et demande le mot ANNULER (elle remet tous les
 *   comptes du lot à l'ancien format, pour toutes les organisations).
 */

interface ApplyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: number;
  rows: number;
  unmapped: number;
  /** Lignes que les comptes sans correspondance gardent sur l'ancien identifiant, dites avant la case à cocher. */
  unmappedRows: number;
  /** Faux quand la liste est tronquée ou qu'un relevé a échoué : le nombre est un minimum. */
  unmappedRowsExact: boolean;
  /** Points bloquants de la dernière vérification (0 si elle n'a pas eu lieu). */
  blocking: number;
  onConfirm: (allowUnmapped: boolean) => void;
}

export function ApplyDialog({ open, onOpenChange, accounts, rows, unmapped, unmappedRows, unmappedRowsExact, blocking, onConfirm }: ApplyDialogProps) {
  const [typed, setTyped] = useState('');
  const [allowUnmapped, setAllowUnmapped] = useState(false);
  const inputId = useId();
  const checkId = useId();

  // Un dialogue rouvert repart à vide : la confirmation ne se garde jamais d'une fois sur l'autre.
  useEffect(() => {
    if (!open) {
      setTyped('');
      setAllowUnmapped(false);
    }
  }, [open]);

  const typedOk = typed.trim() === CONFIRM_WORD;
  const unmappedOk = unmapped === 0 || allowUnmapped;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{APPLY.dialogTitle}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              {APPLY.dialogLines(accounts, rows).map((line) => (
                <p key={line}>{line}</p>
              ))}
              {blocking > 0 && <p className="font-medium text-foreground">{APPLY.unreadyWarning(blocking)}</p>}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {unmapped > 0 && (
          <div className="space-y-2">
            <p className="text-sm text-foreground-secondary">{APPLY.unmappedHeld(unmappedRows, unmappedRowsExact)}</p>
            <div className="flex items-start gap-3">
              <Checkbox
                id={checkId}
                checked={allowUnmapped}
                onCheckedChange={(value) => setAllowUnmapped(value === true)}
                className="mt-0.5"
              />
              <Label htmlFor={checkId} className="text-sm font-normal leading-snug">
                {APPLY.allowUnmapped(unmapped)}
              </Label>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor={inputId}>{APPLY.typeLabel}</Label>
          <Input
            id={inputId}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={APPLY.typePlaceholder}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="font-mono"
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>{APPLY.cancel}</AlertDialogCancel>
          <AlertDialogAction disabled={!typedOk || !unmappedOk} onClick={() => onConfirm(allowUnmapped)}>
            {APPLY.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface RollbackDialogProps {
  /** Lot à annuler, ou null quand le dialogue est fermé. */
  batchId: string | null;
  onClose: () => void;
  onConfirm: (batchId: string) => void;
}

export function RollbackDialog({ batchId, onClose, onConfirm }: RollbackDialogProps) {
  const [typed, setTyped] = useState('');
  const inputId = useId();

  // Un dialogue rouvert repart à vide : la confirmation ne se garde jamais d'un lot à l'autre.
  useEffect(() => {
    if (batchId === null) setTyped('');
  }, [batchId]);

  const typedOk = typed.trim() === ROLLBACK_CONFIRM_WORD;

  return (
    <AlertDialog open={batchId !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{ROLLBACK.title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              {ROLLBACK.lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
              {batchId && <p className="break-all font-mono text-xs text-foreground">{ROLLBACK.lotLine(batchId)}</p>}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor={inputId}>{ROLLBACK.typeLabel}</Label>
          <Input
            id={inputId}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={ROLLBACK.typePlaceholder}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="font-mono"
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>{ROLLBACK.cancel}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={!typedOk}
            onClick={() => {
              if (batchId) onConfirm(batchId);
            }}
          >
            {ROLLBACK.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
