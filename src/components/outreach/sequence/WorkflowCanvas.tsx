import React, { useCallback, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
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

// ── Layout helpers ──
const NODE_WIDTH = 200;
const NODE_HEIGHT = 72;
const V_GAP = 60;
const H_GAP = 240;
const ADD_NODE_SIZE = 36;

const getBranchChain = (startStepId: string | undefined, allSteps: SequenceStep[]): SequenceStep[] => {
  if (!startStepId) return [];
  const chain: SequenceStep[] = [];
  let currentId: string | undefined = startStepId;
  const visited = new Set<string>();
  while (currentId && currentId !== '__end__' && !visited.has(currentId)) {
    visited.add(currentId);
    const step = allSteps.find(s => s.id === currentId);
    if (step) { chain.push(step); currentId = step.nextStepId; } else break;
  }
  return chain;
};

const getAllBranchStepIds = (allSteps: SequenceStep[]): Set<string> => {
  const branchIds = new Set<string>();
  const collectChain = (stepId: string | undefined, visited: Set<string>) => {
    if (!stepId || stepId === '__end__' || visited.has(stepId)) return;
    visited.add(stepId); branchIds.add(stepId);
    const step = allSteps.find(s => s.id === stepId);
    if (step?.nextStepId) collectChain(step.nextStepId, visited);
    if (step?.ifTrueGotoStep) collectChain(step.ifTrueGotoStep, visited);
    if (step?.ifFalseGotoStep) collectChain(step.ifFalseGotoStep, visited);
  };
  for (const step of allSteps) {
    if (step.actionType === 'check_connection') {
      const visited = new Set<string>();
      if (step.ifTrueGotoStep) collectChain(step.ifTrueGotoStep, visited);
      if (step.ifFalseGotoStep) collectChain(step.ifFalseGotoStep, visited);
    }
  }
  return branchIds;
};

function buildLayout(steps: SequenceStep[], selectedStepId: string | null, onRemoveStep: (id: string) => void, onAddStep: WorkflowCanvasProps['onAddStep']) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const branchStepIds = getAllBranchStepIds(steps);

  if (steps.length === 0) {
    nodes.push({
      id: 'add-root',
      type: 'addNode',
      position: { x: 0, y: 0 },
      data: { onClick: () => onAddStep() },
    });
    return { nodes, edges };
  }

  // Get main trunk steps (not in branches)
  const mainSteps = steps.filter(s => !branchStepIds.has(s.id));
  let y = 0;

  mainSteps.forEach((step, idx) => {
    const stepIndex = steps.findIndex(s => s.id === step.id);

    nodes.push({
      id: step.id,
      type: 'stepNode',
      position: { x: 0, y },
      data: {
        step,
        index: stepIndex,
        allSteps: steps,
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
          source: prev.id,
          target: step.id,
          type: 'animated',
          style: { stroke: 'hsl(var(--border))' },
          markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: 'hsl(var(--border))' },
        });
      }
    }

    // Handle check_connection branching
    if (step.actionType === 'check_connection') {
      const trueBranch = getBranchChain(step.ifTrueGotoStep, steps);
      const falseBranch = getBranchChain(step.ifFalseGotoStep, steps);

      const branchY = y + NODE_HEIGHT + V_GAP;

      // True branch label
      const trueLabelId = `label-true-${step.id}`;
      nodes.push({
        id: trueLabelId,
        type: 'branchLabel',
        position: { x: -(H_GAP / 2) - 40, y: branchY - 20 },
        data: { label: '1er degré', variant: 'true' },
        selectable: false,
        draggable: false,
      });

      edges.push({
        id: `e-${step.id}-true-label`,
        source: step.id,
        target: trueLabelId,
        type: 'animated',
        style: { stroke: 'hsl(142, 71%, 45%)' },
        markerEnd: { type: MarkerType.ArrowClosed, width: 10, height: 10, color: 'hsl(142, 71%, 45%)' },
      });

      // True branch steps
      let trueY = branchY + 20;
      trueBranch.forEach((bStep, bIdx) => {
        const bStepIndex = steps.findIndex(s => s.id === bStep.id);
        nodes.push({
          id: bStep.id,
          type: 'stepNode',
          position: { x: -(H_GAP / 2) - NODE_WIDTH / 2 + 40, y: trueY },
          data: {
            step: bStep, index: bStepIndex, allSteps: steps,
            isSelected: selectedStepId === bStep.id, canRemove: true,
            onRemove: () => onRemoveStep(bStep.id), compact: true,
          },
        });
        const prevId = bIdx === 0 ? trueLabelId : trueBranch[bIdx - 1].id;
        edges.push({
          id: `e-${prevId}-${bStep.id}`,
          source: prevId, target: bStep.id, type: 'animated',
          style: { stroke: 'hsl(142, 71%, 45%)' },
        });
        trueY += 56;
      });

      // Add button for true branch
      const trueAddId = `add-true-${step.id}`;
      nodes.push({
        id: trueAddId,
        type: 'addNode',
        position: { x: -(H_GAP / 2) - ADD_NODE_SIZE / 2 + 40, y: trueY + 4 },
        data: {
          onClick: () => onAddStep({
            parentStepId: step.id,
            branch: 'true',
            afterStepId: trueBranch.length > 0 ? trueBranch[trueBranch.length - 1].id : undefined,
          }),
          variant: 'true',
        },
      });
      const trueLastId = trueBranch.length > 0 ? trueBranch[trueBranch.length - 1].id : trueLabelId;
      edges.push({
        id: `e-${trueLastId}-${trueAddId}`,
        source: trueLastId, target: trueAddId, type: 'animated',
        style: { stroke: 'hsl(142, 71%, 45%)', strokeDasharray: '4 4' },
      });

      // False branch label
      const falseLabelId = `label-false-${step.id}`;
      nodes.push({
        id: falseLabelId,
        type: 'branchLabel',
        position: { x: (H_GAP / 2) - 40, y: branchY - 20 },
        data: { label: '2e/3e degré', variant: 'false' },
        selectable: false,
        draggable: false,
      });

      edges.push({
        id: `e-${step.id}-false-label`,
        source: step.id,
        target: falseLabelId,
        type: 'animated',
        style: { stroke: 'hsl(25, 95%, 53%)' },
        markerEnd: { type: MarkerType.ArrowClosed, width: 10, height: 10, color: 'hsl(25, 95%, 53%)' },
      });

      // False branch steps
      let falseY = branchY + 20;
      falseBranch.forEach((bStep, bIdx) => {
        const bStepIndex = steps.findIndex(s => s.id === bStep.id);
        nodes.push({
          id: bStep.id,
          type: 'stepNode',
          position: { x: (H_GAP / 2) - NODE_WIDTH / 2 + 40, y: falseY },
          data: {
            step: bStep, index: bStepIndex, allSteps: steps,
            isSelected: selectedStepId === bStep.id, canRemove: true,
            onRemove: () => onRemoveStep(bStep.id), compact: true,
          },
        });
        const prevId = bIdx === 0 ? falseLabelId : falseBranch[bIdx - 1].id;
        edges.push({
          id: `e-${prevId}-${bStep.id}`,
          source: prevId, target: bStep.id, type: 'animated',
          style: { stroke: 'hsl(25, 95%, 53%)' },
        });
        falseY += 56;
      });

      // Add button for false branch
      const falseAddId = `add-false-${step.id}`;
      nodes.push({
        id: falseAddId,
        type: 'addNode',
        position: { x: (H_GAP / 2) - ADD_NODE_SIZE / 2 + 40, y: falseY + 4 },
        data: {
          onClick: () => onAddStep({
            parentStepId: step.id,
            branch: 'false',
            afterStepId: falseBranch.length > 0 ? falseBranch[falseBranch.length - 1].id : undefined,
          }),
          variant: 'false',
        },
      });
      const falseLastId = falseBranch.length > 0 ? falseBranch[falseBranch.length - 1].id : falseLabelId;
      edges.push({
        id: `e-${falseLastId}-${falseAddId}`,
        source: falseLastId, target: falseAddId, type: 'animated',
        style: { stroke: 'hsl(25, 95%, 53%)', strokeDasharray: '4 4' },
      });

      // Move y past the branches
      const maxBranchY = Math.max(trueY, falseY) + 40;
      y = maxBranchY;
    } else {
      y += NODE_HEIGHT + V_GAP;
    }
  });

  // Add button at the end (if last step isn't a branch)
  const lastMainStep = mainSteps[mainSteps.length - 1];
  if (lastMainStep && lastMainStep.actionType !== 'check_connection') {
    const addId = 'add-end';
    nodes.push({
      id: addId,
      type: 'addNode',
      position: { x: NODE_WIDTH / 2 - ADD_NODE_SIZE / 2, y },
      data: { onClick: () => onAddStep() },
    });
    edges.push({
      id: `e-${lastMainStep.id}-${addId}`,
      source: lastMainStep.id, target: addId, type: 'animated',
      style: { stroke: 'hsl(var(--border))', strokeDasharray: '4 4' },
    });
  }

  return { nodes, edges };
}

export const WorkflowCanvas: React.FC<WorkflowCanvasProps> = ({
  steps, selectedStepId, onStepClick, onAddStep, onRemoveStep,
}) => {
  const layout = useMemo(
    () => buildLayout(steps, selectedStepId, onRemoveStep, onAddStep),
    [steps, selectedStepId, onRemoveStep, onAddStep]
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
        fitViewOptions={{ padding: 0.3, maxZoom: 1.2 }}
        minZoom={0.3}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        className="bg-muted/5"
        defaultEdgeOptions={{
          type: 'animated',
          animated: true,
        }}
      >
        <Background gap={20} size={1} color="hsl(var(--border) / 0.3)" />
        <Controls
          showInteractive={false}
          className="!bg-background !border-border !shadow-sm [&>button]:!bg-background [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-muted"
        />
        <MiniMap
          nodeColor={(node) => {
            if (node.type === 'addNode') return 'hsl(var(--muted))';
            return 'hsl(var(--primary) / 0.6)';
          }}
          maskColor="hsl(var(--background) / 0.8)"
          className="!bg-background !border-border"
          pannable
          zoomable
        />
      </ReactFlow>
    </div>
  );
};
