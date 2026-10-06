// Fil de l'éditeur unique (lot 5d-2), rendu en DOM : une liste <ol> par fil,
// une liste imbriquée par branche, une carte par étape. Bloc de départ,
// délais dessinés, fourches, « Fin de la séquence », et « Ajouter une étape »
// sous la dernière carte de chaque branche (avant sa fin ou l'étape qu'elle
// rejoint). Aucun canevas : le fil suit les règles du moteur
// (buildEditorFlow, src/lib/sequenceEditor.ts).
import { useMemo } from 'react';
import type { SequenceStep } from '@/types/sequence';
import type { StepPosition } from '@/components/outreach/sequence/sequenceGraph';
import {
  MAX_VERSIONS,
  canHaveVersions,
  canMoveStep,
  type EditorFlow,
  type EditorNode,
  type StepIssues,
} from '@/lib/sequenceEditor';
import { AddStepButton } from './AddStepButton';
import { BranchColumns } from './BranchColumns';
import { DelayPill } from './DelayPill';
import { Connector, EndMarker, JoinMarker } from './EndMarker';
import { StepCard } from './StepCard';

export interface SequenceFlowProps {
  flow: EditorFlow;
  steps: SequenceStep[];
  selectedId: string | null;
  /** Points de validateSequence par ordre d'étape (issuesByOrder). */
  issues: Map<number, StepIssues>;
  onSelect: (stepId: string) => void;
  onAdd: (position: StepPosition, actionType: SequenceStep['actionType']) => void;
  onDelayChange: (stepId: string, updates: Partial<Pick<SequenceStep, 'delayDays' | 'delayHours' | 'delayMinutes'>>) => void;
  onAddVersion: (stepId: string) => void;
  onMove: (stepId: string, direction: 'up' | 'down') => void;
  onRemove: (stepId: string) => void;
  removing: boolean;
  /** Panneau d'étape ouvert à côté : branches plus étroites, pour que le tronc et la branche ouverte tiennent dans la zone. */
  compact?: boolean;
}

export function SequenceFlow(props: SequenceFlowProps) {
  const { flow, steps, selectedId, issues } = props;
  const byId = useMemo(() => new Map(steps.map((s) => [s.id, s])), [steps]);
  const selectedPrimary = useMemo(() => {
    if (!selectedId) return null;
    const step = byId.get(selectedId);
    if (!step) return null;
    return steps.find((s) => s.order === step.order && (!s.variantGroup || s.variantGroup === 'A'))?.id ?? step.id;
  }, [byId, selectedId, steps]);

  const renderList = (nodes: EditorNode[], add: StepPosition | null, branchLabel: string | null, label?: string) => (
    <ol className="space-y-0" aria-label={label}>
      {nodes.map((node, index) => {
        const key = node.kind === 'step' || node.kind === 'fork' ? node.id : `${node.kind}-${index}`;
        const terminal = node.kind === 'end' || node.kind === 'join';
        return (
          <li key={key}>
            {index > 0 && <Connector />}
            {terminal && add && (
              <>
                <AddStepButton steps={steps} position={add} branchLabel={branchLabel} onAdd={props.onAdd} />
                <Connector />
              </>
            )}
            {node.kind === 'end' && <EndMarker />}
            {node.kind === 'join' && <JoinMarker number={node.number} title={node.title} />}
            {(node.kind === 'step' || node.kind === 'fork') && (() => {
              const step = byId.get(node.id);
              if (!step) return null;
              const versions = node.versionIds.length;
              return (
                <>
                  {node.showDelay && (
                    <>
                      <DelayPill
                        label={node.delay}
                        stepNumber={node.number}
                        value={step}
                        onChange={(updates) => props.onDelayChange(node.id, updates)}
                        readOnly={step.order === 0}
                      />
                      <Connector />
                    </>
                  )}
                  <StepCard
                    node={node}
                    selected={selectedPrimary === node.id}
                    issues={issues.get(step.order)}
                    actions={{
                      onSelect: () => props.onSelect(node.id),
                      onAddVersion: canHaveVersions(node.actionType) && versions < MAX_VERSIONS ? () => props.onAddVersion(node.id) : undefined,
                      moveUp: canMoveStep(steps, node.id, 'up'),
                      moveDown: canMoveStep(steps, node.id, 'down'),
                      onMove: (direction) => props.onMove(node.id, direction),
                      onRemove: () => props.onRemove(node.id),
                      removing: props.removing,
                    }}
                  />
                  {node.kind === 'step' && node.note && (
                    <p className="mx-auto mt-2 max-w-sm text-center text-xs text-muted-foreground">{node.note}</p>
                  )}
                  {node.kind === 'fork' && (
                    <BranchColumns
                      stepNumber={node.number}
                      branches={node.branches}
                      compact={props.compact}
                      renderBranch={(branch) => renderList(branch.nodes, branch.add, branch.label)}
                    />
                  )}
                </>
              );
            })()}
          </li>
        );
      })}
    </ol>
  );

  return (
    // En bureau, le fil ne descend pas sous la largeur minimale de ses branches : il défile dans sa zone au lieu de les écraser.
    <div className="mx-auto w-full min-w-0 md:min-w-min">
      <div className="flex justify-center">
        <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">{flow.start}</span>
      </div>
      <Connector />
      {renderList(flow.nodes, flow.add, null, 'Étapes de la séquence')}
      {flow.orphans.length > 0 && (
        <section aria-labelledby="etapes-hors-parcours" className="mx-auto mt-10 max-w-sm space-y-3 border-t border-border pt-6">
          <div className="space-y-1 text-center">
            <h3 id="etapes-hors-parcours" className="text-sm font-semibold text-foreground">Hors du parcours</h3>
            <p className="text-xs text-muted-foreground">Aucun chemin du fil n’y mène : ces étapes ne partiront pas. Reliez-les par « Après cette étape », ou supprimez-les.</p>
          </div>
          {renderList(flow.orphans, null, null, 'Étapes hors du parcours')}
        </section>
      )}
    </div>
  );
}
