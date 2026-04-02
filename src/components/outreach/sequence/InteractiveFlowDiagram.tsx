import React from 'react';
import { 
  Mail,
  UserPlus,
  Eye,
  MessageSquare,
  Sparkles,
  GitBranch,
  Timer,
  Plus,
  Trash2,
  Check,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { SequenceStep } from '../SequenceBuilder';
import { getStepMessageType } from './messageTypeUtils';
import whatsappLogo from '@/assets/whatsapp-logo.svg';

export type BranchTarget = 'true' | 'false' | null;

interface InteractiveFlowDiagramProps {
  steps: SequenceStep[];
  onStepClick: (stepId: string) => void;
  onAddStep: (branchTarget?: { parentStepId: string; branch: 'true' | 'false'; afterStepId?: string }) => void;
  onRemoveStep: (stepId: string) => void;
  selectedStepId: string | null;
}

const STEP_ICONS: Record<string, React.ElementType | null> = {
  inmail: Mail,
  connection_request: UserPlus,
  profile_visit: Eye,
  message: MessageSquare,
  smart_message: Sparkles,
  whatsapp_message: null,
  email: Mail,
  wait_connection: Timer,
  wait_reply: MessageSquare,
  wait_profile_visit: Eye,
  condition_branch: GitBranch,
  check_connection: GitBranch,
};

const STEP_BG: Record<string, string> = {
  inmail: 'bg-info/10 border-info/20',
  connection_request: 'bg-success/10 border-success/20',
  profile_visit: 'bg-sky-50 border-sky-200/80',
  message: 'bg-warning/10 border-warning/20',
  smart_message: 'bg-purple-50 border-purple-200/80',
  whatsapp_message: 'bg-green-50 border-green-200/80',
  email: 'bg-violet-50 border-violet-200/80',
  wait_connection: 'bg-warning/10 border-warning/20',
  wait_reply: 'bg-warning/10 border-warning/20',
  wait_profile_visit: 'bg-warning/10 border-warning/20',
  condition_branch: 'bg-destructive/10 border-destructive/20',
  check_connection: 'bg-indigo-50 border-indigo-200/80',
};

const STEP_ICON_BG: Record<string, string> = {
  inmail: 'bg-info/20 text-info-foreground',
  connection_request: 'bg-success/20 text-success-foreground',
  profile_visit: 'bg-sky-100 text-sky-600',
  message: 'bg-warning/20 text-warning-foreground',
  smart_message: 'bg-purple-100 text-purple-600',
  whatsapp_message: 'bg-green-100 text-green-600',
  email: 'bg-violet-100 text-violet-600',
  wait_connection: 'bg-warning/20 text-warning-foreground',
  wait_reply: 'bg-warning/20 text-warning-foreground',
  wait_profile_visit: 'bg-warning/20 text-warning-foreground',
  condition_branch: 'bg-destructive/20 text-destructive',
  check_connection: 'bg-indigo-100 text-indigo-600',
};

const STEP_LABELS: Record<string, string> = {
  inmail: 'InMail',
  connection_request: 'Invitation',
  profile_visit: 'Visite profil',
  message: 'Message',
  smart_message: 'Smart Msg',
  whatsapp_message: 'WhatsApp',
  email: 'Email',
  wait_connection: 'Attendre',
  wait_reply: 'Att. réponse',
  wait_profile_visit: 'Att. visite',
  condition_branch: 'Branchement',
  check_connection: 'Vérifier co.',
};

// ── Step Node ──
const StepNode: React.FC<{
  step: SequenceStep;
  index: number;
  allSteps: SequenceStep[];
  onClick: () => void;
  onRemove: () => void;
  isSelected: boolean;
  canRemove: boolean;
  compact?: boolean;
}> = ({ step, index, allSteps, onClick, onRemove, isSelected, canRemove, compact = false }) => {
  const Icon = STEP_ICONS[step.actionType];
  const isWhatsApp = step.actionType === 'whatsapp_message';
  const bgClass = STEP_BG[step.actionType] || 'bg-muted/40 border-border';
  const iconBg = STEP_ICON_BG[step.actionType] || 'bg-muted text-muted-foreground';
  const msgType = getStepMessageType(step, allSteps);

  const hasDelay = step.delayDays > 0 || step.delayHours > 0 || (step.delayMinutes && step.delayMinutes > 0);
  const delayLabel = [
    step.delayDays > 0 ? `${step.delayDays}j` : '',
    step.delayHours > 0 ? `${step.delayHours}h` : '',
    step.delayMinutes && step.delayMinutes > 0 ? `${step.delayMinutes}m` : '',
  ].filter(Boolean).join(' ');

  if (compact) {
    return (
      <div
        className={cn(
          "relative group cursor-pointer transition-all duration-150",
          isSelected && "scale-[1.03]"
        )}
        onClick={onClick}
      >
        <div className={cn(
          "flex items-center gap-2 px-2.5 py-1.5 rounded-lg border transition-all",
          bgClass,
          isSelected && "ring-2 ring-foreground/20 ring-offset-1 shadow-sm"
        )}>
          <div className={cn("w-5 h-5 rounded flex items-center justify-center shrink-0", iconBg)}>
            {isWhatsApp ? <img src={whatsappLogo} alt="WhatsApp" className="w-3 h-3" /> : Icon ? <Icon className="w-3 h-3" /> : <Mail className="w-3 h-3" />}
          </div>
          <span className="text-[11px] font-medium truncate">{STEP_LABELS[step.actionType]}</span>
        </div>
        {canRemove && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="absolute -top-1 -right-1 w-4 h-4 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Trash2 className="w-2 h-2" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative group cursor-pointer transition-all duration-150",
        isSelected && "scale-[1.02]"
      )}
      onClick={onClick}
    >
      <div className={cn(
        "flex items-center gap-3 px-4 py-3 rounded-xl border transition-all min-w-[170px] max-w-[200px]",
        bgClass,
        isSelected && "ring-2 ring-foreground/20 ring-offset-2 shadow-md"
      )}>
        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", iconBg)}>
          {isWhatsApp ? <img src={whatsappLogo} alt="WhatsApp" className="w-4 h-4" /> : Icon ? <Icon className="w-4 h-4" /> : <Mail className="w-4 h-4" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] text-muted-foreground/50 leading-none mb-0.5">Étape {index + 1}</div>
          <div className="text-[13px] font-semibold truncate leading-tight">
            {STEP_LABELS[step.actionType]}
          </div>
          {msgType && (
            <div className={cn("text-[9px] font-medium px-1.5 py-0.5 rounded-full w-fit mt-1", msgType.color)}>
              {msgType.shortLabel}
            </div>
          )}
          {hasDelay && (
            <div className="text-[10px] text-muted-foreground/50 mt-0.5">{delayLabel}</div>
          )}
        </div>
      </div>
      {canRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
        >
          <Trash2 className="w-2.5 h-2.5" />
        </button>
      )}
    </div>
  );
};

