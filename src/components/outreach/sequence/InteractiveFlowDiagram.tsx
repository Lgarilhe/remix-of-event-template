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
  Plus,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { SequenceStep } from '../SequenceBuilder';

export type BranchTarget = 'true' | 'false' | null;

interface InteractiveFlowDiagramProps {
  steps: SequenceStep[];
  onStepClick: (stepId: string) => void;
  onAddStep: (branchTarget?: { parentStepId: string; branch: 'true' | 'false' }) => void;
  onRemoveStep: (stepId: string) => void;
  selectedStepId: string | null;
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
  inmail: 'bg-blue-100 text-blue-600 border-blue-300',
  connection_request: 'bg-emerald-100 text-emerald-600 border-emerald-300',
  profile_visit: 'bg-sky-100 text-sky-600 border-sky-300',
  message: 'bg-orange-100 text-orange-600 border-orange-300',
  smart_message: 'bg-purple-100 text-purple-600 border-purple-300',
  wait_connection: 'bg-amber-100 text-amber-600 border-amber-300',
  wait_reply: 'bg-amber-100 text-amber-600 border-amber-300',
  wait_profile_visit: 'bg-amber-100 text-amber-600 border-amber-300',
  condition_branch: 'bg-rose-100 text-rose-600 border-rose-300',
  check_connection: 'bg-indigo-100 text-indigo-600 border-indigo-300',
};

const STEP_LABELS: Record<string, string> = {
  inmail: 'InMail',
  connection_request: 'Invitation',
  profile_visit: 'Visite profil',
  message: 'Message',
  smart_message: 'Smart Msg',
  wait_connection: 'Attendre',
  wait_reply: 'Attendre réponse',
  wait_profile_visit: 'Attendre visite',
  condition_branch: 'Branchement',
  check_connection: 'Vérifier connexion',
};

const StepNode: React.FC<{
  step: SequenceStep;
  index: number;
  onClick: () => void;
  onRemove: () => void;
  isSelected: boolean;
  canRemove: boolean;
  compact?: boolean;
}> = ({ step, index, onClick, onRemove, isSelected, canRemove, compact = false }) => {
  const Icon = STEP_ICONS[step.actionType] || Mail;
  const colorClass = STEP_COLORS[step.actionType] || 'bg-gray-100 text-gray-600 border-gray-300';
  
  if (compact) {
    return (
      <div 
        className={cn(
          "relative group cursor-pointer transition-all",
          isSelected && "scale-105"
        )}
        onClick={onClick}
      >
        <div
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-lg border-2 transition-all",
            colorClass,
            isSelected && "ring-2 ring-primary ring-offset-1 shadow-md"
          )}
        >
          <Icon className="w-4 h-4" />
          <span className="text-xs font-medium">{STEP_LABELS[step.actionType]}</span>
        </div>
        
        {canRemove && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md hover:bg-red-600"
          >
            <Trash2 className="w-2.5 h-2.5" />
          </button>
        )}
      </div>
    );
  }
  
  return (
    <div 
      className={cn(
        "relative group cursor-pointer transition-all",
        isSelected && "scale-105"
      )}
      onClick={onClick}
    >
      <div
        className={cn(
          "flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all min-w-[180px]",
          colorClass,
          isSelected && "ring-2 ring-primary ring-offset-2 shadow-lg"
        )}
      >
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-white/50">
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-muted-foreground">Étape {index + 1}</div>
          <div className="font-medium text-sm truncate">
            {STEP_LABELS[step.actionType]}
          </div>
          {step.delayDays > 0 || step.delayHours > 0 || (step.delayMinutes && step.delayMinutes > 0) ? (
            <div className="text-xs opacity-70 mt-0.5">
              ⏱ {step.delayDays > 0 ? `${step.delayDays}j` : ''} 
              {step.delayHours > 0 ? `${step.delayHours}h` : ''} 
              {step.delayMinutes && step.delayMinutes > 0 ? `${step.delayMinutes}min` : ''}
            </div>
          ) : null}
        </div>
      </div>
      
      {canRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md hover:bg-red-600"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      )}
    </div>
  );
};

const Arrow: React.FC<{ className?: string }> = ({ className }) => (
  <div className={cn("flex justify-center py-2", className)}>
    <ArrowDown className="w-5 h-5 text-muted-foreground" />
  </div>
);

