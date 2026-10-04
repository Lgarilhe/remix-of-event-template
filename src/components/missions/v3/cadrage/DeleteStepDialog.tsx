// Refonte mission, écran Cadrage : suppression d'une étape d'entretien
// (conception 5.6). La confirmation dit combien de candidats s'y trouvent et
// où ils iront. Les candidats passent d'abord à l'étape choisie (ou à « A
// répondu » s'il n'y en a pas d'autre), par useMissionStageActions, donc par
// src/lib/candidateStage.ts ; l'étape n'est supprimée qu'ensuite, et seulement
// si aucun candidat n'a été refusé. Sinon l'étape reste, et la fenêtre le dit.
import { useEffect, useId, useMemo, useState } from 'react';
import { toast } from 'sonner';
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
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useMissionCandidateRows } from '@/hooks/useMissionCandidateRows';
import { useMissionStageActions } from '@/hooks/useMissionStageActions';
import type { ProcessStep } from '@/hooks/useMissionProcess';
import { defaultMoveTarget, deleteStepText } from './cadrageModel';
import { NativeSelect } from './JobSection';

export interface DeleteStepDialogProps {
  projectId: string;
  /** Étape à supprimer ; null : fenêtre fermée. */
  step: ProcessStep | null;
  /** Toutes les étapes, dans l'ordre affiché. */
  steps: readonly ProcessStep[];
  deleteStep: (id: string) => Promise<unknown>;
  onClose: () => void;
  /** Appelé une fois l'étape supprimée, juste avant onClose. */
  onDeleted?: () => void;
}

const stepLabel = (s: Pick<ProcessStep, 'name'>) => s.name?.trim() || 'sans nom';

export function DeleteStepDialog({ projectId, step, steps, deleteStep, onClose, onDeleted }: DeleteStepDialogProps) {
  const open = step !== null;
  const selectId = useId();
  const others = useMemo(() => steps.filter((s) => s.id !== step?.id), [steps, step?.id]);
  const [dest, setDest] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const { move } = useMissionStageActions(projectId);

  // Toutes les lignes de l'étape, pages suivantes comprises : la fenêtre ne
  // propose de supprimer qu'une fois tout lu.
  const rowsQuery = useMissionCandidateRows(
    projectId,
    { stage: 'interviewing', stepId: step?.id ?? '' },
    { enabled: open && !!step },
  );
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = rowsQuery;
  useEffect(() => {
    if (open && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [open, hasNextPage, isFetchingNextPage, fetchNextPage]);
  const rows = useMemo(() => (rowsQuery.data?.pages ?? []).flatMap((p) => p.rows), [rowsQuery.data]);
  const loading = rowsQuery.isLoading || !!hasNextPage || isFetchingNextPage;
  const readFailed = rowsQuery.isError && !loading;

  useEffect(() => {
    if (!step) return;
    setDest(defaultMoveTarget(steps.map((s) => s.id), step.id));
    setBusy(false);
    setFailure(null);
    // Une seule proposition par ouverture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step?.id]);

  const name = step ? stepLabel(step) : '';
  const count = rows.length;
  const ready = open && !loading && !readFailed;

  const runDelete = async () => {
    if (!step || !ready || busy) return;
    setBusy(true);
    setFailure(null);
    if (count > 0) {
      const target =
        others.length > 0 && dest
          ? { stage: 'interviewing' as const, processStepId: dest }
          : { stage: 'replied' as const };
      const summary = await move({ rows, target, fromStages: ['interviewing'], verb: 'déplacé' });
      if (summary.callFailed || summary.refused > 0) {
        setFailure("Des candidats n'ont pas pu être déplacés : l'étape est gardée. Réessayez.");
        setBusy(false);
        return;
      }
    }
    try {
      await deleteStep(step.id);
      toast.success(`Étape « ${name} » supprimée.`);
      onDeleted?.();
      onClose();
    } catch {
      // Refus déjà annoncé par useMissionProcess.
      setFailure("L'étape n'a pas pu être supprimée. Réessayez.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{`Supprimer l'étape « ${name} » ?`}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-3 text-sm text-muted-foreground">
              {loading ? (
                <span className="flex flex-col gap-2" role="status">
                  <span>Recherche des candidats à cette étape…</span>
                  <Skeleton className="h-4 w-2/3" />
                </span>
              ) : readFailed ? (
                <span>
                  Impossible de savoir quels candidats sont à cette étape pour l'instant : elle ne peut pas être supprimée.
                </span>
              ) : count === 0 ? (
                <span>Aucun candidat n'est à cette étape. Cette action est irréversible.</span>
              ) : (
                <>
                  <label htmlFor={selectId}>{deleteStepText(count, name, others.length > 0)}</label>
                  {others.length > 0 && (
                    <NativeSelect
                      id={selectId}
                      value={dest ?? ''}
                      onChange={(e) => setDest(e.target.value || null)}
                      disabled={busy}
                      className="max-w-xs"
                    >
                      {others.map((other) => (
                        <option key={other.id} value={other.id}>
                          {stepLabel(other)}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </>
              )}
              {failure && (
                <span role="alert" className="text-destructive">
                  {failure}
                </span>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Annuler</AlertDialogCancel>
          {readFailed ? (
            <Button type="button" variant="outline" onClick={() => void rowsQuery.refetch()}>
              Réessayer
            </Button>
          ) : (
            <AlertDialogAction
              variant="destructive"
              disabled={!ready || busy}
              onClick={(e) => {
                e.preventDefault();
                void runDelete();
              }}
            >
              {busy ? 'Suppression…' : "Supprimer l'étape"}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