// ── Connector line ──
const Connector: React.FC<{ className?: string }> = ({ className }) => (
  <div className={cn("flex flex-col items-center py-1", className)}>
    <div className="w-px h-5 bg-border" />
    <div className="w-1.5 h-1.5 rounded-full bg-border -mt-px" />
  </div>
);

// ── Branch helpers ──
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
    if (step) {
      if (step.nextStepId) collectChain(step.nextStepId, visited);
      if (step.ifTrueGotoStep) collectChain(step.ifTrueGotoStep, visited);
      if (step.ifFalseGotoStep) collectChain(step.ifFalseGotoStep, visited);
      if (step.timeoutBranchStepId) collectChain(step.timeoutBranchStepId, visited);
    }
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

// ── Branch column ──
const BranchColumn: React.FC<{
  branchSteps: SequenceStep[];
  allSteps: SequenceStep[];
  branchType: 'true' | 'false';
  parentStepId: string;
  onStepClick: (stepId: string) => void;
  onAddBranchStep: (branch: 'true' | 'false', afterStepId?: string) => void;
  onRemoveStep: (stepId: string) => void;
  selectedStepId: string | null;
}> = ({ branchSteps, allSteps, branchType, parentStepId, onStepClick, onAddBranchStep, onRemoveStep, selectedStepId }) => {
  const isTrue = branchType === 'true';
  const accentLine = isTrue ? 'bg-success' : 'bg-warning';
  const label = isTrue ? '1er degré' : '2e/3e degré';
  const LabelIcon = isTrue ? Check : X;
  const labelColor = isTrue ? 'text-success-foreground bg-success/10 border-success/20' : 'text-warning-foreground bg-warning/10 border-warning/20';
  const addBorder = isTrue ? 'border-success/20 text-success-foreground hover:bg-success/10' : 'border-warning/20 text-warning-foreground hover:bg-warning/10';

  return (
    <div className="flex flex-col items-center min-w-[110px]">
      <div className={cn("flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border mb-1.5", labelColor)}>
        <LabelIcon className="w-2.5 h-2.5" />
        {label}
      </div>
      <div className={cn("w-px h-2", accentLine)} />

      {branchSteps.length > 0 ? (
        <>
          {branchSteps.map((branchStep, idx) => {
            const stepIndex = allSteps.findIndex(s => s.id === branchStep.id);
            return (
              <React.Fragment key={branchStep.id}>
                {idx > 0 && <div className={cn("w-px h-2", accentLine)} />}
                <StepNode
                  step={branchStep} index={stepIndex} allSteps={allSteps}
                  onClick={() => onStepClick(branchStep.id)}
                  onRemove={() => onRemoveStep(branchStep.id)}
                  isSelected={selectedStepId === branchStep.id}
                  canRemove={allSteps.length > 1} compact
                />
              </React.Fragment>
            );
          })}
          <div className={cn("w-px h-2", accentLine)} />
          <button
            onClick={() => onAddBranchStep(branchType, branchSteps[branchSteps.length - 1]?.id)}
            className={cn("w-5 h-5 rounded-full border border-dashed flex items-center justify-center transition-colors", addBorder)}
          >
            <Plus className="w-2.5 h-2.5" />
          </button>
        </>
      ) : (
        <button
          onClick={() => onAddBranchStep(branchType)}
          className={cn("flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-dashed text-[10px] font-medium transition-colors", addBorder)}
        >
          <Plus className="w-3 h-3" />
          Ajouter
        </button>
      )}
    </div>
  );
};