const BranchSplit: React.FC<{
  step: SequenceStep;
  stepIndex: number;
  allSteps: SequenceStep[];
  onStepClick: (stepId: string) => void;
  onAddBranchStep: (branch: 'true' | 'false') => void;
  onRemoveStep: (stepId: string) => void;
  selectedStepId: string | null;
}> = ({ step, stepIndex, allSteps, onStepClick, onAddBranchStep, onRemoveStep, selectedStepId }) => {
  const trueStep = allSteps.find(s => s.id === step.ifTrueGotoStep);
  const falseStep = allSteps.find(s => s.id === step.ifFalseGotoStep);
  
  // Find the index of true/false steps
  const trueStepIndex = trueStep ? allSteps.findIndex(s => s.id === trueStep.id) : -1;
  const falseStepIndex = falseStep ? allSteps.findIndex(s => s.id === falseStep.id) : -1;
  
  return (
    <div className="flex flex-col items-center w-full mt-3">
      {/* Branch lines */}
      <div className="flex items-center justify-center w-full gap-1">
        <div className="flex-1 h-px bg-emerald-400 max-w-[80px]" />
        <div className="w-3 h-3 rounded-full bg-indigo-500 border-2 border-white shadow" />
        <div className="flex-1 h-px bg-orange-400 max-w-[80px]" />
      </div>
      
      {/* Two branches */}
      <div className="flex justify-center gap-4 w-full mt-2">
        {/* Left branch (if connected - 1er degré) */}
        <div className="flex flex-col items-center min-w-[120px]">
          <div className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 mb-2 shadow-sm">
            <Check className="w-3 h-3" />
            1er degré
          </div>
          <div className="w-px h-3 bg-emerald-400" />
          
          {trueStep ? (
            <StepNode
              step={trueStep}
              index={trueStepIndex}
              onClick={() => onStepClick(trueStep.id)}
              onRemove={() => onRemoveStep(trueStep.id)}
              isSelected={selectedStepId === trueStep.id}
              canRemove={allSteps.length > 1}
              compact
            />
          ) : (
            <button
              onClick={() => onAddBranchStep('true')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border-2 border-dashed border-emerald-300 text-emerald-600 hover:bg-emerald-50 hover:border-emerald-400 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="text-xs font-medium">Ajouter</span>
            </button>
          )}
        </div>
        
        {/* Right branch (if not connected - 2e/3e degré) */}
        <div className="flex flex-col items-center min-w-[120px]">
          <div className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-orange-100 text-orange-700 mb-2 shadow-sm">
            <X className="w-3 h-3" />
            2e/3e degré
          </div>
          <div className="w-px h-3 bg-orange-400" />
          
          {falseStep ? (
            <StepNode
              step={falseStep}
              index={falseStepIndex}
              onClick={() => onStepClick(falseStep.id)}
              onRemove={() => onRemoveStep(falseStep.id)}
              isSelected={selectedStepId === falseStep.id}
              canRemove={allSteps.length > 1}
              compact
            />
          ) : (
            <button
              onClick={() => onAddBranchStep('false')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border-2 border-dashed border-orange-300 text-orange-600 hover:bg-orange-50 hover:border-orange-400 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="text-xs font-medium">Ajouter</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export const InteractiveFlowDiagram: React.FC<InteractiveFlowDiagramProps> = ({
  steps,
  onStepClick,
  onAddStep,
  onRemoveStep,
  selectedStepId,
}) => {
  const renderFlow = () => {
    const elements: React.ReactNode[] = [];
    const renderedStepIds = new Set<string>();
    
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      
      // Skip if already rendered as part of a branch
      if (renderedStepIds.has(step.id)) continue;
      
      // Add arrow before step (except first)
      if (i > 0) {
        const prevStep = steps[i-1];
        // Don't add arrow if previous step was a branch (check_connection)
        if (prevStep && prevStep.actionType !== 'check_connection') {
          elements.push(<Arrow key={`arrow-${step.id}`} />);
        }
      }
      
      // Render step node
      elements.push(
        <StepNode
          key={step.id}
          step={step}
          index={i}
          onClick={() => onStepClick(step.id)}
          onRemove={() => onRemoveStep(step.id)}
          isSelected={selectedStepId === step.id}
          canRemove={steps.length > 1}
        />
      );
      
      // If this is a check_connection step, render branches
      if (step.actionType === 'check_connection') {
        elements.push(
          <BranchSplit
            key={`branch-${step.id}`}
            step={step}
            stepIndex={i}
            allSteps={steps}
            onStepClick={onStepClick}
            onAddBranchStep={(branch) => onAddStep({ parentStepId: step.id, branch })}
            onRemoveStep={onRemoveStep}
            selectedStepId={selectedStepId}
          />
        );
        
        // Mark branch targets as rendered
        if (step.ifTrueGotoStep) renderedStepIds.add(step.ifTrueGotoStep);
        if (step.ifFalseGotoStep) renderedStepIds.add(step.ifFalseGotoStep);
      }
    }
    
    return elements;
  };

  // Check if the last step is a check_connection with branches defined
  const lastStep = steps[steps.length - 1];
  const lastStepIsBranch = lastStep?.actionType === 'check_connection';
  const branchesAreFilled = lastStepIsBranch && (lastStep.ifTrueGotoStep || lastStep.ifFalseGotoStep);

  return (
    <div className="flex flex-col items-center py-4 px-2">
      {steps.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <Plus className="w-8 h-8 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Aucune étape dans la séquence
          </p>
          <Button onClick={() => onAddStep()} size="sm">
            <Plus className="w-4 h-4 mr-2" />
            Ajouter une étape
          </Button>
        </div>
      ) : (
        <>
          {renderFlow()}
          
          {/* Add step button - only show if last step is not a branch or branches are not complete */}
          {(!lastStepIsBranch || !branchesAreFilled) && !lastStepIsBranch && (
            <>
              <Arrow />
              <Button
                variant="outline"
                size="sm"
                onClick={() => onAddStep()}
                className="border-dashed border-2 hover:border-primary hover:bg-primary/5"
              >
                <Plus className="w-4 h-4 mr-2" />
                Ajouter une étape
              </Button>
            </>
          )}
        </>
      )}
    </div>
  );
};
