import React from 'react';
import { 
  Mail,
  UserPlus,
  Eye,
  MessageSquare,
  Sparkles,
  GitBranch,
  Timer,
  ArrowDown,
  Check,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SequenceStep } from './SequenceBuilder';

interface SequenceFlowDiagramProps {
  steps: SequenceStep[];
  onStepClick?: (stepId: string) => void;
  selectedStepId?: string | null;
}

const STEP_ICONS: Record<string, React.ElementType> = {
  inmail: Mail,
  connection_request: UserPlus,
  profile_visit: Eye,
  message: MessageSquare,
  smart_message: Sparkles,
  wait_connection: Timer,
  wait_reply: MessageSquare,
  wait_profile_visit: Eye,
  condition_branch: GitBranch,
  check_connection: GitBranch,
};

const STEP_COLORS: Record<string, string> = {
  inmail: 'bg-blue-100 text-blue-600 border-blue-200',
  connection_request: 'bg-emerald-100 text-emerald-600 border-emerald-200',
  profile_visit: 'bg-sky-100 text-sky-600 border-sky-200',
  message: 'bg-orange-100 text-orange-600 border-orange-200',
  smart_message: 'bg-purple-100 text-purple-600 border-purple-200',
  wait_connection: 'bg-amber-100 text-amber-600 border-amber-200',
  wait_reply: 'bg-amber-100 text-amber-600 border-amber-200',
  wait_profile_visit: 'bg-amber-100 text-amber-600 border-amber-200',
  condition_branch: 'bg-rose-100 text-rose-600 border-rose-200',
  check_connection: 'bg-indigo-100 text-indigo-600 border-indigo-200',
};

const STEP_LABELS: Record<string, string> = {
  inmail: 'InMail',
  connection_request: 'Invitation',
  profile_visit: 'Visite profil',
  message: 'Message',
  smart_message: 'Smart Msg',
  wait_connection: 'Attendre',
  wait_reply: 'Attendre',
  wait_profile_visit: 'Attendre',
  condition_branch: 'Branche',
  check_connection: 'Vérifier',
};

const StepNode: React.FC<{
  step: SequenceStep;
  onClick?: () => void;
  isSelected?: boolean;
  size?: 'sm' | 'md';
}> = ({ step, onClick, isSelected, size = 'md' }) => {
  const Icon = STEP_ICONS[step.actionType] || Mail;
  const colorClass = STEP_COLORS[step.actionType] || 'bg-gray-100 text-gray-600 border-gray-200';
  
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border-2 transition-all hover:scale-105",
        colorClass,
        isSelected && "ring-2 ring-primary ring-offset-2",
        size === 'sm' ? "w-16 h-14 p-1" : "w-20 h-16 p-2"
      )}
    >
      <Icon className={cn("mb-0.5", size === 'sm' ? "w-4 h-4" : "w-5 h-5")} />
      <span className={cn("font-medium text-center leading-tight", size === 'sm' ? "text-[10px]" : "text-xs")}>
        {STEP_LABELS[step.actionType]}
      </span>
    </button>
  );
};

const Arrow: React.FC<{ className?: string }> = ({ className }) => (
  <div className={cn("flex justify-center", className)}>
    <ArrowDown className="w-4 h-4 text-gray-400" />
  </div>
);

