// Fenêtres de l'enregistrement de l'éditeur unique (lot 5d-2) : « Supprimer
// N étapes ? » (étapes en base retirées alors que des candidats sont en
// cours), « Enregistrer malgré ces points ? » et « Quitter sans
// enregistrer ? ». Mêmes textes que l'ancien éditeur pour les deux premières.
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
import type { EditorSaveFlow } from '@/hooks/useEditorSaveFlow';
import type { LeaveGuard } from '@/hooks/useLeaveGuard';

interface SaveDialogsProps {
  flow: EditorSaveFlow;
  leave: LeaveGuard;
}

export function SaveDialogs({ flow, leave }: SaveDialogsProps) {
  const { warningsDialog, removalDialog } = flow;
  const active = removalDialog.activeCount;
  return (
    <>
      <AlertDialog open={warningsDialog.open} onOpenChange={(open) => { if (!open) warningsDialog.cancel(); }}>
        <AlertDialogContent className="max-h-[85vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>Enregistrer malgré ces points ?</AlertDialogTitle>
            <AlertDialogDescription>La séquence ne fera pas tout ce qui est affiché :</AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-foreground">
            {warningsDialog.items.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel>Revenir à la séquence</AlertDialogCancel>
            <AlertDialogAction onClick={warningsDialog.confirm}>Enregistrer quand même</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={removalDialog.open} onOpenChange={(open) => { if (!open) removalDialog.cancel(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{removalDialog.count > 1 ? `Supprimer ${removalDialog.count} étapes ?` : 'Supprimer cette étape ?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {active && active > 0 ? `${active === 1 ? '1 candidat est en cours' : `${active} candidats sont en cours`} dans cette séquence. ` : ''}
              Les envois prévus sur {removalDialog.count > 1 ? 'ces étapes' : 'cette étape'} seront annulés. Les candidats qui l’attendaient reprendront à l’étape suivante.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Revenir à la séquence</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={removalDialog.confirm}>Supprimer et enregistrer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={leave.open} onOpenChange={(open) => { if (!open) leave.cancel(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Quitter sans enregistrer ?</AlertDialogTitle>
            <AlertDialogDescription>Vos modifications de la séquence ne sont pas enregistrées. En quittant, elles seront perdues.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Rester</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={leave.confirm}>Quitter sans enregistrer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
