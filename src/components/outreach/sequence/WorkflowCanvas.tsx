import React, { useCallback, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
  MarkerType,
  Position,
  ConnectionLineType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { SequenceStep } from '../SequenceBuilder';
import { WorkflowStepNode } from './nodes/WorkflowStepNode';
import { WorkflowAddNode } from './nodes/WorkflowAddNode';
import { WorkflowBranchLabelNode } from './nodes/WorkflowBranchLabelNode';
import { AnimatedEdge } from './edges/AnimatedEdge';

const nodeTypes: NodeTypes = {
  stepNode: WorkflowStepNode,
  addNode: WorkflowAddNode,
  branchLabel: WorkflowBranchLabelNode,
};

const edgeTypes: EdgeTypes = {
  animated: AnimatedEdge,
};

interface WorkflowCanvasProps {
  steps: SequenceStep[];
  selectedStepId: string | null;
  onStepClick: (stepId: string) => void;
  onAddStep: (branchTarget?: { parentStepId: string; branch: 'true' | 'false'; afterStepId?: string }) => void;
  onRemoveStep: (stepId: string) => void;
}

// ── Layout constants ──
const NODE_W = 210;
const NODE_H = 72;
const V_GAP = 52;
const BRANCH_GAP = 280; // horizontal distance between branch centres
const ADD_SIZE = 36;
const STEP_GAP = NODE_H + V_GAP; // vertical distance per step

// ── Helpers ──
const getBranchChain = (startId: string | undefined, all: SequenceStep[]): SequenceStep[] => {
  if (!startId) return [];
  const chain: SequenceStep[] = [];
  let cur: string | undefined = startId;
  const visited = new Set<string>();
  while (cur && cur !== '__end__' && !visited.has(cur)) {
    visited.add(cur);
    const s = all.find(x => x.id === cur);
    if (s) { chain.push(s); cur = s.nextStepId; } else break;
  }
  return chain;
};

const getAllBranchStepIds = (all: SequenceStep[]): Set<string> => {
  const ids = new Set<string>();
  const walk = (id: string | undefined, v: Set<string>) => {
    if (!id || id === '__end__' || v.has(id)) return;
    v.add(id); ids.add(id);
    const s = all.find(x => x.id === id);
    if (s?.nextStepId) walk(s.nextStepId, v);
    if (s?.ifTrueGotoStep) walk(s.ifTrueGotoStep, v);
    if (s?.ifFalseGotoStep) walk(s.ifFalseGotoStep, v);
  };
  for (const s of all) {
    if (s.actionType === 'check_connection') {
      const v = new Set<string>();
      if (s.ifTrueGotoStep) walk(s.ifTrueGotoStep, v);
      if (s.ifFalseGotoStep) walk(s.ifFalseGotoStep, v);
    }
  }
  return ids;
};

// ── Colour palette ──
const EDGE_DEFAULT = 'hsl(var(--border))';
const EDGE_TRUE = 'hsl(152, 68%, 46%)';
const EDGE_FALSE = 'hsl(25, 95%, 53%)';

// ── Layout builder ──
function buildLayout(
  steps: SequenceStep[],
  selectedStepId: string | null,
  onRemoveStep: (id: string) => void,
  onAddStep: WorkflowCanvasProps['onAddStep'],
) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const branchIds = getAllBranchStepIds(steps);

  if (steps.length === 0) {
    nodes.push({ id: 'add-root', type: 'addNode', position: { x: 0, y: 0 }, data: { onClick: () => onAddStep() } });
    return { nodes, edges };
  }

  const mainSteps = steps.filter(s => !branchIds.has(s.id));
  // Centre main trunk at x=0 (node placed at -NODE_W/2 so the centre is 0)
  const mainX = -NODE_W / 2;
  let y = 0;

  mainSteps.forEach((step, idx) => {
    const stepIndex = steps.findIndex(s => s.id === step.id);

    nodes.push({
      id: step.id,
      type: 'stepNode',
      position: { x: mainX, y },
      data: {
        step, index: stepIndex, allSteps: steps,
        isSelected: selectedStepId === step.id,
        canRemove: steps.length > 1,
        onRemove: () => onRemoveStep(step.id),
      },
    });

    // Edge from previous main step
    if (idx > 0) {
      const prev = mainSteps[idx - 1];
      if (prev.actionType !== 'check_connection') {
        edges.push({
          id: `e-${prev.id}-${step.id}`,
          source: prev.id, target: step.id,
          type: 'animated',
          style: { stroke: EDGE_DEFAULT },
          markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: EDGE_DEFAULT },
        });
      }
    }

    // ── Branch rendering ──
    if (step.actionType === 'check_connection') {
      const trueBranch = getBranchChain(step.ifTrueGotoStep, steps);
      const falseBranch = getBranchChain(step.ifFalseGotoStep, steps);

      const labelY = y + NODE_H + V_GAP * 0.6;
      const branchStartY = labelY + 36;

      // ── TRUE (left) ──
      const trueX = -BRANCH_GAP / 2 - NODE_W / 2;
      const trueLabelId = `label-true-${step.id}`;
      nodes.push({
        id: trueLabelId, type: 'branchLabel',
        position: { x: -BRANCH_GAP / 2 - 36, y: labelY },
        data: { label: '✓ Connecté', variant: 'true' },
        selectable: false, draggable: false,
      });
      edges.push({
        id: `e-${step.id}-true-label`,
        source: step.id, target: trueLabelId,
        type: 'animated',
        style: { stroke: EDGE_TRUE },
        markerEnd: { type: MarkerType.ArrowClosed, width: 10, height: 10, color: EDGE_TRUE },
      });

      let tY = branchStartY;
      trueBranch.forEach((bs, bi) => {
        const bsi = steps.findIndex(s => s.id === bs.id);
        nodes.push({
          id: bs.id, type: 'stepNode',
          position: { x: trueX, y: tY },
          data: {
            step: bs, index: bsi, allSteps: steps,
            isSelected: selectedStepId === bs.id, canRemove: true,
            onRemove: () => onRemoveStep(bs.id), compact: true,
          },
        });
        const prevId = bi === 0 ? trueLabelId : trueBranch[bi - 1].id;
        edges.push({
          id: `e-${prevId}-${bs.id}`, source: prevId, target: bs.id,
          type: 'animated', style: { stroke: EDGE_TRUE },
        });
        tY += 64;
      });

      // Add button
      const trueAddId = `add-true-${step.id}`;
      nodes.push({
        id: trueAddId, type: 'addNode',
        position: { x: -BRANCH_GAP / 2 - ADD_SIZE / 2, y: tY + 4 },
        data: {
          onClick: () => onAddStep({
            parentStepId: step.id, branch: 'true',
            afterStepId: trueBranch.length > 0 ? trueBranch[trueBranch.length - 1].id : undefined,
          }),
          variant: 'true',
        },
      });
      const trueLastId = trueBranch.length > 0 ? trueBranch[trueBranch.length - 1].id : trueLabelId;
      edges.push({
        id: `e-${trueLastId}-${trueAddId}`, source: trueLastId, target: trueAddId,
        type: 'animated', style: { stroke: EDGE_TRUE, strokeDasharray: '5 5' },
      });

      // ── FALSE (right) ──
      const falseX = BRANCH_GAP / 2 - NODE_W / 2;
      const falseLabelId = `label-false-${step.id}`;
      nodes.push({
        id: falseLabelId, type: 'branchLabel',
        position: { x: BRANCH_GAP / 2 - 44, y: labelY },
        data: { label: '✗ Non connecté', variant: 'false' },
        selectable: false, draggable: false,
      });
      edges.push({
        id: `e-${step.id}-false-label`,
        source: step.id, target: falseLabelId,
        type: 'animated',
        style: { stroke: EDGE_FALSE },
        markerEnd: { type: MarkerType.ArrowClosed, width: 10, height: 10, color: EDGE_FALSE },
      });

      let fY = branchStartY;
      falseBranch.forEach((bs, bi) => {
        const bsi = steps.findIndex(s => s.id === bs.id);
        nodes.push({
          id: bs.id, type: 'stepNode',
          position: { x: falseX, y: fY },
          data: {
            step: bs, index: bsi, allSteps: steps,
            isSelected: selectedStepId === bs.id, canRemove: true,
            onRemove: () => onRemoveStep(bs.id), compact: true,
          },
        });
        const prevId = bi === 0 ? falseLabelId : falseBranch[bi - 1].id;
        edges.push({
          id: `e-${prevId}-${bs.id}`, source: prevId, target: bs.id,
          type: 'animated', style: { stroke: EDGE_FALSE },
        });
        fY += 64;
      });

      const falseAddId = `add-false-${step.id}`;
      nodes.push({
        id: falseAddId, type: 'addNode',
        position: { x: BRANCH_GAP / 2 - ADD_SIZE / 2, y: fY + 4 },
        data: {
          onClick: () => onAddStep({
            parentStepId: step.id, branch: 'false',
            afterStepId: falseBranch.length > 0 ? falseBranch[falseBranch.length - 1].id : undefined,
          }),
          variant: 'false',
        },
      });
      const falseLastId = falseBranch.length > 0 ? falseBranch[falseBranch.length - 1].id : falseLabelId;
      edges.push({
        id: `e-${falseLastId}-${falseAddId}`, source: falseLastId, target: falseAddId,
        type: 'animated', style: { stroke: EDGE_FALSE, strokeDasharray: '5 5' },
      });

      y = Math.max(tY, fY) + 60;
    } else {
      y += STEP_GAP;
    }
  });

  // Add button at end (not after branch)
  const lastMain = mainSteps[mainSteps.length - 1];
  if (lastMain && lastMain.actionType !== 'check_connection') {
    const addId = 'add-end';
    nodes.push({
      id: addId, type: 'addNode',
      position: { x: -ADD_SIZE / 2, y },
      data: { onClick: () => onAddStep() },
    });
    edges.push({
      id: `e-${lastMain.id}-${addId}`, source: lastMain.id, target: addId,
      type: 'animated', style: { stroke: EDGE_DEFAULT, strokeDasharray: '5 5' },
    });
  }

  return { nodes, edges };
}