const BranchArrow: React.FC<{ direction: 'left' | 'right'; label: string; color: string }> = ({ direction, label, color }) => (
  <div className={cn(
    "flex flex-col items-center",
    direction === 'left' ? "mr-auto" : "ml-auto"
  )}>
    <div className={cn(
      "flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded",
      color
    )}>
      {direction === 'left' ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
      {label}
    </div>
    <div className={cn(
      "w-px h-4 mt-1",
      direction === 'left' ? "bg-emerald-300" : "bg-orange-300"
    )} />
  </div>
);

export const SequenceFlowDiagram: React.FC<SequenceFlowDiagramProps> = ({
  steps,
  onStepClick,
  selectedStepId,
}) => {
  // Build the flow with branches
  const renderFlow = () => {
    const elements: React.ReactNode[] = [];
    let i = 0;
    
    while (i < steps.length) {
      const step = steps[i];
      
      // Check if this is a branching step
      if (step.actionType === 'check_connection') {
        // Render the check_connection node
        elements.push(
          <div key={step.id} className="flex flex-col items-center">
            {i > 0 && <Arrow className="my-2" />}
            <StepNode
              step={step}
              onClick={() => onStepClick?.(step.id)}
              isSelected={selectedStepId === step.id}
            />
          </div>
        );
        
        // Find branch targets
        const trueStep = steps.find(s => s.id === step.ifTrueGotoStep);
        const falseStep = steps.find(s => s.id === step.ifFalseGotoStep);
        
        // If we have branch targets, render the split
        if (trueStep || falseStep) {
          elements.push(
            <div key={`branch-${step.id}`} className="flex flex-col items-center w-full">
              {/* Branch split line */}
              <div className="flex items-start justify-center w-full mt-2">
                <div className="w-1/3 h-px bg-gray-300" />
                <div className="w-1/3 h-px bg-gray-300" />
              </div>
              
              {/* Two branches */}
              <div className="flex justify-center gap-8 w-full mt-1">
                {/* Left branch (if connected) */}
                <div className="flex flex-col items-center">
                  <BranchArrow direction="left" label="1er°" color="bg-emerald-100 text-emerald-700" />
                  {trueStep ? (
                    <StepNode
                      step={trueStep}
                      onClick={() => onStepClick?.(trueStep.id)}
                      isSelected={selectedStepId === trueStep.id}
                      size="sm"
                    />
                  ) : (
                    <div className="w-16 h-10 rounded border-2 border-dashed border-gray-300 flex items-center justify-center text-xs text-gray-400">
                      Suivant
                    </div>
                  )}
                </div>
                
                {/* Right branch (if not connected) */}
                <div className="flex flex-col items-center">
                  <BranchArrow direction="right" label="2e/3e°" color="bg-orange-100 text-orange-700" />
                  {falseStep ? (
                    <StepNode
                      step={falseStep}
                      onClick={() => onStepClick?.(falseStep.id)}
                      isSelected={selectedStepId === falseStep.id}
                      size="sm"
                    />
                  ) : (
                    <div className="w-16 h-10 rounded border-2 border-dashed border-gray-300 flex items-center justify-center text-xs text-gray-400">
                      Suivant
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
          
          // Skip the branch target steps in main flow if they are next
          const trueIdx = steps.findIndex(s => s.id === step.ifTrueGotoStep);
          const falseIdx = steps.findIndex(s => s.id === step.ifFalseGotoStep);
          
          // Find steps after branches that aren't part of the split
          const branchIndices = [trueIdx, falseIdx].filter(idx => idx > i);
          if (branchIndices.length > 0) {
            // Skip to after the highest branch index + render remaining steps
            const maxBranchIdx = Math.max(...branchIndices);
            
            // Render subsequent steps after branches
            const remainingSteps = steps.slice(maxBranchIdx + 1);
            if (remainingSteps.length > 0) {
              elements.push(
                <div key={`after-branch-${step.id}`} className="flex flex-col items-center mt-4">
                  <div className="w-px h-4 bg-gray-300" />
                  {remainingSteps.map((rs, ri) => (
                    <div key={rs.id} className="flex flex-col items-center">
                      {ri > 0 && <Arrow className="my-2" />}
                      <StepNode
                        step={rs}
                        onClick={() => onStepClick?.(rs.id)}
                        isSelected={selectedStepId === rs.id}
                      />
                    </div>
                  ))}
                </div>
              );
            }
            
            // Exit loop since we've rendered everything
            break;
          }
        }
      } else {
        // Regular step
        elements.push(
          <div key={step.id} className="flex flex-col items-center">
            {i > 0 && <Arrow className="my-2" />}
            <StepNode
              step={step}
              onClick={() => onStepClick?.(step.id)}
              isSelected={selectedStepId === step.id}
            />
          </div>
        );
      }
      
      i++;
    }
    
    return elements;
  };

  if (steps.length === 0) {
    return (
      <div className="flex items-center justify-center p-6 text-sm text-muted-foreground border-2 border-dashed rounded-lg">
        Ajoutez des étapes pour voir le workflow
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center p-4 bg-gray-50 rounded-lg border">
      <div className="text-xs font-medium text-muted-foreground mb-3 flex items-center gap-1">
        <GitBranch className="w-3 h-3" />
        Aperçu du workflow
      </div>
      {renderFlow()}
    </div>
  );
};
