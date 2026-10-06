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
  ConnectionLineType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { SequenceStep } from '../SequenceBuilder';
import { WorkflowStepNode } from './nodes/WorkflowStepNode';
import { WorkflowAddNode } from './nodes/WorkflowAddNode';
import { WorkflowBranchLabelNode } from './nodes/WorkflowBranchLabelNode';
import { AnimatedEdge } from './edges/AnimatedEdge';
import { branchStepIds, engineNextStepId } from './sequenceGraph';
import { useAppTheme } from '@/lib/theme';

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


// ── Colour palette ──
// Arêtes neutres : les branches se distinguent par leur étiquette (« Connecté »,
// « Non connecté ») et leur position, pas par une couleur de statut (revue
// design D-35).
const EDGE_DEFAULT = 'hsl(var(--muted-foreground))';
const EDGE_TRUE = EDGE_DEFAULT;
const EDGE_FALSE = EDGE_DEFAULT;

// Libellés d'accessibilité du canevas, en français.
const ARIA_LABELS = {
  'node.a11yDescription.default': 'Appuyez sur Entrée ou Espace pour sélectionner cette étape.',
  'node.a11yDescription.keyboardDisabled': 'Appuyez sur Entrée ou Espace pour sélectionner cette étape.',
  'node.a11yDescription.ariaLiveMessage': () => 'Étape déplacée.',
  'edge.a11yDescription.default': 'Liaison entre deux étapes.',
  'controls.ariaLabel': 'Zoom du parcours',
  'controls.zoomIn.ariaLabel': 'Agrandir',
  'controls.zoomOut.ariaLabel': 'Réduire',
  'controls.fitView.ariaLabel': "Ajuster à l'écran",
  'controls.interactive.ariaLabel': 'Verrouiller le parcours',
  'minimap.ariaLabel': "Vue d'ensemble",
  'handle.ariaLabel': 'Point de liaison',
};

type WorkflowGraph = {
  nodes: Node[];
  edges: Edge[];
};

const isValidNode = (node: Node | null | undefined): node is Node => {
  return Boolean(
    node &&
    typeof node.id === 'string' &&
    node.id &&
    typeof node.position?.x === 'number' &&
    typeof node.position?.y === 'number'
  );
};

const isValidEdge = (edge: Edge | null | undefined): edge is Edge => {
  return Boolean(
    edge &&
    typeof edge.id === 'string' &&
    edge.id &&
    typeof edge.source === 'string' &&
    edge.source &&
    typeof edge.target === 'string' &&
    edge.target
  );
};

const sanitizeGraph = ({ nodes, edges }: WorkflowGraph): WorkflowGraph => {
  const uniqueNodes = new Map<string, Node>();

  for (const node of nodes) {
    if (!isValidNode(node) || uniqueNodes.has(node.id)) continue;
    uniqueNodes.set(node.id, node);
  }

  const nodeIds = new Set(uniqueNodes.keys());
  const uniqueEdges = new Map<string, Edge>();

  for (const edge of edges) {
    if (!isValidEdge(edge) || uniqueEdges.has(edge.id)) continue;
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    uniqueEdges.set(edge.id, edge);
  }

  return {
    nodes: [...uniqueNodes.values()],
    edges: [...uniqueEdges.values()],
  };
};

// Boutons « + » : seul le bouton interne est atteignable au clavier.
const ADD_NODE_FLAGS = { selectable: false, focusable: false, draggable: false } as const;