export const WorkflowCanvas: React.FC<WorkflowCanvasProps> = ({
  steps, selectedStepId, onStepClick, onAddStep, onRemoveStep,
}) => {
  const layout = useMemo(
    () => buildLayout(steps, selectedStepId, onRemoveStep, onAddStep),
    [steps, selectedStepId, onRemoveStep, onAddStep],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layout.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layout.edges);

  useEffect(() => {
    setNodes(layout.nodes);
    setEdges(layout.edges);
  }, [layout, setNodes, setEdges]);

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.type === 'stepNode' && node.data?.step) {
      onStepClick((node.data.step as SequenceStep).id);
    }
  }, [onStepClick]);

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionLineType={ConnectionLineType.SmoothStep}
        fitView
        fitViewOptions={{ padding: 0.35, maxZoom: 1.1 }}
        minZoom={0.25}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        className="bg-muted/5"
        defaultEdgeOptions={{ type: 'animated', animated: true }}
      >
        <Background gap={24} size={1} color="hsl(var(--border) / 0.2)" />
        <Controls
          showInteractive={false}
          className="!bg-background !border-border !shadow-sm !rounded-lg [&>button]:!bg-background [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-muted [&>button]:!rounded-md"
        />
      </ReactFlow>
    </div>
  );
};
