// Refonte mission, lot 2 : gestes d'étape de la nouvelle page mission (liste,
// kanban, fiche). Signature : MissionStageActions
// (src/components/missions/v3/types.ts). Écriture par setCandidateStages
// (src/lib/candidateStage.ts, origine user) sur rowWriteIds(rows), toutes les
// lignes du candidat dans la mission ; jamais d'écriture directe de status ni
// de pipeline_stage.
//
// Ordre : écriture, étapes connues (la ligne change d'étape à l'écran), puis
// relecture (invalidateStageReaders, après toute réponse par ligne) et annonces. Rien n'est annoncé avant la
// réponse de la base. Ne lève jamais.

import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { setCandidateStages, skippedStageMessage, stageErrorMessage } from '@/lib/candidateStage';
import { invalidateStageReaders } from '@/lib/stageDisplay';
import { plural } from '@/lib/plural';
import {
  rowWriteIds,
  summarizeStageMove,
  type MissionStageActions,
  type StageMoveRequest,
  type StageMoveSummary,
} from '@/components/missions/v3/types';
import { rememberStageMoves } from '@/components/missions/v3/pipeline/frozenOrder';

const VERB_PLURAL: Record<StageMoveRequest['verb'], string> = {
  retenu: 'retenus',
  écarté: 'écartés',
  déplacé: 'déplacés',
};

/** « 1 candidat retenu. », « 3 candidats écartés. » */
export function stageMoveSuccessText(count: number, verb: StageMoveRequest['verb']): string {
  return `${plural(count, 'candidat')} ${count > 1 ? VERB_PLURAL[verb] : verb}.`;
}

/** « 1 candidat déjà à cette étape. », « 2 candidats déjà à cette étape. » */
export function stageUnchangedText(count: number): string {
  return `${plural(count, 'candidat')} déjà à cette étape.`;
}

const EMPTY: StageMoveSummary = {
  changed: 0,
  unchanged: 0,
  skipped: 0,
  refused: 0,
  firstHint: null,
  callFailed: false,
};

export function useMissionStageActions(_projectId: string): MissionStageActions {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(0);

  const move = useCallback(
    async (request: StageMoveRequest): Promise<StageMoveSummary> => {
      const ids = rowWriteIds(request.rows);
      if (ids.length === 0) return { ...EMPTY };
      setPending((n) => n + 1);
      try {
        const outcome = await setCandidateStages(ids, request.target, request.fromStages);
        const summary = summarizeStageMove(request.rows, outcome);
        if (outcome.updated > 0) rememberStageMoves(request.rows, outcome);
        // Relecture après toute réponse par ligne : « déjà à cette étape »,
        // « laissé à son étape » ou un refus disent aussi que l'écran était
        // périmé. Un appel échoué n'a rien appris : pas de relecture.
        if (outcome.rows.length > 0) void invalidateStageReaders(queryClient);

        if (summary.changed > 0) toast.success(stageMoveSuccessText(summary.changed, request.verb));
        const skipped = skippedStageMessage(summary.skipped);
        if (skipped) toast.message(skipped);
        if (summary.unchanged > 0 && summary.changed === 0 && summary.refused === 0 && !summary.callFailed) {
          toast.message(stageUnchangedText(summary.unchanged));
        }
        if (summary.refused > 0 || summary.callFailed) toast.error(stageErrorMessage(summary.firstHint));
        return summary;
      } catch {
        toast.error(stageErrorMessage(null));
        return { ...EMPTY, callFailed: true };
      } finally {
        setPending((n) => Math.max(0, n - 1));
      }
    },
    [queryClient],
  );

  return { move, isMoving: pending > 0 };
}