// ── Branch split ──
const BranchSplit: React.FC<{
  step: SequenceStep;
  stepIndex: number;
  allSteps: SequenceStep[];
  onStepClick: (stepId: string) => void;
  onAddBranchStep: (branch: 'true' | 'false', afterStepId?: string) => void;
  onRemoveStep: (stepId: string) => void;
  selectedStepId: string | null;
}> = ({ step, stepIndex, allSteps, onStepClick, onAddBranchStep, onRemoveStep, selectedStepId }) => {
  const trueBranchSteps = getBranchChain(step.ifTrueGotoStep, allSteps);
  const falseBranchSteps = getBranchChain(step.ifFalseGotoStep, allSteps);

  return (
    <div className="flex flex-col items-center w-full mt-2">
      <div className="flex items-center justify-center w-full gap-1">
        <div className="flex-1 h-px bg-success max-w-[70px]" />
        <div className="w-2 h-2 rounded-full bg-indigo-400" />
        <div className="flex-1 h-px bg-warning max-w-[70px]" />
      </div>
      <div className="flex justify-center gap-3 w-full mt-1.5">
        <BranchColumn branchSteps={trueBranchSteps} allSteps={allSteps} branchType="true" parentStepId={step.id} onStepClick={onStepClick} onAddBranchStep={onAddBranchStep} onRemoveStep={onRemoveStep} selectedStepId={selectedStepId} />
        <BranchColumn branchSteps={falseBranchSteps} allSteps={allSteps} branchType="false" parentStepId={step.id} onStepClick={onStepClick} onAddBranchStep={onAddBranchStep} onRemoveStep={onRemoveStep} selectedStepId={selectedStepId} />
      </div>
    </div>
  );
};

// ── Main diagram ──
export const InteractiveFlowDiagram: React.FC<InteractiveFlowDiagramProps> = ({
  steps, onStepClick, onAddStep, onRemoveStep, selectedStepId,
}) => {
  const branchStepIds = getAllBranchStepIds(steps);

  const renderFlow = () => {
    const elements: React.ReactNode[] = [];
    let prevStepWasBranch = false;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (branchStepIds.has(step.id)) continue;

      if (elements.length > 0 && !prevStepWasBranch) {
        elements.push(<Connector key={`conn-${step.id}`} />);
      }

      elements.push(
        <StepNode key={step.id} step={step} index={i} allSteps={steps}
          onClick={() => onStepClick(step.id)} onRemove={() => onRemoveStep(step.id)}
          isSelected={selectedStepId === step.id} canRemove={steps.length > 1}
        />
      );

      prevStepWasBranch = step.actionType === 'check_connection';

      if (step.actionType === 'check_connection') {
        elements.push(
          <BranchSplit key={`branch-${step.id}`} step={step} stepIndex={i} allSteps={steps}
            onStepClick={onStepClick}
            onAddBranchStep={(branch, afterStepId) => onAddStep({ parentStepId: step.id, branch, afterStepId })}
            onRemoveStep={onRemoveStep} selectedStepId={selectedStepId}
          />
        );
      }
    }
    return elements;
  };

  const lastStep = steps[steps.length - 1];
  const lastStepIsBranch = lastStep?.actionType === 'check_connection';

  return (
    <div className="flex flex-col items-center py-6 px-4">
      {steps.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center mb-3">
            <Plus className="w-5 h-5 text-muted-foreground/40" />
          </div>
          <p className="text-xs text-muted-foreground/60 mb-3">Aucune étape</p>
          <Button onClick={() => onAddStep()} size="sm" variant="outline" className="h-7 text-xs">
            <Plus className="w-3 h-3 mr-1.5" />Ajouter
          </Button>
        </div>
      ) : (
        <>
          {renderFlow()}
          {(!lastStepIsBranch) && (
            <>
              <Connector />
              <button
                onClick={() => onAddStep()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:text-foreground hover:border-border hover:bg-muted/30 transition-colors"
              >
                <Plus className="w-3 h-3" />
                Ajouter une étape
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
};