// ── Layout builder ──
function buildLayout(
  steps: SequenceStep[],
  selectedStepId: string | null,
  onRemoveStep: (id: string) => void,
  onAddStep: WorkflowCanvasProps['onAddStep'],
): WorkflowGraph {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const branchIds = branchStepIds(steps);

  if (steps.length === 0) {
    nodes.push({ id: 'add-root', type: 'addNode', position: { x: 0, y: 0 }, data: { onClick: () => onAddStep() }, ...ADD_NODE_FLAGS });
    return { nodes, edges };
  }

  const mainSteps = steps.filter(s => !branchIds.has(s.id));
  // Centre main trunk at x=0 (node placed at -NODE_W/2 so the centre is 0)
  const mainX = -NODE_W / 2;
  let y = 0;

  mainSteps.forEach((step, idx) => {
    nodes.push({
      id: step.id,
      type: 'stepNode',
      position: { x: mainX, y },
      // Sélection tenue par l'éditeur (clic : onNodeClick, clavier : handleKeyDown).
      selected: selectedStepId === step.id,
      data: {
        step, allSteps: steps,
        isSelected: selectedStepId === step.id,
        // La dernière étape se supprime aussi : on repart alors d'une séquence vide.
        canRemove: true,
        onRemove: () => onRemoveStep(step.id),
      },
    });

    // Arête vers l'étape que le moteur jouera vraiment après celle-ci
    // (« Étape suivante », sinon ordre suivant si rien ne la vise). Une chaîne
    // rompue n'est plus dessinée comme reliée.
    if (step.actionType !== 'check_connection') {
      const nextId = engineNextStepId(step, steps);
      if (nextId) {
        edges.push({
          id: `e-${step.id}-${nextId}`,
          source: step.id, target: nextId,
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
        data: { label: 'Connecté', variant: 'true' },
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
        nodes.push({
          id: bs.id, type: 'stepNode',
          position: { x: trueX, y: tY },
          selected: selectedStepId === bs.id,
          data: {
            step: bs, allSteps: steps,
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
        ...ADD_NODE_FLAGS,
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
        data: { label: 'Non connecté', variant: 'false' },
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
        nodes.push({
          id: bs.id, type: 'stepNode',
          position: { x: falseX, y: fY },
          selected: selectedStepId === bs.id,
          data: {
            step: bs, allSteps: steps,
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
        ...ADD_NODE_FLAGS,
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
      ...ADD_NODE_FLAGS,
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
  // Le canevas suit le thème de l'application : par défaut, React Flow pose la
  // classe « light » sur sa racine, ce qui rebascule les jetons en thème clair.
  const theme = useAppTheme();
  const layout = useMemo(() => {
    try {
      return sanitizeGraph(buildLayout(steps, selectedStepId, onRemoveStep, onAddStep));
    } catch (error) {
      console.error('[WorkflowCanvas] Failed to build layout', error);
      return { nodes: [], edges: [] };
    }
  }, [steps, selectedStepId, onRemoveStep, onAddStep]);

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

  // Entrée ou Espace sur une étape focalisée ouvre ses réglages (onNodeClick ne
  // part qu'à la souris). On écoute la touche et non onSelectionChange : la
  // sélection posée par l'éditeur relançait onSelectionChange, et l'éditeur
  // basculait sans fin entre deux étapes.
  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const stepId = (event.target as HTMLElement).closest('.react-flow__node')?.getAttribute('data-id');
    if (stepId && steps.some(s => s.id === stepId)) onStepClick(stepId);
  }, [onStepClick, steps]);

  return (
    <div className="w-full h-full" onKeyDown={handleKeyDown}>
      <ReactFlow
        colorMode={theme}
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        // Mise en page calculée : un nœud déplacé revenait à sa place.
        nodesDraggable={false}
        nodesConnectable={false}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionLineType={ConnectionLineType.SmoothStep}
        fitView
        fitViewOptions={{ padding: 0.35, maxZoom: 1.1 }}
        minZoom={0.25}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        className="bg-muted/5"
        // Arêtes immobiles : pas d'animation en boucle (01-direction.md, § 7).
        defaultEdgeOptions={{ type: 'animated' }}
        ariaLabelConfig={ARIA_LABELS}
        // Une étape se retire par son bouton : la touche Suppr ne ferait
        // disparaître que son dessin, pas l'étape.
        deleteKeyCode={null}
      >
        <Background gap={24} size={1} color="hsl(var(--border-hsl) / var(--border-alpha))" />
        <Controls
          showInteractive={false}
          className="!bg-background !border-border !shadow-sm !rounded-lg [&>button]:!bg-background [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-muted [&>button]:!rounded-md"
        />
      </ReactFlow>
    </div>
  );
};
